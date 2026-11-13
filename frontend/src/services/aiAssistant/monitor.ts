import client from '../../api';

export type MonitorKind = 'tools' | 'models';
export type MonitorPeriodUnit = 'hour' | 'day' | 'week';
export interface MonitorQuery {
  period_value: number;
  period_unit: MonitorPeriodUnit;
  user_id?: number;
  model_profile_id?: string;
  tool?: string;
  status?: string;
  page: number;
  page_size: number;
}
export interface ToolUsageStats {
  total_calls: number; success_calls: number; failed_calls: number; pending_calls: number;
  avg_duration_ms: number | null; last_call_time: string | null;
}
export interface ModelUsageStats {
  total_calls: number; success_calls: number; failed_calls: number; running_calls: number;
  input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; total_tokens: number | null;
  usage_known_calls: number; cost_known_calls: number; avg_duration_ms: number | null;
  costs: Array<{ currency: string; estimated_cost: string; known_calls: number }>;
}
interface ExecutionAttribution {
  id: string; source: string; status: string; start_time: string; end_time: string | null; duration_ms: number | null;
  user_id: number | null; user_label: string; model_profile_id: string | null; model_name: string;
  agent_name: string; request_id: string | null;
}
export interface ToolUsageExecution extends ExecutionAttribution { tool_name: string; tool_source: string }
export interface ModelUsageExecution extends ExecutionAttribution {
  profile_name: string;
  input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; total_tokens: number | null;
  currency: string; estimated_cost: string | null; error_code: string;
}
interface MonitorResponse {
  scope: { can_view_all: boolean };
  window: { since: string; until: string };
  count: number; page: number; page_size: number; total_pages: number;
  users: Array<{ id: number; label: string }>;
  models: Array<{ id: string; label: string }>;
  groups_truncated: boolean;
}
export interface ToolMonitorResponse extends MonitorResponse {
  summary: ToolUsageStats;
  by_user: Array<ToolUsageStats & { user_id: number | null; user_label: string }>;
  by_tool: Array<ToolUsageStats & { tool_name: string }>;
  executions: ToolUsageExecution[];
}
export interface ModelMonitorResponse extends MonitorResponse {
  summary: ModelUsageStats;
  by_user: Array<ModelUsageStats & { user_id: number | null; user_label: string }>;
  by_model: Array<ModelUsageStats & { model_profile_id: string | null; profile_name: string; model_name: string }>;
  executions: ModelUsageExecution[];
}
export interface ExecutionContent {
  available: boolean;
  data: unknown;
  truncated: boolean;
  reason?: string;
}
export interface MonitorExecutionDetail {
  execution: ToolUsageExecution | ModelUsageExecution;
  request: ExecutionContent;
  response: ExecutionContent;
}

export async function fetchToolMonitor(params: MonitorQuery, signal?: AbortSignal): Promise<ToolMonitorResponse> {
  return (await client.get('/ai-assistant/tool-monitor/', { params, signal })).data;
}
export async function fetchModelMonitor(params: MonitorQuery, signal?: AbortSignal): Promise<ModelMonitorResponse> {
  return (await client.get('/ai-assistant/model-monitor/', { params, signal })).data;
}
export async function fetchMonitorExecution(kind: MonitorKind, id: string, signal?: AbortSignal): Promise<MonitorExecutionDetail> {
  const monitor = kind === 'models' ? 'model-monitor' : 'tool-monitor';
  return (await client.get(`/ai-assistant/${monitor}/${encodeURIComponent(id)}/`, { signal })).data;
}
