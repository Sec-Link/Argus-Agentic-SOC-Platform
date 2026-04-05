import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Modal, Form,
  Upload, message, Space, Select, Checkbox,
  Popconfirm, Drawer, Dropdown
} from 'antd';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined,
  EditOutlined, SearchOutlined, SettingOutlined,
  ReloadOutlined, DownloadOutlined
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import {
  fetchAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  importAssets,
  exportAssets,
  fetchAssetColumns,
  createAssetColumn,
  deleteAssetColumn,
} from 'services/cmdb';

const { Option } = Select;

export default function AssetList() {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [columnsDef, setColumnsDef] = useState<any[]>([]);

  // Pagination
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [columnForm] = Form.useForm();

  // Excel Import
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const colRes = await fetchAssetColumns();
      setColumnsDef(colRes || []);

      const res = await fetchAssets(page, pageSize, search);
      setAssets(res.results || []);
      setTotal(res.count || 0);
    } catch (error) {
      console.error(error);
      message.error("Failed to load assets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, pageSize, search]);

  const handleSave = async (values: any) => {
    try {
      // Separate standard fields from custom attributes
      const standardFields = ['hostname', 'ip_address', 'asset_type', 'asset_level', 'description', 'is_alive'];
      const payload: any = {
        custom_attributes: {}
      };

      Object.keys(values).forEach(key => {
        if (standardFields.includes(key)) {
          payload[key] = values[key];
        } else {
          payload.custom_attributes[key] = values[key];
        }
      });

      if (editingAsset) {
        await updateAsset(editingAsset.id, payload);
        message.success("Asset updated");
      } else {
        await createAsset(payload);
        message.success("Asset created");
      }
      setIsModalOpen(false);
      setEditingAsset(null);
      form.resetFields();
      loadData();
    } catch (error) {
      message.error("Operation failed");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAsset(id);
      message.success("Asset deleted");
      loadData();
    } catch (error) {
      message.error("Delete failed");
    }
  };

  const handleImport: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;
    setImporting(true);
    try {
      const res = await importAssets(file as File);
      if (res.errors && res.errors.length > 0) {
        message.warning(`Imported with ${res.errors.length} errors: ${res.errors[0]}`);
      } else {
        message.success(`Imported: ${res.created} created, ${res.updated} updated`);
      }
      onSuccess?.(res);
      loadData();
    } catch (err) {
      onError?.(err as any);
      message.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (fileFormat: 'xlsx' | 'csv' = 'xlsx') => {
    setExporting(true);
    try {
      const { blob, filename } = await exportAssets(fileFormat, search);
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
      message.success(`CMDB data exported as ${fileFormat.toUpperCase()}`);
    } catch (error) {
      console.error(error);
      message.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveColumn = async (values: any) => {
    try {
      await createAssetColumn(values);
      message.success("Column added");
      columnForm.resetFields();
      // Refresh columns
      const colRes = await fetchAssetColumns();
      setColumnsDef(colRes || []);
    } catch (error) {
      message.error("Failed to add column");
    }
  };

  const handleDeleteColumn = async (id: number) => {
     try {
      await deleteAssetColumn(id);
      message.success("Column deleted");
      const colRes = await fetchAssetColumns();
      setColumnsDef(colRes || []);
    } catch (error) {
      message.error("Failed to delete column");
    }
  };

  // Construct Table Columns
  const tableColumns: any[] = [
    {
      title: 'Asset #',
      dataIndex: 'asset_number',
      key: 'asset_number',
      sorter: true,
      fixed: 'left',
      width: 180,
    },
    {
      title: 'Hostname',
      dataIndex: 'hostname',
      key: 'hostname',
      sorter: true,
      width: 150,
      render: (val: string | null) => val || <span style={{color:'#999'}}>—</span>,
    },
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 130,
    },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      key: 'asset_type',
      width: 100,
    },
    {
      title: 'Level',
      dataIndex: 'asset_level',
      key: 'asset_level',
      width: 100,
      render: (text: string) => (
        <span style={{
          color: text === 'Critical' ? 'red' : text === 'High' ? 'orange' : 'inherit',
          fontWeight: text === 'Critical' ? 'bold' : 'normal'
        }}>
          {text}
        </span>
      )
    },
    {
      title: 'Alive',
      dataIndex: 'is_alive',
      key: 'is_alive',
      width: 80,
      render: (val: boolean) => val ? <span style={{color:'green'}}>Yes</span> : <span style={{color:'gray'}}>No</span>
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      width: 150,
    },
    // Dynamic Columns
    ...columnsDef.map(col => ({
      title: col.label,
      key: col.name,
      width: 120,
      render: (_: any, record: any) => record.custom_attributes?.[col.name] || '-'
    })),
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      width: 100,
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => {
              // Pre-fill form
              const values = {
                ...record,
                ...record.custom_attributes
              };
              setEditingAsset(record);
              form.setFieldsValue(values);
              setIsModalOpen(true);
            }}
          />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingAsset(null);
              form.resetFields();
              setIsModalOpen(true);
            }}
          >
            Add Asset
          </Button>
          <Upload customRequest={handleImport} showUploadList={false}>
            <Button icon={<UploadOutlined />} loading={importing}>Import Excel</Button>
          </Upload>
          <Dropdown
            menu={{
              items: [
                { key: 'xlsx', label: 'Export Excel (.xlsx)' },
                { key: 'csv', label: 'Export CSV (.csv)' },
              ],
              onClick: ({ key }) => handleExport(key as 'xlsx' | 'csv'),
            }}
            trigger={['click']}
          >
            <Button icon={<DownloadOutlined />} loading={exporting}>Export</Button>
          </Dropdown>
          <Button icon={<ReloadOutlined />} onClick={loadData} />
        </Space>

        <Space>
           <Input
            placeholder="Search..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={loadData}
          />
           <Button icon={<SettingOutlined />} onClick={() => setIsColumnModalOpen(true)}>
            Columns
          </Button>
        </Space>
      </div>

      <Table
        dataSource={assets}
        columns={tableColumns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      {/* Audit Log Hint or Link? - omitted for brevity, maybe add a separate tab or view */}

      {/* Asset Modal */}
      <Modal
        title={editingAsset ? "Edit Asset" : "Create Asset"}
        open={isModalOpen}
        onOk={form.submit}
        onCancel={() => setIsModalOpen(false)}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="hostname" label="Hostname">
              <Input placeholder="Optional" />
            </Form.Item>
            <Form.Item name="ip_address" label="IP Address">
              <Input />
            </Form.Item>
            <Form.Item name="asset_type" label="Type">
              <Input />
            </Form.Item>
            <Form.Item name="asset_level" label="Level">
               <Select>
                 <Option value="Critical">Critical</Option>
                 <Option value="High">High</Option>
                 <Option value="Medium">Medium</Option>
                 <Option value="Low">Low</Option>
               </Select>
            </Form.Item>
            <Form.Item name="is_alive" label="Is Alive" valuePropName="checked">
               <Checkbox>Alive</Checkbox>
            </Form.Item>
          </div>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
             <h4>Custom Attributes</h4>
             {columnsDef.length === 0 && <p style={{color: '#999'}}>No custom columns defined. Use table settings to add columns.</p>}
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
               {columnsDef.map(col => (
                 <Form.Item key={col.id} name={col.name} label={col.label} rules={[{ required: col.is_required }]}>
                   {col.data_type === 'boolean' ? (
                      <Select>
                        <Option value={true}>Yes</Option>
                        <Option value={false}>No</Option>
                      </Select>
                   ) : col.data_type === 'number' ? (
                      <Input type="number" />
                   ) : (
                      <Input />
                   )}
                 </Form.Item>
               ))}
             </div>
          </div>
        </Form>
      </Modal>

      {/* Columns Management Drawer */}
      <Drawer
        title="Manage Custom Columns"
        width={400}
        open={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
      >
        <Form form={columnForm} layout="vertical" onFinish={handleSaveColumn}>
          <Form.Item name="name" label="Field Key (e.g. location)" rules={[{ required: true, pattern: /^[a-z0-9_]+$/ }]}>
            <Input placeholder="location" />
          </Form.Item>
          <Form.Item name="label" label="Display Label" rules={[{ required: true }]}>
            <Input placeholder="Location" />
          </Form.Item>
          <Form.Item name="data_type" label="Data Type" initialValue="text">
            <Select>
              <Option value="text">Text</Option>
              <Option value="number">Number</Option>
              <Option value="boolean">Boolean</Option>
            </Select>
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Add Column</Button>
        </Form>

        <div style={{ marginTop: 24 }}>
          <h4>Existing Columns</h4>
          {columnsDef.map(col => (
            <div key={col.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div>
                <strong>{col.label}</strong> ({col.data_type})
                <br />
                <span style={{ fontSize: 12, color: '#999' }}>{col.name}</span>
              </div>
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteColumn(col.id)} />
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}



