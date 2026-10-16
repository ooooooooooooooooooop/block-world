import assert from 'node:assert/strict';
import test from 'node:test';
import { HEIGHT_DECISIONS, resolveWuyiHeight } from '../src/wuyi-heights.mjs';

test('T1 adopts the completed CTBUH height and preserves the OSM claim', () => {
  assert.deepEqual(resolveWuyiHeight({ id: 527545453, heightTag: '452', levelsTag: '93' }), {
    heightMeters: 452.1, levels: 94, sourceHeightMeters: 452,
    decision: 'ctbuh-as-built', reviewRequired: false
  });
});

test('T2 resolves design values against the completed building record', () => {
  const result = resolveWuyiHeight({
    id: '527545451', tags: { height: '315', 'building:levels': '65' }
  });
  assert.equal(result.heightMeters, 308);
  assert.equal(result.levels, 63);
  assert.equal(result.sourceHeightMeters, 315);
  assert.equal(result.reviewRequired, false);
  assert.match(HEIGHT_DECISIONS['527545451'].evidenceURL, /^https:\/\//);
});

test('the two anonymous 420 m claims map to evidence-backed buildings', () => {
  const shimao = resolveWuyiHeight({ id: '543405242', heightTag: '420', levelsTag: '80' });
  const taizhen = resolveWuyiHeight({ id: '543405244', heightTag: '420', levelsTag: '82' });
  assert.deepEqual([shimao.heightMeters, shimao.levels, shimao.sourceHeightMeters], [343, 74, 420]);
  assert.equal(shimao.reviewRequired, false);
  assert.deepEqual([taizhen.heightMeters, taizhen.levels, taizhen.sourceHeightMeters], [160, 36, 420]);
  assert.equal(taizhen.reviewRequired, true);
});

test('planned or floor-derived heights remain estimates requiring review', () => {
  for (const id of ['273260867', '273260769', '87058059']) {
    const item = HEIGHT_DECISIONS[id];
    const result = resolveWuyiHeight({ id, heightTag: null, levelsTag: null });
    assert.equal(result.heightMeters, item.heightMeters);
    assert.equal(result.levels, item.levels);
    assert.equal(result.sourceHeightMeters, null);
    assert.equal(result.reviewRequired, true);
    assert.match(item.heightBasis, /estimate|planning|planned|assumed/i);
    assert.match(item.evidenceURL, /^https:\/\//);
  }
});

test('Heiwado OSM geometry remains the 40 m podium; tower remains reviewable', () => {
  const result = resolveWuyiHeight({ id: '52072595', heightTag: '40', levelsTag: '6' });
  assert.deepEqual([result.heightMeters, result.levels, result.sourceHeightMeters], [40, 6, 40]);
  assert.equal(result.reviewRequired, true);
  assert.match(HEIGHT_DECISIONS['52072595'].evidence, /28th floor|28楼/);
});

test('unknown IDs keep an uncapped positive source value and flag unknown high towers', () => {
  const result = resolveWuyiHeight({ id: 'unknown-1', height: 420, levels: 82 });
  assert.deepEqual([result.heightMeters, result.levels, result.sourceHeightMeters], [420, 82, 420]);
  assert.equal(result.reviewRequired, true);
  assert.equal(resolveWuyiHeight({ id: 'unknown-2', heightTag: '48' }).heightMeters, 48);
});

test('missing or invalid source height defaults to six metres and requests review', () => {
  assert.deepEqual(resolveWuyiHeight({ id: 'unknown', heightTag: '0', levelsTag: '0' }), {
    heightMeters: 6, levels: null, sourceHeightMeters: null,
    decision: 'default-no-valid-source-height', reviewRequired: true
  });
});

test('resolution does not mutate its input', () => {
  const input = Object.freeze({
    id: '527545451', heightTag: '315', levelsTag: '65',
    tags: Object.freeze({ height: '315', 'building:levels': '65' })
  });
  const before = JSON.stringify(input);
  resolveWuyiHeight(input);
  assert.equal(JSON.stringify(input), before);
});


test('processed default and floor estimates remain reviewable despite having numeric heights', () => {
  for (const [height, heightSource] of [[6, 'default-estimate'], [21, 'building-levels-estimate']]) {
    const result = resolveWuyiHeight({id: 'unknown-processed', height, heightSource});
    assert.equal(result.heightMeters, height);
    assert.equal(result.reviewRequired, true);
    assert.equal(result.decision, 'retain-processed-estimate-needs-review');
  }
});
