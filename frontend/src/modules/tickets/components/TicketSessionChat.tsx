'use client';

import React from 'react';
import { Actions, Bubble, Conversations, Prompts, Sender, Suggestion, type ConversationsProps } from '@ant-design/x';
import { Button, Input } from 'antd';
import { Check, Copy, Lightbulb, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import layoutStyles from './TicketLayout.module.css';

type NavigationProps = Pick<ConversationsProps, 'items' | 'activeKey' | 'onActiveChange'>;

export function TicketSessionNavigation({ items = [], activeKey = '', onActiveChange }: NavigationProps) {
  return <div onKeyDown={(event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-session-key]');
    const key = item?.dataset.sessionKey;
    if (key && items.some((entry) => entry.key === key && !entry.disabled)) {
      event.preventDefault();
      onActiveChange?.(key);
    }
  }}>
    <Conversations className={layoutStyles.ticketSessionConversations} activeKey={activeKey} onActiveChange={onActiveChange}
      items={items.map((item) => ({ ...item, role: 'button', tabIndex: item.disabled ? -1 : 0,
        'data-session-key': item.key, 'aria-pressed': item.key === activeKey,
      }))} />
  </div>;
}

type MessageProps = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  footer: React.ReactNode;
  children?: React.ReactNode;
};

export function TicketSessionMessage({ role, content, footer, children }: MessageProps) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  return (
    <Bubble
      className={`${layoutStyles.ticketSessionBubble} ${role === 'user' ? layoutStyles.ticketSessionBubbleUser : role === 'system' ? layoutStyles.ticketSessionBubbleSystem : ''}`}
      placement={role === 'user' ? 'end' : 'start'}
      variant={role === 'system' ? 'outlined' : 'filled'}
      classNames={{ content: layoutStyles.ticketSessionBubbleContent, footer: layoutStyles.ticketSessionBubbleFooter }}
      content={<>
        {role === 'assistant' ? <div className={layoutStyles.ticketSessionMarkdown}>
          {/* Model output is untrusted: do not render raw HTML or fetch embedded images. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
            a: ({ href, children: label }) => <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>,
            img: ({ alt }) => <span>{alt || 'Image'}</span>,
          }}>{content}</ReactMarkdown>
        </div> : <div className={layoutStyles.ticketChatMessageText}>{content}</div>}
        {children}
      </>}
      footer={<div className={layoutStyles.ticketSessionMessageFooter}>
        {footer}
        {content ? <Actions rootClassName={layoutStyles.ticketSessionActions} items={[{
          key: 'copy', label: copyState === 'copied' ? 'Copied' : 'Copy message',
          icon: <button type="button" aria-label={copyState === 'copied' ? 'Copied' : 'Copy message'}>
            {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
          </button>,
          onItemClick: () => void copyMessage(),
        }]} /> : null}
        {copyState === 'failed' ? <span role="status">Could not copy. Select the message text to copy it.</span> : null}
      </div>}
    />
  );
}

const SessionInput = React.forwardRef<React.ElementRef<typeof Input.TextArea>, React.ComponentProps<typeof Input.TextArea>>(
  (props, ref) => <Input.TextArea {...props} ref={ref} maxLength={4000} />,
);
SessionInput.displayName = 'TicketSessionInput';
const senderComponents = { input: SessionInput };

type SenderProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  hint: string;
  disabled: boolean;
  loading: boolean;
  submitDisabled?: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  compact?: boolean;
  role?: string;
  onSideQuestion?: () => void;
};

export function TicketSessionSender({ value, onChange, onSubmit, placeholder, hint, disabled, loading, submitDisabled, onCancel, cancelDisabled, compact, role, onSideQuestion }: SenderProps) {
  const senderRef = React.useRef<React.ElementRef<typeof Sender>>(null);
  const [suggestionOpen, setSuggestionOpen] = React.useState(false);
  const [promptsOpen, setPromptsOpen] = React.useState(false);
  const commands = [
    { key: 'summary', label: '/summary', description: 'Summarize the saved record', text: 'Summarize the saved record for this Agent. Separate verified evidence from unresolved questions.' },
    { key: 'gaps', label: '/gaps', description: 'List missing evidence', text: 'List the unresolved evidence gaps in the saved investigation record and the sources needed to address them.' },
    ...(role === 'worker' ? [{ key: 'rerun', label: '/rerun', description: 'Draft a Worker retry request', text: '/rerun ' }] : []),
    ...(onSideQuestion ? [{ key: 'btw', label: '/btw', description: 'Open an independent Side Question', text: '' }] : []),
  ];
  const suggestions = commands.filter((item) => item.label.startsWith(value.trim().toLowerCase()));
  const showSuggestions = suggestionOpen && !disabled && !loading && suggestions.length > 0;
  const quickPrompts = [
    { key: 'summary', label: role === 'reporter' ? 'Summarize report' : 'Summarize evidence', text: commands[0].text },
    { key: 'gaps', label: 'Evidence gaps', text: commands[1].text },
    ...(role === 'main' ? [{ key: 'scope', label: 'Define investigation scope', text: 'Define the investigation goals, scope and acceptance criteria from this ticket, preserving the distinction between alert-reported claims and independently verified evidence.' }] : []),
    ...(role === 'planner' ? [{ key: 'plan', label: 'Explain current plan', text: 'Explain the saved investigation plan, its dependencies and how the current Worker results affect the next steps.' }] : []),
    ...(role === 'worker' ? [{ key: 'follow-up', label: 'Draft follow-up', text: 'Review this Worker’s saved result and evidence gaps. Assess whether a distinct, feasible follow-up is available, preserving existing evidence and receipts.' }] : []),
  ];
  React.useEffect(() => {
    setSuggestionOpen(!disabled && /^\/[a-z]*$/i.test(value));
  }, [disabled, value]);
  const fillDraft = (text: string) => {
    onChange(text);
    setPromptsOpen(false);
    setSuggestionOpen(false);
    senderRef.current?.focus();
  };
  const canSubmit = !disabled && !loading && !submitDisabled && Boolean(value.trim()) && value.length <= 4000;
  return (
    <Suggestion block rootClassName={layoutStyles.ticketSessionSuggestion} open={showSuggestions} onOpenChange={setSuggestionOpen}
      items={suggestions.map((item) => ({ value: item.key, label: item.label, extra: item.description }))}
      onSelect={(key) => {
        const item = commands.find((command) => command.key === key);
        if (!item) return;
        if (key === 'btw') { fillDraft(''); onSideQuestion?.(); }
        else fillDraft(item.text);
      }}>
    {({ onKeyDown }) => (
    <Sender
      ref={senderRef}
      className={layoutStyles.ticketSessionSender}
      components={senderComponents}
      value={value}
      onChange={(text) => {
        // Reopen after filtering so Suggestion resets its keyboard selection to a visible item.
        setSuggestionOpen(false);
        onChange(text);
      }}
      onKeyDown={(event) => { if (!event.nativeEvent.isComposing) onKeyDown(event); }}
      onSubmit={() => { if (canSubmit && !showSuggestions) onSubmit(); }}
      submitType="enter"
      placeholder={placeholder}
      disabled={disabled}
      loading={loading}
      autoSize={{ minRows: compact ? 2 : 3, maxRows: compact ? 5 : 6 }}
      header={promptsOpen ? <Prompts className={layoutStyles.ticketSessionPrompts} wrap aria-label="Quick prompts"
        items={quickPrompts.map(({ key, label }) => ({ key,
          label: <button type="button" className={layoutStyles.ticketPromptButton} disabled={disabled || loading}>{label}</button>,
          disabled: disabled || loading,
        }))}
        onItemClick={({ data }) => {
          if (disabled || loading) return;
          const prompt = quickPrompts.find((item) => item.key === data.key);
          if (prompt) fillDraft(prompt.text);
        }} /> : undefined}
      actions={false}
      footer={({ components }) => <div className={layoutStyles.ticketSessionComposerFoot}>
        <span>{hint}</span>
        <Button type="text" size="small" icon={<Lightbulb size={14} />} disabled={disabled || loading} aria-expanded={promptsOpen}
          onClick={() => setPromptsOpen(!promptsOpen)}>Quick prompts</Button>
        {loading
          ? onCancel
            ? <Button size="small" onClick={onCancel} disabled={cancelDisabled} aria-label="Stop Side Question">Stop</Button>
            : <Button type="primary" size="small" loading disabled>Send</Button>
          : <components.SendButton size="small" shape="default" disabled={!canSubmit} icon={<Send size={14} />} aria-label="Send message">Send</components.SendButton>}
      </div>}
    />
    )}
    </Suggestion>
  );
}
