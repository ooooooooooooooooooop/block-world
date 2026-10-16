import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeBlockPerson, CHARACTER_PART_BUDGET } from '../src/character.mjs';

function collect(root) {
  const meshes = [];
  root.traverse((node) => { if (node.isMesh) meshes.push(node); });
  return meshes;
}

test('player and NPC retain the required root and paired limb groups', () => {
  for (const isNpc of [false, true]) {
    const person = makeBlockPerson(isNpc, 0x4d88b2, 1);
    assert.ok(person.root instanceof THREE.Group);
    assert.equal(person.arms.length, 2);
    assert.equal(person.legs.length, 2);
    for (const limb of [...person.arms, ...person.legs]) assert.ok(limb instanceof THREE.Group);
  }
});

test('all visible parts stay BoxGeometry and the model has broad, grounded bounds', () => {
  for (const variant of [0, 1, 2, 4]) {
    const { root } = makeBlockPerson(false, 0x4d88b2, variant);
    const meshes = collect(root);
    // The crowd renderer enforces both this total limit and per-surface capacities.
    assert.ok(meshes.length <= CHARACTER_PART_BUDGET, `NPC batch budget (${CHARACTER_PART_BUDGET}): ${meshes.length}`);
    for (const mesh of meshes) assert.ok(mesh.geometry instanceof THREE.BoxGeometry, mesh.name);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    assert.ok(bounds.min.y >= -0.011 && bounds.min.y <= 0.011, `feet at ground: ${bounds.min.y}`);
    assert.ok(bounds.max.y >= 1.87 && bounds.max.y <= 1.98, `head height: ${bounds.max.y}`);
    assert.ok(bounds.getSize(new THREE.Vector3()).x >= .90, 'shoulder / hand silhouette stays broad');
    assert.ok(bounds.getSize(new THREE.Vector3()).x <= 1.05, 'silhouette does not spread into a T pose');
  }
});

test('face details and fore-aft footwear preserve the local -Z forward convention', () => {
  const { root } = makeBlockPerson();
  const meshes = collect(root);
  const named = (name) => meshes.filter((mesh) => mesh.name === name);
  const eye = named('eye-white')[0];
  const head = named('head')[0];
  const shoe = named('shoe')[0];
  assert.equal(named('eye-white').length, 2);
  assert.equal(named('eye-pupil').length, 2);
  assert.ok(eye.position.z < head.position.z);
  assert.ok(shoe.position.z < 0);
  assert.ok(root.rotation.y === 0, 'neutral pose faces local -Z before world heading is applied');
});

test('arm and leg pivots remain at joints and respond to the existing swing API', () => {
  const { root, arms, legs } = makeBlockPerson(true, 0x8b5c9e, 2);
  assert.deepEqual(arms.map((arm) => arm.position.y), [1.4, 1.4]);
  assert.deepEqual(legs.map((leg) => leg.position.y), [0.7, 0.7]);
  arms[0].rotation.x = 0.28;
  legs[1].rotation.x = -0.32;
  assert.equal(arms[0].rotation.x, 0.28);
  assert.equal(legs[1].rotation.x, -0.32);
  root.updateMatrixWorld(true);
  assert.ok(Number.isFinite(arms[0].matrixWorld.elements[13]));
});

 test('original hair variants have distinct tagged silhouettes and NPC palette input is respected', () => {
  const variants = [0, 1, 2].map((variant) => collect(makeBlockPerson(true, 0x577e89, variant).root));
  const styles = variants.map((meshes) => meshes.filter((mesh) => mesh.name.startsWith('hair-')).map((mesh) => mesh.name).join('|'));
  assert.equal(new Set(styles).size, 3);
  const npc = collect(makeBlockPerson(true, 0xb47759, 1).root).find((mesh) => mesh.name === 'shirt-body');
  assert.equal(npc.material.color.getHex(), 0xb47759);
});

test('the photo prop and shared pose return to neutral after photography', () => {
  const person=makeBlockPerson();const parts=collect(person.root).filter(p=>p.name.startsWith('camera-'));
  assert.equal(parts.length,3);assert.ok(parts.every(p=>p.userData.renderEnabled===false));
  person.pose({mode:'selfie'});
  assert.ok(parts.every(p=>p.userData.renderEnabled===true));assert.ok(person.arms[1].rotation.z>2);
  person.pose({mode:'idle'});
  assert.ok(parts.every(p=>p.userData.renderEnabled===false));assert.equal(person.arms[1].rotation.z,0);
  assert.ok(person.legs.every(p=>p.rotation.x===0));
});
