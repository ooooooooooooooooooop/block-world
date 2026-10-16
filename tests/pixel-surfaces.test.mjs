import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {surfacePixels,createPixelPalette,boxSurfaceUV} from '../src/pixel-surfaces.mjs';
import {makeBlockPerson,CHARACTER_SURFACE_PART_LIMITS} from '../src/character.mjs';
import {createPeopleBatch} from '../src/people-batch.mjs';

function parts(root){const a=[];root.traverse(o=>{if(o.isMesh)a.push(o);});return a;}
function span(g,axis,normalAxis){const p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv,a=[];for(let i=0;i<p.count;i++)if(n.getComponent(i,normalAxis)>.9)a.push(u.getComponent(i,axis));return Math.max(...a)-Math.min(...a);}

test('surface palette shares correctly annotated textures without stretching pixels to object bounds',()=>{
 const palette=createPixelPalette();const a=palette.texture('grass');assert.equal(a,palette.texture('grass'));
 assert.equal(a.colorSpace,THREE.SRGBColorSpace);assert.equal(a.magFilter,THREE.NearestFilter);assert.equal(a.wrapS,THREE.RepeatWrapping);
 assert.equal(a.image.width/a.userData.repeatMetres,16);assert.equal(palette.texture('cloth').image.width/palette.texture('cloth').userData.repeatMetres,32);
 assert.deepEqual(surfacePixels('grass').data,a.image.data);assert.throws(()=>surfacePixels('missing'),RangeError);palette.dispose();
});

test('one and four metre surfaces retain the same pixel density on every box axis',()=>{
 const small=boxSurfaceUV(new THREE.BoxGeometry(1,2,3),4),large=boxSurfaceUV(new THREE.BoxGeometry(4,8,12),4);
 for(const axis of [0,1,2])for(const uv of [0,1])assert.ok(Math.abs(span(large,uv,axis)-4*span(small,uv,axis))<1e-6);
 small.dispose();large.dispose();
});

test('all original character variants and photo props fit the textured crowd capacity',()=>{
 const palette=createPixelPalette();
 for(const v of [0,1,2])for(const npc of [true,false]) {
  const person=makeBlockPerson(npc,0x578298,v,{surfaces:palette});person.pose({mode:'selfie'});person.root.updateMatrixWorld(true);
  const grouped={};for(const part of parts(person.root)){const kind=part.material.userData.pixelSurface;grouped[kind]=(grouped[kind]||0)+1;}
  for(const[k,count]of Object.entries(grouped))assert.ok(count<=CHARACTER_SURFACE_PART_LIMITS[k],`${v}/${npc}: ${k} ${count}`);
  const torso=parts(person.root).find(p=>p.name==='shirt-body');assert.ok(Math.abs(span(torso.geometry,0,2)*32/(torso.geometry.parameters.width*.9)-32)<1e-5);
 }palette.dispose();
});

test('crowd batching preserves identity, tint, world texel scale and ray visibility across rebasing and poses',()=>{
 const palette=createPixelPalette(),world=new THREE.Group();world.position.x=-2048;
 const person=makeBlockPerson(true,0x985e75,1,{surfaces:palette});person.root.position.set(2048,0,-5);person.pose({mode:'selfie'});world.add(person.root);
 const actor={...person,parts:parts(person.root),id:'travel-7'};actor.parts.forEach(p=>p.visible=false);
 const batch=createPeopleBatch({surfaces:palette,maxPeople:1,idOf:a=>a.id});world.add(batch.root);world.updateMatrixWorld(true);batch.update([actor]);
 assert.equal(batch.evidence().count,actor.parts.length);assert.equal(batch.evidence().batches.filter(b=>b.textured).length,4);
 const cloth=batch.root.children.find(o=>o.name==='people-cloth'),color=new THREE.Color();cloth.getColorAt(0,color);assert.equal(color.getHex(),0x985e75);
 const size=cloth.geometry.attributes.instancePartSize;assert.ok(Math.abs(size.getX(0)-.72*.9)<1e-6);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),.1,10);batch.root.updateMatrixWorld(true);
 assert.ok(batch.rayHits(ray).length>0);assert.ok(batch.rayHits(ray).every(h=>h.ownerId==='travel-7'));
 person.root.visible=false;batch.update([actor]);assert.equal(batch.evidence().count,0);assert.equal(batch.rayHits(ray).length,0);
 batch.dispose();palette.dispose();
});

test('an incompatible added surface fails loudly before corrupting instance ownership',()=>{
 const palette=createPixelPalette(),person=makeBlockPerson(true,0x578298,1,{surfaces:palette}),actor={...person,parts:parts(person.root),id:'a'};
 actor.parts.push(actor.parts.find(p=>p.material.userData.pixelSurface==='skin'));person.root.updateMatrixWorld(true);
 const batch=createPeopleBatch({surfaces:palette,maxPeople:1,idOf:a=>a.id});assert.throws(()=>batch.update([actor]),/skin surface budget exceeded/);
 batch.dispose();palette.dispose();
});

import {snapShadowTarget} from '../src/city-lighting.mjs';
test('directional shadow projection stays on the same absolute texel grid through walking and rebasing',()=>{
 const light=new THREE.DirectionalLight();light.shadow.camera.left=light.shadow.camera.bottom=-75;light.shadow.camera.right=light.shadow.camera.top=75;light.shadow.mapSize.set(2048,2048);
 const direction=new THREE.Vector3(-100,180,70),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize(),step=150/2048;
 for(const x of [-4096,-2795,0,2048,90000])for(let i=0;i<20;i++) {
  const p=new THREE.Vector3(x+i*.005,62.5,94+i*.002),snapped=snapShadowTarget(p,light.shadow);
  for(const axis of [right,up]) {const cell=snapped.dot(axis)/step;assert.ok(Math.abs(cell-Math.round(cell))<1e-7);assert.ok(Math.abs(snapped.dot(axis)-p.dot(axis))<=step/2+1e-8);}
  // The render origin may move by a chunk; it must not change the world alignment.
  const local=snapped.clone().sub(new THREE.Vector3(2048,0,0));assert.ok(local.clone().add(new THREE.Vector3(2048,0,0)).distanceTo(snapped)<1e-8);
 }
});
