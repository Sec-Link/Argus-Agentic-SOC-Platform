import React, { useMemo, useState, useEffect } from 'react';
import { Card, Empty, Spin, Typography } from 'antd';
import { fetchRiskFunnel } from '../../api';

// Entity-risk exposure funnel. Each stage is a strict subset of the one above,
// so the shape always narrows (Tracked → Scored → Medium+ → High+ → Critical).
type Stage = { stage: string; value: number };

const STAGE_COLORS = ['#1677ff', '#13c2c2', '#faad14', '#fa8c16', '#f5222d'];
const VISUAL_WIDTHS = [96, 84, 70, 58, 46];

const getStoredThemeMode = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  try {
    return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const RiskExposureFunnelChart: React.FC = () => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(getStoredThemeMode);

  useEffect(() => {
    setLoading(true);
    fetchRiskFunnel()
      .then((d) => setStages(Array.isArray(d?.stages) ? d.stages : []))
      .catch(() => setStages([]))
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
  const textColor = '#f8fbff';
  const subtleColor = 'rgba(248, 251, 255, 0.84)';
  const containerBg = isDark
    ? 'linear-gradient(180deg, rgba(15, 29, 52, 0.72), rgba(8, 18, 34, 0.92))'
    : 'linear-gradient(180deg, rgba(247, 251, 255, 0.95), rgba(236, 244, 255, 0.82))';

  const rate = (cur: number, up: number) => (up > 0 ? `${((cur / up) * 100).toFixed(1)}%` : '—');

  const rows = useMemo(() => {
    return stages.map((s, index) => {
      const width = VISUAL_WIDTHS[index] ?? 40;
      const nextWidth = VISUAL_WIDTHS[index + 1] ?? Math.max(width - 10, 36);
      const left = (100 - width) / 2;
      const right = left + width;
      const nl = (100 - nextWidth) / 2;
      const nr = nl + nextWidth;
      return {
        ...s,
        index,
        color: STAGE_COLORS[index] ?? STAGE_COLORS[STAGE_COLORS.length - 1],
        clipPath: `polygon(${left}% 0%, ${right}% 0%, ${nr}% 100%, ${nl}% 100%)`,
        rate: index > 0 ? rate(s.value, stages[index - 1].value) : '100%',
      };
    });
  }, [stages]);

  const hasData = stages.some((s) => s.value > 0);

  return (
    <Card title="Entity Risk Exposure Funnel" styles={{ body: { padding: '16px 12px' } }}>
      {loading ? (
        <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : stages.length === 0 ? (
        <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="No risk profiles yet" />
        </div>
      ) : (
        <div style={{ minHeight: 380, padding: '18px 12px 22px', borderRadius: 14, background: containerBg }}>
          {!hasData && (
            <Typography.Text style={{ display: 'block', marginBottom: 12, textAlign: 'center', color: subtleColor }}>
              All stages are currently zero.
            </Typography.Text>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
              <div
                key={row.stage}
                title={`${row.stage}: ${row.value.toLocaleString()} (${row.rate})`}
                style={{
                  position: 'relative',
                  minHeight: 62,
                  clipPath: row.clipPath,
                  background: `linear-gradient(135deg, ${row.color}, ${row.color}cc)`,
                  boxShadow: isDark ? '0 12px 24px rgba(0,0,0,0.28)' : '0 12px 24px rgba(22,119,255,0.14)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', color: textColor, textShadow: '0 1px 3px rgba(0,0,0,0.45)', padding: '6px 24px', maxWidth: '82%' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{row.stage}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>{row.value.toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: subtleColor }}>
                    {row.index === 0 ? 'All tracked entities' : `${row.rate} of previous`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default RiskExposureFunnelChart;
