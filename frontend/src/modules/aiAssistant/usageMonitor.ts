import type { ExecutionContent, MonitorPeriodUnit } from '../../services/aiAssistant/monitor';

export function parseMonitorPeriod(value: string, unit: MonitorPeriodUnit): number {
  const hours = { hour: 1, day: 24, week: 168 }[unit];
  const amount = Number(value);
  if (value.trim() !== value || !/^[0-9]+$/.test(value) || !Number.isSafeInteger(amount) || amount < 1 || !hours || amount * hours > 8760) {
    throw new Error('Enter a positive whole number covering at most 365 days (8,760 hours or 52 weeks).');
  }
  return amount;
}

export function formatEstimatedCost(value: string | null | undefined, currency: string): string {
  if (value == null) return 'Unavailable';
  const amount = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return `${currency} ${amount}`;
}

export function monitorErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You do not have permission to view the requested usage. Your own usage is available only to eligible signed-in users.';
  if (status === 400) return 'The filters are invalid. Use a period of at most 365 days and refresh your selections.';
  return 'Usage could not be loaded. Try refreshing.';
}

export function monitorDetailErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You do not have permission to view this call\'s request and response content.';
  if (status === 404) return 'This call is no longer available or is outside your access scope.';
  return 'Call details could not be loaded. Try again.';
}

export function formatExecutionContent(content: ExecutionContent): string | null {
  if (!content.available) return null;
  return typeof content.data === 'string' ? content.data : JSON.stringify(content.data, null, 2) ?? '';
}

export function executionContentUnavailable(reason?: string): string {
  if (reason === 'not_recorded') return 'This content was not recorded. Earlier calls may only have usage metadata.';
  if (reason === 'pending') return 'This call is still in progress. Refresh to check for its response.';
  if (reason === 'not_executed') return 'The call did not execute, so no response was recorded.';
  if (reason === 'permission_denied') return 'You do not have permission to view this content.';
  return 'No content is available for this call.';
}
