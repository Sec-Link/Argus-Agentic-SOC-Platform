import React, { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { App, Button, Card, Col, DatePicker, Form, Grid, Input, Modal, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';
import { Pie } from '@ant-design/plots';
import { batchDeleteSlaTickets, batchUpdateSlaTickets, createSlaTicket, updateSlaTicket, updateSlaTicketStatus } from 'services/tickets';
import { listUsers } from 'services/accounts';
import type { SlaTicketListItem } from 'types';

type Props = {
  tickets: SlaTicketListItem[];
  loading?: boolean;
  onRefresh: (query?: Record<string, string | number | undefined | null>) => void;
  onOpenDetail: (ticketNumber: string) => void;
};

type SlaBucket = 'n/a' | '<=1h' | '1-4h' | '>4h';
type TimeRangeKey = '15m' | '1h' | '24h' | '7d' | '30d' | 'custom';
type UserOption = { id: number; username: string };
type IncidentFilters = {
  severity: string[];
  status: string[];
  owner: string[];
  sla: SlaBucket[];
};

const priorityColor = (p: string) => {
  if (p === 'critical') return 'red';
  if (p === 'high') return 'volcano';
  if (p === 'medium') return 'gold';
  if (p === 'low') return 'blue';
  return 'default';
};

const statusColor = (s: string) => {
  if (s === 'new') return 'default';
  if (s === 'acknowledged') return 'blue';
  if (s === 'triaged') return 'purple';
  if (s === 'contained') return 'cyan';
  if (s === 'pending') return 'orange';
  if (s === 'resolved') return 'green';
  if (s === 'closed') return 'red';
  return 'default';
};

const statusLabel: Record<string, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  triaged: 'Triaged',
  contained: 'Contained',
  resolved: 'Resolved',
  closed: 'Closed',
};

const renderSeverityTag = (p?: string, label?: string) => {
  const key = (p || 'unknown').toLowerCase();
  const cls = `sla-severity-tag sla-severity-${key}`;
  const raw = label ?? p ?? 'unknown';
  const text = String(raw);
  const formatted = text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  return <Tag className={cls}>{formatted}</Tag>;
};

const renderStatusTag = (s?: string) => {
  const key = (s || 'unknown').toLowerCase();
  const cls = `sla-status-tag sla-status-${key}`;
  return <Tag className={cls}>{statusLabel[key] ?? s ?? 'unknown'}</Tag>;
};

const priorityHex: Record<string, string> = {
  critical: '#ff4d4f',
  high: '#fa541c',
  medium: '#faad14',
  low: '#1677ff',
  unknown: '#8c8c8c',
};

const statusHex: Record<string, string> = {
  new: '#8c8c8c',
  acknowledged: '#1677ff',
  triaged: '#722ed1',
  contained: '#13c2c2',
  pending: '#fa8c16',
  resolved: '#52c41a',
  closed: '#ff4d4f',
  unknown: '#8c8c8c',
};

const slaHex: Record<string, string> = {
  '<=1h': '#52c41a',
  '1-4h': '#faad14',
  '>4h': '#ff4d4f',
  'n/a': '#8c8c8c',
};

const mttrBucket = (t: SlaTicketListItem): SlaBucket => {
  const v = t.sla_summary?.mttr_seconds;
  if (v === undefined || v === null) return 'n/a';
  if (v <= 3600) return '<=1h';
  if (v <= 4 * 3600) return '1-4h';
  return '>4h';
};

type QueryFilters = {
  text: string;
  status?: string;
  priority?: string;
  owner?: string;
};

const parseQuery = (raw: string): QueryFilters => {
  const q = (raw || '').trim();
  const out: QueryFilters = { text: '' };
  if (!q) return out;
  const parts = q.split(/\s+/g);
  const free: string[] = [];
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z_]+):(.*)$/);
    if (!m) {
      free.push(p);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = (m[2] || '').trim();
    if (!val) continue;
    if (key === 'status') out.status = val;
    else if (key === 'priority') out.priority = val;
    else if (key === 'owner') out.owner = val;
    else free.push(p);
  }
  out.text = free.join(' ');
  return out;
};

export default function SlaTicketListView(props: Props) {
  const { tickets, loading, onRefresh, onOpenDetail } = props;
  const { message } = App.useApp();
  const storedUsername = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('siem_username') || '';
    } catch {
      return '';
    }
  }, []);
  const screens = Grid.useBreakpoint();
  const [showChartPanel, setShowChartPanel] = useState(true);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'summary'>('table');
  const [autoRefresh, setAutoRefresh] = useState<'off' | '1m' | '5m' | '10m'>('off');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUsers, setAssignUsers] = useState<UserOption[]>([]);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editPriority, setEditPriority] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [filters, setFilters] = useState<IncidentFilters>({
    severity: [],
    status: [],
    owner: [],
    sla: [],
  });
  const [pageSize, setPageSize] = useState<number>(20);
  const [quickRange, setQuickRange] = useState<TimeRangeKey | null>(null);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);

  const parsedQuery = useMemo(() => parseQuery(query), [query]);

  const baseFiltered = useMemo(() => {
    const text = (parsedQuery.text || '').toLowerCase();
    return (tickets || []).filter((t) => {
      const owner = t.assigned_user_username || 'Unassigned';
      if (parsedQuery.status && t.status !== parsedQuery.status) return false;
      if (parsedQuery.priority && t.priority !== parsedQuery.priority) return false;
      if (parsedQuery.owner && owner !== parsedQuery.owner) return false;

      if (!text) return true;
      const hay = `${t.ticket_number} ${t.title} ${t.status} ${t.priority} ${owner}`.toLowerCase();
      return hay.includes(text);
    });
  }, [tickets, parsedQuery]);

  const filtered = useMemo(() => {
    return baseFiltered.filter((t) => {
      const owner = t.assigned_user_username || 'Unassigned';
      // Multi-select filters are intentionally OR-within-category and
      // AND-across-categories. Example: severity in [high, medium] AND
      // status in [new]. This mirrors common incident-response triage UX.
      if (filters.status.length && !filters.status.includes(t.status || 'unknown')) return false;
      if (filters.severity.length && !filters.severity.includes(t.priority || 'unknown')) return false;
      if (filters.owner.length && !filters.owner.includes(owner)) return false;
      if (filters.sla.length && !filters.sla.includes(mttrBucket(t))) return false;
      return true;
    });
  }, [baseFiltered, filters]);

  const stats = useMemo(() => {
    const byPriority: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byOwner: Record<string, number> = {};
    const bySla: Record<string, number> = {};
    for (const t of baseFiltered) {
      byPriority[t.priority || 'unknown'] = (byPriority[t.priority || 'unknown'] || 0) + 1;
      byStatus[t.status || 'unknown'] = (byStatus[t.status || 'unknown'] || 0) + 1;
      const owner = t.assigned_user_username || 'Unassigned';
      byOwner[owner] = (byOwner[owner] || 0) + 1;
      const b = mttrBucket(t);
      bySla[b] = (bySla[b] || 0) + 1;
    }
    return { byPriority, byStatus, byOwner, bySla };
  }, [baseFiltered]);

  useEffect(() => {
    if (autoRefresh === 'off') return;
    const ms = autoRefresh === '1m' ? 60_000 : autoRefresh === '5m' ? 300_000 : 600_000;
    const id = window.setInterval(() => onRefresh(), ms);
    return () => window.clearInterval(id);
  }, [autoRefresh, onRefresh]);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((key) => String(key)), [selectedRowKeys]);
  const hasSelection = selectedIds.length > 0;
  const disableBatchActions = bulkLoading || loading || !hasSelection;
  const rowSelection: TableProps<SlaTicketListItem>['rowSelection'] = {
    selectedRowKeys,
    // Ant Design emits row keys from the table checkbox model. Because the
    // table uses `rowKey="ticket_number"`, these keys are exactly the ticket
    // IDs expected by the backend batch endpoints.
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  const selectedTickets = useMemo(() => {
    if (!selectedRowKeys.length) return [];
    const keySet = new Set(selectedRowKeys.map((k) => String(k)));
    return (tickets || []).filter((t) => keySet.has(String(t.ticket_number)));
  }, [selectedRowKeys, tickets]);

  const ensureAssignUsers = async () => {
    if (assignUsers.length) return;
    setAssignLoading(true);
    try {
      const res = await listUsers();
      const items = Array.isArray(res) ? res : (res?.results ?? []);
      const parsed = items
        .map((u: any) => ({ id: Number(u.id), username: String(u.username || '') }))
        .filter((u: UserOption) => Number.isFinite(u.id) && u.username);
      setAssignUsers(parsed);
    } catch {
      message.error('Failed to load users');
    } finally {
      setAssignLoading(false);
    }
  };

  const runBulk = async (label: string, op: (ticketNumber: string) => Promise<any>) => {
    if (!selectedRowKeys.length) {
      message.warning('Select tickets first');
      return;
    }
    const ids = selectedRowKeys.map((k) => String(k));
    setBulkLoading(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => op(id)));
      const success = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - success;
      if (failed) {
        message.warning(`${label}: ${success} ok, ${failed} failed`);
      } else {
        message.success(`${label}: ${success} ok`);
      }
      setSelectedRowKeys([]);
      onRefresh();
    } finally {
      setBulkLoading(false);
    }
  };

  const openAssign = async () => {
    if (!selectedRowKeys.length) {
      message.warning('Select tickets first');
      return;
    }
    setAssignOpen(true);
    setAssignUserId(null);
    await ensureAssignUsers();
  };

  const openEdit = async () => {
    if (!selectedRowKeys.length) {
      message.warning('Select tickets first');
      return;
    }
    setEditOpen(true);
    setEditUserId(null);
    setEditPriority(null);
    setEditStatus(null);
    await ensureAssignUsers();
  };

  const submitEdit = async () => {
    if (!editUserId && !editPriority && !editStatus) {
      message.warning('Select at least one field to update');
      return;
    }
    const user = editUserId ? assignUsers.find((u) => u.id === editUserId) : null;
    const owner = user?.username || null;
    await runBulk('Updated', async (id) => {
      if (editStatus) {
        await updateSlaTicketStatus(id, { status: editStatus, notes: 'Bulk edit' });
      }
      if (editUserId || editPriority) {
        await updateSlaTicket(id, {
          ...(editUserId ? { assigned_user: editUserId, current_assign_owner: owner } : {}),
          ...(editPriority ? { priority: editPriority } : {}),
        });
      }
    });
    setEditOpen(false);
  };

  const submitAssign = async () => {
    if (!assignUserId) {
      message.warning('Select a user');
      return;
    }
    const user = assignUsers.find((u) => u.id === assignUserId);
    const owner = user?.username || null;
    await runBulk('Assigned', (id) => updateSlaTicket(id, { assigned_user: assignUserId, current_assign_owner: owner }));
    setAssignOpen(false);
  };

  const confirmClose = () => {
    if (!selectedIds.length) {
      message.warning('Select tickets first');
      return;
    }
    Modal.confirm({
      title: 'Close selected incidents?',
      content: `Close ${selectedIds.length} selected incidents?`,
      okText: 'Close',
      onOk: async () => {
        setBulkLoading(true);
        try {
          await batchUpdateSlaTickets({
            ticket_ids: selectedIds,
            status: 'Closed',
            notes: 'Batch close from incidents table',
          });
          message.success(`Closed ${selectedIds.length} incidents`);
          setSelectedRowKeys([]);
          onRefresh();
        } finally {
          setBulkLoading(false);
        }
      },
    });
  };

  const confirmDelete = () => {
    if (!selectedIds.length) {
      message.warning('Select tickets first');
      return;
    }
    Modal.confirm({
      title: 'Delete selected incidents?',
      content: `Are you sure you want to delete ${selectedIds.length} selected incidents? This action cannot be undone from the UI.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBulkLoading(true);
        try {
          await batchDeleteSlaTickets({ ticket_ids: selectedIds });
          message.success(`Deleted ${selectedIds.length} incidents`);
          setSelectedRowKeys([]);
          onRefresh();
        } finally {
          setBulkLoading(false);
        }
      },
    });
  };

  const exportSelected = () => {
    if (!selectedTickets.length) {
      message.warning('Select tickets to export');
      return;
    }
    const csvCell = (value: any) => {
      const raw = value === null || value === undefined ? '' : String(value);
      if (!/[,"\n]/.test(raw)) return raw;
      return `"${raw.replace(/"/g, '""')}"`;
    };
    const headers = [
      'ticket_number',
      'title',
      'status',
      'priority',
      'assigned_user',
      'created_time',
      'updated_time',
      'mtta_seconds',
      'mtti_seconds',
      'mttc_seconds',
      'mttr_seconds',
    ];
    const lines = [
      headers.join(','),
      ...selectedTickets.map((t) => ([
        t.ticket_number,
        t.title,
        t.status,
        t.priority,
        t.assigned_user_username || '',
        t.created_time,
        t.updated_time,
        t.sla_summary?.mtta_seconds ?? '',
        t.sla_summary?.mtti_seconds ?? '',
        t.sla_summary?.mttc_seconds ?? '',
        t.sla_summary?.mttr_seconds ?? '',
      ]).map(csvCell).join(',')),
    ];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    a.download = `sla_tickets_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return '';
    const dt = dayjs(value);
    return dt.isValid() ? dt.format('YYYY-MM-DD HH:mm:ss') : String(value);
  };

  const formatDuration = (value?: number | null) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '-';
    const total = Math.max(0, Math.floor(Number(value)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const columns: ColumnsType<SlaTicketListItem> = [
    { title: 'ID', dataIndex: 'ticket_number', key: 'ticket_number', width: 180, render: (v: string) => <a onClick={() => onOpenDetail(v)}>{v}</a> },
    { title: 'Name', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: 'Severity', dataIndex: 'priority', key: 'priority', width: 140, render: (p: string) => renderSeverityTag(p) },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 140, render: (s: string) => renderStatusTag(s) },
    { title: 'Owner', dataIndex: 'assigned_user_username', key: 'assigned_user_username', width: 160, render: (v: string | null | undefined) => v || 'Unassigned' },
    {
      title: 'SLA',
      key: 'sla',
      width: 220,
      render: (_: any, r: SlaTicketListItem) => (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
          TTA:{formatDuration(r.sla_summary?.mtta_seconds)} / TTR:{formatDuration(r.sla_summary?.mttr_seconds)}
        </span>
      ),
    },
    { title: 'Created', dataIndex: 'created_time', key: 'created_time', width: 200, render: (v: string | null | undefined) => formatTimestamp(v) },
  ];

  const toPieData = (rec: Record<string, number>, order?: string[]) => {
    const keys = order?.length ? order : Object.keys(rec);
    return keys.filter((k) => rec[k]).map((k) => ({ type: k, value: rec[k] }));
  };
  const sumRec = (rec: Record<string, number>) => Object.values(rec).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const priorityOrder = ['critical', 'high', 'medium', 'low', 'unknown'];
  const statusOrder = ['new', 'acknowledged', 'triaged', 'contained', 'pending', 'resolved', 'closed', 'unknown'];
  const slaOrder: SlaBucket[] = ['<=1h', '1-4h', '>4h', 'n/a'];
  const topOwnerKeys = Object.keys(stats.byOwner).sort((a, b) => (stats.byOwner[b] || 0) - (stats.byOwner[a] || 0)).slice(0, 10);
  const severityData = toPieData(stats.byPriority, priorityOrder);
  const statusData = toPieData(stats.byStatus, statusOrder);
  const slaData = toPieData(stats.bySla, slaOrder);
  const ownerData = toPieData(stats.byOwner, topOwnerKeys);
  const severityOptions = severityData.map((item) => ({ value: item.type, label: `${item.type} (${item.value})` }));
  const statusOptions = statusData.map((item) => ({ value: item.type, label: `${statusLabel[item.type] ?? item.type} (${item.value})` }));
  const slaOptions = slaData.map((item) => ({ value: item.type, label: `${item.type} (${item.value})` }));
  const ownerOptions = ownerData.map((item) => ({ value: item.type, label: `${item.type} (${item.value})` }));
  const hasActiveFilters = filters.severity.length > 0 || filters.status.length > 0 || filters.owner.length > 0 || filters.sla.length > 0;

  const setFilterValues = <K extends keyof IncidentFilters>(key: K, values: IncidentFilters[K]) => {
    // Single source of truth for dropdown-driven filtering. The chart panels
    // and table both consume `filters`, so Select changes immediately update
    // every dependent visual without a second synchronization layer.
    setFilters((prev) => ({ ...prev, [key]: values }));
  };

  const toggleFilterValue = <K extends keyof IncidentFilters>(key: K, value: IncidentFilters[K][number]) => {
    // Chart and legend clicks call this helper. It toggles the clicked segment
    // into the same arrays used by the AntD multi-select controls, producing
    // true bidirectional binding between chart selections and dropdown tags.
    setFilters((prev) => {
      const current = prev[key] as Array<IncidentFilters[K][number]>;
      const exists = current.includes(value);
      const next = exists ? current.filter((item) => item !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const clearFilters = () => setFilters({ severity: [], status: [], owner: [], sla: [] });

  const pieTooltip = {
    showTitle: false,
    fields: ['type', 'value'],
    formatter: (datum: any) => ({
      name: String(datum?.type ?? 'unknown'),
      value: `${Number(datum?.value ?? 0)} incidents`,
    }),
  } as any;

  const applyQuickRange = (key: TimeRangeKey | null) => {
    if (!key) {
      setQuickRange(null);
      setCustomRangeOpen(false);
      onRefresh({});
      return;
    }
    if (key === 'custom') {
      setQuickRange('custom');
      setCustomRangeOpen(true);
      return;
    }
    const now = dayjs();
    let start = now.subtract(24, 'hour');
    if (key === '15m') start = now.subtract(15, 'minute');
    if (key === '1h') start = now.subtract(1, 'hour');
    if (key === '24h') start = now.subtract(24, 'hour');
    if (key === '7d') start = now.subtract(7, 'day');
    if (key === '30d') start = now.subtract(30, 'day');
    setQuickRange(key);
    onRefresh({
      created_from: start.toISOString(),
      created_to: now.toISOString(),
    });
  };
  const applyCustomRange = (range: null | [dayjs.Dayjs | null, dayjs.Dayjs | null]) => {
    // RangePicker emits both endpoints together. Only dispatch a backend
    // refresh when both sides are valid, otherwise keep the dropdown in custom
    // mode while the user finishes choosing timestamps.
    if (!range || !range[0] || !range[1]) return;
    setQuickRange('custom');
    onRefresh({
      created_from: range[0].toISOString(),
      created_to: range[1].toISOString(),
    });
  };
  const isDarkTheme = typeof window !== 'undefined' && localStorage.getItem('siem_ui_theme') === 'dark';
  const legendTextColor = isDarkTheme ? '#cfe0ff' : 'rgba(0,0,0,0.85)';
  const legendValueColor = isDarkTheme ? '#9fb3d8' : 'rgba(0,0,0,0.55)';
  const legendActiveBg = isDarkTheme ? 'rgba(120, 167, 255, 0.14)' : 'rgba(15, 59, 102, 0.06)';
  const donutHeight = screens.xxl ? 144 : screens.xl ? 134 : screens.lg ? 124 : 118;

  const LegendList = ({
    items,
    selected,
    colorFor,
    onSelect,
  }: {
    items: Array<{ type: string; value: number }>;
    selected: string[];
    colorFor: (type: string) => string;
    onSelect: (type: string) => void;
  }) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => {
          const isActive = selected.includes(it.type);
          return (
            <div
              key={it.type}
              onClick={() => onSelect(it.type)}
              style={{
                display: 'grid',
                gridTemplateColumns: '10px 1fr auto',
                gap: 8,
                alignItems: 'center',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 6,
                background: isActive ? legendActiveBg : 'transparent',
              }}
              title={it.type}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(it.type), display: 'inline-block' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: legendTextColor, fontSize: 12 }}>{it.type}</span>
              <span style={{ color: legendValueColor, fontSize: 11 }}>{it.value}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const isPieDatum = (v: any): v is { type: string; value: number } => {
    if (!v || typeof v !== 'object') return false;
    if (typeof v.type !== 'string' || !v.type) return false;
    // our pie data shape is { type: string, value: number }
    if (!('value' in v)) return false;
    const n = (v as any).value;
    return typeof n === 'number' || (typeof n === 'string' && n.trim() !== '' && !Number.isNaN(Number(n)));
  };

  const getPieTypeFromEvent = (ev: any): string | undefined => {
    const candidates = [
      ev?.data?.data,
      ev?.data?.datum,
      ev?.data?.origin?.data,
      ev?.data?.origin?.datum,
      ev?.data?.origin,
      ev?.data,
      ev?.event?.data?.data,
      ev?.event?.data,
    ];
    const datum = candidates.find(isPieDatum);
    if (!datum) return undefined;
    return String(datum.type);
  };

  const handlePieEvent = (evt: any, onType: (type: string) => void) => {
    const type = String(evt?.type || '');
    const isSelect =
      type.includes('click') ||
      type.includes('tap') ||
      type.includes('pointerup') ||
      type.includes('mouseup');
    if (!isSelect) return;
    const t = getPieTypeFromEvent(evt);
    if (t) onType(t);
  };

  const totalCount = filtered.length;
  const baseCount = baseFiltered.length;

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const eventSiemId = (values.event_siem_id || '').trim();
      const createUid = (values.create_uid || '').trim();
      const payload = {
        ...(eventSiemId ? { event_siem_id: eventSiemId } : {}),
        title: values.title.trim(),
        description: values.description?.trim() || '',
        priority: values.priority || 'medium',
        status: 'new',
        create_uid: createUid,
      };
      setCreating(true);
      const created = await createSlaTicket(payload);
      message.success('Incident created');
      setCreateOpen(false);
      form.resetFields();
      onRefresh();
      if (created?.ticket_number) {
        onOpenDetail(created.ticket_number);
      }
    } catch (err: any) {
      if (err?.errorFields) return; // validation error already shown
      const apiMsg = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiMsg ? String(apiMsg) : 'Create incident failed');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>Incidents</Typography.Title>
          <Typography.Text type="secondary">
            Showing {totalCount}{baseCount !== totalCount ? ` of ${baseCount}` : ''} incidents
          </Typography.Text>
        </div>
        <Space wrap>
          <Button type="primary" onClick={() => setCreateOpen(true)}>New Incident</Button>
          <Button onClick={() => onRefresh()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <div className="incident-workspace-controls">
        <div className="incident-filter-bar">
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Severity: Any"
            value={filters.severity}
            options={severityOptions}
            onChange={(values) => setFilterValues('severity', values)}
            style={{ width: 170 }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Status: Any"
            value={filters.status}
            options={statusOptions}
            onChange={(values) => setFilterValues('status', values)}
            style={{ width: 170 }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Owner: Any"
            value={filters.owner}
            options={ownerOptions}
            onChange={(values) => setFilterValues('owner', values)}
            style={{ width: 190 }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="SLA: Any"
            value={filters.sla}
            options={slaOptions}
            onChange={(values) => setFilterValues('sla', values as SlaBucket[])}
            style={{ width: 150 }}
          />
          <Button disabled={!hasActiveFilters} onClick={clearFilters}>
            Clear filters
          </Button>
          <a onClick={() => setShowChartPanel((v) => !v)}>{showChartPanel ? 'Hide Chart Panel' : 'Show Chart Panel'}</a>
        </div>

        <Space wrap size={8} className="incident-control-right">
          <Input.Search
            allowClear
            placeholder="Search in Incidents (e.g. status:pending owner:alice)"
            style={{ width: 340 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            value={quickRange || undefined}
            placeholder="Time Range"
            onChange={(value) => applyQuickRange(value as TimeRangeKey)}
            style={{ width: 160 }}
            options={[
              { value: '15m', label: 'Last 15 Mins' },
              { value: '1h', label: 'Last 1 Hour' },
              { value: '24h', label: 'Last 24 Hours' },
              { value: '7d', label: 'Last 7 Days' },
              { value: '30d', label: 'Last 30 Days' },
              { value: 'custom', label: 'Custom Range' },
            ]}
          />
          {customRangeOpen ? (
            <DatePicker.RangePicker
              showTime
              allowClear
              onChange={(values) => applyCustomRange(values as null | [dayjs.Dayjs | null, dayjs.Dayjs | null])}
              style={{ width: 360 }}
            />
          ) : null}
          <span className="sla-refresh-label">Refresh every</span>
          <Segmented
            size="small"
            value={autoRefresh}
            onChange={(v) => setAutoRefresh(v as any)}
            options={[
              { label: 'Off', value: 'off' },
              { label: '1m', value: '1m' },
              { label: '5m', value: '5m' },
              { label: '10m', value: '10m' },
            ]}
          />
          <Segmented
            size="small"
            value={viewMode}
            onChange={(v) => setViewMode(v as any)}
            options={[
              { label: 'Table View', value: 'table' },
              { label: 'Summary View', value: 'summary' },
            ]}
          />
        </Space>
      </div>

      {showChartPanel && (
        <div style={{ marginTop: 10 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 12 }}>
              <Card size="small" title="Severity" styles={{ body: { padding: '8px 12px 10px' } }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(112px, 42%)', gap: 12, alignItems: 'center' }}>
                  <LegendList
                    items={severityData}
                    selected={filters.severity}
                    colorFor={(t) => priorityHex[t] || '#8c8c8c'}
                    onSelect={(t) => toggleFilterValue('severity', t)}
                  />
                  <div style={{ width: '100%', maxWidth: 158, justifySelf: 'end', marginTop: -8, marginBottom: -8 }}>
                    <Pie
                      data={severityData}
                      angleField="value"
                      colorField="type"
                      radius={1}
                      innerRadius={0.68}
                      legend={false}
                      autoFit
                      height={donutHeight}
                      tooltip={pieTooltip}
                      statistic={{
                        title: { content: 'Total' },
                        content: {
                          style: { fontSize: 16, fontWeight: 700, color: isDarkTheme ? '#dbe6ff' : '#1f2d3d' },
                          formatter: () => String(sumRec(stats.byPriority)),
                        },
                      }}
                      color={(d: any) => priorityHex[String(d?.type)] || '#8c8c8c'}
                      interactions={[{ type: 'element-active' }, { type: 'element-single-selected' }]}
                      onEvent={(_chart, evt) => handlePieEvent(evt, (t) => toggleFilterValue('severity', t))}
                    />
                  </div>
                </div>
              </Card>

              <Card size="small" title="Status" styles={{ body: { padding: '8px 12px 10px' } }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(112px, 42%)', gap: 12, alignItems: 'center' }}>
                  <LegendList
                    items={statusData}
                    selected={filters.status}
                    colorFor={(t) => statusHex[t] || '#8c8c8c'}
                    onSelect={(t) => toggleFilterValue('status', t)}
                  />
                  <div style={{ width: '100%', maxWidth: 158, justifySelf: 'end', marginTop: -8, marginBottom: -8 }}>
                    <Pie
                      data={statusData}
                      angleField="value"
                      colorField="type"
                      radius={1}
                      innerRadius={0.68}
                      legend={false}
                      autoFit
                      height={donutHeight}
                      tooltip={pieTooltip}
                      statistic={{
                        title: { content: 'Total' },
                        content: {
                          style: { fontSize: 16, fontWeight: 700, color: isDarkTheme ? '#dbe6ff' : '#1f2d3d' },
                          formatter: () => String(sumRec(stats.byStatus)),
                        },
                      }}
                      color={(d: any) => statusHex[String(d?.type)] || '#8c8c8c'}
                      interactions={[{ type: 'element-active' }, { type: 'element-single-selected' }]}
                      onEvent={(_chart, evt) => handlePieEvent(evt, (t) => toggleFilterValue('status', t))}
                    />
                  </div>
                </div>
              </Card>

              <Card size="small" title="SLA" styles={{ body: { padding: '8px 12px 10px' } }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(112px, 42%)', gap: 12, alignItems: 'center' }}>
                  <LegendList
                    items={slaData}
                    selected={filters.sla}
                    colorFor={(t) => slaHex[t] || '#8c8c8c'}
                    onSelect={(t) => toggleFilterValue('sla', t as SlaBucket)}
                  />
                  <div style={{ width: '100%', maxWidth: 158, justifySelf: 'end', marginTop: -8, marginBottom: -8 }}>
                    <Pie
                      data={slaData}
                      angleField="value"
                      colorField="type"
                      radius={1}
                      innerRadius={0.68}
                      legend={false}
                      autoFit
                      height={donutHeight}
                      tooltip={pieTooltip}
                      statistic={{
                        title: { content: 'Total' },
                        content: {
                          style: { fontSize: 16, fontWeight: 700, color: isDarkTheme ? '#dbe6ff' : '#1f2d3d' },
                          formatter: () => String(sumRec(stats.bySla)),
                        },
                      }}
                      color={(d: any) => slaHex[String(d?.type)] || '#8c8c8c'}
                      interactions={[{ type: 'element-active' }, { type: 'element-single-selected' }]}
                      onEvent={(_chart, evt) => handlePieEvent(evt, (t) => toggleFilterValue('sla', t as SlaBucket))}
                    />
                  </div>
                </div>
              </Card>

              <Card size="small" title="Owner" styles={{ body: { padding: '8px 12px 10px' } }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(112px, 42%)', gap: 12, alignItems: 'center' }}>
                  <div style={{ maxHeight: 140, overflow: 'auto' }}>
                    <LegendList
                      items={ownerData}
                      selected={filters.owner}
                      colorFor={() => '#1f6fd1'}
                      onSelect={(t) => toggleFilterValue('owner', t)}
                    />
                  </div>
                  <div style={{ width: '100%', maxWidth: 158, justifySelf: 'end', marginTop: -8, marginBottom: -8 }}>
                    <Pie
                      data={ownerData}
                      angleField="value"
                      colorField="type"
                      radius={1}
                      innerRadius={0.68}
                      legend={false}
                      autoFit
                      height={donutHeight}
                      tooltip={pieTooltip}
                      statistic={{
                        title: { content: 'Total' },
                        content: {
                          style: { fontSize: 16, fontWeight: 700, color: isDarkTheme ? '#dbe6ff' : '#1f2d3d' },
                          formatter: () => String(sumRec(stats.byOwner)),
                        },
                      }}
                      color={() => '#1f6fd1'}
                      interactions={[{ type: 'element-active' }, { type: 'element-single-selected' }]}
                      onEvent={(_chart, evt) => handlePieEvent(evt, (t) => toggleFilterValue('owner', t))}
                    />
                  </div>
                </div>
              </Card>
            </div>
          </Space>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Space wrap style={{ padding: '8px 0' }}>
          <Button
            onClick={openAssign}
            disabled={disableBatchActions}
            style={{ borderColor: '#93c5fd', color: disableBatchActions ? undefined : '#1d4ed8', fontWeight: 600 }}
          >
            Assign
          </Button>
          <Button
            onClick={openEdit}
            disabled={disableBatchActions}
            style={{ borderColor: '#cbd5e1', color: disableBatchActions ? undefined : '#334155', fontWeight: 600 }}
          >
            Edit
          </Button>
          <Button
            onClick={exportSelected}
            disabled={disableBatchActions}
            style={{ borderColor: '#93c5fd', color: disableBatchActions ? undefined : '#1d4ed8', fontWeight: 600 }}
          >
            Export
          </Button>
          <Button
            onClick={confirmClose}
            disabled={disableBatchActions}
            style={{ borderColor: '#f59e0b', color: disableBatchActions ? undefined : '#92400e', fontWeight: 700 }}
          >
            Close
          </Button>
          <Button
            danger
            onClick={confirmDelete}
            disabled={disableBatchActions}
            style={{
              background: disableBatchActions ? undefined : '#fff1f2',
              borderColor: disableBatchActions ? undefined : '#fb7185',
              color: disableBatchActions ? undefined : '#be123c',
              fontWeight: 800,
            }}
          >
            Delete
          </Button>
          <Typography.Text type="secondary">
            {hasSelection ? `${selectedIds.length} selected` : 'Select incidents to enable batch actions'}
          </Typography.Text>
        </Space>

        {viewMode === 'table' ? (
          <Table
            rowKey="ticket_number"
            size="middle"
            loading={loading}
            dataSource={filtered}
            columns={columns}
            rowSelection={rowSelection}
            pagination={{
              pageSize,
              showSizeChanger: true,
              onChange: (_page, size) => setPageSize(size),
              onShowSizeChange: (_page, size) => setPageSize(size),
            }}
          />
        ) : (
          <Row gutter={[12, 12]}>
            {filtered.slice(0, 60).map((t) => (
              <Col key={t.ticket_number} xs={24} md={12} xl={8}>
                {/* Summary cards use explicit text hierarchy classes so dark mode can raise contrast safely. */}
                <Card
                  className="sla-summary-ticket-card"
                  size="small"
                  title={
                    <Space size={8} wrap>
                      <a className="sla-summary-ticket-link" onClick={() => onOpenDetail(t.ticket_number)}>{t.ticket_number}</a>
                      {renderStatusTag(t.status)}
                      {renderSeverityTag(t.priority)}
                    </Space>
                  }
                >
                  <div className="sla-summary-ticket-title">{t.title}</div>
                  <div className="sla-summary-ticket-meta">Owner: {t.assigned_user_username || 'Unassigned'}</div>
                  <div className="sla-summary-ticket-meta">
                    SLA: TTA {formatDuration(t.sla_summary?.mtta_seconds)} / TTR {formatDuration(t.sla_summary?.mttr_seconds)}
                  </div>
                  <div className="sla-summary-ticket-timestamp">
                    Created: {formatTimestamp(t.created_time)}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      <Modal
        title="New Incident"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Created By" name="create_uid" initialValue={storedUsername} rules={[{ required: true, message: 'Created by is required' }]}>
            <Input placeholder="Username" />
          </Form.Item>
          <Form.Item label="SIEM Event ID (optional)" name="event_siem_id">
            <Input placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title is required' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="Priority" name="priority" initialValue="medium">
            <Select
              options={[
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Assign tickets"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={submitAssign}
        okButtonProps={{ disabled: !assignUserId || assignLoading || bulkLoading }}
        confirmLoading={assignLoading || bulkLoading}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="Assignee">
            <Select
              placeholder={assignLoading ? 'Loading users...' : 'Select a user'}
              loading={assignLoading}
              options={assignUsers.map((u) => ({ value: u.id, label: u.username }))}
              value={assignUserId ?? undefined}
              onChange={(v) => setAssignUserId(Number(v))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Edit tickets"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submitEdit}
        okButtonProps={{ disabled: (!editUserId && !editPriority && !editStatus) || assignLoading || bulkLoading }}
        confirmLoading={assignLoading || bulkLoading}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="Owner (optional)">
            <Select
              placeholder={assignLoading ? 'Loading users...' : 'Select a user'}
              loading={assignLoading}
              allowClear
              options={assignUsers.map((u) => ({ value: u.id, label: u.username }))}
              value={editUserId ?? undefined}
              onChange={(v) => setEditUserId(v ? Number(v) : null)}
            />
          </Form.Item>
          <Form.Item label="Severity (priority)">
            <Select
              allowClear
              placeholder="Select priority"
              options={[
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
              value={editPriority ?? undefined}
              onChange={(v) => setEditPriority(v || null)}
            />
          </Form.Item>
          <Form.Item label="Status">
            <Select
              allowClear
              placeholder="Select status"
              options={[
                { value: 'new', label: 'new' },
                { value: 'acknowledged', label: 'acknowledged' },
                { value: 'triaged', label: 'triaged' },
                { value: 'contained', label: 'contained' },
                { value: 'resolved', label: 'resolved' },
                { value: 'closed', label: 'closed' },
              ]}
              value={editStatus ?? undefined}
              onChange={(v) => setEditStatus(v || null)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
