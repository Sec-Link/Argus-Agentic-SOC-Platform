import React, { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Space, Tabs } from "antd";

import {
  createDetectionDeployment,
  createDetectionMapping,
  createPublishedDetectionRule,
  deleteDetectionRule,
  deleteDetectionMappings,
  deletePublishedDetectionRule,
  exportDetectionMappings,
  exportDetectionRules,
  getDetectionRule,
  getPublishedDetectionRule,
  getPublishedRuleVersions,
  listDetectionDeployments,
  listDetectionMappings,
  listPublishedConnectors,
  listDetectionRules,
  patchPublishedDetectionRule,
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

type LocalMapRow = { id: string | number; sigma: string; splunk: string; elastic: string; elastic_index_patterns?: string[]; mapping_profile?: string };
type ConnectorRow = { id: string; name: string; connector_type_id?: string };
type KibanaMetadata = { published?: boolean; remote_id?: string; rule_id?: string; enabled?: boolean; name?: string; updated_at?: string };
type MappingDraft = {
  mapping_profile: string;
  sigma: string;
  splunk: string;
  elastic: string;
  elastic_index_patterns: string;
  category: string;
  data_source: string;
  event_category: string;
};

export default function Detections() {
  const { message } = App.useApp();

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
  const [elasticActionsText, setElasticActionsText] = useState("[]");
  const [elasticIndexPatternsText, setElasticIndexPatternsText] = useState("");
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [connectorDraftId, setConnectorDraftId] = useState<string>("");
  const [selectedActionIndex, setSelectedActionIndex] = useState<number>(0);
  const [selectedActionParamsText, setSelectedActionParamsText] = useState("{}");
  const [kibanaMetadata, setKibanaMetadata] = useState<KibanaMetadata>({});

  const [maps, setMaps] = useState<LocalMapRow[]>([]);
  const [selectedMappingIds, setSelectedMappingIds] = useState<React.Key[]>([]);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | number | null>(null);
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>({
    mapping_profile: "",
    sigma: "",
    splunk: "",
    elastic: "",
    elastic_index_patterns: "",
    category: "",
    data_source: "",
    event_category: "",
  });
  const [deployments, setDeployments] = useState<DetectionDeploymentRecord[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mappingUploading, setMappingUploading] = useState(false);

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
    const actions = Array.isArray(nextDetail?.payload?.elastic_actions) ? nextDetail.payload?.elastic_actions : [];
    const indexPatterns =
      Array.isArray(nextDetail?.compiled?.elastic_index_patterns) && nextDetail.compiled.elastic_index_patterns.length
        ? nextDetail.compiled.elastic_index_patterns
        : Array.isArray(nextDetail?.payload?.elastic_index_patterns) && nextDetail.payload?.elastic_index_patterns.length
          ? nextDetail.payload.elastic_index_patterns
          : [];

    setSelectedId(id);
    setDetail(nextDetail);
    setElasticActionsText(formatJson(actions));
    setElasticIndexPatternsText(indexPatterns.join("\n"));
    setKibanaMetadata(
      nextDetail?.payload?.kibana_metadata && typeof nextDetail.payload.kibana_metadata === "object"
        ? nextDetail.payload.kibana_metadata
        : {},
    );
    setSelectedActionIndex(0);
    setSelectedActionParamsText(formatJson(actions[0]?.params || {}));
    try {
      const publishedVersions = await getPublishedRuleVersions(id);
      setVersions(Array.isArray(publishedVersions?.data) ? publishedVersions.data : []);
    } catch {
      setVersions([]);
    }
  };

  useEffect(() => {
    loadRules();
    loadMappings();
    loadDeployments();
    loadConnectors();
  }, []);

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

  const publish = async () => {
    if (!selectedId || !detail) return;

    const meta = detail.meta || {};
    const compiled = detail.compiled || {};
    const compiledLanguage = String(compiled.language || (compiled.lucene ? "lucene" : "esql")).toLowerCase();
    const indexPatterns = parseIndexPatterns(elasticIndexPatternsText);
    const query =
      compiledLanguage === "lucene"
        ? String(compiled.lucene || "*")
        : applyIndexPatternsToEsql(compiled.esql || "*", indexPatterns);
    const ruleType = compiledLanguage === "lucene" ? "query" : "esql";
    const ruleLanguage = compiledLanguage === "lucene" ? "lucene" : "esql";

    try {
      const normalizedActions = dedupeElasticActions(parseElasticActions(elasticActionsText));
      const actions = enrichElasticActions(normalizedActions, connectors);
      const sigmaTags = Array.isArray(meta.tags) ? meta.tags.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const payload = {
        name: meta.title || selectedId,
        type: ruleType,
        rule_id: selectedId,
        enabled: false,
        severity: meta.level || "low",
        description: meta.description || meta.title || selectedId,
        index: indexPatterns,
        query,
        language: ruleLanguage,
        tags: Array.from(new Set(["sigma", ruleLanguage, ...sigmaTags])),
        actions,
      };

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
        elastic_actions: normalizedActions,
        elastic_index_patterns: indexPatterns,
        kibana_metadata: nextMetadata,
      });
      setElasticActionsText(formatJson(normalizedActions));
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
        elastic_actions: normalizedActions,
        elastic_index_patterns: parseIndexPatterns(elasticIndexPatternsText),
        kibana_metadata: kibanaMetadata,
      });
      setElasticActionsText(formatJson(normalizedActions));
      setEditorOpen(false);
      await loadRules();
      await loadDetail(editorId.trim());
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || "Failed to save rule");
    }
  };

  const saveElasticActions = async () => {
    if (!selectedId || !detail) return;
    try {
      const normalizedActions = dedupeElasticActions(parseElasticActions(elasticActionsText));
      await saveDetectionRule(selectedId, detail.yaml || "", {
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
      "mapping_profile,category,data_source,event_category,sigma,splunk,elastic,elastic_index_patterns",
      'aws_cloudtrail,,,,"eventName","","event.action","logs-aws.cloudtrail-*"',
      'aws_cloudtrail,,,,"sourceIPAddress","","source.ip","logs-aws.cloudtrail-*"',
    ];
    downloadText("detection-mappings-template.csv", lines.join("\n"), "text/csv;charset=utf-8");
    message.success("CSV template downloaded");
  };

  return (
    <>
      <Tabs
        activeKey={topTab}
        onChange={setTopTab}
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
                kibanaMetadata={kibanaMetadata}
                onBack={() => {
                  setSelectedId("");
                  setDetail(null);
                }}
                onEdit={() => {
                  setEditorId(selectedId);
                  setEditorYaml(detail.yaml || "");
                  setEditorOpen(true);
                }}
                onPublish={publish}
                onSetDetailTab={setDetailTab}
                onRollbackVersion={async (version) => {
                  await rollbackPublishedRuleVersion(selectedId, version);
                  await loadDetail(selectedId);
                  message.success(`Rolled back to v${version}`);
                }}
                onSaveElasticActions={saveElasticActions}
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
                onSelectRule={loadDetail}
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
        ]}
      />
      <Modal title={editorId ? `Edit Rule ${editorId}` : "New Rule"} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={saveRule} width={980}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input placeholder="Rule ID" value={editorId} onChange={(e) => setEditorId(e.target.value)} />
          <Input.TextArea rows={18} value={editorYaml} onChange={(e) => setEditorYaml(e.target.value)} placeholder="Paste Sigma YAML" />
        </Space>
      </Modal>
    </>
  );
}
