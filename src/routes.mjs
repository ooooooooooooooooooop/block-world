const pointOf = (node) => ({ x: node.x, y: node.y, z: node.z });
const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finiteY = (p) => p && p.y != null && Number.isFinite(Number(p.y));
const CELL_SIZE = 128;
const EDGE_SAMPLE_STEP = CELL_SIZE / 2;

function cellKey(ix, iz) { return `${ix}_${iz}`; }

function addEdgeToGrid(grid, edge) {
  const dx = edge.to.x - edge.from.x, dz = edge.to.z - edge.from.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / EDGE_SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = Math.floor((edge.from.x + dx * t) / CELL_SIZE);
    const iz = Math.floor((edge.from.z + dz * t) / CELL_SIZE);
    const key = cellKey(ix, iz);
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = new Set());
    bucket.add(edge);
  }
}

function nearbyEdges(grid, position, radius) {
  const ix = Math.floor(position.x / CELL_SIZE), iz = Math.floor(position.z / CELL_SIZE);
  // Edge sampling is at most 64m apart. The extra cell covers that gap.
  const range = Math.ceil((radius + EDGE_SAMPLE_STEP) / CELL_SIZE);
  const found = new Set();
  for (let x = ix - range; x <= ix + range; x++) {
    for (let z = iz - range; z <= iz + range; z++) {
      for (const edge of grid.get(cellKey(x, z)) ?? []) found.add(edge);
    }
  }
  return found;
}

function projectToEdge(position, edge) {
  const useY = finiteY(position);
  const px = Number(position.x), pz = Number(position.z);
  const py = useY ? Number(position.y) : 0;
  const ax = edge.from.x, az = edge.from.z;
  const ay = useY ? edge.from.y : 0;
  const dx = edge.to.x - ax, dz = edge.to.z - az;
  const dy = useY ? edge.to.y - ay : 0;
  const denominator = dx * dx + dy * dy + dz * dz;
  const t = denominator > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / denominator)) : 0;
  const point = {
    x: ax + dx * t,
    y: edge.from.y + (edge.to.y - edge.from.y) * t,
    z: az + dz * t,
  };
  const horizontal = horizontalDistance(position, point);
  const vertical = useY ? Math.abs(py - point.y) : 0;
  return { edge, t, point, horizontalDistance: horizontal, verticalDistance: vertical, distance: Math.hypot(horizontal, vertical) };
}

function nearestEdge(grid, position, radius) {
  let best = null;
  for (const edge of nearbyEdges(grid, position, radius)) {
    const candidate = projectToEdge(position, edge);
    if (!best || candidate.distance < best.distance || (candidate.distance === best.distance && edge.id < best.edge.id)) best = candidate;
  }
  return best;
}

function projectedEdges(grid, position, radius) {
  return [...nearbyEdges(grid, position, radius)]
    .map((edge) => projectToEdge(position, edge))
    .filter((candidate) => candidate.horizontalDistance <= radius)
    .sort((a, b) => a.horizontalDistance - b.horizontalDistance || a.verticalDistance - b.verticalDistance || a.edge.id - b.edge.id);
}

class MinHeap {
  items = [];
  push(item) {
    const a = this.items; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= item.cost) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const root = a[0], tail = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1, right = left + 1;
        if (left >= a.length) break;
        const child = right < a.length && a[right].cost < a[left].cost ? right : left;
        if (a[child].cost >= tail.cost) break;
        a[i] = a[child]; i = child;
      }
      a[i] = tail;
    }
    return root;
  }
  get size() { return this.items.length; }
}

/** Build a graph using only explicitly supplied road nodes and edges. */
export function buildGraph(graphData) {
  const nodes = new Map();
  const adjacency = new Map();
  for (const row of graphData?.nodes ?? []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [id, x, y, z] = row;
    if (id == null || ![x, y, z].every((v) => Number.isFinite(Number(v))) || nodes.has(id)) continue;
    const node = { id, x: Number(x), y: Number(y), z: Number(z) };
    nodes.set(id, node); adjacency.set(id, []);
  }
  const edges = [];
  const grid = new Map();
  for (const row of graphData?.edges ?? []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [fromId, toId, rawDistance, direction] = row;
    const from = nodes.get(fromId), to = nodes.get(toId);
    if (!from || !to || fromId === toId) continue;
    const weight = rawDistance == null ? horizontalDistance(from, to) : Number(rawDistance);
    if (!Number.isFinite(weight) || weight < 0) continue;
    const edge = { id: edges.length, from, to, fromId, toId, distance: weight, forward: true, reverse: direction !== true && direction !== 'forward' };
    edges.push(edge);
    addEdgeToGrid(grid, edge);
    adjacency.get(fromId).push({ id: toId, distance: weight });
    if (edge.reverse) adjacency.get(toId).push({ id: fromId, distance: weight });
  }
  return {
    nodes, adjacency, edges, edgeGrid: grid,
    snapRadius: Number.isFinite(graphData?.snapRadius) ? Math.max(0, graphData.snapRadius) : 150,
  };
}

const publicPosition = (position) => {
  const result = { x: Number(position.x), z: Number(position.z) };
  if (finiteY(position)) result.y = Number(position.y);
  return result;
};

function dedupePoints(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) > 1e-7) result.push(point);
  }
  return result;
}

/** Dijkstra between projections that lie on explicit graph edges. */
export function findRoute(graph, startPosition, targetPosition) {
  const empty = (reason, extra = {}) => ({ points: [], distance: 0, reachable: false, reason, ...extra });
  if (!graph?.nodes?.size || !graph.edgeGrid?.size) return empty('no-road-graph');
  const valid = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z));
  if (!valid(startPosition) || !valid(targetPosition)) return empty('invalid-position');

  const maxSnap = graph.snapRadius ?? 150;
  const searchRadius = Math.max(4, maxSnap);
  const start = nearestEdge(graph.edgeGrid, startPosition, searchRadius);
  if (!start) return empty('no-nearby-road-node');
  const targets = projectedEdges(graph.edgeGrid, targetPosition, maxSnap);
  const endpointMeta = (target) => ({
    startSnapDistance: start.horizontalDistance,
    targetSnapDistance: target?.horizontalDistance ?? null,
    startPosition: publicPosition(startPosition),
    targetPosition: publicPosition(targetPosition),
    startRoadPosition: pointOf(start.point),
    targetRoadPosition: target ? pointOf(target.point) : null,
    targetVerticalOffset: target?.verticalDistance ?? null,
    targetSnapNote: target && target.horizontalDistance > 0.25 ? '路线终点落在附近道路投影点，目标位置仍为路外原始位置。' : null,
  });
  if (start.horizontalDistance > 4) return empty('off-road-start', endpointMeta(targets[0]));
  if (!targets.length) return empty('no-nearby-road-node', endpointMeta(null));

  // Seed every endpoint reachable from the start projection, respecting one-way edges.
  const distances = new Map();
  const previous = new Map();
  const seeds = new Set();
  const heap = new MinHeap();
  const seed = (id, cost) => {
    if (cost >= (distances.get(id) ?? Infinity)) return;
    distances.set(id, cost); seeds.add(id); previous.delete(id); heap.push({ id, cost });
  };
  if (start.edge.forward) seed(start.edge.toId, (1 - start.t) * start.edge.distance);
  if (start.edge.reverse) seed(start.edge.fromId, start.t * start.edge.distance);
  while (heap.size) {
    const current = heap.pop();
    if (current.cost !== distances.get(current.id)) continue;
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      const nextCost = current.cost + edge.distance;
      if (nextCost >= (distances.get(edge.id) ?? Infinity)) continue;
      distances.set(edge.id, nextCost); previous.set(edge.id, current.id); seeds.delete(edge.id);
      heap.push({ id: edge.id, cost: nextCost });
    }
  }

  let bestRoute = null;
  let bestTarget = null;
  const consider = (target, route) => {
    if (!bestRoute) { bestRoute = route; bestTarget = target; return; }
    const snapDelta = target.horizontalDistance - bestTarget.horizontalDistance;
    if (snapDelta < -1e-7 || (Math.abs(snapDelta) <= 1e-7 && (
      route.distance < bestRoute.distance - 1e-7 ||
      (Math.abs(route.distance - bestRoute.distance) <= 1e-7 && (
        target.verticalDistance < bestTarget.verticalDistance ||
        (target.verticalDistance === bestTarget.verticalDistance && target.edge.id < bestTarget.edge.id)
      ))
    ))) { bestRoute = route; bestTarget = target; }
  };

  for (const target of targets) {
    // A direct segment on the same real edge is valid only in its travel direction.
    if (start.edge.id === target.edge.id) {
      if (target.t >= start.t && start.edge.forward) {
        consider(target, { distance: (target.t - start.t) * start.edge.distance, points: dedupePoints([start.point, target.point]), startNodeId: start.edge.fromId, targetNodeId: start.edge.toId });
      } else if (target.t <= start.t && start.edge.reverse) {
        consider(target, { distance: (start.t - target.t) * start.edge.distance, points: dedupePoints([start.point, target.point]), startNodeId: start.edge.toId, targetNodeId: start.edge.fromId });
      }
    }

    const targetOptions = [];
    if (target.edge.forward) targetOptions.push({ id: target.edge.fromId, cost: target.t * target.edge.distance });
    if (target.edge.reverse) targetOptions.push({ id: target.edge.toId, cost: (1 - target.t) * target.edge.distance });
    for (const option of targetOptions) {
      const routeCost = distances.get(option.id);
      if (!Number.isFinite(routeCost)) continue;
      const total = routeCost + option.cost;
      if (bestTarget && target.horizontalDistance > bestTarget.horizontalDistance + 1e-7) continue;
      if (bestTarget && Math.abs(target.horizontalDistance - bestTarget.horizontalDistance) <= 1e-7 && total >= bestRoute.distance - 1e-7) continue;
      const ids = [option.id];
      while (!seeds.has(ids[ids.length - 1])) {
        const parent = previous.get(ids[ids.length - 1]);
        if (parent == null) { ids.length = 0; break; }
        ids.push(parent);
      }
      if (!ids.length) continue;
      ids.reverse();
      const rootId = ids[0];
      const points = dedupePoints([start.point, ...ids.map((id) => pointOf(graph.nodes.get(id))), target.point]);
      consider(target, { distance: total, points, startNodeId: rootId, targetNodeId: option.id });
    }
  }
  if (!bestRoute) return empty('disconnected-road-network', endpointMeta(targets[0]));
  return {
    points: bestRoute.points, distance: bestRoute.distance, reachable: true, reason: null,
    startNodeId: bestRoute.startNodeId, targetNodeId: bestRoute.targetNodeId, ...endpointMeta(bestTarget),
  };
}
