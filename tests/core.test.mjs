import test from 'node:test';
import assert from 'node:assert/strict';
import {toWorld,toGeo,chunkKey,distance} from '../src/geo.mjs';
import {buildGraph,findRoute} from '../src/routes.mjs';

test('城区与远郊坐标往返保留真实尺度，不把远郊压缩到附近',()=>{
  for(const p of [[112.97,28.19],[112.3,28.1],[114.1,28.5]]){const w=toWorld(...p),q=toGeo(w.x,w.z);assert.ok(Math.abs(p[0]-q.lon)<1e-10);assert.ok(Math.abs(p[1]-q.lat)<1e-10);}
  const a=toWorld(113,28.2),b=toWorld(114,28.2);assert.ok(distance(a,b)>97000&&distance(a,b)<99000);
});
test('西部和北部负坐标的分块不重叠、不错误截断',()=>{
  assert.equal(chunkKey(-.1,-.1),'-1_-1');assert.equal(chunkKey(-1024,1024),'-1_1');assert.equal(chunkKey(-1024.01,1023.99),'-2_0');
});
test('路由只使用真实图边，选择可达最短路径',()=>{
  const g=buildGraph({nodes:[[1,0,10,0],[2,10,10,0],[3,10,10,10],[4,0,10,10]],edges:[[1,2,10],[2,3,10],[1,4,30],[4,3,30]],snapRadius:2});
  const r=findRoute(g,{x:0,z:0},{x:10,z:10});assert.equal(r.reachable,true);assert.equal(r.distance,20);assert.equal(r.points.length,3);assert.equal(r.points[1].x,10);assert.equal(r.points[1].z,0);
});
test('道路中断不能被虚构直线补齐',()=>{
  const g=buildGraph({nodes:[[1,0,0,0],[2,5,0,0],[3,6,0,0],[4,10,0,0]],edges:[[1,2,5],[3,4,4]],snapRadius:2});
  assert.equal(findRoute(g,{x:0,z:0},{x:10,z:0}).reason,'disconnected-road-network');
  assert.equal(findRoute(g,{x:0,z:0},{x:100,z:100}).reason,'no-nearby-road-node');
});
