import {isUndergroundOpening,onCourtBridge} from './wuyi-underground.mjs';
// Photo-calibrated layout tied to the OSM park and central canopy footprints.
// Control points are authored estimates, not surveyed path or furniture coordinates.
const PATH_CONTROLS = [
 {id:'south-promenade',width:10,points:[[-2849,125],[-2820,125],[-2795,120],[-2795,91],[-2765,94],[-2735,98],[-2696,95]]},
 {id:'west-promenade',width:8,points:[[-2849,125],[-2849,75],[-2850,35],[-2850,-5],[-2850,-45],[-2844,-85]]},
 {id:'garden-spine',width:6,points:[[-2795,94],[-2792,76],[-2787,57],[-2790,38],[-2795,21],[-2799,3],[-2794,-15],[-2783,-26],[-2797,-39],[-2807,-52],[-2798,-69],[-2815,-83],[-2834,-85]]},
 {id:'east-garden',width:5,points:[[-2696,95],[-2714,79],[-2724,62],[-2725,43],[-2713,22],[-2701,2],[-2702,-23],[-2707,-55],[-2715,-86],[-2750,-90],[-2780,-87],[-2815,-83]]},
 {id:'courtyard-approach',width:6,points:[[-2787,57],[-2790,39],[-2786,17],[-2779,3],[-2769,-12],[-2765,-25],[-2774,-36],[-2780,-43]]},
 {id:'south-garden-link',width:4.5,points:[[-2790,38],[-2770,42],[-2750,47],[-2725,43]]},
 {id:'north-garden-link',width:4.5,points:[[-2790,-67],[-2771,-76],[-2750,-90]]}
];
function roundedPath(points){const result=[];for(let i=0;i<points.length-1;i++){const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];for(let n=0;n<8;n++){const t=n/8,t2=t*t,t3=t2*t;result.push([0,1].map(k=>(2*t3-3*t2+1)*p1[k]+(t3-2*t2+t)*.25*(p2[k]-p0[k])+(-2*t3+3*t2)*p2[k]+(t3-t2)*.25*(p3[k]-p1[k])));}}result.push(points.at(-1));return result;}
export const WUYI_PATHS=PATH_CONTROLS.map(p=>({...p,points:roundedPath(p.points),controls:p.points}));
export function inPolygon(x,z,ps){let yes=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const[a,b]=ps[i],[c,d]=ps[j];if((b>z)!=(d>z)&&x<(c-a)*(z-b)/((d-b)||1e-12)+a)yes=!yes;}return yes;}
export function pathDistance(x,z,path){let best=Infinity;for(let i=1;i<path.points.length;i++){const[a,b]=path.points[i-1],[c,d]=path.points[i],dx=c-a,dz=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-a-t*dx,z-b-t*dz));}return best;}
export function isWuyiGarden(x,z,park,buildings=[]){return !isUndergroundOpening(x,z)&&!onCourtBridge(x,z)&&inPolygon(x,z,park)&&z<87&&x> -2832&&x< -2696&&!WUYI_PATHS.some(p=>pathDistance(x,z,p)<p.width/2+1.2)&&Math.hypot((x+2765)/1.1,z+27)>27&&!buildings.some(b=>inPolygon(x,z,b.polygon));}

// Processed OSM rings may reverse the raw way order. Select actual facade edges
// by geometry and orient the outward normal independently of vertex numbering.
export function heiwadoFascias(ps){
 const area=ps.reduce((sum,a,i)=>{const b=ps[(i+1)%ps.length];return sum+a[0]*b[1]-b[0]*a[1];},0),side=area>=0?1:-1;
 const xs=ps.map(p=>p[0]),zs=ps.map(p=>p[1]),minZ=Math.min(...zs),cx=(Math.min(...xs)+Math.max(...xs))/2,depth=Math.max(...zs)-minZ;
 const edges=ps.map((a,i)=>{const b=ps[(i+1)%ps.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);return{a,b,length,nx:side*dz/length,nz:-side*dx/length,mx:(a[0]+b[0])/2,mz:(a[1]+b[1])/2,dx,dz};}).filter(e=>e.length>1);
 return{north:edges.filter(e=>e.mz<minZ+6&&e.length>20).sort((a,b)=>b.length-a.length)[0],corner:edges.filter(e=>e.mx<cx&&e.mz<minZ+depth*.35&&Math.abs(e.dx)>15&&Math.abs(e.dz)>15).sort((a,b)=>b.length-a.length)[0]};
}

export const SCULPTURE_SITE=Object.freeze({x:-2736,z:34,width:21,depth:5.2,basis:'inside OSM park north of the southern building notch; ground-photo shape, placement still estimated'});

export function heiwadoCurvedFootprint(ps){
 let ring=ps.slice(0,-1).map(p=>[...p]);
 const locate=()=>[ring.findIndex(p=>Math.abs(p[0]+2831.67)<.2&&Math.abs(p[1]-214.67)<.2),ring.findIndex(p=>Math.abs(p[0]+2785.41)<.2&&Math.abs(p[1]-175.89)<.2)];
 let[start,end]=locate();if(start<0||end<0)return ps.map(p=>[...p]);
 // The processed OSM ring has the opposite winding to the reference ring.
 // Normalize the traversal before replacing the same physical corner.
 if(start>end){ring.reverse();[start,end]=locate();}
 const a=ring[start],b=ring[end],cx=b[0],cz=a[1],rx=cx-a[0],rz=cz-b[1];
 const arc=Array.from({length:33},(_,i)=>{const t=Math.PI+i/32*Math.PI/2;return[cx+rx*Math.cos(t),cz+rz*Math.sin(t)]});
 const out=[...ring.slice(0,start),...arc,...ring.slice(end+1)];return[...out,[...out[0]]];
}
