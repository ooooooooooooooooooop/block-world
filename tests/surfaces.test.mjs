import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestRoadSurface,sampleTerrain} from '../src/world.mjs';
import {readFileSync} from 'node:fs';
const road=(id,y,x,bridge=false,layer='0')=>({id,width:8,bridge,layer,points:[{x,y,z:-20},{x,y,z:20}]});
test('行走地面与实际渲染三角面一致，角色不会沉进双线性采样误差',()=>{
 const entry={originX:0,originZ:0,terrain:{size:1,resolution:2,heights:[0,0,0,8]}};
 assert.equal(sampleTerrain(entry,.5,.5),0);assert.equal(sampleTerrain(entry,.75,.75),4);
});
test('同一层跟随实际道路中心线，不被邻近道路不同采样高度吸走',()=>{
 const entry={roads:[road('actual',36.6,0),road('nearby',35.85,1.4)]};
 assert.equal(nearestRoadSurface(entry,0,0,36).id,'actual');
});
test('桥上与桥下在平面相交时保持所在层，不掉到另一条道路',()=>{
 const entry={roads:[road('bridge',45,0,true,'1'),road('ground',40,0)]};
 assert.equal(nearestRoadSurface(entry,0,0,45.15).id,'bridge');
 assert.equal(nearestRoadSurface(entry,0,0,40.15).id,'ground');
});
test('橘子洲大桥与真实连接匝道在共享节点处没有高度断缝',()=>{
 const graph=JSON.parse(readFileSync(new URL('../data/graph.json',import.meta.url),'utf8'));
 const node=graph.nodes.find(n=>n[0]===11939101780);assert.ok(node);
 const chunk=JSON.parse(readFileSync(new URL(`../data/chunks/${Math.floor(node[1]/1024)}_${Math.floor(node[3]/1024)}.json`,import.meta.url),'utf8'));
 const get=id=>nearestRoadSurface({roads:chunk.roads.filter(r=>r.id===id).map(r=>({...r,points:r.points.map(([x,y,z])=>({x,y,z}))}))},node[1],node[3]);
 const main=get('52072535'),ramp=get('1287309696');assert.ok(main&&ramp);
 assert.ok(Math.abs(main.y-ramp.y)<.03,`桥与匝道高差${main.y-ramp.y}m`);
});

test('physical road height ends at the visible ribbon instead of an invisible sidewalk apron',()=>{
 const entry={roads:[road('raised',2,0)]};assert.equal(nearestRoadSurface(entry,3.99,0).id,'raised');assert.equal(nearestRoadSurface(entry,4.3,0),null);
});

test('road surfaces do not extend as invisible round caps past a flat ribbon endpoint',()=>{
 const entry={originX:0,originZ:0,terrain:{resolution:2,size:100,heights:[0,0,0,0]},roads:[{id:'flat-cap',width:8,points:[{x:10,y:0,z:10},{x:40,y:0,z:10}]}]};
 assert.equal(nearestRoadSurface(entry,9,11),null);assert.equal(nearestRoadSurface(entry,41,11),null);assert.ok(nearestRoadSurface(entry,10,11));assert.ok(nearestRoadSurface(entry,40,11));
});
