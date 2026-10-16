import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chunkKey} from '../src/geo.mjs';
const json=name=>JSON.parse(readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));

test('原件哈希、官方基线与每项来源一致，候选不计作已还原',()=>{
 const inventory=json('pois.json'),sources=json('sources.json').sources;
 assert.equal(new Set(inventory.records.map(p=>p.id)).size,inventory.records.length);
 const source=sources.find(s=>s.id==='hunan-a-20250225');assert.ok(source);
 const hash=createHash('sha256').update(readFileSync(new URL('../'+source.attachmentPath,import.meta.url))).digest('hex');
 assert.equal(hash,source.attachmentSha256);assert.equal(source.parser.evidence.changshaSourceRows,84);
 for(const p of inventory.records){assert.ok(p.name);assert.ok(p.sourceIds.length);for(const id of p.sourceIds)assert.ok(sources.some(s=>s.id===id),`${p.name} 缺来源 ${id}`);if(p.parentId)assert.ok(inventory.records.some(q=>q.id===p.parentId));if(p.world){assert.ok(p.position?.source);assert.ok(Number.isFinite(p.world.x));assert.ok(Number.isFinite(p.world.z));assert.equal(p.position.inChangshaBoundary,true);const tags=p.position.osmTags;assert.ok(tags);assert.ok(!tags.public_transport&&!tags.railway&&!['bus_stop','motorway_junction'].includes(tags.highway),`${p.name} 错用交通站点`);}}
});
test('市域分块均有文件，起点是有真实地面与来源的长沙城区位置',()=>{
 const manifest=json('world-manifest.json');assert.equal(manifest.schemaVersion,1);assert.equal(manifest.chunkSize,1024);
 const count=Object.keys(manifest.chunks).length;assert.ok(count>10000,`市域分块仅${count}，需核实裁剪范围`);
 for(const [key,path] of Object.entries(manifest.chunks)){assert.ok(/^-?\d+_-?\d+$/.test(key));assert.ok(existsSync(new URL('../'+path,import.meta.url)),`缺少${path}`);}
 const startKey=chunkKey(manifest.start.x,manifest.start.z,manifest.chunkSize);const start=JSON.parse(readFileSync(new URL('../'+manifest.chunks[startKey],import.meta.url),'utf8'));
 assert.equal(start.terrain.heights.length,start.terrain.resolution**2);assert.ok(start.terrain.heights.every(Number.isFinite));assert.ok(start.roads.length>0);
});
test('道路图边两端均存在且保留真实OSM节点ID',()=>{
 const graph=json('graph.json');assert.ok(graph.nodes.length>1000);assert.ok(graph.edges.length>1000);
 const nodes=new Map(graph.nodes.map(n=>[n[0],n]));
 for(const edge of graph.edges){assert.ok(nodes.has(edge[0])&&nodes.has(edge[1]));assert.ok(edge[2]>0&&Number.isFinite(edge[2]));assert.ok(Number.isInteger(edge[0])&&Number.isInteger(edge[1]));}
});
test('年嘉湖机动车隧道内部路段不再成为地表步行连接',()=>{
 const graph=json('graph.json');
 assert.ok(!graph.edges.some(([a,b])=>(a===1958575853&&b===6033280964)||(a===6033280964&&b===1958575853)),'机动车隧道仍被收入步行图');
});
