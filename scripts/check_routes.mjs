import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {buildGraph,findRoute} from '../src/routes.mjs';
import {chunkKey} from '../src/geo.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
const manifest=read('world-manifest.json'),pois=read('pois.json').records;
console.log('Building real walking graph');
const graph=buildGraph(read('graph.json'));
const checks=[];
for(const [area,name] of [['望城区','靖港'],['长沙县','松雅湖湿地公园'],['宁乡市','花明楼'],['浏阳市','浏阳文庙']]){
 const poi=pois.find(p=>p.world&&p.name.includes(name));
 if(!poi){checks.push({area,name,status:'UNLOCATED'});continue;}
 const start=performance.now(),route=findRoute(graph,manifest.start,poi.world),missing=new Set(),chunks=new Set();
 if(route.reachable)for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/128));
  for(let k=0;k<=steps;k++){const t=k/steps,key=chunkKey(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,manifest.chunkSize);chunks.add(key);if(!manifest.chunks[key])missing.add(key);}
 }
 const result={area,name:poi.name,poiId:poi.id,reachable:route.reachable,reason:route.reason,distanceMeters:route.distance,roadPoints:route.points.length,mapChunks:chunks.size,missingChunks:[...missing],startSnapDistance:route.startSnapDistance,targetSnapDistance:route.targetSnapDistance,elapsedMs:Math.round(performance.now()-start),status:route.reachable&&!missing.size?'GRAPH_AND_TERRAIN_COVERAGE_PASS':'NOT_PASS'};
 checks.push(result);console.log(JSON.stringify(result));
}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/remote-routes.json',JSON.stringify({checkedAt:new Date().toISOString(),start:manifest.start,checks,limits:'真实道路图连通与沿途地形覆盖验证；不替代浏览器沿完整路线实走、入口核验、碰撞或逐景还原验收。'},null,2));
if(checks.some(c=>c.status!=='GRAPH_AND_TERRAIN_COVERAGE_PASS'))process.exitCode=1;
