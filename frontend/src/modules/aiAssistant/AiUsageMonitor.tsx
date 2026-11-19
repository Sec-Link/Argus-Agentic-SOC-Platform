import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchModelMonitor, fetchToolMonitor,
  type ModelMonitorResponse, type ModelUsageExecution, type ModelUsageStats, type MonitorKind,
  type MonitorPeriodUnit, type MonitorQuery, type ToolMonitorResponse, type ToolUsageExecution, type ToolUsageStats,
} from 'services/aiAssistant/monitor';
import { formatEstimatedCost, monitorErrorMessage, parseMonitorPeriod } from './usageMonitor';
import AiCallDetails from './AiCallDetails';

const number = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString();
const duration = (value: number | null) => value == null ? 'Unavailable' : `${(value / 1000).toFixed(2)}s`;
const time = (value: string | null) => value ? new Date(value).toLocaleString() : '-';
const statusTag = (value: string) => <Tag color={value === 'completed' || value === 'success' ? 'green' : value === 'failed' ? 'red' : value === 'running' || value === 'awaiting_approval' ? 'blue' : 'default'}>{value.replaceAll('_', ' ')}</Tag>;
const costs = (stats: ModelUsageStats) => <div>
  {stats.costs.length ? stats.costs.map((cost) => <div key={cost.currency}>{formatEstimatedCost(cost.estimated_cost, cost.currency)}</div>) : 'Unavailable'}
  <Typography.Text type="secondary">Cost coverage {number(stats.cost_known_calls)} / {number(stats.total_calls)} calls</Typography.Text>
</div>;

const toolStatColumns = <T extends ToolUsageStats,>(): ColumnsType<T> => [
  { title: 'Calls', dataIndex: 'total_calls', render: number },
  { title: 'Completed', dataIndex: 'success_calls', render: number },
  { title: 'Failed', dataIndex: 'failed_calls', render: number },
  { title: 'Pending', dataIndex: 'pending_calls', render: number },
  { title: 'Average duration', dataIndex: 'avg_duration_ms', render: duration },
  { title: 'Last call', dataIndex: 'last_call_time', render: time },
];
const modelStatColumns = <T extends ModelUsageStats,>(): ColumnsType<T> => [
  { title: 'Calls', dataIndex: 'total_calls', render: number },
  { title: 'Succeeded', dataIndex: 'success_calls', render: number },
  { title: 'Failed', dataIndex: 'failed_calls', render: number },
  { title: 'Input tokens', dataIndex: 'input_tokens', render: number },
  { title: 'Cached input', dataIndex: 'cached_input_tokens', render: number },
  { title: 'Output tokens', dataIndex: 'output_tokens', render: number },
  { title: 'Usage coverage', render: (_, row) => `${number(row.usage_known_calls)} / ${number(row.total_calls)} calls` },
  { title: 'Estimated cost', render: (_, row) => costs(row) },
];
const attributionColumns = <T extends ToolUsageExecution | ModelUsageExecution,>(): ColumnsType<T> => [
  { title: 'User', dataIndex: 'user_label' },
  { title: 'Agent', dataIndex: 'agent_name', render: (value: string) => value || '-' },
  { title: 'Status', dataIndex: 'status', render: statusTag },
  { title: 'Started', dataIndex: 'start_time', render: time },
  { title: 'Duration', dataIndex: 'duration_ms', render: duration },
];

export default function AiUsageMonitor({ kind }: { kind: MonitorKind }) {
  const [period, setPeriod] = useState('24');
  const [unit, setUnit] = useState<MonitorPeriodUnit>('hour');
  const [userId, setUserId] = useState<number>();
  const [profileId, setProfileId] = useState<string>();
  const [tool, setTool] = useState('');
  const [status, setStatus] = useState<string>();
  const [query, setQuery] = useState<MonitorQuery>({ period_value: 24, period_unit: 'hour', page: 1, page_size: 20 });
  const [data, setData] = useState<ToolMonitorResponse | ModelMonitorResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selectedExecution, setSelectedExecution] = useState<{ kind: MonitorKind; id: string }>();

  useEffect(() => { setSelectedExecution(undefined); }, [kind]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(undefined);
    const request = kind === 'models' ? fetchModelMonitor(query, controller.signal) : fetchToolMonitor(query, controller.signal);
    void request.then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(monitorErrorMessage(err?.response?.status)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, query, refresh]);

  const apply = () => {
    try {
      const value = parseMonitorPeriod(period, unit);
      setFilterError('');
      setQuery({ period_value: value, period_unit: unit, user_id: data?.scope.can_view_all ? userId : undefined,
        ...(kind === 'models' ? { model_profile_id: profileId } : { tool: tool.trim() || undefined }),
        status, page: 1, page_size: query.page_size });
    } catch (err) { setFilterError((err as Error).message); }
  };
  const toolData = kind === 'tools' ? data as ToolMonitorResponse | undefined : undefined;
  const modelData = kind === 'models' ? data as ModelMonitorResponse | undefined : undefined;
  const pagination = {
    current: data?.page ?? query.page, pageSize: query.page_size, total: data?.count ?? 0,
    showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total: number) => `${total.toLocaleString()} calls`,
    onChange: (page: number, pageSize: number) => setQuery((previous) => ({ ...previous, page: pageSize === previous.page_size ? page : 1, page_size: pageSize })),
  };
  const statuses = kind === 'models' ? ['success', 'failed', 'running']
    : ['completed', 'failed', 'running', 'awaiting_approval', 'approved', 'rejected', 'cancelled'];

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title={kind === 'models' ? 'Model usage' : 'AI tool monitor'}
      extra={<Button loading={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</Button>}>
      <Typography.Paragraph type="secondary">
        {data?.scope.can_view_all ? 'Viewing calls across users. Choose a user to narrow the results.' : 'Your calls are shown. Only authorized reviewers can view calls across users.'}
      </Typography.Paragraph>
      <Form layout="inline" onFinish={apply} style={{ gap: 8, marginBottom: 12 }}>
        <Form.Item label="Past" style={{ margin: 0 }}><Input aria-label="Number of time units" value={period} inputMode="numeric" style={{ width: 85 }} onChange={(event) => setPeriod(event.target.value)} /></Form.Item>
        <Form.Item style={{ margin: 0 }}><Select<MonitorPeriodUnit> aria-label="Time unit" value={unit} onChange={setUnit} style={{ width: 110 }} options={[
          { value: 'hour', label: 'Hours' }, { value: 'day', label: 'Days' }, { value: 'week', label: 'Weeks' },
        ]} /></Form.Item>
        {data?.scope.can_view_all && <Form.Item style={{ margin: 0 }}><Select<number> aria-label="Filter by user" allowClear showSearch optionFilterProp="label"
          placeholder="All users" value={userId} onChange={setUserId} style={{ width: 180 }} options={data.users.map((user) => ({ value: user.id, label: user.label }))} /></Form.Item>}
        {kind === 'models' ? <Form.Item style={{ margin: 0 }}><Select<string> aria-label="Filter by model" allowClear showSearch optionFilterProp="label"
          placeholder="All models" value={profileId} onChange={setProfileId} style={{ width: 200 }} options={(data?.models || []).map((model) => ({ value: model.id, label: model.label }))} /></Form.Item>
          : <Form.Item style={{ margin: 0 }}><Input aria-label="Filter by tool name" placeholder="Tool name" value={tool} maxLength={200} style={{ width: 200 }} onChange={(event) => setTool(event.target.value)} /></Form.Item>}
        <Form.Item style={{ margin: 0 }}><Select<string> aria-label="Filter by status" allowClear placeholder="All statuses" value={status} onChange={setStatus} style={{ width: 175 }}
          options={statuses.map((value) => ({ value, label: value.replaceAll('_', ' ') }))} /></Form.Item>
        <Button htmlType="submit" type="primary" disabled={loading}>Apply filters</Button>
      </Form>
      {filterError && <Alert type="warning" showIcon message={filterError} style={{ marginBottom: 12 }} />}
      {error && <Alert type="error" showIcon message={error} />}
      {data && <Typography.Text type="secondary">{time(data.window.since)} — {time(data.window.until)}. Statistics cover the full filtered period; the call log is paginated.</Typography.Text>}
    </Card>

    {data && <Card title="Summary">
      <Space size={32} wrap align="start">
        <Statistic title="Calls" value={data.summary.total_calls} />
        <Statistic title="Succeeded" value={data.summary.success_calls} />
        <Statistic title="Failed" value={data.summary.failed_calls} />
        <Statistic title={kind === 'models' ? 'Running' : 'Pending'} value={modelData?.summary.running_calls ?? toolData?.summary.pending_calls ?? 0} />
        <Statistic title="Average duration" value={duration(data.summary.avg_duration_ms)} />
        {modelData && <>
          <Statistic title="Input tokens" value={number(modelData.summary.input_tokens)} />
          <Statistic title="Cached input tokens" value={number(modelData.summary.cached_input_tokens)} />
          <Statistic title="Output tokens" value={number(modelData.summary.output_tokens)} />
          <div><Typography.Text type="secondary">Estimated cost</Typography.Text>{costs(modelData.summary)}</div>
        </>}
      </Space>
      {modelData && <Alert type="info" showIcon style={{ marginTop: 16 }} message={`Token usage reported for ${number(modelData.summary.usage_known_calls)} / ${number(modelData.summary.total_calls)} calls.`}
        description="Token totals and estimated subtotals include only available measurements. Missing usage or required pricing is unavailable, not zero. Currencies are kept separate. Estimates use prices saved at call time and may differ from provider invoices. Earlier calls without recorded usage cannot be reconstructed." />}
      {toolData && <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        Calls include recorded tool attempts and approvals. Failed totals include rejected and cancelled calls; these may not have executed. Pending includes running calls and approvals still in progress.
      </Typography.Paragraph>}
    </Card>}

    {data?.groups_truncated && <Alert type="warning" showIcon message="The grouped breakdown and filter options are limited to 200 entries. Summary totals cover every matching call; narrow the filters for a complete breakdown." />}

    {toolData && <>
      <Card title="By tool"><Table<ToolUsageStats & { tool_name: string }> size="small" rowKey="tool_name" dataSource={toolData.by_tool}
        scroll={{ x: 800 }} pagination={{ pageSize: 10 }} columns={[{ title: 'Tool', dataIndex: 'tool_name' }, ...toolStatColumns<ToolMonitorResponse['by_tool'][number]>()]} /></Card>
      <Card title="By user"><Table<ToolUsageStats & { user_id: number | null; user_label: string }> size="small" rowKey={(row) => String(row.user_id ?? 'unknown')}
        dataSource={toolData.by_user} scroll={{ x: 800 }} pagination={{ pageSize: 10 }} columns={[{ title: 'User', dataIndex: 'user_label' }, ...toolStatColumns<ToolMonitorResponse['by_user'][number]>()]} /></Card>
    </>}
    {modelData && <>
      <Card title="By model"><Table<ModelUsageStats & { model_profile_id: string | null; profile_name: string; model_name: string }> size="small"
        rowKey={(row) => `${row.model_profile_id || ''}:${row.profile_name}:${row.model_name}`} dataSource={modelData.by_model} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }}
        columns={[{ title: 'Model', render: (_, row) => <div>{row.profile_name || row.model_name || 'Unattributed model'}{row.profile_name && <div><Typography.Text type="secondary">{row.model_name}</Typography.Text></div>}</div> }, ...modelStatColumns<ModelMonitorResponse['by_model'][number]>()]} /></Card>
      <Card title="By user"><Table<ModelUsageStats & { user_id: number | null; user_label: string }> size="small" rowKey={(row) => String(row.user_id ?? 'unknown')}
        dataSource={modelData.by_user} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }} columns={[{ title: 'User', dataIndex: 'user_label' }, ...modelStatColumns<ModelMonitorResponse['by_user'][number]>()]} /></Card>
    </>}

    <Card title="Call log">
      {kind === 'tools' ? <Table<ToolUsageExecution> size="small" rowKey="id" loading={loading} dataSource={toolData?.executions || []} pagination={pagination} scroll={{ x: 1000 }}
        locale={{ emptyText: error ? 'Usage unavailable' : 'No tool calls in this period.' }}
        columns={[{ title: 'Tool', dataIndex: 'tool_name' }, { title: 'Tool type', dataIndex: 'tool_source' }, ...attributionColumns<ToolUsageExecution>(),
          { title: 'Model', dataIndex: 'model_name', render: (value: string) => value || '-' },
          { title: 'Details', fixed: 'right', width: 85, render: (_, row) => <Button size="small" onClick={() => setSelectedExecution({ kind, id: row.id })}>Details</Button> }]}
        expandable={{ expandedRowRender: (row) => <Space direction="vertical"><span>Source: {row.source || '-'}</span><span>Request reference: {row.request_id || '-'}</span><span>Finished: {time(row.end_time)}</span></Space> }} />
        : <Table<ModelUsageExecution> size="small" rowKey="id" loading={loading} dataSource={modelData?.executions || []} pagination={pagination} scroll={{ x: 1300 }}
          locale={{ emptyText: error ? 'Usage unavailable' : 'No model calls in this period.' }}
          columns={[{ title: 'Model', render: (_, row) => row.profile_name || row.model_name || 'Unattributed model' }, ...attributionColumns<ModelUsageExecution>(),
            { title: 'Input tokens', dataIndex: 'input_tokens', render: number }, { title: 'Cached input', dataIndex: 'cached_input_tokens', render: number },
            { title: 'Output tokens', dataIndex: 'output_tokens', render: number }, { title: 'Estimated cost', render: (_, row) => formatEstimatedCost(row.estimated_cost, row.currency) },
            { title: 'Details', fixed: 'right', width: 85, render: (_, row) => <Button size="small" onClick={() => setSelectedExecution({ kind, id: row.id })}>Details</Button> }]}
          expandable={{ expandedRowRender: (row) => <Space direction="vertical"><span>Model ID: {row.model_name || '-'}</span><span>Source: {row.source || '-'}</span><span>Request reference: {row.request_id || '-'}</span><span>Finished: {time(row.end_time)}</span>{row.error_code && <span>Error code: {row.error_code}</span>}</Space> }} />}
    </Card>
    {selectedExecution?.kind === kind && <AiCallDetails key={`${kind}:${selectedExecution.id}`} kind={kind}
      id={selectedExecution.id} onClose={() => setSelectedExecution(undefined)} />}
  </Space>;
}
