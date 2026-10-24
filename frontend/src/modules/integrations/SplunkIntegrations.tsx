import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Switch, message } from 'antd';
import { Download, FlaskConical, Save } from 'lucide-react';
import {
  createIntegration, updateIntegration, testIntegrationById, testSplunkIntegration,
  fetchSplunkIntegrationData, type SplunkConnectionTestResult, type SplunkFetchResult,
} from 'services/integrations';

type Values = {
  name: string;
  host: string;
  index: string;
  auth_type: 'basic' | 'token';
  username?: string;
  password?: string;
  token?: string;
  verify_certs: boolean;
  lookback_hours: number;
};

const initialValues: Values = {
  name: 'Splunk Alerts', host: '', index: 'main', auth_type: 'basic',
  username: '', password: '', token: '', verify_certs: true, lookback_hours: 24,
};

function errorText(error: any): string {
  const data = error?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (data && typeof data === 'object') return JSON.stringify(data);
  if (error?.code === 'ECONNABORTED') return 'The request timed out.';
  return 'The request failed. Check your connection and configuration.';
}

export default function SplunkIntegrations({ open, item, isReadonly, onClose, onChanged }: {
  open: boolean;
  item?: any;
  isReadonly: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const authType = Form.useWatch('auth_type', form);
  const verifyCerts = Form.useWatch('verify_certs', form);
  const [saved, setSaved] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'fetch' | null>(null);
  const [batchSize, setBatchSize] = useState(500);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<SplunkConnectionTestResult | null>(null);
  const [result, setResult] = useState<SplunkFetchResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaved(item || null);
    form.resetFields();
    form.setFieldsValue({ ...initialValues, ...item?.config, name: item?.name || initialValues.name, password: '', token: '' });
    setDirty(false);
    setError('');
    setConnection(null);
    setResult(null);
  }, [open, item, form]);

  const payload = async () => {
    const values = await form.validateFields();
    const { name, ...config } = values;
    return { name: name.trim(), type: 'splunk_search', config };
  };

  const run = async (action: 'save' | 'test' | 'fetch') => {
    let body: Awaited<ReturnType<typeof payload>>;
    try {
      body = await payload();
    } catch {
      return;
    }
    setBusy(action);
    setError('');
    try {
      if (action === 'save') {
        const next = saved?.id ? await updateIntegration(saved.id, body) : await createIntegration(body);
        setSaved(next);
        form.setFieldsValue({ password: '', token: '' });
        setDirty(false);
        await onChanged();
        message.success('Splunk configuration saved.');
      } else if (action === 'test') {
        setConnection(null);
        const next: SplunkConnectionTestResult = saved?.id
          ? await testIntegrationById(saved.id, { config: body.config }, 45000)
          : await testSplunkIntegration(body.config);
        if (!next.ok) throw new Error('Connection failed');
        setConnection(next);
      } else if (saved?.id && !dirty) {
        setResult(null);
        setResult(await fetchSplunkIntegrationData(saved.id, batchSize));
      }
    } catch (cause: any) {
      setError(errorText(cause));
      if (action === 'fetch' && cause?.response?.data?.fetched !== undefined) setResult(cause.response.data);
    } finally {
      setBusy(null);
    }
  };

  const credentialConfigured = saved?.config?.auth_type === authType;
  const canKeepPassword = credentialConfigured && saved?.config?.password_configured;
  const canKeepToken = credentialConfigured && saved?.config?.token_configured;

  return (
    <Modal open={open} title="Splunk Alerts" width={640} onCancel={busy ? undefined : onClose} maskClosable={!busy}
      footer={[
        <Button key="close" onClick={onClose} disabled={Boolean(busy)}>Close</Button>,
        <Button key="test" icon={<FlaskConical size={16} />} onClick={() => run('test')} loading={busy === 'test'} disabled={isReadonly || Boolean(busy)}>Test Connection</Button>,
        <Button key="fetch" icon={<Download size={16} />} onClick={() => run('fetch')} loading={busy === 'fetch'} disabled={isReadonly || !saved?.id || dirty || Boolean(busy)}>Fetch Data</Button>,
        <Button key="save" type="primary" icon={<Save size={16} />} onClick={() => run('save')} loading={busy === 'save'} disabled={isReadonly || Boolean(busy)}>Save Configuration</Button>,
      ]}>
      <Form form={form} layout="vertical" initialValues={initialValues} disabled={isReadonly || Boolean(busy)}
        onValuesChange={() => { setDirty(true); setConnection(null); setResult(null); setError(''); }}>
        <Form.Item name="name" label="Integration name" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item>
        <Form.Item name="host" label="Management API URL" rules={[{ required: true }, { type: 'url' }]}><Input placeholder="https://splunk.example.com:8089" /></Form.Item>
        <Form.Item name="auth_type" label="Authentication"><Select options={[{ value: 'basic', label: 'Username / Password' }, { value: 'token', label: 'Splunk management token' }]} /></Form.Item>
        {authType === 'token' ? (
          <Form.Item name="token" label="Token" rules={[{ required: !canKeepToken }]}><Input.Password autoComplete="new-password" placeholder={canKeepToken ? 'Configured; leave blank to keep' : ''} /></Form.Item>
        ) : (
          <>
            <Form.Item name="username" label="Username" rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" /></Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: !canKeepPassword }]}><Input.Password autoComplete="new-password" placeholder={canKeepPassword ? 'Configured; leave blank to keep' : ''} /></Form.Item>
          </>
        )}
        <Form.Item name="verify_certs" label="Verify TLS certificate" valuePropName="checked"><Switch /></Form.Item>
        {verifyCerts === false && <Alert type="warning" showIcon message="TLS certificate verification is disabled." style={{ marginBottom: 16 }} />}
        <Form.Item name="index" label="Alert index" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_.-]{1,64}$/, message: 'Enter one literal index name (up to 64 characters).' }]}><Input placeholder="main" /></Form.Item>
        <Space size={24} wrap align="start">
          <Form.Item name="lookback_hours" label="Lookback (hours)" rules={[{ required: true }]}><InputNumber min={1} max={168} precision={0} /></Form.Item>
          <Form.Item label="Batch size"><InputNumber min={1} max={1000} precision={0} value={batchSize} onChange={(value) => setBatchSize(value || 500)} /></Form.Item>
        </Space>
      </Form>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, overflowWrap: 'anywhere' }} />}
      {connection && <Descriptions title="Connection succeeded" size="small" column={1} items={[
        { key: 'status', label: 'HTTP status', children: connection.status },
        { key: 'version', label: 'Version', children: connection.server_info.version || 'Not reported' },
        { key: 'build', label: 'Build', children: connection.server_info.build || 'Not reported' },
        { key: 'product', label: 'Product', children: connection.server_info.product_type || 'Not reported' },
      ]} />}
      {result && <Descriptions title="Fetch result" size="small" column={2} items={[
        { key: 'fetched', label: 'Fetched', children: result.fetched },
        { key: 'inserted', label: 'Inserted', children: result.inserted },
        { key: 'updated', label: 'Updated', children: result.updated },
        { key: 'skipped', label: 'Skipped', children: result.skipped },
      ]} />}
      {result?.limit_reached && <Alert type="warning" showIcon message="Batch limit reached." style={{ marginTop: 12 }} />}
    </Modal>
  );
}
