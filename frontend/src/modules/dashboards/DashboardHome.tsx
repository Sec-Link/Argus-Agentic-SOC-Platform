import React, { useEffect, useState } from 'react';
import { Pie } from '@ant-design/charts';
import { Column } from '@ant-design/plots';
import { Card, Statistic, Row, Col, Space, Select, Button, Modal, message, Spin, Table, Empty } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchDashboard } from 'services/alerts';
import type { DashboardData } from 'types';

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  // keep last successful data to avoid UI blanking during reloads
  const [displayData, setDisplayData] = useState<DashboardData | null>(null);
  const failuresRef = React.useRef<number>(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [activePanelRefresh, setActivePanelRefresh] = useState<string | null>(null);

  const CACHE_KEY = 'siem_dashboard_cache_v1';
  const POLL_INTERVAL_MS = 10 * 1000;
  const [loading, setLoading] = useState(false);
  const [trendGroupBy, setTrendGroupBy] = useState<'hour' | 'day'>('hour');
  const [scoreGroupBy, setScoreGroupBy] = useState<'hour' | 'day'>('hour');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  // Debug helpers to inspect raw displayData when trends show no data
  const [debugModalVisible, setDebugModalVisible] = useState(false);
  const [debugKey, setDebugKey] = useState<string | null>(null);
  const openDebugModal = (key: string | null) => { setDebugKey(key); setDebugModalVisible(true); };
  const getDebugContent = () => {
    if (!displayData) return 'No displayData (dashboard failed to load)';
    if (debugKey === 'alert_trend') return JSON.stringify({ alert_trend: displayData.alert_trend, alert_trend_series: displayData.alert_trend_series }, null, 2);
    if (debugKey === 'alert_score_trend') return JSON.stringify({ alert_score_trend: displayData.alert_score_trend, alert_score_trend_series: displayData.alert_score_trend_series }, null, 2);
    return JSON.stringify(displayData, null, 2);
  };

  const bucketizeTimeSeries = (
    series: Record<string, number> | undefined,
    unit: 'hour' | 'day'
  ) => {
    if (!series) return [] as Array<{ time: string; value: number }>;
    const acc: Record<string, number> = {};
    for (const [k, v] of Object.entries(series)) {
      if (!k) continue;
      // Backend hour keys may look like:
      // - 2025-12-16T12
      // - 2025-12-16T12+00:00
      // - 2025-12-16T12:00:00+00:00
      // Normalize to stable "YYYY-MM-DD" or "YYYY-MM-DDTHH" buckets.
      let key = unit === 'day' ? k.slice(0, 10) : k.slice(0, 13);
      if (key.endsWith(':')) key = key.slice(0, -1);
      acc[key] = (acc[key] || 0) + (Number(v) || 0);
    }
    return Object.entries(acc)
      .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
      .map(([time, value]) => ({ time, value }));
  };

  const bucketizeStackedSeries = (
    rows: Array<{ time: string; series: string; value: number }> | undefined,
    unit: 'hour' | 'day'
  ) => {
    if (!rows || rows.length === 0) return [] as Array<{ time: string; series: string; value: number }>;
    const acc: Record<string, number> = {};
    for (const r of rows) {
      if (!r?.time) continue;
      let timeKey = unit === 'day' ? r.time.slice(0, 10) : r.time.slice(0, 13);
      if (timeKey.endsWith(':')) timeKey = timeKey.slice(0, -1);
      const seriesKey = r.series || 'unknown';
      const k = `${timeKey}__${seriesKey}`;
      acc[k] = (acc[k] || 0) + (Number(r.value) || 0);
    }
    return Object.entries(acc)
      .map(([k, value]) => {
        const idx = k.indexOf('__');
        return { time: k.slice(0, idx), series: k.slice(idx + 2), value };
      })
      .sort((a, b) => (a.time > b.time ? 1 : a.time < b.time ? -1 : a.series.localeCompare(b.series)));
  };

  const hasEntries = (obj?: Record<string, unknown> | null) => !!obj && Object.keys(obj).length > 0;
  const isDarkTheme = themeMode === 'dark';
  const chartTextColor = isDarkTheme ? '#dbe6ff' : '#1f2d3d';
  const chartSubtleTextColor = isDarkTheme ? '#e7efff' : '#4b5b70';

  const load = async (opts?: { panelKey?: string; showGlobalSpinner?: boolean }) => {
    const panelKey = opts?.panelKey;
    const showGlobalSpinner = opts?.showGlobalSpinner ?? true;
    const isBackground = !!displayData;
    if (showGlobalSpinner && isBackground) {
      setRefreshing(true);
    } else if (showGlobalSpinner) {
      setLoading(true);
    }
    if (panelKey) setActivePanelRefresh(panelKey);
    try {
      let res = await fetchDashboard();
      setData(res);
      // only update the displayData when we successfully fetched something
      if (res) {
        setDisplayData(res);
        // debug: log keys present in response (helpful to check if trend fields exist)
        try { console.debug('Dashboard load: available keys', Object.keys(res || {})); } catch (e) {}
        // cache for faster next-loads
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: res }));
        } catch (err) {
          // ignore storage errors
        }
        failuresRef.current = 0;
      }
    } catch (e:any) {
      console.error('Dashboard load error', e);
      // light failure backoff: increment failures and skip next few polls if failing repeatedly
      failuresRef.current = (failuresRef.current || 0) + 1;
      const failCount = failuresRef.current;
      // only show a visible error when we have no cached data (initial load)
      if (!displayData && failCount <= 1) {
        message.error('Failed to load dashboard data');
      }
      // if we exceed 5 failures, schedule a delayed retry
      if (failCount > 5) {
        setTimeout(() => load(), Math.min(60000, 2000 * Math.pow(2, failCount - 5)));
      }
    } finally {
      if (showGlobalSpinner) {
        if (isBackground) setRefreshing(false);
        else setLoading(false);
      }
      if (panelKey) setActivePanelRefresh(null);
    }
  };

  // small hook to animate numbers smoothly between updates
  function useAnimatedNumber(target: number, duration = 500) {
    const [value, setValue] = React.useState(target);
    const rafRef = React.useRef<number | null>(null);
    React.useEffect(() => {
      const start = value;
      const change = target - start;
      if (change === 0) return;
      const startTime = performance.now();
      function animate(now: number) {
        const elapsed = now - startTime;
        if (elapsed >= duration) {
          setValue(target);
          return;
        }
        setValue(start + change * (elapsed / duration));
        rafRef.current = requestAnimationFrame(animate);
      }
      rafRef.current = requestAnimationFrame(animate);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current!);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);
    return Math.round(value);
  }

  useEffect(() => {
    // on mount only: read cache and perform initial loads and polling
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: DashboardData };
        // accept cache younger than 2 minutes
        if (Date.now() - parsed.ts < 2 * 60 * 1000) {
          setDisplayData(parsed.data);
        }
      }
    } catch (err) {
      // ignore cache errors
    }

    // initial load
    load();

    const syncTheme = () => {
      try {
        setThemeMode(localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light');
      } catch {
        setThemeMode('light');
      }
    };
    const onThemeChanged = () => syncTheme();
    window.addEventListener('siem_theme_changed', onThemeChanged as EventListener);
    window.addEventListener('storage', onThemeChanged);

    // Polling: only poll when the tab is visible to avoid extra work
    const intervalFn = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };
    const id = setInterval(intervalFn, POLL_INTERVAL_MS);

    // also reload once when tab becomes visible
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('siem_theme_changed', onThemeChanged as EventListener);
      window.removeEventListener('storage', onThemeChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryBreakdown = displayData?.category_breakdown;
  const severityDistribution = displayData?.severity_distribution;
  const panelRefresh = (panelKey: string, ariaLabel = 'Refresh panel') => (
    <Button
      size="small"
      type="text"
      icon={<ReloadOutlined />}
      onClick={() => load({ panelKey, showGlobalSpinner: false })}
      loading={activePanelRefresh === panelKey}
      aria-label={ariaLabel}
    />
  );

  return (
  <>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginTop: 0, marginBottom: 6, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Dashboard Overview</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {refreshing && <Spin size="small" style={{ marginLeft: 12 }} />}
        </div>
      </Space>

      {/* Keep 5 KPI cards in one row with equal widths that auto-shrink together. */}
      <div style={{ marginTop: 10, width: '100%', paddingBottom: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 16, width: '100%' }}>
          <Card title="Alerts in Last Hour" extra={panelRefresh('kpi_last_hour', 'Refresh Alerts in Last Hour')}>
            <Statistic
              value={useAnimatedNumber((displayData?.recent_1h_alerts ?? 0) as number, 600)}
              loading={!displayData && loading}
              valueStyle={{ transition: 'all 0.5s cubic-bezier(.08,.82,.17,1)' }}
            />
          </Card>
          <Card title="Total Alerts" extra={panelRefresh('kpi_total_alerts', 'Refresh Total Alerts')}>
            <Statistic
              value={useAnimatedNumber(displayData?.total ?? 0, 600)}
              loading={!displayData && loading}
              valueStyle={{ transition: 'all 0.5s cubic-bezier(.08,.82,.17,1)' }}
            />
          </Card>
          <Card title="Data Sources" extra={panelRefresh('kpi_data_sources', 'Refresh Data Sources')}>
            <Statistic
              value={useAnimatedNumber((displayData?.data_source_count ?? 0) as number, 600)}
              loading={!displayData && loading}
              valueStyle={{ transition: 'all 0.5s cubic-bezier(.08,.82,.17,1)' }}
            />
          </Card>
          <Card title="Enabled SIEM Rules" extra={panelRefresh('kpi_enabled_rules', 'Refresh Enabled SIEM Rules')}>
            <Statistic
              value={useAnimatedNumber((displayData?.enabled_siem_rule_count ?? 0) as number, 600)}
              loading={!displayData && loading}
              valueStyle={{ transition: 'all 0.5s cubic-bezier(.08,.82,.17,1)' }}
            />
          </Card>
          <Card title="Detections (Last Hour)" extra={panelRefresh('kpi_detections_1h', 'Refresh Detections in Last Hour')}>
            <Statistic
              value={useAnimatedNumber((displayData?.siem_rule_detected_count_1h ?? 0) as number, 600)}
              loading={!displayData && loading}
              valueStyle={{ transition: 'all 0.5s cubic-bezier(.08,.82,.17,1)' }}
            />
          </Card>
        </div>
      </div>

      {/* Row 1: Pie#1 + Bar#1 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="Alert Category Breakdown" extra={panelRefresh('category_breakdown', 'Refresh Alert Category Breakdown')}>
            {hasEntries(categoryBreakdown) ? (
              <Pie
                key={`category-pie-${themeMode}`}
                data={Object.entries(categoryBreakdown as Record<string, number>).map(([type, value]) => ({ type, value }))}
                angleField="value"
                colorField="type"
                radius={0.8}
                height={320}
                padding={[12, 12, 72, 12]}
                label={false}
                legend={{
                  color: {
                    title: false,
                    position: 'bottom',
                    rowPadding: 8,
                    itemMarkerSize: 10,
                    itemLabelFill: chartTextColor,
                    itemValueFill: chartSubtleTextColor,
                  },
                }}
                tooltip={{
                  title: (d: any) => `${d?.type ?? ''}`,
                  items: [
                    (d: any) => ({ name: 'Count', value: String(d?.value ?? 0) }),
                  ],
                }}
              />
            ) : (
              <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="No category data" />
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          {displayData && (
            <Card
              title="Alert Trend"
              extra={
                <Space>
                  {panelRefresh('alert_trend', 'Refresh Alert Trend')}
                  <span style={{ color: chartTextColor }}>Group by</span>
                  <Select
                    size="small"
                    value={trendGroupBy}
                    onChange={(v) => setTrendGroupBy(v as 'hour' | 'day')}
                    style={{ width: 120 }}
                    options={[
                      { label: '1 hour', value: 'hour' },
                      { label: '1 day', value: 'day' },
                    ]}
                  />
                  <Button size="small" onClick={() => openDebugModal('alert_trend')}>View data</Button>
                </Space>
              }
            >
              {displayData?.alert_trend_series && displayData.alert_trend_series.length > 0 ? (
                <Column
                  data={bucketizeStackedSeries(displayData.alert_trend_series, trendGroupBy).map((r) => ({
                    time: r.time,
                    severity: r.series,
                    count: r.value,
                  }))}
                  xField="time"
                  yField="count"
                  colorField="severity"
                  stack={{
                    // bottom -> top
                    orderBy: (d: any) =>
                      ({ low: 0, medium: 1, high: 2, critical: 3, unknown: 4 } as any)[
                        String(d?.severity ?? 'unknown').toLowerCase()
                      ] ?? 99,
                  }}
                  scale={{
                    x: { type: 'band' },
                    color: {
                      domain: ['low', 'medium', 'high', 'critical', 'unknown'],
                      range: ['#1677ff', '#fadb14', '#fa8c16', '#ff4d4f', '#8c8c8c'],
                    },
                  }}
                  height={320}
                  label={false}
                  tooltip={{ showMarkers: false }}
                  axis={{
                    x: {
                      title: false,
                      labelFill: chartTextColor,
                      labelAutoRotate: true,
                      labelFormatter: (v: any) => {
                        const s = String(v ?? '');
                        // show timestamp under x-axis
                        if (s.includes('T')) return s.replace('T', ' ') + ':00';
                        return s;
                      },
                    },
                    y: { title: false, labelFill: chartTextColor },
                  }}
                  legend={{
                    color: {
                      title: false,
                      position: 'top',
                      itemLabelFill: chartTextColor,
                    },
                  }}
                />
              ) : (displayData?.alert_trend && Object.keys(displayData.alert_trend).length > 0) ? (
                <Column
                  data={bucketizeTimeSeries(displayData.alert_trend, trendGroupBy).map((d) => ({ time: d.time, count: d.value }))}
                  xField="time"
                  yField="count"
                  colorField="time"
                  legend={false}
                  height={320}
                  label={false}
                  tooltip={{ showMarkers: false }}
                  axis={{ x: false }}
                />
              ) : (
                <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty description="No trend data" />
                </div>
              )}
            </Card>
          )}
        </Col>
      </Row>

      {/* Row 2: Pie#2 + Bar#2 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="Alert Severity Distribution" extra={panelRefresh('severity_distribution', 'Refresh Alert Severity Distribution')}>
            {hasEntries(severityDistribution) ? (
              <Pie
                key={`severity-pie-${themeMode}`}
                data={Object.entries(severityDistribution as Record<string, number>).map(([type, value]) => ({ type, value }))}
                angleField="value"
                colorField="type"
                radius={0.8}
                height={320}
                padding={[12, 12, 72, 12]}
                label={false}
                legend={{
                  color: {
                    title: false,
                    position: 'bottom',
                    rowPadding: 8,
                    itemMarkerSize: 10,
                    itemLabelFill: chartTextColor,
                    itemValueFill: chartSubtleTextColor,
                  },
                }}
                tooltip={{
                  title: (d: any) => `${d?.type ?? ''}`,
                  items: [
                    (d: any) => ({ name: 'Count', value: String(d?.value ?? 0) }),
                  ],
                }}
              />
            ) : (
              <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="No severity data" />
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          {displayData && (
            <Card
              title="Alert Score Trend"
              extra={
                <Space>
                  {panelRefresh('alert_score_trend', 'Refresh Alert Score Trend')}
                  <span style={{ color: chartTextColor }}>Group by</span>
                  <Select
                    size="small"
                    value={scoreGroupBy}
                    onChange={(v) => setScoreGroupBy(v as 'hour' | 'day')}
                    style={{ width: 120 }}
                    options={[
                      { label: '1 hour', value: 'hour' },
                      { label: '1 day', value: 'day' },
                    ]}
                  />
                  <Button size="small" onClick={() => openDebugModal('alert_score_trend')}>View data</Button>
                </Space>
              }
            >
              {displayData?.alert_score_trend_series && displayData.alert_score_trend_series.length > 0 ? (
                <Column
                  data={bucketizeStackedSeries(displayData.alert_score_trend_series, scoreGroupBy).map((r) => ({
                    time: r.time,
                    severity: r.series,
                    score: r.value,
                  }))}
                  xField="time"
                  yField="score"
                  colorField="severity"
                  stack={{
                    // bottom -> top
                    orderBy: (d: any) =>
                      ({ low: 0, medium: 1, high: 2, critical: 3, unknown: 4 } as any)[
                        String(d?.severity ?? 'unknown').toLowerCase()
                      ] ?? 99,
                  }}
                  scale={{
                    x: { type: 'band' },
                    color: {
                      domain: ['low', 'medium', 'high', 'critical', 'unknown'],
                      range: ['#1677ff', '#fadb14', '#fa8c16', '#ff4d4f', '#8c8c8c'],
                    },
                  }}
                  height={320}
                  label={false}
                  tooltip={{ showMarkers: false }}
                  axis={{
                    x: {
                      title: false,
                      labelFill: chartTextColor,
                      labelAutoRotate: true,
                      labelFormatter: (v: any) => {
                        const s = String(v ?? '');
                        if (s.includes('T')) return s.replace('T', ' ') + ':00';
                        return s;
                      },
                    },
                    y: { title: false, labelFill: chartTextColor },
                  }}
                  legend={{
                    color: {
                      title: false,
                      position: 'top',
                      itemLabelFill: chartTextColor,
                    },
                  }}
                />
              ) : (displayData?.alert_score_trend && Object.keys(displayData.alert_score_trend).length > 0) ? (
                <Column
                  data={bucketizeTimeSeries(displayData.alert_score_trend, scoreGroupBy).map((d) => ({ time: d.time, score: d.value }))}
                  xField="time"
                  yField="score"
                  colorField="time"
                  legend={false}
                  height={320}
                  label={false}
                  tooltip={{ showMarkers: false }}
                  axis={{ x: false }}
                />
              ) : (
                <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty description="No trend data" />
                </div>
              )}
            </Card>
          )}
        </Col>
      </Row>

      {/* Tables (responsive) */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <Card
            title="Top Source 10 IP"
            extra={panelRefresh('top_source_ips', 'Refresh Top Source 10 IP')}
            styles={{ body: { padding: '8px 12px 12px' } }}
          >
            <Table
              size="small"
              pagination={false}
              tableLayout="fixed"
              rowKey={(r) => r.name}
              columns={[
                { title: 'IP', dataIndex: 'name', ellipsis: true },
                { title: 'Count', dataIndex: 'count', width: 90, align: 'right' as const },
              ]}
              dataSource={(displayData?.top_source_ips ?? []) as any}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card
            title="Top 10 Users"
            extra={panelRefresh('top_users', 'Refresh Top 10 Users')}
            styles={{ body: { padding: '8px 12px 12px' } }}
          >
            <Table
              size="small"
              pagination={false}
              tableLayout="fixed"
              rowKey={(r) => r.name}
              columns={[
                { title: 'User', dataIndex: 'name', ellipsis: true },
                { title: 'Count', dataIndex: 'count', width: 90, align: 'right' as const },
              ]}
              dataSource={(displayData?.top_users ?? []) as any}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card
            title="Top 10 Sources"
            extra={panelRefresh('top_sources', 'Refresh Top 10 Sources')}
            styles={{ body: { padding: '8px 12px 12px' } }}
          >
            <Table
              size="small"
              pagination={false}
              tableLayout="fixed"
              rowKey={(r) => r.name}
              columns={[
                { title: 'Source', dataIndex: 'name', ellipsis: true },
                { title: 'Count', dataIndex: 'count', width: 90, align: 'right' as const },
              ]}
              dataSource={(displayData?.top_sources ?? []) as any}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card
            title="Top 10 Rules"
            extra={panelRefresh('top_rules', 'Refresh Top 10 Rules')}
            styles={{ body: { padding: '8px 12px 12px' } }}
          >
            <Table
              size="small"
              pagination={false}
              tableLayout="fixed"
              rowKey={(r) => r.name}
              columns={[
                {
                  title: 'Rule',
                  dataIndex: 'name',
                  ellipsis: true,
                  render: (value: string) => (
                    <span style={{ display: 'inline-block', width: '100%', wordBreak: 'break-all' }}>{value}</span>
                  ),
                },
                { title: 'Count', dataIndex: 'count', width: 90, align: 'right' as const },
              ]}
              dataSource={(displayData?.top_rules ?? []) as any}
            />
          </Card>
        </Col>
      </Row>

      <Modal title={`Raw dashboard data ${debugKey ? ` - ${debugKey}` : ''}`} open={debugModalVisible} onCancel={() => setDebugModalVisible(false)} footer={<Button onClick={() => setDebugModalVisible(false)}>Close</Button>} width={800}>
        <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{getDebugContent()}</pre>
      </Modal>

    </>
  );
};

export default Dashboard;
