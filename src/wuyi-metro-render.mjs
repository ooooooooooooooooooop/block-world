import * as THREE from 'three';
import {
  SURFACE_METRO_EXITS,
  surfaceExitOffset
} from './wuyi-metro-exits.mjs';

const TILE_SIZE = 1024;

function worldPoint(exit, lateral, along) {
  return {
    x: exit.x + exit.dx * along - exit.dz * lateral,
    z: exit.z + exit.dz * along + exit.dx * lateral
  };
}

function tilePoint(entry, exit, lateral, along) {
  const point = worldPoint(exit, lateral, along);
  return { x: point.x - entry.originX, z: point.z - entry.originZ };
}

function isEligible(entry, exit) {
  return Number.isFinite(entry.originX) && Number.isFinite(entry.originZ) &&
    exit.x >= entry.originX && exit.x < entry.originX + TILE_SIZE &&
    exit.z >= entry.originZ && exit.z < entry.originZ + TILE_SIZE;
}

function localOffset(exit, lateral, along) {
  const point = worldPoint(exit, lateral, along);
  return surfaceExitOffset(point.x, point.z) ?? 0;
}

function addCollision(entry, exit, lateral, along, width, depth, minY, maxY) {
  const point = worldPoint(exit, lateral, along);
  entry.furniture.push({
    x: point.x,
    z: point.z,
    halfX: Math.abs(exit.dz) * width / 2 + Math.abs(exit.dx) * depth / 2,
    halfZ: Math.abs(exit.dx) * width / 2 + Math.abs(exit.dz) * depth / 2,
    alongX: exit.dx,
    alongZ: exit.dz,
    halfAlong: depth / 2,
    halfAcross: width / 2,
    minY,
    maxY
  });
}

function addBox(group, entry, exit, heading, material,
  lateral, bottom, along, width, height, depth) {
  const point = tilePoint(entry, exit, lateral, along);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(point.x, bottom + height / 2, point.z);
  mesh.rotation.y = heading;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addSlopedBox(group, entry, exit, heading, material,
  lateral, centerY, along, width, height, depth, slope) {
  const point = tilePoint(entry, exit, lateral, along);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(point.x, centerY, point.z);
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), heading);
  const incline = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), slope);
  mesh.quaternion.copy(yaw).multiply(incline);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function roundedRoof(width, length, radius, depth) {
  const shape = new THREE.Shape();
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const r = Math.min(radius, halfWidth, halfLength);
  shape.moveTo(-halfWidth + r, -halfLength);
  shape.lineTo(halfWidth - r, -halfLength);
  shape.quadraticCurveTo(halfWidth, -halfLength, halfWidth, -halfLength + r);
  shape.lineTo(halfWidth, halfLength - r);
  shape.quadraticCurveTo(halfWidth, halfLength, halfWidth - r, halfLength);
  shape.lineTo(-halfWidth + r, halfLength);
  shape.quadraticCurveTo(-halfWidth, halfLength, -halfWidth, halfLength - r);
  shape.lineTo(-halfWidth, -halfLength + r);
  shape.quadraticCurveTo(-halfWidth, -halfLength, -halfWidth + r, -halfLength);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.06,
    bevelThickness: 0.035,
    curveSegments: 8,
    steps: 1
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function addOneExit(group, entry, sample, m, sign, exit) {
  const profile = exit.profile;
  const heading = Math.atan2(exit.dx, exit.dz);
  const widthScale=profile.width/6.4;
  const baseYValue = sample(entry, exit.x, exit.z);
  const baseY = (Number.isFinite(baseYValue) ? baseYValue : 62.5)+.1;
  const roofBottom = baseY + 3.72;
  const roofWidth = profile.width + 0.8;
  const roofLength = profile.approach + profile.length + 0.8;
  const roofCenter = (profile.length - profile.approach) / 2;
  const roofDepth = 0.22;
  const roof = new THREE.Mesh(
    roundedRoof(roofWidth, roofLength, 1.1, roofDepth), m.dark);
  const roofPoint = tilePoint(entry, exit, 0, roofCenter);
  roof.position.set(roofPoint.x, roofBottom, roofPoint.z);
  roof.rotation.y = heading;
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);

  // The 2025 canopy has a pale soffit beneath the dark rounded metal edge.
  addBox(group,entry,exit,heading,m.cream,0,roofBottom-.08,roofCenter,roofWidth-.22,.04,roofLength-.3);
  // Warm edge strip, paired ceiling lights, and the black station header.
  const roofTop = roofBottom + roofDepth + 0.035;
  const halfW = roofWidth / 2;
  const halfL = roofLength / 2;
  for (const lateral of [-halfW + 0.08, halfW - 0.08]) {
    addBox(group, entry, exit, heading, m.glow, lateral, roofTop,
      roofCenter, 0.07, 0.055, roofLength - 1.4);
  }
  for (const along of [roofCenter - halfL + 0.08, roofCenter + halfL - 0.08]) {
    addBox(group, entry, exit, heading, m.glow, 0, roofTop,
      along, roofWidth - 1.4, 0.055, 0.07);
  }
  for (const lateral of [-2.05, 2.05]) {
    addBox(group, entry, exit, heading, m.glow, lateral,
      roofBottom - 0.10, 1.0, 1.25, 0.025, 0.42);
  }

  const headerAlong = -1.95;
  const headerBottom = baseY + 2.72;
  addBox(group, entry, exit, heading, m.dark, 0, headerBottom,
    headerAlong, profile.width - 0.7, 0.82, 0.2);
  if (typeof sign === 'function') {
    const faceYaw = Math.atan2(-exit.dx, -exit.dz);
    const signY = headerBottom + 0.42;
    const labels = [
      { text: '1号线', lateral: -2.3, width: 0.8, bg: '#ba3c42' },
      { text: '2号线', lateral: -1.4, width: 0.8, bg: '#1689b5' },
      { text: '五一广场站', lateral: 0.3, width: 2.5, bg: '#101216' },
      { text: exit.id + ' 出入口', lateral: 2.25, width: 1.1, bg: '#101216' }
    ];
    for (const label of labels) {
      const point = tilePoint(entry, exit, label.lateral*widthScale, headerAlong - 0.115);
      sign(group, label.text, point.x, signY, point.z,
        label.width*widthScale, 0.48, faceYaw, label.bg, '#f5f6f4');
    }
  }

  // Three shallow plinth steps, landing, and 32 descending treads.
  const plinthRun = profile.approach / profile.plinthSteps;
  const plinthRise = profile.topRise / profile.plinthSteps;
  for (let i = 0; i < profile.plinthSteps; i++) {
    const start = -profile.approach + i * plinthRun;
    const top = (i + 1) * plinthRise;
    addBox(group, entry, exit, heading, m.pavement, 0,
      baseY + i * plinthRise, start + plinthRun / 2,
      profile.width, plinthRise, plinthRun);
    addBox(group, entry, exit, heading, m.trim, 0,
      baseY + top, start + plinthRun - 0.025,
      profile.width, 0.018, 0.05);
  }

  addBox(group, entry, exit, heading, m.pavement, 0,
    baseY + profile.topRise - 0.12, profile.landingLength / 2,
    profile.width, 0.12, profile.landingLength);
  const tactile = new THREE.MeshLambertMaterial({
    color: '#e4c14f'
  });
  for (const along of [0.18, profile.landingLength - 0.22]) {
    addBox(group, entry, exit, heading, tactile, 0,
      baseY + profile.topRise + 0.008, along,
      profile.width - 0.35, 0.025, 0.16);
  }

  const stairRun = profile.length - profile.landingLength;
  const treadRun = stairRun / profile.stairSteps;
  const totalDrop = profile.topRise + profile.depth;
  for (let i = 0; i < profile.stairSteps; i++) {
    const start = profile.landingLength + i * treadRun;
    const top = profile.topRise - totalDrop * (i + 1) / profile.stairSteps;
    const blockHeight = Math.max(0.08, top + profile.depth);
    const blockBottom = top + profile.depth <= 0.08
      ? baseY + top - 0.08
      : baseY - profile.depth;
    addBox(group, entry, exit, heading, m.pavement, 0,
      blockBottom, start + treadRun / 2,
      profile.width, blockHeight, treadRun);
    addBox(group, entry, exit, heading, m.trim, 0,
      baseY + top, start + 0.025,
      profile.width, 0.018, 0.05);
  }

  // Two escalators beside a visible stair lane; a solid end wall closes
  // the modeled run. The full station beyond it is not reconstructed.
  const stairSlope = Math.atan2(totalDrop, stairRun);
  const meanFloor = baseY + (profile.topRise - profile.depth) / 2;
  const stairLane = { lateral: -2.15*widthScale, width: 1.72*widthScale };
  for (const lateral of [
    stairLane.lateral - stairLane.width / 2,
    stairLane.lateral + stairLane.width / 2
  ]) {
    addSlopedBox(group, entry, exit, heading, m.dark, lateral,
      meanFloor + 1.12, profile.landingLength + stairRun / 2,
      0.075, 0.075, Math.hypot(stairRun,totalDrop), stairSlope);
    addCollision(entry, exit, lateral, profile.landingLength + stairRun / 2,
      0.12, stairRun, baseY - profile.depth, baseY + profile.topRise + 1.2);
    for (let along = profile.landingLength; along <= profile.length; along += 1.8) {
      const y = baseY + localOffset(exit, lateral, along);
      addBox(group, entry, exit, heading, m.trim, lateral,
        y, along, 0.065, 0.92, 0.065);
      addCollision(entry, exit, lateral, along, 0.12, 0.12,
        y, y + 0.95);
    }
  }

  for (const lateral of [-0.22*widthScale, 1.55*widthScale]) {
    const beltWidth = 1.38*widthScale;
    addSlopedBox(group, entry, exit, heading, m.dark, lateral,
      meanFloor + 0.02, profile.landingLength + stairRun / 2,
      beltWidth, 0.12, Math.hypot(stairRun,totalDrop), stairSlope);
    for (const side of [-1, 1]) {
      const railLateral = lateral + side * (beltWidth / 2 + 0.12);
      addSlopedBox(group, entry, exit, heading, m.clearGlass, railLateral,
        meanFloor + 0.52, profile.landingLength + stairRun / 2,
        0.055, 0.92, Math.hypot(stairRun,totalDrop), stairSlope);
      addSlopedBox(group, entry, exit, heading, m.dark, railLateral,
        meanFloor + 1.0, profile.landingLength + stairRun / 2,
        0.12, 0.1, Math.hypot(stairRun,totalDrop), stairSlope);
      addCollision(entry, exit, railLateral,
        profile.landingLength + stairRun / 2, 0.18, stairRun,
        baseY - profile.depth, baseY + profile.topRise + 1.1);
    }
  }

  // Silver uprights and glass sidewalls follow the descending profile.
  const panelStep = 2;
  for (const lateral of [-profile.width / 2 + 0.12, profile.width / 2 - 0.12]) {
    for (let start = 0; start < profile.length; start += panelStep) {
      const end = Math.min(profile.length, start + panelStep);
      const middle = (start + end) / 2;
      const floorY = baseY + localOffset(exit, lateral, middle);
      const glassBottom = floorY + 0.28;
      const glassHeight = Math.max(0.2, roofBottom - glassBottom - 0.18);
      addBox(group, entry, exit, heading, m.clearGlass, lateral,
        glassBottom, middle, 0.055, glassHeight, end - start - 0.04);
      addCollision(entry, exit, lateral, middle, 0.18, end - start,
        floorY, roofBottom);
      if (start % 4 === 0 || end === profile.length) {
        const postHeight = Math.max(0.6, roofBottom - floorY);
        addBox(group, entry, exit, heading, m.trim, lateral,
          floorY, start, 0.11, postHeight, 0.11);
        addCollision(entry, exit, lateral, start, 0.16, 0.16,
          floorY, roofBottom);
      }
    }
  }

  const backHeight = roofBottom - (baseY - profile.depth);
  addBox(group, entry, exit, heading, m.cream, 0,
    baseY - profile.depth, profile.length,
    profile.width, backHeight, 0.2);
  addCollision(entry, exit, 0, profile.length, profile.width, 0.24,
    baseY - profile.depth, roofBottom);
}

export function decorateSurfaceMetroExits(group, entry, sample, m, sign) {
  if (!group || !entry || typeof sample !== 'function' || !m) return;
  if (!Array.isArray(entry.furniture)) entry.furniture = [];
  for (const exit of SURFACE_METRO_EXITS) {
    if (isEligible(entry, exit)){addOneExit(group, entry, sample, m, sign, exit);entry.surfaceMetroEvidence??=[];entry.surfaceMetroEvidence.push(exit);}
  }
}
