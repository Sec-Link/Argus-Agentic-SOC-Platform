export function formatJson(value: any) {
  return JSON.stringify(value, null, 2);
}

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

export function parseElasticActions(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Elastic actions must be a JSON array");
  return parsed;
}

export function defaultConnectorParams(connectorTypeId?: string) {
  const typeId = String(connectorTypeId || "").toLowerCase();
  if (typeId.includes(".index")) {
    return {
      documents: [
        {
          "@timestamp": "{{context.alerts.0.@timestamp}}",
          title: "{{context.rule.name}}",
          description: "{{context.alerts.0.kibana.alert.reason}}",
          severity: "{{context.rule.severity}}",
          rule_id: "{{rule.id}}",
          alert_id: "{{alert.id}}",
        },
      ],
    };
  }
  if (typeId.includes(".email")) {
    return {
      to: [],
      cc: [],
      bcc: [],
      subject: "{{context.rule.name}}",
      message: "{{context.alerts.0.kibana.alert.reason}}",
    };
  }
  if (typeId.includes(".slack") || typeId.includes(".teams")) {
    return {
      message: "{{context.rule.name}}: {{context.alerts.0.kibana.alert.reason}}",
    };
  }
  if (typeId.includes(".webhook")) {
    return {
      body: {
        rule: "{{context.rule.name}}",
        reason: "{{context.alerts.0.kibana.alert.reason}}",
      },
    };
  }
  return {};
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

export function enrichElasticActions(actions: any[], connectors: Array<{ id: string; connector_type_id?: string }>) {
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const connector = connectors.find((item) => item.id === String(action?.id || ""));
    const connectorTypeId = String(action?.action_type_id || connector?.connector_type_id || "").trim();
    let nextParams = action?.params;
    if (
      connectorTypeId.toLowerCase().includes(".index") &&
      nextParams &&
      !Array.isArray(nextParams?.documents) &&
      nextParams?.document
    ) {
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
        notifyWhen: "onActiveAlert",
        throttle: null,
      },
    };
  });
}

export function dedupeElasticActions(actions: any[]) {
  const list = Array.isArray(actions) ? actions : [];
  const deduped: any[] = [];
  const byConnectorId = new Map<string, number>();

  list.forEach((action) => {
    const connectorId = String(action?.id || "").trim();
    if (!connectorId) {
      deduped.push(action);
      return;
    }
    const existingIndex = byConnectorId.get(connectorId);
    if (existingIndex === undefined) {
      byConnectorId.set(connectorId, deduped.length);
      deduped.push(action);
      return;
    }
    deduped[existingIndex] = action;
  });

  return deduped;
}
