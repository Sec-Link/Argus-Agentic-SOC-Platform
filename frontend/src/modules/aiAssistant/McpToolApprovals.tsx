import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Switch, Table, Typography } from 'antd';
import { fetchAiAssistantMcpTools, updateAiAssistantMcpServer, type AssistantMcpTool } from '../../api';

function errorMessage(error: any, fallback: string): string {
  if (error?.response?.status === 403) return 'You do not have permission to manage this MCP server. Ask an administrator for external MCP server permissions.';
  if (error?.response?.status === 401) return 'Your session has expired. Sign in again.';
  const data = error?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.error === 'string') return data.error;
  if (data && typeof data === 'object') {
    const errors = Object.values(data).flatMap((value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
    if (errors.length) return errors.join(' ');
  }
  return fallback;
}

export default function McpToolApprovals({ server, readonly = false, onClose, onSaved }: {
  server: { name: string; title?: string };
  readonly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tools, setTools] = useState<AssistantMcpTool[]>([]);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const controller = useRef<AbortController | null>(null);

  const loadTools = useCallback(async () => {
    if (readonly) { setLoading(false); return; }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setVersion('');
    try {
      const result = await fetchAiAssistantMcpTools(server.name, request.signal);
      if (request.signal.aborted) return;
      setTools(result.tools);
      setApprovals({ ...result.tool_approvals });
      setVersion(result.updated_at);
    } catch (error) {
      if (!request.signal.aborted) {
        setTools([]);
        setLoadError(errorMessage(error, 'Failed to load tools from the MCP server. Retry when it is available.'));
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [server.name, readonly]);

  useEffect(() => {
    void loadTools();
    return () => { controller.current?.abort(); };
  }, [loadTools]);

  const save = async () => {
    if (readonly || !version || loading || saving || loadError) return;
    setSaving(true);
    setSaveError('');
    try {
      await updateAiAssistantMcpServer(server.name, { tool_approvals: approvals, approval_policy_version: version });
      onSaved();
    } catch (error) {
      setSaveError(errorMessage(error, 'Failed to save tool approvals. Reload tools before trying again.'));
    } finally { setSaving(false); }
  };

  return <Modal title={`Tool approvals: ${server.title || server.name}`} open width={850}
    onCancel={onClose} onOk={() => void save()} okText="Save approvals" confirmLoading={saving}
    okButtonProps={{ disabled: readonly || loading || !!loadError || !version }} cancelButtonProps={{ disabled: saving }}
    closable={!saving} maskClosable={!saving} keyboard={!saving} destroyOnClose>
    <Typography.Paragraph type="secondary">
      Set approval for each tool on this MCP server. Turning approval off allows AI to call that tool automatically for authorized users. New tools require approval by default. Changing the server endpoint or token resets these choices.
    </Typography.Paragraph>
    <Space style={{ marginBottom: 16 }}><Button onClick={() => void loadTools()} loading={loading} disabled={readonly || saving}>Reload tools</Button></Space>
    {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
    {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}
    <Table<AssistantMcpTool> rowKey="name" dataSource={tools} loading={loading} size="small" scroll={{ x: 560 }}
      pagination={{ pageSize: 10 }} locale={{ emptyText: loadError ? 'Tools are unavailable' : 'This server has no tools.' }}
      columns={[
        { title: 'Tool', render: (_, tool) => <><Typography.Text strong style={{ wordBreak: 'break-word' }}>{tool.name}</Typography.Text><div><Typography.Text type="secondary">{tool.description}</Typography.Text></div></> },
        { title: 'Require approval', width: 170, render: (_, tool) => <Switch aria-label={`Require approval for ${tool.name}`} checked={approvals[tool.name] !== false}
          disabled={readonly || loading || saving || !!loadError} onChange={(required) => { setApprovals((previous) => ({ ...previous, [tool.name]: required })); setSaveError(''); }} /> },
      ]}
      expandable={{ expandedRowRender: (tool) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(tool.input_schema, null, 2)}</pre> }}
    />
  </Modal>;
}
