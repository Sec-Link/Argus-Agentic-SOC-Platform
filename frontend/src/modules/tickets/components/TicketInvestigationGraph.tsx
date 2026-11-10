import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from 'antd';
import type { TicketInvestigationSession } from 'services/tickets';
import styles from './TicketLayout.module.css';

type GraphKind = 'task' | 'goal' | 'intent' | 'fact' | 'finding' | 'note';
type GraphNode = {
  id: string;
  type: GraphKind;
  title: string;
  summary: string;
  status: string;
  raw: unknown;
};
type GraphEdge = { source: string; target: string; relation: string };
type Point = { x: number; y: number };

const nodeTypes: Record<GraphKind, { label: string; color: string; icon: string }> = {
  task: { label: 'Task', color: '#64748b', icon: '⚑' },
  goal: { label: 'Goal', color: '#10b981', icon: '◎' },
  intent: { label: 'Intent', color: '#3b82f6', icon: '◇' },
  fact: { label: 'Fact / Activity', color: '#f59e0b', icon: '◈' },
  finding: { label: 'Finding', color: '#f43f5e', icon: '✦' },
  note: { label: 'Investigation note', color: '#8b5cf6', icon: '◌' },
};

const edgeTypes: Record<string, { label: string; color: string }> = {
  coordinates: { label: 'Coordinates', color: '#10b981' },
  plans: { label: 'Plans', color: '#3b82f6' },
  delegates: { label: 'Delegates', color: '#6366f1' },
  yields: { label: 'Yields', color: '#f59e0b' },
  responds: { label: 'Responds', color: '#8b5cf6' },
};

const buildGraph = (session: TicketInvestigationSession) => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const rootId = `session:${session.id}`;
  const add = (node: GraphNode) => { if (!nodes.some((item) => item.id === node.id)) nodes.push(node); };
  const edge = (source: string, target: string, relation: string) => {
    if (source !== target && !edges.some((item) => item.source === source && item.target === target && item.relation === relation)) {
      edges.push({ source, target, relation });
    }
  };
  add({
    id: rootId, type: 'task', title: session.title || `Investigation #${session.sequence}`,
    summary: `Ticket ${session.ticket_number} · persistent investigation session`,
    status: session.runs?.some((run) => run.status === 'running') ? 'running' : session.runs?.some((run) => run.status === 'failed') ? 'failed' : 'completed', raw: session,
  });
  const runs = session.runs || [];
  for (const run of runs) {
    const kind: GraphKind = run.role === 'main' ? 'goal' : run.role === 'planner' || run.role === 'worker' ? 'intent' : 'note';
    add({ id: `run:${run.id}`, type: kind, title: run.title, summary: run.objective || `${run.role} investigation lane`, status: run.status, raw: run });
    edge(run.parent_id ? `run:${run.parent_id}` : rootId, `run:${run.id}`, run.role === 'worker' ? 'delegates' : run.role === 'planner' ? 'plans' : 'coordinates');
    for (const message of run.messages || []) {
      if (message.role === 'system') continue;
      const messageKind: GraphKind = message.role === 'assistant' && run.role === 'worker' ? 'finding' : message.role === 'assistant' ? 'fact' : 'note';
      const messageId = `message:${message.id}`;
      add({
        id: messageId,
        type: messageKind,
        title: message.role === 'assistant' ? `${run.title} result` : `${run.title} instruction`,
        summary: message.content,
        status: run.status,
        raw: message,
      });
      edge(`run:${run.id}`, messageId, message.role === 'assistant' ? 'yields' : 'responds');
    }
  }
  return { nodes, edges };
};

const computeLayout = (nodes: GraphNode[], edges: GraphEdge[]) => {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    for (const target of outgoing.get(source) || []) {
      layer.set(target, Math.max(layer.get(target) || 0, (layer.get(source) || 0) + 1));
      indegree.set(target, (indegree.get(target) || 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  const columns = Array.from({ length: Math.max(1, ...layer.values()) + 1 }, () => [] as string[]);
  nodes.forEach((node) => columns[layer.get(node.id) || 0].push(node.id));
  const maxRows = Math.max(1, ...columns.map((column) => column.length));
  const positions = new Map<string, Point>();
  columns.forEach((column, columnIndex) => column.forEach((id, rowIndex) => {
    positions.set(id, { x: columnIndex * 360, y: ((maxRows - column.length) * 140) / 2 + rowIndex * 140 });
  }));
  return positions;
};

const displayStatus = (status: string) => ({ open: 'Queued', running: 'Running', completed: 'Completed', paused: 'Paused', cancelled: 'Cancelled', failed: 'Failed' }[status] || status || 'Open');

export default function TicketInvestigationGraph({ session }: { session: TicketInvestigationSession | null }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [highlight, setHighlight] = useState<GraphKind | ''>('');
  const [view, setView] = useState({ x: 40, y: 80, scale: 0.82 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const graph = useMemo(() => session ? buildGraph(session) : { nodes: [], edges: [] }, [session]);
  const positions = useMemo(() => computeLayout(graph.nodes, graph.edges), [graph]);
  const bounds = useMemo(() => {
    const values = [...positions.values()];
    if (!values.length) return { minX: 0, minY: 0, width: 240, height: 124 };
    const minX = Math.min(...values.map((point) => point.x)); const minY = Math.min(...values.map((point) => point.y));
    return { minX, minY, width: Math.max(...values.map((point) => point.x)) + 240 - minX, height: Math.max(...values.map((point) => point.y)) + 124 - minY };
  }, [positions]);
  const selected = graph.nodes.find((node) => node.id === selectedId) || null;
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !positions.size) return;
    const values = [...positions.values()];
    const minX = Math.min(...values.map((point) => point.x));
    const minY = Math.min(...values.map((point) => point.y));
    const width = Math.max(...values.map((point) => point.x)) + 240 - minX;
    const height = Math.max(...values.map((point) => point.y)) + 124 - minY;
    const scale = Math.max(0.35, Math.min(1, Math.min((canvas.clientWidth - 96) / width, (canvas.clientHeight - 100) / height)));
    setView({ x: (canvas.clientWidth - width * scale) / 2 - minX * scale, y: (canvas.clientHeight - height * scale) / 2 - minY * scale, scale });
  }, [positions]);

  useEffect(() => { fit(); }, [fit, session?.id]);
  useEffect(() => {
    const observer = new ResizeObserver(fit);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [fit]);

  if (!session) return <Empty description="Create or select an investigation session to view its Exploration Graph." />;

  const related = selected ? new Set(graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).flatMap((edge) => [edge.source, edge.target])) : new Set<string>();
  const zoom = (factor: number) => setView((current) => ({ ...current, scale: Math.max(0.25, Math.min(1.8, current.scale * factor)) }));
  const miniScale = Math.min(180 / bounds.width, 108 / bounds.height);
  const miniOffset = { x: (200 - bounds.width * miniScale) / 2, y: (128 - bounds.height * miniScale) / 2 };

  return <section className={styles.ticketGraphPanel}>
    <div className={styles.ticketGraphFilterbar}>
      <span>{graph.nodes.length} nodes · {graph.edges.length} relationships · persisted ticket investigation data</span>
      {selected ? <button type="button" onClick={() => setSelectedId('')}>Show all</button> : null}
    </div>
    <div
      ref={canvasRef}
      className={styles.ticketGraphCanvas}
      onWheel={(event) => { event.preventDefault(); zoom(Math.exp(-event.deltaY * 0.005)); }}
      onPointerDown={(event) => { if ((event.target as HTMLElement).closest(`.${styles.ticketGraphNode}, .${styles.ticketGraphLegend}, .${styles.ticketGraphControls}`)) return; drag.current = { x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }; }}
      onPointerMove={(event) => { if (drag.current) setView((current) => ({ ...current, x: drag.current!.originX + event.clientX - drag.current!.x, y: drag.current!.originY + event.clientY - drag.current!.y })); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}
    >
      <div className={styles.ticketGraphLegend}>
        <div className={styles.ticketGraphLegendKinds}>
          {(Object.keys(nodeTypes) as GraphKind[]).map((kind) => <button key={kind} type="button" aria-pressed={highlight === kind} onClick={() => setHighlight((current) => current === kind ? '' : kind)}>
            <i style={{ background: nodeTypes[kind].color }}>{nodeTypes[kind].icon}</i>{nodeTypes[kind].label}<small>{graph.nodes.filter((node) => node.type === kind).length}</small>
          </button>)}
        </div>
        <div className={styles.ticketGraphRelations}>{Object.values(edgeTypes).map((relation) => <span key={relation.label}><i style={{ background: relation.color }} />{relation.label}</span>)}</div>
        <small>Click a type or node to highlight; drag to pan. The stored graph stays intact.</small>
      </div>
      <div className={styles.ticketGraphControls}>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</button>
        <button type="button" aria-label="Fit graph" onClick={fit}>⌗</button>
      </div>
      <svg className={styles.ticketGraphMinimap} viewBox="0 0 200 128" aria-label="Exploration graph minimap" onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 200;
        const y = ((event.clientY - rect.top) / rect.height) * 128;
        const targetX = (x - miniOffset.x) / miniScale + bounds.minX;
        const targetY = (y - miniOffset.y) / miniScale + bounds.minY;
        const canvas = canvasRef.current;
        if (canvas) setView((current) => ({ ...current, x: canvas.clientWidth / 2 - targetX * current.scale, y: canvas.clientHeight / 2 - targetY * current.scale }));
      }}>
        {graph.edges.map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); if (!source || !target) return null; return <line key={`mini_${edge.source}_${edge.target}_${edge.relation}`} x1={miniOffset.x + (source.x + 120 - bounds.minX) * miniScale} y1={miniOffset.y + (source.y + 62 - bounds.minY) * miniScale} x2={miniOffset.x + (target.x + 120 - bounds.minX) * miniScale} y2={miniOffset.y + (target.y + 62 - bounds.minY) * miniScale} stroke="#94a3b8" strokeWidth="1" />; })}
        {graph.nodes.map((node) => { const point = positions.get(node.id); if (!point) return null; return <rect key={`mini_${node.id}`} x={miniOffset.x + (point.x - bounds.minX) * miniScale} y={miniOffset.y + (point.y - bounds.minY) * miniScale} width={Math.max(3, 240 * miniScale)} height={Math.max(3, 124 * miniScale)} rx="1" fill={nodeTypes[node.type].color} opacity=".8" />; })}
      </svg>
      <div className={styles.ticketGraphBoard} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className={styles.ticketGraphLinks} aria-hidden="true">
          {graph.edges.map((edge) => {
            const source = positions.get(edge.source); const target = positions.get(edge.target); if (!source || !target) return null;
            const style = edgeTypes[edge.relation] || { label: edge.relation, color: '#64748b' };
            const muted = Boolean((highlight && nodeById.get(edge.source)?.type !== highlight && nodeById.get(edge.target)?.type !== highlight) || (selected && !related.has(edge.source) && !related.has(edge.target)));
            return <g key={`${edge.source}_${edge.target}_${edge.relation}`} className={muted ? styles.ticketGraphEdgeMuted : ''}>
              <path d={`M ${source.x + 240} ${source.y + 62} C ${source.x + 292} ${source.y + 62}, ${target.x - 52} ${target.y + 62}, ${target.x} ${target.y + 62}`} stroke={style.color} />
              <text x={(source.x + target.x + 240) / 2} y={(source.y + target.y) / 2 + 52} fill={style.color}>{style.label}</text>
            </g>;
          })}
        </svg>
        {graph.nodes.map((node) => {
          const point = positions.get(node.id) || { x: 0, y: 0 };
          const muted = Boolean((highlight && node.type !== highlight) || (selected && !related.has(node.id)));
          const type = nodeTypes[node.type];
          return <button key={node.id} type="button" className={`${styles.ticketGraphNode} ${selectedId === node.id ? styles.ticketGraphNodeSelected : ''} ${muted ? styles.ticketGraphNodeMuted : ''} ${node.status === 'running' ? styles.ticketGraphNodeLive : ''}`} style={{ left: point.x, top: point.y, borderLeftColor: type.color }} onClick={() => setSelectedId((current) => current === node.id ? '' : node.id)}>
            <span className={styles.ticketGraphNodeHead}><i style={{ background: type.color }}>{type.icon}</i><strong>{node.title}</strong></span>
            <span className={styles.ticketGraphNodeSummary}>{node.summary || 'No detail recorded.'}</span>
            <span className={styles.ticketGraphNodeFoot}><code>{node.id.replace(/^(session|run|message):/, '$1-')}</code><em data-status={node.status}>{displayStatus(node.status)}</em></span>
          </button>;
        })}
      </div>
    </div>
    {selected ? <div className={styles.ticketGraphSheetOverlay} role="dialog" aria-modal="true" aria-label="Exploration graph node details">
      <button className={styles.ticketGraphBackdrop} type="button" aria-label="Close details" onClick={() => setSelectedId('')} />
      <aside className={styles.ticketGraphSheet}>
        <header><div><span className={styles.ticketGraphTypeTag} style={{ background: nodeTypes[selected.type].color }}>{nodeTypes[selected.type].label}</span><h2>{selected.title}</h2><code>{selected.id}</code></div><button type="button" onClick={() => setSelectedId('')} aria-label="Close details">×</button></header>
        <div className={styles.ticketGraphSheetBody}>
          <h3>Summary</h3><p>{selected.summary || 'No detail recorded.'}</p>
          <dl><dt>Status</dt><dd>{displayStatus(selected.status)}</dd><dt>Upstream</dt><dd>{graph.edges.filter((edge) => edge.target === selected.id).map((edge) => nodeById.get(edge.source)?.title).filter(Boolean).join(', ') || 'No linked nodes'}</dd><dt>Downstream</dt><dd>{graph.edges.filter((edge) => edge.source === selected.id).map((edge) => nodeById.get(edge.target)?.title).filter(Boolean).join(', ') || 'No linked nodes'}</dd></dl>
          <h3>Source record</h3><pre>{JSON.stringify(selected.raw, null, 2)}</pre>
        </div>
      </aside>
    </div> : null}
  </section>;
}
