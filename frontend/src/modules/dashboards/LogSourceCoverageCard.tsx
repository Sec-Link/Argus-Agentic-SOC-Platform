import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Progress, Spin, Statistic, Tag, Tooltip, Typography, message } from 'antd';
import { CloseOutlined, DownOutlined, PushpinFilled, SettingOutlined, UndoOutlined, UpOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fetchDashboardLogSourceCoverage, resetLogSourceMappings, saveLogSourceMappings } from 'services/dashboards';
import type { LogSourceBrief, LogSourceCoverage, MonitoringPlatform } from 'types';
import LogSourceConfigDrawer from './LogSourceConfigDrawer';
import LogSourceLegend from './LogSourceLegend';
import ScanAge from './ScanAge';
import ClickValue from './ClickValue';
import MetricDetailModal, { type MetricKind } from './MetricDetailModal';
import HelpTip from './HelpTip';
import { STATUS_META, sourceStatus } from './logSourceStatus';
import RescanLogSourcesButton from './RescanLogSourcesButton';
import { coverageWindowLabel } from './coverageTimeRange';

const coverageColor = (percent: number) => (percent >= 60 ? '#52c41a' : percent >= 30 ? '#faad14' : '#f5222d');
const DRAG_TYPE = 'application/x-log-source';
const POOL = 'pool';
const VISIBLE_SOURCES = 6;
const POOL_COLLAPSE_THRESHOLD = 6;
const HIGHLIGHT_EDGE = 'var(--menu-selected-edge, #1a6ef5)';
const HIGHLIGHT_BG = 'var(--menu-selected-bg, rgba(26, 110, 245, 0.11))';

type DropTarget = number | typeof POOL | null;

const LogSourceCoverageCard: React.FC<{ isStaff: boolean; platform?: MonitoringPlatform }> = ({ isStaff, platform = 'elk' }) => {
  const [data, setData] = useState<LogSourceCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [detailKind, setDetailKind] = useState<MetricKind | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [poolExpanded, setPoolExpanded] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback((silent = false) => {
    const requestId = ++requestRef.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    fetchDashboardLogSourceCoverage(7, platform)
      .then((res) => { if (requestId === requestRef.current) setData(res); })
      .catch((err: any) => {
        if (requestId !== requestRef.current) return;
        setData(null);
        const status = err?.response?.status;
        setLoadError(status ? `Request failed (HTTP ${status})` : 'Request failed or timed out');
      })
      .finally(() => { if (requestId === requestRef.current) setLoading(false); });
  }, [platform]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const save = async (sourceKey: string, categoryId: number | null, ignored = false) => {
    try {
      await saveLogSourceMappings([{ source_key: sourceKey, category_id: categoryId, ignored }], platform);
      load(true);
    } catch {
      message.error('Failed to update the log source');
    }
  };

  const restore = async (sourceKey: string) => {
    try {
      await resetLogSourceMappings([sourceKey], platform);
      load(true);
    } catch {
      message.error('Failed to restore the log source');
    }
  };

  const dragProps = (sourceKey: string) =>
    isStaff
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG_TYPE, sourceKey);
            e.dataTransfer.effectAllowed = 'move';
          },
          style: { cursor: 'grab' },
        }
      : {};

  const dropProps = (target: Exclude<DropTarget, null>) =>
    isStaff
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            setDropTarget(target);
          },
          onDragLeave: () => setDropTarget((cur) => (cur === target ? null : cur)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setDropTarget(null);
            const key = e.dataTransfer.getData(DRAG_TYPE);
            if (key) save(key, target === POOL ? null : target);
          },
        }
      : {};

  type ChipSource = {
    source_key: string;
    source_label?: string;
    docs: number;
    last_seen: string | null;
    enabled_rules: number;
    total_rules: number;
    origin?: 'auto' | 'manual';
  };

  const sourceTag = (s: ChipSource, opts: { unclassified?: boolean; extra?: string } = {}) => {
    const status = sourceStatus(s);
    const manual = s.origin === 'manual';
    const lines = [
      `${STATUS_META[status].label}: ${STATUS_META[status].description}`,
      `${s.docs.toLocaleString()} docs · ${s.enabled_rules} enabled / ${s.total_rules} rules use it`,
      manual ? 'Manually assigned' : opts.unclassified ? 'Not classified yet' : 'Classified automatically',
      ...(opts.extra ? [opts.extra] : []),
    ];
    return (
      <Tooltip key={s.source_key} title={<div>{lines.map((l) => <div key={l}>{l}</div>)}</div>}>
        <Tag
          {...dragProps(s.source_key)}
          className={`ls-chip ls-chip--${status}${opts.unclassified ? ' ls-chip--unclassified' : ''}`}
          closable={isStaff}
          closeIcon={<CloseOutlined />}
          onClose={(e) => {
            e.preventDefault();
            save(s.source_key, null, true);
          }}
        >
          {manual && <PushpinFilled className="ls-chip__pin" />}
          {s.source_label || s.source_key}
        </Tag>
      </Tooltip>
    );
  };

  const poolTag = (s: LogSourceBrief) =>
    sourceTag(s, { unclassified: true, extra: `Suggested: ${s.auto_category} (${s.auto_reason})` });

  const RuleBar: React.FC<{ label: string; value: number; total: number; color: string }> = ({ label, value, total, color }) => (
    <div style={{ marginTop: 6 }}>
      <div className="ls-bar-label">
        <Typography.Text type="secondary"><span>{label}</span></Typography.Text>
        <Typography.Text><span>{value}/{total}</span></Typography.Text>
      </div>
      <Progress percent={total ? Math.round((value / total) * 100) : 0} size="small" showInfo={false} strokeColor={color} style={{ margin: 0 }} />
    </div>
  );

  const percent = data?.coverage_percent;
  const nothingConfigured = !!data && data.configured_categories === 0;
  const rules = data?.rules;

  return (
    <Card
      className="dashboard-coverage-card"
      data-tour="ls-card"
      title="Detection Log Source Coverage"
      extra={
        <div data-tour="ls-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {data && <ScanAge scannedAt={data.scanned_at} ageSeconds={data.scan_age_seconds} />}
          {isStaff && (
            <>
              <RescanLogSourcesButton platform={platform} onScanned={() => load(true)} />
              <Button size="small" icon={<SettingOutlined />} onClick={() => setDrawerOpen(true)}>
                Configure
              </Button>
            </>
          )}
          <LogSourceLegend />
        </div>
      }
    >
      {loading ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : !data ? (
        <Empty description={`Unable to load log source coverage${loadError ? ` — ${loadError}` : ''}`} />
      ) : (
        <>
          {data.es_reason && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Log sources could not be scanned"
              description={`${data.es_reason}${data.initialized ? ' The previous successful scan is retained.' : platform === 'elk' ? ' Coverage falls back to alert sources only.' : ''}`}
            />
          )}
          {!data.initialized && !data.es_reason && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Log sources have not been scanned yet"
              description={isStaff ? `Click Rescan to read log sources from ${platform === 'splunk' ? 'Splunk' : 'Elasticsearch'}.` : 'Ask an administrator to scan log sources.'}
            />
          )}
          {nothingConfigured && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="No log source categories are available" />
          )}
          {data.truncated && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Only the busiest sources are included. Coverage outside this scan is unknown." />}
          {!!data.warnings?.length && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
            message={data.warnings.includes('host_statistics_unavailable')
              ? 'Log statistics are available; some CMDB host coverage is unavailable.'
              : 'The scan completed with a reviewed Splunk warning.'} />}
          <div className="cov-stats">
            <Statistic
              title={<HelpTip id="logCoverage" label="Log source coverage" tip="Receiving categories / all enabled categories after a successful scan, including empty categories." />}
              value={percent == null ? '—' : `${percent}%`}
              formatter={() => <ClickValue onClick={() => setDetailKind('categories')}>{percent == null ? '—' : `${percent}%`}</ClickValue>}
              valueStyle={{ color: percent == null ? undefined : coverageColor(percent), fontSize: 26, fontWeight: 600 }}
            />
            <Statistic
              title={<HelpTip id="receiving" label={`Receiving logs (${coverageWindowLabel(data.window_days)})`} tip="Categories with at least one log in the window, out of all configured categories." />}
              value={`${data.active_categories} / ${data.configured_categories}`}
              formatter={() => <ClickValue onClick={() => setDetailKind('categories')}>{`${data.active_categories} / ${data.configured_categories}`}</ClickValue>}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            {rules && (
              <>
                <Statistic
                  title={<HelpTip id="enabledRules" platform={platform} label="Enabled rules / total" tip={platform === 'splunk' ? 'Confirmed enabled rules / published Splunk rules.' : 'Confirmed enabled Kibana rules / published Kibana rules in the local snapshot.'} />}
                  value={`${rules.enabled_rules} / ${rules.total_rules}`}
                  formatter={() => <ClickValue onClick={() => setDetailKind('rules_enabled')}>{`${rules.enabled_rules} / ${rules.total_rules}`}</ClickValue>}
                  suffix={rules.enabled_percent == null ? undefined : <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.65 }}>({rules.enabled_percent}%)</span>}
                  valueStyle={{ fontSize: 26, fontWeight: 600 }}
                />
                <Statistic
                    title={<HelpTip id="withData" platform={platform} label="Rules with live data" tip="Enabled rules with matching log sources receiving data in the scan window." />}
                    value={rules.enabled_with_data}
                    formatter={() => <ClickValue onClick={() => setDetailKind('rules_with_data')}>{rules.enabled_with_data}</ClickValue>}
                    valueStyle={{ fontSize: 26, fontWeight: 600, color: '#52c41a' }}
                  />
                <Statistic
                    title={<HelpTip id="withoutData" platform={platform} label="Rules without data" tip="Enabled rules with known sources but no data in the scan window." />}
                    value={rules.enabled_without_data}
                    formatter={() => <ClickValue onClick={() => setDetailKind('rules_without_data')}>{rules.enabled_without_data}</ClickValue>}
                    valueStyle={{ fontSize: 26, fontWeight: 600, color: rules.enabled_without_data > 0 ? '#f5222d' : undefined }}
                  />
                <Statistic title={<HelpTip id="unknown" platform={platform} label="Rules, source unknown" tip="Enabled rules that cannot be matched to a classified log source." />} value={rules.enabled_unmapped} formatter={() => <ClickValue onClick={() => setDetailKind('rules_unknown')}>{rules.enabled_unmapped}</ClickValue>} valueStyle={{ fontSize: 26, fontWeight: 600 }} />
              </>
            )}
          </div>

          {(data.unclassified.length > 0 || isStaff) && (
            <div
              data-tour="ls-pool"
              {...dropProps(POOL)}
              style={{
                border: `1px dashed ${dropTarget === POOL ? HIGHLIGHT_EDGE : 'rgba(140,140,140,0.5)'}`,
                borderRadius: 8,
                padding: '8px 12px',
                marginBottom: 16,
                background: dropTarget === POOL ? HIGHLIGHT_BG : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text strong>
                  <HelpTip id="unclassified" platform={platform} label={`Unclassified sources (${data.unclassified.length})`} tip="Discovered sources that have no category assignment." />
                </Typography.Text>

                <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
                  {isStaff ? 'Drag a source onto a category below, or click × to ignore it.' : 'Ask an administrator to classify these.'}
                </Typography.Text>
                {data.unclassified.length > POOL_COLLAPSE_THRESHOLD && (
                  <Button
                    type="link"
                    size="small"
                    icon={poolExpanded ? <UpOutlined /> : <DownOutlined />}
                    onClick={() => setPoolExpanded((v) => !v)}
                  >
                    {poolExpanded ? 'Collapse' : `Show all (${data.unclassified.length})`}
                  </Button>
                )}
              </div>
              <div className={`ls-pool${poolExpanded ? '' : ' is-collapsed'}`}>
                {data.unclassified.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>All discovered sources are classified.</Typography.Text>
                ) : (
                  data.unclassified.map(poolTag)
                )}
              </div>
            </div>
          )}

          {data.categories.length === 0 ? (
            <Empty description="No log source categories defined" />
          ) : (
            <div data-tour="ls-cats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {data.categories.map((c) => {
                const shown = expanded[c.id] ? c.sources : c.sources.slice(0, VISIBLE_SOURCES);
                const over = dropTarget === c.id;
                return (
                  <div
                    key={c.id}
                    {...dropProps(c.id)}
                    className="ls-tile"
                    style={{
                      border: `1px solid ${over ? HIGHLIGHT_EDGE : 'rgba(140,140,140,0.25)'}`,
                      background: over ? HIGHLIGHT_BG : undefined,
                      borderRadius: 8,
                      padding: '10px 12px',
                      opacity: c.configured ? 1 : 0.7,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge status={!c.configured ? 'default' : c.active ? 'success' : 'error'} />
                      <Typography.Text strong style={{ flex: 1 }}>{c.name}</Typography.Text>
                      {!c.configured && <Tag>Not configured</Tag>}
                      {c.configured && c.source_count === 0 && data.es_available && <Tag color="red">No sources</Tag>}
                      {c.configured && c.data_source === 'alerts' && (
                        <Tooltip title="Elasticsearch is unavailable, so this is inferred from alert sources only and likely understates coverage.">
                          <Tag color="orange">alerts only</Tag>
                        </Tooltip>
                      )}
                    </div>
                    {c.configured && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {c.last_seen
                          ? `Last seen ${dayjs(c.last_seen).format('MM-DD HH:mm')}`
                          : `No data (${coverageWindowLabel(data.window_days)})`}
                      </Typography.Text>
                    )}
                    {c.total_rules > 0 && (
                      <RuleBar label="Rules on" value={c.enabled_rules} total={c.total_rules} color={c.active ? 'var(--menu-selected-edge, #1a6ef5)' : '#f5222d'} />
                    )}
                    {c.sources.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {shown.map((s) => sourceTag(s))}
                        {c.sources.length > VISIBLE_SOURCES && (
                          <Tag
                            className="ls-chip ls-chip--silent"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setExpanded((cur) => ({ ...cur, [c.id]: !cur[c.id] }))}
                          >
                            {expanded[c.id] ? 'less' : `+${c.sources.length - VISIBLE_SOURCES}`}
                          </Tag>
                        )}
                      </div>
                    )}
                    {c.asset_coverage_percent != null && (
                      <RuleBar
                        label="Hosts reporting"
                        value={c.observed_assets ?? 0}
                        total={c.expected_assets ?? 0}
                        color={coverageColor(c.asset_coverage_percent)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isStaff && data.ignored.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => setIgnoredOpen((v) => !v)}>
                {ignoredOpen ? 'Hide' : 'Show'} ignored sources ({data.ignored.length})
              </Button>
              {ignoredOpen && (
                <>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    click to restore
                  </Typography.Text>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {data.ignored.map((s) => (
                      <Tag key={s.source_key} icon={<UndoOutlined />} className="ls-chip ls-chip--silent ls-chip--ignored" style={{ cursor: 'pointer' }} onClick={() => restore(s.source_key)}>
                        {s.source_label || s.source_key}
                      </Tag>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
      {data && <MetricDetailModal kind={detailKind} platform={platform} data={data} onClose={() => setDetailKind(null)} />}
      <LogSourceConfigDrawer platform={platform} open={drawerOpen} onClose={() => setDrawerOpen(false)} onChanged={() => load(true)} />
    </Card>
  );
};

export default LogSourceCoverageCard;
