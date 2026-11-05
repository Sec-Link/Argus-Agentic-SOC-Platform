import React from 'react';
import { Modal, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import type { LogSourceCoverage, LogSourceRuleItem } from 'types';
import { sourceStatus, STATUS_META } from './logSourceStatus';
import LogSourceLegend from './LogSourceLegend';

export type MetricKind = 'categories' | 'rules_enabled' | 'rules_with_data' | 'rules_without_data' | 'rules_unknown' | 'unmonitored';

interface Props {
  kind: MetricKind | null;
  data: LogSourceCoverage;
  onClose: () => void;
}

const DETECTION_BASE = '/settings/detection';
const fmtTime = (v: string | null) => (v ? dayjs(v).format('MM-DD HH:mm') : '—');

const RULE_META: Record<string, { title: string; source: string; filter: (r: LogSourceRuleItem) => boolean }> = {
  rules_enabled: {
    title: 'Enabled rules',
    source: 'Rules whose enabled flag is on in the platform rule library (updated when a rule is published to or synced from Kibana).',
    filter: (r) => r.enabled,
  },
  rules_with_data: {
    title: 'Enabled rules with live data',
    source: 'Enabled rules whose log source category received logs in the scan window.',
    filter: (r) => r.state === 'with_data',
  },
  rules_without_data: {
    title: 'Enabled rules without data',
    source: 'Enabled rules whose log source category received no logs in the scan window.',
    filter: (r) => r.state === 'without_data',
  },
  rules_unknown: {
    title: 'Enabled rules, source unknown',
    source: 'Enabled rules that could not be matched to a category (no usable index pattern or name hint).',
    filter: (r) => r.state === 'unknown',
  },
};

const MetricDetailModal: React.FC<Props> = ({ kind, data, onClose }) => {
  const router = useRouter();
  if (!kind) return null;

  const open = (url: string) => {
    onClose();
    router.push(url);
  };

  const sourceByKey = new Map(data.categories.flatMap((c) => c.sources).map((x) => [x.source_key, x]));
  const activeByName = new Map(data.categories.map((c) => [c.name, c.active]));
  // Chips use the same colour legend as the log source cards (alerting / blind / ...).
  const renderRuleSources = (r: LogSourceRuleItem) => {
    if (r.sources.length) {
      return r.sources.map((k) => {
        const src = sourceByKey.get(k);
        const status = src ? sourceStatus(src) : 'silent';
        return (
          <Tooltip key={k} title={src ? `${STATUS_META[status].label}: ${STATUS_META[status].description}` : 'Not in the latest scan'}>
            <Tag className={`ls-chip ls-chip--${status}`}>{k}</Tag>
          </Tooltip>
        );
      });
    }
    if (r.categories.length) {
      // Matched by name only: no concrete source, so colour by whether the category receives logs.
      return r.categories.map((n) => {
        const status = activeByName.get(n) ? 'alerting' : 'blind';
        return (
          <Tooltip key={n} title={`${STATUS_META[status].label} (matched by name to category ${n}, no index pattern)`}>
            <Tag className={`ls-chip ls-chip--${status} ls-chip--unclassified`}>{n}</Tag>
          </Tooltip>
        );
      });
    }
    return <Tag className="ls-chip ls-chip--silent ls-chip--unclassified">Unknown</Tag>;
  };

  let title = '';
  let sourceNote = '';
  let body: React.ReactNode = null;

  if (kind === 'categories') {
    title = `Log source categories (last ${data.window_days}d)`;
    sourceNote = `Data comes from the Elasticsearch scan${data.scanned_at ? ` taken ${dayjs(data.scanned_at).format('MM-DD HH:mm')}` : ''}. A category is configured when at least one source is assigned to it, and receiving when any of its sources had documents in the window.`;
    const configured = data.categories.filter((c) => c.configured);
    const cols: ColumnsType<(typeof configured)[number]> = [
      { title: 'Category', dataIndex: 'name', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
      { title: 'Status', dataIndex: 'active', width: 120, render: (a: boolean) => <Tag color={a ? 'green' : 'red'}>{a ? 'Receiving' : 'No logs'}</Tag>, sorter: (a, b) => Number(b.active) - Number(a.active), defaultSortOrder: 'ascend' },
      { title: 'Sources', dataIndex: 'sources', render: (srcs: (typeof configured)[number]['sources']) => (
          <span>{srcs.map((s) => <Tag key={s.source_key}>{s.source_key}</Tag>)}</span>
        ) },
      { title: 'Last seen', dataIndex: 'last_seen', width: 120, render: fmtTime },
      { title: 'Rules on', width: 100, render: (_: unknown, c) => `${c.enabled_rules}/${c.total_rules}` },
    ];
    body = (
      <>
        <Table size="small" rowKey="id" columns={cols} dataSource={configured} pagination={false} />
        {data.unconfigured_categories > 0 && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            Not counted ({data.unconfigured_categories}, no source assigned):{' '}
            {data.categories.filter((c) => !c.configured).map((c) => c.name).join(', ')}
          </Typography.Paragraph>
        )}
      </>
    );
  } else if (kind === 'unmonitored') {
    title = 'Unmonitored sources';
    sourceNote = 'Sources that sent logs in the window but have no enabled rule attributed to them (from the scan and rule index patterns).';
    const rows = data.categories.flatMap((c) =>
      c.sources.filter((s) => s.docs > 0 && !s.enabled_rules).map((s) => ({ ...s, category: c.name })),
    );
    body = (
      <Table
        size="small"
        rowKey={(r) => `${r.category}/${r.source_key}`}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={rows}
        columns={[
          { title: 'Source', dataIndex: 'source_key' },
          { title: 'Category', dataIndex: 'category', width: 140 },
          { title: 'Docs', dataIndex: 'docs', width: 100, render: (v: number) => v.toLocaleString() },
          { title: 'Last seen', dataIndex: 'last_seen', width: 120, render: fmtTime },
          { title: 'Status', width: 130, render: (_: unknown, s) => STATUS_META[sourceStatus(s)].label },
        ]}
      />
    );
  } else {
    const meta = RULE_META[kind];
    title = meta.title;
    sourceNote = meta.source;
    const items = data.rules?.items;
    const rows = (items || []).filter(meta.filter);
    body = !items ? (
      <Typography.Text type="secondary">Rule details are not available for this scan.</Typography.Text>
    ) : (
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={rows}
        columns={[
          {
            title: 'Rule',
            dataIndex: 'name',
            render: (name: string, r: LogSourceRuleItem) => (
              <a onClick={() => open(`${DETECTION_BASE}/rules/${encodeURIComponent(r.id)}`)}>{name || r.id}</a>
            ),
          },
          { title: 'Categories', dataIndex: 'categories', render: (c: string[]) => (c.length ? c.map((n) => <Tag key={n}>{n}</Tag>) : '—') },
          {
            title: 'Log source',
            dataIndex: 'sources',
            render: (_: string[], r: LogSourceRuleItem) => renderRuleSources(r),
          },
        ]}
      />
    );
  }

  return (
    <Modal open centered width={820} title={title} footer={null} onCancel={onClose}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Source: {sourceNote} <LogSourceLegend />
      </Typography.Paragraph>
      {body}
    </Modal>
  );
};

export default MetricDetailModal;
