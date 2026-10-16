import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createThirdPersonRig,snapshotCameraOccluders,nearCameraOccluders} from '../src/camera-rig.mjs';

function setup() {
  const camera=new THREE.PerspectiveCamera(65,1.6,.1,6000);
  return {camera,rig:createThirdPersonRig(camera)};
}
function wall(x=0,width=8,transparent=false) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,8,.2),
    new THREE.MeshBasicMaterial({transparent,opacity:transparent?.4:1}));
  mesh.position.set(x,2,3);mesh.updateWorldMatrix(true,true);return mesh;
}
const pose={x:0,y:0,z:0,yaw:0,pitch:0,dt:1/60};

test('open third-person composition uses a 7 metre orbit, photography keeps 9',()=>{
  const {camera,rig}=setup();let e=rig.update(pose);
  assert.equal(e.orbitMeters,7);assert.equal(e.blocked,false);assert.ok(Math.abs(camera.position.z-7)<1e-10);
  e=rig.update({...pose,photo:true,dt:0});assert.equal(e.orbitMeters,9);assert.ok(Math.abs(camera.position.z-9)<1e-10);
});
test('a ground-level opaque wall immediately pulls the camera in front of its face',()=>{
  const {camera,rig}=setup();rig.update(pose);const e=rig.update({...pose,occluders:[wall()]});
  assert.equal(e.blocked,true);assert.ok(e.hitRays>=1);assert.ok(camera.position.z<2.9-.2);
});
test('near-plane corner rays catch an obstruction missed by the centre line',()=>{
  const {rig}=setup();const e=rig.update({...pose,occluders:[wall(.20,.08)]});
  assert.equal(e.blocked,true);assert.ok(e.hitRays>0&&e.hitRays<5);
});
test('transparent facade decoration does not push the camera in',()=>{
  const {rig}=setup();const e=rig.update({...pose,occluders:[wall(0,8,true)]});
  assert.equal(e.blocked,false);assert.equal(e.candidateMeshes,0);
});
test('restoring camera distance is frame-rate independent and never overshoots',()=>{
  const a=setup(),b=setup();a.rig.update({...pose,occluders:[wall()]});b.rig.update({...pose,occluders:[wall()]});
  let ea,eb;for(let i=0;i<60;i++)ea=a.rig.update({...pose,dt:1/60});for(let i=0;i<20;i++)eb=b.rig.update({...pose,dt:1/20});
  assert.ok(Math.abs(ea.solvedDistance-eb.solvedDistance)<1e-10);assert.ok(ea.solvedDistance<=ea.idealDistance);
});
test('changing yaw has no additional smoothing delay',()=>{
  const {camera,rig}=setup();rig.update(pose);rig.update({...pose,yaw:Math.PI/2});
  assert.ok(camera.position.x<-6.9);assert.ok(Math.abs(camera.position.z)<1e-10);
});

test('query shapes retain exact transforms after batching and floating-origin rebasing',()=>{
  const root=new THREE.Group();root.position.set(1000,0,2000);
  const group=new THREE.Group();group.position.set(2,0,0);group.rotation.y=Math.PI/4;root.add(group);
  const mesh=wall(0,1);group.add(mesh);
  const records=snapshotCameraOccluders(root);const original=mesh.matrixWorld.clone();
  group.remove(mesh);mesh.geometry.dispose(); // GPU release, same CPU positions used by the material batch
  let found=nearCameraOccluders(records,root.matrixWorld,{x:4,y:2,z:2},6);
  assert.equal(found.length,1);assert.ok(mesh.matrixWorld.elements.every((v,i)=>Math.abs(v-original.elements[i])<1e-10));
  root.position.set(0,0,0);root.updateWorldMatrix(true,true);
  found=nearCameraOccluders(records,root.matrixWorld,{x:4,y:2,z:2},6);
  assert.equal(found.length,1);assert.ok(Math.abs(mesh.matrixWorld.elements[12]-(original.elements[12]-1000))<1e-10);
  const {rig}=setup();const hit=rig.update({...pose,x:4,occluders:found});assert.ok(Number.isFinite(hit.solvedDistance));
});
test('nearby query rejects distant shapes and transparent decorations before raycasting',()=>{
  const root=new THREE.Group(),near=wall(),far=wall();far.position.x=1000;root.add(near,far,wall(0,8,true));
  const records=snapshotCameraOccluders(root);assert.equal(records.length,2);
  const found=nearCameraOccluders(records,root.matrixWorld,{x:0,y:1.72,z:0},10);assert.deepEqual(found,[near]);
  const {rig}=setup();assert.equal(rig.update({...pose,occluders:found}).blocked,true);
});

test('a close obstruction hides the avatar until the camera has room to show it',()=>{
  const {rig}=setup(),close=wall();close.position.z=1.1;close.updateWorldMatrix(true,true);
  let e=rig.update({...pose,occluders:[close]});assert.equal(e.hideAvatar,true);
  for(let i=0;i<60;i++)e=rig.update(pose);assert.equal(e.hideAvatar,false);
});
