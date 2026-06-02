import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  createPublishedDetectionRule,
  deletePublishedDetectionRule,
  deleteDetectionRule,
  getDetectionRule,
  getPublishedDetectionRule,
  getPublishedRuleVersions,
  listDetectionMappings,
  listPublishedConnectors,
  listDetectionRules,
  listPublishedDetectionRules,
  patchPublishedDetectionRule,
  rollbackPublishedRuleVersion,
  saveDetectionRule,
  updatePublishedDetectionRule,
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
  publish_status?: string;
  kibana_enabled?: boolean;
  kibana_rule_id?: string;
};

type LocalMapRow = { id: string | number; sigma: string; splunk: string; elastic: string; mapping_profile?: string };
type DeployRow = { id: string; ruleId: string; target: 'splunk-dev' | 'elastic-dev'; status: 'success' | 'failed'; createdAt: string };
type ConnectorRow = { id: string; name: string; connector_type_id?: string };
type KibanaMetadata = { published?: boolean; remote_id?: string; rule_id?: string; enabled?: boolean; name?: string; updated_at?: string };
const STORAGE_DEPLOY = 'detection-hub-deployments-v1';

function formatJson(value: any) {
  return JSON.stringify(value, null, 2);
}

function parseElasticActions(text: string) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Elastic actions must be a JSON array');
  return parsed;
}

function defaultConnectorParams(connectorTypeId?: string) {
  const typeId = String(connectorTypeId || '').toLowerCase();
  if (typeId.includes('.index')) {
    return {
      documents: [
        {
          '@timestamp': '{{context.alerts.0.@timestamp}}',
          title: '{{context.rule.name}}',
          description: '{{context.alerts.0.kibana.alert.reason}}',
          severity: '{{context.rule.severity}}',
          rule_id: '{{rule.id}}',
          alert_id: '{{alert.id}}',
        },
      ],
    };
  }
  if (typeId.includes('.email')) {
    return {
      to: [],
      cc: [],
      bcc: [],
      subject: '{{context.rule.name}}',
      message: '{{context.alerts.0.kibana.alert.reason}}',
    };
  }
  if (typeId.includes('.slack') || typeId.includes('.teams')) {
    return {
      message: '{{context.rule.name}}: {{context.alerts.0.kibana.alert.reason}}',
    };
  }
  if (typeId.includes('.webhook')) {
    return {
      body: {
        rule: '{{context.rule.name}}',
        reason: '{{context.alerts.0.kibana.alert.reason}}',
      },
    };
  }
  return {};
}

function guessElasticIndexPatternsFromProfile(profile?: string) {
  const p = String(profile || '').toLowerCase();
  if (!p) return ['logs-*'];
  if (p.includes('windows')) return ['logs-windows.*', 'winlogbeat-*'];
  if (p.includes('linux')) return ['logs-linux.*', 'filebeat-*'];
  if (p.includes('aws') || p.includes('cloudtrail')) return ['logs-aws.cloudtrail-*'];
  if (p.includes('azure')) return ['logs-azure.*'];
  if (p.includes('m365') || p.includes('o365') || p.includes('office365')) return ['logs-o365.audit-*'];
  if (p.includes('okta')) return ['logs-okta.system-*'];
  if (p.includes('network') || p.includes('proxy') || p.includes('firewall')) return ['logs-network.*'];
  if (p.includes('dns')) return ['logs-*-dns*'];
  return ['logs-*'];
}

function parseIndexPatterns(text: string) {
  return Array.from(new Set(
    String(text || '')
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function enrichElasticActions(actions: any[], connectors: ConnectorRow[]) {
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const connector = connectors.find((item) => item.id === String(action?.id || ''));
    const connectorTypeId = String(action?.action_type_id || connector?.connector_type_id || '').trim();
    let nextParams = action?.params;
    if (connectorTypeId.toLowerCase().includes('.index') && nextParams && !Array.isArray(nextParams?.documents) && nextParams?.document) {
      nextParams = {
        ...nextParams,
        documents: [nextParams.document],
      };
      delete nextParams.document;
    }
    return {
      ...action,
      ...(nextParams ? { params: nextParams } : {}),
      ...(connectorTypeId ? { action_type_id: connectorTypeId } : {}),
      frequency: {
        ...(action?.frequency || {}),
        summary: false,
        notifyWhen: 'onActiveAlert',
        throttle: null,
      },
    };
  });
}

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
  const [elasticActionsText, setElasticActionsText] = useState('[]');
  const [elasticIndexPatternsText, setElasticIndexPatternsText] = useState('');
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [connectorDraftId, setConnectorDraftId] = useState<string>('');
  const [selectedActionIndex, setSelectedActionIndex] = useState<number>(0);
  const [selectedActionParamsText, setSelectedActionParamsText] = useState('{}');
  const [kibanaMetadata, setKibanaMetadata] = useState<KibanaMetadata>({});

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

  const loadConnectors = async () => {
    try {
      const rows = await listPublishedConnectors();
      setConnectors(Array.isArray(rows) ? rows : []);
    } catch {
      setConnectors([]);
    }
  };

  const loadDetail = async (id: string) => {
    const d = await getDetectionRule(id);
    setSelectedId(id);
    setYaml(String(d?.yaml || ''));
    setVersion(Number(d?.version || 1));
    setCompiled((d?.compiled && typeof d.compiled === 'object') ? d.compiled : {});
    const actions = Array.isArray(d?.payload?.elastic_actions) ? d.payload.elastic_actions : [];
    setElasticActionsText(formatJson(actions));
    const profiles = Array.isArray(d?.compiled?.profiles) ? d.compiled.profiles : [];
    const fallbackProfile = profiles[0] || `${pick(String(d?.yaml || ''), 'product')}_${pick(String(d?.yaml || ''), 'category')}`;
    const indexPatterns = Array.isArray(d?.payload?.elastic_index_patterns) && d.payload.elastic_index_patterns.length
      ? d.payload.elastic_index_patterns
      : guessElasticIndexPatternsFromProfile(fallbackProfile);
    setElasticIndexPatternsText(indexPatterns.join('\n'));
    setKibanaMetadata((d?.payload?.kibana_metadata && typeof d.payload.kibana_metadata === 'object') ? d.payload.kibana_metadata : {});
    setSelectedActionIndex(0);
    setSelectedActionParamsText(formatJson(actions[0]?.params || {}));
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
    loadConnectors();
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
      const actions = target === 'elastic'
        ? enrichElasticActions(parseElasticActions(elasticActionsText), connectors)
        : [];
      const payload = {
        name: parsed.title,
        type: 'query',
        rule_id: selectedId,
        enabled: target === 'splunk',
        severity: parsed.level,
        description: parsed.desc || parsed.title,
        index: target === 'elastic' ? parseIndexPatterns(elasticIndexPatternsText) : undefined,
        query: target === 'splunk' ? (compiled.splunk || '*') : (compiled.kql || '*'),
        language: target === 'splunk' ? 'spl' : 'kuery',
        tags: ['sigma', target],
        ...(target === 'elastic' ? { actions } : {}),
      };
      const existing = await listPublishedDetectionRules({ page: 1, per_page: 100, filter: parsed.title });
      const found = (existing?.data || []).find((x: any) => String(x?.rule_id || '') === selectedId || String(x?.name || '') === parsed.title);
      let publishedRule: any;
      if (found?.id) {
        try {
          const full = await getPublishedDetectionRule(found.id);
          const { rule_id: _ruleId, ...fullWithoutRuleId } = full || {};
          const updatePayload = { ...fullWithoutRuleId, ...payload, id: found.id };
          publishedRule = await updatePublishedDetectionRule(found.id, updatePayload);
        } catch (e: any) {
          if (e?.response?.status === 404 || e?.response?.data?.status_code === 404) {
            publishedRule = await createPublishedDetectionRule(payload);
          } else {
            throw e;
          }
        }
      } else {
        publishedRule = await createPublishedDetectionRule(payload);
      }
      if (target === 'elastic') {
        const nextMetadata: KibanaMetadata = {
          published: true,
          remote_id: String(publishedRule?.id || found?.id || ''),
          rule_id: String(publishedRule?.rule_id || selectedId),
          enabled: Boolean(publishedRule?.enabled ?? payload.enabled),
          name: String(publishedRule?.name || payload.name || ''),
          updated_at: new Date().toISOString(),
        };
        await saveDetectionRule(selectedId, yaml, {
          elastic_actions: parseElasticActions(elasticActionsText),
          elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
          kibana_metadata: nextMetadata,
        });
        setKibanaMetadata(nextMetadata);
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
      await loadRules();
      await loadDetail(selectedId);
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
    {
      title: '发布',
      key: 'publish',
      width: 120,
      render: (_, r) => {
        if (r.publish_status === 'published') {
          return <Tag color={r.kibana_enabled ? 'green' : 'gold'}>{r.kibana_enabled ? 'Kibana启用' : 'Kibana已发布'}</Tag>;
        }
        return <Tag>未发布</Tag>;
      },
    },
  ];

  const saveRule = async () => {
    if (!editorId.trim() || !editorYaml.trim()) return message.error('Rule ID and YAML are required');
    try {
      const actions = parseElasticActions(elasticActionsText);
      const indexPatterns = parseIndexPatterns(elasticIndexPatternsText);
      await saveDetectionRule(editorId.trim(), editorYaml, { elastic_actions: actions, elastic_index_patterns: indexPatterns, kibana_metadata: kibanaMetadata });
      setEditorOpen(false);
      await loadRules();
      await loadDetail(editorId.trim());
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '保存规则失败');
    }
  };

  const saveElasticActions = async () => {
    if (!selectedId) return;
    try {
      const actions = parseElasticActions(elasticActionsText);
      const indexPatterns = parseIndexPatterns(elasticIndexPatternsText);
      await saveDetectionRule(selectedId, yaml, { elastic_actions: actions, elastic_index_patterns: indexPatterns, kibana_metadata: kibanaMetadata });
      await loadDetail(selectedId);
      message.success('Elastic Action 配置已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '保存 Elastic Action 配置失败');
    }
  };

  const syncKibanaEnabled = async (enabled: boolean) => {
    if (!selectedId) return;
    const remoteId = String(kibanaMetadata.remote_id || '').trim();
    if (!remoteId) return message.error('Kibana 规则尚未发布');
    try {
      const full = await getPublishedDetectionRule(remoteId);
      const updated = await patchPublishedDetectionRule(remoteId, { ...full, enabled });
      const nextMetadata: KibanaMetadata = {
        ...kibanaMetadata,
        published: true,
        remote_id: String(updated?.id || remoteId),
        rule_id: String(updated?.rule_id || kibanaMetadata.rule_id || selectedId),
        enabled: Boolean(updated?.enabled),
        name: String(updated?.name || kibanaMetadata.name || parsed.title),
        updated_at: new Date().toISOString(),
      };
      await saveDetectionRule(selectedId, yaml, {
        elastic_actions: parseElasticActions(elasticActionsText),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: nextMetadata,
      });
      setKibanaMetadata(nextMetadata);
      await loadRules();
      await loadDetail(selectedId);
      message.success(enabled ? 'Kibana 规则已启用' : 'Kibana 规则已禁用');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '更新 Kibana 规则失败');
    }
  };

  const deleteKibanaRule = async () => {
    if (!selectedId) return;
    const remoteId = String(kibanaMetadata.remote_id || '').trim();
    if (!remoteId) return message.error('Kibana 规则尚未发布');
    try {
      await deletePublishedDetectionRule(remoteId);
      const nextMetadata: KibanaMetadata = {
        published: false,
        remote_id: '',
        rule_id: String(kibanaMetadata.rule_id || selectedId),
        enabled: false,
        name: String(kibanaMetadata.name || parsed.title),
        updated_at: new Date().toISOString(),
      };
      await saveDetectionRule(selectedId, yaml, {
        elastic_actions: parseElasticActions(elasticActionsText),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: nextMetadata,
      });
      setKibanaMetadata(nextMetadata);
      await loadRules();
      await loadDetail(selectedId);
      message.success('Kibana 规则已删除');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '删除 Kibana 规则失败');
    }
  };

  const insertConnectorTemplate = () => {
    if (!connectorDraftId) return;
    try {
      const current = parseElasticActions(elasticActionsText);
      const connector = connectors.find((item) => item.id === connectorDraftId);
      current.push({
        group: 'default',
        id: connectorDraftId,
        ...(connector?.connector_type_id ? { action_type_id: connector.connector_type_id } : {}),
        params: defaultConnectorParams(connector?.connector_type_id),
        frequency: {
          summary: false,
          notifyWhen: 'onActiveAlert',
          throttle: null,
        },
      });
      setElasticActionsText(formatJson(current));
      setSelectedActionIndex(Math.max(current.length - 1, 0));
      setSelectedActionParamsText(formatJson(current[current.length - 1]?.params || {}));
    } catch (e: any) {
      message.error(e?.message || '当前 Action JSON 格式不正确');
    }
  };

  const syncSelectedActionParams = (nextIndex: number) => {
    try {
      const actions = parseElasticActions(elasticActionsText);
      const next = actions[nextIndex]?.params || {};
      setSelectedActionIndex(nextIndex);
      setSelectedActionParamsText(formatJson(next));
    } catch {
      setSelectedActionIndex(nextIndex);
      setSelectedActionParamsText('{}');
    }
  };

  const applySelectedActionParams = () => {
    try {
      const actions = parseElasticActions(elasticActionsText);
      if (!actions.length) throw new Error('当前还没有 action');
      const nextParams = JSON.parse(selectedActionParamsText || '{}');
      actions[selectedActionIndex] = {
        ...actions[selectedActionIndex],
        params: nextParams,
      };
      setElasticActionsText(formatJson(actions));
      message.success('已写入当前 action 的 params');
    } catch (e: any) {
      message.error(e?.message || '更新 action params 失败');
    }
  };

  const handleElasticActionsTextChange = (nextText: string) => {
    setElasticActionsText(nextText);
    try {
      const actions = parseElasticActions(nextText);
      const safeIndex = actions[selectedActionIndex] ? selectedActionIndex : 0;
      setSelectedActionIndex(safeIndex);
      setSelectedActionParamsText(formatJson(actions[safeIndex]?.params || {}));
    } catch {
      // Keep the raw editor editable even when JSON is temporarily invalid.
    }
  };

  const mappingColumns: ColumnsType<LocalMapRow> = [
    { title: 'Profile', dataIndex: 'mapping_profile', key: 'mapping_profile', width: 220 },
    { title: 'Sigma', dataIndex: 'sigma', key: 'sigma' },
    { title: 'Splunk', dataIndex: 'splunk', key: 'splunk' },
    { title: 'Elastic ECS', dataIndex: 'elastic', key: 'elastic' },
    {
      title: 'Elastic Index Patterns',
      key: 'elastic_index_patterns',
      width: 220,
      render: (_, r) => guessElasticIndexPatternsFromProfile(r.mapping_profile).join(', '),
    },
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
              <Button type="primary" onClick={() => { setEditorId(''); setEditorYaml(''); setElasticActionsText('[]'); setElasticIndexPatternsText('logs-*'); setSelectedActionIndex(0); setSelectedActionParamsText('{}'); setKibanaMetadata({}); setEditorOpen(true); }}>新建规则</Button>
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
        <Card
          size="small"
          title="Kibana 检测规则"
          style={{ marginBottom: 16 }}
          extra={kibanaMetadata.published ? <Tag color={kibanaMetadata.enabled ? 'green' : 'gold'}>{kibanaMetadata.enabled ? '已启用' : '已发布未启用'}</Tag> : <Tag>未发布</Tag>}
        >
          <Space wrap>
            <Typography.Text type="secondary">Rule ID: {kibanaMetadata.rule_id || '-'}</Typography.Text>
            <Typography.Text type="secondary">Remote ID: {kibanaMetadata.remote_id || '-'}</Typography.Text>
            <Button size="small" disabled={!kibanaMetadata.published || Boolean(kibanaMetadata.enabled)} onClick={() => syncKibanaEnabled(true)}>启用</Button>
            <Button size="small" disabled={!kibanaMetadata.published || !Boolean(kibanaMetadata.enabled)} onClick={() => syncKibanaEnabled(false)}>禁用</Button>
            <Popconfirm title="确认删除 Kibana 中的检测规则？" okText="删除" cancelText="取消" onConfirm={deleteKibanaRule}>
              <Button size="small" danger disabled={!kibanaMetadata.published}>删除 Kibana 规则</Button>
            </Popconfirm>
          </Space>
        </Card>

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

        {detailTab === 'elastic' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.8fr)', gap: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <Card size="small" title="Elastic KQL">
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                  <Typography.Text type="secondary">
                    Index patterns 属于 Elastic KQL 规则本身，会作为 detection rule 的 `index` 字段提交。
                  </Typography.Text>
                  <Input.TextArea
                    value={elasticIndexPatternsText}
                    onChange={(e) => setElasticIndexPatternsText(e.target.value)}
                    rows={4}
                    placeholder={'logs-*\nwinlogbeat-*'}
                  />
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
                </Space>
              </Card>
            </Space>
            <Card
              size="small"
              title="Kibana Detection Actions"
              extra={<Button size="small" onClick={saveElasticActions}>保存配置</Button>}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                <Typography.Text type="secondary">
                  这里仅配置 `actions`。Action frequency 默认按 `For each alert` 发送。
                </Typography.Text>
                <Space wrap>
                  <Select
                    placeholder="选择 Connector 生成模板"
                    value={connectorDraftId || undefined}
                    onChange={setConnectorDraftId}
                    style={{ width: 260 }}
                    options={connectors.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.connector_type_id ? ` (${c.connector_type_id})` : ''}`,
                    }))}
                  />
                  <Button onClick={insertConnectorTemplate} disabled={!connectorDraftId}>插入模板</Button>
                  <Button onClick={loadConnectors}>刷新 Connectors</Button>
                </Space>
                <Space wrap style={{ width: '100%' }}>
                  <Select
                    placeholder="选择要填写的 Action"
                    value={(() => {
                      try {
                        const actions = parseElasticActions(elasticActionsText);
                        return actions[selectedActionIndex] ? String(selectedActionIndex) : undefined;
                      } catch {
                        return undefined;
                      }
                    })()}
                    onChange={(value) => syncSelectedActionParams(Number(value))}
                    style={{ width: 260 }}
                    options={(() => {
                      try {
                        return parseElasticActions(elasticActionsText).map((action, index) => ({
                          value: String(index),
                          label: `${index + 1}. ${String(action?.id || 'action')}`,
                        }));
                      } catch {
                        return [];
                      }
                    })()}
                  />
                  <Button onClick={applySelectedActionParams}>写回当前 Params</Button>
                </Space>
                <Input.TextArea
                  value={selectedActionParamsText}
                  onChange={(e) => setSelectedActionParamsText(e.target.value)}
                  rows={10}
                  placeholder={'{\n  "documents": [\n    {\n      "@timestamp": "{{context.alerts.0.@timestamp}}",\n      "title": "{{context.rule.name}}"\n    }\n  ]\n}'}
                />
                <Input.TextArea
                  value={elasticActionsText}
                  onChange={(e) => handleElasticActionsTextChange(e.target.value)}
                  rows={16}
                  placeholder={'[\n  {\n    "group": "default",\n    "id": "<connector-id>",\n    "params": {},\n    "frequency": {\n      "summary": false,\n      "notifyWhen": "onActiveAlert",\n      "throttle": null\n    }\n  }\n]'}
                />
              </Space>
            </Card>
          </div>
        ) : (
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
        )}
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


