export const MIN_PAGE_WIDTH = 480;
export const MIN_CHAT_WIDTH = 360;
export const SPLIT_HANDLE_WIDTH = 8;

export function clampChatWidth(workspaceWidth: number, requestedWidth: number): number | null {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth < MIN_PAGE_WIDTH + MIN_CHAT_WIDTH + SPLIT_HANDLE_WIDTH) return null;
  const available = workspaceWidth - SPLIT_HANDLE_WIDTH;
  const width = Number.isFinite(requestedWidth) ? requestedWidth : available * 0.4;
  return Math.max(MIN_CHAT_WIDTH, Math.min(width, available - MIN_PAGE_WIDTH));
}
