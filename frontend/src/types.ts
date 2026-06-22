export interface Alert {
  alert_id: string;
  timestamp: string;
  severity: 'Critical' | 'Warning' | 'Info';
  message: string;
  description?: string | null;
  source_index: string;
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
  tickets: number;
  true_positive: number;
  security_events: number;
  incidents: number;
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
  labels?: SlaTicketLabel[];
  event_impact?: string | null;
  assigned_user_username?: string | null;
  created_time: string;
  updated_time: string;
  sla_summary?: SlaSummary | null;
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
