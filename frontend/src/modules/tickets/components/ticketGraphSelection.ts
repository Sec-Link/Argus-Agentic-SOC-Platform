export type GraphLink = { source: string; target: string; relation: string };
type Node = { id: string; type: string; status: string };

const graphKind = (node: Node) => node.type === 'task' || (node.status === 'origin' && node.type === 'fact') ? 'begin' : node.type;

// Traverse upstream and downstream separately. Walking an undirected component
// would cross shared goals and incorrectly highlight unrelated Worker branches.
export function relatedNodeIds(nodes: Node[], edges: GraphLink[], nodeId: string): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return new Set();
  const valid = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const related = new Set([nodeId]);
  for (const upstream of [true, false]) {
    const paths = upstream ? valid.filter((edge) => edge.relation !== 'proves' || edge.target === nodeId) : valid;
    const outgoing = new Map<string, GraphLink[]>();
    for (const edge of paths) {
      const source = upstream ? edge.target : edge.source;
      outgoing.set(source, [...(outgoing.get(source) || []), edge]);
    }
    const queue = [nodeId], queued = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      for (const edge of outgoing.get(queue[index]) || []) {
        const target = upstream ? edge.source : edge.target;
        related.add(target);
        // Goal-completion feedback is an endpoint, not provenance for siblings.
        if (!upstream && edge.relation === 'proves' && ['goal', 'begin'].includes(graphKind(byId.get(target)!))) continue;
        if (!queued.has(target)) { queued.add(target); queue.push(target); }
      }
    }
  }
  return related;
}
