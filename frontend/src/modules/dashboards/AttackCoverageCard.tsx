import HelpTip from './HelpTip';
import ClickValue from './ClickValue';
import AttackTechniquesModal from './AttackTechniquesModal';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Progress, Spin, Statistic, Tooltip, Typography } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { detectionLinkForTactic, detectionLinkForTechnique, openDetectionsWithSearch } from './detectionLinks';
import { fetchDashboardAttackCoverage } from 'services/dashboards';
import type { AttackCoverage } from 'types';
import AttackCatalogSyncModal from './AttackCatalogSyncModal';

export const coverageColor = (percent: number) => (percent >= 60 ? '#52c41a' : percent >= 30 ? '#faad14' : '#f5222d');

// Heat levels by number of enabled rules covering a technique; 0 stays neutral on both themes.
const cellColor = (ruleCount: number) => {
  if (ruleCount <= 0) return 'rgba(140, 140, 140, 0.22)';
  if (ruleCount === 1) return '#69b1ff';
  if (ruleCount <= 3) return '#1677ff';
  return '#0958d9';
};

export const Matrix: React.FC<{
  data: AttackCoverage;
  onTacticClick?: (tactic: AttackCoverage['tactics'][number]) => void;
  onTechniqueClick?: (technique: AttackCoverage['tactics'][number]['techniques'][number]) => void;
}> = ({ data, onTacticClick, onTechniqueClick }) => (
  <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
    <div style={{ display: 'flex', gap: 8, minWidth: data.tactics.length * 92 }}>
      {data.tactics.map((tactic) => (
        <div key={tactic.tactic_id} style={{ flex: '1 1 84px', minWidth: 84 }}>
          <Tooltip title={`${tactic.name}: ${tactic.covered_techniques}/${tactic.total_techniques ?? '?'} techniques`}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                height: 32,
                lineHeight: '16px',
                marginBottom: 4,
                overflow: 'hidden',
                cursor: onTacticClick ? 'pointer' : undefined,
              }}
              onClick={onTacticClick ? () => onTacticClick(tactic) : undefined}
            >
              {tactic.name}
            </div>
          </Tooltip>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {tactic.techniques.map((t) => (
              <Tooltip
                key={t.technique_id}
                title={`${t.technique_id}${t.name ? ` ${t.name}` : ''} — ${t.rule_count} rule${t.rule_count === 1 ? '' : 's'}`}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: cellColor(t.rule_count),
                    cursor: onTechniqueClick ? 'pointer' : undefined,
                  }}
                  onClick={onTechniqueClick ? () => onTechniqueClick(t) : undefined}
                />
              </Tooltip>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12 }}>
      <Typography.Text type="secondary">Rules per technique:</Typography.Text>
      {[0, 1, 2, 4].map((n) => (
        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: cellColor(n), display: 'inline-block' }} />
          <Typography.Text type="secondary">{n === 0 ? '0' : n === 1 ? '1' : n === 2 ? '2–3' : '4+'}</Typography.Text>
        </span>
      ))}
    </div>
  </div>
);

const AttackCoverageCard: React.FC<{ isStaff: boolean }> = ({ isStaff }) => {
  const [data, setData] = useState<AttackCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [techniquesOpen, setTechniquesOpen] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    setLoading(true);
    fetchDashboardAttackCoverage()
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const percent = data?.coverage_percent;

  return (
    <Card
      className="dashboard-coverage-card"
      title="MITRE ATT&CK Coverage"
      extra={
        isStaff ? (
          <Button size="small" data-tour="at-sync" icon={<SyncOutlined />} onClick={() => setSyncOpen(true)}>
            Sync ATT&CK catalog
          </Button>
        ) : null
      }
    >
      {loading ? (
        <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : !data ? (
        <Empty description="Unable to load ATT&CK coverage" />
      ) : (
        <>
          {!data.catalog_loaded && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="ATT&CK catalog is not loaded"
              description={
                isStaff
                  ? 'Sync the ATT&CK catalog to calculate coverage against the full technique list. Existing detection rules are re-mapped automatically.'
                  : 'Ask an administrator to sync the ATT&CK catalog so coverage can be calculated.'
              }
              action={
                isStaff ? (
                  <Button size="small" type="primary" onClick={() => setSyncOpen(true)}>
                    Sync now
                  </Button>
                ) : undefined
              }
            />
          )}
          {data.catalog_loaded && data.enabled_rules > 0 && data.covered_techniques === 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="No ATT&CK techniques found on enabled rules"
              description="Rules need Sigma attack.* tags (for example attack.t1059.001) or a Kibana threat mapping to count toward coverage."
            />
          )}
          <div className="cov-stats">
            <Statistic
              title={<HelpTip id="attackCoverage" label="Coverage" tip="Share of ATT&CK techniques covered by at least one enabled rule. Sub-techniques count toward their parent technique." />}
              value={percent == null ? '—' : `${percent}%`}
              valueStyle={{ color: percent == null ? undefined : coverageColor(percent), fontSize: 26, fontWeight: 600 }}
            />
            <Statistic
              title={<HelpTip id="techniques" label="Techniques covered" tip="Techniques with at least one enabled rule, out of all techniques in the synced ATT&CK catalog." />}
              value={`${data.covered_techniques} / ${data.total_techniques ?? '?'}`}
              formatter={(v) => <ClickValue onClick={() => setTechniquesOpen(true)}>{v}</ClickValue>}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Statistic title={<HelpTip id="enabledRules" label="Enabled rules" tip="Enabled detection rules considered for coverage." />} value={data.enabled_rules} valueStyle={{ fontSize: 26, fontWeight: 600 }} formatter={(v) => <ClickValue onClick={() => openDetectionsWithSearch(router.push, '')}>{v}</ClickValue>} />
          </div>

          <Typography.Text strong>
            <HelpTip id="matrix" label="Coverage by tactic" tip="Each column is an ATT&CK tactic; each cell is a technique. Darker/greener means more enabled rules. Click a cell to open the matching rules." />
          </Typography.Text>
          <div data-tour="at-tactics" style={{ margin: '8px 0 20px' }}>
            {data.tactics.map((t) => {
              const total = t.total_techniques;
              const pct = total ? (t.covered_techniques / total) * 100 : t.covered_techniques > 0 ? 100 : 0;
              const covered = t.techniques.filter((x) => x.rule_count > 0);
              return (
                <Tooltip
                  key={t.tactic_id}
                  placement="topLeft"
                  title={
                    <div style={{ maxWidth: 320 }}>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div>
                        {t.covered_techniques} of {total ?? '?'} techniques covered by enabled rules
                        {total ? ` (${Math.round(pct)}%)` : ''}
                      </div>
                      {covered.length > 0 ? (
                        <div style={{ marginTop: 4 }}>
                          Covered:
                          {covered.slice(0, 6).map((x) => (
                            <div key={x.technique_id}>
                              {x.technique_id} {x.name} · {x.rule_count} rule{x.rule_count === 1 ? '' : 's'}
                            </div>
                          ))}
                          {covered.length > 6 && <div>+{covered.length - 6} more</div>}
                        </div>
                      ) : (
                        <div style={{ marginTop: 4 }}>No enabled rule maps to this tactic yet.</div>
                      )}
                      <div style={{ marginTop: 4, opacity: 0.75 }}>Click to open the matching rules</div>
                    </div>
                  }
                >
                <div
                  role="button"
                  tabIndex={0}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, cursor: 'pointer' }}
                  onClick={() => openDetectionsWithSearch(router.push, detectionLinkForTactic(t.slug))}
                  onKeyDown={(e) => e.key === 'Enter' && openDetectionsWithSearch(router.push, detectionLinkForTactic(t.slug))}
                >
                  <Typography.Text style={{ width: 170, flexShrink: 0 }}>{t.name}</Typography.Text>
                  <Progress
                    percent={pct}
                    showInfo={false}
                    size="small"
                    strokeColor={total ? coverageColor(pct) : '#1677ff'}
                    style={{ flex: 1, margin: 0 }}
                  />
                  <Typography.Text type="secondary" style={{ width: 64, textAlign: 'right', fontSize: 12 }}>
                    {t.covered_techniques} / {total ?? '?'}
                  </Typography.Text>
                </div>
                </Tooltip>
              );
            })}
          </div>

          <Typography.Text strong>Technique matrix</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Matrix
              data={data}
              onTacticClick={(t) => openDetectionsWithSearch(router.push, detectionLinkForTactic(t.slug))}
              onTechniqueClick={(t) => openDetectionsWithSearch(router.push, detectionLinkForTechnique(t.technique_id))}
            />
          </div>
        </>
      )}
      {data && <AttackTechniquesModal open={techniquesOpen} data={data} onClose={() => setTechniquesOpen(false)} />}
      <AttackCatalogSyncModal open={syncOpen} onClose={() => setSyncOpen(false)} onDone={load} />
    </Card>
  );
};

export default AttackCoverageCard;
