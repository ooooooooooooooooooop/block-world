from pathlib import Path
import requests, json, hashlib, time
target=Path(__file__).resolve().parents[1]/'data/raw/hunan-latest.osm.pbf'
url='https://download.geofabrik.de/asia/china/hunan-latest.osm.pbf'
if not target.exists():
    r=requests.get(url,stream=True,timeout=(30,120),headers={'User-Agent':'BlockChangsha/0.1 local development'})
    r.raise_for_status()
    count=0
    with target.with_suffix('.part').open('wb') as f:
        for block in r.iter_content(1024*1024):
            f.write(block);count+=len(block)
            if count//(10*1024*1024)!=(count-len(block))//(10*1024*1024):print(f'DOWNLOADED {count/1024/1024:.1f} MiB',flush=True)
    target.with_suffix('.part').replace(target)
    meta={'url':url,'retrievedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'lastModified':r.headers.get('Last-Modified'),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors / Geofabrik','sourcePage':'https://download.geofabrik.de/asia/china/hunan.html'}
    target.with_suffix('.source.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'REGIONAL DATA READY {target.stat().st_size} bytes',flush=True)
