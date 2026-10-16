import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{heiwadoFascias}from'../src/wuyi-site.mjs';
const chunk=JSON.parse(readFileSync(new URL('../data/chunks/-3_0.json',import.meta.url),'utf8')),ps=chunk.buildings.find(b=>String(b.id)==='52072595').polygon;
test('Heiwado screen attaches to actual north facade rather than a raw-way vertex index',()=>{const e=heiwadoFascias(ps).north;assert.ok(e.mz<180);assert.ok(e.mx> -2780);assert.ok(e.nz< -.9);assert.ok(e.length>29);});
test('Reversing an OSM ring does not send facade signs inside the building',()=>{for(const key of['north','corner']){const a=heiwadoFascias(ps)[key],b=heiwadoFascias([...ps].reverse())[key];assert.ok(Math.abs(a.mx-b.mx)<1e-8);assert.ok(Math.abs(a.mz-b.mz)<1e-8);assert.ok(Math.abs(a.nx-b.nx)<1e-8);assert.ok(Math.abs(a.nz-b.nz)<1e-8);}});

import * as THREE from 'three';
import {smoothHeiwadoArcNormals}from'../src/wuyi.mjs';
test('rounded podium normals follow the ellipse while roof normals remain vertical',()=>{const ps=[],ns=[];for(const t of[Math.PI,Math.PI*1.25,Math.PI*1.5]){ps.push(-2785.41+46.26*Math.cos(t),20,214.67+38.78*Math.sin(t));ns.push(0,0,1);}ps.push(-2818.12,40,187.25);ns.push(0,1,0);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(ns,3));smoothHeiwadoArcNormals(g);const n=g.attributes.normal;assert.ok(n.getX(0)<-.999);assert.ok(n.getZ(2)<-.999);assert.ok(n.getX(1)<-.5&&n.getZ(1)<-.5);assert.equal(n.getY(3),1);g.dispose();});
