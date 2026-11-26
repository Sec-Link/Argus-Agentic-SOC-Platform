'use client';

import React from 'react';
import { ThoughtChain, type ThoughtChainItem } from '@ant-design/x';
import { Clock3, Wrench } from 'lucide-react';
import type { TicketInvestigationSession } from 'services/tickets';
import layoutStyles from './TicketLayout.module.css';

type Receipt = NonNullable<TicketInvestigationSession['tool_receipts']>[number];
type ToolStep = { key: string; name: string; status: string; arguments?: unknown; result?: unknown; createdAt?: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const preview = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function TicketInvestigationEvents({ events = [] }: { events?: TicketInvestigationSession['runtime_events'] }) {
  const [expandedKeys, setExpandedKeys] = React.useState<string[]>([]);
  return events.length ? <ThoughtChain className={layoutStyles.ticketToolChain} size="small" collapsible={{ expandedKeys, onExpand: setExpandedKeys }}
    items={[...events].reverse().map((event) => ({ key: event.id, title: event.content
      ? <button type="button" className={layoutStyles.ticketToolTitle} aria-expanded={expandedKeys.includes(event.id)}>{event.title}</button> : event.title,
      description: `${event.event_type} · ${event.created_at}`, icon: <Clock3 size={14} />,
      status: event.event_type.endsWith('_failed') ? 'error' as const : undefined,
      content: event.content ? <div className={layoutStyles.ticketToolDetails}><pre>{event.content}</pre></div> : undefined,
    }))} /> : null;
}

export function TicketInvestigationTools({ trace = [], receipts = [] }: { trace?: unknown[]; receipts?: Receipt[] }) {
  const [expandedKeys, setExpandedKeys] = React.useState<string[]>([]);
  const steps = new Map<string, ToolStep>();
  const aliases = new Map<string, string>();
  for (const [index, entry] of trace.entries()) {
    const item = record(entry);
    if (!['tool_call', 'tool_result', 'max_iterations', 'error'].includes(text(item.type))) continue;
    const identities = [text(item.execution_id), text(item.call_id)].filter(Boolean);
    const key = identities.map((id) => aliases.get(id)).find(Boolean) || identities[0] || `event-${index}`;
    identities.forEach((id) => aliases.set(id, key));
    const step = steps.get(key) || { key, name: text(item.tool) || (item.type === 'max_iterations' ? 'Execution limit reached' : 'Execution error'), status: 'No result recorded' };
    if (item.type === 'tool_call') step.arguments = item.arguments;
    else {
      step.result = item.content ?? item.error ?? entry;
      step.status = item.type !== 'tool_result' || item.success === false ? 'failed' : item.success === true ? 'completed' : 'Result recorded';
    }
    steps.set(key, step);
  }
  for (const receipt of receipts) {
    const identities = [receipt.execution_id, receipt.call_id].filter(Boolean);
    const key = identities.map((id) => aliases.get(id)).find(Boolean) || receipt.id;
    identities.forEach((id) => aliases.set(id, key));
    const step = steps.get(key);
    steps.set(key, { key, name: receipt.tool_name, status: receipt.status,
      arguments: Object.keys(receipt.arguments || {}).length ? receipt.arguments : step?.arguments,
      result: receipt.result_preview || step?.result, createdAt: receipt.created_at,
    });
  }
  const items: ThoughtChainItem[] = [...steps.values()].map((step) => ({
    key: step.key, title: <button type="button" className={layoutStyles.ticketToolTitle} aria-expanded={expandedKeys.includes(step.key)}>{step.name}</button>, description: step.status,
    icon: <Wrench size={14} />,
    status: step.status === 'completed' ? 'success' : ['failed', 'error'].includes(step.status) ? 'error' : ['running', 'queued', 'pending'].includes(step.status) ? 'pending' : undefined,
    content: <div className={layoutStyles.ticketToolDetails}>
      {step.arguments !== undefined ? <><strong>Arguments</strong><pre>{preview(step.arguments)}</pre></> : null}
      {step.result !== undefined ? <><strong>Result</strong><pre>{preview(step.result)}</pre></> : <p>No result was recorded for this call.</p>}
      {step.createdAt ? <time dateTime={step.createdAt}>{step.createdAt}</time> : null}
    </div>,
  }));
  return items.length ? <ThoughtChain className={layoutStyles.ticketToolChain} size="small" collapsible={{ expandedKeys, onExpand: setExpandedKeys }} items={items} /> : null;
}
