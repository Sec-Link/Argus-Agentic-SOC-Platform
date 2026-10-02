import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { SearchOutlined, FilterOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { Resizable } from 'react-resizable';
import type { ResizeCallbackData } from 'react-resizable';
import { fetchAlerts } from 'services/alerts';
import type { Alert } from 'types';
import { getRiskObjects, riskTagColor } from 'utils/riskObjects';

const { Text } = Typography;

const normalizeAlertSeverity = (sev?: string): 'critical' | 'high' | 'medium' | 'low' | 'unknown' => {
  const s = String(sev || '').trim().toLowerCase();
  if (s.includes('{{') || s.includes('}}')) return 'unknown';
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
  if (!txt || txt.includes('{{') || txt.includes('}}')) return '-';
  return txt;
};

const formatTime = (value: any) => {
  if (value === undefined || value === null || String(value).trim() === '') return 'Unknown Time';
  const raw = String(value).trim();
  if (raw.includes('{{') || raw.includes('}}')) return 'Unknown Time';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return 'Unknown Time';
  return dt.toLocaleString();
};

// Field accessors — keep alert shape resolution in one place.
const getId = (row: any) => normalizeText(pick(row, ['alert_id', '_id']));
const getTime = (row: any) => pick(row, ['timestamp', '@timestamp', 'event_time', 'time']);
const getSeverity = (row: any) => String(pick(row, ['severity', 'level', 'log.level']) || 'unknown');
const getMessage = (row: any) => normalizeText(pick(row, ['description', 'body.description', 'details', 'message', 'title', 'event.original', 'log.message', 'summary']));
const getDetails = (row: any) => normalizeText(pick(row, ['description', 'details', 'event.reason', 'raw_message']));
const getHost = (row: any) => normalizeText(pick(row, ['host_name', 'body.host_name', 'host.name', 'host', 'hostname', 'agent.name']));
const getSourceIp = (row: any) => normalizeText(pick(row, ['source_ip', 'body.source_ip', 'source.ip', 'src_ip', 'client.ip']));

// Resizable header cell (react-resizable + AntD components override).
const ResizableTitle: React.FC<any> = (props) => {
  const { onResize, width, ...restProps } = props;
  if (!width) return <th {...restProps} />;
  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

const DEFAULT_WIDTHS: Record<string, number> = {
  severity: 120,
  alert_id: 150,
  timestamp: 190,
  message: 260,
  rule_name: 200,
  host_name: 160,
  source_ip: 150,
  risk_objects: 220,
};

const AlertList: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [total, setTotal] = useState<number>(0);
  const [searchText, setSearchText] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [ordering, setOrdering] = useState<string>('-timestamp');
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetchAlerts(page, pageSize, undefined, {
        q: searchText,
        severity: severityFilter,
        ordering,
      });
      if (currentRequest !== requestId.current) return;
      setAlerts(res.alerts || []);
      setTotal(Math.max(0, Number(res.total) || 0));
      const resolvedPage = Math.max(1, Number(res.page) || 1);
      if (resolvedPage !== page) setPage(resolvedPage);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      console.error('Failed to load alerts', err);
      setAlerts([]);
      setTotal(0);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [ordering, page, pageSize, searchText, severityFilter]);

  useEffect(() => {
    // Invalidate an in-flight page immediately when query state changes;
    // the replacement request may be intentionally delayed for typing debounce.
    requestId.current += 1;
    const timer = window.setTimeout(() => void load(), searchText.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, searchText]);

  useEffect(() => {
    const onConnectorSwitch = () => void load();
    window.addEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
    return () => window.removeEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
  }, [load]);

  const resetFilters = () => {
    setSearchText('');
    setSeverityFilter(undefined);
    setOrdering('-timestamp');
    setPage(1);
  };

  const sortOrderFor = (field: string) => (
    ordering === field ? 'ascend' : ordering === `-${field}` ? 'descend' : null
  );

  const copyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard?.writeText(id);
      message.success('Alert ID copied');
    } catch {
      message.error('Copy failed');
    }
  };

  const handleResize = (key: string) => (_e: React.SyntheticEvent, data: ResizeCallbackData) => {
    setWidths((w) => ({ ...w, [key]: Math.max(60, Math.round(data.size.width)) }));
  };

  const baseColumns: any[] = [
    {
      title: 'Severity',
      key: 'severity',
      dataIndex: 'severity',
      width: widths.severity,
      sorter: true,
      sortOrder: sortOrderFor('severity'),
      render: (_: any, row: any) => renderSeverityTag(getSeverity(row)),
    },
    {
      title: 'ID',
      key: 'alert_id',
      dataIndex: 'alert_id',
      width: widths.alert_id,
      sorter: true,
      sortOrder: sortOrderFor('alert_id'),
      render: (_: any, row: any) => {
        const id = getId(row);
        if (id === '-') return <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span>;
        return (
          <span className="alert-id-cell">
            <Tooltip title={id}>
              <span className="alert-id-text">{id}</span>
            </Tooltip>
            <Tooltip title="Copy full ID">
              <CopyOutlined className="alert-id-copy" onClick={(e) => copyId(id, e)} />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'Time',
      key: 'timestamp',
      dataIndex: 'timestamp',
      width: widths.timestamp,
      sorter: true,
      sortOrder: sortOrderFor('timestamp'),
      render: (_: any, row: any) => <span style={{ whiteSpace: 'nowrap' }}>{formatTime(getTime(row))}</span>,
    },
    {
      title: 'Message',
      key: 'message',
      dataIndex: 'message',
      width: widths.message,
      ellipsis: true,
      sorter: true,
      sortOrder: sortOrderFor('message'),
      render: (_: any, row: any) => {
        const msg = getMessage(row);
        return (
          <Tooltip title={msg === '-' ? '' : msg}>
            <span className="alert-msg-title">{msg}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Detection Rule',
      key: 'rule_name',
      width: widths.rule_name,
      ellipsis: true,
      render: (_: any, row: any) => {
        const detectionId = row.detection_rule_id;
        if (!detectionId) return <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span>;
        return (
          <Link
            href={`/settings/detection/rules/${encodeURIComponent(String(detectionId))}`}
            className="alert-rule-link"
            onClick={(e) => e.stopPropagation()}
          >
            {String(row.rule_name || detectionId)}
          </Link>
        );
      },
    },
    {
      title: 'Risk Objects',
      key: 'risk_objects',
      width: widths.risk_objects,
      ellipsis: true,
      render: (_: any, row: any) => {
        const entities = getRiskObjects(row);
        if (!entities.length) return <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span>;
        const shown = entities.slice(0, 2);
        const rest = entities.length - shown.length;
        return (
          <Space size={4} wrap>
            {shown.map((e, i) => (
              <Tag key={i} color={riskTagColor(e.type)} style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                {e.value}
              </Tag>
            ))}
            {rest > 0 && (
              <Tooltip title={entities.slice(2).map((e) => `${e.type}: ${e.value}`).join('\n')}>
                <Tag style={{ margin: 0 }}>+{rest}</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  const columns = baseColumns.map((col) => ({
    ...col,
    onHeaderCell: (column: any) => ({
      width: column.width,
      onResize: handleResize(col.key),
    }),
  }));

  return (
    <div>
      {/* Slim toolbar — no title / debug text */}
      <div className="alerts-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(127,127,127,0.7)' }} />}
          placeholder="Filter by id / message / details / rule / host / ip"
          className="alerts-search"
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
        />
        <Select
          allowClear
          suffixIcon={<FilterOutlined />}
          placeholder="Severity"
          className="alerts-severity-select"
          value={severityFilter}
          onChange={(v) => { setSeverityFilter(v); setPage(1); }}
          options={[
            { label: 'Critical', value: 'critical' },
            { label: 'High', value: 'high' },
            { label: 'Medium', value: 'medium' },
            { label: 'Low', value: 'low' },
            { label: 'Unknown', value: 'unknown' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={resetFilters}>
          Reset
        </Button>
      </div>

      <div className="alerts-table-wrap">
        <Table
          className="alerts-resizable-table"
          rowKey="alert_id"
          dataSource={alerts}
          loading={loading}
          size="middle"
          scroll={{ x: 1300 }}
          components={{ header: { cell: ResizableTitle } }}
          columns={columns as any}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (t) => `${t} alerts`,
          }}
          onChange={(pagination, _filters, sorter, extra) => {
            const nextSize = Number(pagination.pageSize || pageSize);
            setPageSize(nextSize);
            setPage(nextSize !== pageSize ? 1 : Number(pagination.current || 1));
            if (extra.action === 'sort') {
              const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
              const field = String(activeSorter?.field || activeSorter?.columnKey || '');
              if (activeSorter?.order && ['timestamp', 'severity', 'alert_id', 'message'].includes(field)) {
                setOrdering(`${activeSorter.order === 'descend' ? '-' : ''}${field}`);
              } else {
                setOrdering('-timestamp');
              }
              setPage(1);
            }
          }}
          onRow={(record: any) => ({
            onClick: () => {
              setSelectedAlert(record);
              setDetailOpen(true);
            },
            style: { cursor: 'pointer' },
          })}
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
                {renderSeverityTag(getSeverity(selectedAlert))}
                <Tag color="blue">{normalizeText(pick(selectedAlert, ['source_index', '_index']))}</Tag>
                <Tag>{formatTime(getTime(selectedAlert))}</Tag>
              </Space>
              <div style={{ marginTop: 10 }}>
                <Text strong>ID:</Text>{' '}
                <Text code style={{ wordBreak: 'break-all' }}>
                  {getId(selectedAlert)}
                </Text>
              </div>
            </div>

            <div>
              <Text strong>Message</Text>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{getMessage(selectedAlert)}</div>
            </div>

            <div>
              <Text strong>Details</Text>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{getDetails(selectedAlert)}</div>
            </div>

            <Space size={40} wrap>
              <div>
                <Text strong>Host Name</Text>
                <div style={{ marginTop: 6 }}>{getHost(selectedAlert)}</div>
              </div>
              <div>
                <Text strong>Source IP</Text>
                <div style={{ marginTop: 6 }}>{getSourceIp(selectedAlert)}</div>
              </div>
            </Space>

            {(() => {
              const entities = getRiskObjects(selectedAlert);
              if (!entities.length) return null;
              return (
                <div>
                  <Text strong>Risk Objects</Text>
                  <div style={{ marginTop: 6 }}>
                    <Space size={6} wrap style={{ width: '100%' }}>
                      {entities.map((e, i) => (
                        <Tag
                          key={i}
                          color={riskTagColor(e.type)}
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            maxWidth: '100%',
                            whiteSpace: 'normal',
                            wordBreak: 'break-all',
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ opacity: 0.7 }}>{e.field || e.type}:</span> {e.value}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                </div>
              );
            })()}

            <div>
              <Text strong>Detection Rule</Text>
              <div style={{ marginTop: 6 }}>
                {selectedAlert.detection_rule_id ? (
                  <Link href={`/settings/detection/rules/${encodeURIComponent(String(selectedAlert.detection_rule_id))}`}>
                    {selectedAlert.rule_name || selectedAlert.detection_rule_id}
                  </Link>
                ) : (
                  <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span>
                )}
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
