import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  createInterfaceEndpoint,
  deleteInterfaceEndpoint,
  getInterfaceEndpointLogs,
  listInterfaceEndpoints,
  testInterfaceEndpoint,
  updateInterfaceEndpoint,
} from 'services/interfaces';
import type { InterfaceEndpoint, InterfaceRequestLog } from 'services/interfaces';
import { useGuide } from 'components/layout/useGuide';
import type { GuideStep } from 'components/layout/useGuide';

const { Paragraph, Text } = Typography;

const formatDate = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

const getEndpointUrl = (record: InterfaceEndpoint) => {
  if (record.ingest_url) return record.ingest_url;
  return `/api/v1/interfaces/endpoints/${record.id}/ingest/`;
};

const GUIDE_STEPS: GuideStep[] = [
  {
    selector: '[data-tour="if-card"]',
    title: '1. Inbound interfaces',
    description: 'Interfaces are API or Webhook endpoints that let external systems send events into the platform.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="if-filters"]',
    title: '2. Find an interface',
    description: 'Search by keyword or filter by type (API or Webhook). Refresh reloads the list.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="if-create"]',
    title: '3. Create an interface',
    description: 'Click Create Interface to set a name, type and an optional HMAC secret for signature verification.',
    placement: 'bottomRight',
  },
  {
    selector: '[data-tour="if-table"]',
    title: '4. Your interfaces',
    description: 'Each row shows the endpoint URL (copyable), an enable switch, and when it was created and last received an event.',
    placement: 'top',
  },
  {
    selector: '[data-tour="if-actions"]',
    title: '5. Row actions',
    description: 'Edit the interface, Copy URL, open request Logs, send a Test request, or Delete it.',
    placement: 'left',
  },
  {
    selector: '[data-tour="if-examples"]',
    title: '6. Request code examples',
    description: 'Copy ready-made cURL, Python or JavaScript snippets to send data to the selected interface.',
    placement: 'top',
  },
];

export default function Interfaces() {
  const guide = useGuide(GUIDE_STEPS);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InterfaceEndpoint[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'api' | 'webhook'>('all');

  const [form] = Form.useForm();
  const [editing, setEditing] = useState<InterfaceEndpoint | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<InterfaceRequestLog[]>([]);
  const [logsFor, setLogsFor] = useState<InterfaceEndpoint | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listInterfaceEndpoints({
        interface_type: typeFilter === 'all' ? undefined : typeFilter,
        search: query || undefined,
      });
      setItems(Array.isArray(data) ? data : []);
    } catch {
      message.error('Failed to load interfaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => items, [items]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      description: '',
      interface_type: 'webhook',
      is_active: true,
      hmac_secret: '',
    });
    setModalOpen(true);
  };

  const openEdit = (record: InterfaceEndpoint) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description || '',
      interface_type: record.interface_type,
      is_active: record.is_active,
      hmac_secret: record.hmac_secret || '',
    });
    setModalOpen(true);
  };

  const saveEndpoint = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await updateInterfaceEndpoint(editing.id, values);
        message.success('Interface updated');
      } else {
        await createInterfaceEndpoint(values);
        message.success('Interface created');
      }
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) message.error('Failed to save interface');
    }
  };

  const toggleActive = async (record: InterfaceEndpoint, checked: boolean) => {
    try {
      await updateInterfaceEndpoint(record.id, { is_active: checked });
      setItems((prev) => prev.map((item) => (item.id === record.id ? { ...item, is_active: checked } : item)));
      message.success(checked ? 'Enabled' : 'Disabled');
    } catch {
      message.error('Failed to update status');
    }
  };

  const copyUrl = async (record: InterfaceEndpoint) => {
    const url = getEndpointUrl(record);
    try {
      await navigator.clipboard.writeText(url);
      message.success('Endpoint URL copied');
    } catch {
      message.error('Failed to copy URL');
    }
  };

  const openLogs = async (record: InterfaceEndpoint) => {
    setLogsFor(record);
    setLogsOpen(true);
    try {
      const data = await getInterfaceEndpointLogs(record.id);
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setLogs([]);
      message.error('Failed to load logs');
    }
  };

  const runTest = async (record: InterfaceEndpoint) => {
    try {
      await testInterfaceEndpoint(record.id, { event: 'ui_test', source: 'interface_page' });
      message.success('Test request sent');
      await loadData();
    } catch {
      message.error('Failed to test interface');
    }
  };

  const removeEndpoint = async (record: InterfaceEndpoint) => {
    try {
      await deleteInterfaceEndpoint(record.id);
      message.success('Interface deleted');
      await loadData();
    } catch {
      message.error('Failed to delete interface');
    }
  };

  const columns: ColumnsType<InterfaceEndpoint> = [
    {
      title: 'Name / Description',
      key: 'name',
      render: (_, record) => (
        <div>
          <Text strong>{record.name}</Text>
          <div style={{ color: '#888', fontSize: 12 }}>{record.description || '-'}</div>
        </div>
      ),
    },
    {
      title: 'Endpoint URL',
      key: 'ingest_url',
      render: (_, record) => (
        <Paragraph copyable={{ text: getEndpointUrl(record) }} ellipsis={{ rows: 1 }} style={{ marginBottom: 0, maxWidth: 360 }}>
          {getEndpointUrl(record)}
        </Paragraph>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Switch checked={record.is_active} onChange={(checked) => toggleActive(record, checked)} />
      ),
    },
    {
      title: 'Time',
      key: 'time',
      width: 240,
      render: (_, record) => (
        <div>
          <div style={{ fontSize: 12 }}>Created: {formatDate(record.created_at)}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Last event: {formatDate(record.last_event_at)}</div>
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 350,
      render: (_, record) => (
        <Space wrap data-tour={filtered[0]?.id === record.id ? 'if-actions' : undefined}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            Edit
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyUrl(record)}>
            Copy URL
          </Button>
          <Button size="small" icon={<UnorderedListOutlined />} onClick={() => openLogs(record)}>
            Logs
          </Button>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => runTest(record)}>
            Test
          </Button>
          <Popconfirm title="Delete this interface?" onConfirm={() => removeEndpoint(record)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const selectedForExamples = logsFor || filtered[0] || null;

  return (
    <Card
      data-tour="if-card"
      title="Interface Management"
      extra={
        <Space data-tour="if-filters">
          <Input.Search
            allowClear
            placeholder="Search keywords"
            onSearch={(value) => {
              setQuery(value.trim());
              setTimeout(loadData, 0);
            }}
            style={{ width: 240 }}
          />
          <Select
            value={typeFilter}
            style={{ width: 130 }}
            onChange={(value: 'all' | 'api' | 'webhook') => {
              setTypeFilter(value);
              setTimeout(loadData, 0);
            }}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'api', label: 'API' },
              { value: 'webhook', label: 'Webhook' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadData}>
            Refresh
          </Button>
          <Button data-tour="if-create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Create Interface
          </Button>
        </Space>
      }
    >
      <Table data-tour="if-table" rowKey="id" loading={loading} columns={columns} dataSource={filtered} pagination={{ pageSize: 10 }} />

      <Card data-tour="if-examples" size="small" title="Request Code Examples" style={{ marginTop: 16 }}>
        {!selectedForExamples ? (
          <Text type="secondary">Create an interface to see request examples.</Text>
        ) : (
          <Tabs
            defaultActiveKey="curl"
            items={[
              {
                key: 'curl',
                label: 'cURL',
                children: <pre style={{ margin: 0 }}>{selectedForExamples.code_examples?.curl || '-'}</pre>,
              },
              {
                key: 'python',
                label: 'Python',
                children: <pre style={{ margin: 0 }}>{selectedForExamples.code_examples?.python || '-'}</pre>,
              },
              {
                key: 'javascript',
                label: 'JavaScript',
                children: <pre style={{ margin: 0 }}>{selectedForExamples.code_examples?.javascript || '-'}</pre>,
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title={editing ? 'Edit Interface' : 'Create Interface'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={saveEndpoint}
        okText="Save"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Please input name' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="interface_type" label="Type" rules={[{ required: true }]}>
            <Select options={[{ value: 'api', label: 'API' }, { value: 'webhook', label: 'Webhook' }]} />
          </Form.Item>
          <Form.Item name="hmac_secret" label="HMAC Secret (optional)">
            <Input.Password placeholder="Optional, enables signature verification" />
          </Form.Item>
          <Form.Item name="is_active" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={logsFor ? `Request Logs - ${logsFor.name}` : 'Request Logs'}
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        width={720}
      >
        <Table
          rowKey="id"
          dataSource={logs}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Time', dataIndex: 'created_at', width: 180, render: (v) => formatDate(v) },
            { title: 'Method', dataIndex: 'method', width: 90 },
            {
              title: 'Status',
              dataIndex: 'response_status',
              width: 100,
              render: (v) => <Tag color={v >= 200 && v < 300 ? 'green' : 'red'}>{v}</Tag>,
            },
            { title: 'Source IP', dataIndex: 'source_ip', width: 130, render: (v) => v || '-' },
            {
              title: 'Request Body',
              dataIndex: 'request_body',
              render: (v) => <pre style={{ margin: 0 }}>{JSON.stringify(v || {}, null, 2)}</pre>,
            },
          ]}
        />
      </Drawer>
      {guide}
    </Card>
  );
}

