import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Empty, Spin, Typography } from 'antd';
import { fetchDashboardConversionStats } from 'services/dashboards';
import type { ConversionStats } from 'types';

interface Props {
  startTime?: string;
  endTime?: string;
  allTime?: boolean;
}

const STAGE_COLORS = ['#1677ff', '#13c2c2', '#52c41a', '#faad14', '#f5222d'];
const VISUAL_WIDTHS = [96, 84, 72, 60, 48];

type FunnelStage = {
  stage: string;
  value: number;
  color: string;
  visualWidth: number;
  href?: string;
};

const getStoredThemeMode = (): 'light' | 'dark' => {
  // Keep theme lookup defensive because this component can be rendered in tests/SSR.
  if (typeof window === 'undefined') return 'light';
  try {
    return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const AlertFunnelChart: React.FC<Props> = ({ startTime, endTime, allTime }) => {
  const [stats, setStats] = useState<ConversionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(getStoredThemeMode);

  useEffect(() => {
    setLoading(true);
    fetchDashboardConversionStats({ start_time: startTime, end_time: endTime, all_time: allTime })
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [startTime, endTime, allTime]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncTheme = () => {
      setThemeMode(getStoredThemeMode());
    };
    window.addEventListener('siem_theme_changed', syncTheme as EventListener);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('siem_theme_changed', syncTheme as EventListener);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  const stages: FunnelStage[] = stats
    ? [
        { stage: 'Alerts', value: stats.alerts, color: STAGE_COLORS[0], visualWidth: VISUAL_WIDTHS[0] },
        { stage: 'Tickets', value: stats.tickets, color: STAGE_COLORS[1], visualWidth: VISUAL_WIDTHS[1] },
        { stage: 'TP + TP-B', value: stats.true_positive, color: STAGE_COLORS[2], visualWidth: VISUAL_WIDTHS[2] },
        { stage: 'Security Events', value: stats.security_events, color: STAGE_COLORS[3], visualWidth: VISUAL_WIDTHS[3] },
        { stage: 'Incidents', value: stats.incidents, color: STAGE_COLORS[4], visualWidth: VISUAL_WIDTHS[4] },
      ].map((stage) => ({
        ...stage,
        value: Number(stage.value) || 0,
        href: stage.stage === 'Alerts' ? '/alerts' : stage.stage === 'Tickets' ? '/tickets' : undefined,
      }))
    : [];

  const conversionRate = (current: number, upper: number) =>
    upper > 0 ? `${((current / upper) * 100).toFixed(1)}%` : '—';

  const isDarkTheme = themeMode === 'dark';
  const funnelTextColor = '#f8fbff';
  const funnelSubtleTextColor = 'rgba(248, 251, 255, 0.84)';
  const cardTextColor = isDarkTheme ? '#dbe6ff' : undefined;
  const cardSecondaryColor = isDarkTheme ? '#b7c7e6' : undefined;
  const containerBackground = isDarkTheme
    ? 'linear-gradient(180deg, rgba(15, 29, 52, 0.72), rgba(8, 18, 34, 0.92))'
    : 'linear-gradient(180deg, rgba(247, 251, 255, 0.95), rgba(236, 244, 255, 0.82))';

  const hasAnyData = stages.some((s) => s.value > 0);

  const funnelRows = useMemo(() => {
    return stages.map((stage, index) => {
      const nextWidth = stages[index + 1]?.visualWidth ?? Math.max(stage.visualWidth - 10, 40);
      const leftInset = (100 - stage.visualWidth) / 2;
      const rightInset = leftInset + stage.visualWidth;
      const nextLeftInset = (100 - nextWidth) / 2;
      const nextRightInset = nextLeftInset + nextWidth;

      return {
        ...stage,
        index,
        clipPath: `polygon(${leftInset}% 0%, ${rightInset}% 0%, ${nextRightInset}% 100%, ${nextLeftInset}% 100%)`,
        rate: index > 0 ? conversionRate(stage.value, stages[index - 1].value) : '100%',
      };
    });
  }, [stages]);

  return (
    <div>
      <div className="dashboard-funnel-stage-grid">
        {stages.map((s, i) => (
          <Card
            key={s.stage}
            size="small"
            style={{ minWidth: 0, textAlign: 'center' }}
            styles={{ body: { padding: '12px 8px' } }}
          >
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, color: cardSecondaryColor }}>
              {s.stage}
            </Typography.Text>
            {s.href ? (
              <Link
                href={s.href}
                // Keep metric links visually consistent with the existing statistic colors.
                style={{
                  color: s.color,
                  display: 'inline-block',
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  textDecoration: 'none',
                }}
              >
                {s.value.toLocaleString()}
              </Link>
            ) : (
              <Typography.Text style={{ color: s.color, display: 'block', fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
                {s.value.toLocaleString()}
              </Typography.Text>
            )}
            {i > 0 && (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 11, color: cardSecondaryColor }}>
                {conversionRate(s.value, stages[i - 1].value)} conversion
              </Typography.Text>
            )}
          </Card>
        ))}
      </div>

      <Card className="dashboard-conversion-card" title="Alert Conversion Funnel" styles={{ body: { padding: '16px 12px' } }}>
        {loading ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        ) : stages.length === 0 ? (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="No conversion data available" />
          </div>
        ) : (
          <div
            style={{
              minHeight: 420,
              padding: '18px 12px 22px',
              borderRadius: 14,
              background: containerBackground,
            }}
          >
            {!hasAnyData && (
              <Typography.Text
                style={{
                  display: 'block',
                  marginBottom: 12,
                  textAlign: 'center',
                  color: cardSecondaryColor,
                }}
              >
                All stages are currently zero; keeping the funnel visible for layout validation.
              </Typography.Text>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {funnelRows.map((row) => (
                <React.Fragment key={row.stage}>
                  {row.index === 1 && stats?.detection_rules != null && (
                    <div
                      style={{
                        textAlign: 'center',
                        fontSize: 12,
                        color: isDarkTheme ? 'rgba(200,220,255,0.72)' : 'rgba(22,119,255,0.8)',
                        letterSpacing: '0.02em',
                        margin: '-2px 0',
                        lineHeight: 1.4,
                      }}
                    >
                      ↓ {stats.detection_rules.toLocaleString()} detection rule{stats.detection_rules !== 1 ? 's' : ''} triggered
                    </div>
                  )}
                <div
                  title={`${row.stage}: ${row.value.toLocaleString()} (${row.rate} conversion)`}
                  style={{
                    position: 'relative',
                    minHeight: 70,
                    clipPath: row.clipPath,
                    background: `linear-gradient(135deg, ${row.color}, ${row.color}cc)`,
                    boxShadow: isDarkTheme
                      ? '0 12px 24px rgba(0, 0, 0, 0.28)'
                      : '0 12px 24px rgba(22, 119, 255, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.10))',
                    }}
                  />
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      textAlign: 'center',
                      color: funnelTextColor,
                      textShadow: '0 1px 3px rgba(0, 0, 0, 0.45)',
                      padding: '8px 28px',
                      maxWidth: '82%',
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                      {row.stage}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.35 }}>
                      {row.value.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12, color: funnelSubtleTextColor }}>
                      {row.index === 0 ? 'Entry stage' : `${row.rate} conversion`}
                    </div>
                  </div>
                </div>
                </React.Fragment>
              ))}
            </div>
            <Typography.Text
              style={{
                display: 'block',
                marginTop: 12,
                textAlign: 'center',
                fontSize: 12,
                color: cardSecondaryColor,
              }}
            >
              Funnel shape is normalized for readability; labels and tooltips show raw counts.
            </Typography.Text>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AlertFunnelChart;
