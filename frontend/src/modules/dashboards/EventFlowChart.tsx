import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button, Card, Empty, Spin, Typography } from 'antd';
import { Cloud, Database, Flame, Globe, KeyRound, Laptop, Layers, Mail, Network, Server, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchDashboardEventFlow } from 'services/dashboards';
import type { EventFlow, EventFlowGroup } from 'types';

interface Props {
  startTime?: string;
  endTime?: string;
  allTime?: boolean;
}

const MIN_W = 1172; // narrowest layout that fits labels, flows and the right-hand cluster; below it the card scrolls
const ROW_H = 30;
const GROUP_MIN_H = 84; // keeps a category's icon + label clear of its neighbours
const GROUP_GAP = 10;
const COLLAPSED_SOURCES = 5; // sources shown per category until the user expands it
const COLLAPSED_UNCLASSIFIED = 0; // the Unclassified branch starts as a single collapsed row
const PALETTE = ['#4c7be0', '#a78bd6', '#e49bd8', '#4cc2e8', '#f0a45d', '#4cc38a', '#e8707a', '#8aa0c8'];
const UNCLASSIFIED_COLOR = '#8b95a7';

// Default icon per well-known category; anything else (e.g. a newly created category) gets Layers.
const DEFAULT_ICONS: Array<[RegExp, LucideIcon]> = [
  [/edr|xdr/i, ShieldCheck],
  [/firewall|waf|network/i, Flame],
  [/identity|iam|auth/i, KeyRound],
  [/cloud|aws|azure|gcp/i, Cloud],
  [/endpoint|host|server/i, Laptop],
  [/dns/i, Globe],
  [/mail/i, Mail],
  [/data|database/i, Database],
  [/proxy|vpn|gateway/i, Network],
];
const iconFor = (name: string): LucideIcon => DEFAULT_ICONS.find(([re]) => re.test(name))?.[1] ?? (/unclassified/i.test(name) ? Server : Layers);

const compact = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};
const trim = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

interface Row {
  key: string;
  label: string;
  docs: number;
  color: string;
  tip: string[];
  toggle?: { groupIndex: number; expanded: boolean }; // "+N more" / "Show less" rows
}

interface Block {
  group: EventFlowGroup;
  color: string;
  firstRow: number;
  lastRow: number;
  top: number;
  height: number;
}

const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = (x2 - x1) * 0.55;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

type Tip = { x: number; y: number; lines: string[] };

const EventFlowChart: React.FC<Props> = ({ startTime, endTime, allTime }) => {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<EventFlow | null>(null);
  const [loading, setLoading] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [width, setWidth] = useState(MIN_W);
  const [tip, setTip] = useState<Tip | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setLoading(true);
    fetchDashboardEventFlow({ start_time: startTime, end_time: endTime, all_time: allTime })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [startTime, endTime, allTime]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Track the card's real width so the diagram re-lays out (instead of scaling its text) when the window changes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const go = (url: string) => router.push(url);
  const coverageUrl = '/dashboard?tab=coverage';

  const layout = useMemo(() => {
    if (!data || !data.groups.length) return null;
    const total = Math.max(data.total_events, 1);
    const rows: Row[] = [];
    const blocks: Block[] = [];
    let cursor = 20;
    data.groups.forEach((g, gi) => {
      const color = g.category_id == null ? UNCLASSIFIED_COLOR : PALETTE[gi % PALETTE.length];
      const firstRow = rows.length;
      const isOpen = !!expanded[gi];
      const all = g.sources;
      const isUnclassified = g.category_id == null;
      const keep = isUnclassified ? COLLAPSED_UNCLASSIFIED : COLLAPSED_SOURCES;
      const visible = isOpen ? all : all.slice(0, keep);
      visible.forEach((s) => {
        const lines = [
          s.source_key,
          `${s.docs.toLocaleString()} events (${((s.docs / total) * 100).toFixed(1)}% of total)`,
          s.last_seen ? `Last seen ${dayjs(s.last_seen).format('MM-DD HH:mm')}` : 'No events in the window',
          `Category: ${g.name} (${s.origin === 'manual' ? 'assigned manually' : 'classified automatically'})`,
        ];
        if (s.hosts) lines.push(`~${s.hosts.toLocaleString()} hosts`);
        if (s.indices) lines.push(`${s.indices} index${s.indices === 1 ? '' : 'es'}`);
        rows.push({ key: `${gi}:${s.source_key}`, label: s.source_key, docs: s.docs, color, tip: lines });
      });
      const hidden = isOpen ? [] : all.slice(keep);
      const beyondCap = g.others?.count || 0; // sources the server did not send at all
      const extraCount = hidden.length + (isOpen ? 0 : beyondCap);
      const extraDocs = hidden.reduce((n, s) => n + s.docs, 0) + (isOpen ? 0 : g.others?.docs || 0);
      if (extraCount > 0) {
        rows.push({
          key: `${gi}:more`,
          label: isUnclassified ? `${extraCount} unclassified source${extraCount === 1 ? '' : 's'}` : `+${extraCount} more`,
          docs: extraDocs,
          color,
          toggle: { groupIndex: gi, expanded: false },
          tip: [`${extraCount} more sources in ${g.name}`, `${extraDocs.toLocaleString()} events combined`, 'Click to expand'],
        });
      } else if (isOpen && all.length > keep) {
        rows.push({
          key: `${gi}:less`,
          label: 'Show less',
          docs: 0,
          color,
          toggle: { groupIndex: gi, expanded: true },
          tip: [isUnclassified ? 'Collapse the unclassified sources' : `Collapse ${g.name} to its top ${COLLAPSED_SOURCES} sources`],
        });
      }
      const lastRow = rows.length - 1;
      const need = (lastRow - firstRow + 1) * ROW_H;
      const height = Math.max(need, GROUP_MIN_H);
      blocks.push({ group: g, color, firstRow, lastRow, top: cursor, height });
      cursor += height + GROUP_GAP;
    });
    const height = Math.max(cursor + 10, 360);
    // Each row sits centred inside its group's block.
    const rowY = (i: number) => {
      const b = blocks.find((x) => i >= x.firstRow && i <= x.lastRow) as Block;
      const n = b.lastRow - b.firstRow + 1;
      const start = b.top + (b.height - n * ROW_H) / 2;
      return start + (i - b.firstRow) * ROW_H + ROW_H / 2;
    };
    const maxDocs = Math.max(1, ...rows.map((r) => r.docs));
    return { rows, blocks, height, rowY, maxDocs, total };
  }, [data, expanded]);

  const subtitle = data?.initialized
    ? `Events: last ${data.window_days ?? 7}d from the latest log source scan · Alerts and tickets follow the selected time range`
    : '';

  // Viewport coordinates: the tooltip is portalled to <body>, so the card's scroll container cannot clip it.
  const showTip = (lines: string[]) => (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, lines });
  const hideTip = () => setTip(null);

  let body: React.ReactNode;
  if (loading && !data) {
    body = (
      <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  } else if (!data || !data.initialized || !layout) {
    body = (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No log source scan yet, so event volume is unknown.">
        <Button type="primary" onClick={() => go(coverageUrl)}>
          Set up coverage
        </Button>
      </Empty>
    );
  } else {
    const { rows, blocks, height, rowY, maxDocs } = layout;
    const W = Math.max(width, MIN_W);
    const catX = 62;
    const labelX = 118;
    const flowStartX = labelX + 300; // room for the longest trimmed label + its count
    const R = 96;
    // The right-hand cluster (events -> alerts -> outcomes) keeps fixed, tight gaps and is pinned to the
    // right edge; spare width goes to the flow area on the left, where the curves have room to breathe.
    const cx = Math.max(W - 24 - R - 428, flowStartX + R + 140);
    const alertsX = cx + R + 100 + 62;
    const rightX = alertsX + 62 + 80 + 62;
    const cy = height / 2;
    const n = rows.length;
    const endAt = (i: number) => {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.5; // spread the entry points along the ring's left arc
      const y = cy + t * R;
      const x = cx - Math.sqrt(Math.max(R * R - (y - cy) ** 2, 0));
      return { x, y };
    };
    const widthFor = (docs: number) => (docs <= 0 ? 1.5 : 3 + 11 * (Math.log10(docs + 1) / Math.log10(maxDocs + 1)));
    const node = (x: number, y: number, label: string, value: number, href: string, color: string, tipLines: string[]) => (
      <g
        className="ef-node"
        role="button"
        tabIndex={0}
        onClick={() => go(href)}
        onKeyDown={(e) => e.key === 'Enter' && go(href)}
        onMouseMove={showTip(tipLines)}
        onMouseLeave={hideTip}
      >
        <rect x={x - 62} y={y - 38} width={124} height={76} rx={14} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.5} />
        <text x={x} y={y + 4} textAnchor="middle" fontSize={26} fontWeight={700} fill={color}>
          {compact(value)}
        </text>
        <text x={x} y={y + 24} textAnchor="middle" fontSize={12} fill="currentColor" fillOpacity={0.75}>
          {label}
        </text>
      </g>
    );

    body = (
      <svg width={W} height={height} role="img" aria-label="Events flow from log sources to alerts and tickets" className={`ef-svg${reduceMotion ? ' ef-static' : ''}`}>
        <style>{`
          .ef-svg { color: var(--text-primary, #1f2937); display: block; }
          .ef-svg .ef-dash { animation: ef-dash 2.4s linear infinite; }
          .ef-svg.ef-static .ef-dash { animation: none; }
          .ef-svg .ef-node { cursor: pointer; }
          .ef-svg .ef-node:hover rect, .ef-svg .ef-node:hover > circle:first-of-type { fill-opacity: 0.25; }
          .ef-svg .ef-row:hover .ef-flow { opacity: 1; }
          .ef-svg .ef-row:hover text { fill-opacity: 1; }
          .ef-svg .ef-flow { opacity: 0.55; transition: opacity 150ms; }
          @keyframes ef-dash { to { stroke-dashoffset: -32; } }
        `}</style>

        {blocks.map(({ group, color, firstRow, lastRow, top, height: bh }, gi) => {
          const midY = top + bh / 2;
          const Icon = iconFor(group.name);
          const groupTip = [group.name, `${group.total_docs.toLocaleString()} events`, `${group.sources.length + (group.others?.count || 0)} sources`, 'Click to open Coverage settings'];
          return (
            <g key={`g${gi}`}>
              {rows.slice(firstRow, lastRow + 1).map((r, off) => (
                <path key={`c${r.key}`} d={bezier(catX + 22, midY - 8, labelX - 8, rowY(firstRow + off))} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1.4} />
              ))}
              <g
                className="ef-node"
                role="button"
                tabIndex={0}
                onClick={() => go(coverageUrl)}
                onKeyDown={(e) => e.key === 'Enter' && go(coverageUrl)}
                onMouseMove={showTip(groupTip)}
                onMouseLeave={hideTip}
              >
                <circle cx={catX} cy={midY - 8} r={22} fill={color} fillOpacity={0.15} stroke={color} />
                {group.icon ? (
                  <>
                    <clipPath id={`ef-clip-${gi}`}>
                      <circle cx={catX} cy={midY - 8} r={16} />
                    </clipPath>
                    <image href={group.icon} x={catX - 16} y={midY - 24} width={32} height={32} clipPath={`url(#ef-clip-${gi})`} preserveAspectRatio="xMidYMid slice" />
                  </>
                ) : (
                  <Icon x={catX - 11} y={midY - 19} width={22} height={22} color={color} strokeWidth={1.8} />
                )}
                <text x={catX} y={midY + 30} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="currentColor">
                  {trim(group.name, 14)}
                </text>
              </g>
            </g>
          );
        })}

        {rows.map((r, i) => {
          const y = rowY(i);
          const end = endAt(i);
          const d = bezier(flowStartX, y, end.x, end.y);
          const isLess = r.toggle?.expanded === true;
          const muted = r.docs <= 0;
          const toggle = r.toggle;
          return (
            <g
              key={r.key}
              className="ef-row"
              style={toggle ? { cursor: 'pointer' } : undefined}
              role={toggle ? 'button' : undefined}
              tabIndex={toggle ? 0 : undefined}
              onClick={toggle ? () => setExpanded((cur) => ({ ...cur, [toggle.groupIndex]: !toggle.expanded })) : undefined}
              onKeyDown={toggle ? (e) => e.key === 'Enter' && setExpanded((cur) => ({ ...cur, [toggle.groupIndex]: !toggle.expanded })) : undefined}
              onMouseMove={showTip(r.tip)}
              onMouseLeave={hideTip}
            >
              <text
                x={labelX}
                y={y + 4}
                fontSize={12.5}
                fill={toggle ? r.color : 'currentColor'}
                fillOpacity={muted && !toggle ? 0.4 : 0.9}
                textDecoration={toggle ? 'underline' : undefined}
              >
                {trim(r.label, 30)} {!isLess && <tspan fillOpacity={0.6}>({compact(r.docs)})</tspan>}
              </text>
              {/* wide invisible band so the whole row reacts to hover */}
              <rect x={labelX - 4} y={y - ROW_H / 2} width={flowStartX - labelX + 20} height={ROW_H} fill="transparent" />
              {!isLess && (
                <>
                  <path d={bezier(flowStartX - 14, y, flowStartX, y)} stroke={r.color} strokeOpacity={muted ? 0.3 : 0.7} strokeWidth={1.4} fill="none" />
                  <path className="ef-flow" d={d} fill="none" stroke={muted ? UNCLASSIFIED_COLOR : r.color} strokeWidth={widthFor(r.docs)} strokeLinecap="round" strokeOpacity={muted ? 0.35 : undefined} />
                  {!muted && <path className="ef-dash" d={d} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="2 14" strokeLinecap="round" />}
                  {!muted && !reduceMotion && (
                    <circle r={3.2} fill="#fff" fillOpacity={0.9}>
                      <animateMotion dur={`${3 + (i % 4) * 0.5}s`} begin={`${(i % 6) * 0.35}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* centre: total events */}
        <g
          className="ef-node"
          role="button"
          tabIndex={0}
          onClick={() => go(coverageUrl)}
          onKeyDown={(e) => e.key === 'Enter' && go(coverageUrl)}
          onMouseMove={showTip([`${data.total_events.toLocaleString()} events`, `Last ${data.window_days ?? 7} days, all classified sources`, 'Click to open Coverage settings'])}
          onMouseLeave={hideTip}
        >
          <circle cx={cx} cy={cy} r={R - 18} fill="currentColor" fillOpacity={0.04} />
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#8aa0c8" strokeOpacity={0.35} strokeWidth={14} strokeDasharray="1 11" strokeLinecap="round" />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={34} fontWeight={800} fill="#e0386b">
            {compact(data.total_events)}
          </text>
          <text x={cx} y={cy + 30} textAnchor="middle" fontSize={14} fill="currentColor" fillOpacity={0.8}>
            Events
          </text>
        </g>

        {/* centre -> alerts -> outcomes */}
        {[bezier(cx + R, cy, alertsX - 62, cy), bezier(alertsX + 62, cy, rightX - 62, cy - 62), bezier(alertsX + 62, cy, rightX - 62, cy + 62)].map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke="#e0386b" strokeOpacity={0.4} strokeWidth={i === 0 ? 5 : 3} strokeLinecap="round" />
            <path className="ef-dash" d={d} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.4} strokeDasharray="2 14" strokeLinecap="round" />
            {!reduceMotion && (
              <circle r={3} fill="#fff" fillOpacity={0.9}>
                <animateMotion dur="3.2s" begin={`${i * 0.5}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        ))}
        {node(alertsX, cy, 'Alerts', data.alerts, '/alerts', '#e0386b', [`${data.alerts.toLocaleString()} alerts in the selected range`, 'Click to open the alert list'])}
        {node(rightX, cy - 62, 'Open tickets', data.open_tickets, '/tickets?status=open', '#e8a33d', [`${data.open_tickets.toLocaleString()} tickets not yet resolved or closed`, 'Click to open the ticket list'])}
        {node(rightX, cy + 62, 'Incidents', data.incidents, '/tickets?result=true_positive', '#e0386b', [`${data.incidents.toLocaleString()} tickets confirmed as true positive`, 'Click to open the ticket list'])}
      </svg>
    );
  }

  return (
    <Card
      className="dashboard-coverage-card"
      title="Events flow"
      extra={
        data?.initialized ? (
          <Button size="small" type="link" onClick={() => go(coverageUrl)}>
            Coverage settings
          </Button>
        ) : null
      }
    >
      {subtitle && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -4 }}>
          {subtitle}
        </Typography.Paragraph>
      )}
      <div ref={wrapRef} style={{ position: 'relative', overflowX: 'auto', width: '100%' }}>
        {body}
        {tip &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              style={{
                position: 'fixed',
                // Flip to the left of the cursor near the right edge and above it near the bottom edge.
                left: tip.x + 14 + 320 > window.innerWidth ? undefined : tip.x + 14,
                right: tip.x + 14 + 320 > window.innerWidth ? window.innerWidth - tip.x + 14 : undefined,
                top: tip.y + 14 + 140 > window.innerHeight ? undefined : tip.y + 14,
                bottom: tip.y + 14 + 140 > window.innerHeight ? window.innerHeight - tip.y + 14 : undefined,
                zIndex: 2000,
                pointerEvents: 'none',
                width: 'max-content',
                maxWidth: 320,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                background: 'rgba(24, 28, 38, 0.95)',
                color: '#e8ecf4',
                boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
              }}
            >
              {tip.lines.map((l, i) => (
                <div key={i} style={i === 0 ? { fontWeight: 600, wordBreak: 'break-all' } : { opacity: 0.85 }}>
                  {l}
                </div>
              ))}
            </div>,
            document.body,
          )}
      </div>
    </Card>
  );
};

export default EventFlowChart;
