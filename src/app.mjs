import {createWorld} from './world.mjs';
import {MOVE_SPEED} from './motion.mjs';
import {buildGraph,findRoute} from './routes.mjs';
import {toGeo} from './geo.mjs';
import {createJourney} from './journey.mjs';
import {createGameHud} from './game-hud.mjs';
import {createPlaySession} from './play-session.mjs';
import {bindGameInput} from './game-input.mjs';
import {createCityExperience,bearingTo,orderPlacesForVisit} from './city-experience.mjs';

const $=id=>document.getElementById(id);
const districts=['芙蓉区','天心区','岳麓区','开福区','雨花区','望城区','长沙县','浏阳市','宁乡市'];
let journey,hud,input,experience,npcConversation,captureRequest=0;
const session=createPlaySession();
let world,manifest,pois=[],sources={},report={},graph,mapData,selectedPoi,route,pendingRoute,auto=false,manualSimulation=false;
let previewBlob,previewMeta,previewUrl,previousTime='day',currentTime='day',viewMode='third',toastTimer,db;
let mapPromise,graphPromise,last=performance.now(),lastHud=0,lastSave=0,visited=new Set(),visitSince=new Map();

const mapView={cx:0,cz:0,scale:1,drag:false,lastX:0,lastY:0};
const visible=id=>!$(id).hidden;
const panelIds=['map-panel','album-panel','settings-panel','photo-preview','npc-dialog','journey-panel','guide-panel','tasks-panel','help-panel','album-viewer'];
const hudIds=['topbar','objectives','compass','minimap-button','toolbar'];
const panelOpen=()=>!session.started||Boolean(session.panel);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const km=value=>(value/1000).toFixed(value<10000?2:1);
const loadJson=async path=>{const r=await fetch(path);if(!r.ok)throw new Error(`${path} 读取失败 (${r.status})`);return r.json();};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4400);}
function cancelCapture(){captureRequest++;$('countdown').hidden=true;$('shutter').disabled=false;}
function release(){cancelCapture();input?.clear();world?.stopMovement();if(auto){auto=false;world?.setAutoWalk(false);$('auto-walk').textContent='沿路线前行';}if(document.pointerLockElement)document.exitPointerLock();}
function closePanels(){if(session.panel==='npc-dialog')world?.endInteraction();for(const id of panelIds)$(id).hidden=true;session.close();input?.clear();}
function showPanel(id){release();closePanels();session.open(id);$(id).hidden=false;if(id==='map-panel')requestAnimationFrame(drawMap);}

function setTime(value){currentTime=value;world?.setTime(value);$('world-time').textContent=({day:'白天',sunset:'黄昏',night:'夜晚'}[value]||'白天');$('time-setting').value=value;}
function progress(){journey.observeDistance(world.getState().distanceWalked);return {...world.getState(),cameraFov:session.photography?world.getPhotoResumeFov():world.getState().cameraFov,journey:journey.snapshot(),visited:[...visited],time:session.photography?previousTime:currentTime,viewMode,routePoiId:route?.poiId||pendingRoute?.poi.id||null,savedAt:new Date().toISOString(),worldVersion:manifest.version||1,photoPreferences:{fov:Number($('photo-zoom').value),ratio:$('photo-ratio').value,npcs:$('photo-npcs').checked}};}
function saveProgress(announce=false){if(!world||!session.started)return;try{localStorage.setItem('block-changsha-progress-v1',JSON.stringify(progress()));if(announce)toast('旅程已保存，下次可以从这里继续。');}catch{toast('浏览器未能保存进度，请检查存储空间或隐私设置。');}}
function readProgress(){try{return JSON.parse(localStorage.getItem('block-changsha-progress-v1')||'null');}catch{return null;}}
function start(){session.start();$('welcome').hidden=true;for(const id of hudIds)$(id).hidden=false;$('walk-hint').hidden=false;setTimeout(()=>$('walk-hint').hidden=true,6500);hud.update(world.getState());}
async function continueJourney(){const state=readProgress();if(!state)return start();const success=await world.restore(state);if(!success)toast('原位置暂不可用，将从当前安全起点继续。');visited=new Set(state.visited||[]);journey=createJourney({pois,saved:state.journey,legacyVisited:state.visited||[],distance:state.distanceWalked});try{for(const item of await dbAction('readonly',s=>s.getAll()))journey.savedPhoto(item);}catch(e){toast(`旧相册暂不能读取：${e.message}`);}setTime(state.time||'day');viewMode=state.viewMode||'third';world.setCameraMode(viewMode);$('view-setting').value=viewMode;const pref=state.photoPreferences;if(pref){if(Number.isFinite(pref.fov)){$('photo-zoom').value=pref.fov;}if(['16:9','1:1','9:16'].includes(pref.ratio))$('photo-ratio').value=pref.ratio;if(typeof pref.npcs==='boolean')$('photo-npcs').checked=pref.npcs;}world.setCameraFov(state.cameraFov||65);start();if(state.routePoiId){const p=pois.find(p=>p.id===state.routePoiId);if(p)planRoute(p,{track:false});}}

function initDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open('block-changsha-album',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function dbAction(mode,fn){if(!db)db=await initDb();return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode);let result;try{result=fn(tx.objectStore('photos'));}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('存储事务未完成'));});}
function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);toast('已触发照片下载，请在浏览器下载记录中查看。');}
async function takePhoto(){
  if(!world||!session.photography||session.panel||$('shutter').disabled)return;const request=++captureRequest;const cancelled=()=>request!==captureRequest||!session.photography||Boolean(session.panel);$('shutter').disabled=true;
  try{
    if($('photo-countdown').checked){for(let i=3;i>0;i--){$('countdown').textContent=i;$('countdown').hidden=false;await new Promise(r=>setTimeout(r,1000));if(cancelled())return;}$('countdown').hidden=true;}
    const s=world.getState();const ratio=$('photo-ratio').value;const [width,height]=ratio==='1:1'?[1440,1440]:ratio==='9:16'?[1080,1920]:[1920,1080];
    const capturedBlob=await world.capture({width,height,hideNpcs:!$('photo-npcs').checked});if(cancelled())return;previewBlob=capturedBlob;
    const captured=world.getLastCapture();const visibleSubjects=captured.visibleSubjects;previewMeta={id:crypto.randomUUID(),place:s.nearestPoi?.distance<500?s.nearestPoi.name:'长沙漫游',poiId:null,associationMethod:'location-caption-only; visible subjects ray-tested separately',visibleSubjects,createdAt:captured.capturedAt,visiblePeople:captured.visiblePeople,companionId:captured.companionId,photoView:captured.photoView,camera:{yaw:captured.yaw,pitch:captured.pitch,fov:captured.fov},world:{x:s.x,y:s.y,z:s.z},time:currentTime,ratio,width,height};
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(previewBlob);$('preview-image').src=previewUrl;
    $('photo-caption').textContent=`${previewMeta.place} · ${{day:'晴日',sunset:'黄昏',night:'夜色'}[currentTime]} · ${width} × ${height}${visibleSubjects.length?' · 画面主体：'+visibleSubjects.map(p=>p.name).join('、'):''}`;
    $('save-photo').disabled=false;$('save-photo').textContent='存入相册';$('flash').hidden=false;setTimeout(()=>$('flash').hidden=true,200);showPanel('photo-preview');
  }catch(e){toast(`拍摄未完成：${e.message}`);}finally{if(request===captureRequest){$('countdown').hidden=true;$('shutter').disabled=false;}}
}
async function savePhoto(){if(!previewBlob)return;try{const photos=await dbAction('readonly',store=>store.getAll());if(photos.length>=100)throw new Error('相册已满100张，请下载照片后清理。');await dbAction('readwrite',store=>store.put({...previewMeta,blob:previewBlob}));$('save-photo').disabled=true;$('save-photo').textContent='已存入相册';const goal=experience.tracked(journey.snapshot());journey.savedPhoto(previewMeta);const after=experience.tracked(journey.snapshot());saveProgress();hud.update(world.getState());toast(after?.done&&!goal.done?`照片已存入相册 · 留下「${after.stamp}」`:'照片已保存在当前浏览器相册。');}catch(e){toast(`相册保存未完成：${e.message} 仍可下载原图。`);}}
const albumUrls=[];let albumViewerUrl,albumRequest=0;
async function openAlbum(){
  showPanel('album-panel');const request=++albumRequest;
  albumUrls.splice(0).forEach(URL.revokeObjectURL);
  $('album-grid').innerHTML='<div class="empty-state" role="status">正在打开相册…</div>';
  try{
    const items=await dbAction('readonly',store=>store.getAll());
    if(request!==albumRequest||session.panel!=='album-panel')return;
    $('album-grid').replaceChildren();
    if(!items.length){$('album-grid').innerHTML='<div class="empty-state">还没有照片<br>按 C 举起相机，留下喜欢的画面。</div>';return;}
    items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    for(const item of items){
      const url=URL.createObjectURL(item.blob);albumUrls.push(url);
      const card=document.createElement('article');card.className='album-item';
      card.innerHTML=`<button class="album-open" aria-label="回看${escapeHtml(item.place)}的照片"><img alt="${escapeHtml(item.place)}的游戏照片" src="${url}"></button><p>${escapeHtml(item.place)}<small>${new Date(item.createdAt).toLocaleString('zh-CN')}</small></p><div class="actions"><button data-action="download">下载原图</button><button data-action="delete">删除</button></div>`;
      card.querySelector('.album-open').onclick=()=>openAlbumPhoto(item);
      card.querySelector('[data-action="download"]').onclick=()=>download(item.blob,`方块长沙-${item.place}-${item.id.slice(0,8)}.png`);
      card.querySelector('[data-action="delete"]').onclick=async()=>{if(!confirm('删除这张本地相册照片？下载到设备的文件不受影响。'))return;try{await dbAction('readwrite',store=>store.delete(item.id));openAlbum();}catch(e){toast(`删除未完成：${e.message}`);}};
      $('album-grid').append(card);
    }
  }catch(e){if(session.panel==='album-panel')$('album-grid').textContent=`相册暂时无法读取：${e.message}`;}
}
function openAlbumPhoto(item){
  showPanel('album-viewer');if(albumViewerUrl)URL.revokeObjectURL(albumViewerUrl);
  albumViewerUrl=URL.createObjectURL(item.blob);$('album-full-image').src=albumViewerUrl;
  $('album-photo-title').textContent=item.place;
  $('album-photo-info').textContent=`${new Date(item.createdAt).toLocaleString('zh-CN')} · ${item.width} × ${item.height}${item.visiblePeople?.length?' · '+item.visiblePeople.map(p=>p.name).join('、'):''}`;
  $('album-photo-download').onclick=()=>download(item.blob,`方块长沙-${item.place}-${item.id.slice(0,8)}.png`);
}
async function openPhotoById(id){try{const item=await dbAction('readonly',store=>store.get(id));if(item)openAlbumPhoto(item);else toast('这张照片已从本地相册移除。');}catch(e){toast(`照片暂时无法读取：${e.message}`);}}
function trackLookout(id){if(id&&!experience.get(id))return;journey.track(id);saveProgress();hud.update(world.getState());}
function openNpc(result){
  npcConversation=result;$('npc-name').textContent=result.name;
  const choices={
    '散步的市民':'我在这边走走。想找哪处风景，可以问我一个方向；路还是要沿着入口和人行道走。',
    '旅行者':'我也在找拍照的位置。同一个地方，换个方向看会很不一样。要不要一起留张合影？',
    '附近的上班族':'歇一会儿再走吧。想找附近的地方，可以看看地图，也可以问我方向。',
  };
  $('npc-message').textContent=choices[result.role]||'你好，今天想去哪里逛逛？';
  showPanel('npc-dialog');
  journey.talk({...result,message:$('npc-message').textContent});saveProgress();hud.update(world.getState());
}
function askNpc(){
  const saved=journey.snapshot(),state=world.getState();
  const goal=experience.tracked(saved)||experience.nearby(state,saved).find(g=>!g.done)||experience.nearby(state,saved)[0];
  if(!goal){$('npc-message').textContent='可以打开全市地图，先找一个想去的地方。';return;}
  const direction=bearingTo(state,goal.world);trackLookout(goal.id);
  $('npc-message').textContent=`${goal.short}在你${direction.label}方向，直线大约${Math.round(direction.distance)}米。先沿可以通行的路找视野；具体步行路线可以在地图里规划。`;
}

function syncPhotoFrame(){if(!session.photography)return;const[a,b]=$('photo-ratio').value.split(':').map(Number);world.setPhotoAspect(a/b);const r=$('world').getBoundingClientRect();Object.assign($('photo-frame').style,{inset:'auto',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}
function enterPhoto({companionId=null,view='first'}={}){
  if(!session.started)return;release();closePanels();session.enterPhoto();document.body.classList.add('photo-mode');
  previousTime=currentTime;world.setPhotoMode(true,{view,companionId,pose:$('photo-pose').value,hideNpcs:!$('photo-npcs').checked});
  world.setCameraFov(Number($('photo-zoom').value));$('photo-panel').hidden=false;syncPhotoFrame();
  for(const id of [...hudIds,'route-card','walk-hint','target-bearing','npc-hint'])$(id).hidden=true;
  $('photo-time').value=currentTime;$('photo-view').value=view;
  $('photo-context').textContent=companionId?`与${npcConversation?.name||'路人'}合影`:'摄影模式';
}
function exitPhoto(){
  if(!session.photography)return;cancelCapture();world.setPhotoMode(false);session.exitPhoto();document.body.classList.remove('photo-mode');
  setTime(previousTime);$('photo-panel').hidden=true;closePanels();for(const id of hudIds)$(id).hidden=false;
  if(route?.reachable||pendingRoute)$('route-card').hidden=false;hud.update(world.getState());
}

async function ensureGraph(){if(!graphPromise)graphPromise=loadJson('/data/graph.json').then(buildGraph).then(value=>graph=value).catch(e=>{graphPromise=null;throw e;});return graphPromise;}
async function ensureMap(){if(!mapPromise)mapPromise=loadJson('/data/map.json').then(value=>{mapData=value;resetMap();return value;}).catch(e=>{mapPromise=null;throw e;});return mapPromise;}
async function openMap(){if(!session.started)return;showPanel('map-panel');renderPoiList();try{await ensureMap();drawMap();}catch(e){toast(e.message);}}
function filteredPois(){const text=$('poi-search').value.trim().toLowerCase(),district=$('district-filter').value;return orderPlacesForVisit(pois.filter(p=>(!district||p.district===district)&&(!text||[p.name,...(p.aliases||[])].some(s=>s.toLowerCase().includes(text)))),text,world?.getState());}
function renderPoiList(){const list=filteredPois();$('poi-count').textContent=`${list.length} 个记录 · ${list.filter(p=>p.world).length} 已定位`;$('poi-list').replaceChildren();for(const p of list){const row=document.createElement('button');row.className='poi-row'+(selectedPoi?.id===p.id?' selected':'');row.innerHTML=`<span class="poi-symbol">${p.category==='自然景观'?'♧':p.category==='博物馆'?'▥':'◇'}</span><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.district||'归属待核对')} · ${escapeHtml(p.grade||p.category||'城市游览')}</small></span><span class="loc-state">${p.world?'↗':'待定位'}</span>`;row.onclick=()=>selectPoi(p);$('poi-list').append(row);}}
function selectPoi(p){selectedPoi=p;renderPoiList();$('poi-detail').hidden=false;const d=$('poi-detail');d.innerHTML=`<h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.district||'归属待核对')} · ${escapeHtml(p.grade||p.category||'城市游览')}<br>${p.world?'地理位置已登记，景点模型尚未完成还原验收。':'位置资料尚未核实，不在地图中放置猜测标记。'}</p><button class="primary" ${p.world?'':'disabled'}>规划步行路线 ↗</button><p>资料来源 <a href="${escapeHtml(sourceUrl(p))}" target="_blank" rel="noreferrer">查看原始来源</a></p>`;d.querySelector('button').onclick=()=>planRoute(p);drawMap();}
function sourceUrl(p){const source=Array.isArray(sources)?sources.find(s=>s.id===p.sourceIds?.[0]):sources[p.sourceIds?.[0]];return source?.url||source?.sourceUrl||'https://whhlyt.hunan.gov.cn/whhlyt/cyfz/ggxxcx/lyajjqcx/index.html';}
function showRoadApproach(state){
  if(!pendingRoute)return;const direction=bearingTo(state,pendingRoute.roadStart);
  $('route-distance').textContent=direction.distance<4?'已接近标记道路，可以重新规划路线。':`道路方向：${direction.label} · ${Math.round(direction.distance)}米。沿可通行步道走近后重新规划。`;
}
async function planRoute(p,{track=true}={}){
  if(!p.world)return null;toast('正在沿真实道路规划路线…');
  try{
    await ensureGraph();const result=findRoute(graph,world.getState(),p.world);
    if(!result.reachable){
      if(result.reason==='off-road-start'&&result.startRoadPosition){
        route=null;auto=false;world.setRoute(null);world.setAutoWalk(false);
        pendingRoute={poi:p,roadStart:result.startRoadPosition};
        $('route-phase').textContent='先到道路';$('route-name').textContent=p.name;showRoadApproach(world.getState());
        $('auto-walk').textContent='重新规划路线';$('route-card').hidden=false;
        if(track)journey.track('visit:'+p.id);closePanels();hud.update(world.getState());saveProgress();
        toast('目的地已保留。先沿步道走到道路附近，再继续规划。');return result;
      }
      const reasons={'disconnected-road-network':'现有道路数据中这段路线未连通。','no-nearby-road-node':'附近缺少可核实道路节点，请靠近道路后再试。','start-too-far-from-road':'请先走到附近道路。','target-too-far-from-road':'景点入口与道路尚未完成核对。'};
      toast(reasons[result.reason]||`路线未完成：${result.reason}`);return result;
    }
    pendingRoute=null;route={...result,poiId:p.id,name:p.name};auto=false;world.setRoute(route);
    $('route-phase').textContent='沿道路前往';$('route-name').textContent=p.name;
    $('route-distance').textContent=`${km(route.distance)} km · 约 ${Math.max(1,Math.round(route.distance/MOVE_SPEED/60))} 分钟步行\n${result.targetSnapDistance>4?`终点距景点地图点约 ${Math.round(result.targetSnapDistance)} 米，请寻找实际入口。`:'终点位于景点附近道路。'}远途可中途保存。`;
    $('route-card').hidden=false;$('auto-walk').textContent='沿路线前行';
    if(track)journey.track('visit:'+p.id);closePanels();hud.update(world.getState());saveProgress();toast('步行路线已规划。');return result;
  }catch(e){toast(`导航未完成：${e.message}`);return null;}
}
function resetMap(){const b=mapData?.bounds||manifest.bounds;mapView.cx=(b.minX+b.maxX)/2;mapView.cz=(b.minZ+b.maxZ)/2;const rect=$('city-map').getBoundingClientRect();mapView.scale=Math.min((rect.width||800)/(b.maxX-b.minX),(rect.height||500)/(b.maxZ-b.minZ))*.85;drawMap();}
let mapBase, mapBaseSignature='';
function drawMap(){
 if(!mapData||!visible('map-panel'))return;
 const canvas=$('city-map'),rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2),w=rect.width,h=rect.height;
 if(!w||!h)return;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const xy=(x,z)=>[(x-mapView.cx)*mapView.scale+w/2,(z-mapView.cz)*mapView.scale+h/2];
 const path=(ctx,points)=>{if(!points?.length)return;ctx.beginPath();points.forEach((p,i)=>{const q=xy(Array.isArray(p)?p[0]:p.x,Array.isArray(p)?p[1]:p.z);i?ctx.lineTo(...q):ctx.moveTo(...q);});};
 const signature=[w,h,dpr,mapView.cx,mapView.cz,mapView.scale].join('/');
 if(!mapBase||signature!==mapBaseSignature){
  mapBaseSignature=signature;mapBase=document.createElement('canvas');mapBase.width=canvas.width;mapBase.height=canvas.height;
  const c=mapBase.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#e7ecdb';c.fillRect(0,0,w,h);
  c.lineWidth=1;c.strokeStyle='#cbd5be';
  for(const ring of mapData.boundary||[]){path(c,ring);c.closePath();c.fillStyle='#f1f2e5';c.fill();c.stroke();}
  c.fillStyle='#acc9c5';
  for(const water of mapData.water||[]){path(c,water.polygon);c.closePath();for(const ring of water.holes||[]){ring.forEach((p,i)=>{const q=xy(p[0],p[1]);i?c.lineTo(...q):c.moveTo(...q);});c.closePath();}c.fill('evenodd');}
  for(const road of mapData.roads||[]){
   if(mapView.scale<.007&&!['motorway','trunk','primary','secondary'].includes(road.kind))continue;
   if(mapView.scale<.025&&!['motorway','trunk','primary','secondary','tertiary','unclassified'].includes(road.kind))continue;
   c.strokeStyle=['primary','secondary','trunk'].includes(road.kind)?'#c2bca3':'#d2d5c2';c.lineWidth=['primary','secondary'].includes(road.kind)?1.2:.6;path(c,road.points);c.stroke();
  }
 }
 const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.drawImage(mapBase,0,0,w,h);
 if(route?.points){path(c,route.points);c.lineWidth=3;c.strokeStyle='#bd7448';c.stroke();}
 for(const p of filteredPois().filter(p=>p.world)){
  const [x,y]=xy(p.world.x,p.world.z);if(x<0||x>w||y<0||y>h)continue;const chosen=p.id===selectedPoi?.id;
  c.beginPath();c.arc(x,y,chosen?6:3,0,Math.PI*2);c.fillStyle=chosen?'#425f3e':'#c17d4d';c.fill();c.strokeStyle='#fffdf0';c.lineWidth=1.5;c.stroke();
  if(chosen||mapView.scale>.15){c.font='11px City Sans';c.fillStyle='#536749';c.fillText(p.name,x+9,y+3);}
 }
 const state=world.getState(),[px,py]=xy(state.x,state.z);c.beginPath();c.arc(px,py,7,0,Math.PI*2);c.fillStyle='#375d3e';c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();c.font='10px City Sans';c.fillStyle='#45653d';c.fillText('我在这里',px+11,py+4);
 $('map-scale').textContent=`${(80/mapView.scale/1000).toFixed(1)} km`;
}

function bind(){
  $('start-button').onclick=start;$('continue-button').onclick=continueJourney;$('map-button').onclick=openMap;$('camera-button').onclick=()=>enterPhoto();$('album-button').onclick=openAlbum;$('settings-button').onclick=()=>showPanel('settings-panel');$('minimap-button').onclick=openMap;for(const name of ['journey','guide','tasks','help'])$(name+'-button').onclick=()=>{visible(name+'-panel')?closePanels():showPanel(name+'-panel');};$('toggle-goals').onclick=()=>{const collapsed=$('tracked-goals').hidden=!$('tracked-goals').hidden;$('toggle-goals').textContent=collapsed?'+':'−';$('toggle-goals').setAttribute('aria-expanded',String(!collapsed));};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(b.dataset.close==='album-viewer')openAlbum();else closePanels();});
  $('view-button').onclick=()=>{viewMode=viewMode==='third'?'first':'third';world.setCameraMode(viewMode);$('view-setting').value=viewMode;};$('view-setting').onchange=e=>{viewMode=e.target.value;world.setCameraMode(viewMode);};$('time-setting').onchange=e=>setTime(e.target.value);$('save-progress').onclick=()=>saveProgress(true);
  $('npc-done').onclick=closePanels;$('npc-ask').onclick=askNpc;$('npc-photo').onclick=()=>enterPhoto({companionId:npcConversation.npcId,view:'selfie'});$('photo-view').onchange=e=>world.setPhotoView(e.target.value);$('photo-pose').onchange=e=>world.setPhotoMode(true,{pose:e.target.value});$('album-photo-back').onclick=openAlbum;$('photo-zoom').oninput=e=>world.setCameraFov(e.target.value);$('exit-photo').onclick=exitPhoto;$('photo-grid').onclick=()=>{$('grid-lines').hidden=!$('grid-lines').hidden;$('photo-grid').setAttribute('aria-pressed',String(!$('grid-lines').hidden));};$('photo-ratio').onchange=syncPhotoFrame;$('photo-time').onchange=e=>setTime(e.target.value);$('photo-npcs').onchange=()=>world.setPhotoMode(true,{hideNpcs:!$('photo-npcs').checked});$('shutter').onclick=takePhoto;$('save-photo').onclick=savePhoto;$('download-photo').onclick=()=>previewBlob&&download(previewBlob,`方块长沙-${previewMeta.place}-${previewMeta.id.slice(0,8)}.png`);
  $('auto-walk').onclick=()=>{if(pendingRoute){planRoute(pendingRoute.poi);return;}auto=!auto;world.setAutoWalk(auto);$('auto-walk').textContent=auto?'暂停前行':'沿路线前行';};$('cancel-route').onclick=()=>{route=null;pendingRoute=null;auto=false;world.setAutoWalk(false);world.setRoute(null);$('route-card').hidden=true;};
  districts.forEach(name=>$('district-filter').add(new Option(name,name)));$('district-filter').onchange=$('poi-search').oninput=()=>{renderPoiList();drawMap();};$('map-zoom-in').onclick=()=>{mapView.scale*=1.5;drawMap();};$('map-zoom-out').onclick=()=>{mapView.scale/=1.5;drawMap();};$('map-reset').onclick=resetMap;
  const canvas=$('city-map');let moved=false;canvas.onpointerdown=e=>{mapView.drag=true;mapView.lastX=e.clientX;mapView.lastY=e.clientY;moved=false;canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!mapView.drag)return;const dx=e.clientX-mapView.lastX,dy=e.clientY-mapView.lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;mapView.cx-=dx/mapView.scale;mapView.cz-=dy/mapView.scale;mapView.lastX=e.clientX;mapView.lastY=e.clientY;drawMap();};canvas.onpointerup=e=>{mapView.drag=false;if(moved)return;const rect=canvas.getBoundingClientRect(),x=mapView.cx+(e.clientX-rect.left-rect.width/2)/mapView.scale,z=mapView.cz+(e.clientY-rect.top-rect.height/2)/mapView.scale;let p,best=14/mapView.scale;for(const candidate of filteredPois().filter(p=>p.world)){const d=Math.hypot(candidate.world.x-x,candidate.world.z-z);if(d<best){best=d;p=candidate;}}if(p)selectPoi(p);};canvas.onwheel=e=>{e.preventDefault();mapView.scale*=e.deltaY>0?.85:1.15;mapView.scale=Math.max(.0002,Math.min(3,mapView.scale));drawMap();};
  input=bindGameInput({canvas:$('world'),getContext:()=>session.snapshot(),onAction:handleAction,
    onManualMove:()=>{if(auto){auto=false;world.setAutoWalk(false);$('auto-walk').textContent='沿路线前行';}},
    onLockError:()=>toast('可以按住鼠标左键或右键拖动视角。')});
  session.subscribe(state=>{input.clear();document.body.dataset.playMode=state.mode;document.body.dataset.panel=state.panel||'';
    for(const button of $('toolbar').querySelectorAll('button'))button.setAttribute('aria-pressed',String(state.panel===button.id.replace('-button','-panel')));});
  window.addEventListener('blur',()=>{release();saveProgress();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){release();saveProgress();}});
  window.addEventListener('resize',()=>{world.resize();syncPhotoFrame();drawMap();});
  window.addEventListener('beforeunload',()=>saveProgress());
  let audio; $('sound-button').onclick=async()=>{if(audio){await audio.close();audio=null;$('sound-button').textContent='轻风环境声：关闭';toast('环境声音已关闭。');return;}audio=new AudioContext();const buffer=audio.createBuffer(1,audio.sampleRate*4,audio.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.12;const source=audio.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=350;const gain=audio.createGain();gain.gain.value=.07;source.connect(filter).connect(gain).connect(audio.destination);source.start();$('sound-button').textContent='轻风环境声：开启';toast('轻风环境声音已开启。');};
}
function handleAction(action){
  if(action==='back'){
    release();if(session.panel==='album-viewer')openAlbum();else if(session.panel)closePanels();else if(session.photography)exitPhoto();
    document.activeElement?.blur?.();return;
  }
  if(!session.started)return;
  const panels={map:'map',album:'album',journey:'journey',guide:'guide',tasks:'tasks',help:'help'};
  if(panels[action]){
    const id=panels[action]+'-panel';if(session.panel===id){closePanels();return;}
    if(action==='map')openMap();else if(action==='album')openAlbum();else showPanel(id);return;
  }
  if(session.panel)return;
  if(action==='camera'){session.photography?exitPhoto():enterPhoto();return;}
  if(action==='view'){
    if(session.photography){const views=['first','third','selfie'];const view=views[(views.indexOf($('photo-view').value)+1)%views.length];$('photo-view').value=view;world.setPhotoView(view);}
    else $('view-button').click();return;
  }
  if(action==='shutter'&&session.photography){takePhoto();return;}
  if(action==='interact'&&!session.photography){const result=world.interact();if(result.found)openNpc(result);else toast(result.message);}
}
function tick(now){
  const dt=Math.min((now-last)/1000,.25);last=now;const paused=!session.snapshot().movement;
  if(!manualSimulation){
    let remaining=dt;const controls=input.sample();
    while(remaining>1e-6){const step=Math.min(remaining,.05);world.update(step,controls);remaining-=step;controls.yawDelta=0;controls.pitchDelta=0;}
  }
  world.render();
  if(now-lastHud>500){
    lastHud=now;const state=world.getState();
    if(new URLSearchParams(location.search).has('inspect')){const c=$('world');c.dataset.worldState=JSON.stringify(state);c.dataset.npcStates=JSON.stringify(world.getNpcStates());c.dataset.sceneEvidence=JSON.stringify(world.getSceneEvidence());}
    if(session.snapshot().movement&&state.nearestPoi?.distance<65){
      const id=state.nearestPoi.id;if(!visitSince.has(id))visitSince.set(id,now);
      if(now-visitSince.get(id)>10000&&!visited.has(id)){visited.add(id);journey.discover(pois.find(p=>p.id===id));toast(`留下足迹：${state.nearestPoi.name}`);saveProgress();}
    }
    for(const id of visitSince.keys())if(!session.snapshot().movement||id!==state.nearestPoi?.id||state.nearestPoi?.distance>=65)visitSince.delete(id);
    if(auto&&!state.autoWalk){auto=false;$('auto-walk').textContent='沿路线前行';}
    if(state.blocked&&auto&&state.blocked.code!=='chunk-loading'){auto=false;world.setAutoWalk(false);$('auto-walk').textContent='继续前行';toast(state.blocked.message);}
    const nearNpc=world.getNpcStates().some(n=>Math.hypot(n.x-state.x,n.z-state.z,n.y-state.y)<5);
    $('npc-hint').hidden=!nearNpc||paused||session.photography;hud.update(state);showRoadApproach(state);
    if(visible('map-panel'))drawMap();
  }
  if(now-lastSave>30000){lastSave=now;saveProgress();}requestAnimationFrame(tick);
}

async function boot(){try{const results=await Promise.all([loadJson('/data/world-manifest.json'),loadJson('/data/pois.json'),loadJson('/data/sources.json'),loadJson('/data/data-report.json')]);[manifest]=results;pois=Array.isArray(results[1])?results[1]:results[1].records;sources=results[2].sources||results[2];report=results[3];$('loading-text').textContent='铺好脚下的道路，准备附近的风景…';await Promise.all([...document.fonts].filter(font=>font.family.includes('City Sans')).map(font=>font.load()));world=await createWorld({canvas:$('world'),manifest,pois,onNotice:message=>toast(typeof message==='string'?message:message.message)});if(world.getState().blocked)throw new Error(world.getState().blocked.message);const stored=readProgress();journey=createJourney({pois,saved:stored?.journey,legacyVisited:stored?.visited||[],distance:stored?.distanceWalked||0});visited=new Set(stored?.visited||[]);experience=createCityExperience(pois);hud=createGameHud({world,pois,getJourney:()=>journey,experience,onTrack:trackLookout,onPhoto:openPhotoById});bind();$('data-status').textContent=`地图收录 ${pois.filter(p=>p.world).length} 处有位置的地点。远途可保存进度后继续；路线按可用道路资料规划。`;$('continue-button').hidden=!readProgress();$('loading').hidden=true;$('welcome').hidden=false;requestAnimationFrame(tick);window.__game={world,manifest,pois,setManualSimulation(enabled){manualSimulation=Boolean(enabled);},get graph(){return graph;},ensureGraph,planRoute,start,get route(){return route;},get pendingRoute(){return pendingRoute?{poiId:pendingRoute.poi.id,name:pendingRoute.poi.name,roadStart:{...pendingRoute.roadStart}}:null;},takePhoto,get photo(){return previewBlob;},get report(){return report;}};console.info('方块长沙 ready',{pois:pois.length,chunks:Object.keys(manifest.chunks).length});}catch(e){console.error(e);$('loading').innerHTML=`<strong>城市暂未准备好</strong><p>${escapeHtml(e.message)}</p><p>请检查本地地图数据是否已生成，然后刷新重试。</p>`;}}
boot();
