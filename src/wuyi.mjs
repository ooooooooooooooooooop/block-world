import * as THREE from 'three';
import {HEIWADO_RETAIL,retailRecess,LANDSCAPE_CORES,LANDSCAPE_CORE_BASIS,CENTRAL_COURT,inCentralCourt}from'./wuyi-place.mjs';
import {createPixelPalette,boxSurfaceUV} from './pixel-surfaces.mjs';
import {decorateWuyiEntrances} from './wuyi-entrances.mjs';
import {decorateSurfaceMetroExits}from'./wuyi-metro-render.mjs';
import {isUndergroundOpening,cutUndergroundTriangles} from './wuyi-underground.mjs';
import { WUYI } from './wuyi-data.mjs';
import { resolveWuyiHeight, HEIGHT_DECISIONS } from './wuyi-heights.mjs';
import { SCULPTURE_SITE,WUYI_PATHS, inPolygon, pathDistance, isWuyiGarden, heiwadoFascias,heiwadoCurvedFootprint } from './wuyi-site.mjs';

// Original pixel materials. Reference photographs guide form, never become textures.
const inside = (x,z,b=WUYI.sampleBounds)=>x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;
export const inWuyi = inside;
// On the existing south promenade, looking into the public square. Authored, not surveyed.
export const wuyiStart = {...WUYI.start,x:-2795,z:94,yaw:.12,pitch:.02};
// Coarse DEM contains rooftop/viaduct artifacts here. Photo-informed local grading
// is an authored approximation, not a surveyed elevation. Blend at its boundary.
export function wuyiGround(x,z,sourceY){const b=WUYI.sampleBounds;const edge=Math.min(x-b.minX,b.maxX-x,z-b.minZ,b.maxZ-z);const t=Math.max(0,Math.min(1,edge/100)),blend=t*t*(3-2*t);const grade=62.5+(z-124)*.0035+(x+2864)*.0013;return sourceY*(1-blend)+grade*blend;}

function texture(draw,size=256){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');draw(g,size);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestMipmapLinearFilter;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
function mat(color,extra={}){const m=new THREE.MeshLambertMaterial({color,...Object.fromEntries(Object.entries(extra).filter(([k])=>!["roughness","metalness"].includes(k)))});m.userData.worldShared=true;return m;}
const hash=(a,b)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
function whiteCladding(){return texture((g,s)=>{g.fillStyle='#e8e9e2';g.fillRect(0,0,s,s);g.strokeStyle='#cfd6d2';g.lineWidth=1;for(let y=-16;y<s+16;y+=16)for(let x=-16;x<s+16;x+=16){g.beginPath();g.moveTo(x,y);g.lineTo(x+8,y+8);g.lineTo(x,y+16);g.lineTo(x-8,y+8);g.closePath();g.stroke();}});}
function heiwadoCladding(){return texture((g,s)=>{
 g.fillStyle='#e9ece8';g.fillRect(0,0,s,s);
 // Small ceramic panels and pale filled flowers are visible in the dated facade photo.
 g.strokeStyle='#dce2dd';g.lineWidth=.65;for(let n=0;n<=s;n+=8){g.beginPath();g.moveTo(n,0);g.lineTo(n,s);g.moveTo(0,n);g.lineTo(s,n);g.stroke();}
 g.fillStyle='#f4f5f0';for(let i=0;i<5;i++){g.save();g.translate(s/2,s*.59);g.rotate(i*Math.PI*2/5);g.beginPath();g.ellipse(0,-s*.19,s*.12,s*.23,0,0,Math.PI*2);g.fill();g.restore();}
},512);}
function heiwadoBrand(group,x,y,z,w,h,rotation){
 const c=document.createElement('canvas');c.width=1536;c.height=Math.round(1536*h/w);const g=c.getContext('2d'),q=c.height*.78,left=c.width*.13,top=(c.height-q)/2;
 g.fillStyle='#b91f3b';g.fillRect(left,top,q,q);
 // An original drawing of the photo-visible white/green bird emblem, not a downloaded texture.
 g.save();g.translate(left+q*.5,top+q*.53);g.fillStyle='#ffffff';g.beginPath();g.moveTo(-q*.38,-q*.16);g.bezierCurveTo(-q*.18,-q*.13,-q*.08,q*.17,q*.12,q*.24);g.bezierCurveTo(q*.28,q*.19,q*.36,.0,q*.4,-q*.08);g.bezierCurveTo(q*.13,q*.04,-q*.03,-q*.14,-q*.2,-q*.27);g.closePath();g.fill();
 g.fillStyle='#439a78';g.beginPath();g.moveTo(-q*.06,-q*.08);g.bezierCurveTo(-q*.04,-q*.4,q*.13,-q*.46,q*.29,-q*.45);g.bezierCurveTo(q*.32,-q*.2,q*.19,-q*.05,-q*.06,-q*.08);g.fill();g.restore();
 g.font=`700 ${c.height*.75}px "City Sans UI","PingFang SC",sans-serif`;g.textAlign='left';g.textBaseline='middle';g.fillStyle='#b91f3b';g.fillText('平和堂',left+q+c.height*.2,c.height*.52);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=4;const m=new THREE.MeshBasicMaterial({map:t,transparent:true,toneMapped:false});m.userData.worldShared=false;m.userData.sign={text:'平和堂',basis:'2025 dated photograph, emblem redrawn'};
 const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.position.set(x,y,z);o.rotation.y=rotation;group.add(o);return o;
}

function extruded(polygon,height,material,base=0){const shape=new THREE.Shape();polygon.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);uvWorld(g,12,16);const o=new THREE.Mesh(g,material);o.position.y=base;o.castShadow=o.receiveShadow=true;return o;}
export function smoothHeiwadoArcNormals(geometry,originX=0,originZ=0){
 const p=geometry.attributes.position,n=geometry.attributes.normal,cx=-2785.41-originX,cz=214.67-originZ,rx=46.26,rz=38.78;
 for(let i=0;i<p.count;i++){const x=p.getX(i)-cx,z=p.getZ(i)-cz;if(Math.abs(n.getY(i))>.1||x>.01||z>.01||Math.abs(x*x/(rx*rx)+z*z/(rz*rz)-1)>.015)continue;const nx=x/(rx*rx),nz=z/(rz*rz),l=Math.hypot(nx,nz);if(l)n.setXYZ(i,nx/l,0,nz/l);}
 n.needsUpdate=true;return geometry;
}
function beam(group,m,a,b,width=.18){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),o=new THREE.Mesh(boxSurfaceUV(new THREE.BoxGeometry(width,av.distanceTo(bv),width),m.map?.userData.repeatMetres||1),m);o.position.copy(av.add(bv).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),bv.sub(new THREE.Vector3(...a)).normalize());o.castShadow=true;group.add(o);return o;}
function windowLights(){return texture((g,s)=>{g.fillStyle='#000';g.fillRect(0,0,s,s);for(let y=0;y<4;y++)for(let x=0;x<8;x++){if(hash(x+8,y+9)>.64){g.fillStyle=['#ffe3a2','#c8e5e9','#e4b980'][Math.floor(hash(x,y+16)*3)];g.fillRect(x*s/8+3,y*s/4+10,s/8-6,s/4-16);}}});}
function uvWorld(geometry,scaleX=12,scaleY=18){const p=geometry.attributes.position,n=geometry.attributes.normal,u=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){u[i*2]=(Math.abs(n.getY(i))>.5?p.getX(i):Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/scaleX;u[i*2+1]=(Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/scaleY;}geometry.setAttribute('uv',new THREE.BufferAttribute(u,2));}
function box(group,m,x,y,z,sx,sy,sz){const geometry=new THREE.BoxGeometry(sx,sy,sz);if(m.map?.userData.repeatMetres)boxSurfaceUV(geometry,m.map.userData.repeatMetres);const o=new THREE.Mesh(geometry,m);o.position.set(x,y+sy/2,z);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
function sign(group,text,x,y,z,w,h,rotation=0,bg='#243d46',fg='#fff1cb'){
 // Match the canvas to the physical board; never stretch Chinese glyphs to fit.
 const c=document.createElement('canvas'),ratio=w/h;c.height=256;c.width=Math.max(128,Math.min(4096,Math.round(c.height*ratio)));
 const g=c.getContext('2d'),padding=c.height*.12;g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);
 let fontSize=c.height*.62;const setFont=()=>g.font=`600 ${fontSize}px "City Sans UI","PingFang SC",sans-serif`;setFont();
 fontSize*=Math.min(1,(c.width-2*padding)/Math.max(1,g.measureText(text).width));setFont();
 g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';g.fillText(text,c.width/2,c.height*.52);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=4;
 const m=new THREE.MeshBasicMaterial({map:t,side:THREE.FrontSide,toneMapped:false});m.userData.worldShared=false;m.userData.sign={text,width:w,height:h,canvasWidth:c.width,canvasHeight:c.height,fontSize};
 const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.userData.referenceLabel=true;o.position.set(x,y,z);o.rotation.y=rotation;group.add(o);return o;
}
function footprintSurface(polygon,m,y){const s=new THREE.Shape();polygon.forEach(([x,z],i)=>i?s.lineTo(x,-z):s.moveTo(x,-z));s.closePath();const g=new THREE.ShapeGeometry(s);g.rotateX(-Math.PI/2);uvWorld(g,8,8);const o=new THREE.Mesh(g,m);o.position.y=y;o.receiveShadow=true;return o;}
// Keep authored surfaces inside their owning tile before sampling its terrain.
export function clipTilePolygon(poly,size=1024){for(const[axis,bound,greater]of[[0,0,true],[0,size,false],[1,0,true],[1,size,false]]){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ai=greater?a[axis]>=bound:a[axis]<=bound,bi=greater?b[axis]>=bound:b[axis]<=bound;if(ai)out.push(a);if(ai!==bi){const t=(bound-a[axis])/(b[axis]-a[axis]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}poly=out;if(poly.length<3)return[];}return poly;}
export function createWuyiKit({anisotropy=1,surfaces=null}={}){
 const ownsSurfaces=!surfaces;surfaces??=createPixelPalette({anisotropy});
 const lights=windowLights(),glass=mat(0xffffff,{map:surfaces.texture('glass'),metalness:.08,roughness:.28,emissive:0xffe6bf,emissiveMap:lights,emissiveIntensity:.04}),stone=mat(0xf2eee2,{map:surfaces.texture('stone'),emissive:0xffe6bf,emissiveMap:lights,emissiveIntensity:.025});
 const pavement=mat(0xffffff,{map:surfaces.texture('paving')}),asphalt=mat(0xffffff,{map:surfaces.texture('asphalt')}),trim=mat(0xd5ddda,{emissive:0x7cadca,emissiveIntensity:0}),dark=mat(0x31464e),cream=mat(0xd9d5c8),wood=mat(0x946d45),leaf=mat(0xffffff,{map:surfaces.texture('leaf')}),trunk=mat(0xffffff,{map:surfaces.texture('bark')}),hedge=mat(0x53733b),glow=mat(0xffeed0,{emissive:0xffdf9d,emissiveIntensity:.15}),red=mat(0xa55743);
 const white=mat(0xffffff,{map:whiteCladding(),emissive:0xcbd7d8,emissiveIntensity:.12}),aqua=mat(0xc0e5de,{map:surfaces.texture('glass'),roughness:.24,metalness:.18}),grass=mat(0xffffff,{map:surfaces.texture('grass')}),goldLeaf=mat(0xd0b545),bronze=mat(0x785d3c),flower=mat(0xd7a441),sculpture=mat(0xe9ebe1,{metalness:.25,roughness:.4}),clearGlass=mat(0xc9e6df,{transparent:true,opacity:.28,roughness:.18,side:THREE.DoubleSide}),orange=mat(0xd67b2a);
 const heiwadoWhite=mat(0xffffff,{map:heiwadoCladding()});
 const pooled=[heiwadoWhite,glass,stone,pavement,asphalt,trim,dark,cream,wood,leaf,trunk,hedge,glow,red,white,aqua,grass,goldLeaf,bronze,flower,sculpture,clearGlass,orange];for(const m of pooled)for(const t of[m.map,m.emissiveMap])if(t){t.anisotropy=anisotropy;t.needsUpdate=true;}
 const buildings=new Map(),objects=new Map(),siteRoots=[],lamps=[],lampPositions=[];
 function ground(entry,sample,x,z,offset=.03){return (sample(entry,x+entry.originX,z+entry.originZ)??0)+offset;}
 function detailBuilding(building,geometry,y,entry){
  const ps=building.polygon,center=ps.reduce((a,p)=>[a[0]+p[0]/ps.length,a[1]+p[1]/ps.length],[0,0]);if(!inside(...center))return null;
  const id=String(building.id),known=WUYI.features[id],tower=['527545451','527545453'].includes(id),podium=id==='527545435',hospital=id==='273260415';
  const adopted=resolveWuyiHeight(building),height=adopted.heightMeters;uvWorld(geometry,tower?18:16,tower?4*height/adopted.levels:16);
  const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,tower||height>90?glass:stone);mesh.position.y=y;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  const xs=ps.map(p=>p[0]-entry.originX),zs=ps.map(p=>p[1]-entry.originZ),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,w=maxX-minX,d=maxZ-minZ;
  group.name=`wuyi-building-${id}`;group.userData={osmId:id,name:building.name,heightMeters:height,sourceHeightMeters:adopted.sourceHeightMeters,heightDecision:adopted.decision,heightEvidence:HEIGHT_DECISIONS[id]??null,reviewRequired:adopted.reviewRequired,heightSource:building.heightSource,geometryHeightMeters:(geometry.computeBoundingBox(),geometry.boundingBox.max.y-geometry.boundingBox.min.y),verification:'source-footprint; facade authored from references; not fidelity-approved'};buildings.set(id,group.userData);objects.set(id,group);
  if(tower){
   for(const [x,z] of [[minX,minZ],[maxX,minZ],[minX,maxZ],[maxX,maxZ]])box(group,trim,x,y,z,.55,height,.55);
   for(const fraction of (id==='527545453'?[28/94,43/94,56/94,70/94,83/94]:[34/63]))box(group,trim,cx,y+height*fraction,cz,w+.4,1.1,d+.4);
   box(group,trim,cx,y+height-.8,cz,w+.8,.8,d+.8);
   // Reference shows subtle vertical silver ribs; all remain within source height.
   for(let x=minX+4;x<maxX;x+=4.5){box(group,trim,x,y,minZ-.13,.12,height,.14);box(group,trim,x,y,maxZ+.13,.12,height,.14);}
  }
  if(podium||id==='273260769'||id==='273251507'){
   const frontage=new THREE.Mesh(new THREE.BoxGeometry(w,9,.32),glass);frontage.position.set(cx,y+4.5,minZ-.3);group.add(frontage);
   box(group,cream,cx,y+9.2,minZ-.7,w,1.1,1.5);
   for(let x=minX+3;x<maxX;x+=7.5)box(group,trim,x,y,minZ-.65,.55,9.2,.65);
   const title=podium?'IFS  长沙国金中心':id==='52072595'?'平和堂 HEIWADO':id==='273260769'?'新世界百货':'王府井百货';
   sign(group,title,cx,y+Math.min(height-4,17),minZ-.85,Math.min(w*.82,88),6,Math.PI,'#263e47','#f3eddb');
  }
  if(id==='52072595'){
   // Separate commercial podium and office tower. The OSM 40 m is a podium claim.
   group.remove(mesh);geometry.dispose();
   const curved=heiwadoCurvedFootprint(ps),streetEdge=heiwadoFascias(curved).north,retail=retailRecess(curved,streetEdge);
   const lp=curved.map(([x,z])=>[x-entry.originX,z-entry.originZ]),recessLocal=retail.polygon.map(([x,z])=>[x-entry.originX,z-entry.originZ]);
   group.userData.renderFootprint=curved;group.userData.retail=retail;
   group.userData.collisionFootprints=[{polygon:retail.polygon,minY:y,maxY:y+retail.height},{polygon:curved,minY:y+retail.height,maxY:y+110}];
   group.userData.facadeBasis='curved NW podium; post-2025-09-26 three-storey UNIQLO north storefront, official photograph; plan/dimensions estimated';
   for(const[ring,hh,baseY,material]of[[recessLocal,7.4,y,dark],[recessLocal,retail.height-7.4,y+7.4,heiwadoWhite],[lp,height-retail.height,y+retail.height,heiwadoWhite]]){
    const part=extruded(ring,hh,material,baseY);smoothHeiwadoArcNormals(part.geometry,entry.originX,entry.originZ);uvWorld(part.geometry,32,30);group.add(part);
   }
   const shop=new THREE.Group(),mx=(retail.start[0]+retail.end[0])/2,mz=(retail.start[1]+retail.end[1])/2,yaw=Math.atan2(retail.nx,retail.nz),rw=retail.width,rd=HEIWADO_RETAIL.depth,sh=HEIWADO_RETAIL.storeyHeight,door=HEIWADO_RETAIL.doorWidth;
   shop.name='heiwado-uniqlo-three-storey';shop.position.set(mx-entry.originX,y,mz-entry.originZ);shop.rotation.y=yaw;group.add(shop);
   box(shop,pavement,0,.015,-rd/2,rw,.065,rd);
   box(shop,glow,0,.08,-rd+.12,rw,retail.height-.2,.12);
   for(let floor=0;floor<3;floor++){
    const fy=floor*sh;
    if(floor)box(shop,cream,0,fy-.18,-rd/2,rw,.22,rd);
    box(shop,cream,0,fy+sh-.28,-.04,rw,.28,.6);
    for(let xx=-rw/2+3;xx<rw/2;xx+=3.5)box(shop,trim,xx,fy+.1,0,.1,sh-.38,.14);
    if(floor)box(shop,clearGlass,0,fy+.1,.065,rw-.15,sh-.38,.06);
    else for(const side of[-1,1]){
     const panel=(rw-door)/2,px=side*(rw+door)/4;
     box(shop,clearGlass,px,.12,.065,panel,sh-.42,.06);
     const wx=mx+Math.cos(yaw)*px,wz=mz-Math.sin(yaw)*px;
     entry.furniture??=[];entry.furniture.push({x:wx,z:wz,alongX:Math.cos(yaw),alongZ:-Math.sin(yaw),halfAlong:panel/2,halfAcross:.13,minY:y,maxY:y+sh,kind:'retail-glazing'});
    }
    // Original rails/displays behind the real glazed shopfront. Keep the foyer clear.
    for(const xx of[-rw*.34,rw*.34]){
     box(shop,cream,xx,fy+.1,-rd*.65,3.3,.75,1.2);
     for(let n=0;n<5;n++)box(shop,n%2?cream:orange,xx-1.1+n*.55,fy+.95,-rd*.69,.42,.82,.22);
     beam(shop,trim,[xx-1.5,fy+2.05,-rd*.69],[xx+1.5,fy+2.05,-rd*.69],.055);
    }
   }
   for(const side of[-1,1])box(shop,trim,side*door/2,.08,.04,.12,sh-.3,.16);
   box(shop,red,0,retail.height-.88,.15,rw,.64,.2);sign(shop,'优衣库  UNIQLO',0,retail.height-.55,.27,12,.58,0,'#c52c36','#ffffff');
   // The upper red square logo is part of the post-opening official photograph.
   const brandX=rw*.32;sign(shop,'UNI',brandX,21.35,.2,4,1.8,0,'#e52432','#ffffff');sign(shop,'QLO',brandX,19.55,.2,4,1.8,0,'#e52432','#ffffff');
   entry.pedestrianPaths??=[];entry.pedestrianPaths.push({id:'heiwado-uniqlo-foyer',kind:'footway',width:2.4,authored:true,placement:HEIWADO_RETAIL.planBasis,points:[{x:mx+retail.nx*4,y:y+.1,z:mz+retail.nz*4},{x:mx-retail.nx*2.3,y:y+.1,z:mz-retail.nz*2.3}]});
   for(let i=1;i<lp.length;i++){const a=lp[i-1],b=lp[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<4||Math.hypot(a[0]+entry.originX-streetEdge.a[0],a[1]+entry.originZ-streetEdge.a[1])<.01)continue;for(let j=2;j<length;j+=5){const t=j/length;box(group,cream,a[0]+(b[0]-a[0])*t,y,a[1]+(b[1]-a[1])*t,.65,7.5,.65);}}
   const edges=heiwadoFascias(lp);
   function fascia(text,edge,yy,width,h,bg,fg){if(!edge)return;const{a,b,length,nx,nz}=edge;return sign(group,text,(a[0]+b[0])/2+nx*.35,yy,(a[1]+b[1])/2+nz*.35,Math.min(width,length-.6),h,Math.atan2(nx,nz),bg,fg);}
   heiwadoBrand(group,-2818.6-entry.originX,y+height*.67,186.8-entry.originZ,16,2.9,-Math.PI*.75);
   heiwadoBrand(group,minX-.4,y+height*.67,cz,18,3.4,-Math.PI/2);
   // The old July-2025 advertisement is superseded on this north frontage by the opened flagship.
   // 28-floor existence is documented; 110 m and tower plan are photo-calibrated estimates.
   const th=110,tw=51,td=43,tx=minX+tw/2+6,tz=maxZ-td/2-7;
   box(group,aqua,tx,y+height,tz,tw,th-height-5,td);
   for(let i=0;i<22;i++){const yy=y+height+i*(th-height-5)/22;box(group,white,tx,yy,tz,tw+.4,1.15,td+.4);for(const zz of[tz-td/2-.22,tz+td/2+.22])for(let xx=tx-tw/2+2;xx<tx+tw/2;xx+=4.2)box(group,trim,xx,yy+1.15,zz,.1,(th-height-5)/22-1.15,.13);}
   const cornerHeight=th-height-5;
   // The photograph shows a glazed vertical corner, not a cylindrical corner tower.
   box(group,aqua,tx-tw/2+5.2,y+height,tz-td/2-.26,7,cornerHeight,.42);
   box(group,aqua,tx-tw/2-.26,y+height,tz-td/2+5.2,.42,cornerHeight,7);
   box(group,white,tx+4,y+th-5,tz+5,tw-6,5,td-10);
   heiwadoBrand(group,tx+2,y+th-9,tz-td/2-.5,17,3.7,Math.PI);
   // Roof deck, low access/mechanical volumes and planted perimeter follow the curved podium outline.
   // These are visual-only details; the source does not establish a public rooftop route.
   const roofY=y+height+.08;group.add(footprintSurface(lp,pavement,roofY));group.userData.roofAccess='visual-only; not walkable';
   const curveStart=lp.findIndex(([x,z])=>Math.abs(x+entry.originX+2831.67)<.25&&Math.abs(z+entry.originZ-214.67)<.25);
   const curveEnd=lp.findIndex(([x,z])=>Math.abs(x+entry.originX+2785.41)<.25&&Math.abs(z+entry.originZ-175.89)<.25);
   const roofArc=curveStart>=0&&curveEnd>curveStart?lp.slice(curveStart,curveEnd+1):[];
   for(let i=1;i<roofArc.length;i++){
    const a=roofArc[i-1],b=roofArc[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.5)continue;
    const wx=(a[0]+b[0])/2+entry.originX,wz=(a[1]+b[1])/2+entry.originZ;
    let nx=(wx+2785.41)/(46.26*46.26),nz=(wz-214.67)/(38.78*38.78),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
    const px=(a[0]+b[0])/2-nx*1.15,pz=(a[1]+b[1])/2-nz*1.15,yaw=Math.atan2(-dz,dx);
    const planter=box(group,dark,px,roofY,pz,len+.08,.34,1.12);planter.rotation.y=yaw;
    const planting=box(group,i%5===0?flower:hedge,px,roofY+.34,pz,len*.72,.42,.62);planting.rotation.y=yaw;
    beam(group,trim,[a[0]-nx*.2,roofY+1.02,a[1]-nz*.2],[b[0]-nx*.2,roofY+1.02,b[1]-nz*.2],.09);
    if(i%2===0){for(const q of[a,b]){box(group,trim,q[0]-nx*.2,roofY,q[1]-nz*.2,.09,1.04,.09);}}
   }
   // A small equipment room sits wholly inside the original curved footprint and clear of the tower.
   function roofRectInside(px,pz,hx,hz){return[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].every(([dx,dz])=>inPolygon(px+dx+entry.originX,pz+dz+entry.originZ,curved));}
   let roofCore=null,roofCoreScore=Infinity;const roofTargetX=tx+12,roofTargetZ=tz-td/2-13;
   for(let px=minX+7;px<maxX-7;px+=2)for(let pz=minZ+7;pz<maxZ-7;pz+=2){
    if(Math.abs(px-tx)<tw/2+7&&Math.abs(pz-tz)<td/2+7)continue;
    if(!roofRectInside(px,pz,5.5,3.7))continue;
    const score=(px-roofTargetX)**2+(pz-roofTargetZ)**2;if(score<roofCoreScore){roofCore=[px,pz];roofCoreScore=score;}
   }
   if(roofCore){const[rx,rz]=roofCore;box(group,cream,rx,roofY,rz,11,3.1,7.4);box(group,trim,rx,roofY+3.1,rz,8.2,.28,5.1);box(group,dark,rx,roofY+.7,rz-3.76,2.2,1.8,.12);
    for(const[dx,dz]of[[-7,-5],[7,-5],[-7,5],[7,5]]){const ax=rx+dx,az=rz+dz;if(roofRectInside(ax,az,.95,.7)){box(group,dark,ax,roofY,az,1.9,.92,1.4);for(let rib=-.65;rib<=.65;rib+=.32)box(group,trim,ax+rib,roofY+.08,az-.72,.075,.7,.06);}}
    group.userData.roofEquipment='access and mechanical blocks are photo-calibrated estimates';
   }
   // Individually varied unbranded storefront bays follow only the photographed curved street edge.
   const shopBands=[dark,cream,wood,orange,trim],shopWidths=[4.6,5.3,4.2,5.8,4.8,5.1];
   for(let i=1,bay=0;i<roofArc.length-2;i+=3,bay++){
    const a=roofArc[i],b=roofArc[Math.min(i+3,roofArc.length-1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<2.4)continue;
    const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2,wx=mx+entry.originX,wz=mz+entry.originZ;
    let nx=(wx+2785.41)/(46.26*46.26),nz=(wz-214.67)/(38.78*38.78),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
    const width=Math.min(len*.82,shopWidths[bay%shopWidths.length]),yaw=Math.atan2(-dz,dx);
    // The midpoint of a long chord is inside the curved wall. Project it back to the ellipse.
    const ex=(wx+2785.41)/46.26,ez=(wz-214.67)/38.78,er=Math.hypot(ex,ez)||1;
    const frontX=-2785.41-entry.originX+ex/er*46.26+nx*.28,frontZ=214.67-entry.originZ+ez/er*38.78+nz*.28;
    const backing=box(group,bay%3===0?wood:dark,frontX,y+1.16,frontZ,width,4.35,.14);backing.rotation.y=yaw;
    const pane=box(group,clearGlass,frontX+nx*.09,y+1.25,frontZ+nz*.09,width,4.15,.08);pane.rotation.y=yaw;
    for(const side of[-1,1]){const fx=frontX+Math.cos(yaw)*side*width/2,fz=frontZ-Math.sin(yaw)*side*width/2,frame=box(group,trim,fx,y+1.15,fz,.14,4.35,.2);frame.rotation.y=yaw;}
    const fascia=box(group,shopBands[bay%shopBands.length],frontX+nx*.13,y+5.52,frontZ+nz*.13,width,.52,.34);fascia.rotation.y=yaw;
    const door=box(group,dark,frontX+Math.cos(yaw)*width*.18+nx*.18,y+1.3,frontZ-Math.sin(yaw)*width*.18+nz*.18,1.12,3.45,.12);door.rotation.y=yaw;
   }
   // The external golden arches are visible at the right end of the 2025 image. The bay position is photo-estimated; no current tenant or floor is inferred.
   if(roofArc.length>4){const q=roofArc[Math.floor(roofArc.length*.88)],wx=q[0]+entry.originX,wz=q[1]+entry.originZ;let nx=(wx+2785.41)/(46.26*46.26),nz=(wz-214.67)/(38.78*38.78),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
    const logo=new THREE.Group();logo.position.set(q[0]+nx*.43,y+2.85,q[1]+nz*.43);logo.rotation.y=Math.atan2(nx,nz);
    const boardMat=new THREE.MeshBasicMaterial({color:0xd9232e,toneMapped:false,side:THREE.DoubleSide}),archMat=new THREE.MeshBasicMaterial({color:0xffc72c,toneMapped:false});boardMat.userData.worldShared=false;archMat.userData.worldShared=false;
    const board=new THREE.Mesh(new THREE.PlaneGeometry(2.7,1.6),boardMat);logo.add(board);
    for(const points of[[[-.72,-.48],[-.7,.05],[-.58,.51],[-.4,.68],[-.23,.55],[0,-.48]],[[0,-.48],[.23,.55],[.4,.68],[.58,.51],[.7,.05],[.72,-.48]]]){const curve=new THREE.CatmullRomCurve3(points.map(([x,yy])=>new THREE.Vector3(x,yy,.035)));logo.add(new THREE.Mesh(new THREE.TubeGeometry(curve,24,.055,6,false),archMat));}
    group.add(logo);
   }

   group.userData.parts=[{part:'commercial-podium',heightMeters:height,basis:'OSM height tag; not independent measurement'},{part:'office-tower',heightMeters:th,basis:'2025 contractor photo: tower plan width approximately 0.60 of podium width; documented floor 28; height/plan remain estimates',reviewRequired:true}];
   group.userData.geometryHeightMeters=th;
  }
  if(known?.kind==='landscape-canopy'){
   group.remove(mesh);geometry.dispose();const lp=ps.map(([x,z])=>[x-entry.originX,z-entry.originZ]);
   // Keep each source OSM arc as an open steel canopy: no solid wood extrusion or filled roof slab.
   const roofLevel=y+6.25,width=maxX-minX,cx=(minX+maxX)/2;group.userData.renderFootprint=ps.map(p=>[...p]);group.userData.noSolidFootprint=true;
   const core=LANDSCAPE_CORES[id];
   if(core){
    const coreLocal=core.polygon.map(([x,z])=>[x-entry.originX,z-entry.originZ]);group.add(extruded(coreLocal,core.height,wood,y));group.add(extruded(coreLocal,.24,cream,y+core.height));
    group.userData.noSolidFootprint=false;group.userData.collisionFootprints=[{polygon:core.polygon,minY:y,maxY:y+core.height+.24}];group.userData.landscapeCore={...core,...LANDSCAPE_CORE_BASIS,CENTRAL_COURT,inCentralCourt};
    for(let i=0;i<coreLocal.length;i++){const a=coreLocal[i],b=coreLocal[(i+1)%coreLocal.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=.4;d<len;d+=.8){const t=d/len;box(group,cream,a[0]+(b[0]-a[0])*t,y+.15,a[1]+(b[1]-a[1])*t,.055,core.height-.2,.055);}}
   }
   entry.furniture??=[];
   let perimeter=0,nextPost=0;
   for(let i=0;i<lp.length;i++){
    const a=lp[i],b=lp[(i+1)%lp.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.6)continue;
    beam(group,trim,[a[0],roofLevel,a[1]],[b[0],roofLevel,b[1]],.15);
    for(;nextPost<perimeter+len;nextPost+=10){const t=(nextPost-perimeter)/len,px=a[0]+dx*t,pz=a[1]+dz*t,wx=px+entry.originX,wz=pz+entry.originZ;box(group,white,px,y,pz,.17,6.12,.17);entry.furniture.push({x:wx,z:wz,radius:.22,kind:'canopy-column'});}perimeter+=len;
   }
   const yAt=x=>y+6.25+.2*(1-Math.pow((x-cx)/Math.max(1,width/2),2));
   // Curved transverse ribs follow the source footprint intersections along the canopy's long axis.
   for(let x=minX+.6;x<maxX;x+=1.15){const hits=[];for(let i=0,j=lp.length-1;i<lp.length;j=i++){const a=lp[j],b=lp[i];if((a[0]>x)!==(b[0]>x))hits.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));}hits.sort((a,b)=>a-b);for(let i=1;i<hits.length;i+=2){const yy=yAt(x);beam(group,white,[x,yy,hits[i-1]],[x,yy,hits[i]],.095);}}
   // Fine open purlins make a visible lattice instead of a flat opaque lid.
   for(let z=minZ+.6;z<maxZ;z+=1.25){const hits=[];for(let i=0,j=lp.length-1;i<lp.length;j=i++){const a=lp[j],b=lp[i];if((a[1]>z)!==(b[1]>z))hits.push(a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]));}hits.sort((a,b)=>a-b);for(let i=1;i<hits.length;i+=2){for(let x=hits[i-1];x<hits[i];){const next=Math.min(hits[i],x+1.45);beam(group,white,[x,yAt(x),z],[next,yAt(next),z],.075);x=next;}}}
   group.userData.geometryHeightMeters=6.45;group.userData.reviewRequired=true;group.userData.verification='OSM arc footprint preserved; open white steel canopy form matched to 2018/2019 site photographs; three partial concrete/wood cores and covered passages reconstructed; function, plan and heights estimated';
  }

  if(hospital){
   mesh.material=cream;
   for(let i=0;i<5;i++)box(group,red,cx,y+height+i*.55,cz,w-i*2,.6,Math.max(1,d-i*4));
   sign(group,'长沙口腔医院',cx,y+height*.6,minZ-.7,w*.7,2.4,Math.PI,'#e6e3d5','#395552');
  }
  if(!known){group.remove(mesh);return mesh;}return group;
 }
 function decorate(entry,data,sample){
  const b=WUYI.sampleBounds,x0=Math.max(b.minX,entry.originX),x1=Math.min(b.maxX,entry.originX+1024),z0=Math.max(b.minZ,entry.originZ),z1=Math.min(b.maxZ,entry.originZ+1024);if(x0>=x1||z0>=z1)return;
  const group=new THREE.Group();group.name='wuyi-streetscape';siteRoots.push(group);entry.group.add(group);entry.pedestrianPaths??=[];entry.furniture??=[];
  const positions=[],uvs=[],indices=[],step=12;
  for(let z=z0;z<z1;z+=step)for(let x=x0;x<x1;x+=step){const xx=Math.min(x1,x+step),zz=Math.min(z1,z+step),base=positions.length/3;for(const [px,pz]of[[x,z],[xx,z],[x,zz],[xx,zz]]){positions.push(px-entry.originX,(sample(entry,px,pz)??0)+.005,pz-entry.originZ);uvs.push(px/8,pz/8);}indices.push(base,base+2,base+1,base+1,base+2,base+3);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));const cut=cutUndergroundTriangles(positions,indices,entry.originX,entry.originZ);g.setAttribute('position',new THREE.Float32BufferAttribute(cut.positions,3));g.setIndex(cut.indices);g.computeVertexNormals();uvWorld(g,8,8);const surface=new THREE.Mesh(g,pavement);surface.receiveShadow=true;group.add(surface);
  function eligible(x,z){return x>=entry.originX&&x<entry.originX+1024&&z>=entry.originZ&&z<entry.originZ+1024;}
  function local(x,z){return[x-entry.originX,z-entry.originZ];}
  function tree(x,z,scale=1){if(!eligible(x,z)||isUndergroundOpening(x,z)||Math.hypot(x-wuyiStart.x,z-wuyiStart.z)<12)return;const [lx,lz]=local(x,z),y=ground(entry,sample,lx,lz),crown=leaf;box(group,trunk,lx,y,lz,.28*scale,5.6*scale,.28*scale);entry.furniture.push({x,z,radius:.95*scale});for(let k=0;k<3;k++){const a=k*Math.PI*2/3;beam(group,wood,[lx+Math.cos(a)*.9*scale,y,lz+Math.sin(a)*.9*scale],[lx,y+2.15*scale,lz],.065*scale);beam(group,trunk,[lx,y+3.6*scale,lz],[lx+Math.cos(a)*1.7*scale,y+6.6*scale,lz+Math.sin(a)*1.7*scale],.16*scale);}for(let k=0;k<13;k++){const a=k*2.4,r=k<3?.7:1.2+hash(x+k,z)*1.1,h=5.5+hash(z+k,x)*2.7,w=1.6+hash(x,z+k)*1.3;box(group,crown,lx+Math.cos(a)*r*scale,y+h*scale,lz+Math.sin(a)*r*scale,w*scale,1.3*scale,w*scale);}}
  function lamp(x,z){if(!eligible(x,z)||isUndergroundOpening(x,z)||inCentralCourt(x,z,2)||lampPositions.some(p=>Math.hypot(p[0]-x,p[1]-z)<18))return;lampPositions.push([x,z]);const[lx,lz]=local(x,z),y=ground(entry,sample,lx,lz);box(group,dark,lx,y,lz,.16,5.4,.16);box(group,dark,lx,y+5.3,lz,2.4,.14,.18);for(const dx of[-1.05,1.05])box(group,glow,lx+dx,y+5.1,lz,.65,.22,.4);if(lamps.length<12){const light=new THREE.PointLight(0xffce8c,0,15,2);light.visible=false;light.position.set(lx,y+4.8,lz);group.add(light);lamps.push(light);}}
  function bench(x,z,rotation=0){if(!eligible(x,z)||isUndergroundOpening(x,z))return;const[lx,lz]=local(x,z),seat=new THREE.Group();seat.position.set(lx,ground(entry,sample,lx,lz),lz);seat.rotation.y=rotation;for(let i=0;i<5;i++)box(seat,wood,0,.46,i*.15-.3,2.5,.08,.12);for(let i=0;i<3;i++)box(seat,wood,0,.75+i*.14,.35,2.5,.1,.1);for(const dx of[-.85,.85])box(seat,dark,dx,0,0,.12,.48,.65);group.add(seat);entry.furniture.push({x,z,radius:1.35});}
  // Dense islands separated by the observed winding path structure. Placement is
  // photo-calibrated within the real park polygon, never claimed as surveyed.
  const plaza=WUYI.features['268748336'].polygon;
  const localBuildings=(data.buildings||[]).filter(b=>b.polygon);
  // Continuous ground and curved planting borders replace the coarse3.5m grid.
  const parkLocal=plaza.map(([x,z])=>[x-entry.originX,z-entry.originZ]);const green=footprintSurface(parkLocal,grass,0),sourcePositions=green.geometry.attributes.position,sourceIndices=green.geometry.index?.array??Array.from({length:sourcePositions.count},(_,i)=>i),greenPositions=[],greenIndices=[];
  // A large polygon cannot be draped using only its boundary heights: its long
  // triangles would bridge across the terrain and bury pedestrians. Subdivide
  // before sampling so the visible planting surface follows the actual ground.
  function groundTriangle(a,b,c){if(Math.max(a[0],b[0],c[0])<0||Math.min(a[0],b[0],c[0])>1024||Math.max(a[1],b[1],c[1])<0||Math.min(a[1],b[1],c[1])>1024)return;const vertices=[a,b,c],lengths=[[0,1],[1,2],[2,0]].map(([i,j])=>Math.hypot(vertices[i][0]-vertices[j][0],vertices[i][1]-vertices[j][1])),longest=lengths.indexOf(Math.max(...lengths));if(lengths[longest]>6){const i=longest,j=(longest+1)%3,k=(longest+2)%3,m=[(vertices[i][0]+vertices[j][0])/2,(vertices[i][1]+vertices[j][1])/2];groundTriangle(vertices[i],m,vertices[k]);groundTriangle(m,vertices[j],vertices[k]);return;}const poly=clipTilePolygon([a,b,c]);for(let k=1;k<poly.length-1;k++){const offset=greenPositions.length/3;for(const[x,z]of[poly[0],poly[k],poly[k+1]])greenPositions.push(x,(sample(entry,x+entry.originX,z+entry.originZ)??0)+.015,z);greenIndices.push(offset,offset+1,offset+2);}}
  for(let i=0;i<sourceIndices.length;i+=3)groundTriangle(...[0,1,2].map(k=>[sourcePositions.getX(sourceIndices[i+k]),sourcePositions.getZ(sourceIndices[i+k])]));
  const gc=cutUndergroundTriangles(greenPositions,greenIndices,entry.originX,entry.originZ);green.geometry.dispose();green.geometry=new THREE.BufferGeometry();green.geometry.setAttribute('position',new THREE.Float32BufferAttribute(gc.positions,3));green.geometry.setIndex(gc.indices);green.geometry.computeVertexNormals();uvWorld(green.geometry,8,8);group.add(green);
  function gardenRibbon(points,width,material,offset=.15){const borders=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;return[-1,1].map(side=>[p[0]-dz/len*width/2*side-entry.originX,p[1]+dx/len*width/2*side-entry.originZ]);}),positions=[],indices=[];for(let i=1;i<borders.length;i++){const poly=clipTilePolygon([borders[i-1][0],borders[i-1][1],borders[i][1],borders[i][0]]);for(let k=1;k<poly.length-1;k++){const n=positions.length/3;for(const[x,z]of[poly[0],poly[k],poly[k+1]])positions.push(x,(sample(entry,x+entry.originX,z+entry.originZ)??0)+offset,z);indices.push(n,n+1,n+2);}}const cut=cutUndergroundTriangles(positions,indices,entry.originX,entry.originZ),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(cut.positions,3));g.setIndex(cut.indices);g.computeVertexNormals();uvWorld(g,8,8);const o=new THREE.Mesh(g,material);o.receiveShadow=true;group.add(o);}
  // The inner gathering court is paved in the completed aerial. Keep the
  // continuous visible surface at grade and light poles outside its open centre.
  const centralRing=Array.from({length:65},(_,i)=>{const t=i/64*Math.PI*2;return[CENTRAL_COURT.x+Math.cos(t)*CENTRAL_COURT.rx-entry.originX,CENTRAL_COURT.z+Math.sin(t)*CENTRAL_COURT.rz-entry.originZ];});
  const centralClip=clipTilePolygon(centralRing);if(centralClip.length){const plazaPad=footprintSurface(centralClip,pavement,0),p=plazaPad.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,(sample(entry,p.getX(i)+entry.originX,p.getZ(i)+entry.originZ)??0)+.027);plazaPad.geometry.computeVertexNormals();plazaPad.userData.placeSurface=CENTRAL_COURT;group.add(plazaPad);}
  for(const path of WUYI_PATHS){gardenRibbon(path.points,path.width,pavement,.025);for(const side of[-1,1]){let part=[];for(let i=0;i<path.points.length;i++){const p=path.points[i],a=path.points[Math.max(0,i-1)],b=path.points[Math.min(path.points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,x=p[0]-dz/l*(path.width/2+1.1)*side,z=p[1]+dx/l*(path.width/2+1.1)*side;if(isWuyiGarden(x,z,plaza,localBuildings))part.push([x,z]);else{if(part.length>1)gardenRibbon(part,1.2,hedge,.45);part=[];}}if(part.length>1)gardenRibbon(part,1.2,hedge,.45);}}
  // Tree spacing follows the observed dense northern/western planted borders.
  for(let z=-88;z<82;z+=11)for(let x=-2828;x<-2700;x+=11){if(eligible(x,z)&&isWuyiGarden(x,z,plaza,localBuildings)&&hash(x,z)>.51)tree(x,z,.9+hash(z,x)*.3);}
  for(const path of WUYI_PATHS)for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);for(let d=0;d<length;d+=.7){for(const side of[-1,1]){const x=a[0]+dx/length*d-dz/length*(path.width/2+1.65)*side,z=a[1]+dz/length*d+dx/length*(path.width/2+1.65)*side;if(!eligible(x,z)||!isWuyiGarden(x,z,plaza,localBuildings))continue;const[lx,lz]=local(x,z),y=ground(entry,sample,lx,lz,.2);box(group,hedge,lx,y,lz,.8,.35,.8);box(group,flower,lx,y+.35,lz,.4,.14,.4);}}}
  // Open south-west corner and linear ginkgo corridor are located by the designer.
  for(let i=0;i<9;i++){const x=-2821+i*14,z=79+Math.sin(i*.5)*4;tree(x,z,1.1);}
  for(let z=-83;z<85;z+=21){tree(-2848,z,1.15);}
  for(const[x,z,rot]of[[-2818,83,0],[-2780,84,0],[-2742,88,0],[-2834,48,Math.PI/2],[-2842,-3.5,Math.PI/2],[-2780,31,.6],[-2715,52,-.5]])bench(x,z,rot);
  // Place path lights by travelled metres and the path's real perpendicular,
  // not by spline sample index or a fixed +X shift into the gathering area.
  for(const path of WUYI_PATHS){let lengthSoFar=0,nextLight=8;for(let i=1;i<path.points.length;i++){
   const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(!len)continue;
   for(;nextLight<lengthSoFar+len;nextLight+=18){const t=(nextLight-lengthSoFar)/len,off=path.width/2+.8,x=a[0]+dx*t-dz/len*off,z=a[1]+dz*t+dx/len*off;
    if(!eligible(x,z)||isUndergroundOpening(x,z)||inCentralCourt(x,z,2)||localBuildings.some(b=>inPolygon(x,z,b.polygon)))continue;
    const[lx,lz]=local(x,z),y=ground(entry,sample,lx,lz);box(group,dark,lx,y,lz,.14,2.6,.14);box(group,glow,lx,y+2.6,lz,.55,.2,.55);entry.furniture.push({x,z,radius:.17,kind:'path-light'});
   }lengthSoFar+=len;
  }}
  if(eligible(-2835,98)){const[lx,lz]=local(-2835,98),y=ground(entry,sample,lx,lz);box(group,cream,lx,y,lz,6,1.15,.45);sign(group,'五一广场  Wuyi Square',lx,y+.65,lz-.24,5.7,.6,Math.PI,'#d9d7cb','#3c4d46');}
  // Physical paths and NPC paths use the same controls; they do not add public
  // routing edges to the city graph. Trees/benches remain collision-aware.
  for(const path of WUYI_PATHS){const points=path.points.filter(([x,z])=>eligible(x,z)).map(([x,z])=>({x,y:sample(entry,x,z)??0,z}));if(points.length>1)entry.pedestrianPaths.push({id:'wuyi-'+path.id,kind:'footway',width:path.width,points,authored:true,placement:'photo-calibrated estimate'});}
  // Ground photograph #200 shows the white layered mountain-line sculpture.
  // Its shape is observed; dimensions and site position below are calibrated estimates.
  const sx=SCULPTURE_SITE.x,sz=SCULPTURE_SITE.z;if(eligible(sx,sz)){
   const[lx,lz]=local(sx,sz),y=ground(entry,sample,lx,lz,.28);box(group,hedge,lx,y,lz,21,.55,5.2);entry.furniture.push({x:sx,z:sz,halfX:10,halfZ:2.3});
   function mountain(x){return 2.85*Math.exp(-Math.pow((x+1.7)/1.6,2))+1.45*Math.exp(-Math.pow((x+5.7)/1.25,2))+.9*Math.exp(-Math.pow((x-2.4)/1.05,2))+1.4*Math.exp(-Math.pow((x-6.3)/1.65,2));}
   // Separate fine rods follow the same mountain profile; lowering each nested
   // profile avoids the crossing lattice produced by the former raised bases.
   const strands=30,segments=150,rods=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),sculpture,strands*segments),rod=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);let index=0;
   for(let strand=0;strand<strands;strand++){let previous;for(let j=0;j<=segments;j++){const x=-9+j*18/segments,point=new THREE.Vector3(lx+x,y+.55+mountain(x)*(1-strand*.025),lz+(strand-14.5)*.045);if(previous){const delta=point.clone().sub(previous);rod.position.copy(previous).add(point).multiplyScalar(.5);rod.quaternion.setFromUnitVectors(up,delta.clone().normalize());rod.scale.set(.028,delta.length(),.028);rod.updateMatrix();rods.setMatrixAt(index++,rod.matrix);}previous=point;}}
   rods.castShadow=rods.receiveShadow=true;group.add(rods);
  }
  // The 300 m² northern dry-fountain fact is documented; exact jets are estimated.
  const fx=-2779,fz=-78;if(eligible(fx,fz)){const[lx,lz]=local(fx,fz),y=ground(entry,sample,lx,lz,.2);const disc=[];for(let i=0;i<40;i++){const a=i/40*Math.PI*2;disc.push([lx+Math.cos(a)*9.8,lz+Math.sin(a)*9.8]);}group.add(footprintSurface(disc,cream,y));for(let x=-6;x<=6;x+=3)for(let z=-6;z<=6;z+=3){if(Math.hypot(x,z)>8)continue;box(group,trim,lx+x,y+.05,lz+z,.18,.08,.18);}}
  for(const road of entry.roads){if(!inside(road.points[0].x,road.points[0].z)||road.width<6)continue;for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<8)continue;const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len;
   for(let d=3;d<len-2;d+=8){const x=a.x+dx*d,z=a.z+dz*d;if(!eligible(x,z)||isUndergroundOpening(x,z))continue;const[lx,lz]=local(x,z),yy=a.y+(b.y-a.y)*d/len+.125;for(const offset of[-road.width/6,road.width/6]){const dash=box(group,cream,lx-dz*offset,yy,lz+dx*offset,.12,.025,3.5);dash.rotation.y=Math.atan2(dx,dz);}}
   for(let d=8;d<len;d+=32){const x=a.x+dx*d,z=a.z+dz*d;lamp(x-dz*(road.width/2+1.5),z+dx*(road.width/2+1.5));}
  }}
  decorateWuyiEntrances(group,entry,sample,{pavement,cream,dark,trim,clearGlass,orange,glow,leaf,hedge},sign);
  decorateSurfaceMetroExits(group,entry,sample,{pavement,cream,dark,trim,clearGlass,orange,glow,leaf,hedge},sign);
  return group;
 }
 function photoSubjects(camera,root){
  root.updateMatrixWorld(true);camera.updateMatrixWorld(true);const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),frustum=new THREE.Frustum().setFromProjectionMatrix(projection),ray=new THREE.Raycaster(),origin=camera.getWorldPosition(new THREE.Vector3()),subjects=[];
  for(const [id,obj]of objects){if(!WUYI.features[id]||id==='268748336')continue;const bounds=new THREE.Box3().setFromObject(obj);if(!frustum.intersectsBox(bounds))continue;const center=bounds.getCenter(new THREE.Vector3());let visible=0;
    for(const fraction of[.25,.5,.85]){const point=center.clone();point.y=bounds.min.y+(bounds.max.y-bounds.min.y)*fraction;const projected=point.clone().project(camera);if(Math.abs(projected.x)>1||Math.abs(projected.y)>1||projected.z>1||projected.z< -1)continue;ray.set(origin,point.sub(origin).normalize());const hit=ray.intersectObject(root,true).find(h=>{if(!h.object.isMesh||h.object.material?.transparent)return false;let o=h.object;while(o&&o!==root){if(!o.visible)return false;o=o.parent;}return true;});let parent=hit?.object;while(parent&&parent!==obj)parent=parent.parent;if(parent===obj)visible++;}
    if(visible)subjects.push({osmId:id,name:WUYI.features[id].name,visibleSamples:visible});
  }return subjects;
 }
 function setTime(mode){const night=mode==='night';glass.emissiveIntensity=night?.38:0;white.emissiveIntensity=night?.035:.12;trim.emissiveIntensity=night?.25:0;stone.emissiveIntensity=night?.48:.025;glow.emissiveIntensity=night?2:.15;lamps.forEach((l,i)=>{l.visible=night&&i<4;l.intensity=night?13:0;});}
 function dispose(){for(const m of pooled){if(!m.map?.userData.sharedSurface)m.map?.dispose();m.emissiveMap?.dispose();m.dispose();}if(ownsSurfaces)surfaces.dispose();}
 function setLabelsVisible(visible){for(const root of [...objects.values(),...siteRoots])root.traverse(o=>{if(o.userData.referenceLabel)o.visible=visible;});}
 return{setLabelsVisible,detailBuilding,decorate,photoSubjects,setTime,dispose,pavement,asphalt,buildings,WUYI};
}
