import client from '../../api';
import type { PageChatContext } from '../../api';
import type { PageChatEvent } from './stream';

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  revision: number;
  active: boolean;
  owner: { id: number; username: string };
  readonly: boolean;
  can_continue: boolean;
  can_manage: boolean;
}

export interface ConversationTurn {
  id: string;
  request_id: string;
  message: string;
  page_context: PageChatContext | null;
  agent_names: string[];
  context_options: { share_page: boolean; include_content: boolean };
  events: PageChatEvent[];
  response: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  created_at: string;
  finished_at: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  turns: ConversationTurn[];
}

export interface ConversationPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ConversationSummary[];
  can_view_all: boolean;
}

export interface ConversationFilters {
  scope?: 'mine' | 'all';
  owner?: string;
  owner_id?: number;
}

const base = '/ai-assistant/conversations/';

export async function listConversations(page = 1, signal?: AbortSignal, filters: ConversationFilters = {}): Promise<ConversationPage> {
  return (await client.get(base, { params: { page, page_size: 20, ...filters }, signal })).data;
}

export async function createConversation(signal?: AbortSignal): Promise<ConversationSummary> {
  return (await client.post(base, {}, { signal })).data;
}

export async function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return (await client.get(`${base}${encodeURIComponent(id)}/`, { signal })).data;
}

export async function renameConversation(id: string, title: string): Promise<ConversationSummary> {
  return (await client.patch(`${base}${encodeURIComponent(id)}/`, { title })).data;
}

export async function deleteConversation(id: string): Promise<void> {
  await client.delete(`${base}${encodeURIComponent(id)}/`);
}
