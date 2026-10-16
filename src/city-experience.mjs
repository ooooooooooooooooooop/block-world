import { WUYI } from './wuyi-data.mjs';
const center = id => {
  const points = WUYI.features[id].polygon.slice(0,-1);
  return { x: points.reduce((sum,p)=>sum+p[0],0)/points.length,
    z: points.reduce((sum,p)=>sum+p[1],0)/points.length };
};
const towerA=center('527545453'), towerB=center('527545451');
export const PHOTO_LOOKOUTS = Object.freeze([
  { id:'photo:heiwado', title:'平和堂街角', short:'平和堂', type:'photo',
    world:center('52072595'), subjects:['osm:52072595'],
    detail:'寻找能看清平和堂外观的机位，取景后把照片存入相册。',
    stamp:'街角留影', source:'OSM way 52072595 / wuyi-data.mjs' },
  { id:'photo:ifs-pair', title:'国金双塔同框', short:'国金双塔', type:'photo',
    world:{x:(towerA.x+towerB.x)/2,z:(towerA.z+towerB.z)/2},
    subjects:['osm:527545453','osm:527545451'],
    detail:'找开阔视野，用风景模式抬头取景，让双塔出现在同一张已保存照片中。',
    stamp:'城市天际线', source:'OSM ways 527545453 / 527545451 / wuyi-data.mjs' },
]);
export function bearingTo(from, to) {
  const dx=to.x-from.x, dz=to.z-from.z;
  const yaw=Math.atan2(dx,-dz), index=((Math.round(yaw/(Math.PI/4))%8)+8)%8;
  return {yaw,distance:Math.hypot(dx,dz),label:['北','东北','东','东南','南','西南','西','西北'][index]};
}
export function completedLookout(goal, saved) {
  if (goal.type==='visit') return Boolean(saved.discoveries?.[goal.poiId]);
  return Object.values(saved.photos||{}).some(photo =>
    goal.subjects.every(key => (photo.subjectKeys||[]).includes(key)));
}
export function createCityExperience(pois=[]) {
  const visits = pois.filter(p=>p.id&&p.world&&Number.isFinite(p.world.x)&&Number.isFinite(p.world.z))
    .map(p=>({id:'visit:'+p.id,poiId:p.id,title:'走近'+p.name,short:p.name,type:'visit',world:p.world,
      district:p.district,detail:'沿可通行的道路走近并停留，留下到访记录；入口以现场通行条件为准。',stamp:p.name+'足迹'}));
  const all=[...PHOTO_LOOKOUTS,...visits];
  const byId = new Map(all.map(g=>[g.id,g]));
  return {
    get:id=>byId.get(id)||null,
    nearby(state,saved) {
      const annotated=all.map(goal=>({...goal,...bearingTo(state,goal.world),done:completedLookout(goal,saved)}));
      const photos=annotated.filter(g=>g.type==='photo'&&g.distance<1800).sort((a,b)=>a.distance-b.distance);
      const places=annotated.filter(g=>g.type==='visit'&&g.distance<5000).sort((a,b)=>a.distance-b.distance).slice(0,4);
      return [...photos,...places];
    },
    tracked(saved) { const goal=byId.get(saved.trackedTarget); return goal?{...goal,done:completedLookout(goal,saved)}:null; },
  };
}

// Keep incomplete source records visible, while putting usable destinations first.
export function orderPlacesForVisit(records,query='',origin=null) {
  const located=p=>Number.isFinite(p.world?.x)&&Number.isFinite(p.world?.z);
  const exact=p=>Boolean(query.trim())&&p.name.toLowerCase()===query.trim().toLowerCase();
  const distance=p=>located(p)&&origin?Math.hypot(p.world.x-origin.x,p.world.z-origin.z):Infinity;
  return [...records].sort((a,b)=>Number(located(b))-Number(located(a))||Number(exact(b))-Number(exact(a))||(distance(a)-distance(b)||0));
}
