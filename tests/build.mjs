import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(await readFile('data/world-manifest.json','utf8'));
const files=['index.html','styles.css','src/app.mjs','src/world.mjs','src/geo.mjs','src/routes.mjs','src/landmarks.mjs','src/wuyi.mjs','src/wuyi-data.mjs','data/pois.json','data/pois.csv','data/sources.json','data/world-manifest.json','data/graph.json','data/map.json','data/data-report.json',...Object.values(manifest.chunks)];
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const path of files){const source=await readFile(path),built=await readFile('dist/'+path);assert.equal(hash(source),hash(built),'Build copy differs: '+path);}
for(const path of ['three.module.js','three.core.js'])assert.equal(hash(await readFile('node_modules/three/build/'+path)),hash(await readFile('dist/vendor/three/'+path)));
assert.equal(hash(await readFile('node_modules/three/LICENSE')),hash(await readFile('dist/vendor/three/LICENSE')));
await writeFile('artifacts/build-check.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,comparedFiles:files.length+3,terrainChunks:Object.keys(manifest.chunks).length,method:'source/build SHA-256 equality for all runtime assets and every chunk; Three.js and license included'},null,2));
console.log('PASS: all '+(files.length+3)+' build files match source, including '+Object.keys(manifest.chunks).length+' geographical chunks');
