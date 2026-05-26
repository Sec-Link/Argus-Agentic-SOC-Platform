import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  createPublishedDetectionRule,
  deleteDetectionRule,
  getDetectionRule,
  getPublishedDetectionRule,
  getPublishedRuleVersions,
  listDetectionMappings,
  listDetectionRules,
  listPublishedDetectionRules,
  rollbackPublishedRuleVersion,
  saveDetectionRule,
  uploadDetectionMappings,
  uploadDetectionRules,
} from 'services/detections';

type RuleRow = {
  id: string;
  name?: string;
  version?: number;
  level?: string;
  status?: string;
  logsource?: string;
  profile?: string;
  tags?: string[];
};

type LocalMapRow = { id: string | number; sigma: string; splunk: string; elastic: string; mapping_profile?: string };
type DeployRow = { id: string; ruleId: string; target: 'splunk-dev' | 'elastic-dev'; status: 'success' | 'failed'; createdAt: string };
const STORAGE_DEPLOY = 'detection-hub-deployments-v1';

function pick(yaml: string, key: string) {
  const line = String(yaml || '')
    .split(/\r?\n/)
    .find((x) => x.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  if (!line) return '';
  return line.split(':').slice(1).join(':').trim();
}

function parseYamlList(yaml: string, key: string): string[] {
  const lines = String(yaml || '').split(/\r?\n/);
  const start = lines.findIndex((x) => x.trim().toLowerCase() === `${key.toLowerCase()}:`);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('  ') && !line.startsWith('\t')) break;
    const t = line.trim();
    if (t.startsWith('- ')) out.push(t.slice(2).trim());
  }
  return out;
}

function section(yaml: string, name: string) {
  const lines = String(yaml || '').split(/\r?\n/);
  const start = lines.findIndex((x) => x.trim().toLowerCase() === `${name.toLowerCase()}:`);
  if (start < 0) return '';
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

export default function Detections() {
  const { message } = App.useApp();
  const [topTab, setTopTab] = useState('rules');
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRuleIds, setSelectedRuleIds] = useState<React.Key[]>([]);

  const [selectedId, setSelectedId] = useState('');
  const [yaml, setYaml] = useState('');
  const [version, setVersion] = useState<number>(1);
  const [versions, setVersions] = useState<any[]>([]);
  const [detailTab, setDetailTab] = useState<'sigma' | 'splunk' | 'elastic' | 'test' | 'version'>('sigma');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState('');
  const [editorYaml, setEditorYaml] = useState('');
  const [compiled, setCompiled] = useState<{ splunk?: string; kql?: string; profiles?: string[] }>({});

  const [maps, setMaps] = useState<LocalMapRow[]>([]);
  const [deployments, setDeployments] = useState<DeployRow[]>([]);
  const [githubUrl, setGithubUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [mappingUploading, setMappingUploading] = useState(false);

  const loadRules = async () => {
    setLoading(true);
    try {
      const list = await listDetectionRules();
      setRules(Array.isArray(list) ? (list as RuleRow[]) : []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  };

  const loadMappings = async () => {
    try {
      const list = await listDetectionMappings();
      const rows = (Array.isArray(list) ? list : []).map((r: any) => ({
        id: r.id,
        sigma: String(r.sigma || ''),
        splunk: String(r.splunk || ''),
        elastic: String(r.elastic || ''),
        mapping_profile: String(r.mapping_profile || ''),
      }));
      setMaps(rows);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Failed to load mappings');
      setMaps([]);
    }
  };

  const loadDetail = async (id: string) => {
    const d = await getDetectionRule(id);
    setSelectedId(id);
    setYaml(String(d?.yaml || ''));
    setVersion(Number(d?.version || 1));
    setCompiled((d?.compiled && typeof d.compiled === 'object') ? d.compiled : {});
    try {
      const v = await getPublishedRuleVersions(id);
      setVersions(Array.isArray(v?.data) ? v.data : []);
    } catch {
      setVersions([]);
    }
  };

  useEffect(() => {
    loadRules();
    loadMappings();
    try {
      setDeployments(JSON.parse(localStorage.getItem(STORAGE_DEPLOY) || '[]'));
    } catch {
      setDeployments([]);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      const name = String(r.name || r.id || '').toLowerCase();
      const logsource = String(r.logsource || '').toLowerCase();
      const profile = String(r.profile || '').toLowerCase();
      const level = String(r.level || '').toLowerCase() || 'medium';
      const status = String(r.status || '').toLowerCase() || 'draft';
      const tags = (Array.isArray(r.tags) ? r.tags : []).join(',').toLowerCase();
      if (q && !`${r.id} ${name} ${logsource} ${profile} ${tags}`.includes(q)) return false;
      if (productFilter !== 'all' && !logsource.includes(productFilter.toLowerCase())) return false;
      if (severityFilter !== 'all' && level !== severityFilter) return false;
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      return true;
    });
  }, [rules, search, productFilter, severityFilter, statusFilter]);

  const productOptions = useMemo(() => {
    const values = Array.from(new Set(rules
      .map((r) => String(r.logsource || '').split('/')[0].trim().toLowerCase())
      .filter(Boolean)));
    return [{ value: 'all', label: '全部产品' }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rules]);

  const severityOptions = useMemo(() => {
    const values = Array.from(new Set(rules.map((r) => String(r.level || '').trim().toLowerCase()).filter(Boolean)));
    const base = ['critical', 'high', 'medium', 'low'];
    const ordered = [...base.filter((x) => values.includes(x)), ...values.filter((x) => !base.includes(x))];
    return [{ value: 'all', label: '全部级别' }, ...ordered.map((v) => ({ value: v, label: v }))];
  }, [rules]);

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(rules.map((r) => String(r.status || '').trim().toLowerCase()).filter(Boolean)));
    return [{ value: 'all', label: '全部状态' }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rules]);

  const parsed = useMemo(() => {
    const title = pick(yaml, 'title') || selectedId;
    const level = pick(yaml, 'level') || 'medium';
    const status = pick(yaml, 'status') || 'draft';
    const source = pick(yaml, 'product') || 'unknown';
    const category = pick(yaml, 'category') || 'unknown';
    const desc = pick(yaml, 'description') || '';
    const tags = parseYamlList(yaml, 'tags').join(', ');
    return { title, level, status, source, category, desc, tags };
  }, [yaml, selectedId]);

  const publish = async (target: 'splunk' | 'elastic') => {
    if (!selectedId) return;
    try {
      const payload = {
        name: parsed.title,
        type: 'query',
        enabled: true,
        severity: parsed.level,
        query: target === 'splunk' ? (compiled.splunk || '*') : (compiled.kql || '*'),
        language: target === 'splunk' ? 'spl' : 'kuery',
        tags: ['sigma', target],
      };
      const existing = await listPublishedDetectionRules({ page: 1, per_page: 100, filter: parsed.title });
      const found = (existing?.data || []).find((x: any) => String(x?.name || '') === parsed.title);
      if (found?.id) {
        const full = await getPublishedDetectionRule(found.id);
        await createPublishedDetectionRule({ ...full, ...payload, id: undefined, rule_id: undefined });
      } else {
        await createPublishedDetectionRule(payload);
      }
      const row: DeployRow = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ruleId: selectedId,
        target: target === 'splunk' ? 'splunk-dev' : 'elastic-dev',
        status: 'success',
        createdAt: new Date().toISOString(),
      };
      const next = [row, ...deployments];
      setDeployments(next);
      localStorage.setItem(STORAGE_DEPLOY, JSON.stringify(next));
      message.success(`Published ${target}`);
    } catch {
      const row: DeployRow = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ruleId: selectedId,
        target: target === 'splunk' ? 'splunk-dev' : 'elastic-dev',
        status: 'failed',
        createdAt: new Date().toISOString(),
      };
      const next = [row, ...deployments];
      setDeployments(next);
      localStorage.setItem(STORAGE_DEPLOY, JSON.stringify(next));
      message.error(`Publish ${target} failed`);
    }
  };

  const importGithub = async () => {
    const url = githubUrl.trim();
    if (!url) return message.error('GitHub raw URL is required');
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      const text = await resp.text();
      const id = pick(text, 'id') || `sigma-${Date.now()}`;
      await saveDetectionRule(id, text);
      await loadRules();
      await loadDetail(id);
      setTopTab('rules');
      message.success(`Imported ${id}`);
    } catch (e: any) {
      message.error(e?.message || 'Import failed');
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await uploadDetectionRules(files);
      await loadRules();
      message.success(`上传完成: 新增 ${res?.created || 0}，更新 ${res?.updated || 0}，跳过 ${res?.skipped || 0}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const deleteSelectedRules = async () => {
    if (!selectedRuleIds.length) return;
    const ids = selectedRuleIds.map((x) => String(x));
    await Promise.all(ids.map((id) => deleteDetectionRule(id)));
    if (selectedId && ids.includes(selectedId)) setSelectedId('');
    setSelectedRuleIds([]);
    await loadRules();
    message.success(`已删除 ${ids.length} 条规则`);
  };

  const ruleColumns: ColumnsType<RuleRow> = [
    { title: '规则名称', dataIndex: 'name', key: 'name', render: (_, r) => <span style={{ fontWeight: 700 }}>{r.name || r.id}</span> },
    {
      title: '级别',
      key: 'level',
      width: 100,
      render: (_, r) => {
        const level = String(r.level || 'medium').toLowerCase();
        const color = level === 'critical' ? 'red' : level === 'high' ? 'volcano' : level === 'medium' ? 'gold' : 'blue';
        return <Tag color={color}>{level}</Tag>;
      },
    },
    { title: '状态', key: 'status', width: 100, render: (_, r) => <Tag color="orange">{r.status || 'draft'}</Tag> },
    { title: '日志源', dataIndex: 'logsource', key: 'logsource', width: 220, render: (v) => v || '-' },
    { title: 'Profile', dataIndex: 'profile', key: 'profile', width: 200, render: (v) => v || '-' },
    { title: '标签', key: 'tags', render: (_, r) => Array.isArray(r.tags) && r.tags.length ? r.tags.join(', ') : '-' },
    { title: '发布', key: 'publish', width: 100, render: () => '未发布' },
  ];

  const saveRule = async () => {
    if (!editorId.trim() || !editorYaml.trim()) return message.error('Rule ID and YAML are required');
    await saveDetectionRule(editorId.trim(), editorYaml);
    setEditorOpen(false);
    await loadRules();
    await loadDetail(editorId.trim());
  };

  const mappingColumns: ColumnsType<LocalMapRow> = [
    { title: 'Profile', dataIndex: 'mapping_profile', key: 'mapping_profile', width: 220 },
    { title: 'Sigma', dataIndex: 'sigma', key: 'sigma' },
    { title: 'Splunk', dataIndex: 'splunk', key: 'splunk' },
    { title: 'Elastic ECS', dataIndex: 'elastic', key: 'elastic' },
  ];

  const handleUploadMappings = async (files: File[]) => {
    if (!files.length) return;
    setMappingUploading(true);
    try {
      const res = await uploadDetectionMappings(files);
      await loadMappings();
      message.success(`映射上传完成: 新增 ${res?.created || 0}，更新 ${res?.updated || 0}，跳过 ${res?.skipped || 0}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '映射上传失败');
    } finally {
      setMappingUploading(false);
    }
  };

  const deployColumns: ColumnsType<DeployRow> = [
    { title: 'Rule', dataIndex: 'ruleId', key: 'ruleId' },
    { title: 'Target', dataIndex: 'target', key: 'target' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v) => v === 'success' ? <Tag color="green">success</Tag> : <Tag color="red">failed</Tag> },
    { title: 'Time', dataIndex: 'createdAt', key: 'createdAt' },
  ];

  const rulesContent = () => {
    if (!selectedId) {
      return (
        <Card>
          <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Space>
              <Input.Search placeholder="搜索规则、标签、数据源" value={search} onChange={(e) => setSearch(e.target.value)} onSearch={loadRules} style={{ width: 560 }} />
              <Select value={productFilter} onChange={setProductFilter} style={{ width: 160 }} options={productOptions} />
              <Select value={severityFilter} onChange={setSeverityFilter} style={{ width: 140 }} options={severityOptions} />
              <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }} options={statusOptions} />
            </Space>
            <Space>
              <Typography.Text type="secondary">显示 {filtered.length} / {rules.length} 条，内置 SigmaHQ {Math.max(0, rules.length - 1)} 条</Typography.Text>
              <Popconfirm
                title={`确认删除选中的 ${selectedRuleIds.length} 条规则？`}
                okText="删除"
                cancelText="取消"
                disabled={!selectedRuleIds.length}
                onConfirm={deleteSelectedRules}
              >
                <Button danger disabled={!selectedRuleIds.length}>删除选中规则</Button>
              </Popconfirm>
              <Button loading={uploading} onClick={() => document.getElementById('detection-upload-files')?.click()}>上传文件</Button>
              <Button loading={uploading} onClick={() => document.getElementById('detection-upload-folder')?.click()}>上传文件夹</Button>
              <Button type="primary" onClick={() => { setEditorId(''); setEditorYaml(''); setEditorOpen(true); }}>新建规则</Button>
              <input
                id="detection-upload-files"
                type="file"
                accept=".yml,.yaml"
                multiple
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  await handleUploadFiles(files);
                  e.currentTarget.value = '';
                }}
              />
              <input
                id="detection-upload-folder"
                type="file"
                accept=".yml,.yaml"
                multiple
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  await handleUploadFiles(files);
                  e.currentTarget.value = '';
                }}
                {...({ webkitdirectory: 'true', directory: 'true' } as any)}
              />
            </Space>
          </Space>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={filtered}
            columns={ruleColumns}
            rowSelection={{
              selectedRowKeys: selectedRuleIds,
              onChange: (keys) => setSelectedRuleIds(keys),
            }}
            pagination={{ pageSize: 12 }}
            onRow={(r) => ({ onClick: () => loadDetail(r.id) })}
          />
        </Card>
      );
    }

    const tabText = detailTab === 'sigma'
      ? section(yaml, 'detection') || yaml
      : detailTab === 'splunk'
      ? (compiled.splunk || '*')
      : detailTab === 'elastic'
      ? (compiled.kql || '*')
      : detailTab === 'test'
      ? '测试入口预留（可接 /detections/test）'
      : versions.map((v) => `v${v.version} ${v.change_type || 'update'} ${v.created_at || ''}`).join('\n') || 'No versions';

    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <Button onClick={() => setSelectedId('')}>返回列表</Button>
          <Space>
            <Button onClick={() => { setEditorId(selectedId); setEditorYaml(yaml); setEditorOpen(true); }}>编辑</Button>
            <Button type="primary" onClick={() => publish('splunk')}>发布 Splunk</Button>
            <Button type="primary" onClick={() => publish('elastic')}>发布 Elastic 到 Kibana</Button>
          </Space>
        </div>

        <Typography.Title level={2} style={{ marginTop: 0 }}>{parsed.title}</Typography.Title>
        <Space style={{ marginBottom: 10 }}>
          <Tag color="red">{parsed.level}</Tag>
          <Tag color="orange">{parsed.status}</Tag>
          <Typography.Text type="secondary">v{version}</Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary">{parsed.desc || 'No description'}</Typography.Paragraph>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          <Card size="small" title="日志源">{parsed.source} / {parsed.category}</Card>
          <Card size="small" title="映射 Profile">{(compiled.profiles || []).slice(0, 4).join(', ') || `${parsed.source}_${parsed.category}`}</Card>
          <Card size="small" title="标签">{parsed.tags || '-'}</Card>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>Detection</Typography.Title>
          <Typography.Text type="secondary">{section(yaml, 'detection') ? '检测字段就绪' : '0 个检测字段'}</Typography.Text>
        </div>

        <Space style={{ marginBottom: 10 }}>
          <Button type={detailTab === 'sigma' ? 'primary' : 'default'} onClick={() => setDetailTab('sigma')}>Sigma</Button>
          <Button type={detailTab === 'splunk' ? 'primary' : 'default'} onClick={() => setDetailTab('splunk')}>Splunk SPL</Button>
          <Button type={detailTab === 'elastic' ? 'primary' : 'default'} onClick={() => setDetailTab('elastic')}>Elastic KQL</Button>
          <Button type={detailTab === 'test' ? 'primary' : 'default'} onClick={() => setDetailTab('test')}>测试</Button>
          <Button type={detailTab === 'version' ? 'primary' : 'default'} onClick={() => setDetailTab('version')}>版本</Button>
        </Space>

        {detailTab === 'version' ? (
          <Space wrap style={{ marginBottom: 10 }}>
            {versions.map((v) => (
              <Button key={v.version} size="small" onClick={async () => { await rollbackPublishedRuleVersion(selectedId, v.version); await loadDetail(selectedId); message.success(`已回滚到 v${v.version}`); }}>
                回滚到 v{v.version}
              </Button>
            ))}
          </Space>
        ) : null}

        <pre
          style={{
            margin: 0,
            background: '#0c1733',
            color: '#e8eefc',
            borderRadius: 8,
            padding: 16,
            minHeight: 220,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {tabText}
        </pre>
      </Card>
    );
  };

  return (
    <>
      <Tabs
        activeKey={topTab}
        onChange={setTopTab}
        items={[
          { key: 'rules', label: '规则库', children: rulesContent() },
          {
            key: 'mappings',
            label: '字段映射',
            children: (
              <Card>
                <Space style={{ marginBottom: 12 }}>
                  <Button loading={mappingUploading} onClick={() => document.getElementById('detection-upload-mappings-files')?.click()}>上传映射文件</Button>
                  <Button loading={mappingUploading} onClick={() => document.getElementById('detection-upload-mappings-folder')?.click()}>上传映射文件夹</Button>
                  <Button onClick={loadMappings}>刷新</Button>
                  <input
                    id="detection-upload-mappings-files"
                    type="file"
                    accept=".json,.csv"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      await handleUploadMappings(files);
                      e.currentTarget.value = '';
                    }}
                  />
                  <input
                    id="detection-upload-mappings-folder"
                    type="file"
                    accept=".json,.csv"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      await handleUploadMappings(files);
                      e.currentTarget.value = '';
                    }}
                    {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                  />
                </Space>
                <Table rowKey="id" dataSource={maps} columns={mappingColumns} pagination={{ pageSize: 10 }} />
              </Card>
            ),
          },
          {
            key: 'deployments',
            label: '发布记录',
            children: <Card><Table rowKey="id" dataSource={deployments} columns={deployColumns} pagination={{ pageSize: 10 }} /></Card>,
          },
          {
            key: 'github',
            label: 'GitHub导入',
            children: (
              <Card>
                <Space>
                  <Input placeholder="https://raw.githubusercontent.com/.../rule.yml" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} style={{ width: 600 }} />
                  <Button type="primary" onClick={importGithub}>导入</Button>
                </Space>
              </Card>
            ),
          },
        ]}
      />
      <Modal title={editorId ? `编辑规则 ${editorId}` : '新建规则'} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={saveRule} width={980}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="Rule ID" value={editorId} onChange={(e) => setEditorId(e.target.value)} />
          <Input.TextArea rows={18} value={editorYaml} onChange={(e) => setEditorYaml(e.target.value)} placeholder="Paste Sigma YAML" />
        </Space>
      </Modal>
    </>
  );
}


