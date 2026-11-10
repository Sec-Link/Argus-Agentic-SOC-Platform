export interface Alert {
  alert_id: string;
  timestamp: string;
  severity: 'Critical' | 'Warning' | 'Info';
  message: string;
  description?: string | null;
  source_index: string;
  rule_id?: string | null;
  rule_name?: string | null;
  // Risk objects extracted by the RBA pipeline, or a raw JSON string / array
  // injected by the ELK alert action. Parsed defensively via utils/riskObjects.
  risk_objects?: unknown;
  risk_object?: unknown;
}

export interface DashboardData {
  severity: Record<string, number>;
  timeline: Record<string, number>;
  total: number;
  source?: string;
  source_index?: Record<string, number>;
  daily_trend?: Record<string, number>;
  top_messages?: Record<string, number>;

  // Extended DB-backed dashboard metrics
  recent_1h_alerts?: number | null;
  data_source_count?: number | null;
  enabled_siem_rule_count?: number | null;
  siem_rule_detected_count_1h?: number | null;

  // Extended dashboard blocks
  category_breakdown?: Record<string, number>;
  severity_distribution?: Record<string, number>;
  alert_trend?: Record<string, number>;
  alert_score_trend?: Record<string, number>;
  // Optional stacked-series versions for segmented/stacked bar charts
  alert_trend_series?: Array<{ time: string; series: string; value: number }>;
  alert_score_trend_series?: Array<{ time: string; series: string; value: number }>;
  top_source_ips?: Array<{ name: string; count: number }>;
  top_users?: Array<{ name: string; count: number }>;
  top_sources?: Array<{ name: string; count: number }>;
  top_rules?: Array<{ name: string; count: number }>;
}

export interface ConversionStats {
  alerts: number;
  detection_rules?: number;
  tickets: number;
  true_positive: number;
  security_events: number;
  incidents: number;
}

export interface AttackCoverageTechnique {
  technique_id: string;
  name: string;
  rule_count: number;
}

export interface AttackCoverageTactic {
  tactic_id: string;
  name: string;
  slug: string;
  covered_techniques: number;
  total_techniques: number | null;
  techniques: AttackCoverageTechnique[];
}

export interface AttackCoverage {
  catalog_loaded: boolean;
  covered_techniques: number;
  total_techniques: number | null;
  coverage_percent: number | null;
  enabled_rules: number;
  tactics: AttackCoverageTactic[];
}

export interface LogSourceCategory {
  id: number;
  name: string;
  matchers: string[];
  asset_types: string[];
  host_field: string;
  enabled: boolean;
  sort_order: number;
  icon?: string | null;
}

export interface LogSourceCoverageSource {
  source_key: string;
  docs: number;
  last_seen: string | null;
  origin: 'auto' | 'manual';
  enabled_rules: number;
  total_rules: number;
}

export interface DiscoveredLogSource {
  source_key: string;
  index_count: number;
  docs: number;
  last_seen: string | null;
  hosts_approx: number;
  auto_category: string;
  auto_category_id: number | null;
  auto_confidence: 'high' | 'medium' | 'none';
  auto_reason: string;
  manual: { category_id: number | null; ignored: boolean } | null;
  ignored: boolean;
  effective_category_id: number | null;
  origin: 'auto' | 'manual';
}

export interface LogSourceDiscovery {
  initialized: boolean;
  scanned_at: string | null;
  scan_age_seconds: number | null;
  es_available: boolean;
  reason: string | null;
  window_days: number;
  truncated: boolean;
  sources: DiscoveredLogSource[];
}

export interface LogSourceBrief {
  source_key: string;
  docs: number;
  last_seen: string | null;
  auto_category: string;
  auto_confidence: 'high' | 'medium' | 'none';
  auto_reason: string;
  enabled_rules: number;
  total_rules: number;
}

export interface LogSourceRuleItem {
  id: string;
  name: string;
  enabled: boolean;
  state: 'with_data' | 'without_data' | 'unknown' | 'disabled';
  categories: string[];
  sources: string[];
}

export interface LogSourceRuleCoverage {
  total_rules: number;
  enabled_rules: number;
  enabled_percent: number | null;
  enabled_with_data: number;
  enabled_without_data: number;
  enabled_unmapped: number;
  items?: LogSourceRuleItem[];
}

export interface LogSourceCoverage {
  window_days: number;
  initialized: boolean;
  scanned_at: string | null;
  scan_age_seconds: number | null;
  rules: LogSourceRuleCoverage | null;
  unclassified: LogSourceBrief[];
  ignored: LogSourceBrief[];
  es_available: boolean;
  es_reason: string | null;
  unclassified_sources: number;
  ignored_sources: number;
  total_categories: number;
  configured_categories: number;
  active_categories: number;
  unconfigured_categories: number;
  coverage_percent: number | null;
  categories: Array<{
    id: number;
    name: string;
    configured: boolean;
    source_count: number;
    enabled_rules: number;
    total_rules: number;
    sources: LogSourceCoverageSource[];
    active: boolean;
    last_seen: string | null;
    expected_assets: number | null;
    observed_assets: number | null;
    asset_coverage_percent: number | null;
    data_source: 'elasticsearch' | 'alerts' | null;
  }>;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  stage?: string;
}

export interface SankeyStats {
  nodes: Array<{ name: string; stage?: string }>;
  links: SankeyLink[];
  stages?: string[];
  summary?: { tickets?: number };
}

export interface SlaSummary {
  mtta_seconds?: number | null;
  mtti_seconds?: number | null;
  mttc_seconds?: number | null;
  mttr_seconds?: number | null;
}

export interface SlaTicketLabel {
  label_name: string;
  label_value?: string | null;
}

export interface SlaTicketListItem {
  ticket_number: string;
  title: string;
  status: string;
  priority: string;
  event_result?: string | null;
  labels?: SlaTicketLabel[];
  event_impact?: string | null;
  assigned_user_username?: string | null;
  created_time: string;
  updated_time: string;
  sla_summary?: SlaSummary | null;
  mitre_tags?: string[] | null;
}

export interface SlaTicketDetail extends SlaTicketListItem {
  event_siem_id?: string | null;
  description?: string | null;
  event_scope?: string | null;
  current_assign_group?: string | null;
  current_assign_owner?: string | null;
  assigned_user?: number | null;
  event_response_time?: string | null;
  event_analysis_time?: string | null;
  event_containment_time?: string | null;
  ticket_resolved_time?: string | null;
  ticket_closed_time?: string | null;
  event_level?: string | null;
  event_category?: string | null;
  event_result?: string | null;
  ticket_records?: any;
  event_sources?: any;
  event_platform?: string | null;
  event_risk_score?: number | null;
  ticket_category?: string | null;
  event_containment_cause?: string | null;
  event_cause_category?: string | null;
  ticket_stage?: string | null;
  alert_message?: string | null;
  attachments_count?: number | null;
  work_logs_count?: number | null;
  sla?: {
    mtta_seconds?: number | null;
    mtti_seconds?: number | null;
    mttc_seconds?: number | null;
    mttr_seconds?: number | null;
    mtta_display?: string | null;
    mtti_display?: string | null;
    mttc_display?: string | null;
    mttr_display?: string | null;
  } | null;
}

export interface SlaTicketAttachment {
  id: number;
  ticket: string;
  file_name: string;
  file_path: string;
  uploaded_time: string;
  uploaded_user?: number | null;
}

export interface SlaTicketWorkLog {
  id: number;
  ticket: string;
  log_entry: string;
  created_by?: number | null;
  created_by_username?: string | null;
  created_at: string;
}

export interface SlaTicketHandleLog {
  handler_username?: string | null;
  handled_at?: string | null;
  action_taken: string;
}

export interface TicketPolicy {
  id: number;
  name: string;
  policy_type: 'creation';
  content: any;
  created_at: string;
  updated_at: string;
}

export interface Integration {  
  integration_id: string;
  status: string;
  title: string;
  description: string;
  related_alert_id?: string;
  created_at: string;
}

export interface EventFlowGroup {
  category_id: number | null;
  name: string;
  icon?: string | null;
  total_docs: number;
  sources: Array<{
    source_key: string;
    docs: number;
    last_seen?: string | null;
    hosts?: number | null;
    indices?: number | null;
    origin?: 'auto' | 'manual' | null;
  }>;
  others: { count: number; docs: number } | null;
}

export interface EventFlow {
  initialized: boolean;
  window_days: number | null;
  scanned_at: string | null;
  total_events: number;
  groups: EventFlowGroup[];
  alerts: number;
  open_tickets: number;
  incidents: number;
}
