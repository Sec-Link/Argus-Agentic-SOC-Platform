import React, { useState } from 'react';
import { Alert, Button, Form, Modal, Select, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchLogSourceCategoryOptions, rescanLogSources } from 'services/dashboards';
import type { LogSourceDiscovery, MonitoringPlatform, SplunkCoverageTimeRange } from 'types';
import type { SplunkScanTarget } from '../../api';
import { COVERAGE_TIME_RANGES } from './coverageTimeRange';

const RescanLogSourcesButton: React.FC<{
  platform: MonitoringPlatform;
  onScanned: (result: LogSourceDiscovery) => void;
  timeRange?: SplunkCoverageTimeRange;
  onTimeRangeChange?: (value: SplunkCoverageTimeRange) => void;
}> = ({ platform, onScanned, timeRange, onTimeRangeChange }) => {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Array<{ id: string; name: string; index: string }>>([]);
  const [form] = Form.useForm<SplunkScanTarget>();

  const scan = async (target?: SplunkScanTarget) => {
    setBusy(true);
    setError(null);
    try {
      const result = await rescanLogSources(platform, target);
      onScanned(result);
      if (result.reason) {
        setError(result.reason);
        message.warning(result.reason);
      } else {
        setOpen(false);
        if (result.warnings?.length) message.warning('Log sources re-scanned with warnings.');
        else message.success('Log sources re-scanned');
      }
    } catch (err: any) {
      const detail = err?.response?.data;
      const text = typeof detail?.detail === 'string' ? detail.detail : 'Scan failed. Check the selected integration and index permissions.';
      setError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (platform !== 'splunk') return scan();
    setBusy(true);
    setError(null);
    try {
      const options = await fetchLogSourceCategoryOptions(platform);
      const choices = options.integrations || [];
      setIntegrations(choices);
      const previous = choices.find((i) => i.id === options.targets?.integration_id);
      const selected = previous || choices[0];
      form.setFieldsValue({ integration_id: selected?.id,
        time_range: timeRange ?? options.targets?.time_range ?? '7d',
        indices: previous ? options.targets?.indices || [] : selected?.index ? [selected.index] : [] });
      setOpen(true);
    } catch {
      message.error('Failed to load scan targets');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={start}>Rescan</Button>
    <Modal title="Scan Splunk log sources" forceRender open={open} onCancel={() => !busy && setOpen(false)}
      confirmLoading={busy} okText="Scan" okButtonProps={{ disabled: integrations.length === 0 }}
      onOk={() => form.submit()}>
      {integrations.length === 0 && <Alert type="warning" showIcon message="No Splunk alert collection integration is configured." />}
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" disabled={busy} onFinish={scan}
        onValuesChange={(values) => { if (values.time_range) onTimeRangeChange?.(values.time_range); }}>
        <Form.Item name="integration_id" label="Splunk integration" rules={[{ required: true }]}>
          <Select options={integrations.map((i) => ({ value: i.id, label: i.name }))}
            onChange={(id) => { const index = integrations.find((i) => i.id === id)?.index; form.setFieldValue('indices', index ? [index] : []); }} />
        </Form.Item>
        <Form.Item name="indices" label="Indices" rules={[
          { required: true, type: 'array', min: 1, max: 10 },
          { validator: (_, values: string[]) => !values?.some((v) => !/^[A-Za-z0-9_.-]{1,64}$/.test(v))
            ? Promise.resolve() : Promise.reject(new Error('Use literal index names, without wildcards or SPL.')) },
        ]}>
          <Select mode="tags" tokenSeparators={[',', ' ']} open={false} placeholder="main" />
        </Form.Item>
        <Form.Item name="time_range" label="Time range" rules={[{ required: true }]}>
          <Select options={COVERAGE_TIME_RANGES} />
        </Form.Item>
      </Form>
    </Modal>
  </>;
};

export default RescanLogSourcesButton;
