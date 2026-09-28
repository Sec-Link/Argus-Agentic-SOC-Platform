import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { listAuditLogs } from 'services/accounts';

type AuditLogItem = {
  id: string;
  event_type: string;
  action_type?: 'page_view' | 'feature_exec' | 'auth' | string;
  path?: string;
  method?: string;
  details?: Record<string, any>;
  user_email?: string | null;
  admin_email?: string | null;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failure';
  failure_reason?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
};

const eventOptions = [
  { label: 'All', value: '' },
  { label: 'OTP Request', value: 'otp_request' },
  { label: 'OTP Verify', value: 'otp_verify' },
  { label: 'Admin Approve', value: 'admin_approve' },
  { label: 'Admin Reject', value: 'admin_reject' },
  { label: 'Registration', value: 'registration' },
  { label: 'Email Sent', value: 'email_sent' },
];

const statusOptions = [
  { label: 'All', value: '' },
  { label: 'Success', value: 'success' },
  { label: 'Failure', value: 'failure' },
];

const eventLabel = (value: string) =>
  ({
    otp_request: 'OTP Request',
    otp_verify: 'OTP Verify',
    admin_approve: 'Admin Approve',
    admin_reject: 'Admin Reject',
    registration: 'Registration',
    email_sent: 'Email Sent',
  }[value] || value);

const actionLabel = (row: AuditLogItem) => {
  const service = String(row.details?.service || '').trim();
  if (service) {
    const colors: Record<string, string> = {
      'Alerts Service': 'blue', 'Detection Rules': 'purple', 'Risk (RBA)': 'geekblue',
      'Reports Generator': 'green', 'Report Generator': 'green', 'Audit Logs': 'cyan',
      'Tickets Service': 'orange',
    };
    return { label: service, color: colors[service] || 'blue' };
  }
  const action = String(row.action_type || '').toLowerCase();
  if (action === 'page_view') return { label: 'Page View', color: 'purple' };
  if (action === 'feature_exec') return { label: 'Action', color: 'orange' };
  if (action === 'auth') return { label: 'Auth', color: 'cyan' };
  return { label: eventLabel(row.event_type), color: 'blue' };
};

const AuditLogs: React.FC = () => {
  const [rows, setRows] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState('');
  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'created_at' | '-created_at'>('-created_at');

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const res = await listAuditLogs({
        event_type: eventType || undefined,
        status: status || undefined,
        email: email.trim() || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        page: nextPage,
        limit: nextPageSize,
        sort,
      });
      setRows(Array.isArray(res?.results) ? res.results : []);
      setTotal(Number(res?.count || 0));
      setPage(Number(res?.page || nextPage));
      setPageSize(Number(res?.limit || nextPageSize));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.response?.data?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, pageSize);
  }, [eventType, status, sort]);

  const columns: ColumnsType<AuditLogItem> = useMemo(
    () => [
      {
        title: 'Timestamp',
        dataIndex: 'created_at',
        sorter: true,
        sortOrder: sort === '-created_at' ? 'descend' : 'ascend',
        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
      },
      {
        title: 'Event',
        dataIndex: 'event_type',
        render: (_v: string, row) => { const action = actionLabel(row); return <Tag color={action.color}>{action.label}</Tag>; },
      },
      {
        title: 'Email',
        key: 'email',
        render: (_, row) => row.user_email || row.admin_email || '-',
      },
      {
        title: 'Status',
        dataIndex: 'status',
        render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag>,
      },
      {
        title: 'Failure Reason',
        dataIndex: 'failure_reason',
        render: (v: string) => v || '-',
      },
    ],
    [sort]
  );

  return (
    <Card title="Audit Logs">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          <Select
            style={{ width: 190 }}
            value={eventType}
            onChange={setEventType}
            options={eventOptions}
            placeholder="Event Type"
          />
          <Select
            style={{ width: 140 }}
            value={status}
            onChange={setStatus}
            options={statusOptions}
            placeholder="Status"
          />
          <Input
            style={{ width: 260 }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Search email"
            allowClear
          />
          <DatePicker
            value={fromDate ? dayjs(fromDate) : null}
            onChange={(v) => setFromDate(v ? v.format('YYYY-MM-DD') : '')}
            placeholder="From"
          />
          <DatePicker
            value={toDate ? dayjs(toDate) : null}
            onChange={(v) => setToDate(v ? v.format('YYYY-MM-DD') : '')}
            placeholder="To"
          />
          <Button onClick={() => load(1, pageSize)}>Search</Button>
          <Button
            onClick={() => {
              setEventType('');
              setStatus('');
              setEmail('');
              setFromDate('');
              setToDate('');
              setSort('-created_at');
              load(1, 20);
            }}
          >
            Reset
          </Button>
        </Space>

        <Table<AuditLogItem>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => load(nextPage, nextSize),
          }}
          onChange={(pagination, _filters, sorter: any) => {
            if (sorter?.field === 'created_at') {
              const nextSort = sorter?.order === 'ascend' ? 'created_at' : '-created_at';
              setSort(nextSort);
            }
          }}
          expandable={{
            expandedRowRender: (row) => (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Typography.Text>
                  <strong>IP:</strong> {row.ip_address || '-'}
                </Typography.Text>
                <Typography.Text>
                  <strong>User-Agent:</strong> {row.user_agent || '-'}
                </Typography.Text>
                <Typography.Text>
                  <strong>Admin:</strong> {row.admin_email || '-'}
                </Typography.Text>
                <Typography.Text>
                  <strong>Service:</strong>{' '}
                  <span style={{ color: '#58a6ff', fontWeight: 600 }}>{row.details?.service || row.path || '-'}</span>
                </Typography.Text>
                <Typography.Text>
                  <strong>Endpoint:</strong> [{row.details?.method || row.method || '-'}] {row.details?.path || row.path || '-'}
                </Typography.Text>
                <Typography.Text>
                  <strong>Details:</strong>
                </Typography.Text>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(row.details || row.metadata || {}, null, 2)}
                </pre>
              </Space>
            ),
          }}
        />
      </Space>
    </Card>
  );
};

export default AuditLogs;
