// Approximate, photo-aligned underground geometry for the Wuyi Square sample.
// Coordinates are authored from dated references and are not surveyed measurements.
import {surfaceExitAt,surfaceExitOffset,surfaceExitPolygons,surfaceExitBoundary}from'./wuyi-metro-exits.mjs';
import {COURT_SECTION,COURT_PORTALS,courtPortalAt}from'./wuyi-place.mjs';
import { COURT_EDGE_STATIONS } from './wuyi-court-outline.mjs';

const courtMinZ = COURT_EDGE_STATIONS[0].z;
const courtMaxZ = COURT_EDGE_STATIONS.at(-1).z;
const courtMinX = Math.min(...COURT_EDGE_STATIONS.map(({ west }) => west));
const courtMaxX = Math.max(...COURT_EDGE_STATIONS.map(({ east }) => east));
export const SUNKEN_COURT = Object.freeze({
  id: 'wuyi-sunken-west', minX: courtMinX, maxX: courtMaxX, minZ: courtMinZ, maxZ: courtMaxZ, depth: COURT_SECTION.depth,
  basis: 'manual edge trace of 2025-08-29 orthophoto plus 2018 ground views; shadowed segments estimated; not surveyed'
});
export function courtEdgesAt(z) {
  const boundedZ = Math.max(courtMinZ, Math.min(courtMaxZ, z));
  for (let i = 0; i < COURT_EDGE_STATIONS.length - 1; i++) {
    const a = COURT_EDGE_STATIONS[i], b = COURT_EDGE_STATIONS[i + 1];
    if (boundedZ <= b.z) {
      const t = (boundedZ - a.z) / (b.z - a.z);
      return { west: a.west + (b.west - a.west) * t, east: a.east + (b.east - a.east) * t };
    }
  }
  const last = COURT_EDGE_STATIONS.at(-1);
  return { west: last.west, east: last.east };
}
export function courtOutline() {
  const westEdge = COURT_EDGE_STATIONS.map(({ west, z }) => [west, z]);
  const eastEdge = [...COURT_EDGE_STATIONS].reverse().map(({ east, z }) => [east, z]);
  return [...westEdge, ...eastEdge, [...westEdge[0]]];
}
// The 2018 ground photograph shows an intermediate commercial gallery above
// a second open lower level. Plan width/elevation are reconstruction estimates.
export const COURT_TERRACE=Object.freeze({minZ:-61,maxZ:103,width:4.5,offset:COURT_SECTION.galleryOffset,basis:'2018 built ground view: upper commercial gallery and lower open stairwell; dimensions estimated'});
export function inCourtTerrace(x,z){const e=courtEdgesAt(z);return z>=COURT_TERRACE.minZ&&z<=COURT_TERRACE.maxZ&&x>=e.east-COURT_TERRACE.width&&x<=e.east-.18;}
export const GROUND_FLIGHTS = Object.freeze([
  Object.freeze({ id: 'south-grand-stair', x: -2825, z: 111, dx: 0, dz: -1, width: 18, length: 18, depth: COURT_SECTION.depth, steps: 40, landingAt: 0.5, landingLength: 2 }),
  Object.freeze({ id: 'north-commercial-stair', x: -2825, z: -69, dx: 0, dz: 1, width: 9, length: 18, depth: COURT_SECTION.depth, steps: 40, landingAt: 0.5, landingLength: 2 })
]);
export const COURT_BRIDGE=Object.freeze({minX:-2840,maxX:-2801,z:5.3,width:6.8,basis:'Esri orthographic image pixel controls; deck aligns with observed east-west footpath'});
export function onCourtBridge(x,z){return x>=COURT_BRIDGE.minX&&x<=COURT_BRIDGE.maxX&&Math.abs(z-COURT_BRIDGE.z)<=COURT_BRIDGE.width/2;}
const EPS = 1e-8, WALL_BAND = 0.7;
export function inSunkenCourt(x,z,margin=0){if(z<SUNKEN_COURT.minZ-margin||z>SUNKEN_COURT.maxZ+margin)return false;const edges=courtEdgesAt(z);return x>=edges.west-margin&&x<=edges.east+margin;}
export function flightAt(x,z){for(const flight of GROUND_FLIGHTS){const rx=x-flight.x,rz=z-flight.z,along=rx*flight.dx+rz*flight.dz,lateral=rx*-flight.dz+rz*flight.dx;if(along>=-EPS&&along<=flight.length+EPS&&Math.abs(lateral)<=flight.width/2+EPS)return{flight,along:Math.max(0,Math.min(flight.length,along)),lateral};}return null;}
export function flightOffset(flight,along){const s=Math.max(0,Math.min(flight.length,along)),halfSteps=Math.floor(flight.steps/2),landingStart=Math.max(0,flight.length*flight.landingAt-flight.landingLength/2),landingEnd=Math.min(flight.length,landingStart+flight.landingLength);if(s<landingStart){const step=Math.min(halfSteps,Math.floor(s/Math.max(landingStart,EPS)*halfSteps+EPS));return-flight.depth*step/flight.steps;}if(s<landingEnd)return-flight.depth/2;const remainingSteps=flight.steps-halfSteps,run=flight.length-landingEnd,step=Math.min(remainingSteps,Math.floor((s-landingEnd)/Math.max(run,EPS)*remainingSteps+EPS));return-flight.depth*(halfSteps+step)/flight.steps;}
export function undergroundOffset(x,z,referenceOffset=null){if(referenceOffset!=null&&referenceOffset<-4&&courtPortalAt(x,z))return-SUNKEN_COURT.depth;const metro=surfaceExitOffset(x,z);if(metro!==null)return metro;if(onCourtBridge(x,z)&&(referenceOffset==null||referenceOffset>-1))return 0;if(inCourtTerrace(x,z)&&(referenceOffset==null||referenceOffset>(COURT_TERRACE.offset-SUNKEN_COURT.depth)/2&&referenceOffset<-1))return COURT_TERRACE.offset;const found=flightAt(x,z);if(found)return flightOffset(found.flight,found.along);return inSunkenCourt(x,z)?-SUNKEN_COURT.depth:null;}
// Surface-height movement cannot enter the court except through a flight.
// Underground movement cannot step across the narrow wall band to the exterior.
export function undergroundBoundary(x,z,referenceOffset=0){if(referenceOffset<-4){if(courtPortalAt(x,z))return false;if(courtPortalAt(x,z,.5)&&!inSunkenCourt(x,z))return true;}if(surfaceExitAt(x,z))return false;if(surfaceExitBoundary(x,z,referenceOffset))return true;if(onCourtBridge(x,z))return false;if(flightAt(x,z))return false;if(inCourtTerrace(x,z)&&referenceOffset>(COURT_TERRACE.offset-SUNKEN_COURT.depth)/2&&referenceOffset<-1)return false;if(referenceOffset>-SUNKEN_COURT.depth/2)return inSunkenCourt(x,z);return!inSunkenCourt(x,z)&&inSunkenCourt(x,z,WALL_BAND);}
export function isUndergroundOpening(x,z){return surfaceExitAt(x,z)!==null||inSunkenCourt(x,z)||flightAt(x,z)!==null;}
function openingPolygons(){
  const openings=[];
  for(let i=0;i<COURT_EDGE_STATIONS.length-1;i++){
    const a=COURT_EDGE_STATIONS[i],b=COURT_EDGE_STATIONS[i+1];
    openings.push([[a.west,a.z],[a.east,a.z],[b.east,b.z],[b.west,b.z]]);
  }
  for(const f of GROUND_FLIGHTS){
    const ex=f.x+f.dx*f.length,ez=f.z+f.dz*f.length,px=-f.dz*f.width/2,pz=f.dx*f.width/2;
    openings.push([[f.x+px,f.z+pz],[f.x-px,f.z-pz],[ex-px,ez-pz],[ex+px,ez+pz]]);
  }
  return [...openings,...surfaceExitPolygons().map(e=>e.points)];
}
function cleanPolygon(poly){const out=[];for(const p of poly){const prev=out.at(-1);if(!prev||Math.hypot(p[0]-prev[0],p[1]-prev[1],p[2]-prev[2])>EPS)out.push(p);}if(out.length>1&&Math.hypot(out[0][0]-out.at(-1)[0],out[0][1]-out.at(-1)[1],out[0][2]-out.at(-1)[2])<=EPS)out.pop();let changed=true;while(changed&&out.length>=3){changed=false;for(let i=0;i<out.length;i++){const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length],cross=(b[0]-a[0])*(c[2]-b[2])-(b[2]-a[2])*(c[0]-b[0]);if(Math.abs(cross)<=EPS){out.splice(i,1);changed=true;break;}}}return out;}
function clipHalfPlane(poly,a,b,inside=true){
  const side=p=>(b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const isInside=p=>inside?side(p)>=-EPS:side(p)<=EPS,out=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=side(p),dq=side(q),pi=isInside(p),qi=isInside(q);
    if(pi)out.push(p);
    if(pi!==qi){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t]);}
  }
  return cleanPolygon(out);
}
function subtractConvex(poly,clip){
  let rest=poly;const kept=[];
  for(let i=0;i<clip.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length],outside=clipHalfPlane(rest,a,b,false);
    if(outside.length>=3)kept.push(outside);
    rest=clipHalfPlane(rest,a,b,true);
    if(rest.length<3)return kept.length?kept:[poly];
  }
  return kept;
}
function area2(a,b,c){return(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);}
// Cut the opening union out of indexed x/y/z triangles. originX/originZ map
// local mesh coordinates to the authored world-coordinate reference frame.
export function cutUndergroundTriangles(positions,indices,originX=0,originZ=0){if(positions.length%3||indices.length%3)throw new RangeError('positions and indices must contain complete xyz vertices and triangles');const outPositions=[],outIndices=[],openings=openingPolygons().map(poly=>poly.map(([x,z])=>[x-originX,z-originZ]));for(let t=0;t<indices.length;t+=3){let pieces=[[0,1,2].map(k=>{const i=indices[t+k]*3;if(i<0||i+2>=positions.length)throw new RangeError('triangle index outside positions');return[positions[i],positions[i+1],positions[i+2]];})];for(const opening of openings)pieces=pieces.flatMap(poly=>subtractConvex(poly,opening));for(const poly0 of pieces){const poly=cleanPolygon(poly0);for(let i=1;i+1<poly.length;i++){if(Math.abs(area2(poly[0],poly[i],poly[i+1]))<=EPS)continue;const base=outPositions.length/3;for(const p of[poly[0],poly[i],poly[i+1]])outPositions.push(...p);outIndices.push(base,base+1,base+2);}}}return{positions:outPositions,indices:outIndices};}
