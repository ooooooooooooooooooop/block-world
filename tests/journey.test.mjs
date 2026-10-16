import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourney } from '../src/journey.mjs';

test('saved photo records real subjects, never the nearby caption; duplicate event is idempotent', () => {
  const journey = createJourney();
  const photo = { id: 'p1', place: '五一广场', createdAt: '2026-10-16T00:00:00+08:00', visibleSubjects: [{ osmId: 'a', name: '平和堂', visibleSamples: 2 }, { osmId: 'b', name: '被挡住的楼', visibleSamples: 0 }] };
  assert.equal(journey.goals()[0].done, false);
  assert.equal(journey.savedPhoto(photo), true);
  assert.equal(journey.savedPhoto(photo), false);
  assert.equal(Object.keys(journey.snapshot().photos).length, 1);
  assert.deepEqual(Object.keys(journey.snapshot().subjects), ['osm:a']);
  assert.equal(journey.goals()[0].done, true);
});

test('a saved landscape with no identified building still counts as a photograph', () => {
  const journey = createJourney();journey.savedPhoto({ id: 'p2', place: '长沙街头', visibleSubjects: [] });
  assert.equal(journey.goals()[0].done, true);assert.deepEqual(journey.snapshot().subjects, {});
});

test('failed interaction never completes a task, repeated NPC identity is not double counted', () => {
  const journey = createJourney();assert.equal(journey.talk({ found: false, npcId: 'npc' }), false);
  assert.equal(journey.goals()[1].done, false);
  const result = { found: true, npcId: 'chunk:road:0', name: '散步的市民', place: '五一广场附近', message: '沿街走走' };
  assert.equal(journey.talk(result), true);assert.equal(journey.talk(result), false);
  assert.equal(journey.goals()[1].done, true);assert.equal(Object.keys(journey.snapshot().encounters).length, 1);
});

test('restoring a journey preserves photos, subjects, interactions and their independent goals', () => {
  const journey = createJourney();journey.savedPhoto({ id: 'p', visibleSubjects: [{ osmId: 'a', name: '楼', visibleSamples: 1 }] });journey.talk({ found: true, npcId: 'n', name: '市民' });journey.observeDistance(125);
  const copy = createJourney({ saved: JSON.parse(JSON.stringify(journey.snapshot())) });
  assert.deepEqual(copy.snapshot(), journey.snapshot());assert.ok(copy.goals().every((g) => g.done));
  assert.equal(copy.savedPhoto({ id: 'p' }), false);assert.equal(copy.talk({ found: true, npcId: 'n' }), false);
});

test('legacy visits migrate only known places and never imply photos or conversations', () => {
  const journey = createJourney({ pois: [{ id: 'known', name: '五一广场' }], legacyVisited: ['known', 'unknown'], distance: 40 });
  assert.deepEqual(Object.keys(journey.snapshot().discoveries), ['known']);assert.equal(journey.goals()[0].done, false);assert.equal(journey.goals()[1].done, false);
});

test('invalid distances cannot unlock walking goal or reduce real progress', () => {
  const journey = createJourney();for (const value of [NaN, Infinity, -1, 'bad']) journey.observeDistance(value);
  assert.equal(journey.goals()[2].done, false);journey.observeDistance(105);journey.observeDistance(2);
  assert.equal(journey.snapshot().distance, 105);assert.equal(journey.goals()[2].done, true);
});

test('UI snapshots cannot mutate the saved state', () => {
  const journey = createJourney();journey.discover({ id: 'w', name: '五一广场' });const copy = journey.snapshot();copy.discoveries.w.name = 'changed';
  assert.equal(journey.snapshot().discoveries.w.name, '五一广场');
});
