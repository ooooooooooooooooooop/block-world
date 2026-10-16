import * as THREE from 'three';
import{COURT_BAYS,COURT_SECTION,COURT_PORTALS,courtPortalWallGap,courtPortalOutline,COURT_FRONTAGE_BASIS}from'./wuyi-place.mjs';
import {
  COURT_BRIDGE, SUNKEN_COURT, GROUND_FLIGHTS, flightOffset,
  courtEdgesAt, courtOutline, COURT_TERRACE
} from './wuyi-underground.mjs';

// Visible curved court estimated from dated images; its outline and walking sampler share one source.
export function decorateWuyiEntrances(group, entry, sample, m, sign) {
  const court = SUNKEN_COURT;
  const bridge = COURT_BRIDGE;
  const depth = court.depth;
  const eligible = (x, z) =>
    x >= entry.originX && x < entry.originX + 1024 &&
    z >= entry.originZ && z < entry.originZ + 1024;
  const base = (x, z) => (x<entry.originX||x>entry.originX+1024||z<entry.originZ||z>entry.originZ+1024)?62.5+(z-124)*.0035+(x+2864)*.0013:(sample(entry,x,z)??62.5);
  const floorAt = (x, z) => base(x, z) - depth;

  const warmStone = new THREE.MeshLambertMaterial({ color: '#c9b99d' });
  const warmInterior = new THREE.MeshLambertMaterial({ color: '#9a7653' });
  const wood = new THREE.MeshLambertMaterial({ color: '#684a34' });
  const palePoster = new THREE.MeshLambertMaterial({ color: '#eee5db' });
  const rosePoster = new THREE.MeshLambertMaterial({ color: '#d8a0aa' });
  const canopyMaterials = [
    new THREE.MeshLambertMaterial({ color: '#d8c7ad' }),
    new THREE.MeshLambertMaterial({ color: '#c4b9a4' }),
    new THREE.MeshLambertMaterial({ color: '#d9d4c7' })
  ];

  function box(material, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x - entry.originX, y + sy / 2, z - entry.originZ);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function beam(material, a, b, width = 0.08) {
    const from = new THREE.Vector3(a[0] - entry.originX, a[1], a[2] - entry.originZ);
    const to = new THREE.Vector3(b[0] - entry.originX, b[1], b[2] - entry.originZ);
    const delta = to.clone().sub(from);
    if (delta.lengthSq() < 1e-8) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, delta.length(), width), material);
    mesh.position.copy(from.add(to).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true;
    group.add(mesh);
  }

  function orientedBox(material, x, y, z, length, height, thickness, angle) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), material);
    mesh.position.set(x - entry.originX, y + height / 2, z - entry.originZ);
    mesh.rotation.y = angle;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function geometryBuilder() {
    return { positions: [], uvs: [], indices: [] };
  }

  function pushQuad(builder, points, doubleSided = false) {
    function face(vertices) {
      const start = builder.positions.length / 3;
      for (const [x, y, z] of vertices) {
        builder.positions.push(x - entry.originX, y, z - entry.originZ);
        builder.uvs.push(x / 6, z / 6);
      }
      builder.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    face(points);
    if (doubleSided) face([points[0], points[3], points[2], points[1]]);
  }

  function addBuiltMesh(builder, material) {
    if (!builder.indices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
    geometry.setIndex(builder.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  function addHorizontalRect(builder, x1, z1, x2, z2, lift = 0) {
    const points = [
      [x1, floorAt(x1, z1) + lift, z1],
      [x1, floorAt(x1, z2) + lift, z2],
      [x2, floorAt(x2, z1) + lift, z1],
      [x2, floorAt(x2, z2) + lift, z2]
    ];
    const start = builder.positions.length / 3;
    for (const [x, y, z] of points) {
      builder.positions.push(x - entry.originX, y, z - entry.originZ);
      builder.uvs.push(x / 6, z / 6);
    }
    builder.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }

  function edgeX(side, z) {
    const edge = courtEdgesAt(z);
    return side === 'west' ? edge.west : edge.east;
  }

  function sideDirection(side, z0, z1) {
    const dx = edgeX(side, z1) - edgeX(side, z0);
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz) || 1;
    const tx = dx / length;
    const tz = dz / length;
    const sign = side === 'west' ? 1 : -1;
    return { tx, tz, nx: tz * sign, nz: -tx * sign, angle: Math.atan2(-tz, tx) };
  }

  function sidePoint(side, z, direction, offset = 0) {
    return {
      x: edgeX(side, z) + direction.nx * offset,
      z: z + direction.nz * offset
    };
  }

  const outline = courtOutline();
  const stationZs = [...new Set(outline.map((point) => point[1]))].sort((a, b) => a - b);
  const centreZ = (court.minZ + court.maxZ) / 2;
  const centreEdge = courtEdgesAt(centreZ);
  const centreX = (centreEdge.west + centreEdge.east) / 2;
  if (!eligible(centreX, centreZ)) return;

  const floorBuilder = geometryBuilder();
  const floorCuts = [];
  for (let i = 0; i < stationZs.length - 1; i++) {
    const a = stationZs[i];
    const b = stationZs[i + 1];
    const pieces = Math.ceil((b - a) / 2);
    for (let j = 0; j < pieces; j++) floorCuts.push(a + (b - a) * j / pieces);
  }
  floorCuts.push(stationZs.at(-1));
  for (let i = 0; i < floorCuts.length - 1; i++) {
    const z0 = floorCuts[i];
    const z1 = floorCuts[i + 1];
    const e0 = courtEdgesAt(z0);
    const e1 = courtEdgesAt(z1);
    const start = floorBuilder.positions.length / 3;
    const points = [
      [e0.west, floorAt(e0.west, z0) + 0.035, z0],
      [e0.west, floorAt(e0.west, z1) + 0.035, z1],
      [e0.east, floorAt(e0.east, z0) + 0.035, z0],
      [e1.east, floorAt(e1.east, z1) + 0.035, z1]
    ];
    // The west edge moves between stations, so retain the first west point at z1
    // from the trace interpolation rather than reusing the z0 edge coordinate.
    points[1][0] = e1.west;
    for (const [x, y, z] of points) {
      floorBuilder.positions.push(x - entry.originX, y, z - entry.originZ);
      floorBuilder.uvs.push(x / 6, z / 6);
    }
    floorBuilder.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
  addBuiltMesh(floorBuilder, m.pavement);

  const bridgeRange = [bridge.z - bridge.width / 2, bridge.z + bridge.width / 2];
  // Dated, explicit bays; identity is left unknown where no current tenant evidence exists.
  const baysBySide=Object.fromEntries(['west','east'].map(side=>[side,COURT_BAYS[side].map(([start,end,frontage],index)=>({id:`court-${side}-${index+1}`,start,end,frontage,index,variant:{glazed:0,recessed:2,shutter:3,service:1}[frontage],tenant:null}))]));
  const allCuts = new Set(floorCuts);
  for (const z of [bridgeRange[0], bridgeRange[1]]) {
    if (z > court.minZ && z < court.maxZ) allCuts.add(z);
  }
  for (const side of ['west', 'east']) {
    for (const bay of baysBySide[side]) {
      allCuts.add(bay.start);
      allCuts.add(bay.end);
    }
  }
  for(const p of COURT_PORTALS.filter(p=>p.placed))for(const z of[p.joinZ-p.width/2,p.joinZ+p.width/2])allCuts.add(z);
  const wallCuts = [...allCuts].sort((a, b) => a - b);

  function bayAt(side, z) {
    return baysBySide[side].find((bay) => z >= bay.start && z <= bay.end) ?? null;
  }

  const wallBuilder = geometryBuilder();
  const guardGlassBuilder = geometryBuilder();

  function wallFace(side, z0, z1, lower0, upper0, lower1, upper1, offset) {
    const direction = sideDirection(side, z0, z1);
    const p0 = sidePoint(side, z0, direction, offset);
    const p1 = sidePoint(side, z1, direction, offset);
    pushQuad(wallBuilder, [
      [p0.x, lower0, p0.z],
      [p0.x, upper0, p0.z],
      [p1.x, upper1, p1.z],
      [p1.x, lower1, p1.z]
    ], true);
  }

  function addWallCollision(side, z0, z1, minY, maxY, direction) {
    const p0 = sidePoint(side, z0, direction);
    const p1 = sidePoint(side, z1, direction);
    entry.furniture.push({
      x: (p0.x + p1.x) / 2 + direction.nx * 0.2,
      z: (p0.z + p1.z) / 2 + direction.nz * 0.2,
      halfX: Math.abs(p1.x - p0.x) / 2 + 0.3,
      halfZ: Math.abs(p1.z - p0.z) / 2 + 0.3,
      minY,
      maxY
    });
  }

  function addSideWallSegment(side, z0, z1, hasShop) {
    const portalGap=side==='west'&&courtPortalWallGap((z0+z1)/2);
    const direction = sideDirection(side, z0, z1);
    const x0 = edgeX(side, z0);
    const x1 = edgeX(side, z1);
    const bottom0 = base(x0, z0) - depth;
    const bottom1 = base(x1, z1) - depth;
    const top0 = base(x0, z0);
    const top1 = base(x1, z1);
    const bands = portalGap?[[bottom0+3.05,top0,bottom1+3.05,top1]]:hasShop
      ? [[bottom0, bottom0 + 0.48, bottom1, bottom1 + 0.48],
         [bottom0 + 3.15, top0, bottom1 + 3.15, top1]]
      : [[bottom0, top0, bottom1, top1]];
    for (const [low0, high0, low1, high1] of bands) {
      wallFace(side, z0, z1, low0, high0, low1, high1, -0.22);
      wallFace(side, z0, z1, low0, high0, low1, high1, 0.22);
    }
    addWallCollision(
      side, z0, z1,
      Math.min(bottom0, bottom1)+(portalGap?3.05:0),
      Math.min(top0, top1) - 0.05,
      direction
    );
  }

  function addSideGuardrail(side, z0, z1) {
    const direction = sideDirection(side, z0, z1);
    const p0 = sidePoint(side, z0, direction, 0.08);
    const p1 = sidePoint(side, z1, direction, 0.08);
    const ground0 = base(edgeX(side, z0), z0);
    const ground1 = base(edgeX(side, z1), z1);
    const low0 = ground0 + 0.14;
    const low1 = ground1 + 0.14;
    const high0 = ground0 + 0.95;
    const high1 = ground1 + 0.95;
    pushQuad(guardGlassBuilder, [
      [p0.x, low0, p0.z], [p0.x, high0, p0.z],
      [p1.x, high1, p1.z], [p1.x, low1, p1.z]
    ], true);
    beam(m.trim, [p0.x, ground0 + 1.08, p0.z], [p1.x, ground1 + 1.08, p1.z], 0.075);
    orientedBox(m.trim, p0.x, ground0, p0.z, 0.09, 1.08, 0.09, direction.angle);
    entry.furniture.push({
      x: (p0.x + p1.x) / 2,
      z: (p0.z + p1.z) / 2,
      halfX: Math.abs(p1.x - p0.x) / 2 + 0.12,
      halfZ: Math.abs(p1.z - p0.z) / 2 + 0.12,
      minY: Math.min(ground0, ground1),
      maxY: Math.max(ground0, ground1) + 1.08
    });
  }

  for (const side of ['west', 'east']) {
    for (let i = 0; i < wallCuts.length - 1; i++) {
      const z0 = wallCuts[i];
      const z1 = wallCuts[i + 1];
      const mid = (z0 + z1) / 2;
      addSideWallSegment(side, z0, z1, Boolean(bayAt(side, mid)));
      const inBridge = mid >= bridgeRange[0] && mid <= bridgeRange[1];
      if (!inBridge) addSideGuardrail(side, z0, z1);
    }
  }
  addBuiltMesh(wallBuilder, m.cream);
  addBuiltMesh(guardGlassBuilder, m.clearGlass);

  function addCladding(side) {
    const step = 0.62;
    for (let z = court.minZ + 2; z < court.maxZ - 2; z += step) {
      const direction = sideDirection(side, Math.max(court.minZ, z - 0.3), Math.min(court.maxZ, z + 0.3));
      const p = sidePoint(side, z, direction, 0.34);
      const y = base(edgeX(side, z), z) - 1.55;
      const material = Math.floor((z - court.minZ) / step) % 3 === 0 ? m.cream : warmStone;
      orientedBox(material, p.x, y, p.z, 0.16, 1.45, 0.1, direction.angle);
    }
  }
  addCladding('west');
  addCladding('east');

  function addShopfronts(side) {
    for (const bay of baysBySide[side]) {
      const direction = sideDirection(side, bay.start, bay.end);
      const width = bay.end - bay.start;
      const midZ = (bay.start + bay.end) / 2;
      const edge = courtEdgesAt(midZ);
      const edgeXAtMid = side === 'west' ? edge.west : edge.east;
      const floorY = floorAt(edgeXAtMid, midZ);
      // The east commercial bays sit below the intermediate gallery. Their
      // display, fascia and awning must all stay below its floor, not cut walkers.
      const underGallery=side==='east'&&bay.end>=COURT_TERRACE.minZ&&bay.start<=COURT_TERRACE.maxZ;
      const verticalScale=1;
      const frontOffset = 1.08;
      const frontX = edgeXAtMid + direction.nx * frontOffset;
      const frontZ = midZ + direction.nz * frontOffset;
      const panelLength = width - 0.28;
      const sillY = floorY + 0.48 * verticalScale;
      const glassHeight = 2.55 * verticalScale;

      // Shallow warm interior, clear glazing, timber frames, counters, and plants
      // give each bay a different photo-informed frontage without fake branding.
      orientedBox(warmInterior, edgeXAtMid + direction.nx * 0.34,
        sillY, midZ + direction.nz * 0.34, panelLength, glassHeight, 0.06, direction.angle);
      orientedBox(m.clearGlass, frontX, sillY, frontZ,
        panelLength, glassHeight, 0.055, direction.angle);
      orientedBox(wood, frontX, floorY + (underGallery?2.78:3.05), frontZ,
        width - 0.08, underGallery?.27:.48, 0.38, direction.angle);
      orientedBox(m.cream, frontX, floorY + 0.43 * verticalScale, frontZ,
        width - 0.08, 0.12 * verticalScale, 0.34, direction.angle);

      const end0 = sidePoint(side, bay.start, direction, frontOffset);
      const end1 = sidePoint(side, bay.end, direction, frontOffset);
      orientedBox(wood, end0.x, floorY + 0.45 * verticalScale, end0.z, 0.12, underGallery?3.05:3.2, 0.16, direction.angle);
      orientedBox(wood, end1.x, floorY + 0.45 * verticalScale, end1.z, 0.12, underGallery?3.05:3.2, 0.16, direction.angle);

      const counterWidth = Math.min(3.0, width * 0.48);
      const counterZ = midZ + direction.nz * 0.58 + ((bay.index % 2) ? -0.65 : 0.65);
      orientedBox(wood, edgeXAtMid + direction.nx * 0.58, floorY + 0.78 * verticalScale,
        counterZ, counterWidth, 0.82 * verticalScale, 0.48, direction.angle);
      orientedBox(warmStone, edgeXAtMid + direction.nx * 0.58, floorY + 1.62 * verticalScale,
        counterZ, counterWidth * 0.7, 0.08, 0.3, direction.angle);

      if(bay.frontage==='shutter'){
        orientedBox(m.trim,frontX+direction.nx*.08,floorY+.48,frontZ+direction.nz*.08,panelLength,2.35,.08,direction.angle);
        for(let h=.65;h<2.8;h+=.18)orientedBox(m.dark,frontX+direction.nx*.13,floorY+h,frontZ+direction.nz*.13,panelLength,.025,.035,direction.angle);
      }else if(bay.frontage==='service'){
        orientedBox(m.cream,frontX+direction.nx*.08,floorY+.48,frontZ+direction.nz*.08,panelLength,2.35,.10,direction.angle);
        orientedBox(m.dark,frontX+direction.nx*.15,floorY+.15,frontZ+direction.nz*.15,1.2,2.55,.08,direction.angle);
      }
      if (bay.variant === 0 || bay.variant === 2) {
        const posterMaterial = bay.index % 2 ? palePoster : rosePoster;
        const posterZ = midZ + direction.nz * 0.82;
        orientedBox(posterMaterial, edgeXAtMid + direction.nx * 0.83,
          floorY + 1.12 * verticalScale, posterZ, Math.min(1.55, width * 0.25), 1.42 * verticalScale, 0.045, direction.angle);
      } else if (bay.variant === 3) {
        for (let slat = 0; slat < 5; slat++) {
          orientedBox(slat % 2 ? warmStone : wood, frontX,
            floorY + 1.6 * verticalScale + slat * 0.22 * verticalScale, frontZ,
            panelLength * 0.54, 0.075, 0.055, direction.angle);
        }
      }

      if (bay.index % 3 !== 1) {
        const canopy = canopyMaterials[bay.index % canopyMaterials.length];
        const awning=orientedBox(canopy, edgeXAtMid + direction.nx * 1.35,
          floorY + (underGallery?3.03:3.6), midZ + direction.nz * 1.35,
          width + 0.25, 0.10, 0.72, direction.angle);
        awning.userData={courtShopAwning:true,side,underGallery,upperDeckY:base(edgeXAtMid,midZ)+COURT_TERRACE.offset+.1};
      }

      if (bay.index % 2 === 0) {
        const potZ = bay.start + direction.tz * 0.6;
        const pot = sidePoint(side, potZ, direction, 0.58);
        orientedBox(warmStone, pot.x, floorY + 0.02 * verticalScale, pot.z, 0.48, 0.42, 0.46, direction.angle);
        box(m.hedge, pot.x, floorY + 0.43 * verticalScale, pot.z, 0.36, 0.52, 0.36);
        box(m.leaf, pot.x + 0.12, floorY + 0.67 * verticalScale, pot.z - 0.08, 0.18, 0.6, 0.2);
      }

      const colliderCenterX = edgeXAtMid + direction.nx * frontOffset;
      const colliderCenterZ = midZ + direction.nz * frontOffset;
      entry.furniture.push({
        x: colliderCenterX,
        z: colliderCenterZ,
        halfX: Math.abs(direction.tx) * width / 2 + 0.12,
        halfZ: Math.abs(direction.tz) * width / 2 + 0.12,
        minY: sillY,
        maxY: Math.min(base(edgeXAtMid, midZ) - 0.05, sillY + glassHeight)
      });
    }
  }
  addShopfronts('west');
  addShopfronts('east');

  // The two end retaining walls stop at the shared stair openings.
  for (const z of [court.minZ, court.maxZ]) {
    const flight = z === court.maxZ ? GROUND_FLIGHTS[0] : GROUND_FLIGHTS[1];
    const edge = courtEdgesAt(z);
    const spans = [
      [edge.west, flight.x - flight.width / 2],
      [flight.x + flight.width / 2, edge.east]
    ];
    for (const [x0, x1] of spans) {
      if (x1 - x0 < 0.1) continue;
      const x = (x0 + x1) / 2;
      const y = base(x, z);
      box(m.cream, x, y - depth, z, x1 - x0, depth, 0.42);
      entry.furniture.push({
        x, z, halfX: (x1 - x0) / 2, halfZ: 0.25,
        minY: y - depth, maxY: y - 0.05
      });
      box(m.clearGlass, x, y + 0.12, z, x1 - x0, 0.88, 0.08);
      entry.furniture.push({
        x, z, halfX: (x1 - x0) / 2, halfZ: 0.12,
        minY: y, maxY: y + 1.0
      });
    }
  }

  // Bridge deck follows the sampler at its four corners. Its rails are physical,
  // while the court wall collision remains below the deck level at this crossing.
  const bridgeDeck = geometryBuilder();
  const bx0 = bridge.minX;
  const bx1 = bridge.maxX;
  const bz0 = bridge.z - bridge.width / 2;
  const bz1 = bridge.z + bridge.width / 2;
  const bridgePoints = [
    [bx0, base(bx0, bz0) + 0.12, bz0],
    [bx0, base(bx0, bz1) + 0.12, bz1],
    [bx1, base(bx1, bz0) + 0.12, bz0],
    [bx1, base(bx1, bz1) + 0.12, bz1]
  ];
  const bridgeStart = bridgeDeck.positions.length / 3;
  for (const [x, y, z] of bridgePoints) {
    bridgeDeck.positions.push(x - entry.originX, y, z - entry.originZ);
    bridgeDeck.uvs.push(x / 6, z / 6);
  }
  bridgeDeck.indices.push(bridgeStart, bridgeStart + 1, bridgeStart + 2,
    bridgeStart + 2, bridgeStart + 1, bridgeStart + 3);
  addBuiltMesh(bridgeDeck, m.pavement);

  for (const z of [bz0, bz1]) {
    for (let x0 = bridge.minX; x0 < bridge.maxX; x0 += 2.5) {
      const x1 = Math.min(bridge.maxX, x0 + 2.5);
      const y0 = base(x0, z) + 0.12;
      const y1 = base(x1, z) + 0.12;
      const postX = (x0 + x1) / 2;
      const postY = (y0 + y1) / 2;
      box(m.trim, x0, y0, z, 0.08, 1.08, 0.08);
      const pane = geometryBuilder();
      pushQuad(pane, [
        [x0, y0 + 0.18, z], [x0, y0 + 0.9, z],
        [x1, y1 + 0.9, z], [x1, y1 + 0.18, z]
      ], true);
      addBuiltMesh(pane, m.clearGlass);
      beam(m.trim, [x0, y0 + 1.08, z], [x1, y1 + 1.08, z], 0.075);
      entry.furniture.push({
        x: postX, z, halfX: (x1 - x0) / 2 + 0.08, halfZ: 0.12,
        minY: Math.min(y0, y1), maxY: Math.max(y0, y1) + 1.12
      });
      void postY;
    }
  }
  const bridgePath = [];
  for (let x = bridge.minX - 3; x <= bridge.maxX + 5; x += 5) {
    bridgePath.push({ x, y: base(x, bridge.z) + 0.14, z: bridge.z });
  }
  bridgePath.push({
    x: bridge.maxX + 5,
    y: base(bridge.maxX + 5, bridge.z) + 0.14,
    z: bridge.z
  });
  entry.pedestrianPaths.push({
    id: 'wuyi-court-bridge', kind: 'footway', width: 4,
    points: bridgePath, authored: true, placement: bridge.basis
  });

  for (const flight of GROUND_FLIGHTS) {
    const run = (flight.length - flight.landingLength) / 2;
    const tread = run / (flight.steps / 2);
    const boundaries = [
      ...Array.from({ length: flight.steps / 2 + 1 }, (_, i) => i * tread),
      run + flight.landingLength,
      ...Array.from({ length: flight.steps / 2 }, (_, i) =>
        run + flight.landingLength + (i + 1) * tread)
    ];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const a = boundaries[i];
      const b = boundaries[i + 1];
      const s = (a + b) / 2;
      const x = flight.x + flight.dx * s;
      const z = flight.z + flight.dz * s;
      const top = base(x, z) + flightOffset(flight, s) + 0.1;
      const bottom = base(x, z) - depth;
      box(m.cream, x, bottom, z, flight.width, Math.max(0.08, top - bottom), b - a);
      box(m.trim, x, top + 0.006, z, flight.width, 0.018, 0.055);
    }
    for (const lateral of [-flight.width / 2, flight.width / 2, -flight.width / 2 + 3.6]) {
      for (let s = 0; s < flight.length; s += 0.5) {
        const x = flight.x - flight.dz * lateral + flight.dx * s;
        const z = flight.z + flight.dx * lateral + flight.dz * s;
        const y = base(x, z) + flightOffset(flight, s);
        if(x>flight.x&&Math.abs(x-flight.x-flight.width/2)<.01&&s>=run-.05&&s<run+flight.landingLength+.05)continue;
        if (s % 2 < 0.1) box(m.trim, x, y, z, 0.07, 1.05, 0.07);
        const end = Math.min(flight.length, s + 0.5);
        const endX = flight.x - flight.dz * lateral + flight.dx * end;
        const endZ = flight.z + flight.dx * lateral + flight.dz * end;
        beam(m.dark, [x, y + 1.02, z], [
          endX, base(endX, endZ) + flightOffset(flight, end) + 1.02, endZ
        ], 0.075);
      }
    }
    // Paired escalators retain the translucent guards and dark handrails.
    for (const lateral of [-flight.width / 2 + 1, -flight.width / 2 + 2.7]) {
      for (let s = 0; s < flight.length; s += 0.5) {
        const x = flight.x - flight.dz * lateral + flight.dx * s;
        const z = flight.z + flight.dx * lateral + flight.dz * s;
        const y = base(x, z) + flightOffset(flight, s);
        box(m.dark, x, y + 0.11, z, 1.35, 0.04, 0.45);
        for (const side of [-0.7, 0.7]) {
          box(m.clearGlass, x + side, y + 0.18, z, 0.065, 0.8, 0.48);
          const endZ = z + flight.dz * 0.5;
          beam(m.dark, [x + side, y + 1, z], [
            x + side, base(x, endZ) +
              flightOffset(flight, Math.min(flight.length, s + 0.5)) + 1, endZ
          ], 0.1);
        }
      }
    }
    for(const side of[-1,1])for(const[a,b]of(side===1?[[0,run],[run+flight.landingLength,flight.length]]:[[0,flight.length]])){
      entry.furniture.push({x:flight.x+side*flight.width/2,z:flight.z+flight.dz*(a+b)/2,halfX:.16,halfZ:(b-a)/2,minY:base(flight.x,flight.z)-depth,maxY:base(flight.x,flight.z)+1.05});
    }

  }

  // Intermediate gallery: visible floor and walking sampler share its curved
  // boundary. Lower-level movement stays beneath it instead of snapping upward.
  const terraceDeck=geometryBuilder(),terraceSoffit=geometryBuilder(),terracePath=[];
  for(let z=COURT_TERRACE.minZ;z<COURT_TERRACE.maxZ;z+=2){
    const z1=Math.min(z+2,COURT_TERRACE.maxZ),a=courtEdgesAt(z),b=courtEdgesAt(z1),x0=a.east-COURT_TERRACE.width,x1=b.east-COURT_TERRACE.width;
    const y0=base(x0,z)+COURT_TERRACE.offset+.1,y1=base(x1,z1)+COURT_TERRACE.offset+.1;
    const points=[[x0,y0,z],[x1,y1,z1],[b.east-.18,y1,z1],[a.east-.18,y0,z]];
    pushQuad(terraceDeck,points);pushQuad(terraceSoffit,points.map(([x,y,z])=>[x,y-.18,z]),true);
    const gap=z>=99||z<-58;
    if(!gap){
      beam(m.trim,[x0,y0+1.05,z],[x1,y1+1.05,z1],.065);
      box(m.trim,x0,y0,z,.07,1.05,.07);
      const pane=geometryBuilder();pushQuad(pane,[[x0,y0+.15,z],[x0,y0+.95,z],[x1,y1+.95,z1],[x1,y1+.15,z1]],true);addBuiltMesh(pane,m.clearGlass);
      const dx=x1-x0,dz=z1-z,len=Math.hypot(dx,dz);
      entry.furniture.push({x:(x0+x1)/2,z:(z+z1)/2,alongX:dx/len,alongZ:dz/len,halfAlong:len/2+.02,halfAcross:.1,minY:Math.min(y0,y1),maxY:Math.max(y0,y1)+1.1});
    }
    if((z-COURT_TERRACE.minZ)%8===0){
      const outer=a.east-.5;box(m.cream,outer,floorAt(outer,z),z,.25,depth+COURT_TERRACE.offset,.25);
      entry.furniture.push({x:outer,z,halfX:.16,halfZ:.16,minY:floorAt(outer,z),maxY:y0});
    }
    if((z-COURT_TERRACE.minZ)%6===0)terracePath.push({x:a.east-COURT_TERRACE.width/2,y:y0,z});
  }
  addBuiltMesh(terraceDeck,m.pavement);addBuiltMesh(terraceSoffit,m.cream);
  // Separate upper-level shop openings and balcony fascia; no fabricated tenants.
  for(const {start:z,end,index}of baysBySide.east){
    if(Math.abs(z-bridge.z)<8)continue;const a=courtEdgesAt(z),b=courtEdgesAt(end),y0=base(a.east,z)+COURT_TERRACE.offset+.1,y1=base(b.east,end)+COURT_TERRACE.offset+.1;
    const glazing=geometryBuilder();pushQuad(glazing,[[a.east-.08,y0+.25,z],[a.east-.08,y0+2.2,z],[b.east-.08,y1+2.2,end],[b.east-.08,y1+.25,end]],true);addBuiltMesh(glazing,m.clearGlass);
    const dx=b.east-a.east,dz=end-z,len=Math.hypot(dx,dz),angle=Math.atan2(-dz,dx);
    orientedBox(index%2?wood:warmStone,(a.east+b.east)/2-.14,y0+2.22,(z+end)/2,len,.28,.22,angle);
    box(m.trim,a.east-.18,y0,z,.13,2.48,.13);
    const frame=orientedBox(m.cream,(a.east+b.east)/2-.2,y0+.2,(z+end)/2,len,.12,.2,angle);void frame;
    if(index%3===0){const x=(a.east+b.east)/2-1;box(warmInterior,x,y0,(z+end)/2,.6,.8,.6);box(m.leaf,x,y0+.8,(z+end)/2,.85,.65,.85);}
  }
  if(typeof sign==='function'){const z=83,e=courtEdgesAt(z),x=e.east-2.2,y=base(x,z)+COURT_TERRACE.offset+2.2;sign(group,'五一广场 地下商业',x-entry.originX,y,z-entry.originZ+.01,6,.65,0,'#243b40','#fff8e9');sign(group,'五一广场 地下商业',x-entry.originX,y,z-entry.originZ-.01,6,.65,Math.PI,'#243b40','#fff8e9');}
  entry.pedestrianPaths.push({id:'wuyi-intermediate-gallery',kind:'footway',width:3,points:terracePath,authored:true,placement:COURT_TERRACE.basis});

  // One explicitly estimated below-grade connector. Surface grade remains solid.
  for(const portal of COURT_PORTALS.filter(p=>p.placed)){
    const outline=courtPortalOutline(portal),floorY=floorAt(portal.x,portal.z),ceilingY=floorY+3.1;
    const shape=new THREE.Shape();outline.forEach(([x,z],i)=>i?shape.lineTo(x-entry.originX,-(z-entry.originZ)):shape.moveTo(x-entry.originX,-(z-entry.originZ)));shape.closePath();
    const floorGeo=new THREE.ShapeGeometry(shape);floorGeo.rotateX(-Math.PI/2);const floorMesh=new THREE.Mesh(floorGeo,m.pavement);floorMesh.position.y=floorY+.08;floorMesh.receiveShadow=true;group.add(floorMesh);
    const ceiling=geometryBuilder();for(let i=1;i+1<outline.length;i++)pushQuad(ceiling,[[outline[0][0],ceilingY,outline[0][1]],[outline[i][0],ceilingY,outline[i][1]],[outline[i+1][0],ceilingY,outline[i+1][1]],[outline[0][0],ceilingY,outline[0][1]]],true);addBuiltMesh(ceiling,m.cream);
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length];if(Math.abs(a[0]-portal.connectorEndX)<.01&&Math.abs(b[0]-portal.connectorEndX)<.01)continue;
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),angle=Math.atan2(-dz,dx);
      orientedBox(m.cream,(a[0]+b[0])/2,floorY,(a[1]+b[1])/2,length,3.1,.14,angle);
      entry.furniture.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,alongX:dx/length,alongZ:dz/length,halfAlong:length/2,halfAcross:.13,minY:floorY,maxY:ceilingY,kind:'portal-corridor-wall'});
    }
    // Paired arches redrawn as geometry from the interior photograph, facing the foyer.
    for(const dz of[-1.05,1.05]){
      const z=portal.z+dz,x=portal.x+.12;
      box(m.orange,x,floorY,z, .12,2.55,1.82);
      box(m.clearGlass,x+.09,floorY+.12,z,.06,2.18,1.52);
      for(const side of[-1,1])box(m.cream,x+.15,floorY,z+side*.83,.13,2.05,.15);
      for(let n=0;n<12;n++){const a=n/12*Math.PI,b=(n+1)/12*Math.PI;beam(m.cream,[x+.15,floorY+2.03+Math.sin(a)*.83,z+Math.cos(a)*.83],[x+.15,floorY+2.03+Math.sin(b)*.83,z+Math.cos(b)*.83],.15);}
    }
    if(typeof sign==='function')sign(group,'6C',portal.x+.42-entry.originX,floorY+2.83,portal.z-entry.originZ,1.1,.5,Math.PI/2,'#d06e25','#fff5df');
    const points=[[portal.connectorEndX+.4,portal.joinZ],[portal.x+1.4,portal.joinZ],[portal.x+1.4,portal.z]].map(([x,z])=>({x,y:floorAt(x,z)+.1,z}));
    entry.pedestrianPaths.push({id:'wuyi-6C-reconstructed-foyer',kind:'footway',width:1.3,points,authored:true,placement:portal.basis});
  }
  const courtPath = [];
  for (let z = 85; z >= -48; z -= 8) {
    const edges = courtEdgesAt(z);
    const x = (edges.west + edges.east) / 2;
    courtPath.push({ x, y: floorAt(x, z) + 0.08, z });
  }
  if (courtPath.at(-1).z !== -48) {
    const edges = courtEdgesAt(-48);
    const x = (edges.west + edges.east) / 2;
    courtPath.push({ x, y: floorAt(x, -48) + 0.08, z: -48 });
  }
  entry.pedestrianPaths.push({
    id: 'wuyi-sunken-commercial', kind: 'footway', width: 5,
    points: courtPath, authored: true, placement: court.basis
  });
  entry.undergroundEvidence = {
    court, terrace:COURT_TERRACE, flights: GROUND_FLIGHTS,
    source: '2018 ground views; traced 2025-08-29 orthophoto court edge',
    surveyed: false, bridge, depthMeters: depth, section:COURT_SECTION,frontageBasis:COURT_FRONTAGE_BASIS,bays:baysBySide,portals:COURT_PORTALS,unplacedStationPortals: COURT_PORTALS.filter(p=>!p.placed).map(p=>p.id),
    scope: 'curved two-level commercial court; 6C source-anchored reconstructed foyer; 6D connection unresolved; full station not modelled'
  };
}

