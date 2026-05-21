import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { getIsReadonly } from '../../lib/auth';
import {
  createAiAssistantMcpServer,
  createAiAssistantSkillConfig,
  deleteAiAssistantMcpServer,
  deleteAiAssistantSkillConfig,
  fetchAiAssistantInternalMcpTools,
  fetchAiAssistantMcpMonitor,
  fetchAiAssistantSkillCatalog,
  fetchAiAssistantSkillContent,
  fetchAiAssistantSkillMonitor,
  listAiAssistantMcpServers,
  listAiAssistantSkillConfigs,
  testAiAssistantConnectivity,
  updateAiAssistantMcpServer,
  updateAiAssistantSkillConfig,
  updateAiAssistantSkillContent,
} from '../../api';

const STORAGE_KEYS = {
  enabled: 'siem_ai_enabled',
  apiKey: 'siem_ai_api_key',
  model: 'siem_ai_model',
  baseUrl: 'siem_ai_base_url',
  timeout: 'siem_ai_timeout',
};

export default function AiAssistantSettings() {
  const [generalForm] = Form.useForm();
  const [mcpEditForm] = Form.useForm();
  const [skillEditForm] = Form.useForm();
  const [testLoading, setTestLoading] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorData, setMonitorData] = useState<any>({ executions: [], stats: {}, total: 0, page: 1, page_size: 20, total_pages: 1 });
  const [skillMonitorLoading, setSkillMonitorLoading] = useState(false);
  const [skillMonitorData, setSkillMonitorData] = useState<any>({ summary: {}, stats: [] });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpEditRow, setMcpEditRow] = useState<any | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<any[]>([]);
  const [skillConfigs, setSkillConfigs] = useState<any[]>([]);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillEditRow, setSkillEditRow] = useState<any | null>(null);
  const [skillContentLoading, setSkillContentLoading] = useState(false);
  const [skillContentPreview, setSkillContentPreview] = useState('');
  const [internalMcpTools, setInternalMcpTools] = useState<any[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [toolFilter, setToolFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed' | 'running'>('all');
  const [isReadonly, setIsReadonly] = useState(false);
  useEffect(() => { setIsReadonly(getIsReadonly()); }, []);
  const toolStats = useMemo(() => {
    const byTool = monitorData?.stats || {};
    return Object.entries(byTool)
      .map(([tool, stat]: any) => ({ tool, ...(stat || {}) }))
      .sort((a: any, b: any) => Number(b.total_calls || 0) - Number(a.total_calls || 0))
      .slice(0, 3);
  }, [monitorData]);

  const monitorSummary = useMemo(() => {
    const stats = Object.values(monitorData?.stats || {}) as any[];
    const total = stats.reduce((acc, s) => acc + Number(s?.total_calls || 0), 0);
    const success = stats.reduce((acc, s) => acc + Number(s?.success_calls || 0), 0);
    const failed = stats.reduce((acc, s) => acc + Number(s?.failed_calls || 0), 0);
    const successRate = total ? Math.round((success / total) * 1000) / 10 : 0;
    const lastInvocation = (monitorData?.executions || [])[0]?.start_time || '-';
    return { total, success, failed, successRate, lastInvocation };
  }, [monitorData]);

  const skillConfigMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of skillConfigs) {
      if (row?.name) map.set(row.name, row);
    }
    return map;
  }, [skillConfigs]);

  const filteredRows = useMemo(() => {
    const rows = Array.isArray(monitorData?.executions) ? monitorData.executions : [];
    const endpointMap = new Map<string, string>();
    for (const item of mcpServers) {
      const endpoint = String(item?.endpoint || '').trim();
      const title = String(item?.title || '').trim();
      if (endpoint) endpointMap.set(endpoint, title || endpoint);
    }
    const resolveAddedMcp = (requestUrl: string) => {
      const u = String(requestUrl || '');
      for (const [endpoint, title] of endpointMap.entries()) {
        if (u.startsWith(endpoint)) return { title, endpoint };
      }
      return { title: '-', endpoint: '-' };
    };
    const mapped = rows.map((r: any, idx: number) => ({
      ...resolveAddedMcp(r.endpoint || ''),
        key: `${idx}_${r.start_time || ''}_${r.tool_name || ''}`,
        tool: r.tool_name || '-',
        status: r.status || '-',
        startAt: r.start_time || '-',
        duration: typeof r.duration_ms === 'number' ? `${Math.max(0, Math.round(r.duration_ms / 1000))}s` : '-',
        requestUrl: r.endpoint || '',
        requestPayload: r.arguments || {},
        responsePayload: r.response_payload || {},
        error: r.error || '',
        httpStatus: '',
        source: r.source || '',
        executionId: r.id || '',
      }));
    return mapped;
  }, [monitorData, mcpServers]);

  useEffect(() => {
    try {
      generalForm.setFieldsValue({
        enabled: localStorage.getItem(STORAGE_KEYS.enabled) !== '0',
        apiKey: isReadonly ? '' : (localStorage.getItem(STORAGE_KEYS.apiKey) || ''),
        model: localStorage.getItem(STORAGE_KEYS.model) || 'gpt-5.1-codex',
        baseUrl: localStorage.getItem(STORAGE_KEYS.baseUrl) || 'https://api.openai.com/v1',
        timeout: localStorage.getItem(STORAGE_KEYS.timeout) || '45',
      });
    } catch {}
  }, [generalForm, isReadonly]);

  const loadMonitor = async (silent = false) => {
    if (!silent) setMonitorLoading(true);
    try {
      const res = await fetchAiAssistantMcpMonitor({
        tool: toolFilter || undefined,
        status: statusFilter,
        page: 1,
        page_size: 100,
      });
      setMonitorData(res || { executions: [], stats: {}, total: 0, page: 1, page_size: 20, total_pages: 1 });
    } catch {
      if (!silent) message.error('Failed to load MCP monitor');
      setMonitorData({ executions: [], stats: {}, total: 0, page: 1, page_size: 20, total_pages: 1 });
    } finally {
      if (!silent) setMonitorLoading(false);
    }
  };

  const loadSkillMonitor = async () => {
    setSkillMonitorLoading(true);
    try {
      const res = await fetchAiAssistantSkillMonitor();
      setSkillMonitorData(res || { summary: {}, stats: [] });
    } catch {
      message.error('Failed to load skill monitor');
      setSkillMonitorData({ summary: {}, stats: [] });
    } finally {
      setSkillMonitorLoading(false);
    }
  };

  const loadMcpServers = async () => {
    setMcpLoading(true);
    try {
      const res = await listAiAssistantMcpServers();
      setMcpServers(Array.isArray(res) ? res : []);
    } catch {
      message.error('Failed to load MCP servers');
      setMcpServers([]);
    } finally {
      setMcpLoading(false);
    }
  };

  const loadSkillCatalog = async () => {
    try {
      const res = await fetchAiAssistantSkillCatalog();
      const rows = Array.isArray(res?.skills) ? res.skills : Array.isArray(res) ? res : [];
      setSkillCatalog(rows);
    } catch {
      setSkillCatalog([]);
    }
  };

  const loadSkillConfigs = async () => {
    try {
      const res = await listAiAssistantSkillConfigs();
      setSkillConfigs(Array.isArray(res) ? res : []);
    } catch {
      message.error('Failed to load skill configs');
      setSkillConfigs([]);
    }
  };

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      await Promise.all([loadSkillCatalog(), loadSkillConfigs()]);
    } finally {
      setSkillsLoading(false);
    }
  };

  const loadInternalMcpTools = async () => {
    try {
      const res = await fetchAiAssistantInternalMcpTools();
      const tools = Array.isArray(res?.tools) ? res.tools : Array.isArray(res) ? res : [];
      setInternalMcpTools(tools);
    } catch {
      setInternalMcpTools([]);
    }
  };

  useEffect(() => {
    loadMonitor(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolFilter, statusFilter]);

  useEffect(() => {
    loadSkillMonitor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMcpServers();
    loadSkills();
    loadInternalMcpTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSaveGeneral = async () => {
    const values = await generalForm.validateFields();
    try {
      localStorage.setItem(STORAGE_KEYS.enabled, values.enabled ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.apiKey, values.apiKey || '');
      localStorage.setItem(STORAGE_KEYS.model, values.model || '');
      localStorage.setItem(STORAGE_KEYS.baseUrl, values.baseUrl || '');
      localStorage.setItem(STORAGE_KEYS.timeout, String(values.timeout || '45'));
      message.success('General settings saved');
    } catch (err) {
      message.error('Failed to save general settings');
    }
  };

  const onTestConnectivity = async () => {
    setTestLoading(true);
    try {
      const values = await generalForm.validateFields();
      const res = await testAiAssistantConnectivity({
        api_key: values.apiKey || undefined,
        model: values.model || undefined,
        base_url: values.baseUrl || undefined,
        timeout_seconds:
          values.timeout && !Number.isNaN(Number(values.timeout)) ? Number(values.timeout) : undefined,
      });
      message.success(`Connected (${res?.model || values.model || 'model'})`);
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Connectivity test failed');
    } finally {
      setTestLoading(false);
    }
  };

  const openMcpModal = (row?: any) => {
    setMcpEditRow(row || null);
    mcpEditForm.setFieldsValue({
      name: row?.name || '',
      title: row?.title || '',
      endpoint: row?.endpoint || '',
      token: row?.token || '',
      enabled: row?.enabled !== false,
    });
    setMcpModalOpen(true);
  };

  const submitMcpModal = async () => {
    const values = await mcpEditForm.validateFields();
    try {
      if (mcpEditRow?.name) {
        await updateAiAssistantMcpServer(mcpEditRow.name, {
          title: values.title || '',
          endpoint: values.endpoint || '',
          token: values.token || '',
          enabled: values.enabled !== false,
        });
        message.success('MCP updated');
      } else {
        await createAiAssistantMcpServer({
          name: values.name,
          title: values.title || '',
          endpoint: values.endpoint,
          token: values.token || '',
          enabled: values.enabled !== false,
        });
        message.success('MCP created');
      }
      setMcpModalOpen(false);
      setMcpEditRow(null);
      await loadMcpServers();
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to save MCP');
    }
  };

  const onToggleMcp = async (row: any, enabled: boolean) => {
    try {
      await updateAiAssistantMcpServer(row.name, { enabled });
      await loadMcpServers();
    } catch {
      message.error('Failed to update MCP');
    }
  };

  const onDeleteMcp = async (row: any) => {
    try {
      await deleteAiAssistantMcpServer(row.name);
      await loadMcpServers();
      message.success('MCP removed');
    } catch {
      message.error('Failed to delete MCP');
    }
  };

  const openSkillModal = (row?: any) => {
    setSkillEditRow(row || null);
    skillEditForm.setFieldsValue({
      name: row?.name || '',
      version: row?.version || 'v1',
      route: row?.route || row?.name || '',
      enabled: row?.enabled !== false,
      description: row?.description || '',
      content: '',
    });
    setSkillContentPreview('');
    setSkillModalOpen(true);
    if (row?.name) {
      setSkillContentLoading(true);
      fetchAiAssistantSkillContent(row.name)
        .then((res) => {
          const content = String(res?.content || '');
          skillEditForm.setFieldsValue({ content });
          setSkillContentPreview(content);
        })
        .catch(() => {
          skillEditForm.setFieldsValue({ content: '' });
          setSkillContentPreview('');
        })
        .finally(() => setSkillContentLoading(false));
    }
  };

  const submitSkillModal = async () => {
    const values = await skillEditForm.validateFields();
    try {
      if (skillEditRow?.name) {
        await updateAiAssistantSkillConfig(skillEditRow.name, {
          version: values.version || 'v1',
          route: values.route || values.name,
          enabled: values.enabled !== false,
          description: values.description || '',
        });
        await updateAiAssistantSkillContent(skillEditRow.name, {
          content: values.content || '',
          title: values.name || skillEditRow.name,
          description: values.description || '',
        });
        message.success('Skill updated');
      } else {
        await createAiAssistantSkillConfig({
          name: values.name,
          version: values.version || 'v1',
          route: values.route || values.name,
          enabled: values.enabled !== false,
          description: values.description || '',
        });
        await updateAiAssistantSkillContent(values.name, {
          content: values.content || '',
          title: values.name,
          description: values.description || '',
        });
        message.success('Skill created');
      }
      setSkillModalOpen(false);
      setSkillEditRow(null);
      await loadSkillConfigs();
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to save skill');
    }
  };

  const onDeleteSkill = async (row: any) => {
    try {
      await deleteAiAssistantSkillConfig(row.name);
      await loadSkillConfigs();
      message.success('Skill removed');
    } catch {
      message.error('Failed to delete skill');
    }
  };

  const onEnableCatalogSkill = async (row: any) => {
    const name = String(row?.name || '').trim();
    if (!name) return;
    const existing = skillConfigMap.get(name);
    try {
      if (existing) {
        await updateAiAssistantSkillConfig(name, { enabled: true });
      } else {
        await createAiAssistantSkillConfig({
          name,
          version: 'v1',
          route: name,
          enabled: true,
          description: String(row?.description || ''),
        });
        if (row?.description) {
          await updateAiAssistantSkillContent(name, {
            content: '',
            title: name,
            description: String(row?.description || ''),
          });
        }
      }
      await loadSkillConfigs();
      message.success(`Enabled skill: ${name}`);
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to enable skill');
    }
  };

  const statusTag = (status: string) => {
    if (status === 'completed') return <Tag color="green">Completed</Tag>;
    if (status === 'failed') return <Tag color="red">Failed</Tag>;
    if (status === 'running') return <Tag color="blue">Running</Tag>;
    return <Tag>{status}</Tag>;
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label} copied`);
    } catch {
      message.error('Copy failed');
    }
  };

  const formatTime = (value: string) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  const skillTools = useMemo(
    () => ([
      { name: 'list_skills', description: 'List skills from skill library' },
      { name: 'read_skill', description: 'Read a skill document by name' },
    ]),
    []
  );

  const renderInline = (text: string, keyPrefix: string) => {
    const nodes: React.ReactNode[] = [];
    let remaining = text;
    let idx = 0;
    const patterns: Array<{ type: 'bold' | 'italic' | 'code' | 'link'; regex: RegExp }> = [
      { type: 'bold', regex: /\*\*([^*]+)\*\*/ },
      { type: 'italic', regex: /\*([^*]+)\*/ },
      { type: 'code', regex: /`([^`]+)`/ },
      { type: 'link', regex: /\[([^\]]+)\]\(([^)]+)\)/ },
    ];

    while (remaining) {
      let earliestIndex = -1;
      let earliestMatch: RegExpExecArray | null = null;
      let earliestType: 'bold' | 'italic' | 'code' | 'link' | null = null;

      for (const p of patterns) {
        const m = p.regex.exec(remaining);
        if (m && (earliestIndex === -1 || m.index < earliestIndex)) {
          earliestIndex = m.index;
          earliestMatch = m;
          earliestType = p.type;
        }
      }

      if (!earliestMatch || earliestIndex < 0 || !earliestType) {
        nodes.push(remaining);
        break;
      }

      if (earliestIndex > 0) {
        nodes.push(remaining.slice(0, earliestIndex));
      }

      if (earliestType === 'bold') {
        nodes.push(<strong key={`${keyPrefix}_b_${idx++}`}>{earliestMatch[1]}</strong>);
      } else if (earliestType === 'italic') {
        nodes.push(<em key={`${keyPrefix}_i_${idx++}`}>{earliestMatch[1]}</em>);
      } else if (earliestType === 'code') {
        nodes.push(
          <code key={`${keyPrefix}_c_${idx++}`} style={{ background: '#f6f8fa', padding: '0 4px', borderRadius: 4 }}>
            {earliestMatch[1]}
          </code>
        );
      } else if (earliestType === 'link') {
        nodes.push(
          <a
            key={`${keyPrefix}_l_${idx++}`}
            href={earliestMatch[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#1677ff' }}
          >
            {earliestMatch[1]}
          </a>
        );
      }

      remaining = remaining.slice(earliestIndex + earliestMatch[0].length);
    }

    return nodes;
  };

  const renderMarkdown = (text: string) => {
    const lines = String(text || '').split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;
    let blockIdx = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i += 1;
        }
        i += 1;
        blocks.push(
          <pre key={`code_${blockIdx++}`} style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            <code>{codeLines.join('\n') || (lang ? `// ${lang}` : '')}</code>
          </pre>
        );
        continue;
      }

      const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const textContent = headingMatch[2];
        const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
        blocks.push(
          <Tag key={`h_${blockIdx++}`} style={{ marginTop: 8, marginBottom: 6 }}>
            {renderInline(textContent, `h_${blockIdx}`)}
          </Tag>
        );
        i += 1;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i += 1;
        }
        blocks.push(
          <ul key={`ul_${blockIdx++}`} style={{ paddingLeft: 20, marginBottom: 8 }}>
            {items.map((item, idx) => (
              <li key={`li_${blockIdx}_${idx}`}>{renderInline(item, `li_${blockIdx}_${idx}`)}</li>
            ))}
          </ul>
        );
        continue;
      }

      if (!line.trim()) {
        blocks.push(<div key={`sp_${blockIdx++}`} style={{ height: 8 }} />);
        i += 1;
        continue;
      }

      blocks.push(
        <div key={`p_${blockIdx++}`} style={{ marginBottom: 8, lineHeight: 1.6 }}>
          {renderInline(line, `p_${blockIdx}`)}
        </div>
      );
      i += 1;
    }

    return <div>{blocks}</div>;
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        AI Assistant Settings
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        General settings are stored locally in the browser. MCP/Skills management is stored server-side.
      </Typography.Paragraph>
      {isReadonly ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Read-only view"
          description="Guest accounts cannot view stored API keys or tokens, and cannot modify AI Assistant settings."
        />
      ) : null}

      <Tabs
        items={[
          {
            key: 'general',
            label: 'General',
            children: (
              <Card>
                <Form form={generalForm} layout="vertical" disabled={isReadonly}>
                  <Form.Item label="Enable AI Assistant" name="enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item label="OpenAI API Key" name="apiKey">
                    <Input.Password placeholder={isReadonly ? 'Hidden for read-only users' : 'sk-...'} />
                  </Form.Item>
                  <Form.Item label="Model" name="model">
                    <Input placeholder="gpt-5.1-codex" />
                  </Form.Item>
                  <Form.Item label="Base URL" name="baseUrl">
                    <Input placeholder="https://api.openai.com/v1" />
                  </Form.Item>
                  <Form.Item label="Timeout (seconds)" name="timeout">
                    <Input />
                  </Form.Item>
                  {isReadonly ? null : (
                    <Form.Item>
                      <Space>
                        <Button type="primary" onClick={onSaveGeneral}>
                          Save General
                        </Button>
                        <Button onClick={onTestConnectivity} loading={testLoading}>
                          Test Connectivity
                        </Button>
                      </Space>
                    </Form.Item>
                  )}
                </Form>
              </Card>
            ),
          },
          {
            key: 'mcp-monitor',
            label: 'MCP Status Monitor',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card
                  title="Execution Statistics"
                  extra={
                    <Button size="small" loading={monitorLoading} onClick={() => loadMonitor()}>
                      Refresh
                    </Button>
                  }
                >
                  <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12} md={8} lg={6}>
                      <Card size="small">
                        <Typography.Text type="secondary">Total Calls</Typography.Text>
                        <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6 }}>{monitorSummary.total || 0}</div>
                        <Typography.Text type="secondary">
                          Success {monitorSummary.success || 0} / Failed {monitorSummary.failed || 0}
                        </Typography.Text>
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={8} lg={6}>
                      <Card size="small">
                        <Typography.Text type="secondary">Success Rate</Typography.Text>
                        <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6 }}>{monitorSummary.successRate || 0}%</div>
                        <Typography.Text type="secondary">Across all MCP tools</Typography.Text>
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={8} lg={6}>
                      <Card size="small">
                        <Typography.Text type="secondary">Last Invocation</Typography.Text>
                        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                          {monitorSummary.lastInvocation || '-'}
                        </div>
                        <Typography.Text type="secondary">Current filter scope</Typography.Text>
                      </Card>
                    </Col>
                    {toolStats.map((s: any) => (
                      <Col key={s.tool} xs={24} sm={12} md={8} lg={6}>
                        <Card size="small">
                          <Typography.Text type="secondary">{s.tool}</Typography.Text>
                          <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6 }}>{s.total_calls || 0}</div>
                          <Typography.Text type="secondary">
                            Success {s.success_calls || 0} / Failed {s.failed_calls || 0}
                          </Typography.Text>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </Card>

                <Card title="Recent Executions">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                    <Input
                      placeholder="Search tool name"
                      style={{ width: 260 }}
                      value={toolFilter}
                      onChange={(e) => setToolFilter(e.target.value)}
                    />
                    <Select
                      style={{ width: 180 }}
                      value={statusFilter}
                      onChange={(v) => setStatusFilter(v)}
                      options={[
                        { value: 'all', label: 'All Status' },
                        { value: 'completed', label: 'Completed' },
                        { value: 'failed', label: 'Failed' },
                        { value: 'running', label: 'Running' },
                      ]}
                    />
                  </div>
                  <Table
                    rowKey="key"
                    loading={monitorLoading}
                    pagination={{ pageSize: 6 }}
                    dataSource={filteredRows}
                    columns={[
                      { title: 'Tool', dataIndex: 'tool', key: 'tool' },
                      { title: 'Source', dataIndex: 'source', key: 'source' },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        key: 'status',
                        render: (v: string) => statusTag(v),
                      },
                      { title: 'Start Time', dataIndex: 'startAt', key: 'startAt' },
                      { title: 'Duration', dataIndex: 'duration', key: 'duration' },
                      {
                        title: 'Action',
                        key: 'action',
                        render: (_: any, row: any) => (
                          <Space>
                            <Button
                              size="small"
                              onClick={() => {
                                setDetailRow(row);
                                setDetailOpen(true);
                              }}
                            >
                              Details
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'skill-monitor',
            label: 'Skill Monitor',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card
                  title="Skill Execution Statistics"
                  extra={
                    <Button size="small" loading={skillMonitorLoading} onClick={() => loadSkillMonitor()}>
                      Refresh
                    </Button>
                  }
                >
                  <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12} md={8} lg={6}>
                      <Card size="small">
                        <Typography.Text type="secondary">Total Calls</Typography.Text>
                        <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6 }}>{skillMonitorData?.summary?.total_calls || 0}</div>
                        <Typography.Text type="secondary">
                          Success {skillMonitorData?.summary?.success || 0} / Failed {skillMonitorData?.summary?.failed || 0}
                        </Typography.Text>
                      </Card>
                    </Col>
                  </Row>
                </Card>

                <Card title="Skill Usage">
                  <Table
                    rowKey={(row: any) => row.skill_name}
                    loading={skillMonitorLoading}
                    pagination={{ pageSize: 8 }}
                    dataSource={Array.isArray(skillMonitorData?.stats) ? skillMonitorData.stats : []}
                    columns={[
                      { title: 'Skill', dataIndex: 'skill_name', key: 'skill_name' },
                      { title: 'Total', dataIndex: 'total_calls', key: 'total_calls' },
                      { title: 'Success', dataIndex: 'success_calls', key: 'success_calls' },
                      { title: 'Failed', dataIndex: 'failed_calls', key: 'failed_calls' },
                      { title: 'Last Call', dataIndex: 'last_call_time', key: 'last_call_time' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'mcp',
            label: 'MCP Management',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card
                  title="Added MCP Servers"
                  extra={(
                    <Space>
                      <Button onClick={() => loadMcpServers()} loading={mcpLoading}>Refresh</Button>
                      {isReadonly ? null : <Button type="primary" onClick={() => openMcpModal()}>Add MCP</Button>}
                    </Space>
                  )}
                >
                  <Table
                    size="small"
                    rowKey={(r: any) => r.name}
                    loading={mcpLoading}
                    pagination={{ pageSize: 6 }}
                    dataSource={mcpServers}
                    locale={{ emptyText: 'No MCP servers configured' }}
                    columns={[
                      { title: 'Name', dataIndex: 'name', key: 'name' },
                      { title: 'Title', dataIndex: 'title', key: 'title', render: (v: string) => v || '-' },
                      { title: 'Endpoint', dataIndex: 'endpoint', key: 'endpoint', ellipsis: true },
                      {
                        title: 'Enabled',
                        key: 'enabled',
                        width: 110,
                        render: (_: any, row: any) => (
                          <Switch disabled={isReadonly} checked={row.enabled !== false} onChange={(checked) => onToggleMcp(row, checked)} />
                        ),
                      },
                      ...(isReadonly ? [] : [{
                        title: 'Action',
                        key: 'action',
                        width: 180,
                        render: (_: any, row: any) => (
                          <Space>
                            <Button size="small" onClick={() => openMcpModal(row)}>Edit</Button>
                            <Button danger size="small" onClick={() => onDeleteMcp(row)}>Delete</Button>
                          </Space>
                        ),
                      }]),
                    ]}
                  />
                </Card>

                <Card title="Built-in MCP Tools">
                  <Table
                    size="small"
                    rowKey={(r: any) => r.name}
                    pagination={{ pageSize: 6 }}
                    dataSource={internalMcpTools}
                    locale={{ emptyText: 'No built-in MCP tools detected' }}
                    columns={[
                      { title: 'Tool', dataIndex: 'name', key: 'name' },
                      { title: 'Description', dataIndex: 'description', key: 'description' },
                    ]}
                  />
                </Card>

                <Card title="Skill MCP Tools">
                  <Table
                    size="small"
                    rowKey={(r: any) => r.name}
                    pagination={false}
                    dataSource={skillTools}
                    columns={[
                      { title: 'Tool', dataIndex: 'name', key: 'name' },
                      { title: 'Description', dataIndex: 'description', key: 'description' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'skills',
            label: 'Skills Management',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card
                  title="Configured Skills"
                  extra={(
                    <Space>
                      <Button onClick={() => loadSkills()} loading={skillsLoading}>Refresh</Button>
                      {isReadonly ? null : <Button type="primary" onClick={() => openSkillModal()}>Add Skill</Button>}
                    </Space>
                  )}
                >
                  <Table
                    size="small"
                    rowKey={(row: any) => row.name}
                    loading={skillsLoading}
                    pagination={{ pageSize: 6 }}
                    dataSource={skillConfigs}
                    locale={{ emptyText: 'No skills configured' }}
                    columns={[
                      { title: 'Name', dataIndex: 'name', key: 'name' },
                      { title: 'Version', dataIndex: 'version', key: 'version', width: 120 },
                      { title: 'Route', dataIndex: 'route', key: 'route', ellipsis: true },
                      {
                        title: 'Enabled',
                        key: 'enabled',
                        width: 110,
                        render: (_: any, row: any) => (
                          <Switch disabled={isReadonly} checked={row.enabled !== false} onChange={(checked) => updateAiAssistantSkillConfig(row.name, { enabled: checked }).then(loadSkillConfigs).catch(() => message.error('Failed to update skill'))} />
                        ),
                      },
                      ...(isReadonly ? [] : [{
                        title: 'Action',
                        key: 'action',
                        width: 180,
                        render: (_: any, row: any) => (
                          <Space>
                            <Button size="small" onClick={() => openSkillModal(row)}>Edit</Button>
                            <Button danger size="small" onClick={() => onDeleteSkill(row)}>Delete</Button>
                          </Space>
                        ),
                      }]),
                    ]}
                  />
                </Card>

                <Card title="Available Skills (Library)">
                  <Table
                    size="small"
                    rowKey={(row: any) => row.name}
                    loading={skillsLoading}
                    pagination={{ pageSize: 8 }}
                    dataSource={skillCatalog}
                    locale={{ emptyText: 'No skills found in library' }}
                    columns={[
                      { title: 'Name', dataIndex: 'name', key: 'name' },
                      { title: 'Title', dataIndex: 'title', key: 'title', render: (v: string) => v || '-' },
                      { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
                      {
                        title: 'Status',
                        key: 'status',
                        width: 120,
                        render: (_: any, row: any) => {
                          const cfg = skillConfigMap.get(row?.name);
                          if (cfg?.enabled) return <Tag color="green">Enabled</Tag>;
                          if (cfg) return <Tag>Disabled</Tag>;
                          return <Tag>Not Added</Tag>;
                        },
                      },
                      {
                        title: 'Action',
                        key: 'action',
                        width: 140,
                        render: (_: any, row: any) => {
                          const cfg = skillConfigMap.get(row?.name);
                          const label = cfg ? (cfg.enabled ? 'Enabled' : 'Enable') : 'Add';
                          return (
                            <Button size="small" disabled={isReadonly || cfg?.enabled} onClick={() => onEnableCatalogSkill(row)}>
                              {label}
                            </Button>
                          );
                        },
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="Tool call details"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        width={980}
        styles={{ body: { maxHeight: '75vh', overflow: 'auto' } }}
        footer={[
          <Button key="ok" type="primary" onClick={() => setDetailOpen(false)}>
            OK
          </Button>,
        ]}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="Execution info">
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12} md={8}>
                <Card size="small">
                  <Typography.Text type="secondary">TOOL</Typography.Text>
                  <div style={{ marginTop: 6, fontWeight: 700 }}>{detailRow?.tool || '-'}</div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Card size="small">
                  <Typography.Text type="secondary">STATUS</Typography.Text>
                  <div style={{ marginTop: 6 }}>{statusTag(detailRow?.status || '')}</div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Card size="small">
                  <Typography.Text type="secondary">TIME</Typography.Text>
                  <div style={{ marginTop: 6, fontWeight: 600 }}>{formatTime(detailRow?.startAt || '')}</div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={12}>
                <Card size="small">
                  <Typography.Text type="secondary">EXECUTION ID</Typography.Text>
                  <div style={{ marginTop: 6, fontWeight: 600, wordBreak: 'break-all' }}>{detailRow?.executionId || '-'}</div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={12}>
                <Card size="small">
                  <Typography.Text type="secondary">ENDPOINT</Typography.Text>
                  <div style={{ marginTop: 6, fontWeight: 600, wordBreak: 'break-all' }}>{detailRow?.requestUrl || '-'}</div>
                </Card>
              </Col>
            </Row>
          </Card>

          <Card
            size="small"
            title="Request params"
            extra={(
              <Button size="small" onClick={() => copyText(JSON.stringify({ tool: detailRow?.tool, arguments: detailRow?.requestPayload || {} }, null, 2), 'Request JSON')}>
                Copy JSON
              </Button>
            )}
          >
            <pre style={{ margin: 0, background: '#f6f8fa', border: '1px solid #f0f0f0', padding: 12, borderRadius: 6, whiteSpace: 'pre', maxHeight: 360, overflow: 'auto' }}>
{JSON.stringify({ tool: detailRow?.tool, arguments: detailRow?.requestPayload || {} }, null, 2)}
            </pre>
          </Card>

          <Card
            size="small"
            title="Response"
            extra={(
              <Button size="small" onClick={() => copyText(JSON.stringify(detailRow?.responsePayload || {}, null, 2), 'Response content')}>
                Copy content
              </Button>
            )}
          >
            <pre style={{ margin: 0, background: '#f6f8fa', border: '1px solid #f0f0f0', padding: 12, borderRadius: 6, whiteSpace: 'pre', maxHeight: 420, overflow: 'auto' }}>
{JSON.stringify(detailRow?.responsePayload || {}, null, 2)}
            </pre>
          </Card>

          {detailRow?.error ? (
            <Card size="small" title="Error">
              <div style={{ whiteSpace: 'pre-wrap', color: '#cf1322' }}>{detailRow.error}</div>
            </Card>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={mcpEditRow ? 'Edit MCP Server' : 'Add MCP Server'}
        open={mcpModalOpen && !isReadonly}
        onCancel={() => setMcpModalOpen(false)}
        onOk={submitMcpModal}
        okText={mcpEditRow ? 'Save' : 'Create'}
      >
        <Form form={mcpEditForm} layout="vertical">
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input disabled={!!mcpEditRow} placeholder="mcp-server-name" />
          </Form.Item>
          <Form.Item label="Title" name="title">
            <Input placeholder="MCP Server" />
          </Form.Item>
          <Form.Item
            label="Endpoint"
            name="endpoint"
            rules={[{ required: true, message: 'Endpoint is required' }]}
          >
            <Input placeholder="https://host/mcp-connect/..." />
          </Form.Item>
          <Form.Item label="Token" name="token">
            <Input.Password placeholder="optional token" />
          </Form.Item>
          <Form.Item label="Enabled" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={skillEditRow ? 'Edit Skill' : 'Add Skill'}
        open={skillModalOpen && !isReadonly}
        onCancel={() => setSkillModalOpen(false)}
        onOk={submitSkillModal}
        okText={skillEditRow ? 'Save' : 'Create'}
        confirmLoading={skillContentLoading}
      >
        <Form
          form={skillEditForm}
          layout="vertical"
          onValuesChange={(changed) => {
            if (Object.prototype.hasOwnProperty.call(changed, 'content')) {
              setSkillContentPreview(String(changed.content || ''));
            }
          }}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input disabled={!!skillEditRow} placeholder="skill-name" />
          </Form.Item>
          <Form.Item label="Version" name="version">
            <Input placeholder="v1" />
          </Form.Item>
          <Form.Item label="Route" name="route">
            <Input placeholder="ticket_triage" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional description" />
          </Form.Item>
          <Form.Item label="Content (SKILL.md)" name="content">
            <Input.TextArea rows={8} placeholder="Write skill instructions here" />
          </Form.Item>
          <div style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">Preview</Typography.Text>
            <div
              style={{
                marginTop: 8,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: 12,
                background: '#fafafa',
                maxHeight: 280,
                overflow: 'auto',
              }}
            >
              {renderMarkdown(String(skillContentPreview || ''))}
            </div>
          </div>
          <Form.Item label="Enabled" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
