// Place-level reconstruction records. A source supports only the fields it observes.
// No coordinates or metric dimensions below are represented as a survey.
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
export const HEIWADO_RETAIL=freeze({
 id:'heiwado-uniqlo',tenant:'UNIQLO 优衣库',buildingId:'52072595',floors:[1,2,3],opened:'2025-09-26',
 source:'https://www.uniqlo.com/cn/news/topics/2025082501/',
 image:'https://www.fastretailing.com/jp/about/photolibrary/images/photolib_uqChangshaHeiwado01.jpg',
 imageBasis:'official Fast Retailing Changsha Heiwado storefront photograph, photo library updated 2026-06-11',
 planBasis:'north street edge and recessed three-storey glazing reconstructed from the official photograph; widths, depth and storey heights estimated',
 from:.035,to:.965,depth:4.8,storeyHeight:4.65,doorWidth:3.4,dimensionsEstimated:true,positionAccuracyProven:false
});
// Recess a frontage into the real curved podium. Render and collision use this ring.
export function retailRecess(polygon,edge,record=HEIWADO_RETAIL){
 const lerp=t=>[edge.a[0]+(edge.b[0]-edge.a[0])*t,edge.a[1]+(edge.b[1]-edge.a[1])*t];
 const start=lerp(record.from),end=lerp(record.to),back=p=>[p[0]-edge.nx*record.depth,p[1]-edge.nz*record.depth];
 const ring=polygon.slice(0,-1).map(p=>[...p]);
 const i=ring.findIndex(a=>Math.hypot(a[0]-edge.a[0],a[1]-edge.a[1])<.001);if(i<0)throw new Error('retail frontage missing from podium');
 ring.splice(i+1,0,start,back(start),back(end),end);
 return{polygon:[...ring,[...ring[0]]],start,end,backStart:back(start),backEnd:back(end),nx:edge.nx,nz:edge.nz,width:edge.length*(record.to-record.from),height:record.storeyHeight*record.floors.length,record};
}
export const LANDSCAPE_CORES=freeze({
 '1552467176':{id:'north-arc-core',polygon:[[-2791,-46.5],[-2794,-48.3],[-2785,-53.8],[-2776,-57.7],[-2765,-60],[-2765,-55.2],[-2774.8,-53.3],[-2783,-49.8]],height:3.8},
 '1552467174':{id:'east-arc-core',polygon:[[-2736,-9.5],[-2732,-17],[-2731,-22.5],[-2725,-24.3],[-2726,-17],[-2728.3,-9.8],[-2730.8,-6.6]],height:3.8},
 '1552467175':{id:'south-arc-core',polygon:[[-2775,24],[-2770,10],[-2761,10],[-2752,7],[-2744,3],[-2738,0],[-2740,5],[-2748,12],[-2756,17],[-2765,21]],height:3.8}
});
export const LANDSCAPE_CORE_BASIS=freeze({source:'https://www.hunantoday.cn/news/xhn/201902/14546786.html',observed:'designer identifies three existing curved concrete buildings and a new steel canopy; completed 2018 aerial shows solid inner edges and covered circulation',planBasis:'partial solid cores fitted inside source canopy footprints; plan and height photo-estimated; function unverified',surveyed:false});
// Explicit openings, rather than modulo widths and random tenant signs. These
// are dated photo reconstructions of bay rhythm; tenant identity is unknown.
export const COURT_BAYS=freeze({
 west:[[-47,-39,'glazed'],[-37.7,-30.2,'recessed'],[-28.5,-19.1,'shutter'],[-17.8,-8.8,'glazed'],[12,20.1,'service'],[21.4,31.8,'glazed'],[33.1,41.2,'recessed'],[42.6,52.9,'shutter'],[54.2,65.1,'glazed'],[66.5,75.8,'recessed'],[77.1,86.8,'glazed']],
 east:[[-46,-37.5,'glazed'],[-36.1,-26.2,'shutter'],[-24.8,-16.6,'recessed'],[-15.2,-7.1,'service'],[12,22.6,'glazed'],[24,32.7,'recessed'],[34.1,45.2,'glazed'],[46.6,55.4,'shutter'],[56.8,66.1,'glazed'],[67.5,78.1,'recessed'],[79.5,88.6,'service']]
});
export const COURT_SECTION=freeze({depth:6.4,galleryOffset:-3.2,clearStorey:3.2,basis:'2018 completed ground view shows two commercial levels with people, doors and escalators; reconstructed 3.2 m storeys, not measured elevations',source:'https://www.hunantoday.cn/news/xhn/201902/14546786.html',dimensionsEstimated:true});
// 6C's named POI is west of the traced opening. The connector is an explicit
// reconstruction estimate, below grade only. 6D's anchor overlaps the grand
// stair in plan: do not invent a tunnel or a new surface canopy to force a fit.
export const COURT_PORTALS=freeze([
 {id:'6C',x:-2836.804,z:95.307,side:'west',width:4.4,clearHeight:3.05,connectorEndX:-2825.5,joinZ:90.8,vestibuleMaxX:-2834.25,
  source:'artifacts/wuyi-v19-20261015/site-research/portal-position-decision.json',gcj02:[112.97659,28.195707],wgs84:[112.97105201358723,28.19914288745403],sourcePhoto:'artifacts/wuyi-entrances-20261015/references/6c-recent-1.png',
  basis:'named provider POI in inferred GCJ-02, iteratively converted to WGS84; paired orange/cream arches observed in 2025-08-14 interior photo; corridor alignment and elevation estimated',positionAccuracyProven:false,dimensionsEstimated:true,connectionEstimated:true,placed:true},
 {id:'6D',x:-2820.102,z:107.701,gcj02:[112.976761,28.195596],wgs84:[112.97122245137366,28.199031424850904],source:'artifacts/wuyi-v19-20261015/site-research/portal-position-decision.json',sourcePhoto:'https://commons.wikimedia.org/wiki/File:Entrance_No._6D_of_Wuyi_Square_Station,_Picture1_20250814.jpg',placed:false,positionAccuracyProven:false,reason:'named POI overlaps estimated grand stair in XZ; interior elevation and connecting hall not established'}
]);
export function courtPortalOutline(p){return[[p.x-.3,p.joinZ-p.width/2],[p.connectorEndX,p.joinZ-p.width/2],[p.connectorEndX,p.joinZ+p.width/2],[p.vestibuleMaxX,p.joinZ+p.width/2],[p.vestibuleMaxX,p.z+p.width/2],[p.x-.3,p.z+p.width/2]];}
export function courtPortalAt(x,z,margin=0){return COURT_PORTALS.find(p=>p.placed&&((x>=p.x-.3-margin&&x<=p.connectorEndX+margin&&Math.abs(z-p.joinZ)<=p.width/2+margin)||(x>=p.x-.3-margin&&x<=p.vestibuleMaxX+margin&&z>=p.joinZ-p.width/2-margin&&z<=p.z+p.width/2+margin)))??null;}
export function courtPortalWallGap(z){return COURT_PORTALS.some(p=>p.placed&&Math.abs(z-p.joinZ)<p.width/2);}


export const CENTRAL_COURT=freeze({x:-2765,z:-27,rx:21,rz:20,basis:'2018 completed aerial: paved inner gathering court enclosed by curved buildings, rather than an uninterrupted lawn; ellipse/extent photo-estimated',source:'https://www.hunantoday.cn/news/xhn/201902/14546786.html',dimensionsEstimated:true});
export function inCentralCourt(x,z,margin=0){return((x-CENTRAL_COURT.x)/(CENTRAL_COURT.rx+margin))**2+((z-CENTRAL_COURT.z)/(CENTRAL_COURT.rz+margin))**2<1;}
export const COURT_FRONTAGE_BASIS=freeze({source:'2018 completed ground/aerial views',openings:'bay rhythm and frontage types reconstructed, not a per-door survey',tenantIdentity:'unknown',currentOperation:'unknown',dimensionsEstimated:true});
