import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { fetchAlerts } from 'services/alerts';
import type { Alert } from 'types';

const { Text } = Typography;

const normalizeAlertSeverity = (sev?: string): 'critical' | 'high' | 'medium' | 'low' | 'unknown' => {
  const s = String(sev || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (['critical', 'fatal', 'emergency', 'panic', 'crit'].includes(s)) return 'critical';
  if (['high', 'error', 'severe'].includes(s)) return 'high';
  if (['warning', 'warn', 'medium', 'moderate'].includes(s)) return 'medium';
  if (['info', 'informational', 'notice', 'low', 'debug'].includes(s)) return 'low';
  return 'unknown';
};

const renderSeverityTag = (sev?: string) => {
  const key = normalizeAlertSeverity(sev);
  const cls = `sla-severity-tag sla-severity-${key}`;
  const raw = String(sev || 'unknown');
  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
  return <Tag className={cls}>{label}</Tag>;
};

const pick = (obj: any, keys: string[]): any => {
  for (const key of keys) {
    if (!obj || !key) continue;
    const direct = obj[key];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return direct;
    if (!key.includes('.')) continue;
    const nested = key.split('.').reduce((cur: any, part: string) => {
      if (cur && typeof cur === 'object' && part in cur) return cur[part];
      return undefined;
    }, obj);
    if (nested !== undefined && nested !== null && String(nested).trim() !== '') return nested;
  }
  return null;
};

const normalizeText = (value: any) => {
  if (value === undefined || value === null) return '-';
  const txt = String(value).trim();
  if (!txt) return '-';
  return txt;
};

const formatTime = (value: any) => {
  if (value === undefined || value === null || String(value).trim() === '') return '-';
  const dt = new Date(String(value));
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
};

const ellipsisNode = (value: string, title?: string) => (
  <Tooltip title={title || value}>
    <span
      style={{
        display: 'inline-block',
        width: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
      }}
    >
      {value}
    </span>
  </Tooltip>
);

const AlertList: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [total, setTotal] = useState<number>(0);
  const [source, setSource] = useState<string | null>(null);
  const [lastLoadMs, setLastLoadMs] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [ordering, setOrdering] = useState<string>('-timestamp');
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);

  const load = async (
    p = page,
    ps = pageSize,
    opts?: { q?: string; severity?: string; ordering?: string }
  ) => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetchAlerts(p, ps, undefined, {
        q: opts?.q ?? searchText,
        severity: opts?.severity ?? severityFilter,
        ordering: opts?.ordering ?? ordering,
      });
      setAlerts(res.alerts || []);
      setTotal(res.total || (res.alerts || []).length);
      setSource(res.source || null);
      setActiveIndex(res.applied_index || res.active_index || null);
      if (res.ordering) setOrdering(String(res.ordering));
    } catch (err) {
      console.error('Failed to load alerts', err);
      setAlerts([]);
      setTotal(0);
      setSource(null);
      setActiveIndex(null);
    } finally {
      setLoading(false);
      const ms = Math.round(performance.now() - start);
      setLastLoadMs(ms);
      if (ms > 1000) console.warn(`AlertList load took ${ms}ms`);
    }
  };

  useEffect(() => {
    load(1, pageSize);
    setPage(1);

    const onConnectorSwitch = () => {
      setPage(1);
      load(1, pageSize);
    };
    window.addEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
    return () => {
      window.removeEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderingToSortOrder = (field: string): 'ascend' | 'descend' | null => {
    if (ordering === field) return 'ascend';
    if (ordering === `-${field}`) return 'descend';
    return null;
  };

  const onTableChange = (pagination: any, _filters: any, sorter: any) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    let nextOrdering = ordering;
    const field = String(s?.field || '');
    const order = s?.order as 'ascend' | 'descend' | undefined;
    if (field && order) nextOrdering = order === 'descend' ? `-${field}` : field;
    if (field && !order && (field === 'timestamp' || field === 'severity' || field === 'message' || field === 'source_index' || field === 'alert_id')) {
      nextOrdering = '-timestamp';
    }
    const nextPageSize = Number(pagination?.pageSize || pageSize);
    const clickedPage = Number(pagination?.current || page);
    const sortChanged = nextOrdering !== ordering;
    const nextPage = sortChanged ? 1 : clickedPage;

    setOrdering(nextOrdering);
    setPageSize(nextPageSize);
    setPage(nextPage);
    load(nextPage, nextPageSize, { ordering: nextOrdering });
  };

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text strong>Alerts</Text>
          {source && <Text type="secondary" style={{ marginLeft: 12 }}>Source: {source}{lastLoadMs ? ` • ${lastLoadMs}ms` : ''}</Text>}
          {activeIndex && <Text type="secondary" style={{ marginLeft: 12 }}>Index: {activeIndex}</Text>}
        </div>
        <Space>
          <Input.Search
            allowClear
            placeholder="Filter by id/message/details/rule"
            style={{ width: 320 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onSearch={() => {
              setPage(1);
              load(1, pageSize, { q: searchText, severity: severityFilter, ordering });
            }}
          />
          <Select
            allowClear
            placeholder="Severity"
            style={{ width: 140 }}
            value={severityFilter}
            onChange={(v) => {
              setSeverityFilter(v);
              setPage(1);
              load(1, pageSize, { q: searchText, severity: v, ordering });
            }}
            options={[
              { label: 'Critical', value: 'critical' },
              { label: 'High', value: 'high' },
              { label: 'Medium', value: 'medium' },
              { label: 'Low', value: 'low' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />
          <Button
            onClick={() => {
              setSearchText('');
              setSeverityFilter(undefined);
              setOrdering('-timestamp');
              setPage(1);
              load(1, pageSize, { q: '', severity: '', ordering: '-timestamp' });
            }}
          >
            Reset
          </Button>
        </Space>
      </div>

      <div style={{ width: '100%', overflowX: 'hidden' }}>
        <Table
          rowKey="alert_id"
          dataSource={alerts}
          loading={loading}
          tableLayout="fixed"
          style={{ width: '100%' }}
          scroll={{ x: 1080 }}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showQuickJumper: { goButton: <Button size="small">Go</Button> },
            showTotal: (t) => `${t} alerts`,
          }}
          onChange={onTableChange}
          onRow={(record: any) => ({
            onClick: () => {
              setSelectedAlert(record);
              setDetailOpen(true);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
          {
            title: 'ID',
            dataIndex: 'alert_id',
            key: 'alert_id',
            sorter: true,
            sortOrder: orderingToSortOrder('alert_id') as any,
            width: 260,
            ellipsis: true,
            render: (_: any, row: any) => {
              const id = normalizeText(pick(row, ['alert_id', '_id']));
              return (
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {ellipsisNode(id, id === '-' ? '' : id)}
                </span>
              );
            },
          },
          {
            title: 'Time',
            dataIndex: 'timestamp',
            key: 'timestamp',
            sorter: true,
            sortOrder: orderingToSortOrder('timestamp') as any,
            width: 150,
            ellipsis: true,
            render: (_: any, row: any) => formatTime(pick(row, ['timestamp', '@timestamp', 'event_time', 'time'])),
          },
          {
            title: 'Severity',
            dataIndex: 'severity',
            key: 'severity',
            sorter: true,
            sortOrder: orderingToSortOrder('severity') as any,
            width: 110,
            render: (_: any, row: any) => renderSeverityTag(String(pick(row, ['severity', 'level', 'log.level']) || 'unknown')),
          },
          {
            title: 'Message',
            dataIndex: 'message',
            key: 'message',
            sorter: true,
            sortOrder: orderingToSortOrder('message') as any,
            width: 210,
            ellipsis: true,
            render: (_: any, row: any) => {
              const msg = normalizeText(pick(row, ['message', 'title', 'event.original', 'log.message', 'summary']));
              return ellipsisNode(msg, msg === '-' ? '' : msg);
            },
          },
          {
            title: 'Details',
            dataIndex: 'description',
            width: 250,
            ellipsis: true,
            render: (_: any, row: any) => {
              const d = normalizeText(pick(row, ['description', 'details', 'event.reason', 'raw_message']));
              return ellipsisNode(d, d === '-' ? '' : d);
            },
          },
          {
            title: 'Source Index',
            dataIndex: 'source_index',
            key: 'source_index',
            sorter: true,
            sortOrder: orderingToSortOrder('source_index') as any,
            width: 100,
            ellipsis: true,
            render: (_: any, row: any) => normalizeText(pick(row, ['source_index', '_index'])),
          }
          ]}
        />
      </div>

      <Modal
        title="Alert Details"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button type="primary" onClick={() => setDetailOpen(false)}>Close</Button>}
        width={860}
      >
        {selectedAlert && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                borderRadius: 12,
                padding: 14,
                background: 'linear-gradient(135deg, rgba(22,119,255,0.15) 0%, rgba(22,119,255,0.05) 100%)',
                border: '1px solid rgba(22,119,255,0.3)',
              }}
            >
              <Space size={10} wrap>
                {renderSeverityTag(String(pick(selectedAlert, ['severity', 'level', 'log.level']) || 'unknown'))}
                <Tag color="blue">{normalizeText(pick(selectedAlert, ['source_index', '_index']))}</Tag>
                <Tag>{formatTime(pick(selectedAlert, ['timestamp', '@timestamp', 'event_time', 'time']))}</Tag>
              </Space>
              <div style={{ marginTop: 10 }}>
                <Text strong>ID:</Text>{' '}
                <Text code style={{ wordBreak: 'break-all' }}>
                  {normalizeText(pick(selectedAlert, ['alert_id', '_id']))}
                </Text>
              </div>
            </div>

            <div>
              <Text strong>Message</Text>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {normalizeText(pick(selectedAlert, ['message', 'title', 'event.original', 'log.message', 'summary']))}
              </div>
            </div>

            <div>
              <Text strong>Details</Text>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {normalizeText(pick(selectedAlert, ['description', 'details', 'event.reason', 'raw_message']))}
              </div>
            </div>

            <div>
              <Text strong>Raw Context</Text>
              <pre
                style={{
                  marginTop: 6,
                  maxHeight: 260,
                  overflow: 'auto',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(127,127,127,0.25)',
                  background: 'rgba(0,0,0,0.18)',
                  whiteSpace: 'pre-wrap',
                }}
              >
{JSON.stringify(selectedAlert, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AlertList;
