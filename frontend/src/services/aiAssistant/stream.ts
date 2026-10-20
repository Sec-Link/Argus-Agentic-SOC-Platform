export interface HttpToolRequestPreview {
  method: 'GET' | 'POST';
  url: string;
  query_params: Record<string, unknown>;
  json_body: Record<string, unknown> | null;
}

export interface PageChatEvent {
  type: string;
  iteration?: number;
  content?: string;
  response?: string;
  message?: string;
  purpose?: string;
  tool?: string;
  source?: string;
  call_id?: string;
  execution_id?: string;
  arguments?: unknown;
  success?: boolean;
  endpoint?: string;
  expires_in?: number;
  request?: HttpToolRequestPreview;
  agent?: string;
  agent_title?: string;
  delegation_id?: string;
  code?: string;
  request_id?: string;
  stage?: PageChatStage;
  status_code?: number;
}

export type PageChatStage = 'setup' | 'model' | 'tool' | 'approval' | 'agent' | 'connection' | 'stream';

export interface PageChatDiagnostic {
  code: string;
  message: string;
  request_id?: string;
  stage?: PageChatStage;
  iteration?: number;
  agent?: string;
  agent_title?: string;
  delegation_id?: string;
  status_code?: number;
}

export class PageChatStreamError extends Error {
  diagnostic: PageChatDiagnostic;
  constructor(diagnostic: PageChatDiagnostic) {
    super(diagnostic.message);
    this.name = 'PageChatStreamError';
    this.diagnostic = diagnostic;
  }
}

const STAGES = new Set<PageChatStage>(['setup', 'model', 'tool', 'approval', 'agent', 'connection', 'stream']);
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pageChatHttpError(status: number): PageChatStreamError {
  const messages: Record<number, string> = {
    400: 'The chat request was rejected. Check the selected agents and AI Assistant settings.',
    401: 'Your session has expired. Sign in again before sending another message.',
    403: 'You do not have permission to use this chat.',
    404: 'The chat endpoint was not found. Check that the frontend and backend versions match.',
    406: 'The server did not accept the streaming response format. Check the backend version.',
    408: 'The chat server timed out while receiving the request.',
    413: 'The message or shared page context is too large. Reduce it before sending again.',
    429: 'The chat server is limiting requests. Wait before sending another message.',
    502: 'The gateway could not reach the chat backend. Check the backend service.',
    503: 'The chat service is unavailable. Check the backend service before trying again.',
    504: 'The gateway timed out waiting for the chat backend. Review any completed steps before retrying.',
  };
  return new PageChatStreamError({
    code: `client_http_${status}`, stage: 'connection', status_code: status,
    message: messages[status] || (status >= 500
      ? 'The chat server returned an error. Check the backend logs before retrying.'
      : 'The chat server returned an unexpected HTTP response. Check the service configuration.'),
  });
}

export function clientChatDiagnostic(error: unknown): PageChatDiagnostic {
  return error instanceof PageChatStreamError ? error.diagnostic : {
    code: 'client_unexpected_error', stage: 'stream',
    message: 'The chat client could not finish processing this request. Review completed steps before retrying.',
  };
}

const invalidStream = () => new PageChatStreamError({
  code: 'client_stream_invalid', stage: 'stream',
  message: 'The chat server sent an invalid stream event. Check that the frontend and backend versions match.',
});

const MAX_FRAME_LENGTH = 1024 * 1024;

function parseFrame(frame: string): PageChatEvent | null {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null; // SSE comments are heartbeats.
  const event = JSON.parse(data);
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
    throw new Error('Invalid AI stream event');
  }
  for (const key of ['content', 'response', 'message', 'tool', 'source', 'call_id', 'execution_id', 'endpoint', 'purpose', 'agent', 'agent_title', 'delegation_id', 'code', 'request_id', 'stage']) {
    if (event[key] !== undefined && typeof event[key] !== 'string') throw new Error('Invalid AI stream event');
  }
  if (event.code !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(event.code)) throw invalidStream();
  if (event.request_id !== undefined && !REQUEST_ID.test(event.request_id)) throw invalidStream();
  if (event.stage !== undefined && !STAGES.has(event.stage)) throw invalidStream();
  if (event.status_code !== undefined && (!Number.isInteger(event.status_code) || event.status_code < 100 || event.status_code > 599)) throw invalidStream();
  if (event.iteration !== undefined && (!Number.isInteger(event.iteration) || event.iteration < 0)) throw new Error('Invalid AI iteration');
  if (event.type === 'done' && typeof event.response !== 'string') throw new Error('Missing final AI response');
  if (event.type === 'approval_required' && (!event.execution_id || !event.tool)) throw new Error('Invalid tool approval');
  if (event.request !== undefined) {
    const request = event.request;
    if (!request || !['GET', 'POST'].includes(request.method) || typeof request.url !== 'string'
      || !request.query_params || typeof request.query_params !== 'object' || Array.isArray(request.query_params)
      || (request.json_body !== null && (!request.json_body || typeof request.json_body !== 'object' || Array.isArray(request.json_body)))) {
      throw new Error('Invalid tool request preview');
    }
    event.request = { method: request.method, url: request.url, query_params: request.query_params, json_body: request.json_body };
  }
  return event;
}

// A chat POST must never reconnect automatically: replaying it could repeat a tool call.
export async function readPageChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: PageChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch {
        signal?.throwIfAborted();
        throw new PageChatStreamError({
          code: 'client_stream_network_error', stage: 'stream',
          message: 'The connection to the chat server failed while receiving the response. Review completed steps before retrying.',
        });
      }
      const { done, value } = chunk;
      signal?.throwIfAborted();
      try { buffer += decoder.decode(value, { stream: !done }); }
      catch { throw invalidStream(); }
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        if (separator.index > MAX_FRAME_LENGTH) throw invalidStream();
        let event: PageChatEvent | null;
        try { event = parseFrame(buffer.slice(0, separator.index)); }
        catch { throw invalidStream(); }
        buffer = buffer.slice(separator.index + separator[0].length);
        if (event) {
          signal?.throwIfAborted();
          onEvent(event);
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
      if (buffer.length > MAX_FRAME_LENGTH) throw invalidStream();
      if (done) throw new PageChatStreamError({
        code: 'client_stream_incomplete', stage: 'stream',
        message: 'The chat stream ended before completion. The server did not report a final result; review completed steps before retrying.',
      });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
