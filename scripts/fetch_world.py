"""Fetch a reproducible Changsha OSM snapshot and public DEM tiles. No invented geography."""
from pathlib import Path
import argparse, hashlib, json, math, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
HEADERS = {'User-Agent': 'BlockChangsha/0.1 local-city-research (OSM attribution included)'}
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def query(text, path):
    if path.exists():
        value = json.loads(path.read_text(encoding='utf-8'))
        if value.get('elements') and not value.get('remark'):
            print(f'CACHE {path.name}: {len(value["elements"])} elements', flush=True)
            return value
    errors = []
    for endpoint in ENDPOINTS:
        try:
            print(f'QUERY {endpoint}: {path.name}', flush=True)
            response = requests.get(endpoint, params={'data': text}, headers=HEADERS, timeout=260)
            response.raise_for_status()
            value = response.json()
            if value.get('remark'):
                raise RuntimeError(value['remark'])
            if not value.get('elements'):
                raise RuntimeError('Empty result; refusing to label empty city as complete')
            save_json(path, value)
            save_json(path.with_suffix('.source.json'), {'endpoint': endpoint, 'query': text,
                'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'bytes': path.stat().st_size, 'license': 'ODbL-1.0',
                'url': 'https://www.openstreetmap.org/copyright'})
            print(f'SAVED {path.name}: {len(value["elements"])} elements, {path.stat().st_size} bytes', flush=True)
            return value
        except Exception as exc:
            errors.append(f'{endpoint}: {exc}')
            print(errors[-1], flush=True)
    raise RuntimeError('\n'.join(errors))

def tile_xy(lon, lat, zoom):
    n = 2 ** zoom
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

def fetch_tile(tile):
    zoom, x, y = tile
    target = RAW / 'terrain' / str(zoom) / str(x) / f'{y}.png'
    if target.exists():
        return target
    url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png'
    response = requests.get(url, headers=HEADERS, timeout=45)
    response.raise_for_status()
    if not response.content.startswith(b'\x89PNG'):
        raise RuntimeError(f'Not a PNG: {url}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return target

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--terrain-only', action='store_true')
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    boundary = query('[out:json][timeout:90];relation(27.5,111.4,29.3,114.6)["name"="长沙市"]["boundary"="administrative"];out body geom;', RAW / 'changsha-boundary.osm.json')
    relation = next(e for e in boundary['elements'] if e['type'] == 'relation' and e.get('tags', {}).get('admin_level') == '6')
    area = 3600000000 + relation['id']
    b = relation['bounds']
    print(f'CITY relation={relation["id"]} bounds={b}', flush=True)
    if not args.terrain_only:
        query(f'''[out:json][timeout:220][maxsize:536870912];area({area})->.city;
        (way(area.city)["highway"];way(area.city)["building"];way(area.city)["waterway"];
         way(area.city)["natural"="water"];relation(area.city)["natural"="water"];
         way(area.city)["landuse"];way(area.city)["natural"="wood"];
         nwr(area.city)["tourism"];nwr(area.city)["historic"];nwr(area.city)["leisure"="park"];
         nwr(area.city)["name"="五一广场"];);out body geom;''', RAW / 'changsha-world.osm.json')
    zoom = 11
    left, bottom = tile_xy(b['minlon'], b['minlat'], zoom)
    right, top = tile_xy(b['maxlon'], b['maxlat'], zoom)
    tiles = [(zoom, x, y) for x in range(math.floor(left), math.floor(right) + 1) for y in range(math.floor(top), math.floor(bottom) + 1)]
    print(f'TERRAIN {len(tiles)} tiles at zoom {zoom}', flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_tile, tile): tile for tile in tiles}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as exc:
                failures.append({'tile': futures[future], 'error': str(exc)})
            if i % 10 == 0:
                print(f'TERRAIN {i}/{len(tiles)}', flush=True)
    save_json(RAW / 'terrain-source.json', {'zoom': zoom, 'tiles': tiles, 'failures': failures,
        'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'url': 'https://registry.opendata.aws/terrain-tiles/',
        'attribution': 'Terrain Tiles / Mapzen; elevation sources per Tilezen joerd attribution',
        'licenseUrl': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'})
    if failures:
        raise RuntimeError(f'{len(failures)} DEM tiles missing; data incomplete')
    print('FETCH COMPLETE', flush=True)

if __name__ == '__main__':
    main()
