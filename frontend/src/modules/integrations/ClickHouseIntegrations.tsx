import React, { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Switch, message } from 'antd';
import { Download, FlaskConical, Save } from 'lucide-react';
import {
  createIntegration, updateIntegration, testIntegrationById, testClickHouseIntegration, fetchClickHouseIntegrationData,
  type ClickHouseConfig, type ClickHouseField, type ClickHouseIntegration,
  type ClickHouseConnectionTestResult, type ClickHouseFetchResult,
} from 'services/integrations';

type Values = ClickHouseConfig & { name: string };
const defaults: Values = {
  name: 'ClickHouse Alerts', host: '', username: 'default', password: '', database: 'default', table: 'alerts',
  verify_certs: true, lookback_hours: 24,
  field_mapping: { alert_id: 'alert_id', timestamp: 'timestamp', severity: 'severity', message: 'message' },
};
const fields: Array<{ key: ClickHouseField; label: string; required?: boolean }> = [
  { key: 'alert_id', label: 'Alert ID column', required: true },
  { key: 'timestamp', label: 'Timestamp column (DateTime / DateTime64)', required: true },
  { key: 'severity', label: 'Severity column' }, { key: 'message', label: 'Message column' },
  { key: 'title', label: 'Title column' }, { key: 'rule_id', label: 'Rule ID column' },
  { key: 'description', label: 'Description column' }, { key: 'category', label: 'Category column' },
  { key: 'status', label: 'Status column' },
];
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function errorText(cause: any) {
  const data = cause?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (data && typeof data === 'object') return JSON.stringify(data);
  return cause?.code === 'ECONNABORTED' ? 'The request timed out.' : 'The request failed. Check the connection and configuration.';
}

export default function ClickHouseIntegrations({ open, item, items, isReadonly, onClose, onChanged, onSelect }: {
  open: boolean;
  item?: ClickHouseIntegration;
  items: ClickHouseIntegration[];
  isReadonly: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const [form] = Form.useForm<Values>();
  const [saved, setSaved] = useState<ClickHouseIntegration | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'fetch' | null>(null);
  const [batchSize, setBatchSize] = useState(500);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<ClickHouseConnectionTestResult | null>(null);
  const [result, setResult] = useState<ClickHouseFetchResult | null>(null);
  const host = Form.useWatch('host', form);
  const username = Form.useWatch('username', form);
  const verifyCerts = Form.useWatch('verify_certs', form);
  const identityChanged = Boolean(saved && (host?.replace(/\/+$/, '') !== saved.config.host || username !== saved.config.username));

  useEffect(() => {
    if (!open) return;
    setSaved(item || null);
    form.resetFields();
    const mapping = Object.fromEntries(fields.map(field => [field.key,
      (item ? item.config.field_mapping[field.key] : defaults.field_mapping[field.key]) || '',
    ]));
    form.setFieldsValue({ ...defaults, ...item?.config, field_mapping: mapping, name: item?.name || defaults.name, password: '' });
    setDirty(false);
    setError('');
    setConnection(null);
    setResult(null);
  }, [open, item, form]);

  const run = async (action: 'save' | 'test' | 'fetch') => {
    let values: Values;
    try { values = await form.validateFields(); } catch { return; }
    const { name, ...config } = values;
    const body = { name: name.trim(), type: 'clickhouse', config };
    setBusy(action);
    setError('');
    try {
      if (action === 'save') {
        const next: ClickHouseIntegration = saved?.id ? await updateIntegration(saved.id, body) : await createIntegration(body);
        setSaved(next);
        form.setFieldsValue({ password: '' });
        setDirty(false);
        await onChanged();
        onSelect(next.id);
        message.success('ClickHouse configuration saved.');
      } else if (action === 'test') {
        setConnection(null);
        const next = saved?.id ? await testIntegrationById(saved.id, { config }, 65000) : await testClickHouseIntegration(config);
        if (!next.ok) throw new Error('Connection failed');
        setConnection(next);
      } else if (saved?.id && !dirty) {
        setResult(null);
        setResult(await fetchClickHouseIntegrationData(saved.id, batchSize));
      }
    } catch (cause: any) {
      setError(errorText(cause));
      if (action === 'fetch' && cause?.response?.data?.fetched !== undefined) setResult(cause.response.data);
    } finally {
      setBusy(null);
    }
  };

  return <Modal open={open} title="ClickHouse Alerts" width={640} onCancel={busy ? undefined : onClose}
    maskClosable={!busy} footer={[
      <Button key="close" onClick={onClose} disabled={Boolean(busy)}>Close</Button>,
      <Button key="test" icon={<FlaskConical size={16} />} onClick={() => run('test')} loading={busy === 'test'} disabled={isReadonly || Boolean(busy)}>Test Connection</Button>,
      <Button key="fetch" icon={<Download size={16} />} onClick={() => run('fetch')} loading={busy === 'fetch'} disabled={isReadonly || !saved?.id || dirty || Boolean(busy)}>Fetch Data</Button>,
      <Button key="save" type="primary" icon={<Save size={16} />} onClick={() => run('save')} loading={busy === 'save'} disabled={isReadonly || Boolean(busy)}>Save Configuration</Button>,
    ]}>
    <Select aria-label="ClickHouse configuration" value={item?.id || 'new'} disabled={Boolean(busy)} onChange={onSelect}
      style={{ width: '100%', marginBottom: 16 }} options={[{ value: 'new', label: 'New connection' }, ...items.map(i => ({ value: i.id, label: i.name }))]} />
    <Form form={form} layout="vertical" initialValues={defaults} disabled={isReadonly || Boolean(busy)}
      onValuesChange={() => { setDirty(true); setConnection(null); setResult(null); setError(''); }}>
      <Form.Item name="name" label="Integration name" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item>
      <Form.Item name="host" label="HTTP API URL" rules={[{ required: true }, { type: 'url' }]}><Input placeholder="https://clickhouse.example.com:8443" /></Form.Item>
      <Form.Item name="username" label="Username" rules={[{ required: true, whitespace: true }, { max: 256 }]}><Input autoComplete="off" /></Form.Item>
      <Form.Item name="password" label="Password" rules={[{ required: identityChanged && Boolean(saved?.config.password_configured) }]}>
        <Input.Password autoComplete="new-password" placeholder={saved?.config.password_configured && !identityChanged ? 'Configured; leave blank to keep' : ''} />
      </Form.Item>
      <Form.Item name="verify_certs" label="Verify TLS certificate" valuePropName="checked"><Switch /></Form.Item>
      {verifyCerts === false && <Alert type="warning" showIcon message="TLS certificate verification is disabled." style={{ marginBottom: 16 }} />}
      <Form.Item name="database" label="Database" rules={[{ required: true }, { pattern: identifier }]}><Input /></Form.Item>
      <Form.Item name="table" label="Alert table" rules={[{ required: true }, { pattern: identifier }, {
        validator: (_, value) => `${form.getFieldValue('database') || ''}.${value || ''}`.length <= 64
          ? Promise.resolve() : Promise.reject(new Error('Database.table must not exceed 64 characters.')),
      }]} dependencies={['database']}><Input /></Form.Item>
      <Space size={24} wrap align="start">
        <Form.Item name="lookback_hours" label="Lookback (hours)" rules={[{ required: true }]}><InputNumber min={1} max={168} precision={0} /></Form.Item>
        <Form.Item label="Batch size"><InputNumber min={1} max={1000} precision={0} value={batchSize} onChange={value => setBatchSize(value || 500)} /></Form.Item>
      </Space>
      <Collapse defaultActiveKey={['mapping']} items={[{ key: 'mapping', label: 'Alert field mapping', children: fields.map(field =>
        <Form.Item key={field.key} name={['field_mapping', field.key]} label={field.label}
          rules={[{ required: field.required }, { pattern: identifier, message: 'Enter one literal column name (up to 63 characters).' }]}>
          <Input placeholder={field.required ? field.key : 'Not mapped'} />
        </Form.Item>) }]} />
    </Form>
    {error && <Alert type="error" showIcon message={error} style={{ marginTop: 16, overflowWrap: 'anywhere' }} />}
    {connection && <Descriptions title="Connection succeeded" size="small" column={1} style={{ marginTop: 16 }} items={[
      { key: 'status', label: 'HTTP status', children: connection.status },
      { key: 'version', label: 'Version', children: connection.server_info.version },
    ]} />}
    {result && <Descriptions title="Fetch result" size="small" column={2} style={{ marginTop: 16 }} items={[
      { key: 'fetched', label: 'Fetched', children: result.fetched }, { key: 'inserted', label: 'Inserted', children: result.inserted },
      { key: 'updated', label: 'Updated', children: result.updated }, { key: 'skipped', label: 'Skipped', children: result.skipped },
    ]} />}
    {result?.limit_reached && <Alert type="warning" showIcon message="Batch limit reached." style={{ marginTop: 12 }} />}
  </Modal>;
}
