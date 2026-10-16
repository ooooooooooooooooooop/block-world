import * as THREE from 'three';
import {createPixelPalette,boxSurfaceUV} from './pixel-surfaces.mjs';
import {createPeopleBatch} from './people-batch.mjs';
import {createCityLighting} from './city-lighting.mjs';
import {makeBlockPerson} from './character.mjs';
import {createThirdPersonRig,snapshotCameraOccluders,nearCameraOccluders} from './camera-rig.mjs';
import {MOVE_SPEED,RUN_SPEED,dampAngle,dampVelocity,bodyHeading} from './motion.mjs';
import { chunkKey } from './geo.mjs';
import {surfaceExitPolygons,surfaceExitAt,surfaceExitOffset}from'./wuyi-metro-exits.mjs';
import { createLandmark } from './landmarks.mjs';
import {SUNKEN_COURT,cutUndergroundTriangles,undergroundOffset,undergroundBoundary,isUndergroundOpening} from './wuyi-underground.mjs';
import { resolveWuyiHeight } from './wuyi-heights.mjs';
import { createWuyiKit, inWuyi, wuyiStart, wuyiGround } from './wuyi.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v) => Number.isFinite(Number(v));
const point3 = (p) => Array.isArray(p)
  ? { x: Number(p[0]), y: Number(p[1] ?? 0), z: Number(p[2]) }
  : { x: Number(p?.x), y: Number(p?.y ?? 0), z: Number(p?.z) };
const colorMaterial = (color, opts = {}) => new THREE.MeshLambertMaterial({color,...Object.fromEntries(Object.entries(opts).filter(([k])=>!["roughness","metalness"].includes(k)))});

function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Vertical occupancy is shared by player, NPCs and diagnostics. An upper floor
// must not block a real ground-level recess or a below-grade passage.
export function hitsBuilding(area,x,z,y=null){return(y==null||y<(area.maxY??Infinity)&&y+1.9>(area.minY??-Infinity))&&pointInPolygon(x,z,area.polygon)&&!(area.holes??[]).some(ring=>pointInPolygon(x,z,ring));}

export function hitsFurniture(entry,x,z,y=null){
 return (entry?.furniture||[]).some(a=>{
  if(y!=null&&a.minY!=null&&!(y<a.maxY&&y+1.9>a.minY))return false;
  const dx=x-a.x,dz=z-a.z;
  if(a.halfAlong!=null)return Math.abs(dx*a.alongX+dz*a.alongZ)<a.halfAlong&&Math.abs(-dx*a.alongZ+dz*a.alongX)<a.halfAcross;
  return a.halfX?Math.abs(dx)<a.halfX&&Math.abs(dz)<a.halfZ:Math.hypot(dx,dz)<a.radius;
 });
}

function carveUnderground(geometry,entry){
 const p=geometry.attributes.position;if(!p)return geometry;geometry.computeBoundingBox();const b=geometry.boundingBox;
 if(![{minX:SUNKEN_COURT.minX-20,maxX:SUNKEN_COURT.maxX+20,minZ:SUNKEN_COURT.minZ-20,maxZ:SUNKEN_COURT.maxZ+20},...surfaceExitPolygons()].some(a=>b.max.x+entry.originX>=a.minX&&b.min.x+entry.originX<=a.maxX&&b.max.z+entry.originZ>=a.minZ&&b.min.z+entry.originZ<=a.maxZ))return geometry;
 const cut=cutUndergroundTriangles(Array.from(p.array),geometry.index?Array.from(geometry.index.array):Array.from({length:p.count},(_,i)=>i),entry.originX,entry.originZ),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(cut.positions,3));g.setIndex(cut.indices);g.computeVertexNormals();geometry.dispose();return g;
}
function walkingSurface(entry,x,z,referenceHeight=null){const metro=surfaceExitAt(x,z);if(metro)return(sampleTerrain(entry,metro.exit.x,metro.exit.z)??0)+surfaceExitOffset(x,z)+.1;const terrain=sampleTerrain(entry,x,z),offset=undergroundOffset(x,z,referenceHeight==null?null:referenceHeight-(terrain??0));return offset==null?(nearestRoadSurface(entry,x,z,referenceHeight)?.y??sampleTerrain(entry,x,z)):(sampleTerrain(entry,x,z)??0)+offset+.1;}

function terrainValues(terrain) {
  const r = Number(terrain?.resolution), size = Number(terrain?.size);
  const raw = terrain?.heights;
  const heights = Array.isArray(raw?.[0]) ? raw.flat() : raw;
  if (!Number.isInteger(r) || r < 2 || !Number.isFinite(size) || size <= 0 || !Array.isArray(heights) || heights.length !== r * r) return null;
  const values = heights.map(Number);
  return values.every(Number.isFinite) ? { resolution: r, size, heights: values } : null;
}

export function sampleTerrain(entry, x, z) {
  const t = entry?.terrain;
  if (!t) return null;
  const gx = clamp((x - entry.originX) / t.size * (t.resolution - 1), 0, t.resolution - 1);
  const gz = clamp((z - entry.originZ) / t.size * (t.resolution - 1), 0, t.resolution - 1);
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const x1 = Math.min(t.resolution - 1, x0 + 1), z1 = Math.min(t.resolution - 1, z0 + 1);
  const tx = gx - x0, tz = gz - z0, r = t.resolution;
  const h00 = t.heights[z0 * r + x0], h10 = t.heights[z0 * r + x1];
  const h01 = t.heights[z1 * r + x0], h11 = t.heights[z1 * r + x1];
  // Match the two rendered triangles (a,c,b) and (b,c,d), not a bilinear patch.
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

export function nearestRoadSurface(entry, x, z, referenceHeight = null) {
  const layers = new Map();
  const terrainY = sampleTerrain(entry,x,z) ?? -Infinity;
  for (const road of entry?.roads ?? []) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const projected = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1);
    // Rendered road ribbons have flat end caps. The nearest-point distance alone
    // otherwise creates an invisible semicircle past the first/last endpoint.
    if((i===1&&projected<0)||(i===road.points.length-1&&projected>1))continue;
    const t = clamp(projected, 0, 1);
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    const y = Math.max(a.y + (b.y - a.y) * t, terrainY) + .15;
    const layer = Number(road.layer) || (road.bridge ? 1 : road.tunnel ? -1 : 0);
    if (distance <= road.width / 2 && (!layers.has(layer) || distance < layers.get(layer).distance)) {
      layers.set(layer, { y, bridge: road.bridge, distance, id:road.id });
    }
  }
  let closest = null;
  for (const surface of layers.values()) {
    const score = Number.isFinite(referenceHeight) ? Math.abs(surface.y - referenceHeight) + surface.distance * .025 : surface.distance;
    if (!closest || score < closest.score) closest = {...surface,score};
  }
  return closest;
}

function drapeSurface(mesh, entry, offset) {
  if (!mesh) return;
  mesh.position.y = 0;
  const p = mesh.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, (sampleTerrain(entry, p.getX(i) + entry.originX, p.getZ(i) + entry.originZ) ?? 0) + offset);
  p.needsUpdate = true; mesh.geometry.computeVertexNormals();
}

function polygonSurface(polygon, material, y = 0, holes = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(Number(polygon[0][0]), -Number(polygon[0][1]));
  for (const p of polygon.slice(1)) shape.lineTo(Number(p[0]), -Number(p[1]));
  shape.closePath();
  for (const ring of holes) {
    if (ring.length < 3) continue;
    const hole = new THREE.Path(); hole.moveTo(Number(ring[0][0]), -Number(ring[0][1]));
    for (const p of ring.slice(1)) hole.lineTo(Number(p[0]), -Number(p[1]));
    hole.closePath(); shape.holes.push(hole);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

function roadRibbon(points, width, material) {
  if (points.length < 2) return null;
  const positions = [], indices = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz) || 1;
    const nx = dz / len * width / 2, nz = -dx / len * width / 2;
    positions.push(p.x - nx, p.y + 0.12, p.z - nz, p.x + nx, p.y + 0.12, p.z + nz);
    if (i > 0) {
      const a = (i - 1) * 2, b = i * 2;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if(material.map?.userData.repeatMetres)boxSurfaceUV(geometry,material.map.userData.repeatMetres);
  return new THREE.Mesh(geometry, material);
}

function disposeTree(root) {
  root?.traverse?.((obj) => {
    obj.geometry?.dispose?.();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) if (!material?.userData?.worldShared){if(!material?.map?.userData.sharedSurface)material?.map?.dispose();material?.emissiveMap?.dispose();material?.dispose?.();}
  });
}

function mergeStaticMeshes(group, material) {
  const meshes=group.children.filter(o=>o.isMesh&&!o.isInstancedMesh&&o.material===material);
  if(meshes.length<2)return;
  const positions=[],normals=[],uvs=[];
  for(const mesh of meshes){
    mesh.updateMatrix();const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();g.applyMatrix4(mesh.matrix);
    for(const v of g.attributes.position.array)positions.push(v);for(const v of g.attributes.normal.array)normals.push(v);
    if(g.attributes.uv){for(const v of g.attributes.uv.array)uvs.push(v);}else for(let i=0;i<g.attributes.position.count*2;i++)uvs.push(0);
    g.dispose();group.remove(mesh);mesh.geometry.dispose();
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeBoundingSphere();
  const merged=new THREE.Mesh(geometry,material);merged.castShadow=meshes.some(m=>m.castShadow);merged.receiveShadow=meshes.some(m=>m.receiveShadow);group.add(merged);
}


function withinBounds(x, z, bounds) {
  return !bounds || ((bounds.minX == null || x >= bounds.minX) && (bounds.maxX == null || x <= bounds.maxX)
    && (bounds.minZ == null || z >= bounds.minZ) && (bounds.maxZ == null || z <= bounds.maxZ));
}

/** Create the local Three.js world. It renders supplied geodata only; missing chunks remain blocked. */
export async function createWorld({ canvas, manifest, pois = [], onState, onNotice } = {}) {
  if (!canvas) throw new TypeError('createWorld requires a canvas');
  if (!manifest || manifest.schemaVersion !== 1) throw new TypeError('Unsupported or missing world manifest schemaVersion');
  const size = Number(manifest.chunkSize) || 1024;
  const chunkSources = manifest.chunks && typeof manifest.chunks === 'object' ? manifest.chunks : {};
  const bounds = manifest.bounds ?? null;
  const maxCache = clamp(Number(manifest.cacheLimit) || 36, 9, 64);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x88badb);
  scene.fog = new THREE.Fog(0x88badb, 700, 2600);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 6000);
  const cameraRig = createThirdPersonRig(camera);
  const worldRoot = new THREE.Group();
  scene.add(worldRoot);
  
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.position.set(-180, 280, 120); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);sun.shadow.camera.left=-75;sun.shadow.camera.right=75;sun.shadow.camera.top=75;sun.shadow.camera.bottom=-75;sun.shadow.camera.far=1000;sun.shadow.bias=-.00015;sun.shadow.normalBias=.04;scene.add(sun);

  const lighting=createCityLighting(scene,sun);
  const surfaces=createPixelPalette({anisotropy:Math.min(4,renderer.capabilities.getMaxAnisotropy())});
  const groundMat = colorMaterial(0xffffff,{map:surfaces.texture('grass')});
  const roadMat = colorMaterial(0xffffff,{map:surfaces.texture('asphalt')});
  const bridgeMat = colorMaterial(0x8b8170);
  const buildingMat = colorMaterial(0xa69d8d);
  const waterMat = colorMaterial(0x437f92, { transparent: true, opacity: 0.9, roughness: 0.35 });
  for (const material of [groundMat, roadMat, bridgeMat, buildingMat, waterMat]) material.userData.worldShared = true;
  const terrainMaterial = groundMat;
  const wuyiKit=createWuyiKit({anisotropy:Math.min(4,renderer.capabilities.getMaxAnisotropy()),surfaces});
  const entries = new Map(), inflight = new Map(), failed = new Set(), controllers = new Set();
  const npcs = [];
  const npcId=n=>`${n.entryKey}:${n.roadId}:${n.copy}`;
  let activeConversation=null,photoAim=null,lastCaptureEvidence=null;
  const peopleBatch=createPeopleBatch({surfaces,maxPeople:40,idOf:npcId});worldRoot.add(peopleBatch.root);
  function syncNpcBatch(){worldRoot.updateMatrixWorld(true);peopleBatch.update(npcs);}
  const playerMade = makeBlockPerson(false,undefined,0,{surfaces});
  const player = { x: NaN, y: NaN, groundY: NaN, z: NaN, yaw: 0, pitch: -0.12, distanceWalked: 0, safe: null,
    jumpVelocity: 0, jumpOffset: 0, jumpWasDown: false };
  worldRoot.add(playerMade.root);
  let renderOriginX = 0, renderOriginZ = 0;
  let disposed = false, photoMode = false, photoOptions = {}, cameraMode = 'third', timeMode = 'day';
  let routePoints = [], routeIndex = 0, autoWalk = false, blocked = null, lastStateEmit = 0, lastNeighborhood = '', lastNpcRefresh = 0;
  let routeLine = null, moveVelocity={x:0,z:0}, walkPhase=0,cameraFeetY=null;
  const sourceStart=manifest.start??{x:0,y:0,z:0};const start=inWuyi(sourceStart.x,sourceStart.z)?{...sourceStart,...wuyiStart}:sourceStart;
  const toIndex = (x, z) => [Math.floor(x / size), Math.floor(z / size)];
  const keyAt = (x, z) => chunkKey(x, z, size);
  const emitNotice = (message, detail = {}) => { try { onNotice?.(message, detail); } catch { /* consumer callback */ } };

  function findEntry(x, z) { return entries.get(keyAt(x, z)) ?? null; }
  function furnitureAt(x,z,y=null){return [...entries.values()].some(entry=>hitsFurniture(entry,x,z,y));}
  function offsetAt(x,z,y){return undergroundOffset(x,z,y==null?null:y-(sampleTerrain(findEntry(x,z),x,z)??0))??0;}
  function sampleAt(x, z) {return walkingSurface(findEntry(x,z),x,z,player.groundY);}
  function makeTerrain(entry, data) {
    const t = entry.terrain, positions = [], indices = [];
    for (let iz = 0; iz < t.resolution; iz++) {
      for (let ix = 0; ix < t.resolution; ix++) {
        const n = iz * t.resolution + ix;
        positions.push(ix * t.size / (t.resolution - 1), t.heights[n], iz * t.size / (t.resolution - 1));
      }
    }
    for (let iz = 0; iz < t.resolution - 1; iz++) for (let ix = 0; ix < t.resolution - 1; ix++) {
      const a = iz * t.resolution + ix, b = a + 1, c = a + t.resolution, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(boxSurfaceUV(carveUnderground(geometry,entry),8), terrainMaterial); mesh.receiveShadow = true; mesh.castShadow = false;
    entry.group.add(mesh);

    const trees = [];
    for (const area of data.landuse ?? []) {
      const palette = /forest|wood|park|green/i.test(area.kind) ? 0x54734b : /urban|built/i.test(area.kind) ? 0x8c8b78 : null;
      if (palette == null) continue;
      const material = colorMaterial(palette, { transparent: true, opacity: 0.34, depthWrite: false });
      const surface = polygonSurface((area.polygon ?? []).map(([x, z]) => [x - entry.originX, z - entry.originZ]), material, 0.045);
      if(surface&&(area.polygon??[]).every(([x,z])=>inWuyi(x,z))){surface.geometry.dispose();material.dispose();}
      else if (surface) { drapeSurface(surface, entry, .06);surface.geometry=carveUnderground(surface.geometry,entry);entry.group.add(surface); }
      if (/forest|wood|park/i.test(area.kind) && area.polygon?.length >= 3) {
        const minX = Math.max(entry.originX, Math.min(...area.polygon.map(p=>p[0]))), maxX = Math.min(entry.originX+size, Math.max(...area.polygon.map(p=>p[0])));
        const minZ = Math.max(entry.originZ, Math.min(...area.polygon.map(p=>p[1]))), maxZ = Math.min(entry.originZ+size, Math.max(...area.polygon.map(p=>p[1])));
        for (let z=minZ+12;z<maxZ&&trees.length<100;z+=35) for(let x=minX+12;x<maxX&&trees.length<100;x+=35) {
          const jitter=Math.sin(x*.014+z*.021)*7,tx=x+jitter,tz=z-jitter;
          if(!inWuyi(tx,tz)&&pointInPolygon(tx,tz,area.polygon))trees.push([tx-entry.originX,sampleTerrain(entry,tx,tz),tz-entry.originZ]);
        }
      }
    }
    if (trees.length) {
      const trunks = new THREE.InstancedMesh(boxSurfaceUV(new THREE.BoxGeometry(.65,3,.65),2),colorMaterial(0xffffff,{map:surfaces.texture('bark')}),trees.length);
      const crowns = new THREE.InstancedMesh(boxSurfaceUV(new THREE.BoxGeometry(3.7,3.4,3.7),4),colorMaterial(0xffffff,{map:surfaces.texture('leaf')}),trees.length);
      const transform=new THREE.Object3D();
      trees.forEach(([x,y,z],i)=>{transform.position.set(x,y+1.5,z);transform.updateMatrix();trunks.setMatrixAt(i,transform.matrix);transform.position.set(x,y+4,z);transform.updateMatrix();crowns.setMatrixAt(i,transform.matrix);});
      crowns.castShadow=true;entry.group.add(trunks,crowns);
    }
    for (const water of data.water ?? []) {
      const local = (water.polygon ?? []).map(([x, z]) => [x - entry.originX, z - entry.originZ]);
      const holes = (water.holes ?? []).map(ring => ring.map(([x,z]) => [x-entry.originX,z-entry.originZ]));
      const mesh = polygonSurface(local, waterMat, 0.08, holes);
      if (mesh) { drapeSurface(mesh, entry, .18);mesh.geometry=carveUnderground(mesh.geometry,entry);entry.group.add(mesh); }
      entry.water.push({polygon:water.polygon,holes:water.holes ?? []});
    }
    for (const road of data.roads ?? []) {
      const points = (road.points ?? []).map(point3).filter((p) => [p.x, p.y, p.z].every(Number.isFinite))
        .map(p=>({...p,y:Math.max(wuyiGround(p.x,p.z,p.y),sampleTerrain(entry,p.x,p.z) ?? p.y)}));
      if (points.length < 2) continue;
      entry.roads.push({ id:road.id, points, width: Math.max(1, Number(road.width) || 4), bridge: Boolean(road.bridge), tunnel:Boolean(road.tunnel), layer:road.layer, kind:road.kind, walkable:road.walkable });
      const local = points.map((p) => ({ x: p.x - entry.originX, y: p.y, z: p.z - entry.originZ }));
      const mesh = roadRibbon(local, Math.max(1, Number(road.width) || 4), inWuyi(points[0].x,points[0].z)?wuyiKit.asphalt:road.bridge ? bridgeMat : roadMat);
      if(mesh&&inWuyi(points[0].x,points[0].z)){const uv=mesh.geometry.attributes.position;const values=new Float32Array(uv.count*2);for(let i=0;i<uv.count;i++){values[i*2]=uv.getX(i)/4;values[i*2+1]=uv.getZ(i)/4;}mesh.geometry.setAttribute('uv',new THREE.BufferAttribute(values,2));}
      if (mesh) {mesh.geometry=carveUnderground(mesh.geometry,entry);mesh.receiveShadow = true; entry.group.add(mesh); }
    }
    for (const building of data.buildings ?? []) {
      const polygon = building.polygon;
      if (!Array.isArray(polygon) || polygon.length < 3) continue;
      const local = polygon.map(([x, z]) => [Number(x) - entry.originX, Number(z) - entry.originZ]);
      if (!local.flat().every(Number.isFinite)) continue;
      const shape = new THREE.Shape(); shape.moveTo(local[0][0], -local[0][1]);
      for (const [x, z] of local.slice(1)) shape.lineTo(x, -z); shape.closePath();
      for (const ring of building.holes ?? []) {
        const hole = new THREE.Path();ring.forEach(([x,z],i)=>i?hole.lineTo(x-entry.originX,-(z-entry.originZ)):hole.moveTo(x-entry.originX,-(z-entry.originZ)));hole.closePath();shape.holes.push(hole);
      }
      const height = resolveWuyiHeight(building).heightMeters;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
      geometry.rotateX(-Math.PI / 2); geometry.computeVertexNormals();
      const xs = local.map((p) => p[0]), zs = local.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + entry.originX;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2 + entry.originZ;
      const y = sampleTerrain(entry, cx, cz) ?? 0;
      const mesh = new THREE.Mesh(geometry, buildingMat); mesh.position.set(0, y, 0); mesh.castShadow = true; mesh.receiveShadow = true;
      const detailed=wuyiKit.detailBuilding(building,geometry,y,entry);entry.group.add(detailed||mesh); if(!detailed?.userData.noSolidFootprint){const footprints=detailed?.userData.collisionFootprints??[{polygon:detailed?.userData.collisionPolygon??polygon.map(([x,z])=>[Number(x),Number(z)]),minY:y,maxY:y+height}];for(const footprint of footprints)entry.buildings.push({id:String(building.id),height,holes:building.holes??[],...footprint});}
    }
    for (const poi of pois) {
      if (!poi?.world || !finite(poi.world.x) || !finite(poi.world.z)) continue;
      const x = Number(poi.world.x), z = Number(poi.world.z);
      if (x < entry.originX || x >= entry.originX + size || z < entry.originZ || z >= entry.originZ + size) continue;
      const landmark = createLandmark(poi);
      if (!landmark) continue;
      const y = sampleTerrain(entry, x, z);
      if (y == null) continue;
      landmark.position.set(x - entry.originX, y, z - entry.originZ);
      entry.group.add(landmark);
    }
    wuyiKit.decorate(entry,data,sampleTerrain);
    entry.cameraOccluders=snapshotCameraOccluders(entry.group);
    const groups=[];entry.group.traverse(o=>{if(o.isGroup)groups.push(o);});for(const group of groups){const materials=new Set(group.children.filter(o=>o.isMesh&&!o.isInstancedMesh).map(o=>o.material));for(const material of materials)mergeStaticMeshes(group,material);}
  }

  function makeEntry(data, ix, iz, key) {
    if (!data || typeof data !== 'object') throw new Error(`Chunk ${key} has no JSON object`);
    const terrain = terrainValues(data.terrain);
    if (!terrain) throw new Error(`Chunk ${key} has invalid terrain grid; movement remains blocked`);
    if (data.key && data.key !== key) throw new Error(`Chunk key mismatch: expected ${key}, received ${data.key}`);
    for(let gz=0;gz<terrain.resolution;gz++)for(let gx=0;gx<terrain.resolution;gx++){const i=gz*terrain.resolution+gx;terrain.heights[i]=wuyiGround(ix*size+gx*size/(terrain.resolution-1),iz*size+gz*size/(terrain.resolution-1),terrain.heights[i]);}
    const entry = {
      key, ix, iz, originX: ix * size, originZ: iz * size, terrain,
      group: new THREE.Group(), roads: [], water: [], buildings: [], lastUsed: performance.now(),
    };
    entry.group.position.set(entry.originX, 0, entry.originZ);
    makeTerrain(entry, data);
    return entry;
  }

  function notifyState(force = false) {
    const now = performance.now();
    if (!force && now - lastStateEmit < 100) return;
    lastStateEmit = now;
    if (!Number.isFinite(player.x)) return;
    let nearestPoi = null, nearestDistance = Infinity;
    for (const poi of pois) {
      if (!poi?.world || !finite(poi.world.x) || !finite(poi.world.z)) continue;
      const d = Math.hypot(Number(poi.world.x) - player.x, Number(poi.world.z) - player.z);
      if (d < nearestDistance) { nearestDistance = d; nearestPoi = { id: poi.id ?? null, name: poi.name ?? '', distance: d }; }
    }
    const state = {
      x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
      distanceWalked: player.distanceWalked,bodyYaw:playerMade.root.rotation.y,velocity:{...moveVelocity}, activeChunks: entries.size, npcCount: npcs.length,
      nearestPoi, loading: inflight.size > 0, blocked: blocked ? { ...blocked } : null,
      cameraMode, photoMode, autoWalk,
    };
    try { onState?.(state); } catch { /* consumer callback */ }
  }

  async function loadChunk(ix, iz) {
    const key = `${ix}_${iz}`;
    if (entries.has(key)) { entries.get(key).lastUsed = performance.now(); return entries.get(key); }
    if (inflight.has(key)) return inflight.get(key);
    const source = chunkSources[key];
    if (!source) return null;
    const task = (async () => {
      let data;
      if (typeof source === 'object') data = source;
      else {
        const controller = new AbortController(); controllers.add(controller);
        try {
          const response = await fetch(source, { signal: controller.signal, cache: 'default' });
          if (!response.ok) throw new Error(`HTTP ${response.status} loading ${source}`);
          data = await response.json();
        } finally { controllers.delete(controller); }
      }
      const entry = makeEntry(data, ix, iz, key);
      if (disposed) { disposeTree(entry.group); return null; }
      entries.set(key, entry); worldRoot.add(entry.group); spawnNpcs(entry);
      evictChunks(); notifyState(true);
      return entry;
    })().catch((error) => {
      if (error?.name !== 'AbortError' && !failed.has(key)) {
        console.error(`地图分块 ${key} 加载失败`,error);
        failed.add(key); emitNotice(`地图分块 ${key} 加载失败，已在安全位置停止。`, { key, error: String(error?.message ?? error) });
      }
      return null;
    }).finally(() => { inflight.delete(key); notifyState(true); });
    inflight.set(key, task);
    notifyState(true);
    return task;
  }

  function spawnNpcs(entry) {
    const anchor=Number.isFinite(player.x)?player:start;
    const roads=[...(entry.pedestrianPaths||[]),...entry.roads];
    const nearby=roads.map(road=>({road,near:Math.min(...road.points.map(p=>Math.hypot(p.x-anchor.x,p.z-anchor.z)))})).filter(o=>o.near<250&&!/motorway|trunk|construction|proposed/.test(o.road.kind||'')&&o.road.walkable!==false).sort((a,b)=>Number(Boolean(b.road.authored))-Number(Boolean(a.road.authored))||a.near-b.near);
    for(const {road}of nearby){
      const copies=road.authored?3:1;
      for(let copy=0;copy<copies;copy++){
        if(npcs.length>=40)return;if(npcs.some(n=>n.entryKey===entry.key&&n.roadId===road.id&&n.copy===copy))continue;
        if(road.points.length<2)continue;
        let best=Infinity,along=0,startDistance=0;
        for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),t=clamp(((anchor.x-a.x)*dx+(anchor.z-a.z)*dz)/(len*len||1),0,1),d=Math.hypot(a.x+dx*t-anchor.x,a.z+dz*t-anchor.z);if(d<best){best=d;startDistance=along+t*len;}along+=len;}
        const index=npcs.length;
        // Distribute along the actual path rather than clustering every path at its nearest point.
        const candidates=[30+index%5*11,-30-index%4*13,60,-60].map(delta=>clamp(startDistance+delta,0,along));
        let spawnDistance=null,spawnPoint=null;
        const laneOffset=/footway|path|pedestrian|steps/.test(road.kind||'')?(copy-1)*.75:road.width/2+.85;
        for(const distance of candidates){let remaining=distance,a=road.points[0],b=road.points[1];
          for(let i=1;i<road.points.length;i++){b=road.points[i];const length=Math.hypot(b.x-a.x,b.z-a.z);if(remaining<=length)break;remaining-=length;a=b;}
          const length=Math.hypot(b.x-a.x,b.z-a.z)||1,t=clamp(remaining/length,0,1),x=a.x+(b.x-a.x)*t-(b.z-a.z)/length*laneOffset,z=a.z+(b.z-a.z)*t+(b.x-a.x)/length*laneOffset;
          const spawnEntry=findEntry(x,z),pathY=a.y+(b.y-a.y)*t,spawnY=walkingSurface(spawnEntry,x,z,pathY);if(!spawnEntry||spawnY==null||spawnEntry.buildings.some(b=>hitsBuilding(b,x,z,spawnY))||furnitureAt(x,z,spawnY))continue;
          if(Math.hypot(x-player.x,z-player.z)<12||npcs.some(n=>Math.hypot(n.root.position.x-x,n.root.position.z-z)<2.5))continue;
          spawnDistance=distance;spawnPoint={x,z,y:spawnY};break;
        }
        if(spawnDistance===null)continue;
        const identitySeed=[...`${entry.key}:${road.id}:${copy}`].reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,7);
        const person=makeBlockPerson(true,[0x577e89,0xb47759,0x7b8953,0x95728b,0xd4ae70][identitySeed%5],identitySeed,{surfaces});
        const parts=[];person.root.traverse(o=>{if(o.isMesh){parts.push(o);o.visible=false;}});
        person.root.position.set(spawnPoint.x,spawnPoint.y,spawnPoint.z);
        worldRoot.add(person.root);
        npcs.push({...person,parts,entryKey:entry.key,roadId:road.id,copy,path:road.points,pathDistance:spawnDistance,laneOffset,direction:index%2?1:-1,speed:.8+(index%3)*.2,behavior:'walk',timer:3+index%5,phase:index*1.7,name:['散步的市民','旅行者','附近的上班族'][identitySeed%3]});
      }
    }
    updateNpcs(0);
  }

  function evictChunks() {
    if (entries.size <= maxCache) return;
    const currentKey = Number.isFinite(player.x) ? keyAt(player.x, player.z) : null;
    const candidates = [...entries.values()].filter((entry) => entry.key !== currentKey)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (entries.size > maxCache && candidates.length) {
      const entry = candidates.shift();
      entries.delete(entry.key); worldRoot.remove(entry.group); disposeTree(entry.group);
      for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].entryKey === entry.key) {
        worldRoot.remove(npcs[i].root); disposeTree(npcs[i].root); npcs.splice(i, 1);
      }
    }
  }

  function requestNeighborhood(fx = 0, fz = 0) {
    if (!Number.isFinite(player.x)) return;
    const [cx, cz] = toIndex(player.x, player.z);
    const signature = `${cx}_${cz}_${Math.sign(fx)}_${Math.sign(fz)}`;
    if (signature === lastNeighborhood) return;
    lastNeighborhood = signature;
    const wanted = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iz = cz + dz;
      const key = `${ix}_${iz}`;
      if (chunkSources[key] && !entries.has(key) && !inflight.has(key)) wanted.push({ ix, iz, d: Math.hypot(dx, dz) });
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const tile of wanted) void loadChunk(tile.ix, tile.iz);
  }

  function collisionReason(x, z, jumpAllowed, referenceHeight = player.groundY,referenceOffset=offsetAt(player.x,player.z,player.groundY)) {
    if (!withinBounds(x, z, bounds)) return { code: 'outside-bounds', message: '已到当前城市数据边界，前方地图尚未开放。' };
    const entry = findEntry(x, z);
    if (!entry) {
      const [ix, iz] = toIndex(x, z); void loadChunk(ix, iz);
      return { code: chunkSources[`${ix}_${iz}`] ? 'chunk-loading' : 'missing-chunk', key: `${ix}_${iz}`, message: chunkSources[`${ix}_${iz}`] ? '前方地面正在加载。' : `前方分块 ${ix}_${iz} 暂无地理数据。` };
    }
    const roadSurface = nearestRoadSurface(entry, x, z, referenceHeight);
    const groundY = walkingSurface(entry,x,z,referenceHeight);
    if (groundY == null) return { code: 'missing-terrain', key: entry.key, message: '前方地形采样不可用，已停止移动。' };
    const delta = groundY - referenceHeight;
    if(undergroundBoundary(x,z,referenceOffset))return {code:'underground-wall',message:'请从台阶或扶梯口进入下沉广场。'};
    if(isUndergroundOpening(x,z)&&delta<-.72)return {code:'unsafe-ledge',message:'请沿台阶逐级下行。'};
    if (delta > (jumpAllowed ? 1.2 : 0.72)) return { code: 'steep-step', message: '前方落差过大，已停止移动。', fromY:referenceHeight, nextY:groundY, roadId:roadSurface?.id };
    if(furnitureAt(x,z,groundY))return {code:'street-furniture',message:'前方是座椅或绿化，请从旁边的步道绕行。'};
    for (const area of entry.buildings) if (hitsBuilding(area,x,z,groundY)) return { code: 'building-collision', message: '前方建筑不可穿行。' };
    let inWater = false;
    for (const area of entry.water) if (pointInPolygon(x,z,area.polygon) && !area.holes.some(ring=>pointInPolygon(x,z,ring))) { inWater = true; break; }
    if (inWater) {
      const bridge = roadSurface?.bridge;
      if (!bridge) return { code: 'water-collision', message: '前方是水域，请沿真实桥梁或道路通行。' };
    }
    return null;
  }

  function rebaseIfNeeded() {
    if (Math.hypot(player.x - renderOriginX, player.z - renderOriginZ) < 2048) return;
    renderOriginX = Math.floor(player.x / size) * size;
    renderOriginZ = Math.floor(player.z / size) * size;
    worldRoot.position.set(-renderOriginX, 0, -renderOriginZ);
  }

  function updateCamera(dt=0) {
    cameraFeetY=dt>0&&Number.isFinite(cameraFeetY)?cameraFeetY+(player.y-cameraFeetY)*(1-Math.exp(-18*dt)):player.y;
    const aim=photoMode?photoAim:player,mode=photoMode?(photoOptions.view||'first'):cameraMode;
    const fx=Math.sin(aim.yaw),fz=-Math.cos(aim.yaw);
    if(mode==='first') {
      cameraRig.reset();camera.position.set(player.x-renderOriginX,cameraFeetY+1.72,player.z-renderOriginZ);
      camera.lookAt(camera.position.x+fx*Math.cos(aim.pitch),camera.position.y+Math.sin(aim.pitch),camera.position.z+fz*Math.cos(aim.pitch));
      playerMade.root.visible=false;
    } else {
      const companion=photoMode&&mode==='selfie'?npcs.find(n=>npcId(n)===photoOptions.companionId):null;
      const anchor=companion?{x:(player.x+companion.root.position.x)/2,y:(cameraFeetY+companion.root.position.y)/2,z:(player.z+companion.root.position.z)/2}:{x:player.x,y:cameraFeetY,z:player.z};
      const occluders=[],radius=photoMode?15:10;
      for(const entry of entries.values()) {
        const dx=anchor.x-clamp(anchor.x,entry.originX,entry.originX+size),dz=anchor.z-clamp(anchor.z,entry.originZ,entry.originZ+size);
        if(Math.hypot(dx,dz)>radius)continue;
        entry.group.updateWorldMatrix(true,true);
        occluders.push(...nearCameraOccluders(entry.cameraOccluders,entry.group.matrixWorld,{x:anchor.x-entry.originX,y:anchor.y+1.72,z:anchor.z-entry.originZ},radius));
      }
      const rigState=cameraRig.update({x:anchor.x-renderOriginX,y:anchor.y,z:anchor.z-renderOriginZ,yaw:aim.yaw,pitch:aim.pitch,photo:photoMode,dt,occluders});
      playerMade.root.visible=!rigState.hideAvatar;
      if(photoMode&&mode==='selfie') {
        playerMade.root.rotation.y=bodyHeading(camera.position.x+renderOriginX-player.x,camera.position.z+renderOriginZ-player.z);
        if(companion)companion.root.rotation.y=bodyHeading(camera.position.x+renderOriginX-companion.root.position.x,camera.position.z+renderOriginZ-companion.root.position.z);
      }
    }
  }

  function nearestPoi() {
    let chosen = null, dmin = Infinity;
    for (const poi of pois) if (poi?.world && finite(poi.world.x) && finite(poi.world.z)) {
      const d = Math.hypot(Number(poi.world.x) - player.x, Number(poi.world.z) - player.z);
      if (d < dmin) { dmin = d; chosen = poi; }
    }
    return chosen;
  }

  function autoDirection(dt) {
    if (!autoWalk || !routePoints.length) return null;
    while (routeIndex < routePoints.length && Math.hypot(routePoints[routeIndex].x - player.x, routePoints[routeIndex].z - player.z) < 0.02) routeIndex++;
    if (routeIndex >= routePoints.length) { autoWalk = false; blocked = null; return null; }
    if (routeIndex === 0 && Math.hypot(routePoints[0].x - player.x, routePoints[0].z - player.z) > 4) {
      autoWalk = false; blocked = { code: 'route-start-off-road', message: '当前位置与真实道路节点不相连，自动行走已停止。' }; return null;
    }
    const p = routePoints[routeIndex], dx = p.x - player.x, dz = p.z - player.z;
    player.yaw = Math.atan2(dx, -dz);
    return { forward: 1, right: 0, run: false, jump: false, dt: Math.min(dt, Math.hypot(dx, dz) / MOVE_SPEED) };
  }

  function updateNpcs(dt) {
    for (const npc of npcs) {
      const held=npcId(npc)===activeConversation||(photoMode&&npcId(npc)===photoOptions.companionId);
      if(held)npc.behavior=photoMode&&npcId(npc)===photoOptions.companionId?'selfie':'talk';
      else npc.timer -= dt;
      if (!held && npc.timer <= 0) { npc.behavior = npc.behavior === 'walk' ? ['look', 'photo', 'talk'][Math.floor((npc.phase + performance.now() / 5000) % 3)] : 'walk'; npc.timer = 2.4 + (npc.phase % 3); }
      if (npc.behavior === 'walk' && npc.path.length >= 2) {
        const total = npc.path.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - npc.path[i - 1].x, p.z - npc.path[i - 1].z) : sum, 0);
        let next = npc.pathDistance + npc.direction * npc.speed * dt;
        if (next < 0 || next > total) { npc.direction *= -1; next = clamp(next, 0, total); }
        let cursor = next, from = npc.path[0], to = npc.path[1];
        for (let i = 1; i < npc.path.length; i++) {
          to = npc.path[i]; const len = Math.hypot(to.x - from.x, to.z - from.z);
          if (cursor <= len) break;
          cursor -= len; from = to;
        }
        const len = Math.hypot(to.x - from.x, to.z - from.z) || 1, t = clamp(cursor / len, 0, 1);
        const dx=to.x-from.x,dz=to.z-from.z;let offset=npc.laneOffset||0;
        const centerX=from.x+dx*t,centerZ=from.z+dz*t;const close=Math.hypot(centerX-player.x,centerZ-player.z)<2.5;if(close)offset+=offset>=0?.8:-.8;npc.currentLane??=npc.laneOffset||0;npc.currentLane+=(offset-npc.currentLane)*(1-Math.exp(-8*dt));offset=npc.currentLane;
        const x=centerX-dz/len*offset,z=centerZ+dx/len*offset;
        const entry = findEntry(x, z);
        if (entry) {
          const y=walkingSurface(entry,x,z,npc.surfaceInitialized?npc.root.position.y:from.y);
          if(furnitureAt(x,z,y)||(npc.surfaceInitialized&&undergroundBoundary(x,z,offsetAt(npc.root.position.x,npc.root.position.z,npc.root.position.y)))||entry.buildings.some(b=>hitsBuilding(b,x,z,y))){npc.direction*=-1;continue;}
          npc.pathDistance = next;
          npc.surfaceInitialized=true;
          npc.gaitPhase=(npc.gaitPhase||0)+Math.hypot(x-npc.root.position.x,z-npc.root.position.z)*5;
          npc.root.position.set(x, y ?? from.y, z);
          npc.root.rotation.y=dampAngle(npc.root.rotation.y,bodyHeading((to.x-from.x)*npc.direction,(to.z-from.z)*npc.direction),dt,12);
        } else npc.direction *= -1;
      }
      if(npc.behavior==='talk'&&Number.isFinite(npc.lookYaw))npc.root.rotation.y=dampAngle(npc.root.rotation.y,npc.lookYaw,dt,12);
      if(npc.behavior==='walk')npc.lookYaw=null;
      npc.phase += dt;
      npc.pose({mode:npc.behavior==='selfie'?(photoOptions.pose==='stand'?'idle':photoOptions.pose==='camera'?'photo':'selfie'):npc.behavior==='photo'?'photo':npc.behavior==='walk'?'walk':'idle',phase:npc.behavior==='walk'?(npc.gaitPhase||0):npc.phase,speed:npc.speed,dt});
      npc.root.visible=!(photoMode&&photoOptions.hideNpcs);
    }
  }

  function update(dtSeconds, input = {}) {
    if (disposed || !Number.isFinite(player.x)) return;
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);
    let command = {
      forward: Number(input.forward) || 0, right: Number(input.right) || 0,
      run: Boolean(input.run), jump: Boolean(input.jump),
    };
    if (command.jump && !player.jumpWasDown && player.jumpOffset === 0) player.jumpVelocity = 4.2;
    player.jumpWasDown = command.jump;
    const aim=photoMode?photoAim:player;
    aim.yaw += Number(input.yawDelta)||0;
    aim.pitch=clamp(aim.pitch+(Number(input.pitchDelta)||0),photoMode&&photoOptions.view==='selfie'?-.6:-1.3,photoMode&&photoOptions.view==='selfie'?.75:1.35);
    const auto = autoDirection(dt);
    if (auto) command = auto;
    const moveDt = command.dt ?? dt;
    const forwardX = Math.sin(player.yaw), forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw), rightZ = Math.sin(player.yaw);
    let vx = forwardX * command.forward + rightX * command.right;
    let vz = forwardZ * command.forward + rightZ * command.right;
    const length = Math.hypot(vx, vz);
    if (length > 0) { vx /= length; vz /= length; }
    const speed = command.run ? RUN_SPEED : MOVE_SPEED;
    moveVelocity=dampVelocity(moveVelocity,{x:vx*speed,z:vz*speed},moveDt);
    let nx=player.x+moveVelocity.x*moveDt,nz=player.z+moveVelocity.z*moveDt;
    let moving=Math.hypot(moveVelocity.x,moveVelocity.z)>.01;
    if (moving) {
      blocked = null;
      // Check the travelled segment as well as its endpoint: a fast frame must
      // not skip a thin rail or column. Keep each probe below 14 cm.
      const moveIssue=(x,z)=>{const dx=x-player.x,dz=z-player.z,count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.14));for(let i=1;i<=count;i++){const hit=collisionReason(player.x+dx*i/count,player.z+dz*i/count,command.jump);if(hit)return hit;}return null;};
      let issue = moveIssue(nx, nz);
      // Keep tangential motion along a wall, with the same collision predicate
      // checking each candidate. Steps, ledges, water and missing data never slide.
      if(issue&&['building-collision','street-furniture'].includes(issue.code)){
        const choices=[[nx,player.z],[player.x,nz]].filter(([x,z])=>Math.hypot(x-player.x,z-player.z)>1e-6&&!moveIssue(x,z)).sort((a,b)=>Math.hypot(b[0]-player.x,b[1]-player.z)-Math.hypot(a[0]-player.x,a[1]-player.z));
        if(choices.length){[nx,nz]=choices[0];moveVelocity={x:(nx-player.x)/moveDt,z:(nz-player.z)/moveDt};issue=null;}
      }
      if (issue) { moveVelocity={x:0,z:0};moving=false;blocked = issue; if (issue.code !== 'chunk-loading') emitNotice(issue.message, issue); }
      else {
        const nextY = sampleAt(nx, nz);
        player.distanceWalked += Math.hypot(nx - player.x, nz - player.z);
        player.x = nx; player.z = nz; player.groundY = nextY;
        player.safe = { x: player.x, y: player.groundY, z: player.z };
      }
    }
    if (player.jumpVelocity !== 0) {
      const nextOffset = player.jumpOffset + player.jumpVelocity * dt;
      player.jumpVelocity -= 10.5 * dt;
      if (nextOffset <= 0) { player.jumpOffset = 0; player.jumpVelocity = 0; }
      else player.jumpOffset = nextOffset;
    }
    player.y = player.groundY + player.jumpOffset;
    playerMade.root.position.set(player.x, player.y, player.z);
    if(moving)playerMade.root.rotation.y=dampAngle(playerMade.root.rotation.y,bodyHeading(moveVelocity.x,moveVelocity.z),dt,14);
    walkPhase+=Math.hypot(moveVelocity.x,moveVelocity.z)*dt*2.2;
    playerMade.pose({mode:photoMode?(photoOptions.pose==='stand'?'idle':photoOptions.pose==='camera'?'photo':photoOptions.view==='selfie'?'selfie':'photo'):moving?'walk':'idle',phase:photoMode?performance.now()/1000:walkPhase,speed:Math.hypot(moveVelocity.x,moveVelocity.z),run:command.run,dt});

    const fx = vx || Math.sin(player.yaw), fz = vz || -Math.cos(player.yaw);
    requestNeighborhood(fx, fz);
    const current = findEntry(player.x, player.z); if (current) current.lastUsed = performance.now();
    rebaseIfNeeded(); updateCamera(dt); updateNpcs(dt); evictChunks(); notifyState();
    if (performance.now() - lastNpcRefresh > 1200) {
      lastNpcRefresh = performance.now();
      for (let i = npcs.length - 1; i >= 0; i--) if (Math.hypot(npcs[i].root.position.x - player.x, npcs[i].root.position.z - player.z) > 600) {
        worldRoot.remove(npcs[i].root); disposeTree(npcs[i].root); npcs.splice(i, 1);
      }
      for (const entry of entries.values()) if (Math.hypot(entry.originX + size / 2 - player.x, entry.originZ + size / 2 - player.z) < size * 1.5) spawnNpcs(entry);
    }
  }

  let photoAspect = 16/9;
  function resize() {
    const win=canvas.ownerDocument.defaultView;
    if(photoMode){const vw=win.innerWidth,vh=win.innerHeight,w=Math.min(vw,vh*photoAspect),h=w/photoAspect;Object.assign(canvas.style,{width:w+'px',height:h+'px',left:(vw-w)/2+'px',top:(vh-h)/2+'px'});}else{Object.assign(canvas.style,{width:'',height:'',left:'',top:''});}
    const rect = canvas.getBoundingClientRect?.();
    const width = Math.max(1, Math.round(rect?.width || canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(rect?.height || canvas.clientHeight || canvas.height || 1));
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function render() {
    if (disposed || !Number.isFinite(player.x)) return;
    lighting.update(camera,player,renderOriginX,renderOriginZ);syncNpcBatch();renderer.render(scene, camera);
  }

  function setTime(mode) {
    if (!['day', 'sunset', 'night'].includes(mode)) return;
    timeMode = mode;
    lighting.setTime(mode);wuyiKit.setTime(mode);
    notifyState(true);
  }

  function setCameraMode(mode) { if (mode === 'first' || mode === 'third') { cameraMode = mode; updateCamera(); notifyState(true); } }
  function setPhotoMode(enabled,options={}) {
    enabled=Boolean(enabled);
    if(enabled&&!photoMode)photoAim={yaw:player.yaw,pitch:player.pitch,resumeFov:camera.fov,resumeBodyYaw:playerMade.root.rotation.y};
    if(!enabled&&photoMode){const companion=npcs.find(n=>npcId(n)===photoOptions.companionId);if(companion){companion.behavior='look';companion.timer=1.2;}camera.fov=photoAim.resumeFov;camera.updateProjectionMatrix();playerMade.root.rotation.y=photoAim.resumeBodyYaw;photoAim=null;photoOptions={};}
    const previousView=photoOptions.view;
    photoMode=enabled;
    if(enabled){photoOptions={...photoOptions,...options};photoOptions.view??='first';
      if(photoOptions.view!==previousView){photoAim.yaw=player.yaw+(photoOptions.view==='selfie'?Math.PI:0);photoAim.pitch=photoOptions.view==='selfie'?.12:player.pitch;
        const companion=photoOptions.view==='selfie'?npcs.find(n=>npcId(n)===photoOptions.companionId):null;
        if(companion)photoAim.yaw=Math.atan2(companion.root.position.x-player.x,-(companion.root.position.z-player.z))+Math.PI/2;
      }
      moveVelocity={x:0,z:0};
    }
    resize();updateCamera();notifyState(true);
  }
  function setPhotoView(view){if(photoMode&&['first','third','selfie'].includes(view))setPhotoMode(true,{view});}
  function endInteraction(){const npc=npcs.find(n=>npcId(n)===activeConversation);if(npc){npc.behavior='look';npc.timer=2.4;}activeConversation=null;}

  function setPhotoAspect(value){if([16/9,1,9/16].some(r=>Math.abs(r-value)<1e-6))photoAspect=value;resize();}
  function setRoute(route) {
    if (routeLine) { worldRoot.remove(routeLine); disposeTree(routeLine); routeLine = null; }
    routePoints = route?.reachable && Array.isArray(route.points) ? route.points.map(point3).filter((p) => [p.x, p.y, p.z].every(Number.isFinite)) : [];
    routeIndex = 0; autoWalk = false;
    if (routePoints.length > 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(routePoints.map(p => new THREE.Vector3(p.x, p.y + .4, p.z)));
      routeLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({color:0xdfa866,transparent:true,opacity:.9}));
      worldRoot.add(routeLine);
    }
    if (route && !route.reachable) blocked = { code: route.reason ?? 'route-unavailable', message: route.reason ?? '没有可用的真实道路路线。' };
    else blocked = null;
    notifyState(true);
  }
  function setAutoWalk(enabled) { autoWalk = Boolean(enabled && routePoints.length > 1); if (!autoWalk && blocked?.code === 'route-start-off-road') blocked = null; notifyState(true); }

  function interact() {
    const near = npcs.filter(npc=>Math.hypot(npc.root.position.x-player.x,npc.root.position.z-player.z,npc.root.position.y-player.y)<5)
      .sort((a,b)=>a.root.position.distanceTo(playerMade.root.position)-b.root.position.distanceTo(playerMade.root.position))[0];
    if (!near) return {found:false,message:'走近一位路人，再按 E 打个招呼。'};
    activeConversation=npcId(near);near.behavior='talk';near.lookYaw=bodyHeading(player.x-near.root.position.x,player.z-near.root.position.z);
    return {found:true,npcId:npcId(near),role:near.name,place:inWuyi(player.x,player.z)?'五一广场附近':'长沙街头',name:near.name,message:inWuyi(player.x,player.z)?'这里是五一广场。南面是平和堂，东南方向能看到国金中心双塔。可以在广场边停下来取景，沿五一大道继续逛。':'慢慢走咯，长沙的风景在路上。打开地图，可以看看附近的景点。'};
  }

  function photoPeople(framing=camera) {
    worldRoot.updateMatrixWorld(true);framing.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(),origin=framing.getWorldPosition(new THREE.Vector3()),obstacles=[];
    for(const entry of entries.values()){
      entry.group.updateWorldMatrix(true,true);
      obstacles.push(...nearCameraOccluders(entry.cameraOccluders,entry.group.matrixWorld,{x:origin.x+renderOriginX-entry.originX,y:origin.y,z:origin.z+renderOriginZ-entry.originZ},120));
    }
    const actors=[...(playerMade.root.visible?[{id:'player',name:'我',root:playerMade.root}]:[]),...npcs.filter(n=>n.root.visible).map(n=>({id:npcId(n),name:n.name,root:n.root}))];
    return actors.map(actor=>{
      let visibleSamples=0;
      for(const height of [.35,1.05,1.65]){
        const target=new THREE.Vector3(actor.root.position.x-renderOriginX,actor.root.position.y+height,actor.root.position.z-renderOriginZ),ndc=target.clone().project(framing);
        if(Math.abs(ndc.x)>.96||Math.abs(ndc.y)>.96||ndc.z<-1||ndc.z>1)continue;
        const direction=target.clone().sub(origin),distance=direction.length();ray.set(origin,direction.normalize());ray.near=.1;ray.far=distance-.1;
        if(ray.intersectObjects(obstacles,false).some(h=>h.distance<distance-.2))continue;
        const crowd=peopleBatch.rayHits(ray).find(h=>h.ownerId!==actor.id&&h.distance<distance-.3);
        if(!crowd)visibleSamples++;
      }
      return{id:actor.id,name:actor.name,visibleSamples,method:'frustum-and-geometry-rays'};
    }).filter(actor=>actor.visibleSamples>=2);
  }

  async function capture({ width = 1920, height = 1080, hideNpcs = photoOptions.hideNpcs ?? false } = {}) {
    if (disposed) throw new Error('World has been disposed');
    if (!Number.isFinite(player.x) || !findEntry(player.x, player.z)) throw new Error('当前地面未加载，不能拍摄空场景');
    const targetWidth = Math.max(1, Math.floor(Number(width) || 1920));
    const targetHeight = Math.max(1, Math.floor(Number(height) || 1080));
    try {
      renderer.setSize(targetWidth, targetHeight, false);
      camera.aspect = targetWidth / targetHeight; camera.updateProjectionMatrix(); updateCamera();
      if (hideNpcs) for (const npc of npcs) npc.root.visible = false;
      lighting.update(camera,player,renderOriginX,renderOriginZ);syncNpcBatch();renderer.render(scene, camera);
      lastCaptureEvidence={capturedAt:new Date().toISOString(),visibleSubjects:wuyiKit.photoSubjects(camera,worldRoot),visiblePeople:photoPeople(camera),companionId:photoOptions.companionId||null,photoView:photoOptions.view||cameraMode,yaw:photoAim?.yaw??player.yaw,pitch:photoAim?.pitch??player.pitch,fov:camera.fov};
      const outputCanvas = canvas.ownerDocument.createElement('canvas');
      outputCanvas.width = targetWidth; outputCanvas.height = targetHeight;
      const context = outputCanvas.getContext('2d');
      if (!context) throw new Error('Could not create PNG capture canvas');
      context.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      const blob = await new Promise((resolve, reject) => outputCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG capture returned an empty blob')), 'image/png'));
      if (!(blob instanceof Blob) || blob.size === 0 || blob.type !== 'image/png') throw new Error('PNG capture did not produce image data');
      return blob;
    } finally {
      // The user can cancel or resize while PNG encoding is pending.
      // Restore the current play context, not the stale pre-capture canvas size.
      npcs.forEach(npc=>{npc.root.visible=!(photoMode&&photoOptions.hideNpcs);});
      resize();updateCamera();
      render();
    }
  }

  async function restore(state) {
    if (!state || ![state.x, state.z].every(finite)) return false;
    const x = Number(state.x), z = Number(state.z), [ix, iz] = toIndex(x, z);
    const entry = findEntry(x, z) ?? await loadChunk(ix, iz);
    const y = walkingSurface(entry,x,z,finite(state.y)?Number(state.y):null);
    if (y == null || collisionReason(x,z,false,y,offsetAt(x,z,y))) return false;
    player.x = x; player.z = z; player.y = y; player.groundY = y;
    player.jumpOffset = 0; player.jumpVelocity = 0; player.jumpWasDown = false;moveVelocity={x:0,z:0};
    player.yaw = finite(state.yaw) ? Number(state.yaw) : 0;
    player.pitch = finite(state.pitch) ? clamp(Number(state.pitch), -0.85, 0.55) : -0.12;
    player.distanceWalked = Math.max(0, Number(state.distanceWalked) || 0);
    player.safe = { x, y, z };playerMade.root.rotation.y=-player.yaw; blocked = null;
    rebaseIfNeeded(); updateCamera(); requestNeighborhood(); notifyState(true); return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    for (const entry of entries.values()) { worldRoot.remove(entry.group); disposeTree(entry.group); }
    entries.clear();
    for (const npc of npcs) { worldRoot.remove(npc.root); disposeTree(npc.root); }
    npcs.length = 0;
    if (routeLine) { worldRoot.remove(routeLine); disposeTree(routeLine); routeLine = null; }
    worldRoot.remove(playerMade.root); disposeTree(playerMade.root);
    for (const material of [groundMat, roadMat, bridgeMat, buildingMat, waterMat]) material.dispose();
    worldRoot.remove(peopleBatch.root);peopleBatch.dispose();wuyiKit.dispose();surfaces.dispose();lighting.dispose();renderer.dispose();
  }

  resize();
  if (!Object.keys(chunkSources).length) {
    blocked = { code: 'manifest-empty', message: 'manifest 没有地理分块；未生成虚构长沙底图，当前无法行走。' };
    emitNotice(blocked.message, blocked);
  } else if (![start.x, start.z].every(finite)) {
    blocked = { code: 'invalid-start', message: 'manifest.start 缺少有效的世界坐标。' };
  } else {
    player.x = Number(start.x); player.z = Number(start.z);
    if(inWuyi(player.x,player.z)){player.yaw=wuyiStart.yaw;player.pitch=wuyiStart.pitch;}
    const [ix, iz] = toIndex(player.x, player.z);
    const entry = await loadChunk(ix, iz);
    const groundY = sampleTerrain(entry, player.x, player.z);
    if (groundY == null) {
      blocked = { code: chunkSources[`${ix}_${iz}`] ? 'start-chunk-invalid' : 'start-chunk-missing', key: `${ix}_${iz}`,
        message: chunkSources[`${ix}_${iz}`] ? '起点地形未能加载，无法安全移动。' : `起点分块 ${ix}_${iz} 不在 manifest 中，无法安全移动。` };
      emitNotice(blocked.message, blocked);
    } else {
      player.y = groundY; player.groundY = groundY; player.safe = { x: player.x, y: groundY, z: player.z };
      playerMade.root.position.set(player.x, player.y, player.z);
    playerMade.root.rotation.y=-player.yaw;
      requestNeighborhood(); updateCamera();
    }
  }
  notifyState(true);
  return { update, render, resize, getState: () => {
    if (!Number.isFinite(player.x)) return { x: Number(start.x) || 0, y: 0, z: Number(start.z) || 0, yaw: 0, pitch: -0.12, distanceWalked: 0,
      activeChunks: entries.size, npcCount: npcs.length, nearestPoi: null, loading: inflight.size > 0, blocked: blocked ? { ...blocked } : null };
    const poi = nearestPoi();
    return { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, distanceWalked: player.distanceWalked,bodyYaw:playerMade.root.rotation.y,velocity:{...moveVelocity},
      activeChunks: entries.size, npcCount: npcs.length,
      nearestPoi: poi ? { id: poi.id ?? null, name: poi.name ?? '', distance: Math.hypot(Number(poi.world.x) - player.x, Number(poi.world.z) - player.z) } : null,
      loading: inflight.size > 0, blocked: blocked ? { ...blocked } : null, cameraMode, cameraFov:camera.fov, photoMode, photoView:photoOptions.view||null, photoAim:photoAim?{yaw:photoAim.yaw,pitch:photoAim.pitch}:null, time: timeMode, autoWalk, routeIndex, routePointCount: routePoints.length };
  }, getLocalMap:()=>{const local=[...entries.values()].filter(e=>Math.abs(e.originX+size/2-player.x)<size&&Math.abs(e.originZ+size/2-player.z)<size);return{roads:local.flatMap(e=>e.roads),water:local.flatMap(e=>e.water),buildings:local.flatMap(e=>e.buildings)};}, getNpcStates:()=>npcs.map(n=>({id:npcId(n),name:n.name,heading:n.root.rotation.y,initialized:Boolean(n.surfaceInitialized),x:n.root.position.x,y:n.root.position.y,z:n.root.position.z,behavior:n.behavior,visible:n.root.visible,pathId:n.roadId,pathDistance:n.pathDistance,surfaceOffset:offsetAt(n.root.position.x,n.root.position.z,n.root.position.y),groundError:Math.abs(n.root.position.y-(walkingSurface(findEntry(n.root.position.x,n.root.position.z),n.root.position.x,n.root.position.z,n.root.position.y)??n.root.position.y)),intersectsBuilding:findEntry(n.root.position.x,n.root.position.z)?.buildings.some(b=>hitsBuilding(b,n.root.position.x,n.root.position.z,n.root.position.y))??false,intersectsFurniture:furnitureAt(n.root.position.x,n.root.position.z,n.root.position.y)})), getSceneEvidence:()=>({wuyiBuildings:[...wuyiKit.buildings.values()],npcRenderedParts:peopleBatch.evidence().count,npcExpectedParts:npcs.filter(n=>n.root.visible).reduce((sum,n)=>sum+n.parts.filter(m=>m.userData.renderEnabled!==false).length,0),npcCapacity:peopleBatch.evidence().capacity,npcBatches:peopleBatch.evidence().batches,pixelSurfaces:surfaces.evidence(),lighting:lighting.evidence(),cameraPose:{x:camera.position.x+renderOriginX,y:camera.position.y,z:camera.position.z+renderOriginZ,smoothedFeetY:cameraFeetY,rig:cameraRig.getEvidence()},renderCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,cameraFov:camera.fov,renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),unmaskedRenderer:(()=>{const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;})(),furniture:[...entries.values()].flatMap(e=>e.furniture||[]),underground:[...entries.values()].flatMap(e=>e.undergroundEvidence?[e.undergroundEvidence]:[]),surfaceMetro:[...entries.values()].flatMap(e=>e.surfaceMetroEvidence||[]),surfaceModel:'Wuyi photo-informed grading with boundary blend; approximate, not surveyed'}),stopMovement(){moveVelocity={x:0,z:0};},getRenderGroundContacts({includePlayer=false}={}){worldRoot.updateMatrixWorld(true);const ray=new THREE.Raycaster(),out=[];for(const n of [...npcs,...(includePlayer?[{name:"player",root:playerMade.root,roadId:"player"}]:[])]){ray.set(new THREE.Vector3(n.root.position.x-renderOriginX,n.root.position.y+2.3,n.root.position.z-renderOriginZ),new THREE.Vector3(0,-1,0));ray.far=5;const h=ray.intersectObject(worldRoot,true).find(h=>{if(peopleBatch.ownsMesh(h.object)||h.object.material?.transparent||h.face.normal.y<.5)return false;let o=h.object;while(o){if(o===playerMade.root||npcs.some(n=>n.root===o))return false;o=o.parent;}return true;});out.push({name:n.name,x:n.root.position.x,z:n.root.position.z,feetY:n.root.position.y,path:n.roadId,visibleSurfaceY:h?.point.y??null,delta:h?h.point.y-n.root.position.y:null,material:h?.object.material?.color?.getHexString()});}return out;},getPhotoSubjects({width=1920,height=1080}={}){updateCamera();const framing=camera.clone();framing.aspect=width/height;framing.updateProjectionMatrix();return wuyiKit.photoSubjects(framing,worldRoot);},setCameraFov(value){camera.fov=clamp(Number(value)||65,32,85);camera.updateProjectionMatrix();}, setReviewLabelsVisible:wuyiKit.setLabelsVisible, setPhotoAspect, setTime, setCameraMode, setPhotoMode, setPhotoView, endInteraction, getPhotoResumeFov:()=>photoAim?.resumeFov??camera.fov, getLastCapture:()=>lastCaptureEvidence?structuredClone(lastCaptureEvidence):null, capture, setRoute, setAutoWalk, restore, interact, dispose };
}
