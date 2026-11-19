import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Space, Spin, Typography } from 'antd';
import { fetchMonitorExecution, type ExecutionContent, type MonitorExecutionDetail, type MonitorKind } from 'services/aiAssistant/monitor';
import { executionContentUnavailable, formatEstimatedCost, formatExecutionContent, monitorDetailErrorMessage } from './usageMonitor';

function ContentCard({ title, content }: { title: string; content: ExecutionContent }) {
  const text = formatExecutionContent(content);
  return <Card title={title} size="small">
    {content.truncated && <Alert type="warning" showIcon message="This content was truncated when recorded. The snapshot is incomplete." style={{ marginBottom: 12 }} />}
    {text === null ? <Typography.Text type="secondary">{executionContentUnavailable(content.reason)}</Typography.Text>
      : text === '' ? <Typography.Text type="secondary">Empty content was recorded.</Typography.Text>
        : <>
          <Typography.Paragraph copyable={{ text }} style={{ marginBottom: 8 }}>Copy {title.toLowerCase()}</Typography.Paragraph>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 400, overflow: 'auto', lineHeight: 1.5 }}>{text}</pre>
        </>}
  </Card>;
}

export default function AiCallDetails({ kind, id, onClose }: { kind: MonitorKind; id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<MonitorExecutionDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setDetail(undefined);
    void fetchMonitorExecution(kind, id, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(monitorDetailErrorMessage(err?.response?.status)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, id, refresh]);

  const execution = detail?.execution;
  return <Drawer title={kind === 'models' ? 'Model call details' : 'Tool call details'} open onClose={onClose}
    width="min(900px, 100vw)" destroyOnClose
    extra={<Button onClick={() => setRefresh((value) => value + 1)} loading={loading}>Refresh</Button>}>
    <Space direction="vertical" size={16} style={{ width: '100%' }} data-ai-context-exclude>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Stored request and response snapshots for this individual call. Omitted fields and unrecorded content cannot be reconstructed.
      </Typography.Paragraph>
      {loading && <Spin tip="Loading call details"><div style={{ minHeight: 100 }} /></Spin>}
      {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => setRefresh((value) => value + 1)}>Retry</Button>} />}
      {detail && execution && <>
        <Descriptions bordered size="small" column={1} contentStyle={{ overflowWrap: 'anywhere' }}>
          <Descriptions.Item label="Execution ID">{execution.id}</Descriptions.Item>
          <Descriptions.Item label="User">{execution.user_label}</Descriptions.Item>
          {'tool_name' in execution && <Descriptions.Item label="Tool">{execution.tool_name}</Descriptions.Item>}
          <Descriptions.Item label="Model">{execution.model_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="Agent">{execution.agent_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="Status">{execution.status.replaceAll('_', ' ')}</Descriptions.Item>
          <Descriptions.Item label="Source">{execution.source || '-'}</Descriptions.Item>
          <Descriptions.Item label="Started">{new Date(execution.start_time).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Finished">{execution.end_time ? new Date(execution.end_time).toLocaleString() : '-'}</Descriptions.Item>
          <Descriptions.Item label="Request reference">{execution.request_id || '-'}</Descriptions.Item>
          {'estimated_cost' in execution && <Descriptions.Item label="Estimated cost">{formatEstimatedCost(execution.estimated_cost, execution.currency)}</Descriptions.Item>}
          {'error_code' in execution && execution.error_code && <Descriptions.Item label="Error code">{execution.error_code}</Descriptions.Item>}
        </Descriptions>
        <ContentCard title="Request" content={detail.request} />
        <ContentCard title="Response" content={detail.response} />
      </>}
    </Space>
  </Drawer>;
}
