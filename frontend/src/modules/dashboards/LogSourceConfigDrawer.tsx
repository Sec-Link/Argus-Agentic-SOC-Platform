import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Collapse, Drawer, Form, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography, Upload, message } from 'antd';
import { DeleteOutlined, PlusOutlined, UndoOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ScanAge from './ScanAge';
import {
  createLogSourceCategory,
  deleteLogSourceCategory,
  deleteLogSourceCategoryIcon,
  uploadLogSourceCategoryIcon,
  fetchDiscoveredLogSources,
  fetchLogSourceCategories,
  fetchLogSourceCategoryOptions,
  previewLogSourceMatchers,
  resetLogSourceMappings,
  saveLogSourceMappings,
  updateLogSourceCategory,
} from 'services/dashboards';
import type { DiscoveredLogSource, LogSourceCategory, LogSourceDiscovery, MonitoringPlatform, SplunkCoverageTimeRange } from 'types';
import RescanLogSourcesButton from './RescanLogSourcesButton';
import { COVERAGE_TIME_RANGES, coverageWindowLabel } from './coverageTimeRange';

type Preview = Awaited<ReturnType<typeof previewLogSourceMatchers>>;

const ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ICON_MAX_BYTES = 256 * 1024;

/** Custom category icon: PNG/JPEG/WebP up to 256 KB. The server re-encodes it, so this is only a first filter. */
const CategoryIconField: React.FC<{ category: LogSourceCategory; platform: MonitoringPlatform; onChanged: () => void }> = ({ category, platform, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (!ICON_TYPES.includes(file.type)) {
      message.error('Use a PNG, JPEG or WebP image');
      return false;
    }
    if (file.size > ICON_MAX_BYTES) {
      message.error('Icon must be 256 KB or smaller');
      return false;
    }
    setBusy(true);
    try {
      await uploadLogSourceCategoryIcon(category.id, file, platform);
      message.success('Icon updated');
      onChanged();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to upload icon');
    } finally {
      setBusy(false);
    }
    return false; // we handled the request ourselves
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteLogSourceCategoryIcon(category.id, platform);
      onChanged();
    } catch {
      message.error('Failed to reset icon');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form.Item label="Icon" extra="PNG, JPEG or WebP, up to 256 KB. Shown in the Events flow chart; the default icon is used when none is set.">
      <Space>
        {category.icon ? (
          <img src={category.icon} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <Typography.Text type="secondary">Default</Typography.Text>
        )}
        <Upload accept=".png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={upload} disabled={busy}>
          <Button size="small" icon={<UploadOutlined />} loading={busy}>
            Upload
          </Button>
        </Upload>
        {category.icon && (
          <Button size="small" onClick={remove} disabled={busy}>
            Use default
          </Button>
        )}
      </Space>
    </Form.Item>
  );
};

const CategoryEditor: React.FC<{
  category: LogSourceCategory | null;
  platform: MonitoringPlatform;
  assetTypeOptions: string[];
  onSaved: () => void;
}> = ({ category, platform, assetTypeOptions, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [timeRange, setTimeRange] = useState<SplunkCoverageTimeRange>('7d');

  useEffect(() => {
    form.setFieldsValue({
      name: category?.name ?? '',
      enabled: category?.enabled ?? true,
      matchers: category?.matchers ?? [],
      asset_types: category?.asset_types ?? [],
      host_field: category?.host_field ?? (platform === 'splunk' ? 'host' : 'host.name'),
    });
    setPreview(null);
  }, [category, form, platform]);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (category) await updateLogSourceCategory(category.id, values, platform);
      else {
        await createLogSourceCategory(values, platform);
        form.resetFields();
      }
      message.success('Saved');
      onSaved();
    } catch (err: any) {
      const detail = err?.response?.data;
      message.error(typeof detail === 'object' ? JSON.stringify(detail) : 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const matchers: string[] = form.getFieldValue('matchers') || [];
    if (matchers.length === 0) {
      message.info('Add at least one index pattern first');
      return;
    }
    setTesting(true);
    setPreview(null);
    try {
      setPreview(await previewLogSourceMatchers(matchers, platform, timeRange));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Preview failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!category) return;
    try {
      await deleteLogSourceCategory(category.id, platform);
      onSaved();
    } catch {
      message.error('Failed to delete category');
    }
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={category ? category.name : 'New category'}
      extra={
        category && (
          <Popconfirm title="Delete this category?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={handleDelete}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        )
      }
    >
      <Form form={form} layout="vertical" size="small">
        <Space align="start" style={{ width: '100%' }} size={16}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true }]} style={{ width: 200 }}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        {category ? (
          <CategoryIconField category={category} platform={platform} onChanged={onSaved} />
        ) : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Save the category first, then you can upload a custom icon.
          </Typography.Paragraph>
        )}
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'adv',
              label: 'Advanced: extra index patterns',
              forceRender: true,
              children: (
                <>
                  <Form.Item
                    name="matchers"
                  >
                    <Select mode="tags" disabled={testing} tokenSeparators={[',', ' ']} open={false} placeholder={platform === 'splunk' ? 'main/WinEventLog:*' : 'winlogbeat-*'} />
                  </Form.Item>
                  <Space wrap style={{ marginBottom: 12 }}>
                    {platform === 'splunk' && <Select<SplunkCoverageTimeRange> aria-label="Matcher time range"
                      style={{ width: 140 }} value={timeRange} options={COVERAGE_TIME_RANGES} disabled={testing}
                      onChange={(value) => { setTimeRange(value); setPreview(null); }} />}
                    <Button size="small" onClick={handleTest} loading={testing}>Test match</Button>
                  </Space>
                  {preview && (
                    <div style={{ marginBottom: 12 }}>
                      {!preview.es_available ? (
                        <Typography.Text type="warning">{preview.reason || (platform === 'splunk' ? 'No successful Splunk scan is available.' : 'Elasticsearch is not enabled or not reachable.')}</Typography.Text>
                      ) : preview.indices.length === 0 ? (
                        <Typography.Text type="warning">No matching data ({coverageWindowLabel(preview.window_days ?? 7)}).</Typography.Text>
                      ) : (
                        <Space wrap size={[4, 4]}>
                          {preview.indices.map((i) => (
                            <Tag key={i.index} color="green">{i.index} · {i.docs.toLocaleString()}</Tag>
                          ))}
                        </Space>
                      )}
                      {preview.truncated && <Alert type="warning" showIcon message="Only the busiest sources are included." style={{ marginTop: 8 }} />}
                    </div>
                  )}
                </>
              ),
            },
          ]}
        />
        <Form.Item
          name="asset_types"
          label="CMDB asset types (optional)"
          extra="Hosts of these asset types are expected to send logs; used to compute the per-category host coverage."
        >
          <Select
            mode="tags"
            placeholder="Server, Workstation…"
            options={assetTypeOptions.map((v) => ({ value: v, label: v }))}
          />
        </Form.Item>
        <Form.Item name="host_field" label="Host field in logs">
          <Input placeholder={platform === 'splunk' ? 'host' : 'host.name'} />
        </Form.Item>
        <Button type="primary" size="small" loading={saving} onClick={handleSave}>
          {category ? 'Save' : 'Add category'}
        </Button>
      </Form>
    </Card>
  );
};

type SourceFilter = 'all' | 'unclassified' | 'manual' | 'ignored';

const CONFIDENCE_COLOR: Record<string, string> = { high: 'green', medium: 'gold', none: 'default' };

const isUnclassified = (r: DiscoveredLogSource) => !r.ignored && r.effective_category_id == null;

const SourcesTab: React.FC<{ categories: LogSourceCategory[]; platform: MonitoringPlatform; onChanged: () => void }> = ({ categories, platform, onChanged }) => {
  const [data, setData] = useState<LogSourceDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkTarget, setBulkTarget] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<SplunkCoverageTimeRange>('7d');

  const load = useCallback(() => {
    setLoading(true);
    fetchDiscoveredLogSources(platform)
      .then((res) => { setData(res); setTimeRange(res.time_range || '7d'); })
      .catch(() => message.error('Failed to load log sources'))
      .finally(() => setLoading(false));
  }, [platform]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (keys: string[], value: string) => {
    try {
      if (value === 'auto') await resetLogSourceMappings(keys, platform);
      else {
        const ignored = value === 'ignore';
        await saveLogSourceMappings(
          keys.map((source_key) => ({
            source_key,
            ignored,
            category_id: ignored || value === 'none' ? null : Number(value),
          })), platform,
        );
      }
      setSelected([]);
      setBulkTarget(undefined);
      load();
      onChanged();
    } catch {
      message.error('Failed to save mapping');
    }
  };

  const options = [
    { value: 'auto', label: 'Auto (suggested)' },
    ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    { value: 'none', label: 'Unclassified' },
    { value: 'ignore', label: 'Ignore' },
  ];

  const rowValue = (r: DiscoveredLogSource) =>
    !r.manual ? 'auto' : r.manual.ignored ? 'ignore' : r.manual.category_id == null ? 'none' : String(r.manual.category_id);

  const rows = (data?.sources ?? []).filter((r) => {
    if (filter === 'unclassified' && !isUnclassified(r)) return false;
    if (filter === 'manual' && !r.manual) return false;
    if (filter === 'ignored' && !r.ignored) return false;
    return !search || (r.source_label || r.source_key).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <>
      {data && (!data.es_available || data.reason) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={data.initialized ? 'The previous successful scan is retained' : 'No successful log source scan is available'}
          description={data.reason}
        />
      )}
      {data?.truncated && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Only the busiest sources are listed." />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as SourceFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unclassified', label: 'Unclassified' },
            { value: 'manual', label: 'Manual' },
            { value: 'ignored', label: 'Ignored' },
          ]}
        />
        <Input.Search allowClear placeholder="Search sources" style={{ width: 200 }} onChange={(e) => setSearch(e.target.value)} />
        {platform === 'splunk' && <Select<SplunkCoverageTimeRange> aria-label="Scan time range"
          style={{ width: 140 }} value={timeRange} options={COVERAGE_TIME_RANGES} onChange={setTimeRange} />}
        <RescanLogSourcesButton platform={platform} timeRange={timeRange} onTimeRangeChange={setTimeRange}
          onScanned={(res) => { setData(res); setSelected([]); onChanged(); }} />
        {platform === 'splunk' && data?.initialized && <Typography.Text type="secondary">
          Last scan: {coverageWindowLabel(data.window_days)}
        </Typography.Text>}
        <ScanAge scannedAt={data?.scanned_at} ageSeconds={data?.scan_age_seconds} />
      </Space>
      {selected.length > 0 && (
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text>{selected.length} selected</Typography.Text>
          <Select
            style={{ width: 200 }}
            placeholder="Assign to…"
            value={bulkTarget}
            onChange={setBulkTarget}
            options={options}
          />
          <Button type="primary" disabled={!bulkTarget} onClick={() => bulkTarget && apply(selected, bulkTarget)}>
            Apply
          </Button>
        </Space>
      )}
      <Table<DiscoveredLogSource>
        size="small"
        rowKey="source_key"
        scroll={{ x: 650 }}
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
        columns={[
          {
            title: 'Source',
            dataIndex: 'source_key',
            render: (v: string, r) => (
              <Tooltip title={`${r.index_count} index${r.index_count === 1 ? '' : 'es'}`}>
                <Typography.Text code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{r.source_label || v}</Typography.Text>
              </Tooltip>
            ),
          },
          {
            title: 'Docs',
            dataIndex: 'docs',
            align: 'right',
            sorter: (x, y) => x.docs - y.docs,
            render: (v: number) => v.toLocaleString(),
          },
          {
            title: 'Last seen',
            dataIndex: 'last_seen',
            render: (v: string | null) => (v ? dayjs(v).format('MM-DD HH:mm') : <Typography.Text type="secondary">none</Typography.Text>),
          },
          {
            title: 'Suggested',
            render: (_: unknown, r) => (
              <Tooltip title={r.auto_reason}>
                <Tag color={CONFIDENCE_COLOR[r.auto_confidence]}>{r.auto_category}</Tag>
              </Tooltip>
            ),
          },
          {
            title: 'Category',
            width: 210,
            render: (_: unknown, r) => (
              <Space size={4}>
                <Select
                  size="small"
                  style={{ width: 150 }}
                  value={rowValue(r)}
                  options={options}
                  onChange={(v) => apply([r.source_key], v)}
                />
                {r.manual && (
                  <Tooltip title="Reset to automatic">
                    <Button size="small" type="text" icon={<UndoOutlined />} onClick={() => apply([r.source_key], 'auto')} />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
};

const LogSourceConfigDrawer: React.FC<{ open: boolean; platform: MonitoringPlatform; onClose: () => void; onChanged: () => void }> = ({
  open,
  platform,
  onClose,
  onChanged,
}) => {
  const [categories, setCategories] = useState<LogSourceCategory[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    fetchLogSourceCategories(platform).then(setCategories).catch(() => message.error('Failed to load categories'));
    fetchLogSourceCategoryOptions(platform).then((o) => setAssetTypes(o.asset_types)).catch(() => setAssetTypes([]));
  }, [platform]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSaved = () => {
    setAdding(false);
    load();
    onChanged();
  };

  return (
    <Drawer title="Log source coverage settings" open={open} onClose={onClose} width={820} destroyOnClose>
      <Tabs
        items={[
          {
            key: 'sources',
            label: 'Discovered sources',
            children: <SourcesTab categories={categories} platform={platform} onChanged={onChanged} />,
          },
          {
            key: 'categories',
            label: 'Categories',
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  A category counts as covered when any source mapped to it received data in the scan window. Optionally
                  link CMDB asset types to also measure how many hosts actually send logs.
                </Typography.Paragraph>
                {categories.map((c) => (
                  <CategoryEditor key={c.id} category={c} platform={platform} assetTypeOptions={assetTypes} onSaved={handleSaved} />
                ))}
                {adding ? (
                  <CategoryEditor category={null} platform={platform} assetTypeOptions={assetTypes} onSaved={handleSaved} />
                ) : (
                  <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add category</Button>
                )}
              </>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

export default LogSourceConfigDrawer;
