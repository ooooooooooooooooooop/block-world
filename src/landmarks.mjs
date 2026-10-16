import * as THREE from 'three';

const box = (group, material, x, y, z, sx, sy, sz) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y + sy / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

function makeMaterials() {
  return {
    stone: new THREE.MeshStandardMaterial({ color: 0x8a8174, roughness: 0.94 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9b4030, roughness: 0.88 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x373d40, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc99b49, roughness: 0.82 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xd0b58a, roughness: 0.95 }),
    artA: new THREE.MeshStandardMaterial({ color: 0x3d6974, roughness: 0.85 }),
    artB: new THREE.MeshStandardMaterial({ color: 0xb49a65, roughness: 0.85 }),
  };
}

export function classifyLandmark(poi) {
  const model = String(poi?.model ?? '').toLowerCase();
  const text = `${poi?.name ?? ''} ${poi?.category ?? ''}`;
  if (model.includes('tianxin') || text.includes('天心阁')) return 'tianxin-ge';
  if (model.includes('dufu') || text.includes('杜甫江阁')) return 'dufu-jiangge';
  if (model.includes('art') || /艺术建筑|美术馆|艺术中心/.test(text)) return 'art-architecture';
  if (model.includes('ancient') || /古建|寺|书院|祠|殿|阁|楼/.test(text)) return 'ancient-architecture';
  return null;
}

/** Build an explicitly unverified blockout for a POI with a confirmed world position. */
export function createLandmark(poi) {
  const p = poi?.world;
  const kind = classifyLandmark(poi);
  if (!kind || !p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.z))) return null;
  const group = new THREE.Group();
  group.name = `landmark-${poi.id ?? kind}`;
  group.position.set(Number(p.x), Number(p.y) || 0, Number(p.z));
  group.userData = { poiId: poi.id ?? null, model: kind, verification: 'unverified-graybox', sourceIds: poi.sourceIds ?? [] };
  const m = makeMaterials();

  if (kind === 'tianxin-ge') {
    box(group, m.stone, -8, 0, -7, 16, 1.4, 14);
    box(group, m.red, -5.2, 1.4, -4.5, 10.4, 7.8, 9);
    box(group, m.roof, -7.6, 9.2, -6.6, 15.2, 1.25, 13.2);
    box(group, m.red, -4.4, 10.45, -3.8, 8.8, 5.8, 7.6);
    box(group, m.roof, -6.8, 16.25, -5.9, 13.6, 1.2, 11.8);
    box(group, m.gold, -0.45, 17.45, -0.45, 0.9, 1.5, 0.9);
  } else if (kind === 'dufu-jiangge') {
    box(group, m.stone, -7, 0, -6, 14, 1.2, 12);
    for (let floor = 0; floor < 4; floor++) {
      const y = 1.2 + floor * 4.2;
      const width = 8.6 - floor * 0.35;
      box(group, m.red, -width / 2, y, -width / 2, width, 3.05, width);
      box(group, m.roof, -(width + 2.7) / 2, y + 3.05, -(width + 2.7) / 2, width + 2.7, 0.95, width + 2.7);
    }
    box(group, m.gold, -0.35, 18.6, -0.35, 0.7, 1.6, 0.7);
  } else if (kind === 'ancient-architecture') {
    box(group, m.stone, -9, 0, -7, 18, 1, 14);
    box(group, m.wall, -7, 1, -4.5, 14, 4.8, 9);
    box(group, m.red, -2.4, 1, -4.55, 4.8, 4.8, 0.35);
    box(group, m.roof, -9, 5.8, -6.5, 18, 1.2, 13);
    box(group, m.gold, -1, 2.2, -4.78, 2, 1.4, 0.28);
  } else {
    box(group, m.stone, -8, 0, -7, 16, 0.8, 14);
    box(group, m.artA, -7, 0.8, -5, 5, 9, 9);
    box(group, m.artB, 1.2, 0.8, -4.2, 5.8, 5.5, 8.4);
    box(group, m.wall, -2, 0.8, 3.7, 8.5, 3.1, 2.2);
  }
  return group;
}
