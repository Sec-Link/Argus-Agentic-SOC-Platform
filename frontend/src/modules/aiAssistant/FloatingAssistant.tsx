'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Mentions, Select, Spin, Tag, Typography, theme } from 'antd';
import type { MentionsRef } from 'antd/es/mentions';
import { ArrowLeft, Bot, History, Maximize2, Minimize2, Pencil, Plus, RefreshCw, Send, Square, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAiAssistantPageChat, decidePageChatApproval, fetchAiAssistantAgentCatalog, clientChatDiagnostic, listConversations, createConversation, getConversation, renameConversation, deleteConversation, type ConversationSummary, type ConversationDetail, type AssistantAgentCatalogEntry, type PageChatContext, type PageChatDiagnostic } from 'services/aiAssistant';
import { collectPageContext } from './pageContext';
import { useAssistantPageContext } from './AssistantPageContext';
import { applyChatEvent, failChatTurn, finishChatTurn, type ChatMessage, type ChatStep } from './chatState';
import { validateAgentMentions } from './agentMentions';
import { canContinueConversation, conversationError, hasConfirmedSavedTurn, restoreConversation, type HistoryMessage } from './conversationHistory';
import styles from './FloatingAssistant.module.css';

export default function FloatingAssistant({ pathname, readonly = false, docked, canDock, onDockChange }: {
  pathname: string;
  readonly?: boolean;
  docked: boolean;
  canDock: boolean;
  onDockChange: (docked: boolean) => void;
}) {
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<ConversationSummary[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [canViewAllHistory, setCanViewAllHistory] = useState(false);
  const [historyScope, setHistoryScope] = useState<'mine' | 'all' | undefined>();
  const [historyOwner, setHistoryOwner] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
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
  const historySequence = useRef(0);
  const unconfirmedSaveRef = useRef<{ requestId?: string; failed: boolean } | null>(null);
  const registeredContext = useAssistantPageContext(pathname);
  const busy = loading || historyBusy;
  const reviewing = conversation?.readonly === true;
  const canContinue = canContinueConversation(conversation);
  const restore = (detail: ConversationDetail) => {
    setConversation(detail);
    setMessages(restoreConversation(detail));
    const options = detail.turns.at(-1)?.context_options;
    if (options) { setSharePage(options.share_page); setIncludeContent(options.include_content); }
    setNeedsRefresh(false);
    unconfirmedSaveRef.current = null;
    setError('');
  };

  const loadHistory = async (page = historyPage, scope = historyScope, owner = historyOwner) => {
    const sequence = ++historySequence.current;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const result = await listConversations(page, undefined, { scope, owner: owner || undefined });
      if (sequence !== historySequence.current) return;
      setHistoryRows(result.results);
      setHistoryHasNext(!!result.next);
      setHistoryPage(page);
      setCanViewAllHistory(result.can_view_all);
    } catch (err) {
      if (sequence === historySequence.current) { setHistoryRows([]); setHistoryError(conversationError(err)); }
    } finally {
      if (sequence === historySequence.current) setHistoryBusy(false);
    }
  };

  const openConversation = async (id: string, clearDraft = true) => {
    if (requestRef.current || historyBusy) return;
    const sequence = ++historySequence.current;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const detail = await getConversation(id);
      if (sequence !== historySequence.current) return;
      const unconfirmed = unconfirmedSaveRef.current;
      if (!clearDraft && unconfirmed && !hasConfirmedSavedTurn(detail, unconfirmed.requestId, unconfirmed.failed)) {
        setConversation(detail);
        setHistoryError(unconfirmed.failed
          ? 'Some output could not be saved and remains visible here. Open the conversation from History to review the saved information before continuing.'
          : 'The saved result is not yet confirmed. Your visible output is retained. Refresh again when the execution has finished.');
        return;
      }
      restore(detail);
      if (clearDraft) setDraft('');
      setApprovalBusy(new Set());
      setShowHistory(false);
    } catch (err) {
      if (sequence === historySequence.current) setHistoryError(conversationError(err));
    } finally {
      if (sequence === historySequence.current) setHistoryBusy(false);
    }
  };

  const newConversation = () => {
    if (requestRef.current || historyBusy) return;
    setConversation(null);
    setMessages([]);
    setDraft('');
    setError('');
    setHistoryError('');
    setNeedsRefresh(false);
    unconfirmedSaveRef.current = null;
    setApprovalBusy(new Set());
    setShowHistory(false);
    setSharePage(true);
    setIncludeContent(true);
  };

  const rename = async (id: string) => {
    if (!renameTitle.trim() || busy || !historyRows.find((row) => row.id === id)?.can_manage) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const updated = await renameConversation(id, renameTitle.trim());
      setHistoryRows((rows) => rows.map((row) => row.id === id ? updated : row));
      setConversation((current) => current?.id === id ? updated : current);
      setRenaming(null);
    } catch (err) { setHistoryError(conversationError(err)); }
    finally { setHistoryBusy(false); }
  };

  const remove = (row: ConversationSummary) => {
    if (!row.can_manage || readonly) return;
    modal.confirm({
      title: 'Delete this conversation?',
      content: 'Its messages, shared page snapshots and recorded execution steps will be permanently deleted.',
      okText: 'Delete', okButtonProps: { danger: true }, cancelText: 'Cancel',
      onOk: async () => {
        if (requestRef.current) return;
        setHistoryBusy(true);
        setHistoryError('');
        try {
          await deleteConversation(row.id);
          if (conversation?.id === row.id) { setConversation(null); setMessages([]); setDraft(''); setNeedsRefresh(false); unconfirmedSaveRef.current = null; }
          setRenaming(null);
          await loadHistory(historyRows.length === 1 && historyPage > 1 ? historyPage - 1 : historyPage);
        } catch (err) { setHistoryError(conversationError(err)); }
        finally { setHistoryBusy(false); }
      },
    });
  };

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

  useEffect(() => () => { requestRef.current?.abort(); historySequence.current++; }, []);

  const close = () => {
    setOpen(false);
    onDockChange(false);
  };

  const updateTurn = (index: number, update: (turn: ChatMessage) => ChatMessage) => {
    setMessages((previous) => previous.map((turn, turnIndex) => turnIndex === index ? update(turn) : turn));
  };

  const decideApproval = async (index: number, step: ChatStep, decision: 'approve' | 'reject') => {
    const controller = requestRef.current;
    if (!step.executionId || !controller || controller.signal.aborted || readonly || reviewing || approvalBusy.has(step.id)) return;
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
    if (!text || requestRef.current || readonly || historyBusy || !canContinue || needsRefresh) return;
    const controller = new AbortController();
    const assistantIndex = messages.length + 1;
    let turnStarted = false;
    let receivedEvent = false;
    let receivedRequestId: string | undefined;
    let saveFailed = false;
    let requestRejected = false;
    let currentConversation = conversation;
    requestRef.current = controller;
    setError('');
    setHistoryError('');
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
      if (!currentConversation) {
        currentConversation = await createConversation(controller.signal);
        setConversation(currentConversation);
      }
      if (controller.signal.aborted) return;
      turnStarted = true;
      setMessages((previous) => [...previous,
        { role: 'user', content: text, pageContext: snapshot },
        { role: 'assistant', content: '', steps: [], status: 'running', phase: 'Connecting…' },
      ]);
      setDraft('');
      const timeout = Number(localStorage.getItem('siem_ai_timeout'));
      await streamAiAssistantPageChat({
        message: text,
        agent_names: selectedAgents.length ? selectedAgents : undefined,
        conversation_id: currentConversation.id,
        revision: currentConversation.revision,
        context_options: { share_page: sharePage, include_content: includeContent },
        page_context: snapshot,
        api_key: localStorage.getItem('siem_ai_api_key') || undefined,
        model: localStorage.getItem('siem_ai_model') || undefined,
        base_url: localStorage.getItem('siem_ai_base_url') || undefined,
        timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? Math.min(120, Math.max(1, Math.round(timeout))) : undefined,
      }, (event) => {
        if (controller.signal.aborted) return;
        receivedEvent = true;
        receivedRequestId ||= event.request_id;
        if (event.code === 'conversation_save_failed') saveFailed = true;
        updateTurn(assistantIndex, (turn) => applyChatEvent(turn, event));
      }, controller.signal);
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        updateTurn(assistantIndex, (turn) => finishChatTurn(turn, 'stopped'));
        return;
      }
      const diagnostic = clientChatDiagnostic(err);
      requestRejected = !receivedEvent && [400, 401, 403, 404, 406, 409, 413, 429].includes(diagnostic.status_code || 0);
      if (turnStarted) updateTurn(assistantIndex, (turn) => failChatTurn(turn, diagnostic));
      else setError(conversationError(err));
      if (!receivedEvent) { setDraft(text); setHistoryError(turnStarted ? diagnostic.message : conversationError(err)); }
    } finally {
      if (requestRef.current === controller) {
        if (currentConversation && turnStarted) {
          try {
            const detail = await getConversation(currentConversation.id);
            if (requestRejected || hasConfirmedSavedTurn(detail, receivedRequestId, saveFailed)) {
              restore(detail);
            } else {
              setConversation(detail);
              setNeedsRefresh(true);
              unconfirmedSaveRef.current = { requestId: receivedRequestId, failed: saveFailed };
              setHistoryError(saveFailed
                ? 'Some output could not be saved and remains visible here. Open the conversation from History to review the saved information before continuing.'
                : 'The saved result is not yet confirmed. Your visible output is retained. Refresh before sending again.');
            }
          } catch {
            setNeedsRefresh(true);
            unconfirmedSaveRef.current = { requestId: receivedRequestId, failed: saveFailed };
            setHistoryError('Could not confirm the saved conversation. Your visible output is retained. Refresh before sending again.');
          }
        }
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
              <Button type="text" aria-label={showHistory ? 'Back to conversation' : 'Conversation history'}
                title={showHistory ? 'Back to conversation' : 'Conversation history'} disabled={busy}
                icon={showHistory ? <ArrowLeft size={18} /> : <History size={18} />}
                onClick={() => { if (showHistory) setShowHistory(false); else { setShowHistory(true); void loadHistory(1); } }} />
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
          {showHistory ? <>
            <div className={styles.historyToolbar}>
              <Typography.Text strong>Conversation history</Typography.Text>
              <Button size="small" icon={<Plus size={14} />} disabled={busy || readonly} onClick={newConversation}>New chat</Button>
            </div>
            {canViewAllHistory && <div className={styles.historyToolbar}>
              <Select aria-label="Conversation history scope" value={historyScope || 'all'} disabled={busy}
                style={{ minWidth: 135 }} options={[{ value: 'all', label: 'All users' }, { value: 'mine', label: 'My history' }]}
                onChange={(value: 'mine' | 'all') => { setHistoryScope(value); setHistoryOwner(''); void loadHistory(1, value, ''); }} />
              {(historyScope || 'all') === 'all' && <Input.Search aria-label="Filter history by username" placeholder="Username"
                allowClear value={historyOwner} maxLength={150} disabled={busy}
                onChange={(event) => setHistoryOwner(event.target.value)} onSearch={(value) => void loadHistory(1, 'all', value)} />}
            </div>}
            {historyError && <Alert type="error" showIcon message={historyError} />}
            <div className={styles.history} aria-label="Saved conversations" aria-busy={historyBusy}>
              {historyBusy && <Spin size="small" />}
              {!historyBusy && !historyRows.length && !historyError && <Typography.Text type="secondary">No saved conversations yet. Your conversations are saved when you send a message.</Typography.Text>}
              {historyRows.map((row) => <div key={row.id} className={styles.savedConversation} style={{ borderColor: token.colorBorderSecondary }}>
                {renaming === row.id ? <>
                  <Input aria-label="Conversation title" value={renameTitle} maxLength={120} disabled={busy}
                    onChange={(event) => setRenameTitle(event.target.value)} onPressEnter={() => void rename(row.id)} />
                  <div className={styles.actions}>
                    <Button size="small" disabled={busy} onClick={() => setRenaming(null)}>Cancel</Button>
                    <Button size="small" type="primary" disabled={busy || !renameTitle.trim()} onClick={() => void rename(row.id)}>Save title</Button>
                  </div>
                </> : <>
                  <Button type="text" className={styles.conversationTitle} disabled={busy} onClick={() => void openConversation(row.id)}>{row.title || 'New conversation'}</Button>
                  <Typography.Text type="secondary">{row.owner.username}{row.readonly && ' · Read-only'}</Typography.Text>
                  <div className={styles.actions}>
                    <Typography.Text type="secondary">{new Date(row.updated_at).toLocaleString()}</Typography.Text>
                    <div className={styles.headerActions}>
                      {row.active && <Tag>Running</Tag>}
                      <Button size="small" type="text" aria-label={`Rename ${row.title}`} title="Rename" icon={<Pencil size={14} />} disabled={busy || readonly || row.active || !row.can_manage}
                        onClick={() => { setRenaming(row.id); setRenameTitle(row.title); }} />
                      <Button size="small" type="text" danger aria-label={`Delete ${row.title}`} title="Delete" icon={<Trash2 size={14} />} disabled={busy || readonly || row.active || !row.can_manage} onClick={() => remove(row)} />
                    </div>
                  </div>
                </>}
              </div>)}
            </div>
            <div className={styles.historyToolbar}>
              <Button size="small" disabled={busy || historyPage <= 1} onClick={() => void loadHistory(historyPage - 1)}>Previous</Button>
              <Button size="small" icon={<RefreshCw size={14} />} disabled={busy} onClick={() => void loadHistory()}>Refresh</Button>
              <Button size="small" disabled={busy || !historyHasNext} onClick={() => void loadHistory(historyPage + 1)}>Next</Button>
            </div>
          </> : <>
          <div className={styles.conversationBar}>
            <Typography.Text ellipsis title={conversation?.title}>{conversation?.title || 'New conversation'}</Typography.Text>
            {reviewing && <Tag>Read-only · {conversation?.owner.username}</Tag>}
            {conversation && <Button size="small" type="text" icon={<RefreshCw size={14} />} aria-label="Refresh saved conversation" title="Refresh saved conversation" disabled={busy} onClick={() => void openConversation(conversation.id, false)} />}
          </div>
          {!reviewing && <div className={styles.context} style={{ borderColor: token.colorBorderSecondary }}>
            <Checkbox checked={sharePage} disabled={busy} onChange={(event) => setSharePage(event.target.checked)}>Share current page</Checkbox>
            {sharePage && <Checkbox checked={includeContent} disabled={busy} onChange={(event) => setIncludeContent(event.target.checked)}>{registeredContext ? 'Include ticket data' : 'Include visible content'}</Checkbox>}
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
          </div>}
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
                <Typography.Text strong>{item.role === 'user' ? reviewing ? conversation?.owner.username : 'You' : 'Argus AI'}</Typography.Text>
                {item.pageContext && <details className={styles.steps}>
                  <summary>Shared page snapshot: {item.pageContext.title || item.pageContext.path}</summary>
                  <pre className={styles.preview}>{item.pageContext.path}{'\n'}{item.pageContext.content || 'No page text was shared.'}</pre>
                </details>}
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
                {!reviewing && item.status === 'running' && item.steps?.filter((step) => step.status === 'approval').map((step) => (
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
            {reviewing && <Alert type="info" showIcon message="Read-only history review. Only the owner can continue, rename, delete or approve calls in this conversation." />}
            {readonly && <Alert type="info" showIcon message="Chat is unavailable for read-only accounts." />}
            {conversation?.active && !loading && <Alert type="info" showIcon message="This conversation has an active execution. Refresh to check its result before continuing." />}
            {historyError && <Alert type="error" showIcon message={historyError} closable onClose={() => setHistoryError('')} />}
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
              disabled={busy || readonly || !canContinue || needsRefresh}
              onPressEnter={(event) => {
                if (!event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Coordinator assigns automatically. @mentions limit delegation to those agents (up to 3).</Typography.Text>
            <div className={styles.actions}>
              <Button type="text" size="small" icon={<Plus size={14} />} disabled={busy || readonly} onClick={newConversation}>New chat</Button>
              {loading
                ? <Button icon={<Square size={14} />} onClick={stop}>Stop</Button>
                : <Button type="primary" icon={<Send size={16} />} onClick={() => void send()} disabled={!draft.trim() || readonly || busy || !canContinue || needsRefresh}>Send</Button>}
            </div>
          </footer>
          </>}
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
