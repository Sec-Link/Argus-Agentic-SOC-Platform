import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Switch, Table, Tag, Tabs, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  createKibanaDetectionRule,
  deleteKibanaDetectionRule,
  getKibanaDetectionRule,
  listKibanaConnectors,
  listKibanaDetectionRules,
  patchKibanaDetectionRule,
  previewKibanaDetectionRule,
  updateKibanaDetectionRule,
  type KibanaDetectionRule,
} from 'services/detections';

const severityColor = (s?: string) => {
  const k = String(s || '').toLowerCase();
  if (k === 'critical') return 'red';
  if (k === 'high') return 'volcano';
  if (k === 'medium') return 'gold';
  if (k === 'low') return 'blue';
  return 'default';
};

const defaultRule = {
  name: '',
  type: 'query',
  enabled: false,
  author: [],
  risk_score: 50,
  severity: 'medium',
  description: '',
  index: ['logs-*'],
  query: '*',
  language: 'kuery',
  from: 'now-6m',
  to: 'now',
  interval: '5m',
  tags: [],
  references: [],
  false_positives: [],
  max_signals: 100,
  license: '',
  note: '',
  actions: [],
  threshold: { field: [], value: 1, cardinality: [] },
  eql_query: '',
  new_terms_fields: [],
  history_window_start: 'now-7d',
  threat_index: [],
  threat_query: '*',
  threat_mapping: [],
  esql_query: '',
};

export default function Detections() {
  const { message: messageApi } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<KibanaDetectionRule[]>([]);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortField, setSortField] = useState<string>('enabled');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KibanaDetectionRule | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<KibanaDetectionRule | null>(null);
  const [mitreThreat, setMitreThreat] = useState<any[]>([]);
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; connector_type_id?: string }>>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewJson, setPreviewJson] = useState('');
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRange, setPreviewRange] = useState<'5m' | '15m' | '1h' | '24h' | '7d' | 'custom'>('1h');
  const [previewCustomFrom, setPreviewCustomFrom] = useState('now-1h');

  const buildKibanaFilter = (text: string) => {
    const q = String(text || '').trim();
    if (!q) return undefined;
    // Keep to fields that are known to exist in Kibana saved object index pattern for rules.
    return `alert.attributes.name: *${q}*`;
  };

  const loadData = async (
    nextPage = page,
    nextPageSize = pageSize,
    nextQuery = query,
    nextSortField = sortField,
    nextSortOrder = sortOrder,
  ) => {
    setLoading(true);
    try {
      // Kibana sorting on boolean `enabled` is unstable across some versions/indexes.
      // For `enabled`, fetch all then sort locally for deterministic behavior.
      if (nextSortField === 'enabled') {
        const resp = await listKibanaDetectionRules({
          page: 1,
          per_page: 10000,
          sort_field: 'name',
          sort_order: 'asc',
          filter: buildKibanaFilter(nextQuery),
        });
        const all = Array.isArray(resp.data) ? resp.data.slice() : [];
        all.sort((a, b) => {
          const av = a.enabled ? 1 : 0;
          const bv = b.enabled ? 1 : 0;
          return nextSortOrder === 'asc' ? av - bv : bv - av;
        });
        setRows(all);
        setTotal(all.length);
      } else {
        const resp = await listKibanaDetectionRules({
          page: nextPage,
          per_page: nextPageSize,
          sort_field: nextSortField,
          sort_order: nextSortOrder,
          filter: buildKibanaFilter(nextQuery),
        });
        setRows(Array.isArray(resp.data) ? resp.data : []);
        setTotal(resp.total || (Array.isArray(resp.data) ? resp.data.length : 0));
      }
    } catch (e: any) {
      messageApi.error(e?.response?.data?.detail || 'Failed to load Kibana detection rules');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    (async () => {
      try {
        const list = await listKibanaConnectors();
        setConnectors(Array.isArray(list) ? list : []);
      } catch {}
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (enabledFilter === 'enabled' && !r.enabled) return false;
      if (enabledFilter === 'disabled' && r.enabled) return false;
      if (severityFilter !== 'all' && String(r.severity || '').toLowerCase() !== severityFilter) return false;
      if (typeFilter !== 'all' && String(r.type || '').toLowerCase() !== typeFilter) return false;
      return true;
    });
  }, [rows, enabledFilter, severityFilter, typeFilter]);

  const useLocalPaging = sortField === 'enabled';
  const pagedData = useMemo(() => {
    if (!useLocalPaging) return filtered;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [useLocalPaging, filtered, page, pageSize]);

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.type || '').toLowerCase().trim();
      if (t) s.add(t);
    });
    return ['all', ...Array.from(s)];
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(defaultRule);
    setMitreThreat([]);
    setRawJson(JSON.stringify(defaultRule, null, 2));
    setOpen(true);
  };

  const openEdit = async (record: KibanaDetectionRule) => {
    try {
      const detail = await getKibanaDetectionRule(record.id);
      const normalizedActions = Array.isArray((detail as any).actions)
        ? (detail as any).actions.map((a: any) => {
            const actionTypeId = a?.action_type_id || a?.actionTypeId || '';
            const frequency = a?.frequency || {};
            const paramsObj = a?.params ?? {};
            const connectorType = String(actionTypeId || '');
            let paramsText = '';
            if (connectorType === '.index') {
              const docs = Array.isArray(paramsObj?.documents) ? paramsObj.documents : [];
              const firstDoc = docs.length ? docs[0] : {};
              paramsText = JSON.stringify(firstDoc || {}, null, 2);
            } else {
              paramsText = JSON.stringify(paramsObj || {}, null, 2);
            }
            const isSummary = Boolean(frequency?.summary);
            let notifyWhen =
              frequency?.notifyWhen ||
              frequency?.notify_when ||
              (isSummary ? 'onThrottleInterval' : 'onActiveAlert');
            if (isSummary && notifyWhen === 'onActiveAlert') {
              notifyWhen = 'onThrottleInterval';
            }
            return {
              ...a,
              action_type_id: actionTypeId,
              params: paramsText,
              frequency: {
                summary: isSummary,
                notifyWhen,
                throttle: frequency?.throttle ?? null,
              },
            };
          })
        : [];
      const payload = {
        ...detail,
        index: Array.isArray(detail.index) ? detail.index : [],
        tags: Array.isArray(detail.tags) ? detail.tags : [],
        actions: normalizedActions,
      };
      setMitreThreat(Array.isArray((detail as any).threat) ? (detail as any).threat : []);
      setEditing(detail);
      form.setFieldsValue(payload);
      setRawJson(JSON.stringify(payload, null, 2));
      setOpen(true);
    } catch (e: any) {
      messageApi.error(e?.response?.data?.detail || 'Failed to load rule detail');
    }
  };

  const onFormChange = () => {
    const v = form.getFieldsValue();
    const payload = {
      ...v,
      index: Array.isArray(v.index) ? v.index : [],
      tags: Array.isArray(v.tags) ? v.tags : [],
      risk_score: Number(v.risk_score || 50),
      threat: mitreThreat,
    };
    setRawJson(JSON.stringify(payload, null, 2));
  };

  const saveRule = async () => {
    try {
      const v = await form.validateFields();
      const ruleType = String(v.type || 'query');
      if (ruleType === 'eql' && !String(v.eql_query || '').trim()) {
        messageApi.error('EQL rule requires eql_query');
        return;
      }
      if (ruleType === 'esql' && !String(v.esql_query || '').trim()) {
        messageApi.error('ES|QL rule requires esql_query');
        return;
      }
      if (ruleType === 'threshold') {
        const tf = v?.threshold?.field;
        const tv = Number(v?.threshold?.value || 0);
        if (!Array.isArray(tf) || tf.length === 0) {
          messageApi.error('Threshold rule requires at least one group by field');
          return;
        }
        if (!Number.isFinite(tv) || tv < 1) {
          messageApi.error('Threshold rule requires threshold value >= 1');
          return;
        }
      }
      if (ruleType === 'new_terms') {
        const nf = v?.new_terms_fields;
        if (!Array.isArray(nf) || nf.length === 0) {
          messageApi.error('New Terms rule requires at least one field');
          return;
        }
      }
      if (ruleType === 'threat_match') {
        const ti = v?.threat_index;
        const tq = String(v?.threat_query || '').trim();
        const tm = v?.threat_mapping;
        if (!Array.isArray(ti) || ti.length === 0) {
          messageApi.error('Indicator Match rule requires threat index');
          return;
        }
        if (!tq) {
          messageApi.error('Indicator Match rule requires threat query');
          return;
        }
        if (!tm || (typeof tm === 'string' && !tm.trim())) {
          messageApi.error('Indicator Match rule requires threat mapping');
          return;
        }
      }
      const payload = await buildNormalizedPayload();
      setSaving(true);
      if (editing?.id) {
        await updateKibanaDetectionRule(editing.id, payload);
        messageApi.success('Rule updated');
      } else {
        await createKibanaDetectionRule(payload);
        messageApi.success('Rule created');
      }
      setOpen(false);
      await loadData();
    } catch (e: any) {
      if (!e?.errorFields) messageApi.error(e?.response?.data?.detail || e?.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const buildNormalizedPayload = async () => {
    const v = await form.validateFields();
    const ruleType = String(v.type || 'query');
    const rawActions = Array.isArray((v as any).actions) ? (v as any).actions : [];
    const normalizedActions = rawActions
      .map((a: any) => {
        if (!a) return null;
        const hasAnyActionInput = Boolean(
          a.id ||
          a.action_type_id ||
          (typeof a.params === 'string' && a.params.trim()) ||
          (a.params && typeof a.params === 'object' && Object.keys(a.params).length > 0) ||
          a.group ||
          a.frequency
        );
        if (!hasAnyActionInput) return null;
        if (!a.id) throw new Error('Connector is required when action is configured.');
        let params = a.params;
        if (typeof params === 'string') {
          const txt = params.trim();
          if (!txt) params = {};
          else params = JSON.parse(txt);
        }
        const picked = connectors.find((c) => c.id === a.id);
        const actionTypeId = String(a.action_type_id || picked?.connector_type_id || '').trim();
        const frequency = a.frequency || {};
        if (!actionTypeId) {
          throw new Error('Action type ID is required. Please select a connector.');
        }
        const isSummary = Boolean(frequency.summary);
        const notifyWhen = String(
          frequency.notifyWhen ||
          frequency.notify_when ||
          (isSummary ? 'onThrottleInterval' : 'onActiveAlert')
        );
        if (actionTypeId === '.index') {
          if (Array.isArray(params?.documents)) {
            // keep as-is
          } else if (params && typeof params === 'object') {
            params = { documents: [params] };
          } else {
            params = { documents: [{}] };
          }
        }
        return {
          group: a.group || 'default',
          id: a.id,
          action_type_id: actionTypeId,
          params: params ?? {},
          frequency: {
            summary: isSummary,
            notifyWhen,
            throttle: frequency.throttle ?? null,
          },
        };
      })
      .filter(Boolean);
    const payload: any = {
      ...v,
      index: Array.isArray(v.index) ? v.index : [],
      tags: Array.isArray(v.tags) ? v.tags : [],
      risk_score: Number(v.risk_score || 50),
      description: String(v.description ?? editing?.description ?? ''),
      threat: mitreThreat,
      actions: normalizedActions,
    };
    // UI does not manage rule_id; never send it to avoid id/rule_id conflicts.
    delete payload.rule_id;
    if (ruleType !== 'eql') delete payload.eql_query;
    if (ruleType !== 'esql') delete payload.esql_query;
    if (ruleType !== 'threshold') delete payload.threshold;
    if (ruleType !== 'new_terms') {
      delete payload.new_terms_fields;
      delete payload.history_window_start;
    }
    if (ruleType !== 'threat_match') {
      delete payload.threat_index;
      delete payload.threat_query;
      delete payload.threat_mapping;
    } else if (typeof payload.threat_mapping === 'string') {
      try { payload.threat_mapping = JSON.parse(payload.threat_mapping); } catch {}
    }
    if (!payload.actions?.length) delete payload.actions;
    return payload;
  };

  const previewRule = async () => {
    try {
      const payload = await buildNormalizedPayload();
      const fromMap: Record<string, string> = {
        '5m': 'now-5m',
        '15m': 'now-15m',
        '1h': 'now-1h',
        '24h': 'now-24h',
        '7d': 'now-7d',
      };
      payload.from = previewRange === 'custom' ? (previewCustomFrom || 'now-1h') : fromMap[previewRange];
      payload.to = 'now';
      setPreviewLoading(true);
      const result = await previewKibanaDetectionRule(payload);
      setPreviewData(result);
      setPreviewJson(JSON.stringify(result, null, 2));
      setPreviewOpen(true);
    } catch (e: any) {
      if (!e?.errorFields) messageApi.error(e?.response?.data?.message || e?.response?.data?.detail || e?.message || 'Failed to preview rule');
    } finally {
      setPreviewLoading(false);
    }
  };

  const saveRawJson = async () => {
    try {
      const parsed = JSON.parse(rawJson || '{}');
      setSaving(true);
      if (editing?.id) {
        await updateKibanaDetectionRule(editing.id, parsed);
        messageApi.success('Rule updated from JSON');
      } else {
        await createKibanaDetectionRule(parsed);
        messageApi.success('Rule created from JSON');
      }
      setOpen(false);
      await loadData();
    } catch (e: any) {
      messageApi.error(e?.response?.data?.detail || e?.message || 'Invalid JSON or failed to save');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id: string) => {
    if (!id) return;
    try {
      await deleteKibanaDetectionRule(id);
      messageApi.success('Rule deleted');
      await loadData();
    } catch (e: any) {
      messageApi.error(e?.response?.data?.detail || 'Failed to delete rule');
    }
  };

  const toggleRuleEnabled = async (record: KibanaDetectionRule, nextEnabled: boolean) => {
    if (!record?.id) return;
    try {
      await patchKibanaDetectionRule(record.id, { enabled: nextEnabled });
      messageApi.success(nextEnabled ? 'Rule enabled' : 'Rule disabled');
      await loadData();
    } catch (e: any) {
      messageApi.error(e?.response?.data?.detail || e?.message || 'Failed to update enabled state');
    }
  };

  const columns: ColumnsType<KibanaDetectionRule> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: sortField === 'name' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, r) => (
        <div>
          <Tooltip title={r.name || '-'}>
            <div
              style={{
                fontWeight: 600,
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.name || '-'}
            </div>
          </Tooltip>
          <div style={{ fontSize: 12, color: '#888' }}>{r.id}</div>
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 120,
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 84,
      sorter: true,
      sortOrder: sortField === 'enabled' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (v: boolean) => v ? <Tag color="green">ON</Tag> : <Tag>OFF</Tag>,
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      width: 110,
      sorter: true,
      sortOrder: sortField === 'severity' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (v?: string) => {
        const raw = String(v || '').toLowerCase();
        const val = ['critical', 'high', 'medium', 'low'].includes(raw) ? raw : 'low';
        const label = val.charAt(0).toUpperCase() + val.slice(1);
        return <Tag color={severityColor(val)}>{label}</Tag>;
      },
    },
    {
      title: 'Risk',
      dataIndex: 'risk_score',
      key: 'risk_score',
      width: 72,
      sorter: true,
      sortOrder: sortField === 'risk_score' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
    },
    {
      title: 'Author',
      dataIndex: 'author',
      key: 'author',
      width: 120,
      ellipsis: true,
      sorter: true,
      sortOrder: sortField === 'author' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (v: any) => Array.isArray(v) ? v.join(', ') : (v || '-'),
    },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 70,
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      ellipsis: true,
      sorter: true,
      sortOrder: sortField === 'updated_at' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 260,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
          {r.enabled ? (
            <Button size="small" onClick={() => toggleRuleEnabled(r, false)}>Disable</Button>
          ) : (
            <Button size="small" type="primary" ghost onClick={() => toggleRuleEnabled(r, true)}>Enable</Button>
          )}
          <Popconfirm title={`Delete rule: ${r.name || r.id}?`} onConfirm={() => removeRule(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const allColumns = useMemo(() => columns, [columns]);
  const visibleColumns = useMemo(
    () => allColumns.filter((c: any) => c?.key !== 'type' && c?.key !== 'version'),
    [allColumns]
  );

  return (
    <Card
      title={`Kibana Detection Rules (${total})`}
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="Rule name, id, type, severity"
            style={{ width: 220 }}
            onSearch={(v) => {
              setQuery(v);
              setPage(1);
              loadData(1, pageSize, v);
            }}
            onChange={(e) => {
              if (!e.target.value) {
                setQuery('');
                setPage(1);
                loadData(1, pageSize, '');
              }
            }}
          />
          <Segmented
            value={enabledFilter}
            onChange={(v) => setEnabledFilter(v as any)}
            options={[
              { label: 'All rules', value: 'all' },
              { label: 'Enabled', value: 'enabled' },
              { label: 'Disabled', value: 'disabled' },
            ]}
          />
          <Select
            value={severityFilter}
            onChange={setSeverityFilter}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: 'Severity: All' },
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 130 }}
            options={typeOptions.map((t) => ({ value: t, label: t === 'all' ? 'Type: All' : t }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => loadData()} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create Rule</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        columns={visibleColumns}
        dataSource={pagedData}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowRender: (record) => (
            <Space>
              <Button
                size="small"
                onClick={() => {
                  setDetailRecord(record);
                  setDetailOpen(true);
                }}
              >
                View full details
              </Button>
            </Space>
          ),
        }}
        rowClassName={() => 'kibana-detection-row'}
        pagination={{
          current: page,
          pageSize,
          total: useLocalPaging ? filtered.length : total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200'],
        }}
        onChange={(pagination, _filters, sorter) => {
          const s = sorter as SorterResult<KibanaDetectionRule>;
          const sf = s?.field ? String(s.field as string) : sortField;
          const so: 'asc' | 'desc' = s?.order === 'ascend' ? 'asc' : 'desc';
          setSortField(sf);
          setSortOrder(so);
          const p = pagination.current || 1;
          const ps = pagination.pageSize || pageSize;
          setPage(p);
          setPageSize(ps);
          loadData(p, ps, query, sf, so);
        }}
      />

      <Modal
        title={editing ? `Edit Rule: ${editing.name || editing.id}` : 'Create Rule'}
        open={open}
        onCancel={() => setOpen(false)}
        width={1100}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>Cancel</Button>,
          <Space key="preview-group">
            <Select
              value={previewRange}
              style={{ width: 120 }}
              onChange={(v) => setPreviewRange(v as any)}
              options={[
                { value: '5m', label: 'Last 5m' },
                { value: '15m', label: 'Last 15m' },
                { value: '1h', label: 'Last 1h' },
                { value: '24h', label: 'Last 24h' },
                { value: '7d', label: 'Last 7d' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {previewRange === 'custom' ? (
              <Input
                value={previewCustomFrom}
                onChange={(e) => setPreviewCustomFrom(e.target.value)}
                placeholder="now-2h"
                style={{ width: 120 }}
              />
            ) : null}
            <Button key="preview" onClick={previewRule} loading={previewLoading}>Rule Preview</Button>
          </Space>,
          <Button key="json" onClick={saveRawJson} loading={saving}>Save JSON</Button>,
          <Button key="save" type="primary" onClick={saveRule} loading={saving}>Save</Button>,
        ]}
      >
        <Tabs
          items={[
            {
              key: 'definition',
              label: 'Definition',
              children: (
                <Form form={form} layout="vertical" onValuesChange={onFormChange} initialValues={defaultRule}>
                  <Card size="small" title="Rule type" style={{ marginBottom: 12 }}>
                    <Space wrap>
                      {[
                        { value: 'query', label: 'Custom query' },
                        { value: 'threshold', label: 'Threshold' },
                        { value: 'eql', label: 'Event Correlation' },
                        { value: 'new_terms', label: 'New Terms' },
                        { value: 'threat_match', label: 'Indicator Match' },
                        { value: 'esql', label: 'ES|QL' },
                      ].map((it) => {
                        const currentType = form.getFieldValue('type') || 'query';
                        const active = currentType === it.value;
                        return (
                          <Button
                            key={it.value}
                            type={active ? 'primary' : 'default'}
                            onClick={() => {
                              form.setFieldValue('type', it.value);
                              if (it.value !== 'eql') form.setFieldValue('eql_query', '');
                              if (it.value !== 'esql') form.setFieldValue('esql_query', '');
                              if (it.value !== 'threshold') form.setFieldValue('threshold', { field: [], value: 1, cardinality: [] });
                              if (it.value !== 'new_terms') {
                                form.setFieldValue('new_terms_fields', []);
                                form.setFieldValue('history_window_start', 'now-7d');
                              }
                              if (it.value !== 'threat_match') {
                                form.setFieldValue('threat_index', []);
                                form.setFieldValue('threat_query', '*');
                                form.setFieldValue('threat_mapping', []);
                              }
                              onFormChange();
                            }}
                          >
                            {it.label}
                          </Button>
                        );
                      })}
                    </Space>
                  </Card>
                  <Space style={{ width: '100%' }} align="start">
                    <div style={{ width: 520 }}>
                      <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
                      <Form.Item name="type" label="Type" rules={[{ required: true }]}>
                        <Select options={[{ value: 'query' }, { value: 'threshold' }, { value: 'eql' }, { value: 'esql' }, { value: 'threat_match' }, { value: 'saved_query' }, { value: 'new_terms' }]} />
                      </Form.Item>
                      <Form.Item name="severity" label="Severity" rules={[{ required: true }]}>
                        <Select
                          options={[
                            { value: 'critical', label: 'Critical' },
                            { value: 'high', label: 'High' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'low', label: 'Low' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="risk_score" label="Risk Score" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
                    </div>
                    <div style={{ width: 520 }}>
                      <Form.Item name="index" label="Index Patterns"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
                      <Form.Item name="language" label="Query Language"><Select options={[{ value: 'kuery' }, { value: 'lucene' }, { value: 'eql' }]} /></Form.Item>
                      <Form.Item name="query" label="Query"><Input.TextArea rows={4} /></Form.Item>
                      {(form.getFieldValue('type') || 'query') === 'eql' ? (
                        <Form.Item name="eql_query" label="EQL Query"><Input.TextArea rows={5} /></Form.Item>
                      ) : null}
                      {(form.getFieldValue('type') || 'query') === 'esql' ? (
                        <Form.Item name="esql_query" label="ES|QL Query"><Input.TextArea rows={5} /></Form.Item>
                      ) : null}
                      {(form.getFieldValue('type') || 'query') === 'threshold' ? (
                        <Card size="small" title="Threshold" style={{ marginBottom: 8 }}>
                          <Form.Item name={['threshold', 'field']} label="Group by field(s)">
                            <Select mode="tags" tokenSeparators={[',']} />
                          </Form.Item>
                          <Form.Item name={['threshold', 'value']} label="Threshold value">
                            <InputNumber min={1} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item name={['threshold', 'cardinality']} label="Cardinality field(s)">
                            <Select mode="tags" tokenSeparators={[',']} />
                          </Form.Item>
                        </Card>
                      ) : null}
                      {(form.getFieldValue('type') || 'query') === 'new_terms' ? (
                        <Card size="small" title="New terms" style={{ marginBottom: 8 }}>
                          <Form.Item name="new_terms_fields" label="Fields">
                            <Select mode="tags" tokenSeparators={[',']} />
                          </Form.Item>
                          <Form.Item name="history_window_start" label="History window start">
                            <Input placeholder="now-7d" />
                          </Form.Item>
                        </Card>
                      ) : null}
                      {(form.getFieldValue('type') || 'query') === 'threat_match' ? (
                        <Card size="small" title="Indicator match" style={{ marginBottom: 8 }}>
                          <Form.Item name="threat_index" label="Threat index">
                            <Select mode="tags" tokenSeparators={[',']} />
                          </Form.Item>
                          <Form.Item name="threat_query" label="Threat query">
                            <Input.TextArea rows={3} />
                          </Form.Item>
                          <Form.Item name="threat_mapping" label="Threat mapping (JSON)">
                            <Input.TextArea rows={4} placeholder='[{"entries":[{"field":"host.name","type":"mapping","value":"host.name"}]}]' />
                          </Form.Item>
                        </Card>
                      ) : null}
                    </div>
                  </Space>
                </Form>
              ),
            },
            {
              key: 'about',
              label: 'About',
              children: (
                <Form form={form} layout="vertical" onValuesChange={onFormChange} initialValues={defaultRule}>
                  <Space style={{ width: '100%' }} align="start">
                    <div style={{ width: 520 }}>
                      <Form.Item name="author" label="Author"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
                      <Form.Item name="license" label="License"><Input /></Form.Item>
                      <Form.Item name="description" label="Description"><Input.TextArea rows={4} /></Form.Item>
                      <Form.Item name="note" label="Note"><Input.TextArea rows={4} /></Form.Item>
                    </div>
                    <div style={{ width: 520 }}>
                      <Form.Item name="references" label="References"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
                      <Form.Item name="false_positives" label="False Positives"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
                      <Form.Item name="tags" label="Tags"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
                      <Card size="small" title="MITRE ATT&CK Mapping">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {(mitreThreat || []).map((t, idx) => {
                            const tactic = t?.tactic || {};
                            const techniques = Array.isArray(t?.technique) ? t.technique : [];
                            return (
                              <div key={idx} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                                <Space direction="vertical" style={{ width: '100%' }}>
                                  <Input
                                    placeholder="Tactic ID (e.g. TA0001)"
                                    value={tactic.id || ''}
                                    onChange={(e) => {
                                      const next = [...mitreThreat];
                                      next[idx] = { ...next[idx], tactic: { ...tactic, id: e.target.value } };
                                      setMitreThreat(next);
                                    }}
                                  />
                                  <Input
                                    placeholder="Tactic Name (e.g. Initial Access)"
                                    value={tactic.name || ''}
                                    onChange={(e) => {
                                      const next = [...mitreThreat];
                                      next[idx] = { ...next[idx], tactic: { ...tactic, name: e.target.value } };
                                      setMitreThreat(next);
                                    }}
                                  />
                                  <Input
                                    placeholder="Tactic Ref URL"
                                    value={tactic.reference || ''}
                                    onChange={(e) => {
                                      const next = [...mitreThreat];
                                      next[idx] = { ...next[idx], tactic: { ...tactic, reference: e.target.value } };
                                      setMitreThreat(next);
                                    }}
                                  />
                                  <Select
                                    mode="tags"
                                    style={{ width: '100%' }}
                                    placeholder="Technique: T1110|Brute Force|https://attack.mitre.org/techniques/T1110"
                                    value={techniques.map((x: any) => `${x.id || ''}|${x.name || ''}|${x.reference || ''}`)}
                                    onChange={(vals: string[]) => {
                                      const parsed = vals.map((v) => {
                                        const [id, name, reference] = String(v).split('|');
                                        return { id: (id || '').trim(), name: (name || '').trim(), reference: (reference || '').trim() };
                                      });
                                      const next = [...mitreThreat];
                                      next[idx] = { ...next[idx], technique: parsed };
                                      setMitreThreat(next);
                                    }}
                                  />
                                  <Button
                                    danger
                                    onClick={() => {
                                      setMitreThreat(mitreThreat.filter((_, i) => i !== idx));
                                    }}
                                  >
                                    Remove Mapping
                                  </Button>
                                </Space>
                              </div>
                            );
                          })}
                          <Button
                            onClick={() => {
                              setMitreThreat([
                                ...mitreThreat,
                                { framework: 'MITRE ATT&CK', tactic: { id: '', name: '', reference: '' }, technique: [] },
                              ]);
                            }}
                          >
                            Add MITRE Mapping
                          </Button>
                        </Space>
                      </Card>
                    </div>
                  </Space>
                </Form>
              ),
            },
            {
              key: 'schedule',
              label: 'Schedule',
              children: (
                <Form form={form} layout="vertical" onValuesChange={onFormChange} initialValues={defaultRule}>
                  <Space style={{ width: '100%' }} align="start">
                    <div style={{ width: 520 }}>
                      <Form.Item name="from" label="From"><Input placeholder="now-6m" /></Form.Item>
                      <Form.Item name="to" label="To"><Input placeholder="now" /></Form.Item>
                      <Form.Item name="interval" label="Interval"><Input placeholder="5m" /></Form.Item>
                    </div>
                    <div style={{ width: 520 }}>
                      <Form.Item name="enabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item>
                      <Form.Item name="max_signals" label="Max Signals"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                    </div>
                  </Space>
                </Form>
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              children: (
                <Form form={form} layout="vertical" onValuesChange={onFormChange} initialValues={defaultRule}>
                  <Space style={{ width: '100%' }} align="start">
                    <div style={{ width: 520 }}>
                      <Card size="small" title="Actions">
                        <Form.Item name={['actions', 0, 'group']} label="Action group" initialValue="default">
                          <Input placeholder="default" />
                        </Form.Item>
                        <Form.Item name={['actions', 0, 'id']} label="Connector">
                          <Select
                            showSearch
                            placeholder="Select connector"
                            optionFilterProp="label"
                            options={connectors.map((c) => ({
                              value: c.id,
                              label: `${c.name} (${c.connector_type_id || 'unknown'})`,
                            }))}
                            onChange={(val) => {
                              const picked = connectors.find((c) => c.id === val);
                              if (picked?.connector_type_id) {
                                form.setFieldValue(['actions', 0, 'action_type_id'], picked.connector_type_id);
                              }
                            }}
                          />
                        </Form.Item>
                        <Form.Item name={['actions', 0, 'action_type_id']} label="Action type ID">
                          <Input placeholder=".index / .slack / .email ..." />
                        </Form.Item>
                        <Form.Item name={['actions', 0, 'params']} label="Document to index (JSON)">
                          <Input.TextArea rows={8} placeholder='{"index":"alerts","body":{"title":"{{context.rule.name}}"}}' />
                        </Form.Item>
                        <Form.Item label="Action frequency" required>
                          <Space.Compact style={{ width: '100%' }}>
                            <Form.Item
                              noStyle
                              name={['actions', 0, 'frequency', 'summary']}
                              initialValue={false}
                              getValueProps={(v) => ({ value: v ? 'summary' : 'each' })}
                              normalize={(v) => v === 'summary'}
                            >
                              <Select
                                style={{ width: 180 }}
                                options={[
                                  { value: 'each', label: 'For each alert' },
                                  { value: 'summary', label: 'Summary of alerts' },
                                ]}
                                onChange={(mode) => {
                                  const isSummary = mode === 'summary';
                                  const currentNotify = form.getFieldValue(['actions', 0, 'frequency', 'notifyWhen']);
                                  if (isSummary && (!currentNotify || currentNotify === 'onActiveAlert')) {
                                    form.setFieldValue(['actions', 0, 'frequency', 'notifyWhen'], 'onThrottleInterval');
                                  }
                                  if (!isSummary && !currentNotify) {
                                    form.setFieldValue(['actions', 0, 'frequency', 'notifyWhen'], 'onActiveAlert');
                                  }
                                }}
                              />
                            </Form.Item>
                            <Form.Item noStyle shouldUpdate>
                              {() => {
                                const isSummary = Boolean(form.getFieldValue(['actions', 0, 'frequency', 'summary']));
                                return (
                                  <Form.Item
                                    noStyle
                                    name={['actions', 0, 'frequency', 'notifyWhen']}
                                    initialValue={isSummary ? 'onThrottleInterval' : 'onActiveAlert'}
                                  >
                                    <Select
                                      style={{ width: 'calc(100% - 180px)' }}
                                      options={
                                        isSummary
                                          ? [
                                              { value: 'onThrottleInterval', label: 'On custom action interval' },
                                              { value: 'onActionGroupChange', label: 'On status change' },
                                            ]
                                          : [
                                              { value: 'onActiveAlert', label: 'Per rule run' },
                                              { value: 'onThrottleInterval', label: 'On custom action interval' },
                                              { value: 'onActionGroupChange', label: 'On status change' },
                                            ]
                                      }
                                    />
                                  </Form.Item>
                                );
                              }}
                            </Form.Item>
                          </Space.Compact>
                        </Form.Item>
                      </Card>
                    </div>
                  </Space>
                </Form>
              ),
            },
            {
              key: 'json',
              label: 'Raw JSON',
              children: <Input.TextArea rows={26} value={rawJson} onChange={(e) => setRawJson(e.target.value)} />,
            },
          ]}
        />
      </Modal>
      <Modal
        title="Rule Preview"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={[<Button key="close" onClick={() => setPreviewOpen(false)}>Close</Button>]}
        width={980}
      >
        <Card size="small" title="Preview Summary" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="Matched">
              {String(
                previewData?.matched ?? previewData?.total ?? previewData?.hits?.total?.value ?? previewData?.num_matches ?? '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Window">
              {String(previewData?.from ?? '-')} ~ {String(previewData?.to ?? '-')}
            </Descriptions.Item>
            <Descriptions.Item label="Took (ms)">
              {String(previewData?.took ?? previewData?.timing?.took ?? '-')}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              {String(previewData?.status ?? 'ok')}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Sample Events" style={{ marginBottom: 12 }}>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={{ pageSize: 5 }}
            dataSource={(() => {
              if (Array.isArray(previewData?.events)) return previewData.events;
              if (Array.isArray(previewData?.data)) return previewData.data;
              if (Array.isArray(previewData?.hits?.hits)) return previewData.hits.hits.map((h: any) => h?._source || h);
              return [];
            })()}
            columns={[
              {
                title: '@timestamp',
                dataIndex: '@timestamp',
                key: '@timestamp',
                width: 220,
                render: (_: any, r: any) => r?.['@timestamp'] || r?.timestamp || '-',
              },
              {
                title: 'message/title',
                key: 'msg',
                render: (_: any, r: any) => {
                  const raw = r?.message || r?.title || r?.event?.original || JSON.stringify(r);
                  const s = String(raw || '-');
                  return s.length > 160 ? `${s.slice(0, 160)}...` : s;
                },
              },
            ]}
          />
        </Card>

        <Collapse
          items={[
            {
              key: 'raw',
              label: 'Raw Preview JSON',
              children: <Input.TextArea rows={14} value={previewJson} readOnly />,
            },
          ]}
        />
      </Modal>
      <Drawer
        title={detailRecord ? `Rule Details: ${detailRecord.name || detailRecord.id}` : 'Rule Details'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={760}
      >
        <pre style={{ margin: 0, maxHeight: 'calc(100vh - 140px)', overflow: 'auto' }}>
          {JSON.stringify(detailRecord || {}, null, 2)}
        </pre>
      </Drawer>
      <style>{`
        .kibana-detection-row td {
          vertical-align: top;
        }
      `}</style>
    </Card>
  );
}
