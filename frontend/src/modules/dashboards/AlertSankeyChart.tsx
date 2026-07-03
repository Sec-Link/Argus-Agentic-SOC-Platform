import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Card, Empty, Spin, Typography } from 'antd';
import { fetchDashboardSankeyStats } from 'services/dashboards';
import type { SankeyStats } from 'types';

interface Props {
  startTime?: string;
  endTime?: string;
}

const STAGE_COLORS: Record<string, string> = {
  'MITRE ATT&CK Framework': '#f7efe2',
  'Developed Use Cases': '#79b8a8',
  Alerts: '#f06b55',
  Resolution: '#f3a43b',
  'Event Level': '#ff6b5f',
};
const SANKEY_CHART_LEFT = 84;
const SANKEY_CHART_RIGHT = 88;

const getStoredThemeMode = (): 'light' | 'dark' => {
  // Theme lookup is defensive because dashboard pages may be rendered during Next build.
  if (typeof window === 'undefined') return 'light';
  try {
    return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const AlertSankeyChart: React.FC<Props> = ({ startTime, endTime }) => {
  const [stats, setStats] = useState<SankeyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(getStoredThemeMode);

  useEffect(() => {
    setLoading(true);
    fetchDashboardSankeyStats({ start_time: startTime, end_time: endTime })
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [startTime, endTime]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncTheme = () => setThemeMode(getStoredThemeMode());
    window.addEventListener('siem_theme_changed', syncTheme as EventListener);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('siem_theme_changed', syncTheme as EventListener);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  const isDarkTheme = themeMode === 'dark';
  const panelBg = isDarkTheme
    ? 'linear-gradient(135deg, #14342f 0%, #10251f 52%, #0d1c19 100%)'
    : 'linear-gradient(135deg, #eef6ff 0%, #f8fbff 48%, #edf4ff 100%)';
  const labelColor = isDarkTheme ? '#f7fbff' : '#1f2d3d';
  const mutedColor = isDarkTheme ? 'rgba(235, 247, 255, 0.72)' : 'rgba(31, 45, 61, 0.62)';

  const option = useMemo<EChartsOption>(() => {
    const labelOverflow = 'break' as const;
    // Pin each node to its intended column so ECharts doesn't float sinks
    // (nodes with no outgoing links) to the rightmost position.
    const STAGE_DEPTH: Record<string, number> = {
      'MITRE ATT&CK Framework': 0,
      'Developed Use Cases': 1,
      'Alerts': 2,
      'Resolution': 3,
      'Event Level': 4,
    };
    const nodes = (stats?.nodes ?? []).map((node) => ({
      ...node,
      depth: node.stage != null ? STAGE_DEPTH[node.stage] : undefined,
      itemStyle: {
        borderRadius: 8,
        shadowBlur: isDarkTheme ? 12 : 8,
        shadowColor: isDarkTheme ? 'rgba(0, 0, 0, 0.32)' : 'rgba(40, 77, 120, 0.16)',
      },
      label: {
        color: labelColor,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 16,
        overflow: labelOverflow,
        textBorderColor: isDarkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.7)',
        textBorderWidth: 2,
        width: 112,
      },
    }));
    const links = (stats?.links ?? []).map((link) => ({
      ...link,
      lineStyle: {
        color: 'source' as const,
        opacity: isDarkTheme ? 0.34 : 0.28,
        curveness: 0.58,
      },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: isDarkTheme ? 'rgba(8, 22, 20, 0.94)' : 'rgba(255,255,255,0.96)',
        borderColor: isDarkTheme ? 'rgba(125, 197, 177, 0.35)' : 'rgba(70, 120, 160, 0.16)',
        textStyle: { color: labelColor },
        formatter: (params: any) => {
          if (params?.dataType === 'edge') {
            return `${params.data.source}<br/>→ ${params.data.target}<br/><b>${params.data.value}</b> events`;
          }
          const stage = params?.data?.stage ? `<br/><span>${params.data.stage}</span>` : '';
          return `<b>${params?.name || ''}</b>${stage}`;
        },
      },
      series: [
        {
          type: 'sankey',
          data: nodes,
          links,
          // Reserve a wider source-column gutter so long attack labels do not clip.
          left: SANKEY_CHART_LEFT,
          right: SANKEY_CHART_RIGHT,
          top: 58,
          bottom: 24,
          nodeWidth: 20,
          nodeGap: 18,
          nodeAlign: 'justify',
          draggable: true,
          emphasis: { focus: 'adjacency' },
          // ECharts Sankey uses curveness on link lineStyle to create smooth organic flows.
          lineStyle: { color: 'source', opacity: isDarkTheme ? 0.34 : 0.28, curveness: 0.58 },
          label: { color: labelColor, fontSize: 12, fontWeight: 700, lineHeight: 16, overflow: labelOverflow, width: 112 },
          levels: [
            { depth: 0, itemStyle: { color: STAGE_COLORS['MITRE ATT&CK Framework'] } },
            { depth: 1, itemStyle: { color: STAGE_COLORS['Developed Use Cases'] } },
            { depth: 2, itemStyle: { color: STAGE_COLORS.Alerts } },
            { depth: 3, itemStyle: { color: STAGE_COLORS.Resolution } },
            { depth: 4, itemStyle: { color: STAGE_COLORS['Event Level'] } },
          ],
        },
      ],
    };
  }, [isDarkTheme, labelColor, stats]);

  const hasData = !!stats && stats.links.length > 0;
  const stages = stats?.stages ?? [
    'MITRE ATT&CK Framework',
    'Developed Use Cases',
    'Alerts',
    'Resolution',
    'Event Level',
  ];
  const stageGuideBackground = isDarkTheme
    ? 'linear-gradient(90deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012), rgba(255,255,255,0.035), rgba(255,255,255,0.012), rgba(255,255,255,0.035))'
    : 'linear-gradient(90deg, rgba(23,92,180,0.045), rgba(23,92,180,0.018), rgba(23,92,180,0.045), rgba(23,92,180,0.018), rgba(23,92,180,0.045))';

  return (
    <Card
      className="dashboard-sankey-card"
      title="Alert Correlation — 5-Stage Detection Pipeline"
      styles={{ body: { padding: 0 } }}
    >
      {loading ? (
        <div style={{ height: 620, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : !hasData ? (
        <div style={{ height: 620, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="No correlation data available — tickets need category, resolution, and priority fields filled in" />
        </div>
      ) : (
        <div className="dashboard-sankey-panel" style={{ background: panelBg }}>
          <div
            className="dashboard-sankey-canvas-shell"
            style={
              {
                '--dashboard-sankey-plot-left': `${SANKEY_CHART_LEFT}px`,
                '--dashboard-sankey-plot-right': `${SANKEY_CHART_RIGHT}px`,
              } as React.CSSProperties
            }
          >
            <div
              className="dashboard-sankey-stage-guide"
              // Stage guide bands reuse the exact Sankey plot insets so header tracks stay visually locked.
              style={{ background: stageGuideBackground }}
            >
              {stages.map((stage, index) => (
                <div
                  key={stage}
                  className="dashboard-sankey-stage-divider"
                  style={{
                    borderLeftColor: index === 0 ? 'transparent' : isDarkTheme ? 'rgba(132, 255, 226, 0.16)' : 'rgba(31, 111, 209, 0.18)',
                  }}
                />
              ))}
            </div>
            <div
              className="dashboard-sankey-stage-header"
              // Header cells share the same five-column track to align text centers with stage lanes.
              style={{ color: labelColor }}
            >
              {stages.map((stage) => (
                <div key={stage} className="dashboard-sankey-stage-cell">
                  <Typography.Text style={{ color: labelColor, fontWeight: 800, fontSize: 15 }}>
                    {stage}
                  </Typography.Text>
                </div>
              ))}
            </div>
            <Typography.Text
              className="dashboard-sankey-subtitle"
              style={{ color: mutedColor }}
            >
              Static MITRE/use-case context flows into live ticket categories, resolutions, and event levels.
            </Typography.Text>
            <ReactECharts option={option} style={{ position: 'relative', zIndex: 1, height: 540, width: '100%' }} notMerge lazyUpdate />
          </div>
        </div>
      )}
    </Card>
  );
};

export default AlertSankeyChart;
