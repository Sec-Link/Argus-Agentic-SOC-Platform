import type { PageChatContext } from '../../services/aiAssistant';
import type { ConversationDetail, ConversationSummary } from '../../services/aiAssistant/conversations';
import { applyChatEvent, finishChatTurn, type ChatMessage } from './chatState';

export type HistoryMessage = ChatMessage & { pageContext?: PageChatContext | null };

export function canContinueConversation(conversation: ConversationSummary | null): boolean {
  return !conversation || (conversation.can_continue === true && conversation.readonly === false && !conversation.active);
}

export function hasConfirmedSavedTurn(conversation: ConversationDetail, requestId: string | undefined, saveFailed = false): boolean {
  return !saveFailed && !conversation.active && !!requestId
    && conversation.turns.some((turn) => turn.request_id === requestId && turn.status !== 'running');
}

/** Restore public evidence only; a saved approval is never an executable action. */
export function restoreConversation(conversation: ConversationDetail): HistoryMessage[] {
  return conversation.turns.flatMap((saved): HistoryMessage[] => {
    let response: ChatMessage = { role: 'assistant', content: '', steps: [], status: 'running', requestId: saved.request_id };
    for (const event of saved.events) response = applyChatEvent(response, event);
    response = finishChatTurn({ ...response, content: saved.response || response.content }, saved.status === 'running' ? 'stopped' : saved.status);
    if (saved.status === 'running') response.phase = 'This saved execution is still active. Refresh to check its result.';
    return [
      { role: 'user', content: saved.message, pageContext: saved.page_context },
      response,
    ];
  });
}

export function conversationError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return 'Your session has expired. Sign in again to access your conversations.';
  if (status === 403) return 'You do not have permission to access these conversations.';
  if (status === 404) return 'This conversation is unavailable. Refresh the history list.';
  if (status === 409) return 'This conversation changed or is still running. Refresh it before continuing.';
  if (status === 413) return 'Conversation history has reached its storage limit. Start a new conversation, or delete unneeded conversations if the history list is full.';
  return 'Could not update conversation history. Check your connection and try again.';
}
