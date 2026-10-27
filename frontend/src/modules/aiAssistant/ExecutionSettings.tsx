import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import {
  getAiAssistantExecutionSettings, updateAiAssistantExecutionSettings,
  type AssistantExecutionSettings,
} from 'services/aiAssistant';
import {
  buildExecutionSettings, executionSettingsFormValues, parseExecutionLimit,
  type ExecutionSettingsForm,
} from './executionLimits';

const fields: Array<{ name: keyof AssistantExecutionSettings; label: string; extra: string }> = [
  {
    name: 'execution_timeout_seconds', label: 'Whole-message time limit (seconds)',
    extra: '30–7200 seconds; default 300. Includes the coordinator, specialists, model requests, tool execution and time waiting for approval.',
  },
  {
    name: 'approval_timeout_seconds', label: 'Tool approval waiting time (seconds)',
    extra: '10–1800 seconds; default 90. Each approval must be answered within this time and before the whole-message deadline.',
  },
  {
    name: 'max_iterations', label: 'Model rounds without specialists',
    extra: '1–1000 rounds; default 6. Maximum model calls when no specialist agents are available for the message. Tool calls do not each count as a model round.',
  },
  {
    name: 'coordinator_max_iterations', label: 'Coordinator model-round ceiling',
    extra: '2–1001 rounds; default 101. Caps the coordinator’s model calls. Its actual budget also depends on the available specialists and delegation limits.',
  },
  {
    name: 'max_delegations', label: 'Total specialist assignments per message',
    extra: '1–1000 assignments; default 100. Shared by all specialists, including repeated assignments and failed attempts. Each role also has its own limit in Agents.',
  },
];

function errorMessage(error: any, fallback: string): string {
  if (error?.response?.status === 403) return 'You do not have permission to manage execution limits. Ask an administrator for AI Assistant execution settings permissions.';
  if (error?.response?.status === 401) return 'Your session has expired. Sign in again.';
  const data = error?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (data && typeof data === 'object') {
    const errors = Object.entries(data).flatMap(([field, value]) => {
      const text = Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '';
      return text ? [`${field}: ${text}`] : [];
    });
    if (errors.length) return errors.join(' ');
  }
  return fallback;
}

export default function ExecutionSettings({ readonly = false }: { readonly?: boolean }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ExecutionSettingsForm>();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const loadSequence = useRef(0);

  const loadSettings = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoaded(false);
    setLoadError('');
    setSaveError('');
    try {
      const settings = await getAiAssistantExecutionSettings();
      if (sequence === loadSequence.current) {
        form.setFieldsValue(executionSettingsFormValues(settings));
        setLoaded(true);
      }
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(errorMessage(error, 'Failed to load execution limits. Please retry.'));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void loadSettings();
    return () => { loadSequence.current++; };
  }, [loadSettings]);

  const saveSettings = async (values: ExecutionSettingsForm) => {
    if (readonly || !loaded || loading || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const saved = await updateAiAssistantExecutionSettings(buildExecutionSettings(values));
      form.setFieldsValue(executionSettingsFormValues(saved));
      message.success('Execution limits saved. They apply to new messages.');
    } catch (error) {
      setSaveError(errorMessage(error, 'Failed to save execution limits. Your changes have not been confirmed.'));
    } finally { setSaving(false); }
  };

  return <Card title="Execution limits" extra={<Button onClick={() => void loadSettings()} loading={loading} disabled={saving}>Refresh</Button>}>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Global limits for page assistant conversations"
      description="These settings are saved on the server for all users and apply when a new message starts. Running messages keep their existing limits. Specialist model rounds and assignments are configured separately in Agents." />
    <Typography.Paragraph type="secondary">
      Each model request timeout is configured in Models. Individual HTTP tool timeouts are configured in Tools. Provider and network timeouts may end a request before these execution limits.
    </Typography.Paragraph>
    {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
    {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}
    <Spin spinning={loading}>
      <Form form={form} layout="vertical" disabled={readonly || !loaded || loading || saving} onFinish={(values) => void saveSettings(values)}>
        {fields.map(({ name, label, extra }) => <Form.Item key={name} name={name} label={label} extra={extra} required
          dependencies={name === 'approval_timeout_seconds' ? ['execution_timeout_seconds'] : undefined}
          rules={[{ validator: async (_, value) => {
            const limit = parseExecutionLimit(name, value);
            if (name === 'approval_timeout_seconds') {
              const total = form.getFieldValue('execution_timeout_seconds');
              if (/^[0-9]+$/.test(total) && limit > Number(total)) {
                throw new Error('Approval waiting time cannot exceed the whole-message time limit.');
              }
            }
          } }]}>
          <Input type="text" inputMode="numeric" style={{ maxWidth: 240 }} />
        </Form.Item>)}
        <Form.Item><Space>
          <Button type="primary" htmlType="submit" loading={saving}>Save execution limits</Button>
        </Space></Form.Item>
      </Form>
    </Spin>
  </Card>;
}
