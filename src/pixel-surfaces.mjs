import * as THREE from 'three';

// Original pixel art. World patterns describe metres, not stretched object UVs.
// Signs retain their separate readable typography; photographed geometry is unchanged.
const SPECS = {
  paving: [128, 8], grass: [128, 8], leaf: [64, 4], bark: [32, 2],
  asphalt: [64, 4], glass: [128, 16], stone: [128, 16],
  cloth: [32, 1], hair: [32, 1], leather: [16, .5], skin: [32, 1],
};
const hash = (x,y) => { let n = Math.imul(x+19,374761393)^Math.imul(y+43,668265263); n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; };
const rgb = hex => [(hex>>16)&255,(hex>>8)&255,hex&255];
const palettes = {
  grass: [0x608d4d,0x629151,0x5e8b4b,0x649252],
  leaf: [0x42783d,0x467e41,0x4e8645,0x3e7138,0x538b49],
};
export function surfacePixels(kind) {
  if (!SPECS[kind]) throw new RangeError(`Unknown pixel surface: ${kind}`);
  const [size, repeatMetres] = SPECS[kind], data = new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    let c;
    if(kind==='grass'||kind==='leaf') {
      const cluster=4, p=palettes[kind];
      c=rgb(p[Math.floor(hash(Math.floor(x/cluster),Math.floor(y/cluster))*p.length)]);
      const relief=kind==='leaf'?(x%cluster===0?-6:y%cluster===0?5:0):((x+3*y)%29===0?3:0);
      c=c.map(v=>v+relief);
    } else if(kind==='paving') {
      const joint=x%16===0||y%16===0, bevel=x%16===1||y%16===1;
      const tone=Math.floor(hash(Math.floor(x/16),Math.floor(y/16))*4);
      c=joint?[148,161,160]:bevel?[190+tone,199+tone,193+tone]:[172+tone,182+tone,177+tone];
    } else if(kind==='bark') {
      const groove=(x+Math.floor(y/9))%9===0, highlight=(x+2)%9===0;
      c=groove?[96,76,56]:highlight?[139,113,78]:[124,99,69];
    } else if(kind==='asphalt') {
      const v=hash(Math.floor(x/2),Math.floor(y/2))>.78?3:0;c=[91+v,105+v,111+v];
    } else if(kind==='glass'||kind==='stone') {
      const row=y%32, column=x%16, band=row<4, mullion=column===0;
      if(kind==='glass') {
        const reflection=row<17?7:0;
        c=band?[169,198,201]:mullion?[154,188,194]:[73+reflection,127+reflection,149+reflection];
        if(!band&&!mullion&&column>11)c=[89,147,164];
      } else c=band?[222,222,211]:mullion?[213,217,208]:[104,141,148];
    } else {
      // Tintable cloth/hair/skin: quiet painted clusters instead of white noise.
      let v=kind==='cloth'?246:kind==='hair'?235:kind==='leather'?239:253;
      if(kind==='cloth')v-=Math.floor(hash(Math.floor(x/4),Math.floor(y/8))*6);
      if(kind==='hair')v-=x%7===0?18:Math.floor(hash(Math.floor(x/3),Math.floor(y/12))*8);
      if(kind==='leather')v-=(x%8===0||y%8===0)?14:0;
      if(kind==='skin')v-=y>size*.72?4:0;
      c=[v,v,v];
    }
    const i=(y*size+x)*4;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];data[i+3]=255;
  }
  return {data,size,repeatMetres};
}

export function createPixelPalette({anisotropy=1}={}) {
  const textures=new Map();
  return {
    texture(kind) {
      if(!textures.has(kind)) {
        const {data,size,repeatMetres}=surfacePixels(kind);
        const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
        t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.NearestFilter;
        t.minFilter=THREE.NearestMipmapLinearFilter;t.generateMipmaps=true;
        t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=anisotropy;
        t.userData={pixelSurface:kind,repeatMetres,sharedSurface:true};t.needsUpdate=true;
        textures.set(kind,t);
      }
      return textures.get(kind);
    },
    dispose(){for(const t of textures.values())t.dispose();textures.clear();},
    evidence(){return [...textures].map(([kind,t])=>({kind,size:t.image.width,repeatMetres:t.userData.repeatMetres,texelsPerMetre:t.image.width/t.userData.repeatMetres}));},
  };
}

export function boxSurfaceUV(geometry,repeatMetres) {
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++) {
    uv[i*2]=(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/repeatMetres;
    uv[i*2+1]=(Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/repeatMetres;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}

// BoxGeometry's unit face UVs, scaled with the actual dimensions of each instance.
// This is the only shader adaptation: standard Lambert lighting/map/color output remain.
export function useInstancedSurfaceUV(material,repeatMetres) {
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec3 instancePartSize;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      #ifdef USE_MAP
        vec2 faceSize=abs(normal.x)>.5?instancePartSize.zy:(abs(normal.y)>.5?instancePartSize.xz:instancePartSize.xy);
        vec2 facePosition=abs(normal.x)>.5?position.zy:(abs(normal.y)>.5?position.xz:position.xy);
        vMapUv=facePosition*faceSize/${Number(repeatMetres).toFixed(6)};
      #endif`);
  };
  material.customProgramCacheKey=()=>`city-part-uv-${repeatMetres}`;
  return material;
}
