import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { SearchOutlined, FilterOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { Resizable } from 'react-resizable';
import type { ResizeCallbackData } from 'react-resizable';
import { fetchAlerts } from 'services/alerts';
import type { Alert } from 'types';

const { Text } = Typography;

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

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
const getMessage = (row: any) => normalizeText(pick(row, ['message', 'title', 'event.original', 'log.message', 'summary']));
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
};

const AlertList: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [pageSize, setPageSize] = useState<number>(20);
  const [searchText, setSearchText] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);

  // Backend caps the list at ~100 rows and ignores filter/sort params, so we
  // fetch the full capped set once and do filtering/sorting/paging client-side.
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAlerts(1, 100);
      setAlerts(res.alerts || []);
    } catch (err) {
      console.error('Failed to load alerts', err);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onConnectorSwitch = () => load();
    window.addEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
    return () => window.removeEventListener('siem_es_connector_switched', onConnectorSwitch as EventListener);
  }, []);

  // ---- Client-side filtering ----
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const sev = severityFilter;
    return (alerts || []).filter((row: any) => {
      if (sev && normalizeAlertSeverity(getSeverity(row)) !== sev) return false;
      if (q) {
        const haystack = [
          getId(row),
          getMessage(row),
          getDetails(row),
          row.rule_name,
          row.rule_id,
          getHost(row),
          getSourceIp(row),
        ]
          .map((v) => String(v ?? '').toLowerCase())
          .join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [alerts, searchText, severityFilter]);

  const resetFilters = () => {
    setSearchText('');
    setSeverityFilter(undefined);
  };

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
      width: widths.severity,
      sorter: (a: any, b: any) =>
        SEVERITY_RANK[normalizeAlertSeverity(getSeverity(a))] - SEVERITY_RANK[normalizeAlertSeverity(getSeverity(b))],
      render: (_: any, row: any) => renderSeverityTag(getSeverity(row)),
    },
    {
      title: 'ID',
      key: 'alert_id',
      width: widths.alert_id,
      sorter: (a: any, b: any) => getId(a).localeCompare(getId(b)),
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
      width: widths.timestamp,
      defaultSortOrder: 'descend' as const,
      sorter: (a: any, b: any) => {
        const ta = new Date(String(getTime(a) ?? '')).getTime() || 0;
        const tb = new Date(String(getTime(b) ?? '')).getTime() || 0;
        return ta - tb;
      },
      render: (_: any, row: any) => <span style={{ whiteSpace: 'nowrap' }}>{formatTime(getTime(row))}</span>,
    },
    {
      title: 'Message',
      key: 'message',
      width: widths.message,
      ellipsis: true,
      sorter: (a: any, b: any) => getMessage(a).localeCompare(getMessage(b)),
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
      sorter: (a: any, b: any) =>
        String(a?.rule_name || '').localeCompare(String(b?.rule_name || '')),
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
      title: 'Host Name',
      key: 'host_name',
      width: widths.host_name,
      ellipsis: true,
      sorter: (a: any, b: any) => getHost(a).localeCompare(getHost(b)),
      render: (_: any, row: any) => {
        const host = getHost(row);
        return host === '-' ? <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span> : <Text>{host}</Text>;
      },
    },
    {
      title: 'Source IP',
      key: 'source_ip',
      width: widths.source_ip,
      ellipsis: true,
      sorter: (a: any, b: any) => getSourceIp(a).localeCompare(getSourceIp(b)),
      render: (_: any, row: any) => {
        const ip = getSourceIp(row);
        return ip === '-' ? (
          <span style={{ color: 'rgba(127,127,127,0.6)' }}>—</span>
        ) : (
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{ip}</span>
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
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Select
          allowClear
          suffixIcon={<FilterOutlined />}
          placeholder="Severity"
          className="alerts-severity-select"
          value={severityFilter}
          onChange={(v) => setSeverityFilter(v)}
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
          dataSource={filtered}
          loading={loading}
          size="middle"
          scroll={{ x: 1080 }}
          components={{ header: { cell: ResizableTitle } }}
          columns={columns as any}
          pagination={{
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            onShowSizeChange: (_c, size) => setPageSize(size),
            showTotal: (t) => `${t} alerts`,
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
