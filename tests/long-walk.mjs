import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const target=process.env.WALK_TARGET||'长沙市靖港古镇景区';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const evidence={startedAt:new Date().toISOString(),method:'浏览器内调用同一 world.update(0.1)，加速模拟时间，速度仍为3m/s；不传送，不更改碰撞，不跳过缺失区块。',target,errors,samples:[]};
const watchdog=setTimeout(async()=>{console.error('Long walk deadline exceeded');await browser.close();},240000);
await mkdir('artifacts',{recursive:true});
try{
 await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game,{timeout:120000});
 const route=await page.evaluate(async name=>{
  const g=window.__game;g.start();g.setManualSimulation(true);
  const poi=g.pois.find(p=>p.world&&p.name===name);
  if(!poi)throw new Error('Target not found: '+name);
  const r=await g.planRoute(poi);
  return {reachable:r?.reachable,reason:r?.reason,distance:r?.distance,targetSnapDistance:r?.targetSnapDistance,points:r?.points?.length};
 },target);
 evidence.route=route;assert.ok(route.reachable,'Real road route unavailable');
 await page.getByRole('button',{name:'沿路线前行',exact:true}).click();
 console.log(JSON.stringify(route));
 const chunks=new Set();let state,steps=0,lastLog=0;
 while(steps<320000){
  state=await page.evaluate(()=>{
   const w=window.__game.world;let done=0,s;const chunks=new Set();
   for(;done<1500;done++){
    w.update(.1,{});s=w.getState();chunks.add(`${Math.floor(s.x/1024)}_${Math.floor(s.z/1024)}`);
    if(s.blocked||!s.autoWalk)break;
   }
   return {...s,steps:done+1,chunkKeys:[...chunks]};
  });
  steps+=state.steps;for(const key of state.chunkKeys)chunks.add(key);delete state.chunkKeys;
  if(state.distanceWalked-lastLog>=1000||state.blocked||!state.autoWalk){
   evidence.samples.push(state);console.log(JSON.stringify({meters:Math.round(state.distanceWalked),chunk:[Math.floor(state.x/1024),Math.floor(state.z/1024)],routeIndex:state.routeIndex,blocked:state.blocked,autoWalk:state.autoWalk}));lastLog=state.distanceWalked;
  }
  if(state.blocked&&state.blocked.code!=='chunk-loading')throw new Error(JSON.stringify(state.blocked));
  if(!state.autoWalk)break;
  if(state.blocked?.code==='chunk-loading')await page.waitForTimeout(150);else await page.waitForTimeout(10);
 }
 evidence.final=state;evidence.steps=steps;evidence.visitedChunkCount=chunks.size;evidence.visitedChunks=[...chunks];
 assert.equal(state.autoWalk,false,'Route did not finish');assert.equal(state.blocked,null,'Final position blocked');
 assert.ok(state.distanceWalked>route.distance*.99,'Movement shorter than route');
 await page.waitForTimeout(600);
 await page.evaluate(()=>window.__game.world.render());
 await page.screenshot({path:'artifacts/remote-walk.png',timeout:20000});
 // Restore the distant save in a fresh world, validating local geometry rather than comparing elevation with downtown.
 const saved={...state};await page.reload();await page.waitForFunction(()=>window.__game,{timeout:120000});
 const restored=await page.evaluate(async save=>{const g=window.__game;g.setManualSimulation(true);const ok=await g.world.restore(save);return {ok,state:g.world.getState()};},saved);
 evidence.restore=restored;assert.ok(restored.ok);assert.ok(Math.hypot(restored.state.x-saved.x,restored.state.z-saved.z)<.01);
 assert.deepEqual(errors,[]);evidence.passed=true;
}catch(error){evidence.passed=false;evidence.failure=error.stack;evidence.final=await page.evaluate(()=>window.__game?.world.getState()).catch(()=>null);throw error;}
finally{clearTimeout(watchdog);evidence.finishedAt=new Date().toISOString();await writeFile('artifacts/long-walk.json',JSON.stringify(evidence,null,2));await browser.close();}
