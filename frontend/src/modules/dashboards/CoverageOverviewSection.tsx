import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Progress, Row, Spin, Statistic, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { fetchDashboardAttackCoverage, fetchDashboardLogSourceCoverage } from 'services/dashboards';
import type { AttackCoverage, LogSourceCoverage } from 'types';
import { useRouter } from 'next/navigation';
import ScanAge from './ScanAge';
import { detectionLinkForTactic, detectionLinkForTechnique, openDetectionsWithSearch } from './detectionLinks';
import { coverageColor, Matrix } from './AttackCoverageCard';

interface Props {
  onConfigure: () => void;
}

const CoverageOverviewSection: React.FC<Props> = ({ onConfigure }) => {
  const [logs, setLogs] = useState<LogSourceCoverage | null>(null);
  const [attack, setAttack] = useState<AttackCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    // Each half degrades on its own so one failing endpoint does not hide the other.
    Promise.allSettled([fetchDashboardLogSourceCoverage(), fetchDashboardAttackCoverage()])
      .then(([l, a]) => {
        setLogs(l.status === 'fulfilled' ? l.value : null);
        setAttack(a.status === 'fulfilled' ? a.value : null);
        setFailed(l.status === 'rejected' && a.status === 'rejected');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const configured = Boolean(logs?.initialized && logs.categories.some((c) => c.source_count > 0));
  const unmonitored = logs
    ? logs.categories.reduce((n, c) => n + c.sources.filter((s) => s.docs > 0 && !s.enabled_rules).length, 0)
    : 0;
  const settingsButton = (
    <Button size="small" icon={<SettingOutlined />} onClick={onConfigure}>
      Coverage settings
    </Button>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  } else if (failed) {
    body = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Unable to load coverage data"
        children={<Button onClick={load}>Retry</Button>}
      />
    );
  } else if (!configured || !logs) {
    body = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Coverage is not set up yet. Classify your log sources to see detection coverage here."
      >
        <Button type="primary" icon={<SettingOutlined />} onClick={onConfigure}>
          Set up coverage
        </Button>
      </Empty>
    );
  } else {
    const rules = logs.rules;
    const pct = logs.coverage_percent;
    body = (
      <Row gutter={[32, 16]}>
        <Col span={24}>
          <Typography.Text strong>Log source coverage</Typography.Text>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            <Statistic
              title="Coverage"
              value={pct == null ? '—' : `${pct}%`}
              valueStyle={{ color: pct == null ? undefined : coverageColor(pct), fontSize: 28, fontWeight: 700 }}
            />
            <Statistic
              title="Receiving logs"
              value={`${logs.active_categories} / ${logs.configured_categories}`}
              valueStyle={{ fontSize: 22 }}
            />
            {rules && (
              <Statistic
                title="Enabled rules"
                value={`${rules.enabled_rules} / ${rules.total_rules}`}
                valueStyle={{ fontSize: 22 }}
              />
            )}
            <div style={{ cursor: 'pointer' }} title="Open Coverage settings" onClick={onConfigure}>
              <Statistic
                title="Unmonitored sources"
                value={unmonitored}
                valueStyle={{ fontSize: 22, color: unmonitored > 0 ? coverageColor(30) : undefined }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {logs.categories
              .filter((c) => c.configured)
              .map((c) => (
                <div
                  key={c.id}
                  className="ls-tile"
                  role="button"
                  tabIndex={0}
                  title="Open Coverage settings"
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    border: '1px solid var(--border-color, rgba(140,140,140,0.3))',
                    borderRadius: 8,
                  }}
                  onClick={onConfigure}
                  onKeyDown={(e) => e.key === 'Enter' && onConfigure()}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Typography.Text strong ellipsis>
                      {c.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {c.source_count} source{c.source_count === 1 ? '' : 's'}
                    </Typography.Text>
                  </div>
                  <Progress
                    percent={c.active ? 100 : 0}
                    showInfo={false}
                    size="small"
                    strokeColor={c.active ? '#52c41a' : '#f5222d'}
                    style={{ margin: '4px 0 0' }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.active ? 'Receiving logs' : 'No logs'} · {c.enabled_rules}/{c.total_rules} rules on
                  </Typography.Text>
                </div>
              ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <ScanAge scannedAt={logs.scanned_at} ageSeconds={logs.scan_age_seconds} />
          </div>
        </Col>
        <Col span={24}>
          <Typography.Text strong>MITRE ATT&CK coverage heatmap</Typography.Text>
          {!attack ? (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              Unable to load ATT&CK coverage.
            </Typography.Paragraph>
          ) : !attack.catalog_loaded ? (
            <div style={{ marginTop: 8 }}>
              <Typography.Paragraph type="secondary">ATT&CK catalog not loaded.</Typography.Paragraph>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={onConfigure}>
                Open Coverage settings to sync it
              </Button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', margin: '8px 0 12px' }}>
                <Statistic
                  title="Coverage"
                  value={attack.coverage_percent == null ? '—' : `${attack.coverage_percent}%`}
                  valueStyle={{
                    color: attack.coverage_percent == null ? undefined : coverageColor(attack.coverage_percent),
                    fontSize: 28,
                    fontWeight: 700,
                  }}
                />
                <Statistic
                  title="Techniques covered"
                  value={`${attack.covered_techniques} / ${attack.total_techniques ?? '?'}`}
                  valueStyle={{ fontSize: 22 }}
                />
              </div>
              <Matrix
                data={attack}
                onTacticClick={(t) => openDetectionsWithSearch(router.push, detectionLinkForTactic(t.slug))}
                onTechniqueClick={(t) => openDetectionsWithSearch(router.push, detectionLinkForTechnique(t.technique_id))}
              />
            </>
          )}
        </Col>
      </Row>
    );
  }

  return (
    <Card
      className="dashboard-coverage-card"
      title="Detection coverage"
      extra={!loading && configured ? settingsButton : null}
      style={{ marginTop: 16 }}
    >
      {body}
    </Card>
  );
};

export default CoverageOverviewSection;
