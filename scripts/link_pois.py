"""Join source-backed attraction names to OSM candidates, preserving unmatched/null positions."""
from pathlib import Path
import json, re, math, csv
ROOT=Path(__file__).resolve().parents[1]
def read(name):return json.loads((ROOT/'data'/name).read_text(encoding='utf-8'))
def write(name,value):(ROOT/'data'/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def eligible_geocode(q):
    tags=q.get('tags',{})
    if q.get('inChangshaBoundary') is False:return False
    if tags.get('highway') in {'bus_stop','motorway_junction'} or tags.get('railway') or tags.get('public_transport'):return False
    if tags.get('place') and not (tags.get('tourism') or tags.get('historic') or tags.get('leisure')):return False
    return True
def normalized(name):
    name=re.sub(r'[\s·—\-（）()、]','',name)
    # Administrative prefixes are part of the identity of these institutions:
    # 湖南省博物馆 and 长沙博物馆 are different museums.
    institutional={'湖南省博物馆':'湖南博物院','湖南博物馆':'湖南博物院','湖南博物院':'湖南博物院','长沙市博物馆':'长沙博物馆','长沙博物馆':'长沙博物馆','湖南省森林植物园':'湖南省植物园','湖南省植物园':'湖南省植物园','浏阳文庙':'浏阳文庙','长沙文庙':'长沙文庙'}
    lookup=name.removeprefix('长沙市') if name.startswith(('长沙市湖南','长沙市浏阳')) else name
    if lookup in institutional:return institutional[lookup]
    for prefix in ['长沙市','长沙县','长沙','浏阳市','浏阳','宁乡市','宁乡','湖南省','湖南','新华联','国家']:
        name=name.replace(prefix,'')
    for suffix in ['风景名胜区','国家森林公园','森林公园','生态旅游区','文化旅游区','旅游景区','风景区','旅游区','景区']:
        name=name.replace(suffix,'')
    return name
ALIASES={'湖南省森林植物园':['湖南省植物园','湖南省森林植物园'],'湖南博物院':['湖南省博物馆','湖南博物院'],'长沙市浏阳苍坊旅游区':['胡耀邦故居','胡耀邦故里','苍坊旅游区'],'长沙市清水塘景区':['清水塘','清水塘景区','中共湘区委员会旧址'],'花明楼':['刘少奇故居','花明楼景区'],'岳麓山—橘子洲旅游区':['岳麓山'],'长沙市岳麓山—橘子洲旅游区':['岳麓山']}
def point_in_ring(x,z,ring):
    inside=False;j=len(ring)-1
    for i,(xi,zi) in enumerate(ring):
        xj,zj=ring[j]
        if (zi>z)!=(zj>z) and x<(xj-xi)*(z-zi)/(zj-zi)+xi:inside=not inside
        j=i
    return inside
def main():
    data=read('pois.json');records=data['records'];raw=read('poi-positions.json');candidates=raw if isinstance(raw,list) else raw.get('places',raw.get('records',[]))
    extra=read('extra-geocodes.json').get('records',[]) if (ROOT/'data/extra-geocodes.json').exists() else []
    candidates.extend({**q,'geocodingOnly':True} for q in extra if eligible_geocode(q))
    # Official scenic sites can share a name with a tagged hotel/resort or named building.
    # These are geocoding candidates only, never automatic new tourist attractions.
    known_names={normalized(name) for p in records for name in [p['name'],*(p.get('aliases') or []),*ALIASES.get(p['name'],[])]}
    geography=json.loads((ROOT/'data/raw/changsha-world.osm.json').read_text(encoding='utf-8'))
    for w in geography.get('ways',[]):
        name=w.get('tags',{}).get('name','')
        if name and normalized(name) in known_names and w.get('nodes'):
            coords=w['nodes'];lon=sum(p[1] for p in coords)/len(coords);lat=sum(p[2] for p in coords)/len(coords)
            candidates.append({'name':name,'lon':lon,'lat':lat,'osmType':'way','osmId':w['id'],'tags':w.get('tags',{}),'geocodingOnly':True})
    manifest=read('world-manifest.json');origin=manifest['origin'];boundary=read('map.json')['boundary']
    def project(lon,lat):return (math.radians(lon-origin['lon'])*6371008.8*math.cos(math.radians(origin['lat'])),-math.radians(lat-origin['lat'])*6371008.8)
    candidates=[q for q in candidates if q.get('lon') is not None and q.get('lat') is not None and any(point_in_ring(*project(q['lon'],q['lat']),ring) for ring in boundary)]
    index={}
    for p in candidates:
        if not eligible_geocode(p):continue
        tags=p.get('tags',{});names=[p.get('name',''),tags.get('name:zh',''),tags.get('alt_name',''),tags.get('old_name','')]
        for name in names:
            for variant in name.split(';'):
                key=normalized(variant)
                if len(key)>1:index.setdefault(key,[]).append(p)
    matches=[];unmatched=[]
    known={normalized(name) for p in records for name in [p['name'],*(p.get('aliases') or [])]}
    supplemental=0
    for q in candidates:
        name=q.get('name','').strip();tags=q.get('tags',{});key=normalized(name)
        tourism=tags.get('tourism');historic=tags.get('historic');park=tags.get('leisure')=='park'
        if q.get('geocodingOnly') or len(key)<2 or key in known or not (tourism in ['attraction','museum','gallery','viewpoint','theme_park','zoo'] or historic or park):continue
        if tourism in ['hotel','guest_house','hostel','motel']:continue
        kind='博物馆' if tourism in ['museum','gallery'] else '公园' if park else '历史文化' if historic else '城市游览'
        records.append({'id':f'osm-{q.get("osmType","node")}-{q.get("osmId",q.get("id"))}','name':name,'aliases':[],'district':q.get('district') or tags.get('addr:district') or None,'category':kind,'grade':None,'sourceIds':['osm-geofabrik-20261014'],'position':None,'world':None,'model':None,'status':'public-map-candidate','parentId':None,'scopeStatus':'OSM公开游览对象补充，纳入与入口待逐项审校'})
        known.add(key);supplemental+=1
    for p in records:
        p['position']=None;p['world']=None;p['locationStatus']='unlocated'
        names=[p['name'],*(p.get('aliases') or []),*ALIASES.get(p['name'],[])]
        found=[q for q in candidates if q.get('matchedPoiId')==p['id'] and eligible_geocode(q)]
        for name in names:found.extend(index.get(normalized(name),[]))
        unique={}
        for q in found:unique.setdefault(str(q.get('osmType',''))+str(q.get('osmId',q.get('id',''))),q)
        found=list(unique.values())
        # A supplemental OSM object already has an exact object identity.
        identities={p['id'],*(p.get('mergedCandidateIds') or [])}
        own=[q for q in found if f'osm-{q.get("osmType")}-{q.get("osmId",q.get("id"))}' in identities]
        if own:found=own
        # Distant same-name objects require a human decision, not a guessed marker.
        if not own and found and any(math.hypot((q['lon']-found[0]['lon'])*98000,(q['lat']-found[0]['lat'])*111195)>1500 for q in found):
            p['locationStatus']='ambiguous-name';unmatched.append(p['id']);continue
        if not found:
            unmatched.append(p['id']);continue
        # Favor explicit tourist/historic features over incidental names. No substring geocoding.
        found.sort(key=lambda q: (not bool(q.get('tags',{}).get('tourism') or q.get('tags',{}).get('historic')),q.get('osmType')!='node'))
        q=found[0];lon=q.get('lon',q.get('position',{}).get('lon'));lat=q.get('lat',q.get('position',{}).get('lat'))
        if lon is None or lat is None:unmatched.append(p['id']);continue
        x=math.radians(lon-origin['lon'])*6371008.8*math.cos(math.radians(origin['lat']));z=-math.radians(lat-origin['lat'])*6371008.8
        p['position']={'lon':lon,'lat':lat,'source':f'https://www.openstreetmap.org/{q.get("osmType","node")}/{q.get("osmId",q.get("id"))}','accuracy':'OSM命名对象位置，真实游览入口待逐项核验','crs':'WGS84','coordinateMethod':q.get('coordinateMethod','osm-object-representative-point'),'osmType':q.get('osmType'),'osmId':q.get('osmId',q.get('id')),'osmTags':q.get('tags',{}),'inChangshaBoundary':True}
        if q.get('aliasEvidence'):p['position']['aliasEvidence']=q['aliasEvidence']
        p['world']={'x':round(x,3),'y':0,'z':round(z,3)};p['locationStatus']='osm-name-matched';p['modelStatus']='unverified-graybox';p['sourceIds']=list(dict.fromkeys([*(p.get('sourceIds') or []),'osm-geofabrik-20261014']))
        matches.append({'poiId':p['id'],'poiName':p['name'],'osmName':q.get('name'),'osmType':q.get('osmType'),'osmId':q.get('osmId'),'candidateCount':len(found)})
    canonical={}
    for p in records:
        if p.get('status')!='public-map-candidate' and p.get('position'):canonical.setdefault(p['position']['source'],p)
    retained=[];merged=[]
    for p in records:
        same=canonical.get((p.get('position') or {}).get('source'))
        if p.get('status')=='public-map-candidate' and same:
            same['mergedCandidateIds']=list(dict.fromkeys([*(same.get('mergedCandidateIds') or []),p['id']]))
            same['aliases']=list(dict.fromkeys([*(same.get('aliases') or []),p['name']]))
            merged.append(p['id'])
        else:retained.append(p)
    records=retained;data['records']=records
    matches=[m for m in matches if m['poiId'] not in merged];unmatched=[i for i in unmatched if i not in merged]
    supplemental_total=sum(p.get('status')=='public-map-candidate' for p in records)
    data['geocoding']={'method':'normalized exact name or explicit alias, OSM named object; not verified entrance','matched':len(matches),'unmatched':len(unmatched),'reviewRequired':True,'osmSupplementalCandidates':supplemental_total,'addedThisRun':supplemental}
    data['counts'].update({'records':len(records),'coordinatesAssigned':len(matches),'worldPositionsAssigned':len(matches),'osmSupplementalCandidates':supplemental_total})
    data['sourceCoverage']['geography']={'positionAndWorldAreNull':False,'matched':len(matches),'unmatched':len(unmatched),'status':'公开OSM命名对象匹配；入口、行政归属、步行权限与候选纳入仍需逐项审校。未匹配记录不放置猜测坐标。'}
    write('pois.json',data);write('poi-position-matches.json',{'matches':matches,'unmatched':unmatched,'mergedSupplementalIds':merged})
    with (ROOT/'data/pois.csv').open(encoding='utf-8-sig',newline='') as f:
        existing=list(csv.DictReader(f));fields=list(existing[0]) if existing else ['id','name','district','category','grade','sourceIds']
    old={p['id']:p for p in existing}
    fields=list(dict.fromkeys([*fields,'lon','lat','locationStatus','modelStatus','positionSource','districtCandidate','mergedCandidateIds']))
    with (ROOT/'data/pois.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for p in records:
            def cell(k):
                value=p[k] if k in p else old.get(p['id'],{}).get(k,'')
                if value is None:return ''
                if isinstance(value,list):return ';'.join(str(v) for v in value)
                if isinstance(value,dict):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
                return value
            row={k:cell(k) for k in fields}
            row.update({'lon':(p.get('position') or {}).get('lon',''),'lat':(p.get('position') or {}).get('lat',''),'positionSource':(p.get('position') or {}).get('source',''),'locationStatus':p.get('locationStatus','unlocated'),'modelStatus':p.get('modelStatus','not-started')});writer.writerow(row)
    source_data=read('sources.json');source_list=source_data['sources']
    if not any(s['id']=='osm-geofabrik-20261014' for s in source_list):
        source_list.append({'id':'osm-geofabrik-20261014','title':'Geofabrik湖南OSM快照裁剪长沙公开游览对象','url':'https://download.geofabrik.de/asia/china/hunan.html','license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','retrievedAt':'2026-10-14','raw':'data/raw/hunan-latest.osm.pbf','limits':'公开地图对象位置与名称候选；非官方景区等级或入口核实证明'})
    write('sources.json',source_data)
    print(json.dumps(data['geocoding'],ensure_ascii=False))
if __name__=='__main__':main()
