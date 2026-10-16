import {bearingTo,PHOTO_LOOKOUTS,completedLookout} from './city-experience.mjs';
const $ = id => document.getElementById(id);
const escape = text => String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const subjectName = s => ({'527545451':'长沙国金中心 T2','527545453':'长沙国金中心 T1'}[s.key?.replace('osm:','')] || s.name);
const formatDistance = m => m<1000?`${Math.round(m)} 米`:`${(m/1000).toFixed(1)} 公里`;
export function createGameHud({world,pois,getJourney,experience,onTrack,onPhoto}) {
  let signature='';
  for(const id of ['tracked-goals','task-list']) $(id).addEventListener('click',e=>{
    const button=e.target.closest('[data-track]');if(button)onTrack(button.dataset.track||null);
  });
  $('guide-subjects').addEventListener('click',e=>{const button=e.target.closest('[data-photo-id]');if(button)onPhoto(button.dataset.photoId);});
  function row(g,selected=false){return `<li class="${g.done?'done':''}${selected?' selected':''}"><span class="goal-check">${g.done?'✓':g.type==='photo'?'▣':'◇'}</span><div><strong>${escape(g.title)}</strong><small>${g.done?'已留下记录':escape(g.detail)}</small><span class="lookout-bearing">${escape(g.label||'')} · ${formatDistance(g.distance||0)}${g.type==='photo'?' · 摄影':' · 到访'}</span></div><button class="track-lookout" data-track="${selected?'':escape(g.id)}" aria-label="${selected?'取消关注':('关注'+escape(g.title))}">${selected?'取消':'关注'}</button></li>`;}
  function update(state){
    const journey=getJourney();journey.observeDistance(state.distanceWalked);const data=journey.snapshot();
    const nearest=pois.find(p=>p.id===state.nearestPoi?.id);
    $('place-name').textContent=nearest&&state.nearestPoi.distance<350?nearest.name+(state.nearestPoi.distance>65?'附近':''):'长沙街头';
    $('district-name').textContent=nearest?.district?`长沙 · ${nearest.district}`:'长沙市';
    $('world-time').textContent={day:'白天',sunset:'黄昏',night:'夜晚'}[state.time]||'白天';
    $('compass-direction').textContent=['北','东北','东','东南','南','西南','西','西北'][((Math.round(state.yaw/(Math.PI/4))%8)+8)%8];
    const nearby=experience.nearby(state,data),tracked=experience.tracked(data);
    const trackedRow=tracked?{...tracked,...bearingTo(state,tracked.world)}:null;
    const goals=trackedRow?[trackedRow,...nearby.filter(g=>g.id!==tracked.id).slice(0,1)]:nearby.slice(0,2);
    const next=JSON.stringify([nearby.map(g=>[g.id,g.done,Math.round(g.distance/10),g.label]),data.trackedTarget,Object.keys(data.photos),Object.keys(data.discoveries),Object.keys(data.encounters),Math.floor(data.distance/10)]);
    if(next!==signature){signature=next;
      $('tracked-goals').innerHTML=goals.map(g=>row(g,g.id===data.trackedTarget)).join('')||'<li>打开地图，选择想去的地方。</li>';
      $('task-list').innerHTML=nearby.map(g=>row(g,g.id===data.trackedTarget)).join('')||'<li>附近暂无已登记看点，可在全市地图中选择目的地。</li>';
      $('task-summary').textContent=tracked?`正在关注：${tracked.title} · 随时可以更换`:'挑一个想看的地方，也可以直接自由行走。';
      $('journey-stats').innerHTML=`<div><strong>${formatDistance(data.distance)}</strong><span>走过的路</span></div><div><strong>${Object.keys(data.photos).length} 张</strong><span>留下的照片</span></div><div><strong>${Object.keys(data.discoveries).length} 处</strong><span>到访地点</span></div><div><strong>${Object.keys(data.encounters).length} 位</strong><span>街角相遇</span></div>`;
      const achieved=[...PHOTO_LOOKOUTS.filter(g=>completedLookout(g,data)),...Object.values(data.discoveries).map(p=>({stamp:p.name+'足迹'}))];
      $('travel-stamps').innerHTML=achieved.map(g=>`<span class="travel-stamp">${escape(g.stamp)}</span>`).join('')||'<p class="empty-note">喜欢的地方与照片，会成为这趟旅程的记录。</p>';
      $('encounter-list').innerHTML=Object.values(data.encounters).map(e=>`<article class="field-card"><small>${escape(e.place)}</small><h3>${escape(e.name)}</h3><p>${escape(e.message)}</p></article>`).join('')||'<p class="empty-note">路上遇见人时，可以聊聊、问方向，或邀请合影。</p>';
      const subjects=Object.values(data.subjects),discoveries=Object.values(data.discoveries);
      $('guide-summary').textContent=`${subjects.length} 个入镜建筑 · ${discoveries.length} 处足迹`;
      $('guide-subjects').innerHTML=subjects.map(s=>`<article class="field-card"><small>镜头里的长沙</small><h3>${escape(subjectName(s))}</h3><button class="secondary" data-photo-id="${escape(s.firstPhotoId)}">回看这张照片</button></article>`).join('')||'<p class="empty-note">画面中清晰可见的建筑，会随保存的照片记在这里。人物与沿途风景也可以自由拍摄。</p>';
      $('guide-places').innerHTML=discoveries.map(p=>`<article class="field-card"><small>已到访</small><h3>${escape(p.name)}</h3></article>`).join('')||'<p class="empty-note">走近并停留，留下自己的足迹。</p>';
    }
    $('target-bearing').hidden=!trackedRow;
    if(trackedRow)$('target-bearing').textContent=`${trackedRow.done?'✓ 已记录':trackedRow.label} · ${trackedRow.short} · ${formatDistance(trackedRow.distance)}`;
    drawMinimap(state,data);
  }
  function drawMinimap(state, data) {
    const canvas = $('mini-map'), size = 196, dpr = Math.min(devicePixelRatio || 1, 2), scale = size / 440;
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    const c = canvas.getContext('2d');c.setTransform(dpr, 0, 0, dpr, 0, 0);c.clearRect(0, 0, size, size);c.fillStyle = '#a8b58b';c.fillRect(0, 0, size, size);
    const xy = (x, z) => [(x - state.x) * scale + size / 2, (z - state.z) * scale + size / 2];
    function path(points, close = false) { c.beginPath();points.forEach((p, i) => { const q = Array.isArray(p) ? xy(p[0], p[1]) : xy(p.x, p.z);i ? c.lineTo(...q) : c.moveTo(...q); });if (close) c.closePath(); }
    const local = world.getLocalMap();
    for (const water of local.water) { path(water.polygon, true);for (const hole of water.holes || []) { const q = xy(...hole[0]);c.moveTo(...q);hole.slice(1).forEach((p) => c.lineTo(...xy(...p)));c.closePath(); }c.fillStyle = '#73aeb6';c.fill('evenodd'); }
    for (const road of local.roads) { path(road.points);c.lineWidth = Math.max(1.3, Math.min(14, road.width * scale));c.lineCap = 'round';c.strokeStyle = road.tunnel ? '#adb1a0' : '#ded6bc';c.stroke(); }
    for (const b of local.buildings) { path(b.polygon, true);for (const hole of b.holes || []) { c.moveTo(...xy(...hole[0]));hole.slice(1).forEach((p) => c.lineTo(...xy(...p)));c.closePath(); }c.fillStyle = '#8c9691';c.fill('evenodd');c.strokeStyle = '#6d7d77';c.lineWidth = .7;c.stroke(); }
    for (const poi of pois) {
      if (!poi.world) continue;const [x, y] = xy(poi.world.x, poi.world.z);if (x < 8 || y < 8 || x > size - 8 || y > size - 8) continue;
      c.fillStyle = data.discoveries[poi.id] ? '#f3cb68' : '#f5edda';c.fillRect(x - 3, y - 3, 6, 6);c.strokeStyle = '#384947';c.strokeRect(x - 3, y - 3, 6, 6);
    }
    const goal=experience.tracked(data);
    if(goal){const [gx,gy]=xy(goal.world.x,goal.world.z);const dx=gx-size/2,dy=gy-size/2;
      const ratio=Math.min(1,(size/2-12)/Math.max(Math.abs(dx),Math.abs(dy),1));
      const x=size/2+dx*ratio,y=size/2+dy*ratio;c.save();c.translate(x,y);c.rotate(Math.PI/4);
      c.fillStyle='#ffd56c';c.fillRect(-4,-4,8,8);c.strokeStyle='#242a31';c.strokeRect(-4,-4,8,8);c.restore();}
    for (const n of world.getNpcStates()) { const [x, y] = xy(n.x, n.z);if (x > 2 && y > 2 && x < size - 2 && y < size - 2) { c.fillStyle = '#765348';c.fillRect(x - 1, y - 1, 3, 3); } }
    c.save();c.translate(size / 2, size / 2);c.rotate(state.yaw);c.beginPath();c.moveTo(0, -9);c.lineTo(6, 7);c.lineTo(0, 3);c.lineTo(-6, 7);c.closePath();c.fillStyle = '#fff9e6';c.fill();c.strokeStyle = '#283a38';c.lineWidth = 2;c.stroke();c.restore();
    c.fillStyle = '#253b37';c.font = 'bold 12px "City Sans", sans-serif';c.fillText('北', 9, 17);c.fillStyle = '#f5eccc';c.fillRect(size - 57, size - 17, 50, 11);c.fillStyle = '#354740';c.font = '10px "City Sans", sans-serif';c.fillText('100米', size - 52, size - 8);
  }
  return {update};
}
