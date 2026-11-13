import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography, message as antdMessage } from 'antd';
import { getIsReadonly } from '../../lib/auth';
import { getRbacMe } from 'services/accounts';
import HttpToolsSettings from './HttpToolsSettings';
import AgentSettings from './AgentSettings';
import ExecutionSettings from './ExecutionSettings';
import ModelSettings from './ModelSettings';
import AiUsageMonitor from './AiUsageMonitor';
import McpToolApprovals from './McpToolApprovals';
import {
  createAiAssistantMcpServer,
  createAiAssistantSkillConfig,
  deleteAiAssistantMcpServer,
  deleteAiAssistantSkillConfig,
  fetchAiAssistantInternalMcpTools,
  fetchAiAssistantSkillCatalog,
  fetchAiAssistantSkillContent,
  listAiAssistantMcpServers,
  listAiAssistantToolAccessRoles,
  listAiAssistantSkillConfigs,
  updateAiAssistantMcpServer,
  updateAiAssistantSkillConfig,
  updateAiAssistantSkillContent,
  type ToolAccessRole,
} from '../../api';

export default function AiAssistantSettings() {
  const [message, messageContextHolder] = antdMessage.useMessage();
  const [mcpEditForm] = Form.useForm();
  const clearingMcpToken = Form.useWatch('clear_token', mcpEditForm);
  const [skillEditForm] = Form.useForm();
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpEditRow, setMcpEditRow] = useState<any | null>(null);
  const [mcpToolsRow, setMcpToolsRow] = useState<{ name: string; title?: string } | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<any[]>([]);
  const [skillConfigs, setSkillConfigs] = useState<any[]>([]);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillEditRow, setSkillEditRow] = useState<any | null>(null);
  const [skillContentLoading, setSkillContentLoading] = useState(false);
  const [skillContentReady, setSkillContentReady] = useState(false);
  const [skillContentError, setSkillContentError] = useState('');
  const [skillSaving, setSkillSaving] = useState(false);
  const skillLoadSequence = useRef(0);
  const [skillPermissions, setSkillPermissions] = useState<string[] | null>(null);
  const [skillsError, setSkillsError] = useState('');
  const [skillContentPreview, setSkillContentPreview] = useState('');
  const [internalMcpTools, setInternalMcpTools] = useState<any[]>([]);
  const [isReadonly, setIsReadonly] = useState(false);
  const [toolAccessRoles, setToolAccessRoles] = useState<ToolAccessRole[]>([]);
  const [canManageHttpAccess, setCanManageHttpAccess] = useState(false);
  const [canManageMcpAccess, setCanManageMcpAccess] = useState(false);
  const [canDisableApproval, setCanDisableApproval] = useState(false);
  const [toolAccessError, setToolAccessError] = useState('');
  const [toolAccessReady, setToolAccessReady] = useState(false);
  useEffect(() => { setIsReadonly(getIsReadonly()); }, []);
  const canViewSkills = !!skillPermissions?.includes('view');
  const canAddSkills = canViewSkills && !isReadonly && !!skillPermissions?.includes('add');
  const canChangeSkills = canViewSkills && !isReadonly && !!skillPermissions?.includes('change');
  const canDeleteSkills = canViewSkills && !isReadonly && !!skillPermissions?.includes('delete');
  const skillConfigMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of skillConfigs) {
      if (row?.name) map.set(row.name, row);
    }
    return map;
  }, [skillConfigs]);

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

  const loadToolAccess = async () => {
    setToolAccessReady(false);
    setToolAccessError('');
    setCanManageHttpAccess(false);
    setCanManageMcpAccess(false);
    setCanDisableApproval(false);
    try {
      const me = await getRbacMe();
      const permissions: string[] = Array.isArray(me?.permissions) ? me.permissions : [];
      setSkillPermissions(['view', 'add', 'change', 'delete'].filter((action) =>
        !!me?.is_superuser || permissions.includes(`ai_assistant.${action}_skillconfig`)));
      const httpAccess = !!me?.is_superuser || permissions.includes('ai_assistant.manage_access_httptoolconfig');
      const mcpAccess = !!me?.is_superuser || permissions.includes('ai_assistant.manage_access_externalmcpserver');
      const roles = httpAccess || mcpAccess ? await listAiAssistantToolAccessRoles() : [];
      setToolAccessRoles(roles);
      setCanManageHttpAccess(httpAccess);
      setCanManageMcpAccess(mcpAccess);
      setCanDisableApproval(!!me?.is_superuser);
      setToolAccessReady(true);
    } catch {
      setSkillPermissions((current) => current ?? []);
      setToolAccessError('Could not load tool access permissions. Role editing and automatic approval are unavailable.');
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
    } catch (error: any) {
      setSkillsError(error?.response?.status === 403 ? 'You do not have permission to view skill configurations.' : 'Failed to load skill configs. Please retry.');
      setSkillConfigs([]);
    }
  };

  const loadSkills = async () => {
    if (!canViewSkills) return;
    setSkillsError('');
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
    void loadToolAccess();
    loadMcpServers();
    loadInternalMcpTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (canViewSkills) void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewSkills]);

  const openMcpModal = (row?: any) => {
    if (!toolAccessReady || isReadonly) return;
    setMcpEditRow(row || null);
    mcpEditForm.setFieldsValue({
      name: row?.name || '',
      title: row?.title || '',
      endpoint: row?.endpoint || '',
      token: '',
      clear_token: false,
      enabled: row?.enabled !== false,
      use_group_ids: row?.use_group_ids || [],
    });
    setMcpModalOpen(true);
  };

  const submitMcpModal = async () => {
    if (!toolAccessReady || isReadonly) return;
    const values = await mcpEditForm.validateFields();
    try {
      if (mcpEditRow?.name) {
        await updateAiAssistantMcpServer(mcpEditRow.name, {
          title: values.title || '',
          endpoint: values.endpoint || '',
          ...(values.token ? { token: values.token } : {}),
          ...(values.clear_token ? { clear_token: true } : {}),
          enabled: values.enabled !== false,
          ...(canManageMcpAccess ? { use_group_ids: values.use_group_ids || [] } : {}),
        });
        message.success('MCP updated');
      } else {
        await createAiAssistantMcpServer({
          name: values.name,
          title: values.title || '',
          endpoint: values.endpoint,
          token: values.token || '',
          enabled: values.enabled !== false,
          ...(canManageMcpAccess ? { use_group_ids: values.use_group_ids || [] } : {}),
        });
        message.success('MCP created');
      }
      setMcpModalOpen(false);
      setMcpEditRow(null);
      await loadMcpServers();
    } catch (err: any) {
      const data = err?.response?.data;
      const apiError = data?.error || data?.detail || (data && Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(' ') : String(value)}`).join(' '));
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
    if (!canChangeSkills || (!row && !canAddSkills)) return;
    const sequence = ++skillLoadSequence.current;
    setSkillContentReady(!row?.name);
    setSkillContentError('');
    setSkillContentLoading(!!row?.name);
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
      fetchAiAssistantSkillContent(row.name)
        .then((res) => {
          if (sequence !== skillLoadSequence.current) return;
          if (typeof res?.content !== 'string') throw new Error('Invalid skill content response');
          const content = res.content;
          skillEditForm.setFieldsValue({ content });
          setSkillContentPreview(content);
          setSkillContentReady(true);
        })
        .catch(() => {
          if (sequence !== skillLoadSequence.current) return;
          setSkillContentError('Could not load skill content. Saving is disabled; close and reopen to retry.');
        })
        .finally(() => { if (sequence === skillLoadSequence.current) setSkillContentLoading(false); });
    }
  };

  const submitSkillModal = async () => {
    if (!canChangeSkills || (!skillEditRow && !canAddSkills) || !skillContentReady || skillContentLoading || skillSaving) return;
    const values = await skillEditForm.validateFields();
    setSkillSaving(true);
    let configSaved = false;
    try {
      if (skillEditRow?.name) {
        await updateAiAssistantSkillConfig(skillEditRow.name, {
          version: values.version || 'v1',
          route: values.route || values.name,
          enabled: values.enabled !== false,
          description: values.description || '',
        });
        configSaved = true;
        await updateAiAssistantSkillContent(skillEditRow.name, {
          content: values.content || '',
          title: values.name || skillEditRow.name,
          description: values.description || '',
        });
        message.success('Skill updated');
      } else {
        const created = await createAiAssistantSkillConfig({
          name: values.name,
          version: values.version || 'v1',
          route: values.route || values.name,
          enabled: values.enabled !== false,
          description: values.description || '',
        });
        configSaved = true;
        setSkillEditRow({ ...values, ...created, name: values.name });
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
      message.error(configSaved ? 'Skill configuration was saved, but content saving could not be confirmed. Check the content before retrying.' : apiError ? String(apiError) : 'Failed to save skill');
      if (configSaved) await loadSkillConfigs();
    } finally {
      setSkillSaving(false);
    }
  };

  const onDeleteSkill = async (row: any) => {
    if (!canDeleteSkills) return;
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
    if (existing ? !canChangeSkills : !canAddSkills) return;
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
      {messageContextHolder}
      {toolAccessError && <Alert type="warning" showIcon message={toolAccessError} action={<Button size="small" onClick={() => void loadToolAccess()}>Retry</Button>} style={{ marginBottom: 16 }} />}
      {!toolAccessReady && !toolAccessError && <Typography.Paragraph type="secondary">Loading tool permissions…</Typography.Paragraph>}
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        AI Assistant Settings
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Models, Execution limits, Agents, MCP, Skills and HTTP Tools are managed server-side. Enable a model in Models to make it available in conversations.
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
        defaultActiveKey="models"
        items={[
          {
            key: 'models',
            label: 'Models',
            children: <ModelSettings readonly={isReadonly} />,
          },
          {
            key: 'execution-limits',
            label: 'Execution limits',
            children: <ExecutionSettings readonly={isReadonly} />,
          },
          {
            key: 'agents',
            label: 'Agents',
            children: <AgentSettings readonly={isReadonly} />,
          },
          {
            key: 'http-tools',
            label: 'Tools',
            children: <HttpToolsSettings readonly={isReadonly || !toolAccessReady} roles={toolAccessRoles} canManageAccess={canManageHttpAccess} canDisableApproval={canDisableApproval} />,
          },
          {
            key: 'tool-monitor',
            label: 'AI tool monitor',
            children: <AiUsageMonitor kind="tools" />,
          },
          {
            key: 'model-monitor',
            label: 'Model usage',
            children: <AiUsageMonitor kind="models" />,
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
                      {isReadonly ? null : <Button type="primary" disabled={!toolAccessReady} onClick={() => openMcpModal()}>Add MCP</Button>}
                    </Space>
                  )}
                >
                  <Typography.Paragraph type="secondary">Only users in a server's allowed roles can provide its tools to AI and approve their own calls. No roles selected means only superusers have access. Changes by other users restore required approval for all tools on the server.</Typography.Paragraph>
                  <Table
                    size="small"
                    rowKey={(r: any) => r.name}
                    loading={mcpLoading}
                    pagination={{ pageSize: 6 }}
                    scroll={{ x: 850 }}
                    dataSource={mcpServers}
                    locale={{ emptyText: 'No MCP servers configured' }}
                    columns={[
                      { title: 'Name', dataIndex: 'name', key: 'name' },
                      { title: 'Title', dataIndex: 'title', key: 'title', render: (v: string) => v || '-' },
                      { title: 'Endpoint', dataIndex: 'endpoint', key: 'endpoint', ellipsis: true },
                      { title: 'Allowed roles', key: 'use_group_ids', render: (_: any, row: any) => row.use_group_ids?.length ? row.use_group_ids.map((id: number) => <Tag key={id}>{toolAccessRoles.find((role) => role.id === id)?.name || `Role #${id}`}</Tag>) : 'Superusers only' },
                      {
                        title: 'Enabled',
                        key: 'enabled',
                        width: 110,
                        render: (_: any, row: any) => (
                          <Switch disabled={isReadonly || !toolAccessReady} checked={row.enabled !== false} onChange={(checked) => onToggleMcp(row, checked)} />
                        ),
                      },
                      ...(isReadonly ? [] : [{
                        title: 'Action',
                        key: 'action',
                        width: 310,
                        render: (_: any, row: any) => (
                          <Space>
                            <Button size="small" disabled={!toolAccessReady} onClick={() => openMcpModal(row)}>Edit</Button>
                            <Button size="small" disabled={!toolAccessReady} onClick={() => setMcpToolsRow({ name: row.name, title: row.title })}>Configure tools</Button>
                            <Button danger size="small" disabled={!toolAccessReady} onClick={() => onDeleteMcp(row)}>Delete</Button>
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
            children: !canViewSkills ? <Alert type="info" showIcon message={skillPermissions === null ? 'Loading skill permissions…' : 'You do not have permission to view skill configurations.'} /> : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {skillsError && <Alert type="error" showIcon message={skillsError} />}
                <Card
                  title="Configured Skills"
                  extra={(
                    <Space>
                      <Button onClick={() => loadSkills()} loading={skillsLoading}>Refresh</Button>
                      {canAddSkills && canChangeSkills && <Button type="primary" onClick={() => openSkillModal()}>Add Skill</Button>}
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
                          <Switch disabled={!canChangeSkills} checked={row.enabled !== false} onChange={(checked) => updateAiAssistantSkillConfig(row.name, { enabled: checked }).then(loadSkillConfigs).catch(() => message.error('Failed to update skill'))} />
                        ),
                      },
                      ...(!canChangeSkills && !canDeleteSkills ? [] : [{
                        title: 'Action',
                        key: 'action',
                        width: 180,
                        render: (_: any, row: any) => (
                          <Space>
                            {canChangeSkills && <Button size="small" onClick={() => openSkillModal(row)}>Edit</Button>}
                            {canDeleteSkills && <Button danger size="small" onClick={() => onDeleteSkill(row)}>Delete</Button>}
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
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
        ]}
      />
      {mcpToolsRow && toolAccessReady && <McpToolApprovals server={mcpToolsRow} readonly={isReadonly} canDisableApproval={canDisableApproval} onClose={() => setMcpToolsRow(null)}
        onSaved={() => { setMcpToolsRow(null); message.success('MCP tool approvals saved'); void loadMcpServers(); }} />}

      <Modal
        title={mcpEditRow ? 'Edit MCP Server' : 'Add MCP Server'}
        open={mcpModalOpen && !isReadonly && toolAccessReady}
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
          {canManageMcpAccess && <Form.Item name="use_group_ids" label="Roles allowed to use this server" extra="Applies to all tools on this server. No roles selected means only superusers can use them."><Select mode="multiple" allowClear optionFilterProp="label" options={toolAccessRoles.map((role) => ({ value: role.id, label: role.name }))} placeholder="Select allowed roles" /></Form.Item>}
          {!canManageMcpAccess && <Typography.Paragraph type="secondary">Changing allowed roles requires the MCP access management permission.</Typography.Paragraph>}
          <Form.Item
            label="Endpoint"
            name="endpoint"
            rules={[{ required: true, message: 'Endpoint is required' }]}
          >
            <Input placeholder="https://host/mcp-connect/..." />
          </Form.Item>
          <Form.Item label={mcpEditRow?.has_token ? 'Replace saved token (optional)' : 'Token'} name="token" extra={mcpEditRow?.has_token ? 'Leave blank to keep the saved token. Changing the endpoint requires a replacement token or clearing it.' : undefined}>
            <Input.Password disabled={clearingMcpToken} autoComplete="new-password" placeholder={mcpEditRow?.has_token ? 'Saved token is not displayed' : 'Optional token'} />
          </Form.Item>
          {mcpEditRow?.has_token && <Form.Item name="clear_token" valuePropName="checked"><Checkbox onChange={(event) => { if (event.target.checked) mcpEditForm.setFieldValue('token', ''); }}>Clear saved token</Checkbox></Form.Item>}
          {mcpEditRow && <Typography.Paragraph type="secondary">{canDisableApproval ? 'Changing the endpoint or token resets per-tool approval choices to require approval.' : 'Saving changes requires approval for every tool on this server.'}</Typography.Paragraph>}
          <Form.Item label="Enabled" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={skillEditRow ? 'Edit Skill' : 'Add Skill'}
        open={skillModalOpen && canChangeSkills}
        onCancel={() => { if (!skillSaving) { skillLoadSequence.current++; setSkillModalOpen(false); } }}
        onOk={submitSkillModal}
        okText={skillEditRow ? 'Save' : 'Create'}
        confirmLoading={skillSaving}
        okButtonProps={{ disabled: !skillContentReady || skillContentLoading || skillSaving }}
        cancelButtonProps={{ disabled: skillSaving }}
      >
        {skillContentError && <Alert type="error" showIcon message={skillContentError} />}
        <Form
          form={skillEditForm}
          layout="vertical"
          disabled={skillContentLoading || skillSaving}
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
