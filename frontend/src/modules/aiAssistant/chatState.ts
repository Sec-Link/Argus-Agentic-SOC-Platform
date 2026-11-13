import type { PageChatDiagnostic, PageChatEvent } from '../../services/aiAssistant/stream';

export interface ChatStep {
  id: string;
  kind: 'model' | 'tool' | 'analysis' | 'agent';
  label: string;
  status: 'running' | 'completed' | 'failed' | 'approval' | 'approved' | 'rejected' | 'unconfirmed';
  content?: string;
  arguments?: unknown;
  executionId?: string;
  endpoint?: string;
  request?: PageChatEvent['request'];
  agent?: string;
  agentTitle?: string;
  delegationId?: string;
  task?: string;
  iteration?: number;
  diagnostic?: PageChatDiagnostic;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: ChatStep[];
  status?: 'running' | 'done' | 'error' | 'stopped';
  phase?: string;
  iteration?: number;
  requestId?: string;
  diagnostic?: PageChatDiagnostic;
}

const SERVER_ERROR_CODES = new Set([
  'model_timeout', 'model_connection_error', 'model_dns_error', 'model_tls_error',
  'model_auth_error', 'model_rate_limited', 'model_upstream_error', 'model_bad_request', 'model_content_rejected',
  'model_not_found', 'model_http_error', 'model_key_missing', 'model_ca_invalid',
  'model_response_invalid', 'model_error', 'model_profile_unavailable', 'permission_denied', 'internal_error',
  'execution_timeout', 'execution_stopped', 'iteration_limit',
  'conversation_limit', 'conversation_save_failed',
]);

export function diagnosticFromEvent(event: PageChatEvent): PageChatDiagnostic {
  const typed = !!event.code && SERVER_ERROR_CODES.has(event.code);
  const message = event.message || (event.type === 'agent_error' ? event.content : undefined);
  return {
    code: typed ? event.code! : 'server_error',
    // Untyped legacy messages may contain provider or credential details.
    message: typed && message && message.length <= 500
      ? message : 'The backend did not provide supported structured error details. If it was recently updated, reload it to apply the changes. Check the backend logs before retrying.',
    request_id: event.request_id, stage: event.stage, iteration: event.iteration,
    agent: event.agent, agent_title: event.agent_title, delegation_id: event.delegation_id,
    status_code: event.status_code,
  };
}

export function failChatTurn(turn: ChatMessage, diagnostic: PageChatDiagnostic): ChatMessage {
  const latest = [...(turn.steps || [])].reverse();
  const active = latest.find((step) => ['running', 'approval', 'approved'].includes(step.status)) || latest[0];
  const sameScope = (!diagnostic.agent || diagnostic.agent === active?.agent)
    && (!diagnostic.delegation_id || diagnostic.delegation_id === active?.delegationId);
  return finishChatTurn({
    ...turn,
    diagnostic: {
      ...diagnostic,
      request_id: diagnostic.request_id || turn.requestId,
      iteration: diagnostic.iteration ?? (sameScope ? active?.iteration ?? turn.iteration : undefined),
      agent: diagnostic.agent || (sameScope ? active?.agent : undefined),
      agent_title: diagnostic.agent_title || (sameScope ? active?.agentTitle : undefined),
      delegation_id: diagnostic.delegation_id || (sameScope ? active?.delegationId : undefined),
    },
  }, 'error');
}

export function finishChatTurn(turn: ChatMessage, status: 'done' | 'error' | 'stopped'): ChatMessage {
  return {
    ...turn, status,
    phase: status === 'done' ? 'Complete' : status === 'stopped' ? 'Stopped. Calls already started may still finish.' : 'Failed. Review the error details and completed steps before retrying.',
    steps: turn.steps?.map((step) => ['running', 'approval', 'approved'].includes(step.status)
      ? { ...step, status: status === 'done' && ['model', 'analysis'].includes(step.kind) ? 'completed' : 'unconfirmed' } : step),
  };
}

export function applyChatEvent(turn: ChatMessage, event: PageChatEvent): ChatMessage {
  if (turn.status !== 'running') return turn;
  if (event.request_id) turn = { ...turn, requestId: event.request_id };
  if (event.type === 'done') return finishChatTurn({ ...turn, content: event.response || '' }, 'done');
  if (event.type === 'error') return failChatTurn(turn, diagnosticFromEvent(event));
  const specialist = !!event.agent && event.agent !== 'coordinator';
  const scope = specialist ? `${event.delegation_id || event.agent}:` : '';
  const agentInfo = { agent: event.agent, agentTitle: event.agent_title, delegationId: event.delegation_id };
  const phasePrefix = specialist ? `${event.agent_title || event.agent}: ` : '';
  if (event.type === 'status') return { ...turn, phase: phasePrefix + (event.message || 'Working…') };

  const iteration = event.iteration ?? (specialist ? 0 : turn.iteration) ?? 0;
  const steps = [...(turn.steps || [])];
  const update = (id: string, patch: Partial<ChatStep>, fallback: ChatStep) => {
    const index = steps.findIndex((step) => step.id === id);
    if (index < 0) steps.push({ ...fallback, ...patch });
    else steps[index] = { ...steps[index], ...patch };
  };
  const modelId = `${scope}model:${iteration}`;
  const model: ChatStep = { id: modelId, kind: 'model', label: `Model · step ${iteration}`, status: 'running', iteration, ...agentInfo };

  if (['agent_start', 'agent_done', 'agent_error'].includes(event.type)) {
    const id = `agent:${event.delegation_id || event.agent}`;
    const diagnostic = event.type === 'agent_error' ? diagnosticFromEvent({ ...event, request_id: event.request_id || turn.requestId }) : undefined;
    update(id, event.type === 'agent_start'
      ? { task: event.content, status: 'running' }
      : { content: diagnostic?.message || event.content, status: event.type === 'agent_error' ? 'failed' : 'completed', diagnostic },
    { id, kind: 'agent', label: 'Delegated task', status: 'running', ...agentInfo });
    if (event.type !== 'agent_start') {
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (step.id !== id && step.agent === event.agent && step.delegationId === event.delegation_id
          && ['running', 'approval', 'approved'].includes(step.status)) {
          steps[index] = { ...step, status: step.kind === 'tool' ? 'unconfirmed' : event.type === 'agent_error' ? 'failed' : 'completed' };
        }
      }
    }
    return { ...turn, steps, phase: phasePrefix + (event.type === 'agent_start' ? 'Working…' : event.type === 'agent_error' ? 'Failed; returning to coordinator' : 'Complete; returning to coordinator') };
  }

  if (event.type === 'model_call') {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step.kind === 'model' && step.status === 'running'
        && (specialist ? step.agent === event.agent && step.delegationId === event.delegation_id : !step.agent || step.agent === 'coordinator')) {
        steps[index] = { ...step, status: 'completed' };
      }
    }
    update(modelId, event.purpose === 'skill_selection' ? { label: 'Select skills' } : {}, model);
    return { ...turn, steps, ...(!specialist ? { iteration, content: '' } : {}), phase: phasePrefix + 'Generating…' };
  }
  if (event.type === 'answer_delta' || event.type === 'assistant_response') {
    const content = event.type === 'answer_delta'
      ? (steps.find((step) => step.id === modelId)?.content || '') + (event.content || '')
      : event.content || '';
    update(modelId, { content, status: event.type === 'assistant_response' ? 'completed' : 'running' }, model);
    return { ...turn, steps, ...(!specialist ? { iteration, content } : {}), phase: phasePrefix + 'Generating…' };
  }
  if (event.type === 'analysis_summary_delta' || event.type === 'analysis_summary') {
    const id = `${scope}analysis:${iteration}`;
    const content = event.type === 'analysis_summary_delta'
      ? (steps.find((step) => step.id === id)?.content || '') + (event.content || '')
      : event.content || '';
    update(id, { content, status: event.type === 'analysis_summary' ? 'completed' : 'running' }, {
      id, kind: 'analysis', label: 'Analysis summary', status: 'running', iteration, ...agentInfo,
    });
    return { ...turn, steps };
  }
  if (['tool_call', 'tool_result', 'approval_required'].includes(event.type)) {
    const id = scope + (event.execution_id || event.call_id || `tool:${iteration}:${event.tool}`);
    const fallback: ChatStep = { id, kind: 'tool', label: event.tool || 'Tool', status: 'running', iteration, ...agentInfo };
    update(id, {
      executionId: event.execution_id,
      ...(event.arguments !== undefined ? { arguments: event.arguments } : {}),
      ...(event.endpoint ? { endpoint: event.endpoint } : {}),
      ...(event.request ? { request: event.request } : {}),
      ...(event.type === 'tool_result'
        ? { content: event.content, status: event.success === false ? 'failed' : 'completed' }
        : { status: event.type === 'approval_required' ? 'approval' : 'running' }),
    }, fallback);
    update(modelId, { status: 'completed' }, model);
    return { ...turn, steps, phase: phasePrefix + (event.type === 'approval_required' ? 'Waiting for your approval' : `Tool: ${event.tool || 'working'}`) };
  }
  return turn;
}
