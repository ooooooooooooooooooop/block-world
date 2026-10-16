import * as THREE from 'three';
import {CHARACTER_PART_BUDGET,CHARACTER_SURFACE_PART_LIMITS} from './character.mjs';
import {useInstancedSurfaceUV} from './pixel-surfaces.mjs';

// Render adapter only. NPC identity, movement, poses and interaction stay in the world.
export function createPeopleBatch({surfaces,maxPeople=40,idOf}={}) {
  const root=new THREE.Group();root.name='city-people';const batches=new Map();
  for(const [kind,parts] of Object.entries(CHARACTER_SURFACE_PART_LIMITS)) {
    const geometry=new THREE.BoxGeometry(1,1,1),capacity=maxPeople*parts;
    geometry.setAttribute('instancePartSize',new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage));
    const map=kind==='flat'?null:surfaces.texture(kind),material=new THREE.MeshLambertMaterial({color:0xffffff,map});
    if(map)useInstancedSurfaceUV(material,map.userData.repeatMetres);
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);
    mesh.name=`people-${kind}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;
    mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.instanceOwners=[];
    batches.set(kind,mesh);root.add(mesh);
  }
  const inverse=new THREE.Matrix4(),matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),worldScale=new THREE.Vector3();
  let count=0;
  function update(actors) {
    root.updateWorldMatrix(true,false);inverse.copy(root.matrixWorld).invert();count=0;
    for(const mesh of batches.values())mesh.count=0;
    for(const actor of actors) {
      if(!actor.root.visible)continue;
      for(const part of actor.parts) {
        if(part.userData.renderEnabled===false)continue;
        if(++count>maxPeople*CHARACTER_PART_BUDGET)throw new Error('NPC visual budget exceeded');
        const kind=part.material.userData.pixelSurface,mesh=batches.get(kind);
        if(!mesh||mesh.count>=mesh.instanceMatrix.count)throw new Error(`NPC ${kind} surface budget exceeded`);
        const i=mesh.count++,g=part.geometry.parameters;
        scale.set(g.width,g.height,g.depth);matrix.multiplyMatrices(inverse,part.matrixWorld).scale(scale);
        mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,part.material.color);mesh.userData.instanceOwners[i]=idOf(actor);
        worldScale.setFromMatrixScale(part.matrixWorld).multiply(scale);
        mesh.geometry.attributes.instancePartSize.setXYZ(i,worldScale.x,worldScale.y,worldScale.z);
      }
    }
    for(const mesh of batches.values()) {
      mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.instancePartSize.needsUpdate=true;
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
  }
  return {root,update,
    rayHits(ray){return ray.intersectObjects([...batches.values()],false).map(hit=>({...hit,ownerId:hit.object.userData.instanceOwners[hit.instanceId]}));},
    ownsMesh(mesh){return mesh.parent===root;},
    evidence(){return {count,capacity:[...batches.values()].reduce((sum,m)=>sum+m.instanceMatrix.count,0),batches:[...batches].map(([kind,m])=>({kind,count:m.count,capacity:m.instanceMatrix.count,textured:Boolean(m.material.map)}))};},
    dispose(){for(const m of batches.values()){m.geometry.dispose();m.material.dispose();}root.clear();batches.clear();},
  };
}
