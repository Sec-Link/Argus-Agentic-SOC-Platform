import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Divider, Empty, Form, Input, List, Modal, Row, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { Bot, CheckCircle2, CirclePause, Clock3, ListChecks, MessageCircleQuestion, Plus, Send, ShieldCheck, Wrench } from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';
import type { SlaTicketAttachment, SlaTicketDetail, SlaTicketHandleLog, SlaTicketLabel, SlaTicketWorkLog } from 'types';
import { aiAssistantChat, askTicketInvestigationSideQuestion, cancelTicketInvestigationSideQuestion, clearSlaTicketAiChatHistory, clearTicketInvestigationSideQuestions, controlTicketInvestigationRun, createTicketInvestigation, createTicketInvestigationWorker, fetchSlaTicketAiChatHistory, fetchSlaTicketHandleLogs, fetchSlaTicketFieldChoices, fetchTicketCallablePlaybooks, fetchTicketInvestigation, fetchTicketInvestigationSideQuestions, fetchTicketInvestigations, fetchTicketPlaybookWorkplan, generateSlaTicketAiAssistant, generateSlaTicketAiMention, invokeTicketCallablePlaybook, resolveSlaTicket, sendTicketInvestigationMessage, toggleSlaTicketPending, type TicketInvestigationRun, type TicketInvestigationSession, type TicketInvestigationSideConversation, updateSlaTicket } from 'services/tickets';
import { useRegisterAssistantContext } from '../../aiAssistant/AssistantPageContext';
import { chatModelRequest, initialModelChoice, MODEL_PREFERENCE_KEY } from '../../aiAssistant/chatModel';
import { fetchAlerts } from 'services/alerts';
import { fetchModelCatalog, type ModelCatalogEntry } from 'services/aiAssistant/models';
import { buildTicketDetailContext } from '../aiContext';
import { canContinueTicketChat, type TicketChatCapabilities, type TicketChatScope } from '../ticketChatHistory';
import layoutStyles from './TicketLayout.module.css';

type Props = {
  ticket: SlaTicketDetail;
  attachments: SlaTicketAttachment[];
  workLogs: SlaTicketWorkLog[];
  statusValue: string;
  notesValue: string;
  onStatusChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onSubmitStatus: (statusOverride?: string) => void;
  onAddWorkLog?: (logEntry: string) => void | Promise<void>;
  onUploadWorkLogImage?: (file: File) => Promise<SlaTicketAttachment>;
  onRefresh: () => void;
  onRefreshWorkLogs?: () => void | Promise<void>;
  loading?: boolean;
};

type TicketCallablePlaybook = {
  id: string;
  name: string;
  description?: string;
};

type TicketWorkplanItem = {
  execution_id: string;
  workflow_id?: string;
  workflow_name: string;
  status: string;
  trigger_source: string;
  progress_percent?: number;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  executed_by?: string | null;
  error_message?: string;
};

const statusLabel: Record<string, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  triaged: 'Triaged',
  contained: 'Contained',
  resolved: 'Resolved',
  closed: 'Closed',
};

const renderStatusTag = (s?: string) => {
  const key = (s || 'unknown').toLowerCase();
  const cls = `sla-status-tag sla-status-${key}`;
  return <Tag className={cls}>{statusLabel[key] ?? s ?? 'unknown'}</Tag>;
};

  const renderSeverityTag = (p?: string, label?: string) => {
  const key = (p || 'unknown').toLowerCase();
  const cls = `sla-severity-tag sla-severity-${key}`;
  return <Tag className={cls}>{label ?? p ?? 'unknown'}</Tag>;
};

const maybe = (v: any) => (v === undefined || v === null || v === '' ? undefined : v);

const formatTimestamp = (value?: string | null) => {
  if (!value) return '';
  const dt = dayjs(value);
  return dt.isValid() ? dt.format('YYYY-MM-DD HH:mm:ss') : String(value);
};

const fixMojibake = (value: string) => {
  const text = String(value || '');
  if (!text) return text;
  const looksBroken = /[ÃÂâåäæçèéêëìíîïðñòóôöõøùúûüýÿ]/.test(text);
  if (!looksBroken) return text;
  try {
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const decodedLooksBetter = /[\u4e00-\u9fff]/.test(decoded) && decoded.length >= text.length * 0.6;
    return decodedLooksBetter ? decoded : text;
  } catch {
    return text;
  }
};

const renderJsonSyntax = (pretty: string) => {
  // Lightweight JSON syntax highlighting keeps the Raw Message tab readable in
  // dark mode without introducing a new dependency. The regex identifies JSON
  // keys, strings, numbers, booleans, nulls, and punctuation; CSS classes then
  // provide WCAG-friendly contrast for both light and dark themes.
  const tokenPattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}\[\],:])/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of pretty.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(pretty.slice(lastIndex, index));
    }

    const [token, key, stringValue, numberValue, booleanValue, nullValue, punctuation] = match;
    const className = key
      ? 'json-token-key'
      : stringValue
        ? 'json-token-string'
        : numberValue
          ? 'json-token-number'
          : booleanValue
            ? 'json-token-boolean'
            : nullValue
              ? 'json-token-null'
              : punctuation
                ? 'json-token-punctuation'
                : '';

    nodes.push(<span key={`json_${tokenIndex++}`} className={className}>{token}</span>);
    lastIndex = index + token.length;
  }

  if (lastIndex < pretty.length) {
    nodes.push(pretty.slice(lastIndex));
  }

  return nodes;
};

const formatTicketLabels = (labels: SlaTicketLabel[] | undefined) => {
  if (!Array.isArray(labels) || labels.length === 0) return [];
  return labels
    .map((label) => {
      if (!label || !label.label_name) return null;
      const name = String(label.label_name).trim();
      if (!name) return null;
      const value = label.label_value == null ? '' : String(label.label_value).trim();
      return `${name}:${value}`;
    })
    .filter(Boolean) as string[];
};

const renderLogEntry = (entry: string) => {
  const text = (entry || '').trim();
  if (!text) return null;

  const images: Array<{ alt: string; url: string }> = [];
  const mdImg = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdImg.exec(text))) {
    images.push({ alt: m[1] || 'image', url: m[2] });
  }
  const urlImgs: string[] = [];
  const urlRe = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp))/gi;
  while ((m = urlRe.exec(text))) {
    urlImgs.push(m[1]);
  }
  for (const u of urlImgs) {
    if (!images.some((x) => x.url === u)) images.push({ alt: 'image', url: u });
  }

  const looksLikeCommand = /^(command:|action|result|parameters|outputs|status)/i.test(text);

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ whiteSpace: 'pre-wrap', fontFamily: looksLikeCommand ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined, fontSize: looksLikeCommand ? 12 : 13 }}>
        {text}
      </div>
      {images.length ? (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {images.map((img, idx) => (
            <a key={`${img.url}_${idx}`} href={img.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
              <img
                src={img.url}
                alt={img.alt}
                style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)' }}
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
};

function WarRoomView({
  ticket,
  workLogs,
  handleLogs,
  attachments,
  onAddWorkLog,
  onUploadWorkLogImage,
  loading,
}: {
  ticket: SlaTicketDetail;
  workLogs: SlaTicketWorkLog[];
  handleLogs: SlaTicketHandleLog[];
  attachments: SlaTicketAttachment[];
  onAddWorkLog?: (logEntry: string) => void | Promise<void>;
  onUploadWorkLogImage?: (file: File) => Promise<SlaTicketAttachment>;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<string>('all');
  const [draft, setDraft] = useState<string>('');

  const allLogs = (workLogs || []).slice().reverse();
  const history = handleLogs || [];
  const statusChangeLogs = allLogs.filter((w) => /status changed/i.test(String(w?.log_entry || '')));
  const workLogItems = allLogs.filter((w) => !/status changed/i.test(String(w?.log_entry || '')));
  const files = attachments || [];
  const historyCount = history.length || statusChangeLogs.length;

  const send = async () => {
    if (!onAddWorkLog) return;
    const text = (draft || '').trim();
    if (!text) return;
    setDraft('');
    await onAddWorkLog(text);
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onUploadWorkLogImage) return;
    const items = Array.from(e.clipboardData?.items || []);
    const img = items.find((it) => it.kind === 'file' && (it.type || '').startsWith('image/'));
    if (!img) return;
    const file = img.getAsFile();
    if (!file) return;
    e.preventDefault();
    try {
      const uploaded = await onUploadWorkLogImage(file);
      const url = uploaded?.file_path;
      if (url) {
        setDraft((prev) => {
          const prefix = prev && !prev.endsWith('\n') ? '\n' : '';
          return `${prev}${prefix}![${uploaded.file_name || 'image'}](${url})\n`;
        });
      }
    } catch {
      // swallow here; parent shows errors
    }
  };

  const renderHandleLogs = () => (
    <Card size="small" title={history.length ? 'Handle Logs' : 'Status Changes'} styles={{ body: { padding: 0 } }}>
      <div style={{ maxHeight: 520, overflow: 'auto', padding: 12 }}>
        {history.length ? (
          <List
            dataSource={history}
            renderItem={(h) => (
              <List.Item style={{ alignItems: 'flex-start' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{h.handler_username || 'System'}</div>
                    <div style={{ color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>{h.handled_at || ''}</div>
                  </div>
                  <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                    {h.action_taken}
                  </div>
                </div>
              </List.Item>
            )}
          />
        ) : statusChangeLogs.length ? (
          <List
            dataSource={statusChangeLogs}
            renderItem={(w) => (
              <List.Item style={{ alignItems: 'flex-start' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{w.created_by_username || 'System'}</div>
                    <div style={{ color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>{w.created_at}</div>
                  </div>
                  {renderLogEntry(w.log_entry)}
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="No history yet" />
        )}
      </div>
    </Card>
  );

  const renderWorkLogs = () => (
    <Card size="small" title="Work Logs" styles={{ body: { padding: 0 } }}>
      <div style={{ maxHeight: 420, overflow: 'auto', padding: 12 }}>
        {workLogItems.length ? (
          <List
            dataSource={workLogItems}
            renderItem={(w) => (
              <List.Item style={{ alignItems: 'flex-start' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{w.created_by_username || 'System'}</div>
                    <div style={{ color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>{w.created_at}</div>
                  </div>
                  {renderLogEntry(w.log_entry)}
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="No messages yet" />
        )}
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', padding: 12 }}>
        <Space style={{ width: '100%' }} direction="vertical" size={8}>
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
            placeholder={onAddWorkLog ? 'Type a message...' : 'Posting disabled'}
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={!onAddWorkLog || loading}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Work logs are backed by ticket work logs
            </Typography.Text>
            <Button type="primary" onClick={send} disabled={!onAddWorkLog || !draft.trim()} loading={loading}>
              Send
            </Button>
          </div>
        </Space>
      </div>
    </Card>
  );

  return (
    <div style={{ padding: 16, background: 'transparent', minHeight: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Space wrap size={10}>
          <Typography.Text style={{ fontWeight: 700 }}>
            War Room
          </Typography.Text>
          <Tag color="geekblue">{ticket.ticket_number}</Tag>
          {renderStatusTag(ticket.status)}
        </Space>
        <Input.Search
          allowClear
          placeholder="Search (e.g. hostName)"
          style={{ width: 320 }}
          disabled
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'all', label: `All (${workLogItems.length + historyCount})` },
            { key: 'work_logs', label: `Work Logs (${workLogItems.length})` },
            { key: 'handle_logs', label: `Handle Logs (${historyCount})` },
            { key: 'files', label: `Files (${files.length})` },
            { key: 'evidence', label: `Evidence (${files.length})` },
          ]}
          tabBarStyle={{ marginBottom: 10, color: 'rgba(255,255,255,0.72)' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(tab === 'files' || tab === 'evidence') ? (
          <Card size="small" title={tab === 'files' ? `Files (${files.length})` : `Evidence (${files.length})`}>
            {files.length ? (
              <Table
                rowKey="id"
                size="small"
                scroll={{ x: 'max-content' }}
                pagination={false}
                columns={[
                  { title: 'File', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
                  { title: 'Uploaded', dataIndex: 'uploaded_time', key: 'uploaded_time', width: 200 },
                  {
                    title: 'Action',
                    key: 'action',
                    width: 120,
                    render: (_: any, r: SlaTicketAttachment) => (
                      <Button size="small" href={r.file_path} target="_blank" rel="noreferrer">
                        Download
                      </Button>
                    ),
                  },
                ]}
                dataSource={files}
              />
            ) : (
              <Empty description="No files yet" />
            )}
          </Card>
        ) : tab === 'handle_logs' ? (
          renderHandleLogs()
        ) : tab === 'all' ? (
          <>
            {renderHandleLogs()}
            {renderWorkLogs()}
          </>
        ) : (
          renderWorkLogs()
        )}
      </div>
    </div>
  );
}

export default function SlaTicketDetailView(props: Props) {
  const { ticket, attachments, workLogs, statusValue, notesValue, onStatusChange, onNotesChange, onSubmitStatus, onRefresh, onRefreshWorkLogs, loading } = props;
  const [showEmpty, setShowEmpty] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('incident');
  const [assistantInnerTab, setAssistantInnerTab] = useState<string>('sessions');
  const [relatedAlerts, setRelatedAlerts] = useState<any[]>([]);
  const [relatedAlertsLoading, setRelatedAlertsLoading] = useState(false);
  const [relatedAlertsLoaded, setRelatedAlertsLoaded] = useState(false);
  const [relatedAlertsError, setRelatedAlertsError] = useState('');
  const [incidentTab, setIncidentTab] = useState<string>('timeline');
  const [isPending, setIsPending] = useState(false);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [handleLogs, setHandleLogs] = useState<SlaTicketHandleLog[]>([]);
  const [handleLogsState, setHandleLogsState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any | null>(null);
  const [aiRawResponse, setAiRawResponse] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<ModelCatalogEntry[]>([]);
  const [aiModelId, setAiModelId] = useState('');
  const [aiModelsLoading, setAiModelsLoading] = useState(true);
  const [aiModelsError, setAiModelsError] = useState('');
  const aiModelsRequest = useRef<AbortController | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSize, setChatSize] = useState({ width: 320, height: 440, right: 12, top: 88 });
  const [chatWidthTouched, setChatWidthTouched] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string; hidden?: boolean; trace?: any[]; owner?: string; created_at?: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [investigationSessions, setInvestigationSessions] = useState<TicketInvestigationSession[]>([]);
  const [activeInvestigation, setActiveInvestigation] = useState<TicketInvestigationSession | null>(null);
  const [activeInvestigationRunId, setActiveInvestigationRunId] = useState('');
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationSending, setInvestigationSending] = useState(false);
  const [investigationError, setInvestigationError] = useState('');
  const [investigationDraft, setInvestigationDraft] = useState('');
  const [workerObjective, setWorkerObjective] = useState('');
  const [workerCreating, setWorkerCreating] = useState(false);
  const [sideQuestionOpen, setSideQuestionOpen] = useState(false);
  const [sideConversation, setSideConversation] = useState<TicketInvestigationSideConversation | null>(null);
  const [sideQuestionDraft, setSideQuestionDraft] = useState('');
  const [sideQuestionLoading, setSideQuestionLoading] = useState(false);
  const [sideQuestionError, setSideQuestionError] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatMoreLoading, setChatMoreLoading] = useState(false);
  const [chatNextBefore, setChatNextBefore] = useState<string | null>(null);
  const [chatScope, setChatScope] = useState<TicketChatScope>('mine');
  const [chatCapabilities, setChatCapabilities] = useState<TicketChatCapabilities | null>(null);
  const [chatHistoryError, setChatHistoryError] = useState('');
  const chatHistorySequence = useRef(0);
  const chatCanContinue = canContinueTicketChat(chatScope, chatCapabilities) && !chatHistoryLoading && !chatMoreLoading;
  const [collapsedTraces, setCollapsedTraces] = useState<Record<number, boolean>>({});
  const [expandedTaskIndex, setExpandedTaskIndex] = useState<number | null>(null);
  const [expandedNextTaskIndex, setExpandedNextTaskIndex] = useState<number | null>(null);
  const [expandedTimelineIndex, setExpandedTimelineIndex] = useState<number | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveSubmitting, setResolveSubmitting] = useState(false);
  const [resolveChoices, setResolveChoices] = useState<any | null>(null);
  const [resolveForm] = Form.useForm();
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [playbookOptions, setPlaybookOptions] = useState<TicketCallablePlaybook[]>([]);
  const [playbookSuggestOpen, setPlaybookSuggestOpen] = useState(false);
  const [playbookLoading, setPlaybookLoading] = useState(false);
  const [workplanItems, setWorkplanItems] = useState<TicketWorkplanItem[]>([]);
  const [workplanLoading, setWorkplanLoading] = useState(false);
  const [workplanState, setWorkplanState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [editableLabels, setEditableLabels] = useState<Array<{ label_name: string; label_value: string }>>([]);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelValue, setNewLabelValue] = useState('');
  const [labelsSaving, setLabelsSaving] = useState(false);
  const aiAssistantCardRef = useRef<HTMLDivElement | null>(null);

  const notesCount = workLogs?.length ?? 0;

  const loadAiModels = useCallback(async () => {
    aiModelsRequest.current?.abort();
    const controller = new AbortController();
    aiModelsRequest.current = controller;
    setAiModelsLoading(true);
    setAiModelsError('');
    try {
      const catalog = await fetchModelCatalog(controller.signal);
      if (controller.signal.aborted) return;
      setAiModels(catalog);
      setAiModelId((current) => {
        if (current) return current;
        let preferred = null;
        try { preferred = localStorage.getItem(MODEL_PREFERENCE_KEY); } catch { /* Use the catalog if storage is unavailable. */ }
        return initialModelChoice(catalog, preferred);
      });
    } catch {
      if (!controller.signal.aborted) setAiModelsError('Available models could not be loaded. Refresh the model list.');
    } finally {
      if (!controller.signal.aborted) setAiModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAiModels();
    return () => aiModelsRequest.current?.abort();
  }, [loadAiModels]);

  const aiModelAvailable = aiModels.some((model) => model.id === aiModelId);
  const aiModelReady = aiModelAvailable && !aiModelsLoading && !aiModelsError;
  const requireAiModel = () => {
    if (aiModelReady) return true;
    message.warning(aiModelsError || 'Choose an enabled model in AI Assistant > Models before using AI.');
    return false;
  };
  const aiModelSelector = (
    <div style={{ display: 'grid', gap: 4 }}>
      <Select
        aria-label="Ticket AI model"
        placeholder="Choose an enabled model"
        value={aiModelId || undefined}
        loading={aiModelsLoading}
        onDropdownVisibleChange={(visible) => { if (visible) void loadAiModels(); }}
        onChange={(value) => {
          setAiModelId(value);
          try { localStorage.setItem(MODEL_PREFERENCE_KEY, value); } catch { /* Keep the choice in this tab. */ }
        }}
        options={[
          ...(aiModelId && !aiModelAvailable ? [{ value: aiModelId, label: 'Selected model unavailable', disabled: true }] : []),
          ...aiModels.map((model) => ({ value: model.id, label: `${model.name} (${model.model})` })),
        ]}
        style={{ width: '100%' }}
      />
      {aiModelsError ? <Typography.Text type="danger">{aiModelsError} <Typography.Link onClick={() => void loadAiModels()}>Refresh</Typography.Link></Typography.Text> : null}
      {!aiModelsLoading && !aiModelsError && !aiModelAvailable ? (
        <Typography.Text type="warning">Choose an enabled model or configure one in <Typography.Link href="/settings/ai-assistant">AI Assistant &gt; Models</Typography.Link>.</Typography.Text>
      ) : null}
    </div>
  );

  useEffect(() => {
    try {
      const persisted = localStorage.getItem(`siem_sla_pending_${ticket.ticket_number}`);
      setIsPending(persisted === '1');
    } catch {
      setIsPending(false);
    }
  }, [ticket.ticket_number]);

  useEffect(() => {
    let alive = true;
    setHandleLogs([]);
    setHandleLogsState('loading');
    (async () => {
      try {
        const res = await fetchSlaTicketHandleLogs(ticket.ticket_number);
        const parsed = Array.isArray(res) ? res : [];
        if (alive) {
          setHandleLogs(parsed);
          setHandleLogsState('loaded');
        }
      } catch {
        if (alive) {
          setHandleLogs([]);
          setHandleLogsState('error');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ticket.ticket_number]);

  useEffect(() => {
    const parsed = (ticket.labels || []).map((label) => ({
      label_name: String(label?.label_name || ''),
      label_value: label?.label_value == null ? '' : String(label.label_value),
    }));
    setEditableLabels(parsed);
  }, [ticket.ticket_number, ticket.labels]);

  useEffect(() => {
    setAiResult(null);
    setAiRawResponse('');
    setAiError(null);
    setAssistantInnerTab('sessions');
    setRelatedAlerts([]);
    setRelatedAlertsLoaded(false);
    setRelatedAlertsError('');
    setChatOpen(false);
    setChatMessages([]);
    setChatInput('');
    setInvestigationSessions([]);
    setActiveInvestigation(null);
    setActiveInvestigationRunId('');
    setInvestigationLoading(false);
    setInvestigationSending(false);
    setInvestigationError('');
    setSideQuestionOpen(false);
    setSideConversation(null);
    setSideQuestionDraft('');
    setSideQuestionLoading(false);
    setSideQuestionError('');
    setInvestigationDraft('');
    setWorkerObjective('');
    setWorkerCreating(false);
    setCollapsedTraces({});
    setChatNextBefore(null);
    chatHistorySequence.current++;
    setChatScope('mine');
    setChatCapabilities(null);
    setChatHistoryError('');
    setChatHistoryLoading(false);
    setChatMoreLoading(false);
    setChatLoading(false);
  }, [ticket.ticket_number]);

  useEffect(() => {
    let alive = true;
    setWorkplanItems([]);
    setWorkplanState('loading');
    setWorkplanLoading(true);
    (async () => {
      try {
        const res = await fetchTicketPlaybookWorkplan(ticket.ticket_number);
        const rows = Array.isArray(res?.results) ? res.results : [];
        if (alive) {
          setWorkplanItems(rows);
          setWorkplanState('loaded');
        }
      } catch {
        if (alive) {
          setWorkplanItems([]);
          setWorkplanState('error');
        }
      } finally {
        if (alive) setWorkplanLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ticket.ticket_number]);

  const buildAiBasePayload = () => chatModelRequest(aiModelId);

  const buildTicketPlaybookPayload = () => ({
    ticket_number: ticket.ticket_number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    event_category: ticket.event_category,
    event_result: ticket.event_result,
    event_platform: ticket.event_platform,
    event_sources: ticket.event_sources,
    alert_message: ticket.alert_message,
    labels: ticket.labels || [],
  });

  const loadPlaybookOptions = async (): Promise<TicketCallablePlaybook[]> => {
    if (playbookLoading) return playbookOptions;
    if (playbookOptions.length) return playbookOptions;
    setPlaybookLoading(true);
    try {
      const res = await fetchTicketCallablePlaybooks();
      const rows = Array.isArray(res?.results) ? res.results : [];
      const next = rows.map((row: any) => ({
        id: String(row.id),
        name: String(row.name || row.id),
        description: row.description ? String(row.description) : '',
      }));
      setPlaybookOptions(next);
      return next;
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to load playbooks');
      return [];
    } finally {
      setPlaybookLoading(false);
    }
  };

  const handleCommentDraftChange = (value: string) => {
    setCommentDraft(value);
    const shouldOpen = value.trim() === '@' || value.trim().startsWith('@playbook');
    setPlaybookSuggestOpen(shouldOpen);
    if (shouldOpen) loadPlaybookOptions();
  };

  const selectPlaybook = (playbook: TicketCallablePlaybook) => {
    setCommentDraft(`@playbook ${playbook.name}`);
    setPlaybookSuggestOpen(false);
  };

  const buildChatContext = () => {
    const context = {
      ticket_number: ticket.ticket_number,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      event_category: ticket.event_category,
      event_result: ticket.event_result,
      event_platform: ticket.event_platform,
      event_sources: ticket.event_sources,
      alert_message: ticket.alert_message,
    };
    return `Ticket context (read-only):\n${JSON.stringify(context, null, 2)}`;
  };

  const loadChatHistory = async (scope: TicketChatScope = chatScope) => {
    const sequence = ++chatHistorySequence.current;
    setChatScope(scope);
    setChatCapabilities(null);
    setChatHistoryError('');
    setChatHistoryLoading(true);
    setChatMessages([]);
    setChatInput('');
    setChatNextBefore(null);
    setCollapsedTraces({});
    const system = { role: 'system', content: buildChatContext(), hidden: true };
    try {
      const res = await fetchSlaTicketAiChatHistory(ticket.ticket_number, { limit: 50, scope });
      if (sequence !== chatHistorySequence.current) return;
      const rows = Array.isArray(res?.messages) ? res.messages : Array.isArray(res) ? res : [];
      const normalized = rows
        .filter((row: any) => row && row.role && row.content != null)
        .map((row: any) => ({
          role: String(row.role),
          content: fixMojibake(String(row.content)),
          trace: Array.isArray(row.trace) ? row.trace : [],
          owner: typeof row.created_by === 'string' ? row.created_by : 'Unknown legacy owner',
          created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
        }));
      setChatCapabilities(res);
      setChatNextBefore(res?.next_before || null);
      setChatMessages([system, ...normalized]);
    } catch {
      if (sequence !== chatHistorySequence.current) return;
      setChatMessages([system]);
      setChatNextBefore(null);
      setChatHistoryError('Could not load chat history. Check your permissions and retry.');
    } finally {
      if (sequence === chatHistorySequence.current) setChatHistoryLoading(false);
    }
  };

  const loadMoreChatHistory = async () => {
    if (!chatNextBefore || chatMoreLoading || chatHistoryLoading || chatLoading) return;
    const sequence = chatHistorySequence.current;
    setChatMoreLoading(true);
    try {
      const res = await fetchSlaTicketAiChatHistory(ticket.ticket_number, { limit: 50, before: chatNextBefore, scope: chatScope });
      if (sequence !== chatHistorySequence.current) return;
      setChatCapabilities(res);
      const rows = Array.isArray(res?.messages) ? res.messages : [];
      const normalized = rows
        .filter((row: any) => row && row.role && row.content != null)
        .map((row: any) => ({
          role: String(row.role),
          content: fixMojibake(String(row.content)),
          trace: Array.isArray(row.trace) ? row.trace : [],
          owner: typeof row.created_by === 'string' ? row.created_by : 'Unknown legacy owner',
          created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
        }));
      setChatNextBefore(res?.next_before || null);
      setChatMessages((prev) => {
        const system = prev.find((m) => m.hidden) || { role: 'system', content: buildChatContext(), hidden: true };
        const rest = prev.filter((m) => !m.hidden);
        return [system, ...normalized, ...rest];
      });
    } catch {
      if (sequence !== chatHistorySequence.current) return;
      setChatNextBefore(null);
      setChatCapabilities(null);
      setChatHistoryError('Could not load earlier messages. Reload history before continuing.');
    } finally {
      if (sequence === chatHistorySequence.current) setChatMoreLoading(false);
    }
  };

  const runAiAssistant = async () => {
    if (!requireAiModel()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = {
        ...buildAiBasePayload(),
        alert_json: ticket.alert_message ? { raw: ticket.alert_message } : undefined,
        trigger_rule: ticket.event_category || '',
        related_logs: (workLogs || []).slice(0, 5).map((w) => w.log_entry),
      };
      const res = await generateSlaTicketAiAssistant(ticket.ticket_number, payload);
      const assistant = res?.assistant;
      // Keep the structured cards intact when the model returns plain text.
      // The plain response is rendered separately below as a raw/collapsible view.
      if (assistant && typeof assistant === 'object' && !Array.isArray(assistant)) {
        setAiResult(assistant);
      }
      const rawResponse = typeof res?.raw_response === 'string' ? res.raw_response : res?.assistant_raw;
      setAiRawResponse(typeof rawResponse === 'string' ? fixMojibake(rawResponse) : '');
      try {
        await onRefreshWorkLogs?.();
      } catch {
        // Keep the successful AI result visible even if the Worklog refresh fails.
      }
      message.success('AI assistant updated');
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      setAiError(apiError ? String(apiError) : 'AI assistant failed');
      message.error(apiError ? String(apiError) : 'AI assistant failed');
    } finally {
      setAiLoading(false);
    }
  };

  const openChat = () => {
    const anchor = aiAssistantCardRef.current?.getBoundingClientRect();
    if (anchor) {
      const right = Math.max(12, window.innerWidth - anchor.right);
      const top = Math.max(12, anchor.top);
      const maxHeight = Math.max(360, window.innerHeight - top - 12);
      setChatSize((prev) => ({
        width: chatWidthTouched ? prev.width : Math.max(320, Math.round(anchor.width)),
        height: Math.min(prev.height, maxHeight),
        right,
        top,
      }));
    }
    setChatOpen(true);
    if (!chatMessages.length) {
      loadChatHistory();
    }
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading || !chatCanContinue) return;
    const sequence = chatHistorySequence.current;
    if (!requireAiModel()) return;
    const historyForApi = chatMessages.map((m) => ({ role: m.role, content: m.content }));
    setChatMessages((prev) => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const payload = {
        ...buildAiBasePayload(),
        message: text,
        messages: historyForApi,
        ticket_number: ticket.ticket_number,
      };
      const res = await aiAssistantChat(payload);
      if (sequence !== chatHistorySequence.current) return;
      const reply = fixMojibake(String(res?.response || ''));
      const trace = Array.isArray(res?.trace) ? res.trace : [];
      setChatMessages((prev) => {
        const next = [...prev, { role: 'assistant', content: reply || 'No response', trace, created_at: new Date().toISOString() }];
        const index = next.length - 1;
        setCollapsedTraces((state) => ({ ...state, [index]: true }));
        return next;
      });
    } catch (err: any) {
      if (sequence !== chatHistorySequence.current) return;
      const apiError = err?.response?.data?.error || err?.response?.data?.detail || 'Chat failed';
      setChatMessages((prev) => {
        const next = [...prev, { role: 'assistant', content: fixMojibake(String(apiError)), trace: [], created_at: new Date().toISOString() }];
        const index = next.length - 1;
        setCollapsedTraces((state) => ({ ...state, [index]: true }));
        return next;
      });
    } finally {
      if (sequence === chatHistorySequence.current) setChatLoading(false);
    }
  };

  const askAiByMention = async (prompt: string) => {
    setAiLoading(true);
    setAiError(null);
    try {
      if (!props.onAddWorkLog) {
        message.warning('Worklog is unavailable');
        return;
      }
      const payload = {
        ...buildAiBasePayload(),
        prompt,
        alert_json: ticket.alert_message ? { raw: ticket.alert_message } : undefined,
        related_logs: [],
      };
      const res = await generateSlaTicketAiMention(ticket.ticket_number, payload);
      const observablesPayload = res?.observables;
      if (observablesPayload && typeof observablesPayload === 'object') {
        try {
          await props.onAddWorkLog(`AI Observables JSON: ${JSON.stringify(observablesPayload)}`);
        } catch {}
      }
      const assistantRaw = typeof res?.assistant_raw === 'string' ? res.assistant_raw.trim() : '';
      const assistantObj = res?.assistant;
      let reply = assistantRaw;
      if (!reply && typeof assistantObj === 'string') {
        reply = assistantObj.trim();
      }
      if (!reply && assistantObj && typeof assistantObj === 'object') {
        if (typeof assistantObj.alert_explanation === 'string' && assistantObj.alert_explanation.trim()) {
          reply = assistantObj.alert_explanation.trim();
        } else {
          try {
            reply = JSON.stringify(assistantObj, null, 2);
          } catch {
            reply = String(assistantObj);
          }
        }
      }
      if (!reply) {
        try {
          reply = JSON.stringify(res, null, 2);
        } catch {
          reply = 'No AI reply';
        }
      }
      await props.onAddWorkLog(`AI Reply (@ai):\n${reply}`);
      setAiResult(null);
      message.success('AI replied');
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      setAiError(apiError ? String(apiError) : 'AI request failed');
      message.error(apiError ? String(apiError) : 'AI request failed');
    } finally {
      setAiLoading(false);
    }
  };

  const sendComment = async () => {
    const text = (commentDraft || '').trim();
    if (!text) return;
    if (text.toLowerCase().startsWith('@ai') && !requireAiModel()) return;
    setCommentSending(true);
    try {
      if (text.toLowerCase().startsWith('@ai')) {
        const prompt = text.replace(/^@ai\s*/i, '').trim();
        if (!prompt) {
          message.warning('Please add prompt after @ai');
          return;
        }
        await askAiByMention(prompt);
      } else if (text.toLowerCase().startsWith('@playbook')) {
        const playbookName = text.replace(/^@playbook\s*/i, '').trim();
        if (!playbookName) {
          message.warning('Please choose a playbook');
          setPlaybookSuggestOpen(true);
          await loadPlaybookOptions();
          return;
        }
        const options = playbookOptions.length ? playbookOptions : await loadPlaybookOptions();
        const selected = options.find((item) => item.name.toLowerCase() === playbookName.toLowerCase());
        if (!selected) {
          message.warning('Playbook not found, please choose from the list');
          setPlaybookSuggestOpen(true);
          return;
        }
        const res = await invokeTicketCallablePlaybook(selected.id, {
          ticket: buildTicketPlaybookPayload(),
          inputs: {},
          comment: text,
        });
        if (props.onAddWorkLog) {
          await props.onAddWorkLog(`Invoked playbook: ${selected.name}\nExecution ID: ${res?.execution_id || '-'}\nStatus: ${res?.status || '-'}`);
        }
        message.success('Playbook invocation started');
      } else if (props.onAddWorkLog) {
        await props.onAddWorkLog(text);
      } else {
        message.warning('Posting is unavailable');
        return;
      }
      setCommentDraft('');
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to send comment');
    } finally {
      setCommentSending(false);
    }
  };

  const updateDecisionStatus = (nextStatus: string) => {
    onStatusChange(nextStatus);
    onSubmitStatus(nextStatus);
  };

  const canAcknowledge = ticket.status === 'new';
  const canTriaged = ticket.status === 'acknowledged';
  const canContained = ticket.status === 'triaged';
  const canResolved = ticket.status === 'triaged' || ticket.status === 'contained';

  useEffect(() => {
    if (!resolveOpen) return;
    let alive = true;
    setResolveLoading(true);
    (async () => {
      try {
        const res = await fetchSlaTicketFieldChoices();
        if (alive) setResolveChoices(res || null);
      } catch {
        if (alive) setResolveChoices(null);
      } finally {
        if (alive) setResolveLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [resolveOpen]);

  const submitResolve = async () => {
    if (!ticket.ticket_number) return;
    setResolveSubmitting(true);
    try {
      const values = await resolveForm.validateFields();
      await resolveSlaTicket(ticket.ticket_number, {
        event_category: values.event_category || undefined,
        event_result: values.event_result || undefined,
        notes: values.notes || undefined,
      });
      message.success('Resolved');
      setResolveOpen(false);
      resolveForm.resetFields();
      onStatusChange('resolved');
      onRefresh();
    } catch (err: any) {
      if (err?.errorFields) return;
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Resolve failed');
    } finally {
      setResolveSubmitting(false);
    }
  };

  const canTogglePending = ticket.status !== 'closed' && ticket.status !== 'new';
  const togglePending = async () => {
    if (ticket.status === 'closed') {
      message.error('Closed tickets cannot be set to pending');
      return;
    }
    if (ticket.status === 'new') {
      message.error('Pending is only available after the ticket is acknowledged');
      return;
    }
    setPendingLoading(true);
    try {
      await toggleSlaTicketPending(ticket.ticket_number);
      setIsPending((prev) => {
        const next = !prev;
        try { localStorage.setItem(`siem_sla_pending_${ticket.ticket_number}`, next ? '1' : '0'); } catch {}
        return next;
      });
      message.success('Pending state updated');
      onRefresh();
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to toggle pending');
    } finally {
      setPendingLoading(false);
    }
  };

  const attachmentColumns: ColumnsType<SlaTicketAttachment> = useMemo(() => ([
    { title: 'File', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
    { title: 'Uploaded', dataIndex: 'uploaded_time', key: 'uploaded_time', width: 180 },
    {
      title: 'Action',
      key: 'action',
      width: 120,
      render: (_: any, r) => (
        <Button size="small" href={r.file_path} target="_blank" rel="noreferrer">
          Download
        </Button>
      ),
    },
  ]), []);

  const observableEvidenceItems = useMemo(() => {
    const marker = 'AI Observables JSON:';
    const rows: Array<{ key: string; type: string; value: string; source: string; created_at: string }> = [];
    const dedupe = new Set<string>();

    for (const w of workLogs || []) {
      const text = String(w?.log_entry || '');
      if (!text.includes(marker)) continue;
      const line = text.split(/\r?\n/).find((l) => l.includes(marker));
      if (!line) continue;
      const payload = line.slice(line.indexOf(marker) + marker.length).trim();
      if (!payload) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(payload);
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') continue;

      const pushRow = (typ: string, val: any, source = 'observables-mcp') => {
        const type = String(typ || '').trim();
        const value = String(val || '').trim();
        if (!type || !value) return;
        const dk = `${type}::${value}`;
        if (dedupe.has(dk)) return;
        dedupe.add(dk);
        rows.push({
          key: `${dk}::${String(w?.created_at || '')}`,
          type,
          value,
          source,
          created_at: String(w?.created_at || ''),
        });
      };

      if (Array.isArray(parsed?.items)) {
        for (const item of parsed.items) {
          if (!item || typeof item !== 'object') continue;
          pushRow(item.type, item.value);
        }
      }
      const obs = parsed?.observables;
      if (obs && typeof obs === 'object') {
        for (const [k, vals] of Object.entries(obs)) {
          if (!Array.isArray(vals)) continue;
          for (const v of vals) pushRow(k, v);
        }
      }
    }

    return rows;
  }, [workLogs]);

  const observableColumns: ColumnsType<any> = useMemo(() => ([
    { title: 'Type', dataIndex: 'type', key: 'type', width: 120 },
    { title: 'Value', dataIndex: 'value', key: 'value', ellipsis: true },
    { title: 'Source', dataIndex: 'source', key: 'source', width: 150 },
    { title: 'Observed At', dataIndex: 'created_at', key: 'created_at', width: 180 },
  ]), []);

  const indicators = useMemo(() => {
    const items: Array<{ key: string; value: any }> = [];
    if (ticket.event_sources !== undefined) items.push({ key: 'event_sources', value: ticket.event_sources });
    if (ticket.ticket_records !== undefined) items.push({ key: 'ticket_records', value: ticket.ticket_records });
    if (ticket.event_platform !== undefined) items.push({ key: 'event_platform', value: ticket.event_platform });
    return items;
  }, [ticket.event_sources, ticket.ticket_records, ticket.event_platform]);

  const incidentTitle = ticket.title || 'Incident';
  const ownerName = ticket.current_assign_owner || ticket.assigned_user_username || 'Unassigned';
  const riskScore = ticket.event_risk_score ?? '-';
  const latestAiRawWorkLog = (workLogs || [])
    .slice()
    .reverse()
    .map((w) => String(w?.log_entry || ''))
    .find((entry) => entry.startsWith('AI Raw Response:\n'));
  const persistedAiRaw = latestAiRawWorkLog
    ? latestAiRawWorkLog.slice('AI Raw Response:\n'.length).trim()
    : '';
  const structuredSummary = [
    aiResult?.case_summary?.incident_summary,
    aiResult?.alert_explanation,
    ticket.description,
    [
      ticket.event_category ? `Category: ${ticket.event_category}` : '',
      ticket.event_result ? `Result: ${ticket.event_result}` : '',
    ].filter(Boolean).join(' | '),
  ].find((value) => typeof value === 'string' && value.trim());
  const summaryText = String(structuredSummary || 'No summary available yet.');
  const rawSummaryText = aiRawResponse.trim() || persistedAiRaw;

  const timelineItems = useMemo(() => {
    const base = (workLogs || []).slice();
    const tail = base.length > 6 ? base.slice(base.length - 6) : base;
    return tail.map((w) => ({
      time: w.created_at,
      text: w.log_entry,
    }));
  }, [workLogs]);

  const evidenceItems = useMemo(() => {
    const base = (attachments || []).slice();
    return base.length > 3 ? base.slice(0, 3) : base;
  }, [attachments]);

  const evidenceCount = (attachments?.length || 0) + observableEvidenceItems.length;

  const aiHeader = useMemo(() => {
    if (aiResult?.header) return aiResult.header;
    const logs = (workLogs || []).slice().reverse();
    for (const w of logs) {
      const text = String(w?.log_entry || '');
      const marker = 'AI Header JSON:';
      if (!text.includes(marker)) continue;
      const line = text.split(/\r?\n/).find((l) => l.includes(marker));
      if (!line) continue;
      const jsonText = line.slice(line.indexOf(marker) + marker.length).trim();
      try {
        return JSON.parse(jsonText);
      } catch {
        return null;
      }
    }
    return null;
  }, [aiResult, workLogs]);
  const assistantAsset = useMemo(() => {
    const direct = [aiHeader?.host_name, aiHeader?.hostname, aiHeader?.host, aiHeader?.asset_name, aiHeader?.asset]
      .find((value) => typeof value === 'string' && value.trim());
    if (direct) return String(direct).trim();
    const observable = observableEvidenceItems.find((item) => /^(host|hostname|host_name|asset|asset_name)$/i.test(item.type));
    if (observable?.value) return observable.value;

    let payload: any = ticket.alert_message;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { return ''; }
    }
    const findHost = (value: any, depth = 0): string => {
      if (!value || typeof value !== 'object' || depth > 5) return '';
      for (const [key, item] of Object.entries(value)) {
        if (/^(host_name|hostname|asset_name)$/i.test(key) && typeof item === 'string' && item.trim()) return item.trim();
        if (key === 'host' && typeof item === 'string' && item.trim()) return item.trim();
        if (key === 'host' && item && typeof item === 'object' && typeof (item as any).name === 'string') return (item as any).name.trim();
      }
      for (const item of Object.values(value)) {
        const nested = findHost(item, depth + 1);
        if (nested) return nested;
      }
      return '';
    };
    return findHost(payload);
  }, [aiHeader, observableEvidenceItems, ticket.alert_message]);

  const loadRelatedAlerts = async () => {
    if (!assistantAsset) {
      setRelatedAlerts([]);
      setRelatedAlertsLoaded(true);
      setRelatedAlertsError('No asset identifier is available in this ticket context.');
      return;
    }
    setRelatedAlertsLoading(true);
    setRelatedAlertsError('');
    try {
      const response = await fetchAlerts(1, 50, undefined, { q: assistantAsset, ordering: '-timestamp' });
      const rows = Array.isArray(response?.alerts) ? response.alerts : [];
      const normalize = (value: any) => String(value ?? '').trim().toLowerCase();
      const hostOf = (row: any) => row?.host_name ?? row?.body?.host_name ?? row?.host?.name ?? row?.hostname ?? row?.agent?.name ?? (typeof row?.host === 'string' ? row.host : '');
      const currentId = normalize(ticket.event_siem_id);
      setRelatedAlerts(rows.filter((row: any) => normalize(hostOf(row)) === normalize(assistantAsset)
        && (!currentId || normalize(row?.alert_id ?? row?._id) !== currentId)));
      setRelatedAlertsLoaded(true);
    } catch {
      setRelatedAlertsError('Could not load alerts for this asset.');
      setRelatedAlertsLoaded(true);
    } finally {
      setRelatedAlertsLoading(false);
    }
  };

  const aiTasks = useMemo(() => {
    if (Array.isArray(aiResult?.completed_tasks)) {
      return aiResult.completed_tasks;
    }
    const logs = (workLogs || []).slice().reverse();
    for (const w of logs) {
      const text = String(w?.log_entry || '');
      if (!text.includes('AI Assistant Result') || !text.includes('AI Tasks:')) continue;
      const idx = text.indexOf('AI Tasks:');
      if (idx < 0) continue;
      const nextIdx = text.indexOf('Next Tasks:', idx + 'AI Tasks:'.length);
      const tail = (nextIdx >= 0 ? text.slice(idx + 'AI Tasks:'.length, nextIdx) : text.slice(idx + 'AI Tasks:'.length)).trim();
      const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const tasks = lines.map((l) => {
        const cleaned = l.replace(/^-+\s*/, '').trim();
        if (!cleaned) return null;
        const parts = cleaned.split(':');
        if (parts.length >= 2) {
          const title = parts.shift()?.trim() || '';
          const detail = parts.join(':').trim();
          return { title: title || detail, detail };
        }
        return { title: cleaned, detail: '' };
      }).filter(Boolean);
      if (tasks.length) return tasks;
    }
    return [];
  }, [aiResult, workLogs]);

  const nextTasks = useMemo(() => {
    if (Array.isArray(aiResult?.next_tasks)) {
      return aiResult.next_tasks;
    }
    const logs = (workLogs || []).slice().reverse();
    for (const w of logs) {
      const text = String(w?.log_entry || '');
      if (!text.includes('AI Assistant Result') || !text.includes('Next Tasks:')) continue;
      const idx = text.indexOf('Next Tasks:');
      if (idx < 0) continue;
      const tail = text.slice(idx + 'Next Tasks:'.length).trim();
      const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const tasks = lines.map((l) => {
        const cleaned = l.replace(/^-+\s*/, '').trim();
        if (!cleaned) return null;
        const parts = cleaned.split(':');
        if (parts.length >= 2) {
          const title = parts.shift()?.trim() || '';
          const detail = parts.join(':').trim();
          return { title: title || detail, detail };
        }
        return { title: cleaned, detail: '' };
      }).filter(Boolean);
      if (tasks.length) return tasks;
    }
    return [];
  }, [aiResult, workLogs]);

  const assistantContext = useMemo(() => buildTicketDetailContext({
    ticket: { ...ticket, labels: editableLabels }, workLogs, handleLogs, attachments, workplanItems,
    observables: observableEvidenceItems,
    ai: {
      summary: aiResult?.case_summary?.incident_summary || aiResult?.alert_explanation,
      raw_response: rawSummaryText,
      header: aiHeader,
      completed_tasks: aiTasks,
      next_tasks: nextTasks,
    },
    view: { active_tab: activeTab, incident_tab: incidentTab, pending: isPending },
    availability: { handle_logs: handleLogsState, workplan: workplanState },
  }), [ticket, workLogs, handleLogs, attachments, workplanItems, observableEvidenceItems,
    aiResult, rawSummaryText, aiHeader, aiTasks, nextTasks, activeTab, incidentTab, isPending, editableLabels, handleLogsState, workplanState]);
  useRegisterAssistantContext(assistantContext);

  const applyInvestigation = (next: TicketInvestigationSession, preferredRunId = '') => {
    setActiveInvestigation(next);
    setInvestigationSessions((previous) => {
      const summary = { ...next, runs: undefined };
      const remaining = previous.filter((item) => item.id !== next.id);
      return [summary, ...remaining];
    });
    const nextRun = preferredRunId && next.runs?.some((run) => run.id === preferredRunId)
      ? preferredRunId
      : activeInvestigationRunId && next.runs?.some((run) => run.id === activeInvestigationRunId)
        ? activeInvestigationRunId
        : next.runs?.find((run) => run.role === 'main')?.id || next.runs?.[0]?.id || '';
    setActiveInvestigationRunId(nextRun);
  };

  const loadInvestigations = async (selectFirst = false) => {
    setInvestigationLoading(true);
    setInvestigationError('');
    try {
      const response = await fetchTicketInvestigations(ticket.ticket_number);
      const rows = Array.isArray(response?.results) ? response.results : [];
      setInvestigationSessions(rows);
      if ((selectFirst || !activeInvestigation) && rows.length) {
        const detail = await fetchTicketInvestigation(ticket.ticket_number, rows[0].id);
        applyInvestigation(detail);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setInvestigationError(detail ? String(detail) : 'Could not load investigation sessions.');
    } finally {
      setInvestigationLoading(false);
    }
  };

  const openInvestigation = async (sessionId: string) => {
    if (investigationSending) return;
    setInvestigationLoading(true);
    setInvestigationError('');
    try {
      const detail = await fetchTicketInvestigation(ticket.ticket_number, sessionId);
      applyInvestigation(detail);
      setInvestigationDraft('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setInvestigationError(detail ? String(detail) : 'Could not open this investigation session.');
    } finally {
      setInvestigationLoading(false);
    }
  };

  const createInvestigation = async () => {
    if (investigationSending || !requireAiModel()) return;
    setInvestigationLoading(true);
    setInvestigationError('');
    try {
      const detail = await createTicketInvestigation(ticket.ticket_number, { model_profile_id: aiModelId });
      applyInvestigation(detail);
      setInvestigationDraft('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setInvestigationError(detail ? String(detail) : 'Could not create an investigation session.');
    } finally {
      setInvestigationLoading(false);
    }
  };

  const sendInvestigationMessage = async () => {
    const messageText = investigationDraft.trim();
    if (!activeInvestigation || !activeInvestigationRunId || !messageText || investigationSending || !requireAiModel()) return;
    setInvestigationSending(true);
    setInvestigationError('');
    try {
      const detail = await sendTicketInvestigationMessage(ticket.ticket_number, activeInvestigation.id, {
        run_id: activeInvestigationRunId, message: messageText, model_profile_id: aiModelId,
      });
      applyInvestigation(detail, activeInvestigationRunId);
      setInvestigationDraft('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      const failedSession = err?.response?.data?.session;
      if (failedSession?.id) applyInvestigation(failedSession, activeInvestigationRunId);
      setInvestigationError(detail ? String(detail) : 'The role could not complete this message.');
    } finally {
      setInvestigationSending(false);
    }
  };

  const createInvestigationWorker = async () => {
    const objective = workerObjective.trim();
    if (!activeInvestigation || !objective || workerCreating) return;
    setWorkerCreating(true);
    setInvestigationError('');
    try {
      const planner = activeInvestigation.runs?.find((run) => run.role === 'planner');
      const detail = await createTicketInvestigationWorker(ticket.ticket_number, activeInvestigation.id, {
        objective, parent_id: planner?.id,
      });
      const created = detail.runs?.find((run) => run.role === 'worker' && run.objective === objective);
      applyInvestigation(detail, created?.id);
      setWorkerObjective('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setInvestigationError(detail ? String(detail) : 'Could not create the Worker.');
    } finally {
      setWorkerCreating(false);
    }
  };

  const controlInvestigationRun = async (run: TicketInvestigationRun, action: 'pause' | 'resume' | 'cancel') => {
    if (!activeInvestigation || investigationSending) return;
    setInvestigationSending(true);
    setInvestigationError('');
    try {
      const detail = await controlTicketInvestigationRun(ticket.ticket_number, activeInvestigation.id, run.id, action);
      applyInvestigation(detail, run.id);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setInvestigationError(detail ? String(detail) : 'Could not update the Worker state.');
    } finally {
      setInvestigationSending(false);
    }
  };

  const caseDetailsItems = useMemo(() => {
    const rows: Array<{ label: string; value: any }> = [
      { label: 'Ticket Number', value: ticket.ticket_number },
      { label: 'SIEM Event ID', value: ticket.event_siem_id },
      { label: 'Status', value: renderStatusTag(ticket.status) },
      { label: 'Priority', value: renderSeverityTag(ticket.priority) },
      { label: 'Created', value: formatTimestamp(ticket.created_time) },
      { label: 'Updated', value: formatTimestamp(ticket.updated_time) },
    ];
    return rows.filter(r => showEmpty || maybe(r.value) !== undefined);
  }, [showEmpty, ticket]);

  const labelItems = useMemo(() => formatTicketLabels(editableLabels), [editableLabels]);
  const isDarkTheme = typeof window !== 'undefined' && localStorage.getItem('siem_ui_theme') === 'dark';
  const startChatResize = (axis: 'width' | 'height' | 'both') => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = chatSize.width;
    const startHeight = chatSize.height;
    const maxWidth = Math.max(320, window.innerWidth - chatSize.right - 12);
    const maxHeight = Math.max(360, window.innerHeight - 210);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = axis === 'height' ? startWidth : Math.min(maxWidth, Math.max(320, startWidth + startX - moveEvent.clientX));
      if (axis !== 'height') setChatWidthTouched(true);
      const nextHeight = axis === 'width' ? startHeight : Math.min(maxHeight, Math.max(360, startHeight + moveEvent.clientY - startY));
      setChatSize((prev) => ({ ...prev, width: nextWidth, height: nextHeight }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = axis === 'width' ? 'ew-resize' : axis === 'height' ? 'ns-resize' : 'nesw-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const saveLabels = async (
    nextLabels: Array<{ label_name: string; label_value: string }>,
    successMessage: string,
  ) => {
    if (!ticket.ticket_number) return;

    const normalized: Array<{ label_name: string; label_value: string }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < nextLabels.length; i++) {
      const row = nextLabels[i];
      const name = String(row?.label_name || '').trim();
      const value = String(row?.label_value || '').trim();

      if (!name) {
        message.warning(`Label #${i + 1} requires a label name`);
        return;
      }
      const key = `${name}::${value}`;
      if (seen.has(key)) {
        message.warning(`Duplicate label: ${name}:${value}`);
        return;
      }
      seen.add(key);
      normalized.push({ label_name: name, label_value: value });
    }

    setLabelsSaving(true);
    try {
      await updateSlaTicket(ticket.ticket_number, { labels: normalized });
      setEditableLabels(normalized);
      message.success(successMessage);
    } catch (err: any) {
      const apiError = err?.response?.data?.labels || err?.response?.data?.detail || err?.response?.data?.error;
      message.error(apiError ? String(apiError) : 'Failed to update labels');
    } finally {
      setLabelsSaving(false);
    }
  };

  const addLabel = async () => {
    const name = newLabelName.trim();
    const value = newLabelValue.trim();
    if (!name) {
      message.warning('Label name is required');
      return;
    }
    const next = [...editableLabels, { label_name: name, label_value: value }];
    await saveLabels(next, 'Label added');
    setNewLabelName('');
    setNewLabelValue('');
  };

  const deleteLabel = async (index: number) => {
    const next = editableLabels.filter((_, i) => i !== index);
    await saveLabels(next, 'Label deleted');
  };

  const activeInvestigationRun = activeInvestigation?.runs?.find((run) => run.id === activeInvestigationRunId) || null;
  const investigationRunsByRole = (role: TicketInvestigationRun['role']) => activeInvestigation?.runs?.filter((run) => run.role === role) || [];
  const sideQuestionParent = activeInvestigationRun && ['main', 'planner', 'worker'].includes(activeInvestigationRun.role) ? activeInvestigationRun : null;
  const sideQuestionRunning = Boolean(sideConversation?.messages.some((item) => item.role === 'user' && ['queued', 'running'].includes(item.status)));

  const loadSideQuestions = async (run = sideQuestionParent) => {
    if (!activeInvestigation || !run) return;
    setSideQuestionLoading(true);
    setSideQuestionError('');
    try {
      const detail = await fetchTicketInvestigationSideQuestions(ticket.ticket_number, activeInvestigation.id, run.id);
      setSideConversation(detail);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setSideQuestionError(detail ? String(detail) : 'Could not load Side Question history.');
    } finally {
      setSideQuestionLoading(false);
    }
  };

  const openSideQuestions = () => {
    if (!sideQuestionParent) {
      setInvestigationError('Select Main Agent, Planner, or a Worker before opening Side Question.');
      return;
    }
    setSideQuestionOpen(true);
    setSideQuestionDraft('');
    void loadSideQuestions(sideQuestionParent);
  };

  const askSideQuestion = async () => {
    const question = sideQuestionDraft.trim();
    if (!activeInvestigation || !sideQuestionParent || !question || sideQuestionLoading || sideQuestionRunning || !requireAiModel()) return;
    setSideQuestionLoading(true);
    setSideQuestionError('');
    try {
      const detail = await askTicketInvestigationSideQuestion(ticket.ticket_number, activeInvestigation.id, sideQuestionParent.id, {
        question, model_profile_id: aiModelId,
      });
      setSideConversation(detail);
      setSideQuestionDraft('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setSideQuestionError(detail ? String(detail) : 'Could not start Side Question.');
    } finally {
      setSideQuestionLoading(false);
    }
  };

  const cancelSideQuestion = async () => {
    if (!activeInvestigation || !sideQuestionParent) return;
    const current = sideConversation?.messages.find((item) => item.role === 'user' && ['queued', 'running'].includes(item.status));
    if (!current) return;
    setSideQuestionLoading(true);
    try {
      const detail = await cancelTicketInvestigationSideQuestion(ticket.ticket_number, activeInvestigation.id, sideQuestionParent.id, current.id);
      setSideConversation(detail);
      setSideQuestionError('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setSideQuestionError(detail ? String(detail) : 'Could not stop Side Question.');
    } finally {
      setSideQuestionLoading(false);
    }
  };

  const clearSideQuestions = () => {
    if (!activeInvestigation || !sideQuestionParent) return;
    Modal.confirm({
      title: '清空旁路提问历史？',
      content: '只会删除当前 Agent 的独立旁路讨论；主会话和该 Agent 的调查上下文会保留。',
      okText: '清空历史', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        await clearTicketInvestigationSideQuestions(ticket.ticket_number, activeInvestigation.id, sideQuestionParent.id);
        setSideConversation({ id: null, parent_run_id: sideQuestionParent.id, model_profile_id: null, snapshot_available: true, messages: [] });
        setSideQuestionError('');
      },
    });
  };

  useEffect(() => {
    if (!sideQuestionOpen || !sideQuestionRunning || !activeInvestigation || !sideQuestionParent) return undefined;
    const timer = window.setInterval(() => { void loadSideQuestions(sideQuestionParent); }, 1000);
    return () => window.clearInterval(timer);
  }, [sideQuestionOpen, sideQuestionRunning, activeInvestigation?.id, sideQuestionParent?.id]);

  const assistantTabs = [
    {
      key: 'sessions', label: '会话', children: (
        <section className={`${layoutStyles.ticketSessions} ${sideQuestionOpen ? layoutStyles.ticketSessionsWithSide : ''}`}>
          <aside className={layoutStyles.ticketSessionSidebar}>
            <header className={layoutStyles.ticketSessionSidebarHead}>
              <div className={layoutStyles.ticketSessionSidebarTitle}>
                <Typography.Text type="secondary">会话列表</Typography.Text>
                <Typography.Text type="secondary" className={layoutStyles.ticketSessionRunState}>
                  {investigationSending ? '● 执行中' : investigationLoading ? '◌ 加载中' : '○ 可交互'}
                </Typography.Text>
              </div>
              <div className={layoutStyles.ticketSessionMetrics}>
                <span>Ticket</span><b>{ticket.ticket_number}</b>
                <span>会话</span><b>{investigationSessions.length}</b>
              </div>
            </header>
            <div className={layoutStyles.ticketSessionSidebarBody}>
              <section className={layoutStyles.ticketSessionBlock}>
                <div className={layoutStyles.ticketSessionGroup}>
                  <Bot size={16} /><span>Main Agent</span><span className={layoutStyles.ticketSessionGrow} />
                  <Button type="text" size="small" icon={<Plus size={13} />} onClick={() => void createInvestigation()} loading={investigationLoading} disabled={investigationSending || !aiModelReady}>新建</Button>
                </div>
                {investigationSessions.map((session) => (
                  <button key={session.id} type="button" className={`${layoutStyles.ticketSessionItem} ${activeInvestigation?.id === session.id ? layoutStyles.ticketSessionItemActive : ''}`} onClick={() => void openInvestigation(session.id)}>
                    <span className={layoutStyles.ticketSessionItemMain}>主 Agent · 会话 #{session.sequence}</span>
                    {session.id !== activeInvestigation?.id ? <small>已归档</small> : null}
                  </button>
                ))}
                {!investigationSessions.length && !investigationLoading ? <div className={layoutStyles.ticketSessionEmpty}>新建一个会话开始调查</div> : null}
              </section>

              {activeInvestigation ? <>
                <section className={layoutStyles.ticketSessionBlock}>
                  <div className={layoutStyles.ticketSessionGroup}><ListChecks size={16} /><span>规划 Planner</span></div>
                  {investigationRunsByRole('planner').map((run) => (
                    <button key={run.id} type="button" className={`${layoutStyles.ticketSessionItem} ${activeInvestigationRunId === run.id ? layoutStyles.ticketSessionItemActive : ''}`} onClick={() => setActiveInvestigationRunId(run.id)}>
                      <CheckCircle2 size={15} /><span className={layoutStyles.ticketSessionItemMain}>{run.title}</span>
                    </button>
                  ))}
                </section>
                <section className={layoutStyles.ticketSessionBlock}>
                  <div className={layoutStyles.ticketSessionGroup}><ShieldCheck size={16} /><span>系统审计</span></div>
                  <div className={layoutStyles.ticketSessionReadonly}>系统事件 · 调用、范围与人工复核</div>
                </section>
                <section className={layoutStyles.ticketSessionBlock}>
                  <div className={layoutStyles.ticketSessionGroup}><Wrench size={16} /><span>Workers</span><Typography.Text type="secondary">· {investigationRunsByRole('worker').length}</Typography.Text></div>
                  {investigationRunsByRole('worker').map((run) => (
                    <button key={run.id} type="button" className={`${layoutStyles.ticketSessionItem} ${activeInvestigationRunId === run.id ? layoutStyles.ticketSessionItemActive : ''}`} onClick={() => setActiveInvestigationRunId(run.id)}>
                      {run.status === 'paused' ? <CirclePause size={15} /> : run.status === 'completed' ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                      <span className={layoutStyles.ticketSessionItemMain}>#{run.title.replace(/^Worker · /, '')}</span>
                    </button>
                  ))}
                  <details className={layoutStyles.ticketWorkerCreate}>
                    <summary>+ 新建 Worker</summary>
                    <Input.TextArea value={workerObjective} onChange={(event) => setWorkerObjective(event.target.value)} placeholder="Worker 调查目标" maxLength={4000} autoSize={{ minRows: 2, maxRows: 4 }} />
                    <Button size="small" type="primary" loading={workerCreating} disabled={!workerObjective.trim()} onClick={() => void createInvestigationWorker()}>创建 Worker</Button>
                  </details>
                </section>
              </> : null}
            </div>
          </aside>

          <section className={layoutStyles.ticketSessionMain}>
            <header className={layoutStyles.ticketSessionMainHead}>
              <div className={layoutStyles.ticketSessionHeading}>
                <Typography.Text strong>{activeInvestigationRun?.role === 'main' ? `主 Agent · 会话 #${activeInvestigation?.sequence || ''}` : activeInvestigationRun?.title || '选择或新建一个会话'}</Typography.Text>
                {activeInvestigationRun ? <Button size="small" icon={<MessageCircleQuestion size={15} />} onClick={openSideQuestions}>旁路提问</Button> : null}
                <Tag>平台默认模型</Tag>
              </div>
              <div className={layoutStyles.ticketSessionHeaderActions}>
                <div className={layoutStyles.ticketSessionModel}>{aiModelSelector}</div>
                <span>{investigationSending ? '执行中 · 请等待' : activeInvestigationRun?.status === 'paused' ? '只读' : '可交互'}</span>
                <details className={layoutStyles.ticketSessionOptions}>
                  <summary>会话详情</summary>
                  <div className={layoutStyles.ticketSessionOptionsBody}>
                  <Button size="small" onClick={() => void loadInvestigations()} loading={investigationLoading}>Reload sessions</Button>
                  {activeInvestigationRun?.role === 'worker' && activeInvestigationRun.status !== 'cancelled' ? (
                    <>
                      {activeInvestigationRun.status === 'paused'
                        ? <Button size="small" onClick={() => void controlInvestigationRun(activeInvestigationRun, 'resume')}>Resume Worker</Button>
                        : <Button size="small" onClick={() => void controlInvestigationRun(activeInvestigationRun, 'pause')}>Pause Worker</Button>}
                      <Button size="small" danger onClick={() => void controlInvestigationRun(activeInvestigationRun, 'cancel')}>Cancel Worker</Button>
                    </>
                  ) : null}
                  </div>
                </details>
              </div>
            </header>
            {investigationError ? <Alert type="error" showIcon message={investigationError} /> : null}
            <div className={layoutStyles.ticketSessionTranscript} aria-live="polite">
              {investigationLoading ? <Typography.Text type="secondary">Loading investigation session...</Typography.Text> : activeInvestigationRun?.messages.length ? (
                activeInvestigationRun.messages.map((msg, index) => (
                  <article key={msg.id || `${msg.role}_${index}`} className={`${layoutStyles.ticketChatMessage} ${msg.role === 'user' ? layoutStyles.ticketChatMessageUser : layoutStyles.ticketChatMessageAssistant}`}>
                    <div className={layoutStyles.ticketChatMessageText}>{msg.content}</div>
                    {msg.trace?.length ? (
                      <details className={layoutStyles.ticketChatTrace}>
                        <summary>工具调用记录</summary>
                        <pre>{JSON.stringify(msg.trace, null, 2)}</pre>
                      </details>
                    ) : null}
                    <time className={layoutStyles.ticketChatMessageTime}>{formatTimestamp(msg.created_at)}</time>
                  </article>
                ))
              ) : <Empty description={activeInvestigationRun ? 'No messages in this role yet' : 'Create an investigation session to begin'} />}
              {activeInvestigationRun?.role === 'worker' && activeInvestigationRun.objective ? <Alert type="info" showIcon message={`Worker objective: ${activeInvestigationRun.objective}`} /> : null}
            </div>
            <form className={layoutStyles.ticketSessionComposer} onSubmit={(event) => { event.preventDefault(); void sendInvestigationMessage(); }}>
              <div className={layoutStyles.ticketSessionInputBox}>
                <Input.TextArea value={investigationDraft} onChange={(event) => setInvestigationDraft(event.target.value)}
                  onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void sendInvestigationMessage(); } }}
                  placeholder={activeInvestigationRun?.role === 'worker' ? '向 Worker 补充调查指令…' : '继续当前调查会话…'} maxLength={4000}
                  autoSize={{ minRows: 3, maxRows: 6 }} disabled={!activeInvestigationRun || investigationSending || activeInvestigationRun.status === 'paused' || activeInvestigationRun.status === 'cancelled'} />
              </div>
              <div className={layoutStyles.ticketSessionComposerFoot}>
                <Typography.Text type="secondary">Enter 发送 · Shift + Enter 换行</Typography.Text>
                <Button type="primary" htmlType="submit" loading={investigationSending} disabled={!investigationDraft.trim() || !activeInvestigationRun || !aiModelReady || activeInvestigationRun.status === 'paused' || activeInvestigationRun.status === 'cancelled'} aria-label="发送消息" icon={<Send size={15} />}>发送</Button>
              </div>
            </form>
          </section>
          {sideQuestionOpen ? <aside className={layoutStyles.ticketSideQuestionPanel} aria-label="Side Question">
            <header className={layoutStyles.ticketSideQuestionHead}>
              <div>
                <strong>Side Question</strong>
                <code>/btw</code>
                <small>{sideQuestionParent?.title || ''}</small>
              </div>
              <Space size={2}>
                <Button type="text" size="small" onClick={() => void loadSideQuestions()} loading={sideQuestionLoading} aria-label="刷新旁路提问">↻</Button>
                <Button type="text" size="small" onClick={clearSideQuestions} disabled={!sideConversation?.messages.length || sideQuestionLoading} aria-label="清空旁路提问">⌫</Button>
                <Button type="text" size="small" onClick={() => setSideQuestionOpen(false)} aria-label="关闭旁路提问">×</Button>
              </Space>
            </header>
            <div className={layoutStyles.ticketSideQuestionMeta}>
              <span>{aiModels.find((model) => model.id === aiModelId)?.model || 'Agent model'}</span>
              <span>独立讨论 · 不执行工具</span>
            </div>
            <div className={layoutStyles.ticketSideQuestionHistory} aria-live="polite">
              {sideQuestionError ? <Alert type="error" showIcon message={sideQuestionError} /> : null}
              {!sideConversation?.messages.length && !sideQuestionLoading ? <div className={layoutStyles.ticketSideQuestionEmpty}>随时提问。回答会使用当前 Agent 的已保存上下文，主调查会继续独立运行。</div> : null}
              {sideConversation?.messages.map((item) => (
                <article key={item.id} className={layoutStyles.ticketSideQuestionEntry}>
                  <div className={item.role === 'user' ? layoutStyles.ticketSideQuestionPrompt : item.role === 'system' ? layoutStyles.ticketSideQuestionSystem : layoutStyles.ticketSideQuestionAnswer}>{item.content}</div>
                  <div className={layoutStyles.ticketSideQuestionStatus}>
                    <Tag>{item.status === 'queued' || item.status === 'running' ? '回答中' : item.status === 'completed' ? '已完成' : item.status === 'cancelled' ? '已停止' : '失败'}</Tag>
                    <time>{formatTimestamp(item.created_at)}</time>
                  </div>
                </article>
              ))}
            </div>
            <form className={layoutStyles.ticketSideQuestionComposer} onSubmit={(event) => { event.preventDefault(); void askSideQuestion(); }}>
              <Input.TextArea value={sideQuestionDraft} onChange={(event) => setSideQuestionDraft(event.target.value)} maxLength={4000} autoSize={{ minRows: 2, maxRows: 5 }}
                onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void askSideQuestion(); } }} placeholder="询问当前 Agent 的上下文…" disabled={sideQuestionLoading || sideQuestionRunning || !sideQuestionParent} />
              <div className={layoutStyles.ticketSideQuestionFoot}>
                <Typography.Text type="secondary">独立讨论 · 不执行工具</Typography.Text>
                {sideQuestionRunning ? <Button size="small" onClick={() => void cancelSideQuestion()} loading={sideQuestionLoading}>■ 停止</Button> : <Button type="primary" size="small" htmlType="submit" disabled={!sideQuestionDraft.trim() || !sideQuestionParent || sideQuestionLoading || !aiModelReady} icon={<Send size={14} />}>发送</Button>}
              </div>
            </form>
          </aside> : null}
        </section>
      ),
    },
    {
      key: 'alerts', label: `同资产其他告警${relatedAlertsLoaded ? ` (${relatedAlerts.length})` : ''}`, children: (
        <Card size="small" title="同资产其他告警" extra={<Button size="small" onClick={() => void loadRelatedAlerts()} loading={relatedAlertsLoading}>刷新</Button>}>
          <Alert type="info" showIcon message={`当前资产：${assistantAsset || '工单中没有可用的资产标识'}`} style={{ marginBottom: 12 }} />
          {relatedAlertsError ? <Alert type="warning" showIcon message={relatedAlertsError} style={{ marginBottom: 12 }} /> : null}
          {relatedAlertsLoading ? <Typography.Text type="secondary">正在查询现有告警接口...</Typography.Text> : relatedAlerts.length ? (
            <List dataSource={relatedAlerts} renderItem={(row: any) => (
              <List.Item>
                <List.Item.Meta title={<Space wrap><Typography.Text strong>{row.alert_id || row._id || 'Alert'}</Typography.Text>{row.severity ? <Tag>{row.severity}</Tag> : null}</Space>}
                  description={<><div>{row.description || row.message || row.title || '-'}</div><Typography.Text type="secondary">{formatTimestamp(row.timestamp || row['@timestamp'])}</Typography.Text></>} />
              </List.Item>
            )} />
          ) : <Empty description={relatedAlertsLoaded ? '没有找到该资产的其他告警' : '打开此标签后查询该资产的告警'} />}
        </Card>
      ),
    },
    {
      key: 'reasoning', label: '研判理由', children: (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card size="small" title="AI 研判摘要">
            {summaryText !== 'No summary available yet.' ? <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summaryText}</div> : <Empty description="当前工单还没有 AI 研判摘要" />}
          </Card>
          {rawSummaryText ? <Card size="small" title="AI 原始响应"><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rawSummaryText}</div></Card> : null}
        </div>
      ),
    },
    {
      key: 'timeline', label: '资产时间线', children: (
        <Card size="small" title="工单时间线">
          {timelineItems.length ? <List dataSource={timelineItems} renderItem={(item) => (
            <List.Item><Space align="start"><Tag color="blue">{formatTimestamp(item.time)}</Tag><Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.text}</Typography.Text></Space></List.Item>
          )} /> : <Empty description="当前工单没有时间线记录" />}
        </Card>
      ),
    },
    {
      key: 'tasks', label: '调查计划', children: (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card size="small" title="AI 已完成任务">
            {aiTasks.length ? <List dataSource={aiTasks} renderItem={(item: any) => <List.Item><List.Item.Meta title={item?.title || item?.task || String(item)} description={item?.detail} /></List.Item>} /> : <Empty description="暂无 AI 任务记录" />}
          </Card>
          <Card size="small" title="建议的下一步">
            {nextTasks.length ? <List dataSource={nextTasks} renderItem={(item: any) => <List.Item><List.Item.Meta title={item?.title || String(item)} description={item?.detail} /></List.Item>} /> : <Empty description="暂无下一步建议" />}
          </Card>
          <Card size="small" title="现有 Work Plan" loading={workplanLoading}>
            {workplanItems.length ? <List dataSource={workplanItems} renderItem={(item) => <List.Item><List.Item.Meta title={item.workflow_name} description={`${item.status} · ${formatTimestamp(item.created_at)}`} /></List.Item>} /> : <Empty description="当前工单没有 Work Plan 执行记录" />}
          </Card>
        </div>
      ),
    },
    {
      key: 'evidence', label: '证据与查询', children: (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card size="small" title={`Observable Evidence (${observableEvidenceItems.length})`}>
            {observableEvidenceItems.length ? <Table rowKey="key" size="small" pagination={false} columns={observableColumns} dataSource={observableEvidenceItems} scroll={{ x: 'max-content' }} /> : <Empty description="当前工单没有 Observable Evidence" />}
          </Card>
          <Card size="small" title={`附件 (${attachments.length})`}>
            {attachments.length ? <Table rowKey="id" size="small" pagination={false} columns={attachmentColumns} dataSource={attachments} scroll={{ x: 'max-content' }} /> : <Empty description="当前工单没有附件" />}
          </Card>
        </div>
      ),
    },
    {
      key: 'approval', label: '处置审批', children: (
        <Card size="small" title="工单处置动作">
          <Alert type="info" showIcon message="以下动作使用工单现有状态更新接口；AI 不会自动执行处置。" style={{ marginBottom: 14 }} />
          <Space wrap>
            <Button onClick={() => updateDecisionStatus('acknowledged')} disabled={!canAcknowledge}>Acknowledge</Button>
            <Button type="primary" onClick={() => updateDecisionStatus('triaged')} disabled={!canTriaged}>Triaged</Button>
            <Button onClick={() => updateDecisionStatus('contained')} disabled={!canContained}>Contained</Button>
            <Button onClick={() => setResolveOpen(true)} disabled={!canResolved}>Resolved</Button>
          </Space>
          <Descriptions size="small" column={1} style={{ marginTop: 16 }}>
            <Descriptions.Item label="当前状态">{renderStatusTag(ticket.status)}</Descriptions.Item>
            <Descriptions.Item label="Ticket Verdict">{ticket.event_result || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
      ),
    },
    {
      key: 'report', label: '调查报告', children: (
        <Card size="small" title="AI 调查报告">
          {rawSummaryText ? <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rawSummaryText}</div> : summaryText !== 'No summary available yet.' ? <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summaryText}</div> : <Empty description="当前工单还没有 AI 调查报告" />}
        </Card>
      ),
    },
  ];

  return (
    <div className={layoutStyles.detail} style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Space size={12} wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {ticket.ticket_number}
          </Typography.Title>
          {renderStatusTag(ticket.status)}
          {renderSeverityTag(ticket.priority)}
        </Space>
        <Space wrap>
          <Button onClick={togglePending} loading={pendingLoading} disabled={!canTogglePending}>
            {isPending ? 'In Progress' : 'Pending'}
          </Button>
          <Button onClick={onRefresh} loading={loading}>Refresh</Button>
          <Button>Search</Button>
          <Button>Settings</Button>
        </Space>
      </div>

      <div style={{ marginTop: 10 }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            if (key === 'ai_assistant' && assistantInnerTab === 'alerts' && !relatedAlertsLoaded) void loadRelatedAlerts();
            if (key === 'ai_assistant' && assistantInnerTab === 'sessions' && !investigationSessions.length) void loadInvestigations(true);
          }}
          items={[
            { key: 'incident', label: 'Incident Info' },
            { key: 'ai_assistant', label: 'AI Assistant' },
            { key: 'war_room', label: 'War Room' },
            { key: 'work_plan', label: 'Work Plan (1)' },
            { key: 'evidence', label: `Evidence (${evidenceCount})` },
            { key: 'related', label: 'Related Incidents' },
          ]}
        />
      </div>

      <div>
        {activeTab === 'ai_assistant' ? (
          <div className={layoutStyles.ticketAssistantWorkbench}>
            <div className={layoutStyles.ticketAssistantWorkbenchTitle}>
              <Space wrap size={8}>
                <Typography.Text strong>Case Investigation</Typography.Text>
                <Tag>{assistantAsset || '当前资产'}</Tag>
                <Typography.Text type="secondary">主告警驱动 · 同资产告警补充研判</Typography.Text>
              </Space>
              <Space wrap>
                <Button href="/settings/ai-assistant">MCP / Skills</Button>
                <Button onClick={() => {
                  setAssistantInnerTab('alerts');
                  if (!relatedAlertsLoaded) void loadRelatedAlerts();
                }}>同资产其他告警{relatedAlertsLoaded ? `（${relatedAlerts.length}）` : ''}</Button>
                <Button type="primary" onClick={runAiAssistant} loading={aiLoading} disabled={!aiModelReady}>启动 / 继续调查</Button>
              </Space>
            </div>

            {assistantInnerTab !== 'sessions' ? <Alert type="info" showIcon className={layoutStyles.ticketAssistantScope} message={(
              <Space wrap>
                <Typography.Text strong>当前 Case：{ticket.ticket_number}</Typography.Text>
                <span>资产：{assistantAsset || '未提供'}</span>
                <span>事件：{ticket.title || incidentTitle}</span>
                {renderStatusTag(ticket.status)}
                {renderSeverityTag(ticket.priority)}
                <Tag color="green">证据 {evidenceCount}</Tag>
                <Tag color="blue">Worklog {workLogs.length}</Tag>
              </Space>
            )} /> : null}

            <Tabs
              activeKey={assistantInnerTab}
              onChange={(key) => {
                setAssistantInnerTab(key);
                if (key === 'sessions' && !investigationSessions.length) void loadInvestigations(true);
                if (key === 'alerts' && !relatedAlertsLoaded) void loadRelatedAlerts();
              }}
              items={assistantTabs}
            />
          </div>
        ) : activeTab === 'war_room' ? (
          <WarRoomView
            ticket={ticket}
            workLogs={workLogs}
            handleLogs={handleLogs}
            attachments={attachments}
            onAddWorkLog={isPending ? undefined : props.onAddWorkLog}
            onUploadWorkLogImage={isPending ? undefined : props.onUploadWorkLogImage}
            loading={loading}
          />
        ) : activeTab !== 'incident' ? (
          <div style={{ paddingTop: 8 }}>
            {activeTab === 'work_plan' && (
              <Card size="small" title="Work Plan (1)">
                <Empty description="No work plan items yet" />
              </Card>
            )}
            {activeTab === 'evidence' && (
              <Card size="small" title={`Evidence (${evidenceCount})`}>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <Typography.Text strong>Observable Evidence</Typography.Text>
                    {observableEvidenceItems.length ? (
                      <Table
                        rowKey="key"
                        size="small"
                        scroll={{ x: 'max-content' }}
                        pagination={{ pageSize: 6 }}
                        columns={observableColumns}
                        dataSource={observableEvidenceItems}
                        style={{ marginTop: 8 }}
                      />
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        <Empty description="No observable evidence yet" />
                      </div>
                    )}
                  </div>
                  <div>
                    <Typography.Text strong>File Evidence</Typography.Text>
                    {attachments.length ? (
                      <Table
                        rowKey="id"
                        size="small"
                        scroll={{ x: 'max-content' }}
                        pagination={false}
                        columns={attachmentColumns}
                        dataSource={attachments}
                        style={{ marginTop: 8 }}
                      />
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        <Empty description="No file evidence yet" />
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}
            {activeTab === 'related' && <Empty description="No related incidents yet" />}
          </div>
        ) : (
          <div className={layoutStyles.detailGrid}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card size="small" title="Case Details">
                <Descriptions size="small" column={1} bordered>
                  {caseDetailsItems.map((r) => (
                    <Descriptions.Item key={r.label} label={r.label}>
                      {maybe(r.value) ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>-</span>}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Card>
              <Card size="small" title="Decision Actions">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button onClick={() => updateDecisionStatus('acknowledged')} disabled={!canAcknowledge}>Acknowledge</Button>
                  <Button type="primary" onClick={() => updateDecisionStatus('triaged')} disabled={!canTriaged}>Triaged</Button>
                  <Button onClick={() => updateDecisionStatus('contained')} disabled={!canContained}>Contained</Button>
                  <Button onClick={() => setResolveOpen(true)} disabled={!canResolved}>Resolved</Button>
                </div>
              </Card>
              <Card size="small" title="Resolution Summary">
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="Ticket Category">
                    {ticket.event_category || <span style={{ color: 'rgba(0,0,0,0.35)' }}>-</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Ticket Verdict">
                    {ticket.event_result || <span style={{ color: 'rgba(0,0,0,0.35)' }}>-</span>}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
              <Card size="small" title="Labels">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Space.Compact block>
                    <Input
                      placeholder="Label name"
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      disabled={labelsSaving || loading}
                    />
                    <Input
                      placeholder="Label value (optional)"
                      value={newLabelValue}
                      onChange={(e) => setNewLabelValue(e.target.value)}
                      disabled={labelsSaving || loading}
                    />
                    <Button type="primary" onClick={addLabel} loading={labelsSaving || loading}>Add</Button>
                  </Space.Compact>

                  {labelItems.length ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {labelItems.map((item, idx) => (
                        <Tag
                          key={`${item}_${idx}`}
                          color="processing"
                          closable
                          onClose={(e) => {
                            e.preventDefault();
                            void deleteLabel(idx);
                          }}
                        >
                          {item}
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <span className="sla-muted-text">No labels</span>
                  )}
                </div>
              </Card>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{incidentTitle}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#666' }}>Score</span>
                  <Tag color="gold">{String(aiHeader?.score ?? riskScore)}</Tag>
                </div>
              </div>
              <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: '#fff7e6', border: '1px solid #ffd591' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 2c1.6 3.6 5 6.4 5 10.2 0 3.3-2.7 5.8-6 5.8s-6-2.5-6-5.8C5 8.3 8.5 5.3 12 2z" fill="#fa541c" />
                        <path d="M10 10c.9 1.4 2.8 2.6 2.8 4.3 0 1.4-1.2 2.5-2.7 2.5S7.4 15.7 7.4 14.3C7.4 12.7 9 11.5 10 10z" fill="#ffd591" />
                      </svg>
                      {renderSeverityTag(
                        aiHeader?.risk_level || ticket.priority,
                        aiHeader?.risk_level || ticket.priority || 'RISK',
                      )}
                    </span>
                    <span style={{ color: 'rgba(0,0,0,0.65)' }}>AI Confidence:</span>
                    <Tag color="gold">{aiHeader?.ai_confidence || '-'}</Tag>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--access-secondary-text)' }}>Score</span>
                    <Tag color="gold">{String(aiHeader?.score ?? riskScore)}</Tag>
                  </div>
                </div>
                {aiHeader?.summary_title ? (
                  <div style={{ marginTop: 6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontSize: 15 }}>
                    {aiHeader.summary_title}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, color: 'var(--text-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Status:</span>
                  {renderStatusTag(ticket.status)}
                </div>
                <div>Owner: {ownerName}</div>
                <div>Platform: {aiHeader?.platform || ticket.event_platform || '-'}</div>
                <div>Source: {aiHeader?.source || ticket.event_sources || '-'}</div>
              </div>
            </Card>

              <Card size="small" title="AI Summary">
                <div style={{ maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {summaryText}
                </div>
                {rawSummaryText ? (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--access-secondary-text)' }}>Raw AI response</summary>
                    <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                      {rawSummaryText}
                    </div>
                  </details>
                ) : null}
              </Card>

              <Card size="small">
                <Tabs
                  items={[
                    { key: 'timeline', label: 'Timeline' },
                    { key: 'alerts', label: 'Alerts' },
                    { key: 'response', label: 'Raw Message' },
                    { key: 'tasks', label: 'Tasks' },
                  ]}
                  activeKey={incidentTab}
                  onChange={setIncidentTab}
                />
                {incidentTab === 'timeline' ? (
                  <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    {timelineItems.length ? (
                      <List
                        dataSource={timelineItems}
                        renderItem={(item, idx) => {
                          const text = String(item.text || '');
                          const short = text.length > 80 ? `${text.slice(0, 80)}...` : text;
                          const isOpen = expandedTimelineIndex === idx;
                          return (
                            <List.Item>
                              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                                <Tag color="gold">{item.time}</Tag>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{short}</div>
                                    {text.length > short.length ? (
                                      <Button size="small" type="link" onClick={() => setExpandedTimelineIndex(isOpen ? null : idx)}>
                                        {isOpen ? 'Hide' : 'Details'}
                                      </Button>
                                    ) : null}
                                  </div>
                                  {isOpen ? (
                                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                                      {text}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </List.Item>
                          );
                        }}
                      />
                    ) : (
                      <Empty description="No timeline yet" />
                    )}
                  </div>
                ) : incidentTab === 'response' ? (
                  ticket.alert_message ? (
                    (() => {
                      const raw = String(ticket.alert_message || '');
                      let parsed: any = null;
                      try {
                        parsed = JSON.parse(raw);
                      } catch {
                        parsed = null;
                      }
                      if (parsed) {
                        const pretty = JSON.stringify(parsed, null, 2);
                        return (
                          <details className="raw-message-json" open>
                            <summary className="raw-message-json-summary">JSON</summary>
                            <pre className="raw-message-json-pre">
                              <code>{renderJsonSyntax(pretty)}</code>
                            </pre>
                          </details>
                        );
                      }
                      return <div className="raw-message-json raw-message-plain">{raw}</div>;
                    })()
                  ) : (
                    <Empty description="No raw message" />
                  )
                ) : (
                  <Empty description="No data yet" />
                )}
              </Card>

              <Card size="small" title={`Evidence (${evidenceCount})`}>
                {observableEvidenceItems.length ? (
                  <List
                    dataSource={observableEvidenceItems.slice(0, 6)}
                    renderItem={(item) => (
                      <List.Item>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <Typography.Text strong>{item.type}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                            {item.value}
                          </Typography.Text>
                        </div>
                      </List.Item>
                    )}
                  />
                ) : evidenceItems.length ? (
                  <List
                    dataSource={evidenceItems}
                    renderItem={(item) => (
                      <List.Item>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <Typography.Text strong>{item.file_name}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {item.uploaded_time}
                          </Typography.Text>
                        </div>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="No evidence yet" />
                )}
              </Card>

              <Card size="small" title="Work Plan" loading={workplanLoading}>
                {workplanItems.length ? (
                  <List
                    size="small"
                    dataSource={workplanItems}
                    renderItem={(item) => (
                      <List.Item>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <Typography.Text strong>{item.workflow_name}</Typography.Text>
                            <Tag color={item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'blue'}>{item.status}</Tag>
                          </div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {item.trigger_source} · {formatTimestamp(item.created_at)}
                          </Typography.Text>
                          {item.error_message ? (
                            <div style={{ marginTop: 4 }}>
                              <Typography.Text type="danger" style={{ fontSize: 12 }}>{item.error_message}</Typography.Text>
                            </div>
                          ) : null}
                        </div>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="No playbook executions yet" />
                )}
              </Card>

              <Card size="small">
                <Input.TextArea
                  value={commentDraft}
                  onChange={(e) => handleCommentDraftChange(e.target.value)}
                  placeholder="Comment or use suggestions from AI Assistant..."
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  disabled={commentSending}
                />
                {playbookSuggestOpen ? (
                  <Card size="small" style={{ marginTop: 8 }} bodyStyle={{ padding: 8 }}>
                    {playbookLoading ? (
                      <Typography.Text type="secondary">Loading playbooks...</Typography.Text>
                    ) : playbookOptions.length ? (
                      <List
                        size="small"
                        dataSource={playbookOptions}
                        renderItem={(item) => (
                          <List.Item style={{ cursor: 'pointer' }} onClick={() => selectPlaybook(item)}>
                            <List.Item.Meta
                              title={<Typography.Text>{item.name}</Typography.Text>}
                              description={item.description || 'Invoke this playbook from the ticket context'}
                            />
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Typography.Text type="secondary">No callable playbooks</Typography.Text>
                    )}
                  </Card>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <Button>Attach</Button>
                  <Button type="primary" onClick={sendComment} loading={commentSending} disabled={!commentDraft.trim() || commentSending}>
                    Send
                  </Button>
                </div>
              </Card>
            </div>

            <div ref={aiAssistantCardRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card size="small" title="SOC AI Assistant">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e6f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>AI</div>
                <div>
                  <div style={{ fontWeight: 600 }}>AI Assistant</div>
                  <div className="soc-ai-assistant-subtitle">Alert interpretation and summary</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {aiModelSelector}
                <Typography.Text type="secondary">Used for ticket analysis, chat and @AI. Changes apply to the next request.</Typography.Text>
                <Button type="primary" onClick={runAiAssistant} loading={aiLoading} disabled={!aiModelReady}>
                  Run AI Assistant
                </Button>
                <Button onClick={openChat}>
                  Chat
                </Button>
              </div>
              {aiError ? (
                <>
                  <Divider />
                  <Typography.Text type="danger">{aiError}</Typography.Text>
                </>
              ) : null}
            </Card>

              <Card size="small" title="AI Tasks">
              {aiTasks.length ? (
                <List
                  dataSource={aiTasks}
                  renderItem={(item: any, idx: number) => {
                    const text = item?.detail ? String(item.detail) : String(item || '');
                    const title = item?.title ? String(item.title) : text;
                    const short = title.length > 60 ? `${title.slice(0, 60)}...` : title;
                    const isOpen = expandedTaskIndex === idx;
                    return (
                      <List.Item style={{ alignItems: 'flex-start' }}>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <div>
                              <Tag color="green">OK</Tag> {short || '-'}
                            </div>
                            <Button size="small" type="link" onClick={() => setExpandedTaskIndex(isOpen ? null : idx)}>
                              {isOpen ? 'Hide' : 'Details'}
                            </Button>
                          </div>
                          {isOpen ? (
                            <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: 'rgba(0,0,0,0.65)' }}>
                              {text || title || '-'}
                            </div>
                          ) : null}
                        </div>
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty description="No AI tasks yet" />
              )}
              <Divider />
              <Typography.Text strong>Add Tasks</Typography.Text>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {nextTasks.length ? (
                  nextTasks.map((t: any, idx: number) => {
                    const title = t?.title || String(t);
                    const detail = t?.detail ? String(t.detail) : '';
                    const isOpen = expandedNextTaskIndex === idx;
                    return (
                      <div key={`${title}_${idx}`} style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <Checkbox>{title}</Checkbox>
                          {detail ? (
                            <Button size="small" type="link" onClick={() => setExpandedNextTaskIndex(isOpen ? null : idx)}>
                              {isOpen ? 'Hide' : 'Details'}
                            </Button>
                          ) : null}
                        </div>
                        {detail && isOpen ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 24, whiteSpace: 'pre-wrap' }}>
                            {detail}
                          </Typography.Text>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <Checkbox disabled>No AI-suggested tasks</Checkbox>
                )}
              </div>
            </Card>

            </div>
          </div>
        )}
      </div>

      <Modal
        title="Resolve Ticket"
        open={resolveOpen}
        onCancel={() => setResolveOpen(false)}
        onOk={submitResolve}
        confirmLoading={resolveSubmitting}
        okText="Resolve"
        destroyOnClose
      >
        <Form form={resolveForm} layout="vertical">
          <Form.Item label="Event Category" name="event_category">
            <Select
              loading={resolveLoading}
              allowClear
              placeholder="Select category"
              options={(resolveChoices?.event_category_choices || []).map((c: any) => ({
                value: c.value,
                label: c.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Event Result" name="event_result">
            <Select
              loading={resolveLoading}
              allowClear
              placeholder="Select result"
              options={(resolveChoices?.event_result_choices || []).map((c: any) => ({
                value: c.value,
                label: c.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Optional notes" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Chat - ${ticket.ticket_number}`}
        open={chatOpen}
        wrapClassName={isDarkTheme ? 'sla-ai-chat-modal sla-ai-chat-modal-dark' : 'sla-ai-chat-modal'}
        className="sla-ai-chat-drawer-modal"
        onCancel={() => setChatOpen(false)}
        footer={null}
        width={chatSize.width}
        centered={false}
        style={{ top: chatSize.top, right: chatSize.right }}
        styles={{ body: { padding: 0, overflow: 'hidden', height: '100%' }, content: { height: chatSize.height } }}
      >
        <div className="sla-ai-chat-resize-handle sla-ai-chat-resize-left" onMouseDown={startChatResize('width')} />
        <div className="sla-ai-chat-resize-handle sla-ai-chat-resize-bottom" onMouseDown={startChatResize('height')} />
        <div className="sla-ai-chat-resize-handle sla-ai-chat-resize-corner" onMouseDown={startChatResize('both')} />
        <div className="sla-ai-chat-resizable-panel">
          <div className="sla-ai-chat-history-panel">
            <Space wrap style={{ marginBottom: 8 }}>
              {(chatCapabilities?.can_view_all || chatScope === 'all') && <Select<TicketChatScope> aria-label="Ticket chat history scope" value={chatScope}
                disabled={chatLoading || chatHistoryLoading || chatMoreLoading} style={{ minWidth: 175 }}
                options={[{ value: 'mine', label: 'My chat history' }, { value: 'all', label: 'All users (read-only)' }]}
                onChange={(scope) => void loadChatHistory(scope)} />}
              <Button size="small" disabled={chatLoading || chatHistoryLoading || chatMoreLoading} onClick={() => void loadChatHistory()}>Reload history</Button>
            </Space>
            {chatScope === 'all' && <Alert type="info" showIcon message="Read-only review. Switch to My chat history to continue. Older messages without recorded ownership are labelled unknown." style={{ marginBottom: 8 }} />}
            {chatHistoryError && <Alert type="error" showIcon message={chatHistoryError} style={{ marginBottom: 8 }} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Button className="sla-chat-load-earlier-btn" size="small" onClick={loadMoreChatHistory} loading={chatMoreLoading} disabled={!chatNextBefore || chatHistoryLoading || chatLoading}>
                Load earlier
              </Button>
              <Button
                size="small"
                danger
                disabled={chatScope !== 'mine' || chatCapabilities?.can_clear !== true || chatLoading || chatHistoryLoading || chatMoreLoading}
                onClick={async () => {
                  if (chatScope !== 'mine' || chatCapabilities?.can_clear !== true || chatLoading || chatHistoryLoading || chatMoreLoading) return;
                  const sequence = ++chatHistorySequence.current;
                  setChatHistoryLoading(true);
                  try {
                    await clearSlaTicketAiChatHistory(ticket.ticket_number);
                    if (sequence !== chatHistorySequence.current) return;
                    setChatMessages([{ role: 'system', content: buildChatContext(), hidden: true }]);
                    setChatNextBefore(null);
                  } catch {
                    if (sequence === chatHistorySequence.current) message.error('Failed to clear chat history');
                  } finally {
                    if (sequence === chatHistorySequence.current) setChatHistoryLoading(false);
                  }
                }}
              >
                Clear my history
              </Button>
            </div>
            {chatHistoryLoading ? (
              <Typography.Text type="secondary">Loading chat history...</Typography.Text>
            ) : chatMessages.filter((m) => !m.hidden).length ? (
              <List
                dataSource={chatMessages.filter((m) => !m.hidden)}
                  renderItem={(msg, idx) => (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {msg.role === 'user' ? chatScope === 'all' ? msg.owner : 'You' : 'Assistant'}
                        {chatScope === 'all' && msg.role !== 'user' && ` · ${msg.owner || 'Unknown legacy owner'}`}
                      </Typography.Text>
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                        {msg.content}
                      </div>
                      {msg.role === 'assistant' && msg.trace?.length ? (
                        <div style={{ marginTop: 10 }}>
                          <Card
                            size="small"
                            title="Process"
                            extra={(
                              <Button size="small" type="link" onClick={() => {
                                setCollapsedTraces((prev) => ({
                                  ...prev,
                                  [idx]: !prev[idx],
                                }));
                              }}>
                                {collapsedTraces[idx] ? 'Expand' : 'Collapse'}
                              </Button>
                            )}
                          >
                            {collapsedTraces[idx] ? (
                              <div className="sla-ai-trace-collapsed">Collapsed</div>
                            ) : (
                            <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {msg.trace.map((evt: any, stepIdx: number) => {
                                if (evt.type === 'iteration_start') {
                                  return (
                                    <div key={`it_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-iteration">
                                      <div style={{ fontWeight: 600 }}>Iteration {evt.iteration}</div>
                                    </div>
                                  );
                                }
                                if (evt.type === 'model_call') {
                                  return (
                                    <div key={`mc_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-model">
                                      <div style={{ fontWeight: 600 }}>Calling AI model...</div>
                                    </div>
                                  );
                                }
                                if (evt.type === 'tool_calls_detected') {
                                  return (
                                    <div key={`tc_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-detected">
                                      Detected {evt.count || 0} tool call(s)
                                    </div>
                                  );
                                }
                                if (evt.type === 'tool_call') {
                                  return (
                                    <div key={`call_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-call">
                                      <div style={{ fontWeight: 600 }}>Call tool: {evt.tool}</div>
                                      <div className="sla-ai-trace-meta">{evt.endpoint || evt.source}</div>
                                      <pre className="sla-ai-trace-pre">
{JSON.stringify(evt.arguments || {}, null, 2)}
                                      </pre>
                                    </div>
                                  );
                                }
                                if (evt.type === 'tool_result') {
                                  return (
                                    <div key={`res_${stepIdx}`} className={evt.success ? "sla-ai-trace-card sla-ai-trace-card-success" : "sla-ai-trace-card sla-ai-trace-card-error"}>
                                      <div style={{ fontWeight: 600 }}>Tool {evt.tool} {evt.success ? 'completed' : 'failed'}</div>
                                      <pre className="sla-ai-trace-pre">
{String(evt.content || '')}
                                      </pre>
                                      {evt.execution_id ? (
                                        <div className="sla-ai-trace-meta">
                                          Execution ID: {evt.execution_id}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                }
                                if (evt.type === 'assistant_response') {
                                  return (
                                    <div key={`ar_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-summary">
                                      <div style={{ fontWeight: 600 }}>Analysis summary</div>
                                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{evt.content}</div>
                                    </div>
                                  );
                                }
                                if (evt.type === 'analysis_summary') {
                                  return (
                                    <div key={`as_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-thinking">
                                      <div style={{ fontWeight: 600 }}>AI thinking</div>
                                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{evt.content}</div>
                                    </div>
                                  );
                                }
                                if (evt.type === 'model_error') {
                                  return (
                                    <div key={`err_${stepIdx}`} className="sla-ai-trace-card sla-ai-trace-card-error">
                                      Model error: {evt.error}
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                            )}
                          </Card>
                        </div>
                      ) : null}
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No messages yet" />
            )}
          </div>
          {aiModelSelector}
          <Input.TextArea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type your message..."
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={chatLoading || !chatCanContinue}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button disabled={chatLoading || !chatCanContinue} onClick={() => setChatMessages([{ role: 'system', content: buildChatContext(), hidden: true }])}>
              Reset Context
            </Button>
            <Space>
              <Button onClick={() => setChatOpen(false)}>Close</Button>
              <Button type="primary" onClick={sendChat} loading={chatLoading} disabled={!chatInput.trim() || !aiModelReady || !chatCanContinue}>
                Send
              </Button>
            </Space>
          </div>
        </div>
      </Modal>
    </div>
  );
}
