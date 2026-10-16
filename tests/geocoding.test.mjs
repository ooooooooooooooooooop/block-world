import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('景点定位保留机构身份并排除同名交通站点和外地对象',()=>{
 const code=`from scripts.link_pois import normalized,eligible_geocode
assert normalized('湖南省博物馆') == normalized('湖南博物院')
assert normalized('湖南省博物馆') != normalized('长沙博物馆')
assert normalized('浏阳文庙') != normalized('长沙文庙')
assert not eligible_geocode({'tags':{'name':'清水塘','highway':'bus_stop'}})
assert not eligible_geocode({'tags':{'name':'洋湖湿地','railway':'station'}})
assert not eligible_geocode({'tags':{'name':'石牛寨','natural':'peak'},'inChangshaBoundary':False})
assert not eligible_geocode({'tags':{'name':'关山','place':'village'}})
assert eligible_geocode({'tags':{'name':'影珠山','natural':'peak'},'inChangshaBoundary':True})
`;
 const run=spawnSync('python',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
});
test('CSV与JSON景点台账的身份、来源和坐标一致',()=>{
 const code=`import csv,json
from pathlib import Path
data=json.loads(Path('data/pois.json').read_text(encoding='utf-8'))['records']
with Path('data/pois.csv').open(encoding='utf-8-sig',newline='') as f: rows={r['id']:r for r in csv.DictReader(f)}
assert set(rows)=={p['id'] for p in data}
for p in data:
 r=rows[p['id']]
 assert r['name']==p['name']
 assert r['sourceIds'].split(';')==p['sourceIds']
 assert (json.loads(r['position']) if r['position'] else None)==p['position']
 assert (json.loads(r['world']) if r['world'] else None)==p['world']
 assert r['positionSource']==(p['position'] or {}).get('source','')
`;
 const run=spawnSync('python',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
});
