import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Card, Empty, Spin } from 'antd';
import { fetchRiskSankey } from '../../api';

// Risk contribution flow: entity type → detection rule → top risk entity.
// Backend namespaces node names with a "prefix:label" so identical labels in
// different columns never collide (see risk/services.get_risk_sankey).
type SankeyData = { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] };

const DEPTH_BY_PREFIX: Record<string, number> = { type: 0, rule: 1, entity: 2 };
const LEVEL_COLORS = ['#13c2c2', '#1677ff', '#f5222d'];

const stripPrefix = (name: string) => {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
};
const depthOf = (name: string) => DEPTH_BY_PREFIX[name.slice(0, name.indexOf(':'))] ?? undefined;

const getStoredThemeMode = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  try {
    return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const RiskEntitySankeyChart: React.FC = () => {
  const [data, setData] = useState<SankeyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(getStoredThemeMode);

  useEffect(() => {
    setLoading(true);
    fetchRiskSankey(14)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

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

  const isDark = themeMode === 'dark';
  const labelColor = isDark ? '#f7fbff' : '#1f2d3d';

  const option = useMemo<EChartsOption>(() => {
    const nodes = (data?.nodes ?? []).map((n) => ({
      name: n.name,
      depth: depthOf(n.name),
      label: {
        formatter: () => stripPrefix(n.name),
        color: labelColor,
        fontSize: 12,
        fontWeight: 700,
        overflow: 'break' as const,
        width: 120,
      },
      itemStyle: { borderRadius: 6 },
    }));
    const links = (data?.links ?? []).map((l) => ({
      ...l,
      lineStyle: { color: 'source' as const, opacity: isDark ? 0.34 : 0.28, curveness: 0.55 },
    }));
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          params?.dataType === 'edge'
            ? `${stripPrefix(params.data.source)}<br/>→ ${stripPrefix(params.data.target)}<br/><b>${params.data.value}</b> risk score`
            : `<b>${stripPrefix(params?.name || '')}</b>`,
      },
      series: [
        {
          type: 'sankey',
          data: nodes,
          links,
          left: 24,
          right: 130,
          top: 20,
          bottom: 20,
          nodeWidth: 18,
          nodeGap: 14,
          nodeAlign: 'justify',
          draggable: true,
          emphasis: { focus: 'adjacency' },
          label: { color: labelColor, fontSize: 12, fontWeight: 700, overflow: 'break', width: 120 },
          levels: [0, 1, 2].map((depth) => ({ depth, itemStyle: { color: LEVEL_COLORS[depth] } })),
        },
      ],
    };
  }, [data, isDark, labelColor]);

  const hasData = !!data && data.links.length > 0;

  return (
    <Card title="Risk Flow — Entity Type → Rule → Top Entities" styles={{ body: { padding: 12 } }}>
      {loading ? (
        <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : !hasData ? (
        <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="No risk events yet — ingest alerts with configured risk objects" />
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 460, width: '100%' }} notMerge lazyUpdate />
      )}
    </Card>
  );
};

export default RiskEntitySankeyChart;
