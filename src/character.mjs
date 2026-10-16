import * as THREE from 'three';
import {createPixelPalette,boxSurfaceUV} from './pixel-surfaces.mjs';

export const CHARACTER_PART_BUDGET = 48;
export const CHARACTER_SURFACE_PART_LIMITS = {cloth:15,skin:5,flat:7,hair:7,leather:3};
const PERSON_SCALE=.9;

const SKINS = [0xd9aa84, 0xe8c09c, 0xb98262];
const TROUSERS = [0x35475b, 0x4c4d48, 0x53644e];
const HAIR = [0x302923, 0x4b332a, 0x65452f];
const EYE_WHITE = 0xf4ead8;
const EYE_INK = 0x28292b;
const SHOE = 0x24272a;

function material(color,kind,surfaces) {
  const m=new THREE.MeshLambertMaterial({color,map:kind?surfaces.texture(kind):null});
  m.userData.pixelSurface=kind||'flat';return m;
}

function box(parent, name, width, height, depth, x, y, z, mat) {
  const geometry=new THREE.BoxGeometry(width,height,depth);
  if(mat.map)boxSurfaceUV(geometry,mat.map.userData.repeatMetres/PERSON_SCALE);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addHair(root, style, mat) {
  // The face points toward local -Z. Every style keeps a broad cap and a
  // readable silhouette when viewed from the back-follow camera.
  box(root, 'hair-cap', 0.64, 0.19, 0.57, 0, 2.045, 0.015, mat);
  if (style === 0) {
    box(root, 'hair-fringe', 0.40, 0.13, 0.085, -0.035, 1.985, -0.292, mat);
    for (const side of [-1, 1]) {
      box(root, 'hair-temple', 0.095, 0.25, 0.48, side * 0.272, 1.855, 0.005, mat);
    }
  } else if (style === 1) {
    box(root, 'hair-fringe', 0.49, 0.14, 0.09, 0.03, 1.985, -0.295, mat);
    box(root, 'hair-back', 0.59, 0.34, 0.12, 0, 1.765, 0.29, mat);
    for (const side of [-1, 1]) {
      box(root, 'hair-long-side', 0.12, 0.37, 0.48, side * 0.268, 1.785, 0.01, mat);
    }
    box(root, 'hair-tie', 0.15, 0.12, 0.15, 0.045, 1.79, 0.385, mat);
    box(root, 'hair-tail', 0.17, 0.25, 0.16, 0.045, 1.59, 0.385, mat);
  } else {
    box(root, 'hair-swept-fringe', 0.42, 0.17, 0.10, -0.07, 1.99, -0.296, mat);
    box(root, 'hair-swept-lock', 0.20, 0.23, 0.12, 0.145, 1.91, -0.282, mat);
    box(root, 'hair-side-part', 0.21, 0.10, 0.55, 0.145, 2.13, 0.015, mat);
    box(root, 'hair-back', 0.58, 0.20, 0.11, 0, 1.80, 0.30, mat);
    for (const side of [-1, 1]) {
      box(root, 'hair-temple', 0.09, 0.22, 0.47, side * 0.272, 1.87, 0.005, mat);
    }
  }
}

/** Create an original block-style person with feet on y=0 and face toward -Z. */
export function makeBlockPerson(isNpc = false, color = 0x4d88b2, variant = 0, {surfaces=createPixelPalette()} = {}) {
  const style = ((Math.trunc(Number(variant) || 0) % 3) + 3) % 3;
  const shirtColor = new THREE.Color(color);
  const shirt = material(shirtColor,'cloth',surfaces);
  const skin = material(SKINS[style],'skin',surfaces);
  const trousers = material(TROUSERS[style],'cloth',surfaces);
  const hair = material(HAIR[style],'hair',surfaces);
  const trimColor = shirtColor.clone().getHSL({}).l < 0.42
    ? shirtColor.clone().lerp(new THREE.Color(0xffffff), 0.52)
    : shirtColor.clone().lerp(new THREE.Color(0x20242a), 0.34);
  const trim = material(trimColor,'cloth',surfaces);
  const eyeWhite = material(EYE_WHITE,null,surfaces);
  const ink = material(EYE_INK,null,surfaces);
  const shoe = material(SHOE,'leather',surfaces);
  const root = new THREE.Group();
  root.name = isNpc ? 'block-person-npc' : 'block-person-player';

  // Wide shoulders and a full-height torso keep the head/body ratio balanced.
  box(root, 'shirt-body', 0.72, 0.72, 0.41, 0, 1.12, 0, shirt);
  box(root, 'neck', 0.23, 0.19, 0.23, 0, 1.535, 0, skin);
  box(root, 'shirt-collar', 0.32, 0.10, 0.42, 0, 1.475, -0.015, trim);
  box(root, 'shirt-placket', 0.075, 0.44, 0.028, 0, 1.13, -0.222, trim);
  box(root, 'shirt-button', 0.035, 0.035, 0.022, 0, 1.12, -0.244, eyeWhite);
  box(root, 'shirt-pocket', 0.15, 0.16, 0.035, -0.225, 1.28, -0.225, trim);

  // Broad square head, with a small nose and clear eyes on the -Z face.
  box(root, 'head', 0.58, 0.56, 0.51, 0, 1.79, 0, skin);
  for (const side of [-1, 1]) {
    box(root, 'eye-white', 0.095, 0.075, 0.026, side * 0.135, 1.825, -0.269, eyeWhite);
    box(root, 'eye-pupil', 0.046, 0.056, 0.022, side * 0.135, 1.82, -0.293, ink);
  }
  box(root, 'nose', 0.075, 0.09, 0.08, 0, 1.735, -0.294, skin);
  box(root, 'mouth', 0.105, 0.027, 0.025, 0, 1.655, -0.27, ink);
  addHair(root, style, hair);

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.405, 1.40, 0);
    root.add(arm);
    box(arm, 'sleeve', 0.29, 0.62, 0.36, 0, -0.28, 0, shirt);
    box(arm, 'sleeve-cuff', 0.295, 0.075, 0.37, 0, -0.60, 0, trim);
    box(arm, 'hand', 0.18, 0.17, 0.21, 0, -0.72, -0.012, skin);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.name = side < 0 ? 'leg-left' : 'leg-right';
    leg.position.set(side * 0.18, 0.70, 0);
    root.add(leg);
    box(leg, 'trouser-leg', 0.29, 0.63, 0.32, 0, -0.31, 0, trousers);
    box(leg, 'trouser-cuff', 0.30, 0.07, 0.33, 0, -0.605, 0, trim);
    box(leg, 'shoe', 0.32, 0.15, 0.44, 0, -0.635, -0.035, shoe);
    legs.push(leg);
  }

  // An original travel silhouette; the camera is only shown when taking a photo.
  if (!isNpc || style === 1) {
    box(root, 'travel-bag', .49, .53, .18, 0, 1.13, .29, trim);
    box(root, 'bag-pocket', .35, .20, .045, 0, 1.0, .40, shirt);
  }
  const cameraProp = new THREE.Group(); cameraProp.name = 'travel-camera';
  cameraProp.position.set(0, -.55, -.17); arms[0].add(cameraProp);
  const cameraParts = [
    box(cameraProp, 'camera-body', .31, .21, .12, 0, 0, 0, shoe),
    box(cameraProp, 'camera-lens', .12, .12, .08, 0, 0, -.09, ink),
    box(cameraProp, 'camera-glass', .075, .075, .012, 0, 0, -.137, trim),
  ];
  for (const part of cameraParts) part.userData.renderEnabled = false;
  cameraProp.visible = false;
  root.scale.setScalar(PERSON_SCALE);
  function pose({mode='idle',phase=0,speed=0,run=false,dt=0}={}) {
    const blend=dt>0?1-Math.exp(-18*dt):1;
    const walking=mode==='walk', photographing=mode==='photo'||mode==='selfie';
    const swing=walking?Math.sin(phase)*(run?.55:.36):0;
    for(let i=0;i<2;i++) {
      const wave=mode==='selfie'&&i===1;
      const ax=photographing&&i===0?1.08:(walking?(i?-swing:swing):0);
      const az=wave?2.35+Math.sin(phase*2)*.10:0;
      arms[i].rotation.x+=(ax-arms[i].rotation.x)*blend;
      arms[i].rotation.z+=(az-arms[i].rotation.z)*blend;
      legs[i].rotation.x+=((walking?swing*(i?1:-1):0)-legs[i].rotation.x)*blend;
    }
    cameraProp.visible=photographing;
    cameraProp.rotation.x=-arms[0].rotation.x;
    for(const part of cameraParts)part.userData.renderEnabled=photographing;
    root.userData.pose=mode;root.userData.speed=speed;
  }
  return { root, arms, legs, pose };
}
