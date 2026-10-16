import * as THREE from 'three';

// One authored light palette for exploring and photographs, in linear working space.
// Values are art direction choices, not measured illumination of Changsha.
export const CITY_LIGHTING = {
  day: {top:0x5d9ecc,horizon:0xd0e6ed,bottom:0xc3d1cf,skyLight:0xe6f0ff,groundLight:0xbac5c8,hemi:2.25,fill:.4,key:2.1,keyColor:0xffefd9},
  sunset: {top:0x718dba,horizon:0xf0bc96,bottom:0xb8afb7,skyLight:0xd5ddf5,groundLight:0xab9cab,hemi:1.8,fill:.45,key:1.8,keyColor:0xffc58e},
  night: {top:0x0f1930,horizon:0x344a69,bottom:0x253044,skyLight:0x9aafd7,groundLight:0x5d6d8a,hemi:.8,fill:.15,key:.18,keyColor:0xb4caff},
};
const SUN_OFFSET=new THREE.Vector3(-100,180,70);
const lightRight=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),SUN_OFFSET).normalize();
const lightUp=new THREE.Vector3().crossVectors(SUN_OFFSET,lightRight).normalize();
export function snapShadowTarget(position,shadow,out=new THREE.Vector3()) {
  out.copy(position);
  const dx=(shadow.camera.right-shadow.camera.left)/shadow.mapSize.x;
  const dy=(shadow.camera.top-shadow.camera.bottom)/shadow.mapSize.y;
  const x=out.dot(lightRight),y=out.dot(lightUp);
  out.addScaledVector(lightRight,Math.round(x/dx)*dx-x);
  out.addScaledVector(lightUp,Math.round(y/dy)*dy-y);
  return out;
}

export function createCityLighting(scene,sun) {
  const hemi=new THREE.HemisphereLight(),fill=new THREE.AmbientLight(0xffffff);
  scene.add(hemi,fill,sun.target);
  const target=new THREE.Vector3();
  const skyMaterial=new THREE.ShaderMaterial({
    uniforms:{top:{value:new THREE.Color()},horizon:{value:new THREE.Color()},bottom:{value:new THREE.Color()}},
    vertexShader:`varying vec3 vSkyDirection;
      void main(){vec4 world=modelMatrix*vec4(position,1.0);vSkyDirection=world.xyz-cameraPosition;
      gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`varying vec3 vSkyDirection;uniform vec3 top;uniform vec3 horizon;uniform vec3 bottom;
      void main(){float h=normalize(vSkyDirection).y;
      vec3 c=h>=0.0?mix(horizon,top,pow(h,.55)):mix(horizon,bottom,min(1.0,-h*2.0));
      gl_FragColor=vec4(c,1.0);
      #include <colorspace_fragment>
      }`,
    side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false,
  });
  const sky=new THREE.Mesh(new THREE.SphereGeometry(5000,24,12),skyMaterial);
  sky.name='city-sky';sky.frustumCulled=false;sky.renderOrder=-100;scene.add(sky);
  let mode='day';
  function setTime(value) {
    if(!CITY_LIGHTING[value])return;
    mode=value;const p=CITY_LIGHTING[mode];
    hemi.color.setHex(p.skyLight);hemi.groundColor.setHex(p.groundLight);hemi.intensity=p.hemi;fill.intensity=p.fill;
    sun.color.setHex(p.keyColor);sun.intensity=p.key;
    for(const k of ['top','horizon','bottom'])skyMaterial.uniforms[k].value.setHex(p[k]);
    scene.background.setHex(p.horizon);scene.fog.color.setHex(p.horizon);
  }
  setTime(mode);
  return {setTime,update(camera,player,originX=0,originZ=0){
      sky.position.copy(camera.position);
      if(player){target.set(player.x,player.groundY,player.z);snapShadowTarget(target,sun.shadow,target);
        target.x-=originX;target.z-=originZ;sun.target.position.copy(target);sun.position.copy(target).add(SUN_OFFSET);}
    },evidence(){return{mode,...CITY_LIGHTING[mode],workingSpace:'Linear-sRGB',outputSpace:'sRGB',style:'authored gradient sky and shared Lambert lighting',shadowTexelMetres:(sun.shadow.camera.right-sun.shadow.camera.left)/sun.shadow.mapSize.x,shadowAlignment:'absolute-world light-space texel grid'};},
    dispose(){scene.remove(sky,hemi,fill);sky.geometry.dispose();skyMaterial.dispose();}};
}
