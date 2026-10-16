import {bindGameInput} from '../src/game-input.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaySession} from '../src/play-session.mjs';
import {createCityExperience,completedLookout,PHOTO_LOOKOUTS,bearingTo,orderPlacesForVisit} from '../src/city-experience.mjs';
import {createJourney} from '../src/journey.mjs';

test('input context excludes walking under panels and photography, returning to the same base mode',()=>{
 const session=createPlaySession();assert.equal(session.snapshot().look,false);
 assert.equal(session.enterPhoto(),false);session.start();assert.equal(session.snapshot().movement,true);
 session.enterPhoto();session.open('photo-preview');assert.equal(session.snapshot().look,false);
 session.close();assert.equal(session.photography,true);assert.equal(session.snapshot().look,true);assert.equal(session.snapshot().movement,false);
 session.exitPhoto();session.open('map-panel');assert.equal(session.snapshot().movement,false);session.close();assert.equal(session.snapshot().movement,true);
});
test('photo goals require real visible subjects in one successfully saved photograph',()=>{
 const goal=PHOTO_LOOKOUTS.find(g=>g.id==='photo:ifs-pair');const journey=createJourney();
 journey.savedPhoto({id:'a',visibleSubjects:[{osmId:'527545453',name:'T1',visibleSamples:2}]});
 journey.savedPhoto({id:'b',visibleSubjects:[{osmId:'527545451',name:'T2',visibleSamples:2}]});
 assert.equal(completedLookout(goal,journey.snapshot()),false,'separate photographs are not a pair in one frame');
 journey.savedPhoto({id:'c',place:'国金双塔',visibleSubjects:[]});assert.equal(completedLookout(goal,journey.snapshot()),false);
 journey.savedPhoto({id:'d',visibleSubjects:[{osmId:'527545453',name:'T1',visibleSamples:2},{osmId:'527545451',name:'T2',visibleSamples:0}]});assert.equal(completedLookout(goal,journey.snapshot()),false);
 journey.savedPhoto({id:'e',visibleSubjects:[{osmId:'527545453',name:'T1',visibleSamples:2},{osmId:'527545451',name:'T2',visibleSamples:2}]});assert.equal(completedLookout(goal,journey.snapshot()),true);
});
test('tracking does not complete anything and survives a save without discarding legacy records',()=>{
 const journey=createJourney({saved:{schemaVersion:1,photos:{old:{id:'old',subjectKeys:[]}},discoveries:{old:{name:'旧足迹'}}}});
 journey.track('photo:heiwado');const saved=journey.snapshot();assert.equal(completedLookout(PHOTO_LOOKOUTS[0],saved),false);
 const copy=createJourney({saved});assert.equal(copy.snapshot().trackedTarget,'photo:heiwado');assert.ok(copy.snapshot().photos.old);assert.ok(copy.snapshot().discoveries.old);
});
test('only actual located places become visit opportunities; distance counters cannot substitute arrival',()=>{
 const experience=createCityExperience([{id:'real',name:'地点',world:{x:100,z:0}},{id:'unknown',name:'未知'}]);
 const saved=createJourney({distance:100000}).snapshot();const nearby=experience.nearby({x:0,z:0},saved);
 assert.equal(experience.get('visit:unknown'),null);assert.equal(nearby.find(g=>g.id==='visit:real').done,false);
 saved.discoveries.real={id:'real'};assert.equal(experience.nearby({x:0,z:0},saved).find(g=>g.id==='visit:real').done,true);
});
test('companion invitation alone cannot manufacture visible people in a saved photograph',()=>{
 const journey=createJourney();journey.savedPhoto({id:'photo',companionId:'npc',visiblePeople:[{id:'player',name:'我',visibleSamples:3},{id:'npc',name:'路人',visibleSamples:1}]});
 assert.deepEqual(journey.snapshot().photos.photo.people,[{id:'player',name:'我'}]);
});
test('directions preserve north-negative-Z world coordinates',()=>{
 assert.equal(bearingTo({x:0,z:0},{x:0,z:-10}).label,'北');assert.equal(bearingTo({x:0,z:0},{x:10,z:10}).label,'东南');
});

test('photography shortcuts work after selecting a camera option, but never while editing text',()=>{
 const win=new EventTarget(),doc=new EventTarget(),canvas=new EventTarget();
 doc.defaultView=win;canvas.ownerDocument=doc;canvas.style={};canvas.focus=()=>{};
 doc.activeElement={tagName:'SELECT'};const actions=[];
 const input=bindGameInput({canvas,getContext:()=>({started:true,movement:false,look:true}),onAction:a=>actions.push(a)});
 const press=code=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{code,repeat:false});win.dispatchEvent(e);};
 press('KeyF');assert.deepEqual(actions,['shutter']);
 doc.activeElement={tagName:'INPUT',type:'text'};press('KeyF');assert.deepEqual(actions,['shutter']);
 doc.activeElement={tagName:'INPUT',type:'range'};press('KeyF');assert.deepEqual(actions,['shutter','shutter']);
 input.dispose();
});

test('city search ranks located exact names first while retaining every unlocated source record',()=>{
 const records=[{id:'official',name:'岳麓山-橘子洲旅游区',world:null},{id:'entrance',name:'岳麓山南门',world:{x:1,z:1}},{id:'mountain',name:'岳麓山',world:{x:100,z:100}},{id:'unknown',name:'岳麓山',world:null}];
 const sorted=orderPlacesForVisit(records,'岳麓山',{x:0,z:0});assert.deepEqual(sorted.map(p=>p.id),['mountain','entrance','unknown','official']);assert.equal(sorted.length,records.length);assert.equal(records[0].id,'official');assert.equal(sorted.find(p=>p.id==='official').world,null);
});
