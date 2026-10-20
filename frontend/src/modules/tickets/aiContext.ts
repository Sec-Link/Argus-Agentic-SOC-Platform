import type { SlaTicketAttachment, SlaTicketDetail, SlaTicketHandleLog, SlaTicketListItem, SlaTicketWorkLog } from '../../types';

type LoadState = 'loading' | 'loaded' | 'error';
type WorkplanItem = {
  execution_id: string; workflow_name: string; status: string; trigger_source: string;
  workflow_id?: string; progress_percent?: number; created_at?: string;
  started_at?: string | null; completed_at?: string | null; executed_by?: unknown; error_message?: string;
};
type DetailInput = {
  ticket: SlaTicketDetail;
  workLogs: SlaTicketWorkLog[];
  handleLogs: SlaTicketHandleLog[];
  attachments: SlaTicketAttachment[];
  workplanItems: WorkplanItem[];
  observables: unknown[];
  ai: { summary?: unknown; raw_response?: unknown; header?: unknown; completed_tasks?: unknown; next_tasks?: unknown };
  view: { active_tab: string; incident_tab: string; pending?: boolean };
  availability: { handle_logs: LoadState; workplan: LoadState };
};
type ListInput = {
  tickets: SlaTicketListItem[];
  filters: { query: string; facets: unknown; time_range: string | null; applied_query?: Record<string, string> };
  selectedIds: string[];
  loadedCount: number;
  loading: boolean;
};
type SafeValue = null | boolean | number | string | SafeValue[] | { [key: string]: SafeValue };

const LIST_FIELDS = [
  'ticket_number', 'title', 'status', 'priority', 'assigned_user_username', 'event_impact',
  'created_time', 'updated_time', 'labels', 'sla_summary', 'mitre_tags',
];
const DETAIL_FIELDS = [
  ...LIST_FIELDS, 'event_siem_id', 'event_scope', 'current_assign_group', 'current_assign_owner',
  'assigned_user', 'event_response_time', 'event_analysis_time', 'event_containment_time',
  'ticket_resolved_time', 'ticket_closed_time', 'event_level', 'event_category', 'event_result',
  'event_containment_cause', 'event_cause_category', 'ticket_stage', 'event_platform',
  'event_risk_score', 'ticket_category', 'attachments_count', 'work_logs_count', 'sla', 'description',
];
const SENSITIVE_KEY = /(?:password|passwd|pwd|secret|token|authorization|cookie|apikey|privatekey|credentials?|sessionid|secretaccesskey|secretkey|privatekeypem|密码|口令|密钥|令牌)(?:value|hash)?$/i;
const SECRET_TEXT_LABEL = String.raw`(?:[\w.$-]*(?:password|passwd|pwd|secret|token|authorization|cookie|api[ _.-]?key|private[ _.-]?key|credentials?|session[ _.-]?id|secret[ _.-]?(?:access[ _.-]?)?key|private[ _.-]?key[ _.-]?pem)(?:[ _.-]?(?:value|hash))?|密码|口令|密钥|令牌)`;
const SECRET_TEXT_BLOCK = new RegExp(String.raw`(^|\n)([\t ]*${SECRET_TEXT_LABEL}[\t ]*[:=][\t ]*)[^\r\n]*(?:\r?\n[\t ]+[^\r\n]*)+`, 'gi');
const SECRET_TEXT_VALUE = new RegExp(String.raw`(^|[\s{,;])(["']?${SECRET_TEXT_LABEL}["']?\s*(?::|=|\n)\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\r\n}]+?(?=[\s,;&]+[\w.$-]+\s*[:=]|[}\r\n]|$))`, 'gi');
const TRUNCATED = '[truncated]';
const MAX_STRING = 128_000;

function pick(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function jsonEnd(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '\\') { i++; continue; }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '{' || char === '[') depth++;
    if ((char === '}' || char === ']') && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Preserve investigation evidence; filter credential values without anonymizing identifiers. */
function snapshotSanitizer() {
  const cleanText = (value: string) => value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => url
      .replace(/^(https?:\/\/[^/@:]+):[^/@]*@/i, '$1:[redacted]@')
      .replace(/([?&#;])([^=&?#;]+)=([^&#;]*)/g, (match, separator: string, key: string) => {
        let decoded = key;
        try { decoded = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* Keep malformed URL keys as evidence. */ }
        return SENSITIVE_KEY.test(decoded.replace(/[^\p{L}\p{N}]/gu, '')) ? `${separator}${key}=[redacted]` : match;
      }))
    // Credential headers and indented blocks may contain several values or delimiters.
    .replace(/(^|[\s{,;])((?:proxy[ -]?)?authorization|(?:set[ -]?)?cookie)([\t ]*[:=][\t ]*)[^\r\n]*(?:\r?\n[\t ]+[^\r\n]*)*/gi, '$1$2$3[redacted]')
    .replace(SECRET_TEXT_BLOCK, '$1$2[redacted]')
    .replace(SECRET_TEXT_VALUE, '$1$2[redacted]')
    .replace(/\bBasic\s+[A-Za-z0-9+/_=-]+/gi, 'Basic [redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g, '[redacted]');

  return (value: unknown): SafeValue => {
    let visited = 0;
    let characters = 0;
    const ancestors = new WeakSet<object>();
    const sanitize = (input: unknown, depth = 0): SafeValue => {
      if (++visited > 4000 || depth > 12) return TRUNCATED;
      if (input == null) return null;
      if (typeof input === 'number') return Number.isFinite(input) ? input : null;
      if (typeof input === 'boolean') return input;
      if (typeof input === 'string') {
        // Never cut a raw credential mid-value, or parse a truncated JSON document.
        characters += input.length;
        if (input.length > MAX_STRING || characters > 256_000) return '[truncated: oversized string omitted]';
        const trimmed = input.trim();
        if (trimmed.startsWith('"')) {
          try {
            const decoded: unknown = JSON.parse(trimmed);
            if (typeof decoded === 'string') return sanitize(decoded, depth + 1);
          } catch { /* Continue with object fragments and prose. */ }
        }
        const jsonStart = trimmed.search(/[\[{]/);
        if (jsonStart >= 0) {
          try {
            const end = jsonEnd(trimmed, jsonStart);
            const parsed: unknown = JSON.parse(trimmed.slice(jsonStart, end));
            if (parsed && typeof parsed === 'object') {
              const safe = sanitize(parsed, depth + 1);
              return jsonStart || end < trimmed.length
                ? { text: cleanText(trimmed.slice(0, jsonStart)), data: safe, trailing_text: sanitize(trimmed.slice(end), depth + 1) }
                : safe;
            }
          } catch { /* Non-JSON log prose is redacted as text below. */ }
        }
        // Quoted values may contain escaped quotes or newlines even in otherwise invalid JSON.
        const quoted = input.replace(/(["'])([^"'\r\n]{1,100})\1\s*:\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/g,
          (match, quote: string, key: string) => SENSITIVE_KEY.test(key.replace(/[^\p{L}\p{N}]/gu, '')) ? `${quote}${key}${quote}: "[redacted]"` : match);
        return cleanText(quoted);
      }
      if (typeof input !== 'object' || input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return '[omitted]';
      if (ancestors.has(input)) return '[cycle omitted]';
      ancestors.add(input);
      let result: SafeValue;
      if (Array.isArray(input)) {
        result = input.slice(0, 200).map(item => sanitize(item, depth + 1));
        if (input.length > 200) result.push(`[truncated: ${input.length - 200} additional items]`);
      } else {
        const object = input as Record<string, unknown>;
        const valueIsSecret = ['label_name', 'name', 'key', 'type'].some(key => {
          const label = object[key];
          return typeof label === 'string' && SENSITIVE_KEY.test(label.replace(/[^\p{L}\p{N}]/gu, ''));
        });
        const entries: [string, SafeValue][] = [];
        for (const key of Object.keys(object).slice(0, 200)) {
          const normalized = key.replace(/[^\p{L}\p{N}]/gu, '');
          if (key.length > 300) continue;
          const secret = SENSITIVE_KEY.test(normalized) || ((key === 'label_value' || key === 'value') && valueIsSecret);
          entries.push([cleanText(key), secret ? '[redacted]' : sanitize(object[key], depth + 1)]);
          if (visited > 4000) break;
        }
        if (Object.keys(object).length > entries.length && visited > 4000) entries.push(['_truncated', true]);
        else if (Object.keys(object).length > 200) entries.push(['_truncated', true]);
        result = Object.fromEntries(entries);
      }
      ancestors.delete(input);
      return result;
    };
    return sanitize(value);
  };
}

/** Keep section JSON valid and preserve later sections when one event or log is enormous. */
function boundedJson(value: SafeValue, budget: number): string {
  const full = JSON.stringify(value);
  if (full.length <= budget) return full;
  if (typeof value === 'string') {
    let length = Math.max(0, Math.min(value.length, budget - 20));
    while (JSON.stringify(`${value.slice(0, length)} ${TRUNCATED}`).length > budget) length = Math.floor(length * 0.8);
    return JSON.stringify(`${value.slice(0, length)} ${TRUNCATED}`);
  }
  const array = Array.isArray(value);
  const entries = array ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, SafeValue>);
  const parts: string[] = [];
  const marker = array ? JSON.stringify(TRUNCATED) : '"_truncated":true';
  let remaining = budget - marker.length - 3;
  for (const [key, child] of entries) {
    const prefix = array ? '' : `${JSON.stringify(key)}:`;
    if (remaining - prefix.length < 32) break;
    const rendered = boundedJson(child, remaining - prefix.length);
    parts.push(prefix + rendered);
    remaining -= prefix.length + rendered.length + 1;
  }
  parts.push(marker);
  return `${array ? '[' : '{'}${parts.join(',')}${array ? ']' : '}'}`;
}

function section(name: string, data: unknown, budget: number, sanitize: ReturnType<typeof snapshotSanitizer>): string {
  return `## ${name}\n${boundedJson(sanitize(data), budget)}\n`;
}

function newestFirst<T>(items: T[], date: (item: T) => string | null | undefined): T[] {
  return items.slice().sort((a, b) => (Date.parse(date(b) || '') || 0) - (Date.parse(date(a) || '') || 0));
}

function taskItems(value: unknown): unknown {
  return Array.isArray(value) ? value.slice(0, 100).map(item => typeof item === 'string' ? item : pick(item, ['title', 'detail', 'status'])) : [];
}

export function buildTicketDetailContext(input: DetailInput): { kind: 'ticket_detail'; title: string; content: string } {
  const sanitize = snapshotSanitizer();
  const title = String(sanitize(`${input.ticket.ticket_number}: ${input.ticket.title}`)).slice(0, 200);
  const logs = newestFirst(input.workLogs, log => log.created_at);
  const content = [
    'Ticket detail snapshot: saved data already loaded for this ticket, including inactive tabs. No additional requests. Alert identifiers and evidence retain their original values; credential values are filtered. Truncation is marked; missing data is not evidence of absence.',
    section('Page state', { view: pick(input.view, ['active_tab', 'incident_tab', 'pending']), availability: input.availability }, 600, sanitize),
    section('Ticket', pick(input.ticket, DETAIL_FIELDS), 7000, sanitize),
    section('Raw alert evidence', input.ticket.alert_message ?? null, 11000, sanitize),
    section('Related ticket records', input.ticket.ticket_records ?? null, 2000, sanitize),
    section('Event sources', input.ticket.event_sources ?? null, 1000, sanitize),
    section('Work logs (latest first)', {
      loaded_count: logs.length, reported_count: input.ticket.work_logs_count ?? null,
      selected_before_size_limit: Math.min(logs.length, 100), omitted_by_count_limit: Math.max(0, logs.length - 100),
      items: logs.slice(0, 100).map(log => pick(log, ['id', 'created_at', 'created_by', 'created_by_username', 'log_entry'])),
    }, 9000, sanitize),
    section('Handle logs (latest first)', {
      state: input.availability.handle_logs, loaded_count: input.handleLogs.length,
      items: newestFirst(input.handleLogs, log => log.handled_at).slice(0, 100).map(log => pick(log, ['handled_at', 'handler_username', 'action_taken'])),
    }, 3500, sanitize),
    section('Playbook workplan', {
      state: input.availability.workplan, loaded_count: input.workplanItems.length,
      items: newestFirst(input.workplanItems, item => item.created_at).slice(0, 100).map(item => pick(item, [
        'execution_id', 'workflow_name', 'workflow_id', 'status', 'trigger_source', 'progress_percent',
        'created_at', 'started_at', 'completed_at', 'executed_by', 'error_message',
      ])),
    }, 3500, sanitize),
    section('Attachments (metadata only)', {
      loaded_count: input.attachments.length, reported_count: input.ticket.attachments_count ?? null,
      items: input.attachments.slice(0, 100).map(item => pick(item, ['id', 'file_name', 'uploaded_time', 'uploaded_user'])),
    }, 1800, sanitize),
    section('Observables', { loaded_count: input.observables.length, items: input.observables.slice(0, 100).map(item => pick(item, ['type', 'value', 'source', 'created_at'])) }, 2800, sanitize),
    section('Existing AI analysis (not independently verified)', {
      header: pick(input.ai.header, ['score', 'risk_level', 'ai_confidence', 'summary_title', 'platform', 'source']),
      summary: input.ai.summary,
      completed_tasks: taskItems(input.ai.completed_tasks), next_tasks: taskItems(input.ai.next_tasks),
      raw_response: input.ai.raw_response,
    }, 4000, sanitize),
  ].join('\n');
  return { kind: 'ticket_detail', title, content };
}

export function buildTicketListContext(input: ListInput): { kind: 'ticket_list'; title: string; content: string } {
  const sanitize = snapshotSanitizer();
  return {
    kind: 'ticket_list', title: 'Tickets - current filtered list',
    content: [
      'Ticket list snapshot: current loaded and filtered set only, not all server tickets. At most 100 rows are included. No detail requests. Alert identifiers retain their original values; credential values are filtered.',
      section('List state', {
        loading: input.loading, loaded_count: input.loadedCount, filtered_count: input.tickets.length,
        selected_before_size_limit: Math.min(input.tickets.length, 100), omitted_by_count_limit: Math.max(0, input.tickets.length - 100),
        selected_count: input.selectedIds.length,
        filters: {
          query: input.filters.query, facets: pick(input.filters.facets, ['severity', 'status', 'owner', 'sla']),
          time_range: input.filters.time_range, applied_query: pick(input.filters.applied_query, ['created_from', 'created_to']),
        },
        selected_ids: input.selectedIds.slice(0, 100),
      }, 3000, sanitize),
      section('Filtered ticket rows', input.tickets.slice(0, 100).map(ticket => pick(ticket, LIST_FIELDS)), 20000, sanitize),
    ].join('\n'),
  };
}
