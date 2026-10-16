import * as THREE from 'three';

// Preserve CPU query shapes before render batching removes their tight bounds.
// The geometry is the same source used by batching; these meshes are not drawn.
export function snapshotCameraOccluders(root) {
  root.updateWorldMatrix(true,true);
  const inverse = root.matrixWorld.clone().invert(), records = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(m => m && !m.transparent && m.opacity > 0)) return;
    if (mesh.isInstancedMesh) mesh.computeBoundingBox();
    else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
    const bounds = (mesh.isInstancedMesh ? mesh.boundingBox : mesh.geometry.boundingBox).clone().applyMatrix4(matrix);
    records.push({mesh,matrix,bounds});
  });
  return records;
}

export function nearCameraOccluders(records, rootMatrix, point, radius) {
  const found = [], radiusSquared = radius * radius;
  for (const {mesh,matrix,bounds} of records) {
    const dx = Math.max(bounds.min.x-point.x,0,point.x-bounds.max.x);
    const dy = Math.max(bounds.min.y-point.y,0,point.y-bounds.max.y);
    const dz = Math.max(bounds.min.z-point.z,0,point.z-bounds.max.z);
    if (dx*dx+dy*dy+dz*dz > radiusSquared) continue;
    mesh.matrixWorld.multiplyMatrices(rootMatrix,matrix);
    found.push(mesh);
  }
  return found;
}

// Composition and obstruction are independent of input/movement. Mouse look is
// applied directly; only the return from an obstructed camera distance is eased.
export function createThirdPersonRig(camera) {
  const anchor = new THREE.Vector3(), desired = new THREE.Vector3();
  const direction = new THREE.Vector3(), right = new THREE.Vector3();
  const origin = new THREE.Vector3(), target = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  let distance = null, evidence = null;

  function update({ x, y, z, yaw, pitch, photo = false, dt = 0, occluders = [] }) {
    const orbit = photo ? 9 : 7;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    anchor.set(x, y + 1.72, z);
    desired.set(x - fx * orbit * Math.cos(pitch),
      y + 1.55 + (photo ? 1.8 : 1.1) - Math.sin(pitch) * orbit,
      z - fz * orbit * Math.cos(pitch));
    direction.copy(desired).sub(anchor);
    const idealDistance = direction.length();
    direction.normalize();
    right.set(Math.cos(yaw), 0, Math.sin(yaw));
    const halfHeight = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + .10;
    const halfWidth = (halfHeight - .10) * camera.aspect + .10;
    const offsets = [[0, 0], [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
      [-halfWidth, halfHeight], [halfWidth, halfHeight]];
    const meshes = occluders.filter(o => o.visible &&
      (Array.isArray(o.material) ? o.material : [o.material]).some(m => m && !m.transparent && m.opacity > 0));
    let limit = idealDistance, hitCount = 0;
    for (const [rx, up] of offsets) {
      origin.copy(anchor).addScaledVector(right, rx); origin.y += up;
      ray.set(origin, direction); ray.near = .05; ray.far = idealDistance + .25;
      const hit = ray.intersectObjects(meshes, false).find(h => {
        const material = Array.isArray(h.object.material)
          ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
        return material && !material.transparent && material.opacity > 0;
      });
      if (hit) { limit = Math.min(limit, Math.max(.05, hit.distance - .25)); hitCount++; }
    }
    if (distance == null || dt <= 0 || limit < distance) distance = limit;
    else distance += (limit - distance) * (1 - Math.exp(-10 * dt));
    camera.position.copy(anchor).addScaledVector(direction, Math.min(distance, limit));
    target.set(x + fx * 2, y + 1.55, z + fz * 2);
    camera.lookAt(target);
    evidence = { orbitMeters: orbit, idealDistance, solvedDistance: Math.min(distance, limit),
      blocked: limit < idealDistance - 1e-5, hideAvatar: distance < 1.6, hitRays: hitCount, candidateMeshes: meshes.length, rayCount: 5 };
    return evidence;
  }

  return { update, reset() { distance = null; evidence = null; },
    getEvidence: () => evidence ? { ...evidence } : null };
}
