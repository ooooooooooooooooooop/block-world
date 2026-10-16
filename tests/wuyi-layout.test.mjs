import {isWuyiGarden} from '../src/wuyi-site.mjs';
import {clipTilePolygon}from'../src/wuyi.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {WUYI} from '../src/wuyi-data.mjs';
import {SCULPTURE_SITE,inPolygon,heiwadoCurvedFootprint} from '../src/wuyi-site.mjs';
import {undergroundOffset,undergroundBoundary} from '../src/wuyi-underground.mjs';
test('the sculpture bed stays inside the actual park and out of its southern building notch',()=>{const s=SCULPTURE_SITE;for(const dx of[-s.width/2,s.width/2])for(const dz of[-s.depth/2,s.depth/2])assert.equal(inPolygon(s.x+dx,s.z+dz,WUYI.features['268748336'].polygon),true);assert.equal(inPolygon(-2748,63,WUYI.features['268748336'].polygon),false);});
test('an unverified vestibule does not create a walkable extension outside the traced court',()=>{const x=-2830,z=88;assert.equal(undergroundOffset(x,z,0),null);assert.equal(undergroundOffset(x,z,-5.2),null);});

test('photo-informed Heiwado curve keeps endpoints and follows a continuous ellipse instead of the coarse diagonal',()=>{const ps=WUYI.features['52072595'].polygon,curved=heiwadoCurvedFootprint(ps);assert.ok(curved.length>ps.length);assert.deepEqual(curved[0],curved.at(-1));assert.ok(curved.some(([x,z])=>Math.abs(x+2818.12)<.2&&Math.abs(z-187.25)<.2));assert.deepEqual(ps,WUYI.features['52072595'].polygon);});

test('cross-tile ground polygons clip before height sampling and are never duplicated outside their owner',()=>{assert.deepEqual(clipTilePolygon([[1100,10],[1200,10],[1150,30]]),[]);const p=clipTilePolygon([[-20,100],[20,100],[20,120],[-20,120]]);assert.ok(p.length>=4&&p.every(([x,z])=>x>=0&&x<=1024&&z>=0&&z<=1024));const area=Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0))/2;assert.equal(area,400);});

test('bridge landing is never classified as a planting bed',()=>{
 const park=[[-2860,-110],[-2680,-110],[-2680,120],[-2860,120]];assert.equal(isWuyiGarden(-2803.65,6.05,park),false);
});

// Use the actual processed chunk: its winding differs from WUYI.features.
test('the runtime OSM ring also produces the photographed curve and preserves its input',async()=>{
 const {readFile}=await import('node:fs/promises');const chunk=JSON.parse(await readFile(new URL('../data/chunks/-3_0.json',import.meta.url),'utf8'));const ps=chunk.buildings.find(b=>String(b.id)==='52072595').polygon,original=structuredClone(ps);
 for(const ring of[ps,[...ps].reverse()]){const curved=heiwadoCurvedFootprint(ring);assert.ok(curved.length>33);assert.ok(curved.some(([x,z])=>Math.abs(x+2818.12)<.2&&Math.abs(z-187.25)<.2));assert.deepEqual(curved[0],curved.at(-1));}
 assert.deepEqual(ps,original);
});

test('lower commercial awnings remain below the intermediate gallery floor in the real rendered geometry',async()=>{
 const THREE=await import('three');const {decorateWuyiEntrances}=await import('../src/wuyi-entrances.mjs');
 const group=new THREE.Group(),material=new THREE.MeshLambertMaterial();const entry={originX:-3072,originZ:0,furniture:[],pedestrianPaths:[]};const m=Object.fromEntries(['cream','trim','clearGlass','pavement','hedge','leaf','dark','orange','glow','aqua','white','wood'].map(k=>[k,material]));
 decorateWuyiEntrances(group,entry,()=>62.5,m,null);group.updateMatrixWorld(true);const awnings=[];
 group.traverse(o=>{if(o.userData.courtShopAwning&&o.userData.underGallery)awnings.push(o)});assert.ok(awnings.length>=5);
 for(const o of awnings){const bounds=new THREE.Box3().setFromObject(o);assert.ok(bounds.max.y<=o.userData.upperDeckY-.05,JSON.stringify({top:bounds.max.y,deck:o.userData.upperDeckY}));}
 group.traverse(o=>o.geometry?.dispose());material.dispose();
});
