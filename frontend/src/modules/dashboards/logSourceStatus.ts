export type SourceStatus = 'alerting' | 'unmonitored' | 'blind' | 'silent';

export const STATUS_META: Record<SourceStatus, { label: string; description: string }> = {
  alerting: { label: 'Alerting', description: 'Receiving logs and at least one enabled rule uses it.' },
  unmonitored: { label: 'Unmonitored', description: 'Receiving logs but no enabled rule uses it — a detection gap.' },
  blind: { label: 'Blind', description: 'An enabled rule uses it but no logs arrived in the window, so the rule cannot fire.' },
  silent: { label: 'Silent', description: 'No logs in the window and no enabled rule.' },
};

export const sourceStatus = (s: { docs: number; last_seen: string | null; enabled_rules: number }): SourceStatus => {
  const hasLogs = s.docs > 0 || !!s.last_seen;
  if (hasLogs) return s.enabled_rules > 0 ? 'alerting' : 'unmonitored';
  return s.enabled_rules > 0 ? 'blind' : 'silent';
};
