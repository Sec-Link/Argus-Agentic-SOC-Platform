'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Mentions, Spin, Tag, Typography, theme } from 'antd';
import type { MentionsRef } from 'antd/es/mentions';
import { Bot, Maximize2, Minimize2, Send, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAiAssistantPageChat, decidePageChatApproval, fetchAiAssistantAgentCatalog, clientChatDiagnostic, type AssistantAgentCatalogEntry, type PageChatContext, type PageChatDiagnostic, type PageChatMessage } from 'services/aiAssistant';
import { collectPageContext } from './pageContext';
import { useAssistantPageContext } from './AssistantPageContext';
import { applyChatEvent, failChatTurn, finishChatTurn, type ChatMessage, type ChatStep } from './chatState';
import { validateAgentMentions } from './agentMentions';
import styles from './FloatingAssistant.module.css';

export default function FloatingAssistant({ pathname, readonly = false, docked, canDock, onDockChange }: {
  pathname: string;
  readonly?: boolean;
  docked: boolean;
  canDock: boolean;
  onDockChange: (docked: boolean) => void;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [approvalBusy, setApprovalBusy] = useState<Set<string>>(new Set());
  const [sharePage, setSharePage] = useState(true);
  const [includeContent, setIncludeContent] = useState(true);
  const [context, setContext] = useState<PageChatContext | null>(null);
  const [agents, setAgents] = useState<AssistantAgentCatalogEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState('');
  const inputRef = useRef<MentionsRef>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const registeredContext = useAssistantPageContext(pathname);

  const capturePage = (): PageChatContext => {
    const page = collectPageContext(document.getElementById('argus-page-content'), pathname, includeContent && !registeredContext);
    return includeContent && registeredContext ? { ...page, ...registeredContext } : page;
  };

  useEffect(() => {
    if (open) {
      setContext(sharePage ? capturePage() : null);
    }
  }, [open, pathname, sharePage, includeContent, registeredContext]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || readonly) return;
    const controller = new AbortController();
    setAgentsLoading(true);
    setAgentsError('');
    void fetchAiAssistantAgentCatalog(controller.signal).then((catalog) => {
      if (!controller.signal.aborted) setAgents(catalog);
    }).catch(() => {
      if (!controller.signal.aborted) { setAgents([]); setAgentsError('Agent suggestions could not be loaded. Sending will retry.'); }
    }).finally(() => { if (!controller.signal.aborted) setAgentsLoading(false); });
    return () => controller.abort();
  }, [open, readonly]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight });
  }, [messages, loading, open]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const close = () => {
    setOpen(false);
    onDockChange(false);
  };

  const updateTurn = (index: number, update: (turn: ChatMessage) => ChatMessage) => {
    setMessages((previous) => previous.map((turn, turnIndex) => turnIndex === index ? update(turn) : turn));
  };

  const decideApproval = async (index: number, step: ChatStep, decision: 'approve' | 'reject') => {
    const controller = requestRef.current;
    if (!step.executionId || !controller || controller.signal.aborted || readonly || approvalBusy.has(step.id)) return;
    setApprovalBusy((previous) => new Set(previous).add(step.id));
    setError('');
    try {
      await decidePageChatApproval(step.executionId, decision, controller.signal);
      if (controller.signal.aborted) return;
      updateTurn(index, (turn) => turn.status !== 'running' || !turn.steps?.some((item) => item.id === step.id && item.status === 'approval') ? turn : {
        ...turn,
        phase: decision === 'approve' ? 'Approved; waiting for the tool result' : 'Rejected; continuing…',
        steps: turn.steps?.map((item) => item.id === step.id && item.status === 'approval'
          ? { ...item, status: decision === 'approve' ? 'approved' : 'rejected' } : item),
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 404 || status === 409 || status === 410
        ? 'This approval has expired or has already been decided.'
        : 'Could not confirm the approval status. Check the execution steps before retrying.');
      if (status === 404 || status === 409 || status === 410) updateTurn(index, (turn) => ({
        ...turn, steps: turn.steps?.map((item) => item.id === step.id && item.status === 'approval' ? { ...item, status: 'unconfirmed' } : item),
      }));
    } finally {
      setApprovalBusy((previous) => { const next = new Set(previous); next.delete(step.id); return next; });
    }
  };

  const stop = () => {
    requestRef.current?.abort();
    setMessages((previous) => previous.map((turn) => turn.status === 'running' ? finishChatTurn(turn, 'stopped') : turn));
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || requestRef.current || readonly) return;
    const controller = new AbortController();
    const assistantIndex = messages.length + 1;
    let turnStarted = false;
    requestRef.current = controller;
    setError('');
    setLoading(true);
    try {
      if (localStorage.getItem('siem_ai_enabled') === '0') {
        setError('AI Assistant is disabled. Enable it in Settings > AI Assistant.');
        return;
      }
      let selectedAgents: string[];
      let catalog: AssistantAgentCatalogEntry[];
      try {
        catalog = await fetchAiAssistantAgentCatalog(controller.signal);
      } catch {
        if (controller.signal.aborted) return;
        setError('Could not verify available agents. Check your session and AI Assistant > Agents, then send again.');
        return;
      }
      if (controller.signal.aborted) return;
      setAgents(catalog);
      setAgentsError('');
      try { selectedAgents = validateAgentMentions(text, catalog); }
      catch (err) { setError(err instanceof Error ? err.message : 'Check your agent mentions.'); return; }
      const snapshot = sharePage ? capturePage() : undefined;
      setContext(snapshot || null);
      // Limit the request history independently of the displayed conversation.
      const history: PageChatMessage[] = [];
      let historyLength = 0;
      for (const item of messages.slice(-12).reverse()) {
        const interruption = item.role === 'assistant' && item.status !== 'done'
          ? `\n[Previous execution ${item.status}. Calls already started may have completed. Recorded tool steps: ${item.steps?.filter((step) => step.kind === 'tool').map((step) => `${step.label}: ${step.status}`).join('; ') || 'none'}.]`.slice(0, 2000) : '';
        const content = item.content.slice(0, 8000 - interruption.length) + interruption;
        if (!content.trim()) continue;
        if (historyLength + content.length > 32000) break;
        history.unshift({ role: item.role, content });
        historyLength += content.length;
      }
      turnStarted = true;
      setMessages((previous) => [...previous,
        { role: 'user', content: text },
        { role: 'assistant', content: '', steps: [], status: 'running', phase: 'Connecting…' },
      ]);
      setDraft('');
      const timeout = Number(localStorage.getItem('siem_ai_timeout'));
      await streamAiAssistantPageChat({
        message: text,
        agent_names: selectedAgents.length ? selectedAgents : undefined,
        messages: history,
        page_context: snapshot,
        api_key: localStorage.getItem('siem_ai_api_key') || undefined,
        model: localStorage.getItem('siem_ai_model') || undefined,
        base_url: localStorage.getItem('siem_ai_base_url') || undefined,
        timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? Math.min(120, Math.max(1, Math.round(timeout))) : undefined,
      }, (event) => {
        if (controller.signal.aborted) return;
        updateTurn(assistantIndex, (turn) => applyChatEvent(turn, event));
      }, controller.signal);
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        updateTurn(assistantIndex, (turn) => finishChatTurn(turn, 'stopped'));
        return;
      }
      const diagnostic = clientChatDiagnostic(err);
      if (turnStarted) updateTurn(assistantIndex, (turn) => failChatTurn(turn, diagnostic));
      else setError(diagnostic.message);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
        inputRef.current?.focus();
      }
    }
  };

  return (
    <div data-ai-context-exclude className={docked ? styles.dockedRoot : undefined}>
      {open && (
        <section
          id="argus-ai-chat"
          role="dialog"
          aria-modal="false"
          aria-labelledby="argus-ai-chat-title"
          className={`${styles.panel} ${docked ? styles.dockedPanel : ''}`}
          style={{ background: token.colorBgContainer, color: token.colorText, borderColor: token.colorBorderSecondary, boxShadow: docked ? undefined : token.boxShadowSecondary }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}
        >
          <header className={styles.header} style={{ borderColor: token.colorBorderSecondary }}>
            <div className={styles.title}><Bot size={20} /><strong id="argus-ai-chat-title">Argus AI</strong><Tag color="blue">Page assistant</Tag></div>
            <div className={styles.headerActions}>
              <Button
                type="text"
                aria-label={docked ? 'Restore floating chat' : 'Expand AI chat'}
                aria-pressed={docked}
                title={docked ? 'Restore floating chat' : canDock ? 'Expand AI chat' : 'Widen the page or collapse the sidebar to use split view'}
                disabled={!docked && !canDock}
                icon={docked ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                onClick={() => onDockChange(!docked)}
              />
              <Button type="text" aria-label="Close AI chat" icon={<X size={18} />} onClick={close} />
            </div>
          </header>
          <div className={styles.context} style={{ borderColor: token.colorBorderSecondary }}>
            <Checkbox checked={sharePage} onChange={(event) => setSharePage(event.target.checked)}>Share current page</Checkbox>
            {sharePage && <Checkbox checked={includeContent} onChange={(event) => setIncludeContent(event.target.checked)}>{registeredContext ? 'Include ticket data' : 'Include visible content'}</Checkbox>}
            {sharePage && context && (
              <details>
                <summary>Page context · {context.title || context.path}</summary>
                <Typography.Text type="secondary">{includeContent && registeredContext
                  ? 'Shares original alert identifiers and loaded ticket data across tabs with the configured AI model. Credential values are filtered. Attachments include metadata only; omissions are marked below.'
                  : 'Refreshes when you send. Inputs, hidden content and raw code are excluded; sensitive text is filtered.'}</Typography.Text>
                <pre className={styles.preview}>{context.path}{'\n'}{context.content || 'No visible page text.'}</pre>
                <Button size="small" onClick={() => setContext(capturePage())}>Refresh preview</Button>
              </details>
            )}
          </div>
          <div className={styles.history} ref={historyRef} role="log" aria-live="polite" aria-label="AI conversation" aria-busy={loading}>
            {!messages.length && (
              <div className={styles.empty}>
                <Bot size={34} color={token.colorPrimary} />
                <Typography.Title level={5}>How can I help with this page?</Typography.Title>
                <Typography.Text type="secondary">The coordinator can delegate to enabled agents and use your configured skills, MCP and HTTP tools. Mention @name to choose specialists. Answers and execution steps appear as they arrive. External tool calls require your approval.</Typography.Text>
              </div>
            )}
            {messages.map((item, index) => (
              <div key={index} className={styles.message} style={{ background: item.role === 'user' ? token.colorPrimaryBg : token.colorFillAlter }}>
                <Typography.Text strong>{item.role === 'user' ? 'You' : 'Argus AI'}</Typography.Text>
                {!!item.steps?.length && (
                  <details className={styles.steps} open={item.status === 'running'}>
                    <summary>Execution steps · {item.steps.length}</summary>
                    <ol>
                      {item.steps.map((step) => (
                        <li key={step.id}>
                          <details open={step.status === 'approval'}>
                            <summary>{step.agent && <Tag color="blue">{step.agentTitle || step.agent}</Tag>}<span>{step.label}</span><Tag color={step.status === 'failed' ? 'error' : step.status === 'approval' ? 'warning' : step.status === 'completed' ? 'success' : 'default'}>{step.status === 'approval' ? 'Approval required' : step.status === 'unconfirmed' ? 'Result unavailable' : step.status}</Tag></summary>
                            <StepContent step={step} />
                          </details>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <div className={styles.markdown} style={{
                  '--chat-table-border': token.colorBorderSecondary,
                  '--chat-table-header': token.colorFillSecondary,
                } as React.CSSProperties}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                    // Do not fetch model-supplied image URLs or allow rendered HTML.
                    img: ({ alt }) => <span>{alt || '[Image omitted]'}</span>,
                    a: ({ children }) => <span>{children}</span>,
                    table: ({ children }) => <div className={styles.tableScroll} role="region" aria-label="Markdown table" tabIndex={0}><table>{children}</table></div>,
                  }}>{item.content}</ReactMarkdown>
                </div>
                {item.diagnostic && <FailureDetails diagnostic={item.diagnostic} />}
                {item.steps?.filter((step) => step.diagnostic).map((step) => (
                  <FailureDetails key={step.id} diagnostic={step.diagnostic!} specialist />
                ))}
                {/* Keep pending actions outside collapsed steps and below streamed text. */}
                {item.status === 'running' && item.steps?.filter((step) => step.status === 'approval').map((step) => (
                  <section key={step.id} className={styles.approval} aria-label={`Approval required: ${step.agentTitle || step.agent || 'AI'} · ${step.label}`}
                    style={{ background: token.colorWarningBg, borderColor: token.colorWarningBorder }}>
                    <Typography.Text strong>Approval required</Typography.Text>
                    <div>{step.agent && <Tag color="blue">{step.agentTitle || step.agent}</Tag>}<Typography.Text strong>{step.label}</Typography.Text></div>
                    <StepContent step={step} />
                    <Typography.Text type="secondary">Review this tool and its arguments before allowing it to run.</Typography.Text>
                    <div className={styles.actions}>
                      <Button size="small" disabled={readonly || approvalBusy.has(step.id)} onClick={() => void decideApproval(index, step, 'reject')}>Reject</Button>
                      <Button size="small" type="primary" disabled={readonly || approvalBusy.has(step.id)} loading={approvalBusy.has(step.id)} onClick={() => void decideApproval(index, step, 'approve')}>Approve call</Button>
                    </div>
                  </section>
                ))}
                {item.status && <div className={styles.thinking} role="status">{item.status === 'running' && <Spin size="small" />}<Typography.Text type={item.status === 'error' ? 'danger' : 'secondary'}>{item.phase}</Typography.Text></div>}
              </div>
            ))}
          </div>
          <footer className={styles.footer} style={{ borderColor: token.colorBorderSecondary }}>
            {readonly && <Alert type="info" showIcon message="Chat is unavailable for read-only accounts." />}
            {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
            {agentsError && <Typography.Text type="warning">{agentsError}</Typography.Text>}
            <Mentions
              ref={inputRef}
              value={draft}
              onChange={setDraft}
              options={agents.map((agent) => ({ value: agent.name, label: <span title={agent.role}>@{agent.name} · {agent.title}</span> }))}
              loading={agentsLoading}
              placement="top"
              notFoundContent={agentsError ? 'Agents unavailable' : 'No matching enabled agents'}
              placeholder="Ask about this page, or @mention an agent…"
              aria-label="Message to AI"
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={4000}
              disabled={loading || readonly}
              onPressEnter={(event) => {
                if (!event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Coordinator assigns automatically. @mentions limit delegation to those agents (up to 3).</Typography.Text>
            <div className={styles.actions}>
              <Button type="text" size="small" disabled={loading || !messages.length} onClick={() => { setMessages([]); setError(''); }}>Clear chat</Button>
              {loading
                ? <Button icon={<Square size={14} />} onClick={stop}>Stop</Button>
                : <Button type="primary" icon={<Send size={16} />} onClick={() => void send()} disabled={!draft.trim() || readonly}>Send</Button>}
            </div>
          </footer>
        </section>
      )}
      <Button
        ref={triggerRef}
        className={styles.trigger}
        hidden={docked}
        type="primary"
        shape="circle"
        aria-label={open ? 'Close AI chat' : 'Open AI chat'}
        aria-expanded={open}
        aria-controls="argus-ai-chat"
        title="Argus AI"
        icon={open ? <X size={25} /> : <Bot size={26} />}
        onClick={() => open ? close() : setOpen(true)}
      />
    </div>
  );
}

function FailureDetails({ diagnostic, specialist = false }: { diagnostic: PageChatDiagnostic; specialist?: boolean }) {
  const context = [
    `Code: ${diagnostic.code}`,
    diagnostic.stage && `Last reported stage: ${diagnostic.stage}`,
    diagnostic.agent && `Agent: ${diagnostic.agent_title || diagnostic.agent}`,
    diagnostic.iteration !== undefined && `Step: ${diagnostic.iteration}`,
    diagnostic.status_code !== undefined && `HTTP status: ${diagnostic.status_code}`,
  ].filter(Boolean).join(' · ');
  return <Alert type={specialist ? 'warning' : 'error'} showIcon style={{ marginTop: 8 }}
    message={diagnostic.message}
    description={<>
      <div>{context}</div>
      {diagnostic.request_id && <div>Request reference: <code>{diagnostic.request_id}</code></div>}
      <div>Completed steps and partial output are preserved. This request was not automatically retried.</div>
    </>}
  />;
}

function StepContent({ step }: { step: ChatStep }) {
  return <div className={styles.stepContent}>
    {step.task && <><Typography.Text strong>Assigned task</Typography.Text><pre>{step.task}</pre></>}
    {step.endpoint && <Typography.Text type="secondary">Endpoint: {step.endpoint}</Typography.Text>}
    {step.arguments !== undefined && <><Typography.Text strong>Arguments</Typography.Text><pre>{JSON.stringify(step.arguments, null, 2)}</pre></>}
    {step.request && <><Typography.Text strong>HTTP request</Typography.Text><pre>{JSON.stringify(step.request, null, 2)}</pre><Typography.Text type="secondary">Authentication is added by the server. Approving sends this request to the provider.</Typography.Text></>}
    {step.content && <><Typography.Text strong>{step.kind === 'analysis' ? 'Analysis summary' : step.kind === 'tool' || step.kind === 'agent' ? 'Result' : 'Response'}</Typography.Text><pre>{step.content}</pre></>}
    {step.kind === 'analysis' && <Typography.Text type="secondary">A concise explanation, when provided by the model.</Typography.Text>}
  </div>;
}
