import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, findRoute } from '../src/routes.mjs';

test('long edge midpoint projects the route start onto the real road', () => {
  const graph = buildGraph({ nodes: [[1, 0, 0, 0], [2, 1000, 0, 0]], edges: [[1, 2, 1000]] });
  const route = findRoute(graph, { x: 500, y: 0, z: 3 }, { x: 900, y: 0, z: 0 });
  assert.equal(route.reachable, true);
  assert.equal(route.startSnapDistance, 3);
  assert.deepEqual(route.points[0], { x: 500, y: 0, z: 0 });
  assert.deepEqual(route.points.at(-1), { x: 900, y: 0, z: 0 });
  assert.equal(route.distance, 400);
});

test('same-edge projections use only the covered fraction of the explicit edge', () => {
  const graph = buildGraph({ nodes: [[1, 0, 0, 0], [2, 1000, 0, 0]], edges: [[1, 2, 800]] });
  const route = findRoute(graph, { x: 200, y: 0, z: 0 }, { x: 800, y: 0, z: 0 });
  assert.equal(route.reachable, true);
  assert.ok(Math.abs(route.distance - 480) < 1e-9);
  assert.deepEqual(route.points, [{ x: 200, y: 0, z: 0 }, { x: 800, y: 0, z: 0 }]);
});

test('geometrically crossing but disconnected roads remain disconnected', () => {
  const graph = buildGraph({
    nodes: [[1, -10, 0, 0], [2, 10, 0, 0], [3, 0, 0, -10], [4, 0, 0, 10]],
    edges: [[1, 2, 20], [3, 4, 20]], snapRadius: 2,
  });
  const route = findRoute(graph, { x: -5, y: 0, z: 0 }, { x: 0, y: 0, z: 5 });
  assert.equal(route.reachable, false);
  assert.equal(route.reason, 'disconnected-road-network');
});

test('an off-road target reports its original location and road offset', () => {
  const graph = buildGraph({ nodes: [[1, 0, 0, 0], [2, 1000, 0, 0]], edges: [[1, 2, 1000]] });
  const target = { x: 600, y: 0, z: 100 };
  const route = findRoute(graph, { x: 0, y: 0, z: 0 }, target);
  assert.equal(route.reachable, true);
  assert.equal(route.targetSnapDistance, 100);
  assert.deepEqual(route.targetPosition, target);
  assert.deepEqual(route.targetRoadPosition, { x: 600, y: 0, z: 0 });
  assert.ok(route.targetSnapNote);
});

test('a nearer isolated target edge yields to the nearest reachable road edge', () => {
  const graph = buildGraph({
    nodes: [
      [1, 0, 0, 0], [2, 0, 0, 20], [3, 50, 0, 20], [4, 50, 0, 5], [5, 120, 0, 5],
      [6, 80, 0, 1], [7, 120, 0, 1],
    ],
    edges: [[1, 2, 20], [2, 3, 50], [3, 4, 15], [4, 5, 70], [6, 7, 40]],
    snapRadius: 150,
  });
  const target = { x: 100, y: 0, z: 0 };
  const route = findRoute(graph, { x: 0, y: 0, z: 0 }, target);
  assert.equal(route.reachable, true);
  assert.equal(route.targetSnapDistance, 5);
  assert.deepEqual(route.targetPosition, target);
  assert.deepEqual(route.targetRoadPosition, { x: 100, y: 0, z: 5 });
  assert.ok(route.targetSnapNote);
});

test('all nearby target edges disconnected from the start still fail', () => {
  const graph = buildGraph({
    nodes: [[1, 0, 0, 0], [2, 10, 0, 0], [3, 90, 0, 1], [4, 110, 0, 1], [5, 90, 0, 5], [6, 110, 0, 5]],
    edges: [[1, 2, 10], [3, 4, 20], [5, 6, 20]],
    snapRadius: 10,
  });
  const route = findRoute(graph, { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
  assert.equal(route.reachable, false);
  assert.equal(route.reason, 'disconnected-road-network');
  assert.equal(route.targetSnapDistance, 1);
  assert.deepEqual(route.targetRoadPosition, { x: 100, y: 0, z: 1 });
});

test('a start more than four metres from the centerline is rejected explicitly', () => {
  const graph = buildGraph({ nodes: [[1, 0, 0, 0], [2, 1000, 0, 0]], edges: [[1, 2, 1000]] });
  const route = findRoute(graph, { x: 500, y: 0, z: 5 }, { x: 800, y: 0, z: 0 });
  assert.equal(route.reachable, false);
  assert.equal(route.reason, 'off-road-start');
  assert.equal(route.startSnapDistance, 5);
});

test('bridge levels are distinguished and a one-way edge preserves its direction', () => {
  const graph = buildGraph({
    nodes: [[1, 0, 0, 0], [2, 100, 0, 0], [3, 0, 10, 0], [4, 100, 10, 0]],
    edges: [[1, 2, 100, true], [3, 4, 100, true]], snapRadius: 5,
  });
  const bridgeToGround = findRoute(graph, { x: 80, y: 10, z: 0 }, { x: 20, y: 0, z: 0 });
  assert.equal(bridgeToGround.reason, 'disconnected-road-network');
  const againstFlow = findRoute(graph, { x: 80, y: 10, z: 0 }, { x: 20, y: 10, z: 0 });
  assert.equal(againstFlow.reason, 'disconnected-road-network');
});
