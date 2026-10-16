// Frame-rate independent control response; geographic positions remain metres.
export const MOVE_SPEED=8, RUN_SPEED=16;
export function dampAngle(current,target,dt,rate=12){const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+delta*(1-Math.exp(-rate*Math.max(0,dt)));}
export function dampVelocity(current,target,dt){const rate=Math.hypot(target.x,target.z)>.001?12:30,t=1-Math.exp(-rate*Math.max(0,dt));const v={x:current.x+(target.x-current.x)*t,z:current.z+(target.z-current.z)*t};if(Math.hypot(v.x,v.z)<.015)return{x:0,z:0};return v;}
export function bodyHeading(vx,vz){return Math.atan2(-vx,-vz);}
