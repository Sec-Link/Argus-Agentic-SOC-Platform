export type TicketChatScope = 'mine' | 'all';

export interface TicketChatCapabilities {
  can_view_all: boolean;
  readonly: boolean;
  can_continue: boolean;
  can_clear: boolean;
}

export function canContinueTicketChat(scope: TicketChatScope, access: TicketChatCapabilities | null): boolean {
  return scope === 'mine' && access?.readonly === false && access.can_continue === true;
}
