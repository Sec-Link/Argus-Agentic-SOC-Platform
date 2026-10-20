import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Space, Switch, Table, Tag, Typography, message as antdMessage } from 'antd';
import {
  createAiAssistantAgent, deleteAiAssistantAgent, listAiAssistantAgents, updateAiAssistantAgent,
  type AssistantAgentConfig, type AssistantAgentFields,
} from 'services/aiAssistant';
import { parseAgentLimit } from './agentLimits';

type AgentFormValues = Omit<AssistantAgentFields, 'max_iterations' | 'max_delegations'> & {
  max_iterations: string;
  max_delegations: string;
};

const emptyAgent: AgentFormValues = { name: '', title: '', role: '', instructions: '', enabled: false, max_iterations: '3', max_delegations: '3' };

function errorMessage(error: any, fallback: string): string {
  if (error?.response?.status === 403) return 'You do not have permission to manage agents. Ask an administrator for AI Assistant agent permissions.';
  if (error?.response?.status === 401) return 'Your session has expired. Sign in again.';
  const data = error?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (data && typeof data === 'object') {
    const fields = Object.entries(data).flatMap(([key, value]) => {
      const text = Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '';
      return text ? [`${key}: ${text}`] : [];
    });
    if (fields.length) return fields.join(' ');
  }
  return fallback;
}

export default function AgentSettings({ readonly = false }: { readonly?: boolean }) {
  const [message, contextHolder] = antdMessage.useMessage();
  const [form] = Form.useForm<AgentFormValues>();
  const [rows, setRows] = useState<AssistantAgentConfig[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssistantAgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busyName, setBusyName] = useState('');
  const loadSequence = useRef(0);

  const loadAgents = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await listAiAssistantAgents(page, pageSize);
      if (sequence === loadSequence.current) { setRows(result.results); setCount(result.count); }
    } catch (error) {
      if (sequence === loadSequence.current) {
        setRows([]); setCount(0); setLoadError(errorMessage(error, 'Failed to load agents. Please retry.'));
      }
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => {
    void loadAgents();
    return () => { loadSequence.current++; };
  }, [loadAgents]);

  const editAgent = (row?: AssistantAgentConfig) => {
    setEditing(row || null);
    setSaveError('');
    form.resetFields();
    form.setFieldsValue(row ? { ...row, max_iterations: String(row.max_iterations ?? 3), max_delegations: String(row.max_delegations ?? 3) } : emptyAgent);
    setOpen(true);
  };
  const closeModal = () => { setOpen(false); form.resetFields(); setSaveError(''); };

  const saveAgent = async (values: AgentFormValues) => {
    setSaving(true);
    setSaveError('');
    try {
      const payload = { ...values, max_iterations: parseAgentLimit(values.max_iterations), max_delegations: parseAgentLimit(values.max_delegations) };
      if (editing) await updateAiAssistantAgent(editing.name, payload);
      else await createAiAssistantAgent(payload);
      message.success(editing ? 'Agent updated' : 'Agent created');
      closeModal();
      await loadAgents();
    } catch (error) { setSaveError(errorMessage(error, 'Failed to save the agent.')); }
    finally { setSaving(false); }
  };

  const toggleAgent = async (row: AssistantAgentConfig, enabled: boolean) => {
    setBusyName(row.name);
    try { await updateAiAssistantAgent(row.name, { enabled }); await loadAgents(); }
    catch (error) { message.error(errorMessage(error, 'Failed to update the agent.')); }
    finally { setBusyName(''); }
  };
  const deleteAgent = async (row: AssistantAgentConfig) => {
    setBusyName(row.name);
    try {
      await deleteAiAssistantAgent(row.name);
      message.success('Agent removed');
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await loadAgents();
    } catch (error) { message.error(errorMessage(error, 'Failed to delete the agent.')); }
    finally { setBusyName(''); }
  };

  return <>
    {contextHolder}
    <Card title="Agents" extra={<Space wrap>
      <Button onClick={() => void loadAgents()} loading={loading}>Refresh</Button>
      {!readonly && <Button type="primary" onClick={() => editAgent()}>Add agent</Button>}
    </Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Coordinator assigns tasks and combines results"
        description="The built-in coordinator automatically selects enabled specialists. Mention @name in chat to limit delegation to those agents (up to 3 distinct agents per message). All agents use your AI Assistant model settings and existing tool permissions and approvals." />
      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
      <Table<AssistantAgentConfig>
        rowKey="name" loading={loading} dataSource={rows} size="small" scroll={{ x: 860 }}
        locale={{ emptyText: loadError ? 'Agents are unavailable' : 'No specialist agents configured. The coordinator can still answer your questions.' }}
        pagination={{ current: page, pageSize, total: count, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
          onChange: (nextPage, nextSize) => { setPage(nextSize !== pageSize ? 1 : nextPage); setPageSize(nextSize); } }}
        columns={[
          { title: 'Agent', width: 200, render: (_, row) => <><Typography.Text strong>{row.title}</Typography.Text><div><Tag>@{row.name}</Tag></div></> },
          { title: 'Role', dataIndex: 'role', render: (role) => <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{role}</Typography.Text> },
          { title: 'Model rounds per task', width: 120, render: (_, row) => row.max_iterations ?? 3 },
          { title: 'Delegations per message', width: 120, render: (_, row) => row.max_delegations ?? 3 },
          { title: 'Enabled', width: 80, render: (_, row) => <Switch size="small" aria-label={`Enable ${row.name}`} checked={row.enabled} disabled={readonly || !!busyName} loading={busyName === row.name} onChange={(enabled) => void toggleAgent(row, enabled)} /> },
          { title: 'Actions', width: 130, render: (_, row) => <Space><Button size="small" disabled={readonly || !!busyName} onClick={() => editAgent(row)}>Edit</Button><Popconfirm title={`Delete ${row.title}?`} description="This agent will no longer be available for new tasks." onConfirm={() => deleteAgent(row)} okText="Delete" okButtonProps={{ danger: true }}><Button size="small" danger disabled={readonly || !!busyName}>Delete</Button></Popconfirm></Space> },
        ]}
      />
    </Card>
    <Modal title={editing ? `Edit agent: ${editing.title}` : 'Add agent'} open={open} width={720}
      onCancel={closeModal} onOk={() => form.submit()} okText="Save agent" confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} forceRender>
      {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" initialValues={emptyAgent} disabled={readonly || saving} onFinish={(values) => void saveAgent(values)}>
        <Row gutter={16}>
          <Col xs={24} sm={18}><Form.Item name="name" label="Mention name" extra="Used for @mentions. Renaming makes the old mention unavailable for new messages."
            rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{0,47}$/, message: 'Start with a lowercase letter; use up to 48 lowercase letters, digits or underscores.' },
              { validator: async (_, value) => { if (['coordinator', 'catalog'].includes(value)) throw new Error('This name is reserved.'); } }]}>
            <Input maxLength={48} placeholder="triage" />
          </Form.Item></Col>
          <Col xs={24} sm={6}><Form.Item name="enabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        <Form.Item name="title" label="Display name" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} placeholder="Alert analyst" /></Form.Item>
        <Form.Item name="role" label="Role and when to delegate" rules={[{ required: true, whitespace: true }]} extra="The coordinator uses this description to choose the right specialist.">
          <Input.TextArea rows={3} maxLength={500} showCount placeholder="Describe this agent's expertise and the tasks it should handle." />
        </Form.Item>
        <Form.Item name="max_iterations" label="Model rounds per task" required
          rules={[{ validator: async (_, value) => { parseAgentLimit(value); } }]}
          extra="Maximum model calls for each delegated task (1–100, default 3). This counts model rounds, not tool calls. Optional skill selection runs outside this budget. The whole message still has a 5-minute time limit.">
          <Input type="text" inputMode="numeric" />
        </Form.Item>
        <Form.Item name="max_delegations" label="Delegations per message" required
          rules={[{ validator: async (_, value) => { parseAgentLimit(value); } }]}
          extra="Maximum assignments to this role in one user message (1–100, default 3). Failed attempts count. All roles share a total limit of 100 assignments per message; the coordinator may use fewer or none.">
          <Input type="text" inputMode="numeric" />
        </Form.Item>
        <Form.Item name="instructions" label="Agent instructions" rules={[{ required: true, whitespace: true }]} extra="Describe the investigation approach and expected output. Existing permissions and tool approvals still apply.">
          <Input.TextArea rows={7} maxLength={6000} showCount placeholder="Define how the agent should investigate, evaluate evidence and report its findings." />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}
