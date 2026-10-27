import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import { createModelProfile, deleteModelProfile, listModelProfiles, testModelProfile, updateModelProfile, type ModelProfile } from 'services/aiAssistant';
import { parseModelCurrency, parseModelPrice } from './modelPricing';

type ModelForm = {
  name: string; model: string; base_url: string; timeout_seconds: string; enabled: boolean; api_key?: string; clear_api_key?: boolean;
  input_price_per_million: string; output_price_per_million: string; cached_input_price_per_million: string; currency: string;
};

function errorMessage(error: any): string {
  if (error?.response?.status === 403) return 'You do not have permission to manage model configurations.';
  if (error?.response?.status === 401) return 'Your session has expired. Sign in again.';
  const data = error?.response?.data;
  if (data && typeof data === 'object') {
    const details = Object.entries(data).flatMap(([field, value]) => {
      const text = Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '';
      return text ? [`${field}: ${text}`] : [];
    });
    if (details.length) return details.join(' ');
  }
  return 'Could not complete the model configuration request. Refresh and try again.';
}

export default function ModelSettings({ readonly = false }: { readonly?: boolean }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ModelForm>();
  const [rows, setRows] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [testingId, setTestingId] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setLoaded(false);
    try {
      const result = await listModelProfiles();
      if (current === sequence.current) { setRows(result.results); setLoaded(true); }
    } catch (err) { if (current === sequence.current) setError(errorMessage(err)); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const close = () => { setOpen(false); form.resetFields(); setSaveError(''); };
  const edit = (row?: ModelProfile) => {
    form.resetFields(); setEditing(row || null); setSaveError('');
    form.setFieldsValue(row ? { name: row.name, model: row.model, base_url: row.base_url,
      timeout_seconds: String(row.timeout_seconds), enabled: row.enabled, api_key: '', clear_api_key: false,
      input_price_per_million: row.input_price_per_million ?? '', output_price_per_million: row.output_price_per_million ?? '',
      cached_input_price_per_million: row.cached_input_price_per_million ?? '', currency: row.currency || 'USD' }
      : { name: '', model: '', base_url: '', timeout_seconds: '45', enabled: false, api_key: '', clear_api_key: false,
        input_price_per_million: '', output_price_per_million: '', cached_input_price_per_million: '', currency: 'USD' });
    setOpen(true);
  };
  const save = async (values: ModelForm) => {
    if (readonly || saving) return;
    setSaving(true); setSaveError('');
    try {
      const payload = {
        name: values.name, model: values.model, base_url: values.base_url, enabled: values.enabled,
        timeout_seconds: Number(values.timeout_seconds), api_key: values.api_key || undefined,
        clear_api_key: values.clear_api_key || false,
        input_price_per_million: parseModelPrice(values.input_price_per_million),
        output_price_per_million: parseModelPrice(values.output_price_per_million),
        cached_input_price_per_million: parseModelPrice(values.cached_input_price_per_million),
        currency: parseModelCurrency(values.currency),
      };
      if (editing) await updateModelProfile(editing.id, payload);
      else await createModelProfile(payload);
      message.success('Model saved. Enabled models can be selected in chat.'); close(); await load();
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { setSaving(false); }
  };
  const change = async (row: ModelProfile, enabled: boolean) => {
    setBusyId(row.id);
    try { await updateModelProfile(row.id, { enabled }); await load(); }
    catch (err) { message.error(errorMessage(err)); }
    finally { setBusyId(''); }
  };
  const remove = async (row: ModelProfile) => {
    setBusyId(row.id);
    try { await deleteModelProfile(row.id); await load(); }
    catch (err) { message.error(errorMessage(err)); }
    finally { setBusyId(''); }
  };
  const test = async (row: ModelProfile) => {
    setBusyId(row.id); setTestingId(row.id);
    try { await testModelProfile(row.id); message.success(`Connected (${row.model})`); }
    catch (err) { message.error(errorMessage(err)); }
    finally { setBusyId(''); setTestingId(''); }
  };
  return <>
    <Card title="Models" extra={<Space>
      <Button onClick={() => void load()} loading={loading} disabled={!!busyId}>Refresh</Button>
      <Button type="primary" disabled={readonly || !!busyId || !loaded || loading || rows.length >= 50} onClick={() => edit()}>Add model</Button>
    </Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Shared model configurations"
        description="API keys are encrypted on the server and never returned to the browser. Save a model before testing its connection; disabled models can also be tested. Enabled models are available to chat users. Switching models keeps the conversation history and applies to the next message, including its coordinator and specialists." />
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<ModelProfile> rowKey="id" dataSource={rows} loading={loading} size="small" scroll={{ x: 800 }} pagination={{ pageSize: 10 }}
        locale={{ emptyText: error ? 'Models unavailable' : 'No models configured. Add and enable a model to select it in chat.' }}
        columns={[
          { title: 'Name', dataIndex: 'name' }, { title: 'Model ID', dataIndex: 'model' },
          { title: 'Base URL', dataIndex: 'base_url', ellipsis: true },
          { title: 'Request timeout', render: (_, row) => `${row.timeout_seconds}s` },
          { title: 'Price / 1M tokens', render: (_, row) => <span>
            {row.currency} · Input {row.input_price_per_million ?? 'Not set'} / Output {row.output_price_per_million ?? 'Not set'}
          </span> },
          { title: 'API key', render: (_, row) => <Tag color={row.has_api_key ? 'green' : 'default'}>{row.has_api_key ? 'Saved' : 'Not configured'}</Tag> },
          { title: 'Enabled', render: (_, row) => <Switch checked={row.enabled} loading={busyId === row.id} disabled={readonly || !!busyId || loading} aria-label={`Enable model ${row.name}`} onChange={(value) => void change(row, value)} /> },
          { title: 'Actions', render: (_, row) => <Space>
            <Button size="small" loading={testingId === row.id} disabled={readonly || !!busyId || loading || !row.has_api_key} onClick={() => void test(row)}>Test</Button>
            <Button size="small" disabled={readonly || !!busyId || loading} onClick={() => edit(row)}>Edit</Button>
            <Popconfirm title={`Delete ${row.name}?`} description="Existing conversation history is retained. Choose another model to continue." onConfirm={() => remove(row)} okButtonProps={{ danger: true }}>
              <Button size="small" danger disabled={readonly || !!busyId || loading}>Delete</Button>
            </Popconfirm>
          </Space> },
        ]} />
    </Card>
    <Modal title={editing ? `Edit model: ${editing.name}` : 'Add model'} open={open} width={640} destroyOnClose
      onCancel={() => { if (!saving) close(); }} onOk={() => form.submit()} confirmLoading={saving} okButtonProps={{ disabled: readonly }}>
      <Form<ModelForm> form={form} layout="vertical" disabled={readonly || saving} onFinish={(values) => void save(values)}>
        {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 12 }} />}
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }, { max: 120 }]}><Input maxLength={120} placeholder="Display name in chat" /></Form.Item>
        <Form.Item label="Model ID" name="model" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input maxLength={200} placeholder="Exact model ID from your provider" /></Form.Item>
        <Form.Item label="Base URL" name="base_url" rules={[{ required: true }, { type: 'url' }]} extra="Use an OpenAI-compatible API endpoint. Changing this URL requires entering the API key again."><Input maxLength={2000} placeholder="https://provider.example/v1" /></Form.Item>
        <Form.Item label="API key" name="api_key" extra={editing?.has_api_key ? 'Leave blank to keep the saved key. It cannot be viewed or copied back.' : 'Add a key before enabling this model.'}>
          <Input.Password autoComplete="new-password" maxLength={4096} />
        </Form.Item>
        {editing?.has_api_key && <Form.Item name="clear_api_key" valuePropName="checked"><Checkbox>Clear saved API key (disable the model first)</Checkbox></Form.Item>}
        <Form.Item label="Model request timeout (seconds)" name="timeout_seconds" extra="1–120 seconds per model request. Whole-message limits are managed in Execution limits."
          rules={[{ validator: async (_, value) => { if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 120) throw new Error('Enter a whole number from 1 to 120.'); } }]}>
          <Input inputMode="numeric" />
        </Form.Item>
        <Form.Item label="Enabled" name="enabled" valuePropName="checked"><Switch /></Form.Item>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Estimated usage costs"
          description="Enter your provider's prices per million tokens. Prices are saved with each new model call, so later changes do not alter past estimates. Blank prices mean cost is unavailable; zero means free. Estimates are not provider invoices." />
        <Form.Item label="Currency" name="currency" normalize={(value: string) => value.toUpperCase()} rules={[{ validator: async (_, value) => { parseModelCurrency(value); } }]}>
          <Input maxLength={3} placeholder="USD" />
        </Form.Item>
        <Form.Item label="Input price / 1M tokens" name="input_price_per_million" rules={[{ validator: async (_, value) => { parseModelPrice(value); } }]}>
          <Input inputMode="decimal" placeholder="Not configured" />
        </Form.Item>
        <Form.Item label="Output price / 1M tokens" name="output_price_per_million" rules={[{ validator: async (_, value) => { parseModelPrice(value); } }]}>
          <Input inputMode="decimal" placeholder="Not configured" />
        </Form.Item>
        <Form.Item label="Cached input price / 1M tokens" name="cached_input_price_per_million"
          extra="Required to estimate calls with cached tokens. If the provider omits cache usage and this price differs from the input price, cost remains unavailable."
          rules={[{ validator: async (_, value) => { parseModelPrice(value); } }]}>
          <Input inputMode="decimal" placeholder="Not configured" />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}
