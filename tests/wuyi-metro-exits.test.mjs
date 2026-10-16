import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SURFACE_METRO_EXITS,
  SURFACE_METRO_EXIT_PROFILE,
  surfaceExitAt,
  surfaceExitBoundary,
  surfaceExitOffset,
  surfaceExitPolygons
} from '../src/wuyi-metro-exits.mjs';
import {hitsFurniture} from '../src/world.mjs';
import { decorateSurfaceMetroExits } from '../src/wuyi-metro-render.mjs';

function pointAt(exit, along, lateral = 0) {
  return {
    x: exit.x + exit.dx * along - exit.dz * lateral,
    z: exit.z + exit.dz * along + exit.dx * lateral
  };
}

test('four photo-backed POIs retain exact coordinates and explicit estimate provenance', () => {
  const original=SURFACE_METRO_EXITS.filter(e=>['1','2','4','8'].includes(e.id));
  assert.deepEqual(original.map(({ id }) => id), ['1', '2', '4', '8']);
  for (const exit of original) {
    assert.equal(exit.profile, SURFACE_METRO_EXIT_PROFILE);
    assert.equal(exit.positionAccuracyProven, false);
    assert.equal(exit.orientationEstimated, true);
    assert.equal(exit.dimensionsEstimated, true);
    assert.equal(exit.surveyed, false);
    assert.equal(exit.photoYear, 2025);
    assert.match(exit.sourcePhoto, /\.png$/);
    assert.equal(exit.sourceKind, 'provider named POI, not surveyed');
  }
  assert.deepEqual(
    original.map(({ x, z, dx, dz }) => [x, z, dx, dz]),
    [
      [-2976.665, 157.598, 1, 0],
      [-2886.025, 168.77, Math.SQRT1_2, Math.SQRT1_2],
      [-2833.185, 179.05, 0, 1],
      [-2974.618, 111.79, 1, 0]
    ]
  );
});

test('shared profile gives traversable plinth, landing, and descending treads', () => {
  const exit = SURFACE_METRO_EXITS[0];
  const plinth = pointAt(exit, -2.0);
  const landing = pointAt(exit, 1.2);
  const firstStair = pointAt(exit, 2.6);
  const bottom = pointAt(exit, 13.9);

  assert.equal(surfaceExitOffset(plinth.x, plinth.z), 0.16);
  assert.equal(surfaceExitOffset(landing.x, landing.z), 0.48);
  assert.ok(surfaceExitOffset(firstStair.x, firstStair.z) < 0.48);
  assert.equal(surfaceExitOffset(bottom.x, bottom.z), -3.6);
  assert.equal(surfaceExitOffset(exit.x + exit.dx * 15, exit.z + exit.dz * 15), null);
  assert.equal(surfaceExitAt(exit.x, exit.z).exit.id, exit.id);
});

test('clip polygons include the approach and collision blocks only the below-grade side/back band', () => {
  const polygons = surfaceExitPolygons();
  assert.equal(polygons.length, 6);
  for (const polygon of polygons) {
    assert.equal(polygon.surveyed, false);
    assert.equal(polygon.dimensionsEstimated, true);
    assert.ok(polygon.points.length === 4);
  }

  const exit = SURFACE_METRO_EXITS[1];
  const sideWallOutside = pointAt(exit, 5, SURFACE_METRO_EXIT_PROFILE.width / 2 + 0.3);
  const farOutside = pointAt(exit, 5, SURFACE_METRO_EXIT_PROFILE.width / 2 + 1.2);
  const frontOutside = pointAt(exit, -SURFACE_METRO_EXIT_PROFILE.approach - 0.3);

  assert.equal(surfaceExitBoundary(sideWallOutside.x, sideWallOutside.z, -1), true);
  assert.equal(surfaceExitBoundary(sideWallOutside.x, sideWallOutside.z, 0), false);
  assert.equal(surfaceExitBoundary(farOutside.x, farOutside.z, -1), false);
  assert.equal(surfaceExitBoundary(frontOutside.x, frontOutside.z, -1), false);
  const backWallOutside = pointAt(exit, SURFACE_METRO_EXIT_PROFILE.length + 0.3);
  assert.equal(surfaceExitBoundary(backWallOutside.x, backWallOutside.z, -1), true);
});

test('renderer draws eligible exits once with line colors, numbers, and bounded wall collisions', () => {
  const group = new THREE.Group();
  const entry = { originX: -3072, originZ: 0, furniture: [] };
  const material = new THREE.MeshStandardMaterial({ color: '#888888' });
  const materials = {
    pavement: material,
    cream: material,
    dark: material,
    trim: material,
    clearGlass: material,
    orange: material,
    glow: material,
    leaf: material,
    hedge: material
  };
  const labels = [];
  const sign = (_group, text) => labels.push(text);

  decorateSurfaceMetroExits(group, entry, () => 50, materials, sign);

  assert.equal(labels.length, 24);
  for (const id of ['1', '2', '4', '8']) {
    assert.ok(labels.includes(id + ' 出入口'));
  }
  assert.ok(labels.includes('1号线'));
  assert.ok(labels.includes('2号线'));
  assert.ok(group.children.length > 100);
  assert.ok(entry.furniture.length >= 4);
  for (const obstacle of entry.furniture) {
    assert.ok(Number.isFinite(obstacle.minY));
    assert.ok(obstacle.maxY > obstacle.minY);
  }

  const outside = new THREE.Group();
  decorateSurfaceMetroExits(outside,
    { originX: 0, originZ: 0, furniture: [] }, () => 50, materials, sign);
  assert.equal(outside.children.length, 0);
});

test('rendered stair rails share the signed lateral convention and full descent of the walking surface',()=>{
 const g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[]},m=new THREE.MeshLambertMaterial(),materials=Object.fromEntries(['pavement','cream','dark','trim','clearGlass','orange','glow','leaf','hedge'].map(k=>[k,m]));decorateSurfaceMetroExits(g,e,()=>50,materials,()=>{});
 for(const exit of SURFACE_METRO_EXITS)for(const lateral of[(-2.15-.86)*exit.profile.width/6.4,(-2.15+.86)*exit.profile.width/6.4]){
  const mid=(exit.profile.length+exit.profile.landingLength)/2,pos=pointAt(exit,mid,lateral),rail=g.children.find(o=>o.geometry?.parameters?.width===.075&&o.geometry.parameters.height===.075&&Math.hypot(o.position.x+e.originX-pos.x,o.position.z+e.originZ-pos.z)<1e-5);assert.ok(rail);
  assert.ok(Math.abs(surfaceExitAt(pos.x,pos.z).lateral-lateral)<1e-8);
  const half=rail.geometry.parameters.depth/2,a=new THREE.Vector3(0,0,-half).applyQuaternion(rail.quaternion),b=new THREE.Vector3(0,0,half).applyQuaternion(rail.quaternion);assert.ok(Math.abs((b.y-a.y)+exit.profile.depth+exit.profile.topRise)<1e-8);assert.ok(Math.abs((b.x-a.x)*exit.dx+(b.z-a.z)*exit.dz-(exit.profile.length-exit.profile.landingLength))<1e-8);
 }
});

test('station labels sit outside the front header face and the end wall closes the below-grade void',()=>{
 const g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[]},m=new THREE.MeshLambertMaterial(),materials=Object.fromEntries(['pavement','cream','dark','trim','clearGlass','orange','glow','leaf','hedge'].map(k=>[k,m]));
 const labels=[];decorateSurfaceMetroExits(g,e,()=>50,materials,(_g,text,x,y,z,w,h,yaw)=>labels.push({text,x:x+e.originX,z:z+e.originZ,yaw}));
 for(const exit of SURFACE_METRO_EXITS){
  const label=labels.find(l=>l.text===exit.id+' 出入口');
  const along=(label.x-exit.x)*exit.dx+(label.z-exit.z)*exit.dz;
  assert.ok(along < -1.95-.1,'label must lie in front of the opaque header');
  assert.ok(Math.sin(label.yaw)*exit.dx+Math.cos(label.yaw)*exit.dz < -.99,'front must face approach');
  const pos=pointAt(exit,exit.profile.length),back=g.children.find(o=>o.geometry?.parameters?.width===exit.profile.width&&o.geometry.parameters.depth===.2&&Math.hypot(o.position.x+e.originX-pos.x,o.position.z+e.originZ-pos.z)<1e-5);
  assert.ok(back);assert.ok(back.position.y+back.geometry.parameters.height/2>=53.8);
 }
});

test('northwest-facing exit 2 keeps the diagonal stair lane clear but blocks its rotated rails',()=>{
 const g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[]},m=new THREE.MeshLambertMaterial(),materials=Object.fromEntries(['pavement','cream','dark','trim','clearGlass','orange','glow','leaf','hedge'].map(k=>[k,m]));decorateSurfaceMetroExits(g,e,()=>50,materials,()=>{});
 const exit=SURFACE_METRO_EXITS.find(e=>e.id==='2');assert.ok(exit.dx>0&&exit.dz>0);assert.match(exit.orientationSource,/5136437/);
 for(let along=0;along<13;along+=.25){const p=pointAt(exit,along,-2.15),y=50.1+surfaceExitOffset(p.x,p.z);assert.equal(hitsFurniture(e,p.x,p.z,y),false,'walkable diagonal lane');}
 const rail=pointAt(exit,8.25,-1.29);assert.equal(hitsFurniture(e,rail.x,rail.z,49),true,'rail stops crossing');assert.equal(hitsFurniture(e,rail.x,rail.z,60),false,'height layers stay separate');
});

test('the four station labels occupy separate spans on every header',()=>{
 const g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[]},m=new THREE.MeshLambertMaterial(),materials=Object.fromEntries(['pavement','cream','dark','trim','clearGlass','orange','glow','leaf','hedge'].map(k=>[k,m])),labels=[];
 decorateSurfaceMetroExits(g,e,()=>50,materials,(_g,text,x,y,z,w)=>labels.push({text,x:x+e.originX,z:z+e.originZ,w}));
 for(const exit of SURFACE_METRO_EXITS){const spans=labels.filter(l=>Math.abs((l.x-exit.x)*exit.dx+(l.z-exit.z)*exit.dz+2.065)<1e-5).map(l=>{const c=-(l.x-exit.x)*exit.dz+(l.z-exit.z)*exit.dx;return[c-l.w/2,c+l.w/2];}).sort((a,b)=>a[0]-b[0]);assert.equal(spans.length,4);for(let j=1;j<spans.length;j++)assert.ok(spans[j][0]>spans[j-1][1]);}
});

// Photographer GPS and a reconstructed door anchor are deliberately different fields.
test('5 and 7 use dated photograph context and distinct profiles without claiming measured positions',()=>{
 const added=SURFACE_METRO_EXITS.filter(e=>['5','7'].includes(e.id));assert.equal(added.length,2);
 for(const e of added){assert.equal(e.gcj02,null);assert.equal(e.wgs84,null);assert.equal(e.photographerWgs84.length,2);assert.match(e.sourceKind,/reconstructed/);assert.equal(e.positionAccuracyProven,false);assert.notEqual(e.profile,SURFACE_METRO_EXIT_PROFILE);assert.ok(e.profile.width>=5);assert.ok(e.profile.topRise/e.profile.plinthSteps<=.18);}
 assert.deepEqual(added.map(e=>[e.dx,e.dz]),[[-1,0],[0,1]]);
});
