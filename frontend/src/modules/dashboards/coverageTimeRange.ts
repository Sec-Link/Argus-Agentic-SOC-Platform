import type { SplunkCoverageTimeRange } from 'types';

export const COVERAGE_TIME_RANGES: Array<{ value: SplunkCoverageTimeRange; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
  { value: '7d', label: '7 days' },
  { value: 'all', label: 'All time' },
];

export function coverageWindowLabel(days: number): string {
  if (days === 0) return 'All time';
  if (days === 1) return 'Last 24 hours';
  if (days === 2) return 'Last 48 hours';
  return `Last ${days} days`;
}
