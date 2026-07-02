import React, { useState, useEffect, useCallback } from 'react';
import {
  App,
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Row,
  Col,
  Statistic,
  Modal,
  Popconfirm,
  Tooltip,
  Badge,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  CopyOutlined,
  SearchOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  BranchesOutlined,
  HistoryOutlined,
  CloudUploadOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listWorkflows,
  deleteWorkflow,
  executeWorkflow,
  cloneWorkflow,
  getWorkflowStats,
  publishWorkflow,
  cancelWorkflowExecution,
  listPublishedManifests,
  importWorkflowFromManifest,
  importWorkflowFromFile,
  listTicketWorkflowBindings,
  Workflow,
  WorkflowStats,
  TicketWorkflowBinding,
} from 'services/workflows';

interface WorkflowsProps {
  onNavigate?: (path: string) => void;
  onVisualEditWorkflow?: (id?: string) => void;
}

const triggerTypeLabels: Record<string, string> = {
  manual: 'Manual',
  alert: 'On Alert',
  ticket_created: 'On Ticket Created',
  ticket_status: 'On Ticket Status',
  scheduled: 'Scheduled',
  webhook: 'Webhook',
};

const statusColors: Record<string, string> = {
  completed: 'success',
  running: 'processing',
  pending: 'warning',
  failed: 'error',
  cancelled: 'default',
};

// Compute the run-status main label/color for the merged Status column.
// Rules:
//   manual    : draft -> gray 'Manual Run'; active -> blue 'Manual Run';
//               inactive -> gray 'Manual Run · Inactive'
//   scheduled : draft -> gray 'Schedule Disabled'; active -> green 'Scheduled · Enabled';
//               inactive -> red 'Scheduled · Disabled'; cron shown as hint when present
//   event     : draft -> gray 'Event Trigger'; active -> green 'Listening · Enabled';
//               inactive -> red 'Listening · Disabled'
interface RunStatusInfo {
  color: string;
  label: string;
  hint?: string;
}

const getRunStatusInfo = (workflow: Workflow): RunStatusInfo => {
  const { trigger_type, is_active, is_draft, schedule_cron } = workflow;

  if (trigger_type === 'manual') {
    if (is_draft) return { color: 'default', label: 'Manual Run' };
    if (is_active) return { color: 'blue', label: 'Manual Run' };
    return { color: 'default', label: 'Manual Run · Inactive' };
  }

  if (trigger_type === 'scheduled') {
    const hint = schedule_cron || undefined;
    if (is_draft) return { color: 'default', label: 'Schedule Disabled', hint };
    if (is_active) return { color: 'green', label: 'Scheduled · Enabled', hint };
    return { color: 'red', label: 'Scheduled · Disabled', hint };
  }

  // alert / ticket_created / ticket_status / webhook -> event-driven
  if (is_draft) return { color: 'default', label: 'Event Trigger' };
  if (is_active) return { color: 'green', label: 'Listening · Enabled' };
  return { color: 'red', label: 'Listening · Disabled' };
};

// Non-terminal execution states: while last_execution is in one of these states
// we consider the workflow as "currently running". The Execute button is then
// swapped for a Stop/Pause button and the Publish-to-Prefect button is disabled
// to prevent racing a republish against an in-flight run.
const RUNNING_EXECUTION_STATES = new Set(['pending', 'running', 'paused']);

const isWorkflowRunning = (workflow: Workflow): boolean => {
  const status = workflow.last_execution?.status;
  return !!status && RUNNING_EXECUTION_STATES.has(status);
};

const Workflows: React.FC<WorkflowsProps> = ({ onNavigate, onVisualEditWorkflow }) => {
  const { message } = App.useApp();
  const [modal, modalContextHolder] = Modal.useModal();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerFilter, setTriggerFilter] = useState<string>('');
  const [bindings, setBindings] = useState<TicketWorkflowBinding[]>([]);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (statusFilter === 'active') params.is_active = true;
      else if (statusFilter === 'inactive') params.is_active = false;
      else if (statusFilter === 'draft') params.is_draft = true;
      if (triggerFilter) params.trigger_type = triggerFilter;

      const data = await listWorkflows(params);
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      message.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, triggerFilter]);

  const fetchBindings = useCallback(async () => {
    try {
      const data = await listTicketWorkflowBindings();
      setBindings(Array.isArray(data) ? data : []);
    } catch {
      setBindings([]);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getWorkflowStats();
      setStats(data);
    } catch (err) {
      // ignore stats error
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchStats();
    fetchBindings();
  }, [fetchWorkflows, fetchStats, fetchBindings]);

  const getWorkflowBindings = useCallback((workflowId: string) => (
    bindings.filter((item) => item.workflow === workflowId)
  ), [bindings]);

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow(id);
      message.success('Workflow deleted');
      fetchWorkflows();
      fetchStats();
    } catch (err: any) {
      message.error('Failed to delete workflow');
    }
  };

  const handleExecute = async (id: string) => {
    try {
      await executeWorkflow(id);
      message.success('Workflow execution started');
      fetchWorkflows();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.requires_confirmation) {
        const estimatedCount = Number(data?.estimated_impact_count || 0);
        const nodeNames = Array.isArray(data?.affected_nodes)
          ? data.affected_nodes.map((item: any) => item?.step_name).filter(Boolean)
          : [];

        modal.confirm({
          title: 'Confirm Update Ticket Execution',
          content: (
            <div>
              <p>Estimated affected tickets: {estimatedCount}</p>
              {nodeNames.length > 0 && <p>Affected nodes: {nodeNames.join(', ')}</p>}
              <p>Do you want to continue?</p>
            </div>
          ),
          okText: 'Confirm & Execute',
          cancelText: 'Cancel',
          onOk: async () => {
            try {
              await executeWorkflow(id, {}, true);
              message.success('Workflow execution started');
              fetchWorkflows();
            } catch (confirmErr: any) {
              message.error(confirmErr?.response?.data?.error || 'Failed to execute workflow');
            }
          },
        });
        return;
      }

      message.error(err.response?.data?.error || 'Failed to execute workflow');
    }
  };

  const handleClone = async (id: string) => {
    try {
      const newWorkflow = await cloneWorkflow(id);
      message.success(`Workflow cloned: ${newWorkflow.name}`);
      fetchWorkflows();
    } catch (err: any) {
      message.error('Failed to clone workflow');
    }
  };

  // Stop the workflow's currently in-flight execution. Backend uses the
  // `cancel` endpoint (also the path for Prefect-backed runs), but in the UI
  // we surface this as a "pause" affordance per product spec: while a run is
  // active the Execute button is replaced with this stop button.
  const handleCancelExecution = async (workflow: Workflow) => {
    const executionId = workflow.last_execution?.id;
    if (!executionId) {
      message.warning('No active execution to stop');
      return;
    }
    try {
      await cancelWorkflowExecution(executionId);
      message.success('Execution stop requested');
      fetchWorkflows();
      fetchStats();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to stop execution');
    }
  };

  // Publish workflow to Prefect (persistent flow files + deployment)
  const handlePublish = async (id: string) => {
    try {
      const result = await publishWorkflow(id);
      if (result.deployment_registered) {
        message.success(`Workflow "${result.workflow_name}" manifest published and registered`);
      } else {
        message.success(`Workflow "${result.workflow_name}" manifest published`);
      }
      fetchWorkflows();
    } catch (err: any) {
      const detail = err?.response?.data?.error || 'Failed to publish workflow';
      message.error(detail);
    }
  };

  // Import workflow from uploaded JSON file
  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        const result = await importWorkflowFromFile(file);
        message.success(`Workflow "${result.workflow_name}" imported successfully`);
        fetchWorkflows();
        fetchStats();
      } catch (err: any) {
        const detail = err?.response?.data?.error || 'Failed to import workflow';
        message.error(detail);
      }
    };
    input.click();
  };

  // Import workflow from a published manifest already stored on the server
  const handleImportPublished = async () => {
    try {
      const result = await listPublishedManifests();
      const manifests = Array.isArray(result.manifests) ? result.manifests : [];
      if (manifests.length === 0) {
        message.info('No published workflow manifests are available');
        return;
      }

      const selectedFilename = await new Promise<string | null>((resolve) => {
        let nextFilename = manifests[0]?.filename || '';
        const instance = modal.confirm({
          title: 'Import Published Workflow',
          content: (
            <div>
              <p>Select a published workflow manifest to import into Django.</p>
              <Select
                defaultValue={nextFilename}
                style={{ width: '100%' }}
                onChange={(value) => {
                  nextFilename = value;
                }}
                options={manifests.map((manifest) => ({
                  value: manifest.filename,
                  label: `${manifest.name} (${manifest.filename})`,
                }))}
              />
            </div>
          ),
          okText: 'Import',
          cancelText: 'Cancel',
          onOk: async () => {
            resolve(nextFilename || null);
          },
          onCancel: async () => {
            resolve(null);
          },
        });
        void instance;
      });

      if (!selectedFilename) return;

      const imported = await importWorkflowFromManifest(selectedFilename);
      message.success(`Workflow "${imported.workflow_name}" imported from published manifest`);
      fetchWorkflows();
      fetchStats();
    } catch (err: any) {
      const detail = err?.response?.data?.error || 'Failed to import published workflow';
      message.error(detail);
    }
  };

  const columns: ColumnsType<Workflow> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Workflow) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => onVisualEditWorkflow?.(record.id)} style={{ fontWeight: 500 }}>
            {name}
          </a>
          <span style={{ fontSize: 12, color: '#888' }}>
            draft v{record.version}
            {record.published_version ? ` | published v${record.published_version}` : ''}
          </span>
        </Space>
      ),
    },
    {
      title: 'Trigger',
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      width: 110,
      render: (type: string) => (
        <Tag>{triggerTypeLabels[type] || type}</Tag>
      ),
    },
    {
      title: 'Steps',
      dataIndex: 'step_count',
      key: 'step_count',
      width: 70,
      align: 'center',
      render: (count: number) => count || 0,
    },
    {
      // Merged column: run-status main tag + lifecycle tags + cron hint.
      // Replaces the previous separate Status / Run Status pair so the table
      // fits within common desktop widths without horizontal scrolling.
      title: 'Status',
      key: 'status',
      width: 240,
      render: (_: any, record: Workflow) => {
        const runInfo = getRunStatusInfo(record);
        return (
          <Space direction="vertical" size={2} style={{ lineHeight: 1.4 }}>
            <Tag color={runInfo.color} style={{ marginRight: 0 }}>
              {runInfo.label}
            </Tag>
            <Space size={4} wrap>
              {record.is_draft && <Tag color="orange">Draft</Tag>}
              {record.published_version ? (
                <Tag color="blue">Published v{record.published_version}</Tag>
              ) : !record.is_draft ? (
                <Tag>Unpublished</Tag>
              ) : null}
              {record.has_unpublished_changes && <Tag color="red">Changes</Tag>}
            </Space>
            {runInfo.hint && (
              <span style={{ fontSize: 11, color: '#888' }}>{runInfo.hint}</span>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Ticket Labels',
      key: 'ticket_binding',
      width: 260,
      render: (_: any, record: Workflow) => {
        const rows = getWorkflowBindings(record.id);
        const labels = rows.flatMap((item) => item.label_filters || []);
        if (!labels.length) return <Tag>Not bound</Tag>;
        return (
          <Space size={4} wrap>
            {labels.map((label, index) => {
              const name = String(label.label_name || '').trim();
              const value = label.label_value == null ? '' : String(label.label_value).trim();
              return (
                <Tag key={`${name}-${value}-${index}`} color="green">
                  {value ? `${name}: ${value}` : name}
                </Tag>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: 'Last Execution',
      key: 'last_execution',
      width: 150,
      render: (_: any, record: Workflow) => {
        if (!record.last_execution) {
          return <span style={{ color: '#999' }}>Never</span>;
        }
        const exec = record.last_execution;
        return (
          <Space direction="vertical" size={0}>
            <Badge
              status={statusColors[exec.status] as any || 'default'}
              text={exec.status}
            />
            <span style={{ fontSize: 11, color: '#888' }}>
              {new Date(exec.started_at).toLocaleString()}
            </span>
          </Space>
        );
      },
    },
    {
      title: 'Executions',
      dataIndex: 'execution_count',
      key: 'execution_count',
      width: 90,
      align: 'center',
      render: (count: number) => count || 0,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: Workflow) => {
        const running = isWorkflowRunning(record);
        return (
          <Space size="small" wrap>
            {running ? (
              // While an execution is in-flight the Execute button is
              // replaced with a Stop button regardless of active/draft state.
              <Tooltip title="Stop running execution">
                <Button
                  danger
                  size="small"
                  icon={<PauseCircleOutlined />}
                  onClick={() => handleCancelExecution(record)}
                />
              </Tooltip>
            ) : (
              record.is_active && !record.is_draft && (
                <Tooltip title="Execute">
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleExecute(record.id)}
                  />
                </Tooltip>
              )
            )}
            <Tooltip title="Visual Editor">
              <Button
                size="small"
                icon={<BranchesOutlined />}
                onClick={() => onVisualEditWorkflow?.(record.id)}
              />
            </Tooltip>
            <Tooltip title="Clone">
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleClone(record.id)}
              />
            </Tooltip>
            <Tooltip
              title={
                running
                  ? 'Cannot publish while an execution is running'
                  : 'Publish to Prefect'
              }
            >
              {/* Wrap the disabled Button in a span so the Tooltip still */}
              {/* fires on hover (antd Tooltip cannot bind to a disabled button). */}
              <span>
                <Button
                  size="small"
                  icon={<CloudUploadOutlined />}
                  onClick={() => handlePublish(record.id)}
                  disabled={running}
                />
              </span>
            </Tooltip>
            <Popconfirm
              title="Delete this workflow?"
              onConfirm={() => handleDelete(record.id)}
              okText="Yes"
              cancelText="No"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {modalContextHolder}

      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Total Workflows"
              value={stats?.workflows?.total || 0}
              prefix={<BranchesOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Active"
              value={stats?.workflows?.active || 0}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Total Executions"
              value={stats?.executions?.total || 0}
              prefix={<SyncOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Success Rate"
              value={stats?.executions?.success_rate || 0}
              precision={1}
              suffix="%"
              valueStyle={{ color: (stats?.executions?.success_rate || 0) >= 80 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters and Actions */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} lg={10} xl={9}>
            <Space size="middle" wrap style={{ width: '100%' }}>
              <Input
                placeholder="Search workflows..."
                prefix={<SearchOutlined />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onPressEnter={fetchWorkflows}
                style={{ width: 250 }}
                allowClear
              />
              <Select
                placeholder="Status"
                value={statusFilter || undefined}
                onChange={setStatusFilter}
                style={{ width: 120 }}
                allowClear
              >
                <Select.Option value="active">Active</Select.Option>
                <Select.Option value="inactive">Inactive</Select.Option>
                <Select.Option value="draft">Draft</Select.Option>
              </Select>
              <Select
                placeholder="Trigger Type"
                value={triggerFilter || undefined}
                onChange={setTriggerFilter}
                style={{ width: 150 }}
                allowClear
              >
                {Object.entries(triggerTypeLabels).map(([value, label]) => (
                  <Select.Option key={value} value={value}>{label}</Select.Option>
                ))}
              </Select>
              <Button icon={<ReloadOutlined />} onClick={fetchWorkflows}>
                Refresh
              </Button>
            </Space>
          </Col>
          <Col xs={24} lg={14} xl={15} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space wrap style={{ justifyContent: 'flex-end' }}>
              <Button
                icon={<ImportOutlined />}
                onClick={handleImport}
              >
                Import Workflow
              </Button>
              <Button
                icon={<CloudUploadOutlined />}
                onClick={handleImportPublished}
              >
                Import Published
              </Button>
              <Button
                icon={<HistoryOutlined />}
                onClick={() => onNavigate?.('/settings/workflows/executions')}
              >
                View Executions
              </Button>
              <Button
                type="primary"
                icon={<BranchesOutlined />}
                onClick={() => onVisualEditWorkflow?.()}
              >
                Create Visual Workflow
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Workflows Table */}
      <Card title="Workflows" extra={<span>{workflows.length} items</span>}>
        <Table
          columns={columns}
          dataSource={workflows}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 'max-content' }}
        />
      </Card>
    </div>
  );
};

export default Workflows;

