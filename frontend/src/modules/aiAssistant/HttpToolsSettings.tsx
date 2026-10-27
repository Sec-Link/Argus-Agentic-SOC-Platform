import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography, message as antdMessage } from 'antd';
import { createAiAssistantHttpTool, deleteAiAssistantHttpTool, listAiAssistantHttpTools, updateAiAssistantHttpTool, type HttpToolConfig } from 'services/aiAssistant';
import { buildHttpToolPayload, parseToolTemplate, type HttpToolFormValues } from './httpToolForm';

const emptyForm: HttpToolFormValues = {
  name: '', description: '', enabled: false, requires_approval: true, method: 'GET', url: '', parameters: [],
  query_json: '{}', body_json: '', auth_type: 'none', auth_header: '', auth_prefix: '',
  auth_secret: '', clear_auth_secret: false, timeout_seconds: 15,
};

function errorMessage(error: any, fallback: string): string {
  if (error?.response?.status === 403) return 'You do not have permission to manage these tools. Ask an administrator for AI Assistant HTTP tool permissions.';
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

export default function HttpToolsSettings({ readonly = false }: { readonly?: boolean }) {
  const [message, contextHolder] = antdMessage.useMessage();
  const [form] = Form.useForm<HttpToolFormValues>();
  const [rows, setRows] = useState<HttpToolConfig[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HttpToolConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyName, setBusyName] = useState('');
  const [saveError, setSaveError] = useState('');
  const loadSequence = useRef(0);
  const method = Form.useWatch('method', form);
  const authType = Form.useWatch('auth_type', form);
  const clearingSecret = Form.useWatch('clear_auth_secret', form);

  const loadTools = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await listAiAssistantHttpTools(page, pageSize);
      if (sequence === loadSequence.current) { setRows(result.results); setCount(result.count); }
    } catch (error) {
      if (sequence === loadSequence.current) {
        setRows([]); setCount(0); setLoadError(errorMessage(error, 'Failed to load HTTP tools. Please retry.'));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void loadTools();
    return () => { loadSequence.current++; };
  }, [loadTools]);

  const editTool = (row?: HttpToolConfig) => {
    setEditing(row || null);
    setSaveError('');
    form.resetFields();
    form.setFieldsValue(row ? {
      name: row.name, description: row.description, enabled: row.enabled, requires_approval: row.requires_approval !== false, method: row.method, url: row.url,
      parameters: row.parameters, auth_type: row.auth_type, auth_header: row.auth_header, auth_prefix: row.auth_prefix,
      timeout_seconds: row.timeout_seconds, query_json: JSON.stringify(row.query_params, null, 2),
      body_json: row.body_template ? JSON.stringify(row.body_template, null, 2) : '', auth_secret: '', clear_auth_secret: false,
    } : emptyForm);
    setOpen(true);
  };

  const closeModal = () => { setOpen(false); form.resetFields(); setSaveError(''); };

  const saveTool = async (values: HttpToolFormValues) => {
    let payload;
    try { payload = buildHttpToolPayload(values); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Check the request templates.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      if (editing) await updateAiAssistantHttpTool(editing.name, payload);
      else await createAiAssistantHttpTool(payload);
      message.success(editing ? 'Tool updated' : 'Tool created');
      closeModal();
      await loadTools();
    } catch (error) { setSaveError(errorMessage(error, 'Failed to save the tool.')); }
    finally { setSaving(false); }
  };

  const toggleTool = async (row: HttpToolConfig, enabled: boolean) => {
    setBusyName(row.name);
    try { await updateAiAssistantHttpTool(row.name, { enabled }); await loadTools(); }
    catch (error) { message.error(errorMessage(error, 'Failed to update the tool.')); }
    finally { setBusyName(''); }
  };

  const deleteTool = async (row: HttpToolConfig) => {
    setBusyName(row.name);
    try {
      await deleteAiAssistantHttpTool(row.name);
      message.success('Tool removed');
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await loadTools();
    } catch (error) { message.error(errorMessage(error, 'Failed to delete the tool.')); }
    finally { setBusyName(''); }
  };

  return (
    <>
      {contextHolder}
      <Card title="HTTP Tools" extra={<Space wrap>
        <Button onClick={() => void loadTools()} loading={loading}>Refresh</Button>
        {!readonly && <Button type="primary" onClick={() => editTool()}>Add tool</Button>}
      </Space>}>
        <Typography.Paragraph type="secondary">
          Configure external APIs the page assistant can use to investigate alerts. Enabled tools are available on your next message. Each tool requires approval unless you explicitly turn it off.
        </Typography.Paragraph>
        {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
        <Table<HttpToolConfig>
          rowKey="name" loading={loading} dataSource={rows} size="small" scroll={{ x: 950 }}
          locale={{ emptyText: loadError ? 'Tools are unavailable' : 'No HTTP tools configured. Add a tool to get started.' }}
          pagination={{ current: page, pageSize, total: count, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
            onChange: (nextPage, nextSize) => { setPage(nextSize !== pageSize ? 1 : nextPage); setPageSize(nextSize); } }}
          columns={[
            { title: 'Tool', dataIndex: 'name', width: 230, render: (_, row) => <><Typography.Text strong>{row.name}</Typography.Text><div><Typography.Text type="secondary">{row.description}</Typography.Text></div></> },
            { title: 'Request', width: 260, render: (_, row) => <><Tag>{row.method}</Tag><Typography.Text style={{ wordBreak: 'break-all' }}>{row.url}</Typography.Text></> },
            { title: 'Authentication', width: 130, render: (_, row) => row.auth_type === 'none' ? 'None' : <><div>{row.auth_type === 'bearer' ? 'Bearer' : row.auth_header}</div><Typography.Text type={row.has_auth_secret ? 'secondary' : 'warning'}>{row.has_auth_secret ? 'Secret saved' : 'No secret'}</Typography.Text></> },
            { title: 'Approval', width: 120, render: (_, row) => <Tag color={row.requires_approval === false ? 'orange' : 'blue'}>{row.requires_approval === false ? 'Automatic' : 'Required'}</Tag> },
            { title: 'Enabled', width: 80, render: (_, row) => <Switch size="small" aria-label={`Enable ${row.name}`} checked={row.enabled} disabled={readonly || !!busyName} loading={busyName === row.name} onChange={(enabled) => void toggleTool(row, enabled)} /> },
            { title: 'Actions', width: 130, render: (_, row) => <Space><Button size="small" disabled={readonly || !!busyName} onClick={() => editTool(row)}>Edit</Button><Popconfirm title={`Delete ${row.name}?`} description="The assistant will no longer be able to use this tool." onConfirm={() => deleteTool(row)} okText="Delete" okButtonProps={{ danger: true }}><Button size="small" danger disabled={readonly || !!busyName}>Delete</Button></Popconfirm></Space> },
          ]}
        />
      </Card>
      <Modal title={editing ? `Edit tool: ${editing.name}` : 'Add HTTP tool'} open={open} width={800}
        onCancel={closeModal} onOk={() => form.submit()} okText="Save tool" confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} destroyOnClose>
        {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" initialValues={emptyForm} onFinish={(values) => void saveTool(values)} disabled={readonly || saving}>
          <Row gutter={16}>
            <Col xs={24} sm={18}><Form.Item name="name" label="Tool name" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{0,47}$/, message: 'Start with a lowercase letter; use up to 48 lowercase letters, digits or underscores.' }]}><Input disabled={!!editing || readonly || saving} maxLength={48} placeholder="api_lookup" /></Form.Item></Col>
            <Col xs={24} sm={6}><Form.Item name="enabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="When should AI use this tool?" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={1000} rows={2} placeholder="Describe the information returned and when to query it." /></Form.Item>
          <Form.Item name="requires_approval" label="Require approval before each call" valuePropName="checked" extra="When off, AI can call this tool automatically for authorized users. Turn off only for tools you permit to run without confirmation."><Switch /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={5}><Form.Item name="method" label="Method" rules={[{ required: true }]}><Select options={[{ value: 'GET' }, { value: 'POST' }]} /></Form.Item></Col>
            <Col xs={24} sm={19}><Form.Item name="url" label="API URL" rules={[{ required: true }, { pattern: /^https:\/\//, message: 'Use a public HTTPS API URL.' }]} extra="Use {parameter} in the path when needed. Keep the hostname fixed and credentials in Authentication."><Input maxLength={2000} placeholder="https://api.example.com/items/{id}" /></Form.Item></Col>
          </Row>
          <Typography.Text strong>AI input parameters</Typography.Text>
          <Typography.Paragraph type="secondary">AI supplies these values when calling the tool. Reference them as {'{parameter}'} in request templates.</Typography.Paragraph>
          <Form.List name="parameters" rules={[{ validator: async (_, parameters) => {
            if ((parameters || []).length > 20) throw new Error('At most 20 parameters are allowed.');
            const names = (parameters || []).map((parameter: { name?: string }) => parameter?.name).filter(Boolean);
            if (new Set(names).size !== names.length) throw new Error('Parameter names must be unique.');
          } }]}>
            {(fields, { add, remove }, { errors }) => <>
              {fields.map((field) => <Card key={field.key} size="small" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={24} sm={9}><Form.Item name={[field.name, 'name']} label="Parameter" rules={[{ required: true }, { pattern: /^[A-Za-z_][A-Za-z0-9_]{0,47}$/, message: 'Start with a letter or underscore; use letters, digits and underscores.' }]}><Input placeholder="id" maxLength={48} /></Form.Item></Col>
                  <Col xs={12} sm={8}><Form.Item name={[field.name, 'type']} label="Type" rules={[{ required: true }]}><Select options={['string', 'integer', 'number', 'boolean'].map((value) => ({ value }))} /></Form.Item></Col>
                  <Col xs={12} sm={7}><Form.Item name={[field.name, 'required']} label="Required" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>
                <Form.Item name={[field.name, 'description']} label="Description"><Input maxLength={500} placeholder="Explain what AI should provide." /></Form.Item>
                <Button size="small" danger onClick={() => remove(field.name)}>Remove parameter</Button>
              </Card>)}
              <Form.Item><Button disabled={fields.length >= 20 || readonly || saving} onClick={() => add({ name: '', type: 'string', description: '', required: true })}>Add parameter</Button><Form.ErrorList errors={errors} /></Form.Item>
            </>}
          </Form.List>
          <Form.Item name="query_json" label="Query parameters (JSON)" rules={[{ validator: async (_, value) => { parseToolTemplate(value || '{}', 'Query parameters', true); } }]} extra={'Example: {"id":"{id}"}'}><Input.TextArea rows={3} spellCheck={false} maxLength={32768} /></Form.Item>
          {method === 'POST' && <Form.Item name="body_json" label="JSON request body" rules={[{ validator: async (_, value) => { if (value?.trim()) parseToolTemplate(value, 'JSON body'); } }]} extra={'A full placeholder preserves the parameter type, e.g. {"limit":"{limit}"}.'}><Input.TextArea rows={4} spellCheck={false} maxLength={32768} placeholder='{"id":"{id}"}' /></Form.Item>}
          <Row gutter={16}>
            <Col xs={24} sm={16}><Form.Item name="auth_type" label="Authentication"><Select options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer token' }, { value: 'header', label: 'API key in header' }]} /></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="timeout_seconds" label="Timeout (seconds)" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          {authType === 'header' && <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="auth_header" label="Header name" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} placeholder="Key or X-API-Key" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="auth_prefix" label="Value prefix (optional)" extra="Include a trailing space if required, for example: ApiKey "><Input maxLength={40} placeholder="Leave empty for a plain API key" /></Form.Item></Col>
          </Row>}
          {authType !== 'none' && <>
            <Form.Item name="auth_secret" label={editing?.has_auth_secret ? 'Replace saved secret (optional)' : 'API key / token'} extra={editing?.has_auth_secret ? 'Leave blank to keep the saved secret. Changing the URL, method or authentication settings requires a new secret, or disable the tool and clear it.' : 'Stored encrypted on the server. Never included in model input or returned by this form.'}>
              <Input.Password autoComplete="new-password" disabled={clearingSecret || readonly || saving} placeholder={editing?.has_auth_secret ? 'Saved secret is not displayed' : 'Enter the API credential'} />
            </Form.Item>
            {editing?.has_auth_secret && <Form.Item name="clear_auth_secret" valuePropName="checked"><Checkbox onChange={(event) => { if (event.target.checked) form.setFieldValue('auth_secret', ''); }}>Clear saved secret (disable the tool first)</Checkbox></Form.Item>}
          </>}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Use APIs intended for information lookup. Calls send their request to the configured provider using this tool's approval setting.
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
