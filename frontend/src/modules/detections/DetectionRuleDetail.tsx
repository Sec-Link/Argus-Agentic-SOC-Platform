import React from "react";
import { Button, Card, Input, Popconfirm, Select, Space, Tag, Typography } from "antd";

import type { DetectionRuleDetail } from "services/detections";
import { applyIndexPatternsToEsql, parseIndexPatterns } from "./utils";

type ConnectorRow = { id: string; name: string; connector_type_id?: string };
type KibanaMetadata = { published?: boolean; remote_id?: string; rule_id?: string; enabled?: boolean; name?: string; updated_at?: string };

type Props = {
  detail: DetectionRuleDetail;
  detailTab: "sigma" | "esql" | "version";
  versions: any[];
  connectors: ConnectorRow[];
  connectorDraftId: string;
  selectedActionIndex: number;
  selectedActionParamsText: string;
  elasticActionsText: string;
  elasticIndexPatternsText: string;
  kibanaMetadata: KibanaMetadata;
  onBack: () => void;
  onEdit: () => void;
  onPublish: () => Promise<void>;
  onSetDetailTab: (value: "sigma" | "esql" | "version") => void;
  onRollbackVersion: (version: number) => Promise<void>;
  onSaveElasticActions: () => Promise<void>;
  onSyncKibanaEnabled: (enabled: boolean) => Promise<void>;
  onDeleteKibanaRule: () => Promise<void>;
  onSetConnectorDraftId: (value: string) => void;
  onInsertConnectorTemplate: () => void;
  onLoadConnectors: () => Promise<void>;
  onSyncSelectedActionParams: (index: number) => void;
  onApplySelectedActionParams: () => void;
  onSetSelectedActionParamsText: (value: string) => void;
  onElasticActionsTextChange: (value: string) => void;
  onSetElasticIndexPatternsText: (value: string) => void;
};

export default function DetectionRuleDetail(props: Props) {
  const meta = props.detail.meta || {};
  const compiled = props.detail.compiled || {};
  const logSourceParts = [meta.product, meta.service, meta.category].filter((value) => String(value || "").trim());
  const compiledLanguage = String(compiled.language || (compiled.lucene ? "lucene" : "esql")).toLowerCase();
  const queryLabel = compiledLanguage === "lucene" ? "Lucene" : "ES|QL";
  const queryPreview =
    compiledLanguage === "lucene"
      ? String(compiled.lucene || "*")
      : applyIndexPatternsToEsql(compiled.esql || "*", parseIndexPatterns(props.elasticIndexPatternsText));
  const [selectedVersion, setSelectedVersion] = React.useState<number | undefined>(undefined);
  const formatVersionTime = (value: any) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const rollbackOptions = props.versions.map((item) => ({
    value: Number(item.version),
    label: `v${item.version} ${item.change_type || "update"} ${formatVersionTime(item.created_at)}`,
  }));
  const selectedVersionDetails =
    props.versions.find((item) => Number(item.version) === Number(selectedVersion)) ||
    props.versions[0] ||
    null;
  React.useEffect(() => {
    if (!selectedVersionDetails && props.versions.length) {
      setSelectedVersion(Number(props.versions[0].version));
      return;
    }
    if (!selectedVersion && props.versions.length) {
      setSelectedVersion(Number(props.versions[0].version));
    }
  }, [props.versions, selectedVersion, selectedVersionDetails]);
  const tabText =
    props.detailTab === "sigma"
      ? meta.detection_preview || props.detail.yaml || ""
      : props.detailTab === "esql"
        ? queryPreview
        : "";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <Button onClick={props.onBack}>Back to List</Button>
        <Space>
          <Button onClick={props.onEdit}>Edit</Button>
          <Button type="primary" onClick={props.onPublish}>Publish to Kibana</Button>
        </Space>
      </div>

      <Typography.Title level={2} style={{ marginTop: 0 }}>{meta.title || props.detail.id}</Typography.Title>
      <Space style={{ marginBottom: 10 }}>
        <Tag color="red">{meta.level || "medium"}</Tag>
        <Tag color="orange">{meta.status || "draft"}</Tag>
        <Typography.Text type="secondary">v{props.detail.version || 1}</Typography.Text>
      </Space>
      <Typography.Paragraph type="secondary">{meta.description || "No description"}</Typography.Paragraph>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <Card size="small" title="Log Source">{logSourceParts.length ? logSourceParts.join(" / ") : "unknown"}</Card>
        <Card size="small" title="Mapping Profile">{meta.profile || (compiled.profiles || [])[0] || "-"}</Card>
        <Card size="small" title="Tags">{Array.isArray(meta.tags) && meta.tags.length ? meta.tags.join(", ") : "-"}</Card>
      </div>

      <Card
        size="small"
        title="Kibana Detection Rule"
        style={{ marginBottom: 16 }}
        extra={
          props.kibanaMetadata.published ? (
            <Tag color={props.kibanaMetadata.enabled ? "green" : "gold"}>{props.kibanaMetadata.enabled ? "Enabled" : "Published but Disabled"}</Tag>
          ) : (
            <Tag>Not Published</Tag>
          )
        }
      >
        <Space wrap>
          <Typography.Text type="secondary">Rule ID: {props.kibanaMetadata.rule_id || "-"}</Typography.Text>
          <Typography.Text type="secondary">Remote ID: {props.kibanaMetadata.remote_id || "-"}</Typography.Text>
          <Button size="small" disabled={!props.kibanaMetadata.published || Boolean(props.kibanaMetadata.enabled)} onClick={() => props.onSyncKibanaEnabled(true)}>Enable</Button>
          <Button size="small" disabled={!props.kibanaMetadata.published || !Boolean(props.kibanaMetadata.enabled)} onClick={() => props.onSyncKibanaEnabled(false)}>Disable</Button>
          <Popconfirm title="Delete the detection rule from Kibana?" okText="Delete" cancelText="Cancel" onConfirm={props.onDeleteKibanaRule}>
            <Button size="small" danger disabled={!props.kibanaMetadata.published}>Delete Kibana Rule</Button>
          </Popconfirm>
        </Space>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Detection</Typography.Title>
        <Typography.Text type="secondary">{meta.detection_preview ? "Detection fields ready" : "0 detection fields"}</Typography.Text>
      </div>

      <Space style={{ marginBottom: 10 }}>
        <Button type={props.detailTab === "sigma" ? "primary" : "default"} onClick={() => props.onSetDetailTab("sigma")}>Sigma</Button>
        <Button type={props.detailTab === "esql" ? "primary" : "default"} onClick={() => props.onSetDetailTab("esql")}>{queryLabel}</Button>
        <Button type={props.detailTab === "version" ? "primary" : "default"} onClick={() => props.onSetDetailTab("version")}>Versions</Button>
      </Space>

      {compiled.error ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Typography.Text type={compiledLanguage === "lucene" ? "warning" : "danger"}>
            {compiledLanguage === "lucene" ? `ES|QL compile failed, using Lucene fallback: ${compiled.error}` : compiled.error}
          </Typography.Text>
        </Card>
      ) : null}

      {props.detailTab === "version" ? (
        <Space wrap style={{ marginBottom: 10 }}>
          <Select
            placeholder="Select a version"
            value={selectedVersion}
            onChange={(value) => setSelectedVersion(Number(value))}
            style={{ width: 320 }}
            options={rollbackOptions}
          />
          <Button
            size="small"
            disabled={!selectedVersion}
            onClick={() => {
              if (!selectedVersion) return;
              props.onRollbackVersion(selectedVersion);
            }}
          >
            Roll Back Selected Version
          </Button>
        </Space>
      ) : null}

      {props.detailTab === "version" && selectedVersionDetails ? (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={`v${selectedVersionDetails.version} ${selectedVersionDetails.change_type || "update"}`}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            <Typography.Text type="secondary">
              {formatVersionTime(selectedVersionDetails.created_at)} by {selectedVersionDetails.changed_by || "unknown"}
            </Typography.Text>
            {Array.isArray(selectedVersionDetails.change_summary) && selectedVersionDetails.change_summary.length ? (
              selectedVersionDetails.change_summary.map((row: any, index: number) => (
                <Card key={`${selectedVersionDetails.version}-${index}`} size="small">
                  <Typography.Text strong>{String(row?.label || row?.field || "Changed")}</Typography.Text>
                  <div>{String(row?.message || "Changed")}</div>
                  {row?.before ? <Typography.Text type="secondary">Before: {String(row.before)}</Typography.Text> : null}
                  {row?.after ? <div><Typography.Text type="secondary">After: {String(row.after)}</Typography.Text></div> : null}
                  {row?.diff ? (
                    <pre style={{ marginTop: 8, background: "#0c1733", color: "#e8eefc", borderRadius: 8, padding: 12, overflow: "auto", whiteSpace: "pre-wrap" }}>
                      {String(row.diff)}
                    </pre>
                  ) : null}
                </Card>
              ))
            ) : (
              <Typography.Text type="secondary">No detailed change summary recorded for this version.</Typography.Text>
            )}
          </Space>
        </Card>
      ) : null}

      {props.detailTab === "esql" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", gap: 16 }}>
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Card size="small" title={`${queryLabel} Query`}>
              <Space direction="vertical" style={{ width: "100%" }} size={10}>
                <Typography.Text type="secondary">
                  Index patterns belong to the Elastic detection rule itself and will be submitted as the detection rule `index` field.
                </Typography.Text>
                <Input.TextArea
                  value={props.elasticIndexPatternsText}
                  onChange={(e) => props.onSetElasticIndexPatternsText(e.target.value)}
                  rows={4}
                  placeholder={"logs-*\nwinlogbeat-*"}
                />
                <pre style={{ margin: 0, background: "#0c1733", color: "#e8eefc", borderRadius: 8, padding: 16, minHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}>
                  {tabText}
                </pre>
              </Space>
            </Card>
          </Space>
          <Card size="small" title="Kibana Detection Actions" extra={<Button size="small" onClick={props.onSaveElasticActions}>Save Configuration</Button>}>
            <Space direction="vertical" style={{ width: "100%" }} size={10}>
              <Typography.Text type="secondary">
                Configure only `actions` here. Action frequency defaults to `For each alert`.
              </Typography.Text>
              <Space wrap>
                <Select
                  placeholder="Select a connector template"
                  value={props.connectorDraftId || undefined}
                  onChange={props.onSetConnectorDraftId}
                  style={{ width: 260 }}
                  options={props.connectors.map((connector) => ({
                    value: connector.id,
                    label: `${connector.name}${connector.connector_type_id ? ` (${connector.connector_type_id})` : ""}`,
                  }))}
                />
                <Button onClick={props.onInsertConnectorTemplate} disabled={!props.connectorDraftId}>Insert Template</Button>
                <Button onClick={props.onLoadConnectors}>Refresh Connectors</Button>
              </Space>
              <Space wrap style={{ width: "100%" }}>
                <Select
                  placeholder="Select an action to edit"
                  value={(() => {
                    try {
                      const actions = JSON.parse(props.elasticActionsText || "[]");
                      return actions[props.selectedActionIndex] ? String(props.selectedActionIndex) : undefined;
                    } catch {
                      return undefined;
                    }
                  })()}
                  onChange={(value) => props.onSyncSelectedActionParams(Number(value))}
                  style={{ width: 260 }}
                  options={(() => {
                    try {
                      return JSON.parse(props.elasticActionsText || "[]").map((action: any, index: number) => ({
                        value: String(index),
                        label: `${index + 1}. ${String(action?.id || "action")}`,
                      }));
                    } catch {
                      return [];
                    }
                  })()}
                />
                <Button onClick={props.onApplySelectedActionParams}>Apply Current Params</Button>
              </Space>
              <Input.TextArea value={props.selectedActionParamsText} onChange={(e) => props.onSetSelectedActionParamsText(e.target.value)} rows={10} />
              <Input.TextArea value={props.elasticActionsText} onChange={(e) => props.onElasticActionsTextChange(e.target.value)} rows={16} />
            </Space>
          </Card>
        </div>
      ) : props.detailTab !== "version" ? (
        <pre style={{ margin: 0, background: "#0c1733", color: "#e8eefc", borderRadius: 8, padding: 16, minHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {tabText}
        </pre>
      ) : null}
    </Card>
  );
}
