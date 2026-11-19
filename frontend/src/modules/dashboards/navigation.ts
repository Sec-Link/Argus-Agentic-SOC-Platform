import type { MonitoringPlatform } from '../../types';

export type DashboardTab = 'overview' | 'coverage';

export const dashboardPlatform = (value: string | null): MonitoringPlatform => value === 'splunk' ? 'splunk' : 'elk';

export function dashboardHref(pathname: string, query: string, tab: DashboardTab, platform: MonitoringPlatform): string {
  const params = new URLSearchParams(query);
  params.set('platform', platform);
  if (tab === 'coverage') params.set('tab', 'coverage');
  else params.delete('tab');
  return `${pathname}?${params.toString()}`;
}
