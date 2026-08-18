export function formatJson(value: any) {
  return JSON.stringify(value, null, 2);
}

export type AlertMode = "notable" | "risk";
export type RiskEntityType = "host" | "user" | "ip" | "service" | "risk_object";
export type RiskEntityConfig = {
  entity_type: RiskEntityType;
  entity_field: string;
  risk_score: number;
  output: AlertMode;
};

export type RiskIncidentConfig = {
  enabled?: boolean;
  window?: string;
  score_field?: string;
  group_by?: string[];
  operator?: string;
  value?: number;
  risk_score_output_field?: string;
  risk_event_count_field?: string;
  risk_object_type_field?: string;
  risk_object_field?: string;
};

export const RISK_ENTITY_FIELD_OPTIONS: Record<RiskEntityType, string[]> = {
  host: ["host.name", "host.hostname", "host.id"],
  user: ["user.name", "user.id", "user.email"],
  ip: ["source.ip", "destination.ip", "client.ip", "server.ip", "host.ip"],
  service: ["service.name", "service.id", "service.type"],
  risk_object: ["risk_object"],
};

export function defaultRiskEntityField(type: RiskEntityType) {
  return RISK_ENTITY_FIELD_OPTIONS[type][0];
}

export function resolveAlertModeConnector(
  connectors: Array<{ id: string; name: string; connector_type_id?: string }>,
  mode: AlertMode,
) {
  const indexConnectors = (Array.isArray(connectors) ? connectors : []).filter((connector) =>
    String(connector?.connector_type_id || "").toLowerCase().includes(".index"),
  );
  return indexConnectors.find((connector) => {
    const name = String(connector?.name || "").toLowerCase();
    return mode === "risk" ? name.includes("risk") : name.includes("notable") || name.includes("alert");
  });
}

function commonEventDocument(sigmaRuleId?: string) {
  return {
    "@timestamp": "{{context.alerts.0.@timestamp}}",
    alert_id: "{{alert.id}}",
    rule_id: "{{rule.id}}",
    rule_name: "{{context.rule.name}}",
    severity: "{{context.rule.severity}}",
    reason: "{{context.alerts.0.kibana.alert.reason}}",
    ...(sigmaRuleId ? { sigma_rule_id: sigmaRuleId } : {}),
  };
}

export function riskEventDocument(entity: RiskEntityConfig, sigmaRuleId?: string) {
  const entityType = entity.entity_type === "risk_object"
    ? "{{context.alerts.0.risk_object_type}}"
    : entity.entity_type;
  return {
    ...commonEventDocument(sigmaRuleId),
    event_kind: "risk",
    risk_score: entity.risk_score,
    risk_object_type: entityType,
    risk_object_field: entity.entity_field,
    risk_object: `{{context.alerts.0.${entity.entity_field}}}`,
  };
}

export function notableEventDocument(entity: RiskEntityConfig, sigmaRuleId?: string) {
  const entityType = entity.entity_type === "risk_object"
    ? "{{context.alerts.0.risk_object_type}}"
    : entity.entity_type;
  const common = {
    ...commonEventDocument(sigmaRuleId),
    event_kind: "notable",
    status: "new",
    risk_score: entity.risk_score,
    risk_object_type: entityType,
    risk_object_field: entity.entity_field,
    risk_object: `{{context.alerts.0.${entity.entity_field}}}`,
    produces_risk_event: true,
  };
  return common;
}

function riskIncidentFields(config: RiskIncidentConfig) {
  const scoreField = String(config.risk_score_output_field || "risk_score");
  const countField = String(config.risk_event_count_field || "risk_event_count");
  const objectTypeField = String(config.risk_object_type_field || "risk_object_type");
  const objectField = String(config.risk_object_field || "risk_object");
  const window = String(config.window || "15m");
  return {
    risk_score: `{{context.alerts.0.${scoreField}}}`,
    risk_event_count: `{{context.alerts.0.${countField}}}`,
    risk_object_type: `{{context.alerts.0.${objectTypeField}}}`,
    risk_object_field: objectField,
    risk_object: `{{context.alerts.0.${objectField}}}`,
    risk_window: window,
    risk_threshold: Number(config.value ?? 100),
    risk_message: `Risk object {{context.alerts.0.${objectField}}} accumulated {{context.alerts.0.${scoreField}}} risk points from {{context.alerts.0.${countField}}} risk events in ${window}.`,
    contributing_risk_query: `${objectTypeField}:\"{{context.alerts.0.${objectTypeField}}}\" AND ${objectField}:\"{{context.alerts.0.${objectField}}}\" AND @timestamp:[now-${window} TO now]`,
  };
}

export function riskIncidentRiskEventDocument(config: RiskIncidentConfig, sigmaRuleId?: string) {
  return {
    ...commonEventDocument(sigmaRuleId),
    event_kind: "risk",
    ...riskIncidentFields(config),
  };
}

export function riskIncidentNotableEventDocument(config: RiskIncidentConfig, sigmaRuleId?: string) {
  return {
    ...commonEventDocument(sigmaRuleId),
    event_kind: "notable",
    status: "new",
    ...riskIncidentFields(config),
    produces_risk_event: true,
  };
}

export function routeElasticActionsByAlertMode(
  connectors: Array<{ id: string; name: string; connector_type_id?: string }>,
  entities: RiskEntityConfig[],
  sigmaRuleId?: string,
) {
  if (!entities.length) return [];
  const riskTarget = resolveAlertModeConnector(connectors, "risk");
  if (!riskTarget) {
    throw new Error('No .index connector containing "Risk" in its name is configured');
  }
  const notableEntities = entities.filter((entity) => entity.output === "notable");
  const needsNotable = notableEntities.length > 0;
  const notableTarget = needsNotable ? resolveAlertModeConnector(connectors, "notable") : undefined;
  if (needsNotable && !notableTarget) {
    throw new Error('No .index connector containing "Notable" or "Alert" in its name is configured');
  }
  const frequency = {
    summary: false,
    notifyWhen: "onActiveAlert",
    throttle: null,
  };
  const routedActions = entities.map((entity) => ({
      group: "default",
      id: riskTarget.id,
      action_type_id: riskTarget.connector_type_id || ".index",
      params: {
        documents: [riskEventDocument(entity, sigmaRuleId)],
      },
      frequency,
    }));
  if (notableTarget) {
    routedActions.push(...notableEntities.map((entity) => ({
      group: "default",
      id: notableTarget.id,
      action_type_id: notableTarget.connector_type_id || ".index",
      params: {
        documents: [notableEventDocument(entity, sigmaRuleId)],
      },
      frequency,
    })));
  }
  return routedActions;
}

export function guessElasticIndexPatternsFromProfile(profile?: string) {
  const p = String(profile || "").toLowerCase();
  if (!p) return ["logs-*"];
  if (p.includes("argus_risk")) return ["argus-risk-events"];
  if (p.includes("windows")) return ["logs-windows.*", "winlogbeat-*"];
  if (p.includes("linux")) return ["logs-linux.*", "filebeat-*"];
  if (p.includes("aws") || p.includes("cloudtrail")) return ["logs-aws.cloudtrail-*"];
  if (p.includes("azure")) return ["logs-azure.*"];
  if (p.includes("m365") || p.includes("o365") || p.includes("office365")) return ["logs-o365.audit-*"];
  if (p.includes("okta")) return ["logs-okta.system-*"];
  if (p.includes("network") || p.includes("proxy") || p.includes("firewall")) return ["logs-network.*"];
  if (p.includes("dns")) return ["logs-*-dns*"];
  return ["logs-*"];
}

export function parseIndexPatterns(text: string) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function applyIndexPatternsToEsql(query: string, indexPatterns: string[]) {
  const source = String(query || "").trim();
  const patterns = Array.isArray(indexPatterns) ? indexPatterns.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!source || !patterns.length) return source;
  const nextFrom = patterns.join(", ");
  return source.replace(/(^\s*from\s+)([^\|\r\n]+)/im, (_match, prefix, body) => {
    const currentFrom = String(body || "").trim();
    const metadataMatch = currentFrom.match(/\s+metadata\s+/i);
    const metadata = metadataMatch?.index !== undefined ? currentFrom.slice(metadataMatch.index) : "";
    return `${prefix}${nextFrom}${metadata} `;
  });
}
