import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import{WUYI}from'../src/wuyi-data.mjs';
import{heiwadoCurvedFootprint,heiwadoFascias,inPolygon,WUYI_PATHS}from'../src/wuyi-site.mjs';
import{HEIWADO_RETAIL,retailRecess,LANDSCAPE_CORES,COURT_PORTALS,courtPortalAt,COURT_SECTION,CENTRAL_COURT,inCentralCourt}from'../src/wuyi-place.mjs';
import{undergroundOffset,undergroundBoundary,flightAt,courtEdgesAt,SUNKEN_COURT}from'../src/wuyi-underground.mjs';
import{decorateWuyiEntrances}from'../src/wuyi-entrances.mjs';
import{hitsFurniture,hitsBuilding}from'../src/world.mjs';
import{SURFACE_METRO_EXITS,surfaceExitOffset}from'../src/wuyi-metro-exits.mjs';
import{decorateSurfaceMetroExits}from'../src/wuyi-metro-render.mjs';
const area=p=>Math.abs(p.reduce((a,v,i)=>{const w=p[(i+1)%p.length];return a+v[0]*w[1]-w[0]*v[1]},0))/2;
const materials=()=>{const m=new THREE.MeshLambertMaterial();return Object.fromEntries(['cream','trim','clearGlass','pavement','hedge','leaf','dark','orange','glow','aqua','white','wood'].map(k=>[k,m]));};
test('official three-storey storefront cuts real volume from either runtime podium winding without changing the GIS ring',()=>{
 const source=WUYI.features['52072595'].polygon,original=structuredClone(source);
 for(const ring of[source,[...source].reverse()]){
  const curved=heiwadoCurvedFootprint(ring),r=retailRecess(curved,heiwadoFascias(curved).north);
  assert.ok(Math.abs(area(curved)-area(r.polygon)-r.width*HEIWADO_RETAIL.depth)<1e-6);
  const x=(r.start[0]+r.end[0])/2-r.nx*2,z=(r.start[1]+r.end[1])/2-r.nz*2;
  assert.equal(inPolygon(x,z,curved),true);assert.equal(inPolygon(x,z,r.polygon),false);
  const lower={polygon:r.polygon,minY:62.5,maxY:62.5+r.height},upper={polygon:curved,minY:62.5+r.height,maxY:172.5};
  assert.equal(hitsBuilding(lower,x,z,62.6),false);assert.equal(hitsBuilding(upper,x,z,62.6),false);assert.equal(hitsBuilding(upper,x,z,62.5+r.height),true);
 }
 assert.deepEqual(source,original);assert.deepEqual(HEIWADO_RETAIL.floors,[1,2,3]);assert.equal(HEIWADO_RETAIL.positionAccuracyProven,false);
});
test('three partial landscape cores remain inside actual canopy rings and clear authored public path centres',()=>{
 assert.equal(Object.keys(LANDSCAPE_CORES).length,3);
 for(const[id,c]of Object.entries(LANDSCAPE_CORES)){
  for(let i=0;i<c.polygon.length;i++){const a=c.polygon[i],b=c.polygon[(i+1)%c.polygon.length];for(let t=0;t<1;t+=.1)assert.equal(inPolygon(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,WUYI.features[id].polygon),true);}
  for(const p of WUYI_PATHS)for(const[x,z]of p.points)assert.equal(inPolygon(x,z,c.polygon),false,`${p.id} crosses ${id}`);
 }
});
test('6C reconstructed foyer has a continuous below-grade route, physical walls and no surface opening',()=>{
 const portal=COURT_PORTALS.find(p=>p.id==='6C'),g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[],pedestrianPaths:[]};decorateWuyiEntrances(g,e,()=>62.5,materials(),()=>{});
 const path=e.pedestrianPaths.find(p=>p.id==='wuyi-6C-reconstructed-foyer');assert.ok(path);
 for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i];for(let t=0;t<=1;t+=.02){const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;assert.equal(undergroundOffset(x,z,-SUNKEN_COURT.depth),-SUNKEN_COURT.depth);assert.equal(undergroundBoundary(x,z,-SUNKEN_COURT.depth),false);assert.equal(hitsFurniture(e,x,z,62.5-SUNKEN_COURT.depth+.1),false,`blocked foyer at ${x},${z}`);}}
 assert.equal(undergroundOffset(portal.x+1.3,portal.z,0),null);assert.equal(undergroundBoundary(portal.x+1.3,portal.z,0),false);
 assert.equal(courtPortalAt(portal.x-1,portal.z),null);assert.ok(COURT_SECTION.clearStorey>=3);assert.equal(portal.positionAccuracyProven,false);
});
test('6D evidence conflict cannot silently become a fabricated surface entry or tunnel',()=>{
 const p=COURT_PORTALS.find(p=>p.id==='6D');assert.equal(p.placed,false);assert.ok(flightAt(p.x,p.z));assert.equal(courtPortalAt(p.x,p.z),null);assert.match(p.reason,/elevation/);
});
test('each photograph-derived entrance keeps its rendered stair lane free at its own width and descent',()=>{
 const g=new THREE.Group(),e={originX:-3072,originZ:0,furniture:[]};decorateSurfaceMetroExits(g,e,()=>62.5,materials(),()=>{});
 for(const exit of SURFACE_METRO_EXITS.filter(p=>['5','7'].includes(p.id))){const lateral=-2.15*exit.profile.width/6.4;for(let along=0;along<exit.profile.length-.3;along+=.17){const x=exit.x+exit.dx*along-exit.dz*lateral,z=exit.z+exit.dz*along+exit.dx*lateral;assert.equal(hitsFurniture(e,x,z,62.6+surfaceExitOffset(x,z)),false);}}
});

test('the paved central court stays inside the real park and outside solid landscape cores and underground void',()=>{
 for(let i=0;i<64;i++){const t=i/64*Math.PI*2,x=CENTRAL_COURT.x+Math.cos(t)*CENTRAL_COURT.rx,z=CENTRAL_COURT.z+Math.sin(t)*CENTRAL_COURT.rz;
 assert.equal(inPolygon(x,z,WUYI.features['268748336'].polygon),true);assert.equal(undergroundOffset(x,z,0),null);for(const c of Object.values(LANDSCAPE_CORES))assert.equal(inPolygon(x,z,c.polygon),false);}
 assert.equal(inCentralCourt(-2765,-27),true);assert.equal(inCentralCourt(-2815,-27),false);
});
