import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Empty, Form, Input, InputNumber, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag } from 'antd';
import { Code, Power, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { getIsReadonly } from 'lib/auth';
import { listIntegrations } from 'services/integrations';
import {
  compileDetectionRule, deleteSplunkRulePublication, listSplunkRulePublications,
  runSplunkRulePublication, saveSplunkRulePublication,
  type DetectionRuleDetail, type SplunkRuleConfig, type SplunkRulePublication,
} from 'services/detections';

const defaults: SplunkRuleConfig = {
  index: 'main', sourcetype: '', cron_schedule: '*/5 * * * *', lookback_minutes: 15,
  comparator: 'greater than', threshold: 0, digest_mode: true, suppress_seconds: 0,
  webhook_url: '', email_to: [],
};

function errorText(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string') return 'The Splunk request failed.';
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(data)) return data.map(String).join(' ');
    return Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('; ');
  }
  return 'The request failed. Refresh the publication state before retrying.';
}

export default function SplunkRulePanel({ rule, versions, onChanged }: {
  rule: DetectionRuleDetail;
  versions: any[];
  onChanged?: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SplunkRuleConfig>();
  const [integrations, setIntegrations] = useState<Array<{ id: string; name: string }>>([]);
  const [publications, setPublications] = useState<SplunkRulePublication[]>([]);
  const [integrationId, setIntegrationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [readonly, setReadonly] = useState(true);
  const [reload, setReload] = useState(0);
  const publication = publications.find(item => item.integration_id === integrationId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setReadonly(getIsReadonly());
    Promise.all([listIntegrations(), listSplunkRulePublications(rule.id)])
      .then(([items, rows]) => {
        if (!active) return;
        const publishers = items.filter((item: { type: string }) => item.type === 'splunk_rule_publisher');
        setIntegrations(publishers);
        setPublications(rows);
        setIntegrationId(rows[0]?.integration_id || publishers[0]?.id || '');
      })
      .catch(cause => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [rule.id, reload]);

  useEffect(() => {
    form.setFieldsValue({ ...defaults, ...publication?.config });
    setDirty(false);
    setQuery('');
    setError('');
  }, [integrationId, publication, form, rule.version]);

  const run = async (action: 'save' | 'compile' | 'publish' | 'enable' | 'disable' | 'refresh' | 'delete') => {
    setBusy(action);
    setError('');
    try {
      if (action === 'save') {
        const config = await form.validateFields();
        await saveSplunkRulePublication(rule.id, integrationId, config);
      } else if (action === 'compile') {
        const config = await form.validateFields();
        const compiled = await compileDetectionRule(rule.yaml || '', {
          target: 'splunk', splunk_index: config.index, splunk_sourcetype: config.sourcetype,
        });
        setQuery(compiled.splunk || '');
        return;
      } else if (publication) {
        if (action === 'delete') await deleteSplunkRulePublication(rule.id, publication.id);
        else await runSplunkRulePublication(rule.id, publication.id, action, rule.version);
      }
      setPublications(await listSplunkRulePublications(rule.id));
      await onChanged?.();
      message.success(action === 'publish' ? 'Published to Splunk in disabled state.' : 'Splunk publication updated.');
    } catch (cause) {
      if (!(cause && typeof cause === 'object' && 'errorFields' in cause)) setError(errorText(cause));
    } finally {
      setBusy('');
    }
  };

  const disabled = readonly || Boolean(busy) || loading;
  const canEnable = Boolean(publication?.published_version && publication.status === 'synced' &&
    !publication.rule_changed && !publication.config_changed && !dirty && !publication.enabled);

  return <Spin spinning={loading}>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, overflowWrap: 'anywhere' }} />}
    {!loading && !integrations.length ? error ? <Button icon={<RefreshCw size={16} />} onClick={() => setReload(value => value + 1)}>Retry</Button> : <Empty description="No Splunk Rule Publisher configured">
      <Button href="/settings/integrations">Integrations</Button>
    </Empty> : <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="Splunk publisher" placeholder="Splunk publisher" value={integrationId || undefined}
          disabled={Boolean(busy)} onChange={setIntegrationId} style={{ width: 280, maxWidth: '100%' }}
          options={integrations.map(item => ({ value: item.id, label: item.name }))} />
        <Tag>{publication?.status || 'Not configured'}</Tag>
        {publication?.published_version && <Tag color={publication.enabled ? 'green' : 'gold'}>
          {publication.enabled ? 'Enabled' : 'Disabled'} / v{publication.published_version}
        </Tag>}
        {publication && (publication.config_changed || publication.rule_changed) && <Tag color="gold">Unpublished changes</Tag>}
      </Space>
      {publication?.message && <Alert type="warning" showIcon message={publication.message} style={{ marginBottom: 12 }} />}
      {publication && <Descriptions size="small" column={1} style={{ marginBottom: 12, overflowWrap: 'anywhere' }} items={[
        { key: 'remote', label: 'Saved search', children: publication.remote_name },
        { key: 'time', label: 'Last updated', children: publication.updated_at },
      ]} />}
      <Form form={form} layout="vertical" initialValues={defaults} disabled={disabled}
        onValuesChange={() => { setDirty(true); setQuery(''); setError(''); }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0 20px' }}>
          <Form.Item name="index" label="Source index" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_.-]{1,64}$/ }]}><Input /></Form.Item>
          <Form.Item name="sourcetype" label="Sourcetype" rules={[{ pattern: /^[A-Za-z0-9_:.-]{1,100}$/ }]}><Input /></Form.Item>
          <Form.Item name="cron_schedule" label="Cron schedule" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="lookback_minutes" label="Lookback (minutes)" rules={[{ required: true }]}><InputNumber min={1} max={10080} precision={0} /></Form.Item>
          <Form.Item name="comparator" label="Trigger comparison"><Select options={['greater than', 'less than', 'equal to'].map(value => ({ value, label: value }))} /></Form.Item>
          <Form.Item name="threshold" label="Result count" rules={[{ required: true }]}><InputNumber min={0} max={1000000} precision={0} /></Form.Item>
          <Form.Item name="digest_mode" label="Once per search" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="suppress_seconds" label="Suppression (seconds)"><InputNumber min={0} max={86400} precision={0} /></Form.Item>
          <Form.Item name="webhook_url" label="Webhook URL" rules={[{ type: 'url' }]}><Input placeholder="https://receiver.example.com/alerts" /></Form.Item>
          <Form.Item name="email_to" label="Email recipients"><Select mode="tags" tokenSeparators={[',', ';']} /></Form.Item>
        </div>
      </Form>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button icon={<Save size={16} />} disabled={disabled || !integrationId} loading={busy === 'save'} onClick={() => run('save')}>Save Configuration</Button>
        <Button icon={<Code size={16} />} disabled={disabled || !integrationId} loading={busy === 'compile'} onClick={() => run('compile')}>Compile SPL</Button>
        <Popconfirm title="Publish this rule to Splunk in disabled state?" onConfirm={() => run('publish')} disabled={disabled || !publication || dirty}>
          <Button type="primary" icon={<Upload size={16} />} disabled={disabled || !publication || dirty} loading={busy === 'publish'}>Publish to Splunk</Button>
        </Popconfirm>
        <Popconfirm title="Enable this scheduled Splunk alert and its actions?" onConfirm={() => run('enable')} disabled={disabled || !canEnable}>
          <Button icon={<Power size={16} />} disabled={disabled || !canEnable}>Enable</Button>
        </Popconfirm>
        <Button icon={<Power size={16} />} disabled={disabled || !publication || (!publication.published_version && !['pending', 'pending_sync', 'drifted'].includes(publication.status))} onClick={() => run('disable')}>Disable</Button>
        <Button icon={<RefreshCw size={16} />} disabled={disabled || !publication} loading={busy === 'refresh'} onClick={() => run('refresh')}>Refresh Status</Button>
        <Popconfirm title="Delete this Splunk saved search and binding? The Sigma rule will be kept." onConfirm={() => run('delete')} disabled={disabled || !publication}>
          <Button danger icon={<Trash2 size={16} />} disabled={disabled || !publication}>Delete Remote Rule</Button>
        </Popconfirm>
      </Space>
      <Tabs items={[
        { key: 'spl', label: 'SPL', children: <Space direction="vertical" style={{ width: '100%' }}>
          <Tag>{query ? 'Compiled' : 'Last published'}</Tag>
          <Input.TextArea aria-label="Compiled SPL" readOnly rows={12} value={query || publication?.published_query || ''} style={{ fontFamily: 'monospace' }} />
        </Space> },
        { key: 'sigma', label: 'Sigma', children: <Input.TextArea aria-label="Sigma rule" readOnly rows={12} value={rule.yaml} style={{ fontFamily: 'monospace' }} /> },
        { key: 'versions', label: 'Versions', children: <Table rowKey="version" size="small" dataSource={versions} pagination={{ pageSize: 10 }} columns={[
          { title: 'Version', dataIndex: 'version' }, { title: 'Change', dataIndex: 'change_type' },
          { title: 'Author', dataIndex: 'changed_by' }, { title: 'Time', dataIndex: 'created_at' },
        ]} /> },
      ]} />
    </>}
  </Spin>;
}
