"""Project verified OSM and public Terrarium DEM into Changsha's continuous world schema."""
from __future__ import annotations

import argparse
import gzip
import hashlib
from bisect import bisect_right
import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
sys.path.insert(0, str(ROOT / 'scripts'))
from PIL import Image
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import polygonize, transform as transform_geom, unary_union
from shapely.strtree import STRtree

from extract_region import main as extract_region
import fetch_world

DATA = ROOT / 'data'
RAW = DATA / 'raw'
CHUNKS = DATA / 'chunks'
WORLD_RAW = RAW / 'changsha-world.osm.json'
BOUNDARY_RAW = RAW / 'changsha-boundary.osm.json'
TERRAIN_RECEIPT = RAW / 'terrain-source.json'
MANIFEST_OUT = DATA / 'world-manifest.json'
GRAPH_OUT = DATA / 'graph.json'
MAP_OUT = DATA / 'map.json'
REPORT_OUT = DATA / 'data-report.json'
POI_POS_OUT = DATA / 'poi-positions.json'

R = 6_371_008.8
ORIGIN_LON, ORIGIN_LAT = 113.0, 28.2
COS_LAT = math.cos(math.radians(ORIGIN_LAT))
CHUNK_SIZE = 1024
GRID = 17
ZOOM = 11
TILE_SIZE = 256
ATTRIBUTION = [
    {'name': 'OpenStreetMap contributors / Geofabrik', 'license': 'ODbL-1.0', 'url': 'https://www.openstreetmap.org/copyright'},
    {'name': 'Terrain Tiles / Mapzen (Tilezen joerd elevation sources)', 'license': 'per source attribution; see source link', 'url': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'},
]


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def to_world(lon, lat):
    return ((math.radians(lon - ORIGIN_LON) * R * COS_LAT), (-math.radians(lat - ORIGIN_LAT) * R))


def to_geo(x, z):
    return (ORIGIN_LON + x / (R * COS_LAT) * 180 / math.pi, ORIGIN_LAT - z / R * 180 / math.pi)


def world_transform(lon, lat, z=None):
    x, depth = to_world(lon, lat)
    return (x, depth) if z is None else (x, depth, z)


def parse_measure(value):
    if value is None:
        return None
    match = re.match(r'^\s*(-?\d+(?:\.\d+)?)\s*(m|ft|feet)?\s*$', str(value), re.I)
    if not match:
        return None
    result = float(match.group(1))
    if (match.group(2) or '').lower() in {'ft', 'feet'}:
        result *= 0.3048
    return result if result > 0 else None


def is_walkable(tags):
    highway = tags.get('highway')
    if not highway:
        return False
    if highway in {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway'}:
        return False
    # Motor-road tunnels without explicit pedestrian access are not a verified
    # walking connection. Do not route a visitor through a lake as a surface road.
    if tags.get('tunnel') not in {None, '', 'no'} and highway not in {'footway', 'path', 'steps', 'pedestrian'} and tags.get('foot') not in {'yes', 'designated', 'permissive'}:
        return False
    if tags.get('access') in {'no', 'private'} or tags.get('foot') in {'no', 'private'}:
        return False
    if tags.get('access') in {'agricultural', 'forestry'} and tags.get('foot') != 'yes':
        return False
    return True


def road_width(tags):
    width = parse_measure(tags.get('width'))
    if width:
        return min(40.0, max(1.0, width)), 'tag'
    levels = tags.get('lanes')
    try:
        if levels:
            return min(36.0, max(2.0, float(levels) * 3.1)), 'lanes-estimate'
    except ValueError:
        pass
    return (6.0 if tags.get('highway') in {'primary', 'secondary', 'tertiary'} else 3.5), 'default-estimate'


HEIGHT_PROVENANCE_SCHEMA = 1
HEIGHT_REVIEW_METERS = 1000.0
HEIGHT_REVIEW_LEVELS = 200.0
HEIGHT_REPAIR_DIR = ROOT / 'artifacts' / 'implementation-20261015' / 'height-repair'
HEIGHT_REPAIR_RECEIPT = HEIGHT_REPAIR_DIR / 'height-only-receipt.json'
HEIGHT_REPAIR_BACKUP = HEIGHT_REPAIR_DIR / 'height-only-backup.json.gz'
HEIGHT_REPAIR_REPORT_BACKUP = HEIGHT_REPAIR_DIR / 'data-report-before.json'
HEIGHT_FIELDS = ('height', 'heightSource', 'heightProvenance')


def building_height(tags):
    height = parse_measure(tags.get('height'))
    if height is not None:
        return height, 'height-tag'
    try:
        levels = float(tags.get('building:levels', ''))
        if math.isfinite(levels) and levels > 0:
            return levels * 3.0, 'levels-estimate'
    except (TypeError, ValueError):
        pass
    return 6.0, 'default-estimate'


def building_height_with_provenance(tags, source_type, source_id):
    height, method = building_height(tags)
    raw_height = tags.get('height')
    raw_levels = tags.get('building:levels')
    normalized_height = parse_measure(raw_height)
    try:
        levels = float(raw_levels)
        if not math.isfinite(levels) or levels <= 0:
            levels = None
    except (TypeError, ValueError):
        levels = None

    review_reasons = []
    if normalized_height is None and levels is None:
        review_reasons.append('no-valid-height-or-levels')
    if normalized_height is not None and normalized_height > HEIGHT_REVIEW_METERS:
        review_reasons.append('height-tag-exceeds-review-threshold')
    if levels is not None and levels > HEIGHT_REVIEW_LEVELS:
        review_reasons.append('building-levels-exceed-review-threshold')

    provenance = {
        'schemaVersion': HEIGHT_PROVENANCE_SCHEMA,
        'source': 'OpenStreetMap',
        'sourceType': source_type,
        'sourceId': str(source_id),
        'rawHeightTag': raw_height,
        'rawBuildingLevelsTag': raw_levels,
        'normalizedHeightMeters': normalized_height,
        'adoptedHeightMeters': round(height, 2),
        'method': method,
        'independentMeasurement': False,
        'evidenceNote': 'OSM tags are source claims and are not independent field measurements.',
        'reviewRequired': bool(review_reasons),
        'reviewReasons': review_reasons,
    }
    return height, method, provenance


def unresolved_building_provenance(source_id, reason):
    return {
        'schemaVersion': HEIGHT_PROVENANCE_SCHEMA,
        'source': 'unresolved',
        'sourceType': None,
        'sourceId': str(source_id),
        'method': 'unknown-preserved',
        'independentMeasurement': False,
        'evidenceNote': 'Existing height retained because the source object could not be resolved unambiguously.',
        'reviewRequired': True,
        'reviewReasons': [reason],
    }


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def write_bytes_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.height-tmp')
    temporary.write_bytes(value)
    temporary.replace(path)


def save_json_atomic(path, value):
    write_bytes_atomic(path, json_bytes(value))


def set_height_provenance(building, provenance):
    if 'heightProvenance' in building:
        building['heightProvenance'] = provenance
        return
    reordered = {}
    inserted = False
    for key, value in building.items():
        reordered[key] = value
        if key == 'heightSource':
            reordered['heightProvenance'] = provenance
            inserted = True
    if not inserted:
        reordered['heightProvenance'] = provenance
    building.clear()
    building.update(reordered)


def scene_geometry_digest(chunk):
    scene = {}
    for key, value in chunk.items():
        if key != 'buildings':
            scene[key] = value
            continue
        scene[key] = [
            {k: v for k, v in building.items() if k not in HEIGHT_FIELDS}
            for building in value
        ]
    return sha256_bytes(json_bytes(scene))


def source_index(raw):
    index = {}
    for source_type, collection in (('way', 'ways'), ('relation', 'relations')):
        for row in raw.get(collection, []):
            index.setdefault(str(row.get('id')), []).append((source_type, row))
    return index


def resolve_building_source(source_records):
    if len(source_records) != 1:
        return None, 'missing-or-ambiguous-source-id'
    source_type, row = source_records[0]
    tags = row.get('tags', {})
    if not tags.get('building'):
        return None, 'source-object-has-no-building-tag'
    return (source_type, row), None


def transform_chunk_heights(chunk, index, chunk_name, backup_records, stats, unknown_examples):
    changed = False
    for building_index, building in enumerate(chunk.get('buildings', [])):
        source_id = str(building.get('id', ''))
        resolved, reason = resolve_building_source(index.get(source_id, []))
        if resolved is None:
            desired = {
                'height': building.get('height'),
                'heightSource': building.get('heightSource'),
                'heightProvenance': unresolved_building_provenance(source_id, reason),
            }
            stats['unknownRecords'] += 1
            if len(unknown_examples) < 25:
                unknown_examples.append({'chunk': chunk_name, 'id': source_id, 'reason': reason})
        else:
            source_type, row = resolved
            height, height_source, provenance = building_height_with_provenance(
                row.get('tags', {}), source_type, row.get('id'))
            desired = {
                'height': round(height, 2),
                'heightSource': height_source,
                'heightProvenance': provenance,
            }
            stats['resolvedRecords'] += 1
            stats['methodCounts'][height_source] = stats['methodCounts'].get(height_source, 0) + 1

        if (
            building.get('height') == desired['height']
            and building.get('heightSource') == desired['heightSource']
            and building.get('heightProvenance') == desired['heightProvenance']
        ):
            continue
        old_fields = {
            field: {'present': field in building, 'value': building.get(field)}
            for field in HEIGHT_FIELDS
        }
        backup_records.append({'index': building_index, 'id': source_id, 'fields': old_fields})
        building['height'] = desired['height']
        building['heightSource'] = desired['heightSource']
        set_height_provenance(building, desired['heightProvenance'])
        changed = True
        stats['changedRecords'] += 1
    return changed


def migrate_existing_building_heights():
    if HEIGHT_REPAIR_RECEIPT.exists() or HEIGHT_REPAIR_BACKUP.exists():
        raise RuntimeError(
            f'Height repair evidence already exists at {HEIGHT_REPAIR_DIR}; inspect it or roll back before another migration.')
    if not WORLD_RAW.is_file():
        raise FileNotFoundError(f'OSM source snapshot missing: {WORLD_RAW}')
    if not CHUNKS.is_dir():
        raise FileNotFoundError(f'Chunk directory missing: {CHUNKS}')
    if not REPORT_OUT.is_file():
        raise FileNotFoundError(f'Data report missing: {REPORT_OUT}')

    raw_bytes = WORLD_RAW.read_bytes()
    raw = json.loads(raw_bytes.decode('utf-8'))
    index = source_index(raw)
    source_sha = sha256_bytes(raw_bytes)
    chunk_paths = sorted(CHUNKS.glob('*.json'))
    report_before = REPORT_OUT.read_bytes()
    report = json.loads(report_before.decode('utf-8'))

    chunk_receipts = {}
    backups = {}
    unknown_examples = []
    stats = {'resolvedRecords': 0, 'unknownRecords': 0, 'changedRecords': 0, 'methodCounts': {}}
    for path in chunk_paths:
        before = path.read_bytes()
        chunk = json.loads(before.decode('utf-8'))
        records = []
        before_scene_sha = scene_geometry_digest(chunk)
        changed = transform_chunk_heights(chunk, index, path.name, records, stats, unknown_examples)
        if not changed:
            continue
        after = json_bytes(chunk)
        if before_scene_sha != scene_geometry_digest(chunk):
            raise RuntimeError(f'Non-height scene fields changed while planning {path.name}')
        backups[path.name] = records
        chunk_receipts[path.name] = {
            'beforeSha256': sha256_bytes(before),
            'afterSha256': sha256_bytes(after),
            'sceneSha256': before_scene_sha,
            'changedBuildingRecords': len(records),
        }

    if not backups:
        raise RuntimeError('No building height records require migration; refusing to create an empty repair receipt.')

    report_entry = {
        'schemaVersion': 1,
        'status': 'COMMITTED',
        'source': 'OpenStreetMap',
        'sourceSha256': source_sha,
        'provenanceSchemaVersion': HEIGHT_PROVENANCE_SCHEMA,
        'heightTagsAreIndependentMeasurements': False,
        'chunkFilesScanned': len(chunk_paths),
        'chunkFilesChanged': len(chunk_receipts),
        'buildingRecordsResolved': stats['resolvedRecords'],
        'buildingRecordsUnknown': stats['unknownRecords'],
        'buildingRecordsChanged': stats['changedRecords'],
        'methodCounts': stats['methodCounts'],
        'unknownExamples': unknown_examples,
    }
    updated_report = dict(report)
    updated_report['heightRepair'] = report_entry
    report_after = json_bytes(updated_report)

    backup_payload = {
        'schemaVersion': 1,
        'sourceSha256': source_sha,
        'reportBeforeSha256': sha256_bytes(report_before),
        'reportAfterSha256': sha256_bytes(report_after),
        'chunks': backups,
    }
    backup_bytes = gzip.compress(json_bytes(backup_payload), compresslevel=9, mtime=0)
    backup_sha = sha256_bytes(backup_bytes)

    HEIGHT_REPAIR_DIR.mkdir(parents=True, exist_ok=True)
    HEIGHT_REPAIR_REPORT_BACKUP.write_bytes(report_before)
    HEIGHT_REPAIR_BACKUP.write_bytes(backup_bytes)
    receipt = {
        'schemaVersion': 1,
        'status': 'PREPARED',
        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'sourceSha256': source_sha,
        'sourceUrl': raw.get('source', {}).get('url'),
        'chunkFilesScanned': len(chunk_paths),
        'chunkFilesChanged': len(chunk_receipts),
        'buildingRecordsResolved': stats['resolvedRecords'],
        'buildingRecordsUnknown': stats['unknownRecords'],
        'buildingRecordsChanged': stats['changedRecords'],
        'methodCounts': stats['methodCounts'],
        'unknownExamples': unknown_examples,
        'heightProvenanceSchemaVersion': HEIGHT_PROVENANCE_SCHEMA,
        'heightTagsAreIndependentMeasurements': False,
        'sceneGeometryUnchanged': True,
        'reportBeforeSha256': sha256_bytes(report_before),
        'reportAfterSha256': sha256_bytes(report_after),
        'reportBackup': HEIGHT_REPAIR_REPORT_BACKUP.name,
        'backupFile': HEIGHT_REPAIR_BACKUP.name,
        'backupSha256': backup_sha,
        'chunks': chunk_receipts,
    }
    save_json_atomic(HEIGHT_REPAIR_RECEIPT, receipt)

    try:
        for path in chunk_paths:
            expected = chunk_receipts.get(path.name)
            if expected is None:
                continue
            before = path.read_bytes()
            if sha256_bytes(before) != expected['beforeSha256']:
                raise RuntimeError(f'Chunk changed after migration planning: {path.name}')
            chunk = json.loads(before.decode('utf-8'))
            ignored_records = []
            check_stats = {'resolvedRecords': 0, 'unknownRecords': 0, 'changedRecords': 0, 'methodCounts': {}}
            changed = transform_chunk_heights(chunk, index, path.name, ignored_records, check_stats, [])
            after = json_bytes(chunk)
            if not changed or sha256_bytes(after) != expected['afterSha256']:
                raise RuntimeError(f'Chunk migration no longer matches the prepared hash: {path.name}')
            if scene_geometry_digest(chunk) != expected['sceneSha256']:
                raise RuntimeError(f'Chunk geometry hash mismatch: {path.name}')
            write_bytes_atomic(path, after)

        write_bytes_atomic(REPORT_OUT, report_after)
        receipt['status'] = 'COMMITTED'
        receipt['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        save_json_atomic(HEIGHT_REPAIR_RECEIPT, receipt)
    except Exception:
        receipt['status'] = 'PREPARED'
        receipt['interruptedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        save_json_atomic(HEIGHT_REPAIR_RECEIPT, receipt)
        raise

    print(
        f'HEIGHT_ONLY_COMPLETE chunks={receipt["chunkFilesChanged"]}/{len(chunk_paths)} '
        f'buildingRecords={receipt["buildingRecordsChanged"]} resolved={receipt["buildingRecordsResolved"]} '
        f'unknown={receipt["buildingRecordsUnknown"]} sourceSha256={source_sha}',
        flush=True,
    )


def rollback_existing_building_heights():
    if not HEIGHT_REPAIR_RECEIPT.is_file() or not HEIGHT_REPAIR_BACKUP.is_file():
        raise FileNotFoundError(f'Height repair receipt/backup missing under {HEIGHT_REPAIR_DIR}')
    receipt = json.loads(HEIGHT_REPAIR_RECEIPT.read_text(encoding='utf-8'))
    backup_bytes = HEIGHT_REPAIR_BACKUP.read_bytes()
    if sha256_bytes(backup_bytes) != receipt.get('backupSha256'):
        raise RuntimeError('Height backup hash mismatch; refusing rollback.')
    backup = json.loads(gzip.decompress(backup_bytes).decode('utf-8'))
    chunk_backups = backup.get('chunks', {})
    current_chunks = {}
    for name, expected in receipt.get('chunks', {}).items():
        path = CHUNKS / name
        current = path.read_bytes()
        digest = sha256_bytes(current)
        if digest not in {expected['beforeSha256'], expected['afterSha256']}:
            raise RuntimeError(f'Chunk changed since migration and cannot be safely rolled back: {name}')
        current_chunks[name] = (path, current, digest, expected)

    report_current = REPORT_OUT.read_bytes()
    report_digest = sha256_bytes(report_current)
    if report_digest not in {receipt['reportBeforeSha256'], receipt['reportAfterSha256']}:
        raise RuntimeError('data-report.json changed since migration; refusing to overwrite it during rollback.')

    for name, (path, current, digest, expected) in current_chunks.items():
        if digest == expected['beforeSha256']:
            continue
        chunk = json.loads(current.decode('utf-8'))
        for record in chunk_backups.get(name, []):
            building = chunk['buildings'][record['index']]
            if str(building.get('id', '')) != record['id']:
                raise RuntimeError(f'Building index/id mismatch during rollback in {name}')
            for field, saved in record['fields'].items():
                if saved['present']:
                    if field == 'heightProvenance':
                        set_height_provenance(building, saved['value'])
                    else:
                        building[field] = saved['value']
                else:
                    building.pop(field, None)
        restored = json_bytes(chunk)
        if sha256_bytes(restored) != expected['beforeSha256']:
            raise RuntimeError(f'Rollback did not restore original chunk hash: {name}')
        write_bytes_atomic(path, restored)

    if report_digest == receipt['reportAfterSha256']:
        original_report = HEIGHT_REPAIR_REPORT_BACKUP.read_bytes()
        if sha256_bytes(original_report) != receipt['reportBeforeSha256']:
            raise RuntimeError('Original data report backup hash mismatch.')
        write_bytes_atomic(REPORT_OUT, original_report)

    receipt['status'] = 'ROLLED_BACK'
    receipt['rolledBackAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    save_json_atomic(HEIGHT_REPAIR_RECEIPT, receipt)
    print(f'HEIGHT_ONLY_ROLLBACK_COMPLETE chunks={len(current_chunks)}', flush=True)


def way_line(row):
    coords = [(n[1], n[2]) for n in row.get('nodes', [])]
    if len(coords) < 2:
        return None
    try:
        return LineString(coords)
    except Exception:
        return None


def way_polygon(row):
    nodes = row.get('nodes', [])
    coords = [(n[1], n[2]) for n in nodes]
    if len(coords) < 4 or coords[0] != coords[-1]:
        return None
    try:
        geom = Polygon(coords)
        if not geom.is_valid:
            geom = geom.buffer(0)
        return geom if not geom.is_empty else None
    except Exception:
        return None


def relation_polygon(relation, ways):
    outer, inner = [], []
    for m in relation.get('members', []):
        if m.get('type') != 'w':
            continue
        row = ways.get(int(m['ref']))
        poly = way_polygon(row) if row else None
        if poly is None:
            line = way_line(row) if row else None
            if line is None:
                continue
            (inner if m.get('role') == 'inner' else outer).append(line)
        else:
            (inner if m.get('role') == 'inner' else outer).append(poly.boundary)
    def polygonize_group(lines):
        if not lines:
            return None
        polys = list(polygonize(unary_union(lines)))
        return unary_union(polys) if polys else None
    out = polygonize_group(outer)
    if out is None:
        return None
    holes = polygonize_group(inner)
    if holes is not None:
        out = out.difference(holes)
    return out if not out.is_empty else None


def extract_lines(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == 'LineString':
        return [geometry]
    if geometry.geom_type == 'MultiLineString' or geometry.geom_type == 'GeometryCollection':
        rows = []
        for child in geometry.geoms:
            rows.extend(extract_lines(child))
        return rows
    return []


def extract_polygons(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    if geometry.geom_type in {'MultiPolygon', 'GeometryCollection'}:
        rows = []
        for child in geometry.geoms:
            rows.extend(extract_polygons(child))
        return rows
    return []


def line_to_world(line):
    return [(x, z) for x, z in [to_world(lon, lat) for lon, lat in line.coords]]


def polygon_to_world(poly):
    return Polygon([to_world(lon, lat) for lon, lat in poly.exterior.coords],
                   [[to_world(lon, lat) for lon, lat in ring.coords] for ring in poly.interiors])


def polygon_payload(poly):
    payload = {'polygon': [[round(x, 2), round(z, 2)] for x, z in poly.exterior.coords]}
    holes = [[[round(x, 2), round(z, 2)] for x, z in ring.coords] for ring in poly.interiors]
    if holes:
        payload['holes'] = holes
    return payload


def densify(coords, maximum=15.0):
    if len(coords) < 2:
        return coords
    out = [coords[0]]
    for a, b in zip(coords, coords[1:]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        steps = max(1, math.ceil(length / maximum))
        for i in range(1, steps + 1):
            t = i / steps
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def collect_terrain_tiles(boundary_world):
    minx, minz, maxx, maxz = boundary_world.bounds
    lon0, lat1 = to_geo(minx, maxz)
    lon1, lat0 = to_geo(maxx, minz)
    xa, ya = fetch_world.tile_xy(lon0, lat0, ZOOM)
    xb, yb = fetch_world.tile_xy(lon1, lat1, ZOOM)
    n = 2 ** ZOOM
    tiles = [(ZOOM, x, y) for x in range(max(0, math.floor(min(xa, xb)) - 1), min(n - 1, math.floor(max(xa, xb)) + 1) + 1)
             for y in range(max(0, math.floor(min(ya, yb)) - 1), min(n - 1, math.floor(max(ya, yb)) + 1) + 1)]
    print(f'DEM zoom={ZOOM} tiles={len(tiles)}', flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_world.fetch_tile, tile): tile for tile in tiles}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as exc:
                failures.append({'tile': list(futures[future]), 'error': str(exc)})
            if i % 10 == 0 or i == len(futures):
                print(f'DEM fetched={i}/{len(futures)} failures={len(failures)}', flush=True)
    save_json(TERRAIN_RECEIPT, {
        'provider': 'AWS Open Data elevation-tiles-prod Terrarium', 'zoom': ZOOM, 'tiles': [list(t) for t in tiles],
        'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'urlTemplate': 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        'encoding': 'Terrarium RGB: (R*65536+G*256+B)/256-32768 metres',
        'attribution': ATTRIBUTION[1], 'failures': failures,
    })
    return failures


def make_elevation_sampler():
    @lru_cache(maxsize=64)
    def pixels(tx, ty):
        path = RAW / 'terrain' / str(ZOOM) / str(tx) / f'{ty}.png'
        if not path.is_file():
            return None
        return Image.open(path).convert('RGB').load()

    def sample_pixel(px, py):
        tx, ty = px // TILE_SIZE, py // TILE_SIZE
        image = pixels(tx, ty)
        if image is None:
            raise FileNotFoundError(f'DEM tile {ZOOM}/{tx}/{ty} missing')
        red, green, blue = image[px % TILE_SIZE, py % TILE_SIZE]
        return (red * 65536 + green * 256 + blue) / 256 - 32768

    def elevation(lon, lat):
        tx, ty = fetch_world.tile_xy(lon, lat, ZOOM)
        px, py = tx * TILE_SIZE, ty * TILE_SIZE
        x0, y0 = math.floor(px), math.floor(py)
        fx, fy = px - x0, py - y0
        h00, h10 = sample_pixel(x0, y0), sample_pixel(x0 + 1, y0)
        h01, h11 = sample_pixel(x0, y0 + 1), sample_pixel(x0 + 1, y0 + 1)
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy
    return elevation


class DSU:
    def __init__(self): self.parent, self.rank = {}, {}
    def add(self, value): self.parent.setdefault(value, value); self.rank.setdefault(value, 0)
    def find(self, value):
        p = self.parent[value]
        if p != value: self.parent[value] = self.find(p)
        return self.parent[value]
    def union(self, a, b):
        self.add(a); self.add(b); ra, rb = self.find(a), self.find(b)
        if ra == rb: return
        if self.rank[ra] < self.rank[rb]: ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]: self.rank[ra] += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-fetch-dem', action='store_true', help='reuse already cached tiles only')
    parser.add_argument('--skip-extract', action='store_true', help='reuse changsha-world.osm.json if present')
    height_mode = parser.add_mutually_exclusive_group()
    height_mode.add_argument('--height-only', action='store_true',
                             help='migrate heights/provenance in existing chunks without rebuilding geometry')
    height_mode.add_argument('--rollback-height-only', action='store_true',
                             help='restore chunk height fields from the recorded height-only backup')
    args = parser.parse_args()
    if args.height_only:
        migrate_existing_building_heights()
        return
    if args.rollback_height_only:
        rollback_existing_building_heights()
        return
    if not args.skip_extract or not WORLD_RAW.is_file() or not BOUNDARY_RAW.is_file():
        extract_region()
    raw = json.loads(WORLD_RAW.read_text(encoding='utf-8'))
    boundary_raw = shape(raw['boundary'])
    boundary = transform_geom(world_transform, boundary_raw)
    ways_by_id = {int(row['id']): row for row in raw['ways']}
    relation_features = []
    for relation in raw.get('relations', []):
        geom = relation_polygon(relation, ways_by_id)
        if geom and geom.intersects(boundary_raw):
            relation_features.append((relation, geom))

    roads, all_roads, buildings, waters, landuses, waterway_lines = [], [], [], [], [], []
    relation_member_ids = set()
    way_by_id = {}
    width_sources, building_height_sources, waterway_buffer_defaults = {}, {}, {}
    for row in raw['ways']:
        way_by_id[int(row['id'])] = row
        tags = row.get('tags', {})
        line = way_line(row)
        if line is None:
            continue
        poly = way_polygon(row)
        if tags.get('highway'):
            clipped = line.intersection(boundary_raw)
            for segment in extract_lines(clipped):
                if len(segment.coords) >= 2:
                    width, width_source = road_width(tags)
                    width_sources[width_source] = width_sources.get(width_source, 0) + 1
                    road = {'id': int(row['id']), 'tags': tags, 'geometry': transform_geom(world_transform, segment),
                            'worldLine': transform_geom(world_transform, line), 'width': width, 'walkable': is_walkable(tags),
                            'bridge': tags.get('bridge') not in {None, '', 'no'}, 'sourceNodes': row['nodes']}
                    all_roads.append(road)
                    if road['walkable']:
                        roads.append(road)
        if poly is not None and poly.intersects(boundary_raw):
            clipped = poly.intersection(boundary_raw)
            if tags.get('building'):
                height, height_source, height_provenance = building_height_with_provenance(tags, 'way', row['id'])
                building_height_sources[height_source] = building_height_sources.get(height_source, 0) + len(extract_polygons(clipped))
                for polygon in extract_polygons(clipped):
                    buildings.append({'id': int(row['id']), 'name': tags.get('name'), 'height': height,
                                      'heightSource': height_source, 'heightProvenance': height_provenance,
                                      'geometry': transform_geom(world_transform, polygon)})
            if tags.get('natural') in {'water', 'wetland'} or tags.get('waterway') == 'riverbank' or tags.get('landuse') in {'reservoir', 'basin'}:
                waters.extend(transform_geom(world_transform, p) for p in extract_polygons(clipped))
            if tags.get('landuse') or tags.get('leisure') == 'park' or tags.get('natural') in {'wood', 'wetland'}:
                kind = tags.get('landuse') or tags.get('leisure') or tags.get('natural')
                landuses.extend((kind, transform_geom(world_transform, p)) for p in extract_polygons(clipped))
    for relation, geom in relation_features:
        tags = relation['tags']
        relation_member_ids.update(int(m['ref']) for m in relation['members'] if m.get('type') == 'w')
        clipped = geom.intersection(boundary_raw)
        polygons = [transform_geom(world_transform, p) for p in extract_polygons(clipped)]
        if tags.get('natural') in {'water', 'wetland'} or tags.get('waterway') == 'riverbank' or tags.get('landuse') in {'reservoir', 'basin'}:
            waters.extend(polygons)
        if tags.get('landuse') or tags.get('leisure') == 'park' or tags.get('natural') in {'wood', 'wetland'}:
            kind = tags.get('landuse') or tags.get('leisure') or tags.get('natural')
            landuses.extend((kind, p) for p in polygons)
        if tags.get('building'):
            height, height_source, height_provenance = building_height_with_provenance(tags, 'relation', relation['id'])
            building_height_sources[height_source] = building_height_sources.get(height_source, 0) + len(polygons)
            buildings.extend({'id': int(relation['id']), 'name': tags.get('name'), 'height': height,
                              'heightSource': height_source, 'heightProvenance': height_provenance,
                              'geometry': p} for p in polygons)

    # Open OSM waterway lines keep their real centerline; an approximate width only makes a visible/collidable polygon.
    for row in raw['ways']:
        tags = row.get('tags', {})
        waterway = tags.get('waterway')
        # Culverts/covered drains are below a real road or terrain, not surface water.
        if tags.get('tunnel') not in {None, '', 'no'} or tags.get('covered') == 'yes':
            continue
        if waterway not in {'river', 'stream', 'canal', 'ditch', 'drain'} or way_polygon(row) is not None:
            continue
        line = way_line(row)
        if line is None or not line.intersects(boundary_raw):
            continue
        width = parse_measure(tags.get('width'))
        if width is None:
            width = {'river': 20.0, 'canal': 8.0, 'stream': 2.5, 'ditch': 1.5, 'drain': 1.0}[waterway]
            waterway_buffer_defaults[waterway] = waterway_buffer_defaults.get(waterway, 0) + 1
        center = transform_geom(world_transform, line.intersection(boundary_raw))
        for segment in extract_lines(center):
            waterway_lines.append({'id': int(row['id']), 'name': tags.get('name'), 'kind': waterway,
                                   'points': [[round(x, 2), round(z, 2)] for x, z in segment.coords]})
            waters.extend(extract_polygons(segment.buffer(width / 2, cap_style='flat', join_style='round').intersection(boundary)))

    # Named tourism/historic/leisure candidates; source IDs remain suitable for later POI reconciliation.
    places = []
    for row in raw.get('nodes', []):
        tags = row.get('tags', {})
        places.append({'name': tags.get('name') or tags.get('name:zh') or tags.get('int_name'), 'lon': row['lon'], 'lat': row['lat'],
                       'osmType': 'node', 'osmId': int(row['id']), 'tags': tags})
    for row in raw['ways']:
        tags = row.get('tags', {})
        named = any(tags.get(k) for k in ('name', 'name:zh', 'int_name'))
        if tags.get('tourism') in {'hotel', 'guest_house'} or not named or (not any(k in tags for k in ('tourism', 'historic', 'leisure')) and tags.get('name') != '五一广场'):
            continue
        geom = way_polygon(row)
        if geom is None:
            geom = way_line(row)
        if geom is None or not geom.intersects(boundary_raw):
            continue
        point = geom.intersection(boundary_raw).representative_point()
        places.append({'name': tags.get('name') or tags.get('name:zh') or tags.get('int_name'), 'lon': point.x, 'lat': point.y,
                       'osmType': 'way', 'osmId': int(row['id']), 'tags': tags})
    for relation, geom in relation_features:
        tags = relation['tags']
        if tags.get('tourism') not in {'hotel', 'guest_house'} and any(tags.get(k) for k in ('name', 'name:zh', 'int_name')) and any(k in tags for k in ('tourism', 'historic', 'leisure')):
            point = geom.intersection(boundary_raw).representative_point()
            places.append({'name': tags.get('name') or tags.get('name:zh') or tags.get('int_name'), 'lon': point.x, 'lat': point.y,
                           'osmType': 'relation', 'osmId': int(relation['id']), 'tags': tags})

    dem_failures = [] if args.no_fetch_dem else collect_terrain_tiles(boundary)
    if args.no_fetch_dem:
        dem_failures = []
    elevation = make_elevation_sampler()
    missing_dem_points = 0
    def height_at(lon, lat):
        nonlocal missing_dem_points
        try:
            return elevation(lon, lat)
        except FileNotFoundError:
            missing_dem_points += 1
            return None

    # Resolve the elevation of a shared node once. A long main bridge's profile
    # anchors connecting ramps instead of letting each way create a vertical seam.
    road_profiles = {}
    bridge_node_heights = {}
    bridge_priorities = {}
    for road in roads:
        source = road['sourceNodes']
        xy = [to_world(n[1], n[2]) for n in source]
        cumulative = [0.0]
        for a, b in zip(xy, xy[1:]):cumulative.append(cumulative[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
        dem = [height_at(n[1], n[2]) for n in source]
        length = cumulative[-1]
        original = dem[:]
        if road['bridge'] and length > 0 and dem[0] is not None and dem[-1] is not None:
            original = [dem[0] + (dem[-1]-dem[0])*(d/length) + 1.5*4*(d/length)*(1-d/length) for d in cumulative]
            for node, y in zip(source, original):
                if length > bridge_priorities.get(node[0], -1):
                    bridge_priorities[node[0]] = length;bridge_node_heights[node[0]] = y
        road_profiles[road['id']] = {'cumulative':cumulative,'dem':dem,'original':original,'length':length}

    # Real OSM node IDs only. Do not connect spatially close but differently identified ends.
    graph_nodes = {}
    edge_map = {}
    dsu = DSU()
    graph_water_tree = STRtree(waters) if waters else None
    graph_building_tree = STRtree([b['geometry'] for b in buildings]) if buildings else None
    collision_rejected = {'water': 0, 'building': 0}
    collision_samples = []
    excluded_ways = sum(not road['walkable'] for road in all_roads)
    for road in roads:
        row = way_by_id.get(road['id'])
        if not row or not is_walkable(row.get('tags', {})):
            continue
        nodes = row['nodes']
        node_lonlat = {int(node[0]): (node[1], node[2]) for node in nodes}
        allowed = []
        for node_index, (node_id, lon, lat) in enumerate(nodes):
            point = Point(lon, lat)
            if not boundary_raw.covers(point):
                allowed.append(None)
                continue
            x, z = to_world(lon, lat)
            y = height_at(lon, lat)
            if y is None:
                allowed.append(None)
                continue
            y = bridge_node_heights.get(node_id, y)
            graph_nodes[int(node_id)] = [int(node_id), x, y, z]
            dsu.add(int(node_id))
            allowed.append((int(node_id), x, y, z))
        for a, b in zip(allowed, allowed[1:]):
            if a is None or b is None:
                continue
            lonlat_a = node_lonlat.get(a[0])
            lonlat_b = node_lonlat.get(b[0])
            if not lonlat_a or not lonlat_b or not boundary_raw.covers(LineString([lonlat_a, lonlat_b])):
                continue
            d = math.hypot(b[1] - a[1], b[3] - a[3])
            if d <= 0:
                continue
            world_edge = LineString([(a[1], a[3]), (b[1], b[3])])
            conflict = None
            if not road['bridge'] and graph_water_tree is not None and len(graph_water_tree.query(world_edge, predicate='intersects')):
                conflict = 'water'
            elif graph_building_tree is not None and len(graph_building_tree.query(world_edge, predicate='intersects')):
                conflict = 'building'
            if conflict:
                collision_rejected[conflict] += 1
                if len(collision_samples) < 100:collision_samples.append({'roadId':road['id'],'from':a[0],'to':b[0],'conflict':conflict})
                continue
            key = (a[0], b[0]) if a[0] <= b[0] else (b[0], a[0])
            edge_map[key] = [a[0], b[0], d]
            dsu.union(a[0], b[0])

    node_components = {}
    for node_id in dsu.parent:
        root = dsu.find(node_id)
        node_components[root] = node_components.get(root, 0) + 1
    components = len(node_components)
    largest_component = max(node_components.values(), default=0)

    # Bridge profiles blend endpoint DEM elevations with a zero-at-banks, 1.5m midspan arch.
    def road_world_points(road, line=None):
        geometry = road['geometry'] if line is None else line
        output = []
        coords = densify(list(geometry.coords))
        source = road['sourceNodes']
        bridge_y0 = bridge_y1 = None
        if road['bridge'] and len(source) >= 2:
            bridge_y0 = height_at(source[0][1], source[0][2])
            bridge_y1 = height_at(source[-1][1], source[-1][2])
        total = road['worldLine'].length
        profile = road_profiles.get(road['id'])
        for x, z in coords:
            lon, lat = to_geo(x, z)
            y = height_at(lon, lat)
            if y is None:
                continue
            if road['bridge'] and bridge_y0 is not None and bridge_y1 is not None:
                along = road['worldLine'].project(Point(x, z))
                ratio = 0 if total <= 0 else along / total
                y = bridge_y0 + (bridge_y1 - bridge_y0) * ratio + 1.5 * 4 * ratio * (1 - ratio)
            if profile and len(source) >= 2 and profile['length'] > 0:
                along = road['worldLine'].project(Point(x,z))
                i = min(len(source)-2,max(0,bisect_right(profile['cumulative'],along)-1))
                span = profile['cumulative'][i+1]-profile['cumulative'][i]
                t = 0 if span <= 0 else min(1,max(0,(along-profile['cumulative'][i])/span))
                if profile['original'][i] is not None and profile['original'][i+1] is not None:
                    da = bridge_node_heights.get(source[i][0],profile['original'][i])-profile['original'][i]
                    db = bridge_node_heights.get(source[i+1][0],profile['original'][i+1])-profile['original'][i+1]
                    y += da*(1-t)+db*t
            output.append([x, y, z])
        return output

    road_map = []
    for road in all_roads:
        for line in extract_lines(road['geometry']):
            pts = [[x, z] for x, z in densify(list(line.coords))]
            if len(pts) >= 2:
                road_map.append({'id': road['id'], 'kind': road['tags'].get('highway'), 'name': road['tags'].get('name'),
                                 'walkable': road['walkable'], 'points': pts})

    road_geoms = [r['geometry'] for r in roads]
    building_geoms = [r['geometry'] for r in buildings]
    water_geoms = waters
    landuse_geoms = [geom for _, geom in landuses]
    road_tree = STRtree(road_geoms) if road_geoms else None
    building_tree = STRtree(building_geoms) if building_geoms else None
    water_tree = STRtree(water_geoms) if water_geoms else None
    landuse_tree = STRtree(landuse_geoms) if landuse_geoms else None
    bounds = boundary.bounds
    min_ix, max_ix = math.floor(bounds[0] / CHUNK_SIZE), math.floor(bounds[2] / CHUNK_SIZE)
    min_iz, max_iz = math.floor(bounds[1] / CHUNK_SIZE), math.floor(bounds[3] / CHUNK_SIZE)
    chunks = {}
    skipped_boundary_cells = 0
    skipped_dem_chunks = []
    height_source_counts = {'dem': 0, 'missing': 0}

    def tree_rows(tree, records, cell):
        if tree is None:
            return []
        indices = tree.query(cell, predicate='intersects')
        return [(int(i), records[int(i)]) for i in indices]

    for iz in range(min_iz, max_iz + 1):
        for ix in range(min_ix, max_ix + 1):
            cell = box(ix * CHUNK_SIZE, iz * CHUNK_SIZE, (ix + 1) * CHUNK_SIZE, (iz + 1) * CHUNK_SIZE)
            if not boundary.intersects(cell):
                continue
            clipped_boundary = boundary.intersection(cell)
            if clipped_boundary.is_empty:
                skipped_boundary_cells += 1
                continue
            heights = []
            failed = False
            for gz in range(GRID):
                for gx in range(GRID):
                    x = ix * CHUNK_SIZE + gx * CHUNK_SIZE / (GRID - 1)
                    z = iz * CHUNK_SIZE + gz * CHUNK_SIZE / (GRID - 1)
                    lon, lat = to_geo(x, z)
                    h = height_at(lon, lat)
                    if h is None:
                        failed = True
                        heights.append(0)
                    else:
                        height_source_counts['dem'] += 1
                        heights.append(round(h, 2))
            if failed:
                skipped_dem_chunks.append(f'{ix}_{iz}')
                height_source_counts['missing'] += heights.count(0)
                continue
            chunk_roads = []
            for _, road in tree_rows(road_tree, roads, cell):
                clipped = road['geometry'].intersection(cell)
                for line in extract_lines(clipped):
                    pts = road_world_points(road, line)
                    if len(pts) >= 2:
                        chunk_roads.append({'id': str(road['id']), 'kind': road['tags'].get('highway'), 'name': road['tags'].get('name'),
                                            'width': round(road['width'], 2), 'bridge': road['bridge'], 'tunnel': road['tags'].get('tunnel') not in {None, '', 'no'}, 'layer': road['tags'].get('layer', '0'), 'points': [[round(v, 2) for v in p] for p in pts]})
            chunk_buildings = []
            for _, building in tree_rows(building_tree, buildings, cell):
                for polygon in extract_polygons(building['geometry'].intersection(cell)):
                    chunk_buildings.append({'id': str(building['id']), 'name': building['name'],
                                            'height': round(building['height'], 2), 'heightSource': building['heightSource'],
                                            **polygon_payload(polygon)})
            chunk_water = []
            for _, geom in tree_rows(water_tree, waters, cell):
                for polygon in extract_polygons(geom.intersection(cell)):
                    chunk_water.append(polygon_payload(polygon))
            chunk_landuse = []
            for _, (kind, geom) in tree_rows(landuse_tree, landuses, cell):
                for polygon in extract_polygons(geom.intersection(cell)):
                    chunk_landuse.append({'kind': kind, 'polygon': [[round(x, 2), round(z, 2)] for x, z in polygon.exterior.coords]})
            key = f'{ix}_{iz}'
            payload = {'key': key, 'ix': ix, 'iz': iz,
                       'terrain': {'size': CHUNK_SIZE, 'resolution': GRID, 'heights': heights},
                       'roads': chunk_roads, 'buildings': chunk_buildings, 'water': chunk_water, 'landuse': chunk_landuse}
            save_json(CHUNKS / f'{key}.json', payload)
            chunks[key] = f'data/chunks/{key}.json'
            if len(chunks) % 250 == 0:
                print(f'CHUNKS written={len(chunks):,}', flush=True)

    # Select an actual graph node near the named Wuyi Square candidate; otherwise leave start unresolved.
    square = next((p for p in places if p['name'] == '五一广场'), None)
    start = None
    if square and graph_nodes:
        sx, sz = to_world(square['lon'], square['lat'])
        nearby = sorted((n for n in graph_nodes.values() if math.hypot(n[1] - sx, n[3] - sz) <= 500),
                        key=lambda n: math.hypot(n[1] - sx, n[3] - sz))
        nearest = None
        for candidate in nearby:
            point = Point(candidate[1], candidate[3])
            building_ids = building_tree.query(point) if building_tree else []
            if not any(building_geoms[int(i)].contains(point) for i in building_ids):
                nearest = candidate
                break
        if nearest is not None:
            gap = math.hypot(nearest[1] - sx, nearest[3] - sz)
            start = {'x': nearest[1], 'y': nearest[2], 'z': nearest[3],
                     'source': {'poi': {'osmType': square['osmType'], 'osmId': square['osmId'], 'name': square['name']},
                                'roadNodeId': nearest[0], 'snapDistanceMeters': round(gap, 2), 'method': 'nearest in-boundary walkable OSM node'}}

    boundary_world_polys = []
    for polygon in extract_polygons(boundary):
        boundary_world_polys.append([[round(x, 2), round(z, 2)] for x, z in polygon.exterior.coords])
    map_water = []
    for geom in waters:
        for polygon in extract_polygons(geom):
            map_water.append(polygon_payload(polygon))
    map_payload = {'bounds': {'minX': bounds[0], 'maxX': bounds[2], 'minZ': bounds[1], 'maxZ': bounds[3]},
                   'boundary': boundary_world_polys, 'roads': road_map, 'water': map_water,
                   'waterways': waterway_lines,
                   'places': places}
    edges = list(edge_map.values())
    graph_payload = {'nodes': list(graph_nodes.values()), 'edges': edges, 'snapRadius': 150,
                     'source': {'provider': 'OpenStreetMap PBF', 'walkingFilter': 'public/highway filter; shared OSM node IDs only'}}
    source = raw['source']
    report = {
        'status': 'PARTIAL' if dem_failures or skipped_dem_chunks or start is None else 'DATA_READY_NOT_MVP_VALIDATED',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'sources': {'osm': {'url': source.get('url'), 'sourcePage': source.get('sourcePage'), 'license': source.get('license'),
                            'attribution': source.get('attribution'), 'retrievedAt': source.get('retrievedAt'),
                            'bytes': source.get('actualBytes'), 'sha256': source.get('actualSha256'),
                            'relationId': raw['boundaryRelationId'], 'adminLevel': json.loads(BOUNDARY_RAW.read_text(encoding='utf-8')).get('adminLevel')},
                    'dem': {'provider': 'AWS Terrain Tiles / Mapzen Terrarium', 'zoom': ZOOM, 'tileCount': len(json.loads(TERRAIN_RECEIPT.read_text(encoding='utf-8')).get('tiles', [])),
                            'failures': dem_failures, 'licenseAttribution': ATTRIBUTION[1]}},
        'coverage': {'chunks': len(chunks), 'skippedBoundaryCells': skipped_boundary_cells, 'skippedDemChunks': skipped_dem_chunks,
                     'boundsMeters': map_payload['bounds'], 'fullAdministrativePolygonUsed': True},
        'features': {'walkableRoadWaySegments': len(roads), 'allRoadWaySegments': len(all_roads), 'roadMapLines': len(road_map), 'buildingPolygons': len(buildings), 'waterPolygons': len(waters),
                     'landusePolygons': len(landuses), 'namedPoiCandidates': len(places), 'graphNodes': len(graph_nodes), 'graphEdges': len(edges),
                     'walkableConnectedComponents': components, 'largestComponentNodes': largest_component,
                     'roadsExcludedForAccessOrClass': excluded_ways, 'waterwayBufferDefaults': waterway_buffer_defaults,
                     'collisionRejectedEdges': collision_rejected, 'collisionConflictSamples': collision_samples,
                     'roadWidthSources': width_sources, 'buildingHeightSources': building_height_sources},
        'start': start, 'demMissingGridSamples': missing_dem_points, 'demMissingChunks': len(skipped_dem_chunks),
        'limitations': [
            'OSM is an openly contributed snapshot, not a completeness guarantee for every road, building, footpath, access restriction or POI.',
            'Terrain Tiles zoom 11 is coarse elevation context, not surveyed ground elevation; 17x17 chunk grids are interpolated samples.',
            'Buildings lacking height/levels tags use a labeled 6m graybox default; road widths use tagged width/lanes or labeled defaults.',
            'Open waterway centerlines without mapped bank polygons are buffered using tagged width or explicit kind-based approximate defaults.',
            'Waterways tagged as tunnels/culverts or covered are excluded from surface-water collision geometry.',
            'Bridge centerlines use adjacent DEM endpoint interpolation and a zero-at-banks 1.5m midspan arch; bridge deck geometry is approximate, not survey-grade.',
            'Shared road nodes use one elevation; where approximate bridge profiles disagree, the longer main-bridge profile anchors ramps and correction offsets blend into connected road segments. This is continuity modeling, not surveyed deck height.',
            'Graph connectivity reflects explicit shared OSM node IDs; disconnected components are retained and never patched with invented links.',
            'Navigation excludes source-conflicting edges through buildings or unbridged surface water, matching current scene collisions; original road/water/building geometries remain intact. This is a game passability filter, not a claim of real-world road closure.',
            'Motor-road tunnels without explicit pedestrian access are excluded from walking routes. Other tunnels remain eligible for passability checks, but underwater tunnels and roads overlapping building footprints are currently blocked because the required interiors/vertical collision model are undeveloped.',
            'This data preparation does not validate landmark reconstruction, browser performance, photo export or full MVP acceptance.',
        ],
    }
    save_json(MAP_OUT, map_payload)
    save_json(GRAPH_OUT, graph_payload)
    save_json(POI_POS_OUT, {'source': 'OSM PBF; coordinate candidates only; not merged into canonical POIs', 'records': places})
    save_json(MANIFEST_OUT, {'schemaVersion': 1, 'origin': {'lon': ORIGIN_LON, 'lat': ORIGIN_LAT}, 'chunkSize': CHUNK_SIZE,
                             'bounds': map_payload['bounds'], 'start': start, 'chunks': chunks,
                             'terrain': {'provider': 'AWS Terrain Tiles / Mapzen Terrarium', 'zoom': ZOOM, 'resolution': GRID,
                                         'sampleSpacingMeters': CHUNK_SIZE / (GRID - 1), 'verticalAccuracy': 'not surveyed'},
                             'attribution': ATTRIBUTION})
    save_json(REPORT_OUT, report)
    print(f'COMPLETE chunks={len(chunks)} nodes={len(graph_nodes)} edges={len(edges)} components={components} largest={largest_component} start={bool(start)} missingDemChunks={len(skipped_dem_chunks)}', flush=True)


if __name__ == '__main__':
    main()
