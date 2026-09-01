"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Badge, Button, Card, Checkbox, Collapse, Input, Modal, Space, Statistic, Switch, Table, Tag, Tabs, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  createDetectionDeployment,
  createDetectionMapping,
  createPublishedDetectionRule,
  deleteDetectionRule,
  deleteDetectionMappings,
  deletePublishedDetectionRule,
  exportDetectionMappings,
  exportDetectionRules,
  compileDetectionRule,
  getDetectionRule,
  getPublishedDetectionRule,
  getPublishedRuleVersions,
  listDetectionDeployments,
  listDetectionMappings,
  listPublishedConnectors,
  listDetectionRules,
  patchPublishedDetectionRule,
  previewPublishedDetectionRule,
  rollbackPublishedRuleVersion,
  saveDetectionRule,
  updatePublishedDetectionRule,
  uploadDetectionMappings,
  uploadDetectionRules,
  type DetectionDeploymentRecord,
  type DetectionRuleDetail,
  type DetectionRuleItem,
} from "services/detections";

import DetectionDeployments from "./DetectionDeployments";
import DetectionMappings from "./DetectionMappings";
import DetectionRuleDetailView from "./DetectionRuleDetail";
import DetectionRuleList from "./DetectionRuleList";
import {
  applyIndexPatternsToEsql,
  dedupeElasticActions,
  defaultConnectorParams,
  enrichElasticActions,
  formatJson,
  guessElasticIndexPatternsFromProfile,
  parseElasticActions,
  parseIndexPatterns,
} from "./utils";

type RuleRow = DetectionRuleItem & {
  level?: string;
  status?: string;
  logsource?: string;
  profile?: string;
  tags?: string[];
  publish_status?: string;
  kibana_enabled?: boolean;
  kibana_rule_id?: string;
};

type LocalMapRow = { id: string | number; sigma: string; splunk: string; elastic: string; elastic_is_multivalue?: boolean; elastic_index_patterns?: string[]; mapping_profile?: string };
type ConnectorRow = { id: string; name: string; connector_type_id?: string };
type KibanaMetadata = { published?: boolean; remote_id?: string; rule_id?: string; enabled?: boolean; name?: string; updated_at?: string };
type MappingDraft = {
  mapping_profile: string;
  sigma: string;
  splunk: string;
  elastic: string;
  elastic_is_multivalue: boolean;
  elastic_index_patterns: string;
  category: string;
  data_source: string;
  event_category: string;
};

const ECS_PRESETS_GLOBAL = [
  { field: 'host.name', type: 'host' }, { field: 'host.id', type: 'host' },
  { field: 'user.name', type: 'user' }, { field: 'user.id', type: 'user' },
  { field: 'source.ip', type: 'ip' }, { field: 'source.port', type: 'other' },
  { field: 'destination.ip', type: 'ip' }, { field: 'destination.port', type: 'other' },
  { field: 'process.name', type: 'other' }, { field: 'process.pid', type: 'other' },
  { field: 'process.command_line', type: 'other' }, { field: 'process.parent.name', type: 'other' },
  { field: 'file.name', type: 'other' }, { field: 'file.hash.sha256', type: 'hash' },
];
const PRESET_FIELD_NAMES = ECS_PRESETS_GLOBAL.map((p) => p.field);

type RiskFieldConfig = { field: string; type: string };

function GlobalRiskConfigPanel({
  globalRiskFields,
  saving,
  onSave,
}: {
  globalRiskFields: RiskFieldConfig[];
  saving: boolean;
  onSave: (fields: RiskFieldConfig[]) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<RiskFieldConfig[]>(globalRiskFields);
  React.useEffect(() => { setDraft(globalRiskFields); }, [globalRiskFields]);

  const checkedFields = draft.map((f) => f.field);
  const customFields = draft.filter((f) => !PRESET_FIELD_NAMES.includes(f.field));
  const customText = customFields.map((f) => f.field).join('\n');

  const toggle = (preset: RiskFieldConfig, checked: boolean) => {
    if (checked) setDraft((prev) => [...prev.filter((f) => f.field !== preset.field), preset]);
    else setDraft((prev) => prev.filter((f) => f.field !== preset.field));
  };

  const groups = [
    { label: 'Host',    items: ECS_PRESETS_GLOBAL.filter((p) => p.type === 'host') },
    { label: 'User',    items: ECS_PRESETS_GLOBAL.filter((p) => p.type === 'user') },
    { label: 'Network', items: ECS_PRESETS_GLOBAL.filter((p) => p.field.startsWith('source.') || p.field.startsWith('destination.')) },
    { label: 'Process', items: ECS_PRESETS_GLOBAL.filter((p) => p.field.startsWith('process.')) },
    { label: 'File',    items: ECS_PRESETS_GLOBAL.filter((p) => p.field.startsWith('file.')) },
  ];

  return (
    <div style={{ maxWidth: 800 }}>
      <Typography.Paragraph type="secondary">
        Global default risk object fields applied to all detection rules unless a rule has its own override.
        Fields must exist in the ELK alert payload written by the Kibana action.
      </Typography.Paragraph>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 24px', marginBottom: 16 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <Typography.Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{g.label}</Typography.Text>
            {g.items.map((preset) => (
              <div key={preset.field}>
                <Checkbox
                  checked={checkedFields.includes(preset.field)}
                  onChange={(e) => toggle(preset, e.target.checked)}
                  style={{ fontSize: 12 }}
                >
                  {preset.field}
                </Checkbox>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ fontSize: 12 }}>Custom fields</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>one per line</Typography.Text>
        <Input.TextArea
          rows={3}
          value={customText}
          placeholder="event.action"
          style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
          onChange={(e) => {
            const newCustom: RiskFieldConfig[] = e.target.value
              .split('\n').map((l) => l.trim()).filter((l) => l && !PRESET_FIELD_NAMES.includes(l))
              .map((l) => ({ field: l, type: 'other' }));
            setDraft([...draft.filter((f) => PRESET_FIELD_NAMES.includes(f.field)), ...newCustom]);
          }}
        />
      </div>
      {draft.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Selected ({draft.length}):{' '}
            {draft.map((f) => (
              <Tag key={f.field} color={f.type === 'ip' ? 'blue' : f.type === 'user' ? 'purple' : f.type === 'host' ? 'cyan' : 'default'} style={{ fontSize: 11 }}>
                {f.field}
              </Tag>
            ))}
          </Typography.Text>
        </div>
      )}
      <Button type="primary" size="small" loading={saving} onClick={() => onSave(draft)}>
        Save Global Config
      </Button>
    </div>
  );
}

export default function Detections({ initialRuleId }: { initialRuleId?: string } = {}) {
  const { message } = App.useApp();
  const router = useRouter();
  const DETECTION_BASE = "/settings/detection";

  const [topTab, setTopTab] = useState("rules");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRuleIds, setSelectedRuleIds] = useState<React.Key[]>([]);

  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<DetectionRuleDetail | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [detailTab, setDetailTab] = useState<"sigma" | "esql" | "version">("sigma");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState("");
  const [editorYaml, setEditorYaml] = useState("");
  const [elasticIndexPatternsText, setElasticIndexPatternsText] = useState("");
  const [esqlText, setEsqlText] = useState("");
  const [esqlSource, setEsqlSource] = useState<"autogenerated" | "manual">("autogenerated");
  const [elasticActionsText, setElasticActionsText] = useState("[]");
  const [connectorDraftId, setConnectorDraftId] = useState("");
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedActionParamsText, setSelectedActionParamsText] = useState("{}");
  const [scheduleInterval, setScheduleInterval] = useState("1m");
  const [scheduleFrom, setScheduleFrom] = useState("now-16m");
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [kibanaMetadata, setKibanaMetadata] = useState<KibanaMetadata>({});
  const [rulePreviewOpen, setRulePreviewOpen] = useState(false);
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false);
  const [rulePreviewResult, setRulePreviewResult] = useState<any>(null);

  const [maps, setMaps] = useState<LocalMapRow[]>([]);
  const [selectedMappingIds, setSelectedMappingIds] = useState<React.Key[]>([]);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | number | null>(null);
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>({
    mapping_profile: "",
    sigma: "",
    splunk: "",
    elastic: "",
    elastic_is_multivalue: false,
    elastic_index_patterns: "",
    category: "",
    data_source: "",
    event_category: "",
  });
  const [deployments, setDeployments] = useState<DetectionDeploymentRecord[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mappingUploading, setMappingUploading] = useState(false);

  // --- Risk Object Config ---
  type RiskFieldConfig = { field: string; type: string };
  type RiskAliasConfig = { source: string; ecs: string };
  const [riskFields, setRiskFields] = useState<RiskFieldConfig[]>([]);
  const [riskAliases, setRiskAliases] = useState<RiskAliasConfig[]>([]);
  const [riskEnabled, setRiskEnabled] = useState(true);
  const [globalRiskFields, setGlobalRiskFields] = useState<RiskFieldConfig[]>([]);
  const [globalRiskSaving, setGlobalRiskSaving] = useState(false);

  // --- Notable Events ---
  type NotableEvent = {
    id: number;
    risk_object: string;
    risk_object_type: string;
    score_at_trigger: number;
    threshold_used: number;
    contributing_event_count: number;
    status: string;
    triggered_at: string;
    resolved_at: string | null;
    resolved_by: string;
  };
  const [notableEvents, setNotableEvents] = useState<NotableEvent[]>([]);
  const [notableLoading, setNotableLoading] = useState(false);

  const downloadJson = (fileName: string, data: any) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadBlob = (fileName: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadText = (fileName: string, text: string, contentType: string) => {
    downloadBlob(fileName, new Blob([text], { type: contentType }));
  };

  const loadRules = async () => {
    setLoading(true);
    try {
      const list = await listDetectionRules();
      setRules(Array.isArray(list) ? (list as RuleRow[]) : []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "Failed to load rules");
    } finally {
      setLoading(false);
    }
  };

  const loadMappings = async () => {
    try {
      const list = await listDetectionMappings();
      setMaps(
        (Array.isArray(list) ? list : []).map((row: any) => ({
          id: row.id,
          sigma: String(row.sigma || ""),
          splunk: String(row.splunk || ""),
          elastic: String(row.elastic || ""),
          elastic_is_multivalue: Boolean(row.elastic_is_multivalue),
          elastic_index_patterns: Array.isArray(row.elastic_index_patterns) ? row.elastic_index_patterns.map((item: any) => String(item || "").trim()).filter(Boolean) : [],
          mapping_profile: String(row.mapping_profile || ""),
          category: String(row.category || ""),
          data_source: String(row.data_source || ""),
          event_category: String(row.event_category || ""),
        })),
      );
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "Failed to load mappings");
      setMaps([]);
    }
  };

  const loadDeployments = async () => {
    try {
      setDeployments(await listDetectionDeployments());
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "Failed to load deployment records");
      setDeployments([]);
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
    const nextDetail = await getDetectionRule(id);
    const indexPatterns =
      Array.isArray(nextDetail?.compiled?.elastic_index_patterns) && nextDetail.compiled.elastic_index_patterns.length
        ? nextDetail.compiled.elastic_index_patterns
        : Array.isArray(nextDetail?.payload?.elastic_index_patterns) && nextDetail.payload?.elastic_index_patterns.length
          ? nextDetail.payload.elastic_index_patterns
          : [];

    setSelectedId(id);
    setDetail(nextDetail);
    loadRiskConfig(id);
    setElasticIndexPatternsText(indexPatterns.join("\n"));
    setEsqlText(String(nextDetail?.compiled?.esql || nextDetail?.payload?.esql || "*"));
    setEsqlSource(nextDetail?.compiled?.esql_source === "manual" || nextDetail?.payload?.esql_source === "manual" ? "manual" : "autogenerated");
    const rulePayload = nextDetail?.payload || {};
    const actions = Array.isArray(rulePayload.elastic_actions) ? rulePayload.elastic_actions : [];
    setElasticActionsText(formatJson(actions));
    setSelectedActionIndex(0);
    setSelectedActionParamsText(formatJson(actions[0]?.params || {}));
    setScheduleInterval(String(rulePayload.schedule_interval || rulePayload.interval || "1m"));
    setScheduleFrom(String(rulePayload.schedule_from || rulePayload.from || "now-16m"));
    setKibanaMetadata(
      nextDetail?.payload?.kibana_metadata && typeof nextDetail.payload.kibana_metadata === "object"
        ? nextDetail.payload.kibana_metadata
        : {},
    );
    try {
      const publishedVersions = await getPublishedRuleVersions(id);
      setVersions(Array.isArray(publishedVersions?.data) ? publishedVersions.data : []);
    } catch {
      setVersions([]);
    }
  };

  const loadGlobalRiskConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/risk/global-config/', {
        headers: { Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGlobalRiskFields(Array.isArray(data.risk_object_fields) ? data.risk_object_fields : []);
      }
    } catch { /* non-fatal */ }
  }, []);

  const saveGlobalRiskConfig = async (fields: RiskFieldConfig[]) => {
    setGlobalRiskSaving(true);
    try {
      const res = await fetch('/api/v1/risk/global-config/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}`,
        },
        body: JSON.stringify({ risk_object_fields: fields }),
      });
      if (res.ok) {
        const data = await res.json();
        setGlobalRiskFields(Array.isArray(data.risk_object_fields) ? data.risk_object_fields : []);
        message.success('Global risk config saved');
      }
    } catch { message.error('Failed to save global risk config'); }
    finally { setGlobalRiskSaving(false); }
  };

  const loadRiskConfig = useCallback(async (ruleUuid: string) => {
    try {
      const res = await fetch(`/api/v1/risk/rule-config/?rule_uuid=${encodeURIComponent(ruleUuid)}`, {
        headers: { Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRiskFields(Array.isArray(data.risk_object_fields) ? data.risk_object_fields : []);
        setRiskAliases(Array.isArray(data.field_aliases) ? data.field_aliases : []);
        setRiskEnabled(data.enabled !== false);
      }
    } catch {
      setRiskFields([]);
    }
  }, []);

  const saveRiskConfig = async (ruleUuid: string) => {
    try {
      await fetch('/api/v1/risk/rule-config/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}`,
        },
        body: JSON.stringify({ rule_uuid: ruleUuid, risk_object_fields: riskFields, field_aliases: riskAliases, enabled: riskEnabled }),
      });
      message.success('Risk object configuration saved');
    } catch {
      message.error('Failed to save risk configuration');
    }
  };

  const loadNotableEvents = useCallback(async () => {
    setNotableLoading(true);
    try {
      const res = await fetch('/api/v1/risk/notable/', {
        headers: { Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}` },
      });
      if (res.ok) setNotableEvents(await res.json());
    } catch {
      setNotableEvents([]);
    } finally {
      setNotableLoading(false);
    }
  }, []);

  const resolveNotableEvent = async (id: number) => {
    try {
      await fetch(`/api/v1/risk/notable/${id}/resolve/`, {
        method: 'POST',
        headers: { Authorization: `Token ${localStorage.getItem('siem_access_token') || ''}` },
      });
      message.success('Notable event resolved');
      loadNotableEvents();
    } catch {
      message.error('Failed to resolve notable event');
    }
  };

  useEffect(() => {
    loadRules();
    loadMappings();
    loadDeployments();
    loadConnectors();
    loadGlobalRiskConfig();
  }, []);

  // Deep link from other modules (e.g. the Alerts "Detection Rule" quick link).
  // Supports both the dedicated route /detections/rules/<rule_uuid> (via the
  // initialRuleId prop) and /settings/detection?rule=<rule_uuid> (query param).
  useEffect(() => {
    const queryParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("rule") : null;
    const ruleParam = initialRuleId || queryParam;
    if (!ruleParam) return;
    setTopTab("rules");
    loadDetail(ruleParam).catch(() => {
      message.error("Failed to load detection rule");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRuleId]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rules.filter((rule) => {
      const name = String(rule.name || rule.id || "").toLowerCase();
      const logsource = String(rule.logsource || "").toLowerCase();
      const profile = String(rule.profile || "").toLowerCase();
      const level = String(rule.level || "").toLowerCase() || "medium";
      const status = String(rule.status || "").toLowerCase() || "draft";
      const tags = (Array.isArray(rule.tags) ? rule.tags : []).join(",").toLowerCase();
      if (query && !`${rule.id} ${name} ${logsource} ${profile} ${tags}`.includes(query)) return false;
      if (productFilter !== "all" && !logsource.includes(productFilter.toLowerCase())) return false;
      if (severityFilter !== "all" && level !== severityFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      return true;
    });
  }, [productFilter, rules, search, severityFilter, statusFilter]);

  const productOptions = useMemo(() => {
    const values = Array.from(new Set(rules.map((rule) => String(rule.logsource || "").split("/")[0].trim().toLowerCase()).filter(Boolean)));
    return [{ value: "all", label: "All Products" }, ...values.map((value) => ({ value, label: value }))];
  }, [rules]);

  const severityOptions = useMemo(() => {
    const values = Array.from(new Set(rules.map((rule) => String(rule.level || "").trim().toLowerCase()).filter(Boolean)));
    const base = ["critical", "high", "medium", "low"];
    const ordered = [...base.filter((value) => values.includes(value)), ...values.filter((value) => !base.includes(value))];
    return [{ value: "all", label: "All Severities" }, ...ordered.map((value) => ({ value, label: value }))];
  }, [rules]);

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(rules.map((rule) => String(rule.status || "").trim().toLowerCase()).filter(Boolean)));
    return [{ value: "all", label: "All Statuses" }, ...values.map((value) => ({ value, label: value }))];
  }, [rules]);

  const recordDeployment = async (payload: {
    rule_id: string;
    target: string;
    action: string;
    status: string;
    remote_id?: string;
    remote_rule_id?: string;
    message?: string;
    payload?: Record<string, any>;
  }) => {
    try {
      await createDetectionDeployment(payload);
      await loadDeployments();
    } catch {
      // Do not block the main action if audit persistence fails.
    }
  };

  const scheduleConfigurationPayload = () => ({
    schedule_interval: scheduleInterval,
    schedule_from: scheduleFrom,
  });

  const esqlConfigurationPayload = (source: "autogenerated" | "manual" = esqlSource) => (
    source === "manual"
      ? { esql: esqlText, esql_source: "manual" }
      : { esql_source: "autogenerated" }
  );

  const validateSchedule = () => {
    if (!/^[1-9]\d*[smhd]$/.test(scheduleInterval)) {
      throw new Error("Run every must use a value such as 1m, 5m, or 1h");
    }
    if (!/^now-[1-9]\d*[smhd]$/.test(scheduleFrom)) {
      throw new Error("Lookback must use a value such as now-16m or now-1h");
    }
  };

  const buildKibanaRulePayload = () => {
    if (!selectedId || !detail) return;

    const meta = detail.meta || {};
    const compiled = detail.compiled || {};
    const compiledLanguage = String(compiled.language || (compiled.lucene ? "lucene" : "esql")).toLowerCase();
    const indexPatterns = parseIndexPatterns(elasticIndexPatternsText);
    const query =
      compiledLanguage === "lucene"
        ? String(compiled.lucene || "*")
        : applyIndexPatternsToEsql(esqlText || compiled.esql || "*", indexPatterns);
    const ruleType = compiledLanguage === "lucene" ? "query" : "esql";
    const ruleLanguage = compiledLanguage === "lucene" ? "lucene" : "esql";

    validateSchedule();
    const riskScore = Number(detail?.payload?.risk_score ?? 50);
    const actions = enrichElasticActions(dedupeElasticActions(parseElasticActions(elasticActionsText)), connectors);
    const sigmaTags = Array.isArray(meta.tags) ? meta.tags.map((item) => String(item || "").trim()).filter(Boolean) : [];
    return {
      name: meta.title || selectedId,
      type: ruleType,
      rule_id: selectedId,
      enabled: false,
      severity: meta.level || "low",
      risk_score: Number.isFinite(riskScore) ? Math.max(0, Math.min(100, riskScore)) : 50,
      description: meta.description || meta.title || selectedId,
      index: indexPatterns,
      query,
      language: ruleLanguage,
      tags: Array.from(new Set([
        "sigma",
        ruleLanguage,
        ...(compiled.risk_incident?.enabled ? ["argus-risk-incident"] : []),
        ...sigmaTags,
      ])),
      actions,
      interval: scheduleInterval,
      from: scheduleFrom,
      to: "now",
    };
  };

  const buildKibanaPreviewPayload = () => {
    const payload = buildKibanaRulePayload();
    if (!payload) return;
    return {
      ...payload,
      required_fields: [],
      author: [],
      exceptions_list: [],
      false_positives: [],
      references: [],
      risk_score_mapping: [],
      severity_mapping: [],
      max_signals: 100,
      setup: "",
      license: "",
      response_actions: [],
      enabled: true,
      meta: { kibana_siem_app_url: "" },
      invocationCount: 60,
      timeframeEnd: new Date().toISOString(),
    };
  };

  const previewRule = async () => {
    if (!selectedId || !detail) return;
    setRulePreviewLoading(true);
    try {
      const payload = buildKibanaPreviewPayload();
      if (!payload) return;
      const result = await previewPublishedDetectionRule(payload);
      setRulePreviewResult(result);
      setRulePreviewOpen(true);
      message.success("Kibana rule preview completed");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Kibana rule preview failed");
    } finally {
      setRulePreviewLoading(false);
    }
  };

  const publish = async () => {
    if (!selectedId || !detail) return;

    try {
      const payload = buildKibanaRulePayload();
      if (!payload) return;
      const actions = Array.isArray(payload.actions) ? payload.actions : [];
      const indexPatterns = Array.isArray(payload.index) ? payload.index : [];

      let publishedRule: any;
      try {
        const full = await getPublishedDetectionRule(selectedId);
        const { id: _id, rule_id: _ruleId, kibana_rule_id: _kibanaRuleId, ...fullWithoutRuleId } = full || {};
        publishedRule = await updatePublishedDetectionRule(selectedId, { ...fullWithoutRuleId, ...payload, id: selectedId });
      } catch (e: any) {
        if (e?.response?.status === 404 || e?.response?.data?.status_code === 404) {
          publishedRule = await createPublishedDetectionRule(payload);
        } else {
          throw e;
        }
      }

      const nextMetadata: KibanaMetadata = {
        published: true,
        remote_id: String(publishedRule?.kibana_rule_id || selectedId || ""),
        rule_id: String(selectedId),
        enabled: Boolean(publishedRule?.enabled ?? payload.enabled),
        name: String(publishedRule?.name || payload.name || ""),
        updated_at: new Date().toISOString(),
      };
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        ...esqlConfigurationPayload(),
        elastic_actions: actions,
        elastic_index_patterns: indexPatterns,
        kibana_metadata: nextMetadata,
      });
      setKibanaMetadata(nextMetadata);

      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: "publish",
        status: "success",
        remote_id: String(publishedRule?.kibana_rule_id || selectedId),
        remote_rule_id: String(publishedRule?.kibana_rule_id || selectedId),
        payload,
      });
      await loadRules();
      await loadDetail(selectedId);
      message.success("Published to Kibana");
    } catch (e: any) {
      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: "publish",
        status: "failed",
        message: e?.response?.data?.detail || e?.message || "Publish to Kibana failed",
      });
      message.error(e?.response?.data?.detail || e?.message || "Publish to Kibana failed");
    }
  };

  const importGithub = async () => {
    const url = githubUrl.trim();
    if (!url) return message.error("GitHub raw URL is required");
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      const text = await resp.text();
      const fileName = url.split("/").pop() || `import-${Date.now()}.yml`;
      const file = new File([text], fileName, { type: "text/yaml" });
      const result = await uploadDetectionRules([file]);
      const firstId = result?.results?.find((row: any) => row.id)?.id;
      await loadRules();
      if (firstId) {
        await loadDetail(String(firstId));
      }
      setTopTab("rules");
      message.success(`Imported ${fileName}`);
    } catch (e: any) {
      message.error(e?.message || "Import failed");
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await uploadDetectionRules(files);
      await loadRules();
      message.success(`Upload complete: created ${result?.created || 0}, updated ${result?.updated || 0}, skipped ${result?.skipped || 0}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteSelectedRules = async () => {
    if (!selectedRuleIds.length) return;
    const ids = selectedRuleIds.map((value) => String(value));
    await Promise.all(ids.map((id) => deleteDetectionRule(id)));
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId("");
      setDetail(null);
    }
    setSelectedRuleIds([]);
    await loadRules();
    message.success(`Deleted ${ids.length} rules`);
  };

  const saveRule = async () => {
    if (!editorId.trim() || !editorYaml.trim()) return message.error("Rule ID and YAML are required");
    try {
      const normalizedActions = dedupeElasticActions(parseElasticActions(elasticActionsText));
      await saveDetectionRule(editorId.trim(), editorYaml, {
        ...scheduleConfigurationPayload(),
        esql_source: "autogenerated",
        elastic_actions: normalizedActions,
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      setElasticActionsText(formatJson(normalizedActions));
      setEditorOpen(false);
      await loadRules();
      await loadDetail(editorId.trim());
      setEsqlSource("autogenerated");
      if (riskFields.some((f) => f.field.trim())) {
        await saveRiskConfig(editorId.trim());
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to save rule");
    }
  };

  const saveElasticActions = async () => {
    if (!selectedId || !detail) return;
    try {
      const normalizedActions = dedupeElasticActions(parseElasticActions(elasticActionsText));
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        ...esqlConfigurationPayload(),
        elastic_actions: normalizedActions,
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      setElasticActionsText(formatJson(normalizedActions));
      await loadDetail(selectedId);
      message.success("Elastic action configuration saved");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to save Elastic action configuration");
    }
  };

  const saveSchedule = async () => {
    if (!selectedId || !detail) return;
    try {
      validateSchedule();
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        ...esqlConfigurationPayload(),
        elastic_actions: dedupeElasticActions(parseElasticActions(elasticActionsText)),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      await loadDetail(selectedId);
      message.success("Detection schedule saved; publish to sync it to Kibana");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to save detection schedule");
    }
  };

  const saveEsql = async () => {
    if (!selectedId || !detail) return;
    if (!esqlText.trim()) {
      message.error("ES|QL query is required");
      return;
    }
    try {
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        esql: esqlText,
        esql_source: "manual",
        elastic_actions: dedupeElasticActions(parseElasticActions(elasticActionsText)),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      setEsqlSource("manual");
      await loadDetail(selectedId);
      message.success("ES|QL saved as manual");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to save ES|QL");
    }
  };

  const regenerateEsqlFromSigma = async () => {
    if (!selectedId || !detail) return;
    try {
      const compiled = await compileDetectionRule(detail.yaml || "");
      const nextEsql = String(compiled?.esql || "").trim();
      if (!nextEsql) {
        throw new Error(compiled?.error || "Sigma did not compile to ES|QL");
      }
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        esql: nextEsql,
        esql_source: "autogenerated",
        elastic_actions: dedupeElasticActions(parseElasticActions(elasticActionsText)),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      setEsqlText(nextEsql);
      setEsqlSource("autogenerated");
      await loadDetail(selectedId);
      message.success("ES|QL regenerated from Sigma");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to regenerate ES|QL from Sigma");
    }
  };

  const syncKibanaEnabled = async (enabled: boolean) => {
    if (!selectedId || !detail) return;
    const remoteId = String(kibanaMetadata.remote_id || "").trim();
    if (!remoteId) {
      message.error("The Kibana rule has not been published yet");
      return;
    }
    try {
      const full = await getPublishedDetectionRule(selectedId);
      const { id: _id, rule_id: _ruleId, kibana_rule_id: _kibanaRuleId, ...fullForUpdate } = full || {};
      const updated = await patchPublishedDetectionRule(selectedId, { ...fullForUpdate, enabled });
      const nextMetadata: KibanaMetadata = {
        ...kibanaMetadata,
        published: true,
        remote_id: String(updated?.kibana_rule_id || remoteId),
        rule_id: String(kibanaMetadata.rule_id || selectedId),
        enabled: Boolean(updated?.enabled),
        name: String(updated?.name || kibanaMetadata.name || detail.meta?.title || selectedId),
        updated_at: new Date().toISOString(),
      };
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        ...esqlConfigurationPayload(),
        elastic_actions: dedupeElasticActions(parseElasticActions(elasticActionsText)),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: nextMetadata,
      });
      setKibanaMetadata(nextMetadata);
      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: enabled ? "enable" : "disable",
        status: "success",
        remote_id: String(updated?.kibana_rule_id || remoteId),
        remote_rule_id: String(updated?.kibana_rule_id || remoteId),
      });
      await loadRules();
      await loadDetail(selectedId);
      message.success(enabled ? "Kibana rule enabled" : "Kibana rule disabled");
    } catch (e: any) {
      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: enabled ? "enable" : "disable",
        status: "failed",
        message: e?.response?.data?.detail || e?.message || "Failed to update the Kibana rule",
      });
      message.error(e?.response?.data?.detail || e?.message || "Failed to update the Kibana rule");
    }
  };

  const deleteKibanaRule = async () => {
    if (!selectedId || !detail) return;
    const remoteId = String(kibanaMetadata.remote_id || "").trim();
    if (!remoteId) {
      message.error("The Kibana rule has not been published yet");
      return;
    }
    try {
      await deletePublishedDetectionRule(selectedId);
      const nextMetadata: KibanaMetadata = {
        published: false,
        remote_id: "",
        rule_id: String(kibanaMetadata.rule_id || selectedId),
        enabled: false,
        name: String(kibanaMetadata.name || detail.meta?.title || selectedId),
        updated_at: new Date().toISOString(),
      };
      await saveDetectionRule(selectedId, detail.yaml || "", {
        ...scheduleConfigurationPayload(),
        ...esqlConfigurationPayload(),
        elastic_actions: dedupeElasticActions(parseElasticActions(elasticActionsText)),
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: nextMetadata,
      });
      setKibanaMetadata(nextMetadata);
      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: "delete",
        status: "success",
        remote_id: remoteId,
        remote_rule_id: String(remoteId),
      });
      await loadRules();
      await loadDetail(selectedId);
      message.success("Kibana rule deleted");
    } catch (e: any) {
      await recordDeployment({
        rule_id: selectedId,
        target: "elastic-dev",
        action: "delete",
        status: "failed",
        message: e?.response?.data?.detail || e?.message || "Failed to delete the Kibana rule",
      });
      message.error(e?.response?.data?.detail || e?.message || "Failed to delete the Kibana rule");
    }
  };

  const insertConnectorTemplate = () => {
    if (!connectorDraftId) return;
    try {
      const current = parseElasticActions(elasticActionsText);
      const connector = connectors.find((item) => item.id === connectorDraftId);
      const nextAction = {
        group: "default",
        id: connectorDraftId,
        ...(connector?.connector_type_id ? { action_type_id: connector.connector_type_id } : {}),
        params: defaultConnectorParams(connector?.connector_type_id),
        frequency: {
          summary: false,
          notifyWhen: "onActiveAlert",
          throttle: null,
        },
      };
      const existingIndex = current.findIndex((action) => String(action?.id || "").trim() === connectorDraftId);
      const nextActions = [...current];
      const nextIndex = existingIndex >= 0 ? existingIndex : nextActions.length;
      if (existingIndex >= 0) {
        nextActions[existingIndex] = nextAction;
      } else {
        nextActions.push(nextAction);
      }
      setElasticActionsText(formatJson(nextActions));
      setSelectedActionIndex(nextIndex);
      setSelectedActionParamsText(formatJson(nextAction.params || {}));
      message.success(existingIndex >= 0 ? "Updated existing connector action template" : "Inserted connector action template");
    } catch (e: any) {
      message.error(e?.message || "The current action JSON is invalid");
    }
  };

  const syncSelectedActionParams = (nextIndex: number) => {
    try {
      const actions = parseElasticActions(elasticActionsText);
      setSelectedActionIndex(nextIndex);
      setSelectedActionParamsText(formatJson(actions[nextIndex]?.params || {}));
    } catch {
      setSelectedActionIndex(nextIndex);
      setSelectedActionParamsText("{}");
    }
  };

  const applySelectedActionParams = () => {
    try {
      const actions = parseElasticActions(elasticActionsText);
      if (!actions.length) throw new Error("There is no action yet");
      actions[selectedActionIndex] = {
        ...actions[selectedActionIndex],
        params: JSON.parse(selectedActionParamsText || "{}"),
      };
      setElasticActionsText(formatJson(actions));
      message.success("Wrote params back to the current action");
    } catch (e: any) {
      message.error(e?.message || "Failed to update action params");
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
      // Keep raw editor editable while JSON is temporarily invalid.
    }
  };

  const handleUploadMappings = async (files: File[]) => {
    if (!files.length) return;
    setMappingUploading(true);
    try {
      const result = await uploadDetectionMappings(files);
      await loadMappings();
      message.success(`Mapping upload complete: created ${result?.created || 0}, updated ${result?.updated || 0}, skipped ${result?.skipped || 0}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Mapping upload failed");
    } finally {
      setMappingUploading(false);
    }
  };

  const handleExportRules = async () => {
    try {
      const ids = selectedRuleIds.length ? selectedRuleIds.map((item) => String(item)) : undefined;
      const data = await exportDetectionRules(ids);
      downloadJson(`detection-rules-${new Date().toISOString().slice(0, 10)}.json`, data);
      message.success("Rules exported");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Rule export failed");
    }
  };

  const handleExportMappings = async () => {
    try {
      const ids = selectedMappingIds.length ? selectedMappingIds.map((item) => String(item)) : undefined;
      const data = await exportDetectionMappings(ids);
      downloadBlob(`detection-mappings-${new Date().toISOString().slice(0, 10)}.csv`, data);
      message.success("Mappings exported");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Mapping export failed");
    }
  };

  const handleDeleteMappings = async () => {
    try {
      await deleteDetectionMappings(selectedMappingIds);
      setSelectedMappingIds([]);
      await loadMappings();
      message.success("Mappings deleted");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Delete mappings failed");
    }
  };

  const handleCreateMapping = async () => {
    try {
      await createDetectionMapping({
        ...(editingMappingId !== null ? { id: editingMappingId } : {}),
        ...mappingDraft,
        elastic_index_patterns: parseIndexPatterns(mappingDraft.elastic_index_patterns),
      });
      setMappingModalOpen(false);
      const wasEditing = editingMappingId !== null;
      setEditingMappingId(null);
      setMappingDraft({
        mapping_profile: "",
        sigma: "",
        splunk: "",
        elastic: "",
        elastic_is_multivalue: false,
        elastic_index_patterns: "",
        category: "",
        data_source: "",
        event_category: "",
      });
      await loadMappings();
      message.success(wasEditing ? "Mapping updated" : "Mapping created");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Create mapping failed");
    }
  };

  const handleDownloadMappingTemplate = () => {
    const lines = [
      "mapping_profile,category,data_source,event_category,sigma,splunk,elastic,elastic_is_multivalue,elastic_index_patterns",
      'aws_cloudtrail,,,,"eventName","","event.action","false","logs-aws.cloudtrail-*"',
      'aws_cloudtrail,,,,"sourceIPAddress","","source.ip","false","logs-aws.cloudtrail-*"',
    ];
    downloadText("detection-mappings-template.csv", lines.join("\n"), "text/csv;charset=utf-8");
    message.success("CSV template downloaded");
  };

  return (
    <>
      <Tabs
        activeKey={topTab}
        onChange={(key) => { setTopTab(key); if (key === 'notable') loadNotableEvents(); }}
        items={[
          {
            key: "rules",
            label: "Rule Library",
            children: selectedId && detail ? (
              <DetectionRuleDetailView
                detail={detail}
                detailTab={detailTab}
                versions={versions}
                connectors={connectors}
                connectorDraftId={connectorDraftId}
                selectedActionIndex={selectedActionIndex}
                selectedActionParamsText={selectedActionParamsText}
                elasticActionsText={elasticActionsText}
                elasticIndexPatternsText={elasticIndexPatternsText}
                esqlText={esqlText}
                esqlSource={esqlSource}
                scheduleInterval={scheduleInterval}
                scheduleFrom={scheduleFrom}
                kibanaMetadata={kibanaMetadata}
                rulePreviewLoading={rulePreviewLoading}
                onBack={() => router.push(DETECTION_BASE)}
                onEdit={() => {
                  setEditorId(selectedId);
                  setEditorYaml(detail.yaml || "");
                  setEditorOpen(true);
                }}
                onPreview={previewRule}
                onPublish={publish}
                onSetDetailTab={setDetailTab}
                onRollbackVersion={async (version) => {
                  await rollbackPublishedRuleVersion(selectedId, version);
                  await loadDetail(selectedId);
                  message.success(`Rolled back to v${version}`);
                }}
                riskFields={riskFields}
                riskAliases={riskAliases}
                riskEnabled={riskEnabled}
                globalRiskFields={globalRiskFields}
                onSetRiskFields={setRiskFields}
                onSetRiskAliases={(aliases) => {
                  setRiskAliases(aliases);
                  // Auto-add ECS target fields to riskFields so the user doesn't need two steps
                  const ecsTargets = aliases.map((a) => a.ecs).filter(Boolean);
                  if (ecsTargets.length > 0) {
                    setRiskFields((prev) => {
                      const existing = new Set(prev.map((f) => f.field));
                      const toAdd = ecsTargets.filter((e) => !existing.has(e));
                      if (toAdd.length === 0) return prev;
                      const typeMap: Record<string, string> = { 'host.name': 'host', 'host.id': 'host', 'user.name': 'user', 'user.id': 'user', 'source.ip': 'ip', 'destination.ip': 'ip', 'file.hash.sha256': 'hash' };
                      return [...prev, ...toAdd.map((f) => ({ field: f, type: typeMap[f] || 'other' }))];
                    });
                  }
                }}
                onSetRiskEnabled={setRiskEnabled}
                onSaveRiskConfig={() => saveRiskConfig(selectedId)}
                onSaveElasticActions={saveElasticActions}
                onSaveSchedule={saveSchedule}
                onSaveEsql={saveEsql}
                onRegenerateEsqlFromSigma={regenerateEsqlFromSigma}
                onSyncKibanaEnabled={syncKibanaEnabled}
                onDeleteKibanaRule={deleteKibanaRule}
                onSetConnectorDraftId={setConnectorDraftId}
                onInsertConnectorTemplate={insertConnectorTemplate}
                onLoadConnectors={loadConnectors}
                onSyncSelectedActionParams={syncSelectedActionParams}
                onApplySelectedActionParams={applySelectedActionParams}
                onSetSelectedActionParamsText={setSelectedActionParamsText}
                onElasticActionsTextChange={handleElasticActionsTextChange}
                onSetElasticIndexPatternsText={setElasticIndexPatternsText}
                onSetEsqlText={(value) => {
                  setEsqlText(value);
                  setEsqlSource("manual");
                }}
                onSetScheduleInterval={setScheduleInterval}
                onSetScheduleFrom={setScheduleFrom}
              />
            ) : (
              <DetectionRuleList
                rules={rules}
                filteredRules={filteredRules}
                loading={loading}
                search={search}
                productFilter={productFilter}
                severityFilter={severityFilter}
                statusFilter={statusFilter}
                productOptions={productOptions}
                severityOptions={severityOptions}
                statusOptions={statusOptions}
                selectedRuleIds={selectedRuleIds}
                uploading={uploading}
                githubUrl={githubUrl}
                setSearch={setSearch}
                setProductFilter={setProductFilter}
                setSeverityFilter={setSeverityFilter}
                setStatusFilter={setStatusFilter}
                setSelectedRuleIds={setSelectedRuleIds}
                setGithubUrl={setGithubUrl}
                onReload={loadRules}
                onDeleteSelected={deleteSelectedRules}
                onSelectRule={(id) => router.push(`${DETECTION_BASE}/rules/${encodeURIComponent(String(id))}`)}
                onUploadFiles={handleUploadFiles}
                onExportRules={handleExportRules}
                onCreateRule={() => {
                  setEditorId("");
                  setEditorYaml("");
                  setElasticActionsText("[]");
                  setElasticIndexPatternsText("logs-*");
                  setSelectedActionIndex(0);
                  setSelectedActionParamsText("{}");
                  setKibanaMetadata({});
                  setEditorOpen(true);
                }}
                onImportGithub={importGithub}
              />
            ),
          },
          {
            key: "mappings",
            label: "Field Mappings",
            children: (
              <DetectionMappings
                rows={maps}
                loading={mappingUploading}
                selectedIds={selectedMappingIds}
                draft={mappingDraft}
                modalOpen={mappingModalOpen}
                onRefresh={loadMappings}
                onUpload={handleUploadMappings}
                onExport={handleExportMappings}
                onDownloadTemplate={handleDownloadMappingTemplate}
                onDeleteSelected={handleDeleteMappings}
                onOpenCreate={() => {
                  setEditingMappingId(null);
                  setMappingDraft({
                    mapping_profile: "",
                    sigma: "",
                    splunk: "",
                    elastic: "",
                    elastic_is_multivalue: false,
                    elastic_index_patterns: "",
                    category: "",
                    data_source: "",
                    event_category: "",
                  });
                  setMappingModalOpen(true);
                }}
                onOpenEdit={(row) => {
                  setEditingMappingId(row.id);
                  setMappingDraft({
                    mapping_profile: String(row.mapping_profile || ""),
                    sigma: String(row.sigma || ""),
                    splunk: String(row.splunk || ""),
                    elastic: String(row.elastic || ""),
                    elastic_is_multivalue: Boolean(row.elastic_is_multivalue),
                    elastic_index_patterns: Array.isArray(row.elastic_index_patterns) ? row.elastic_index_patterns.join("\n") : "",
                    category: String(row.category || ""),
                    data_source: String(row.data_source || ""),
                    event_category: String(row.event_category || ""),
                  });
                  setMappingModalOpen(true);
                }}
                onCloseCreate={() => {
                  setMappingModalOpen(false);
                  setEditingMappingId(null);
                }}
                onSaveCreate={handleCreateMapping}
                onSetSelectedIds={setSelectedMappingIds}
                onSetDraft={setMappingDraft}
              />
            ),
          },
          {
            key: "deployments",
            label: "Publish History",
            children: <DetectionDeployments rows={deployments} onRefresh={loadDeployments} />,
          },
          {
            key: "notable",
            label: (
              <span>
                Notable Events
                {notableEvents.filter((e) => e.status === 'open').length > 0 && (
                  <Badge
                    count={notableEvents.filter((e) => e.status === 'open').length}
                    size="small"
                    style={{ marginLeft: 6 }}
                  />
                )}
              </span>
            ),
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                  <Button onClick={loadNotableEvents} loading={notableLoading} size="small">
                    Refresh
                  </Button>
                  <Typography.Text type="secondary" style={{ lineHeight: '24px', fontSize: 12 }}>
                    Entities whose 24h risk score exceeded 100 points
                  </Typography.Text>
                </div>
                <Table<NotableEvent>
                  size="small"
                  loading={notableLoading}
                  dataSource={notableEvents}
                  rowKey="id"
                  pagination={{ pageSize: 20, size: 'small' }}
                  columns={[
                    {
                      title: 'Entity',
                      key: 'entity',
                      render: (_, r) => (
                        <Space size={4}>
                          <Tag color={r.risk_object_type === 'ip' ? 'blue' : r.risk_object_type === 'user' ? 'purple' : 'default'}>
                            {r.risk_object_type}
                          </Tag>
                          <Typography.Text copyable style={{ fontSize: 13 }}>{r.risk_object}</Typography.Text>
                        </Space>
                      ),
                    },
                    {
                      title: 'Score',
                      dataIndex: 'score_at_trigger',
                      render: (v) => <span style={{ color: '#f5222d', fontWeight: 600 }}>{v.toFixed(1)}</span>,
                      sorter: (a, b) => a.score_at_trigger - b.score_at_trigger,
                    },
                    {
                      title: 'Events',
                      dataIndex: 'contributing_event_count',
                      render: (v) => v,
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (v) => (
                        <Tag color={v === 'open' ? 'red' : v === 'in_review' ? 'orange' : 'green'}>{v}</Tag>
                      ),
                    },
                    {
                      title: 'Triggered',
                      dataIndex: 'triggered_at',
                      render: (v) => new Date(v).toLocaleString(),
                      sorter: (a, b) => new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime(),
                    },
                    {
                      title: 'Action',
                      key: 'action',
                      render: (_, r) =>
                        r.status !== 'resolved' ? (
                          <Button size="small" onClick={() => resolveNotableEvent(r.id)}>
                            Resolve
                          </Button>
                        ) : (
                          <Tooltip title={`Resolved by ${r.resolved_by}`}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {r.resolved_at ? new Date(r.resolved_at).toLocaleDateString() : '—'}
                            </Typography.Text>
                          </Tooltip>
                        ),
                    },
                  ] as ColumnsType<NotableEvent>}
                />
              </div>
            ),
          },
          {
            key: 'risk-config',
            label: 'Risk Config',
            children: (
              <GlobalRiskConfigPanel
                globalRiskFields={globalRiskFields}
                saving={globalRiskSaving}
                onSave={saveGlobalRiskConfig}
              />
            ),
          },
        ]}
      />
      <Modal title={editorId ? `Edit Rule ${editorId}` : "New Rule"} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={saveRule} width={980}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input placeholder="Rule ID" value={editorId} onChange={(e) => setEditorId(e.target.value)} />
          <Input.TextArea rows={18} value={editorYaml} onChange={(e) => setEditorYaml(e.target.value)} placeholder="Paste Sigma YAML" />
        </Space>
      </Modal>
      <Modal
        title="Kibana Rule Preview"
        open={rulePreviewOpen}
        onCancel={() => setRulePreviewOpen(false)}
        footer={<Button onClick={() => setRulePreviewOpen(false)}>Close</Button>}
        width={980}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Card size="small">
            <Space wrap size={24}>
              <Statistic
                title="Matched events"
                value={rulePreviewResult?.alert_summary?.count ?? "Unknown"}
              />
              <Statistic
                title="Executions"
                value={Array.isArray(rulePreviewResult?.logs) ? rulePreviewResult.logs.length : 0}
              />
              <Statistic
                title="Preview ID"
                value={rulePreviewResult?.previewId || "-"}
                valueStyle={{ fontSize: 14 }}
              />
            </Space>
            {rulePreviewResult?.alert_summary?.ok === false ? (
              <Typography.Paragraph type="warning" style={{ marginTop: 12, marginBottom: 0 }}>
                Preview ran, but match count could not be loaded from Elasticsearch: {String(rulePreviewResult?.alert_summary?.error || "unknown error")}
              </Typography.Paragraph>
            ) : null}
            {rulePreviewResult?.alert_summary?.ok === true && rulePreviewResult?.alert_summary?.count === 0 ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                No preview alerts matched the current preview id yet. Check the JSON below for queried indices and sample alerts.
              </Typography.Paragraph>
            ) : null}
          </Card>
          <Table
            size="small"
            rowKey={(row: any) => String(row.id || row.source?.["kibana.alert.uuid"] || row.source?.["@timestamp"] || Math.random())}
            dataSource={Array.isArray(rulePreviewResult?.alert_summary?.alerts) ? rulePreviewResult.alert_summary.alerts : []}
            pagination={false}
            scroll={{ x: 900 }}
            columns={[
              {
                title: "Time",
                dataIndex: ["source", "@timestamp"],
                width: 210,
                render: (value: any, row: any) => String(value || row.source?.["kibana.alert.start"] || "-"),
              },
              {
                title: "Index",
                dataIndex: "index",
                width: 280,
                render: (value: any) => String(value || "-"),
              },
              {
                title: "Host",
                dataIndex: ["source", "host.name"],
                width: 220,
                render: (value: any, row: any) => String(value || row.source?.host?.name || row.source?.host?.hostname || "-"),
              },
              {
                title: "User",
                dataIndex: ["source", "user.name"],
                width: 160,
                render: (value: any, row: any) => String(value || row.source?.user?.name || row.source?.user?.id || "-"),
              },
              {
                title: "Process",
                dataIndex: ["source", "process.executable"],
                width: 260,
                render: (value: any, row: any) => String(value || row.source?.process?.executable || row.source?.process?.name || "-"),
              },
              {
                title: "Reason",
                dataIndex: ["source", "kibana.alert.reason"],
                render: (value: any) => String(value || "-"),
              },
            ]}
          />
          <Collapse
            size="small"
            items={[
              {
                key: "raw",
                label: "Raw preview response",
                children: (
                  <Input.TextArea
                    value={formatJson(rulePreviewResult)}
                    readOnly
                    rows={14}
                    style={{ fontFamily: "Consolas, 'Courier New', monospace" }}
                  />
                ),
              },
            ]}
          />
        </Space>
      </Modal>
    </>
  );
}
