"""Extract Changsha's real boundary and OSM GIS features from the licensed Hunan PBF."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
import osmium
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import polygonize, unary_union

RAW = ROOT / 'data' / 'raw'
PBF = RAW / 'hunan-latest.osm.pbf'
SOURCE = RAW / 'hunan-latest.osm.source.json'
BOUNDARY_OUT = RAW / 'changsha-boundary.osm.json'
WORLD_OUT = RAW / 'changsha-world.osm.json'

GIS_KEYS = {'highway', 'building', 'waterway', 'landuse', 'tourism', 'historic', 'leisure', 'natural'}
POI_KEYS = {'tourism', 'historic', 'leisure'}
WATER_NATURAL = {'water', 'wetland'}
AREA_NATURAL = {'water', 'wetland', 'wood'}


def tags_of(obj):
    return {tag.k: tag.v for tag in obj.tags}


def relevant_relation(tags):
    return tags.get('type') in {'multipolygon', 'boundary'} and any(
        key in tags for key in ('natural', 'waterway', 'landuse', 'leisure', 'tourism', 'historic', 'building')
    )


def relevant_way(tags):
    return any(key in tags for key in GIS_KEYS)


def has_named_poi(tags):
    if tags.get('tourism') in {'hotel', 'guest_house'}:
        return False
    return any(tags.get(k) for k in ('name', 'name:zh', 'int_name')) and any(k in tags for k in POI_KEYS)


def coords_of(way):
    result = []
    for node in way.nodes:
        if not node.location.valid():
            return []
        result.append([int(node.ref), float(node.lon), float(node.lat)])
    return result


def polygon_from_members(members, ways):
    outer, inner = [], []
    for member in members:
        if member.get('type') not in {'way', 'w'}:
            continue
        row = ways.get(int(member['ref']))
        if not row or len(row.get('nodes', [])) < 2:
            continue
        coords = [(n[1], n[2]) for n in row['nodes']]
        line = LineString(coords)
        (inner if member.get('role') == 'inner' else outer).append(line)
    if not outer:
        return None
    def polygonize_lines(lines):
        if not lines:
            return None
        polys = list(polygonize(unary_union(lines)))
        return unary_union(polys) if polys else None
    geom = polygonize_lines(outer)
    if geom is None:
        return None
    holes = polygonize_lines(inner)
    if holes is not None:
        geom = geom.difference(holes)
    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom if not geom.is_empty else None


class RelationPass(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.boundaries = []
        self.relations = []
        self.member_ids = set()

    def relation(self, rel):
        tags = tags_of(rel)
        members = [{'type': str(m.type), 'ref': int(m.ref), 'role': str(m.role or '')} for m in rel.members]
        if tags.get('name') == '长沙市' and tags.get('boundary') == 'administrative':
            if any(m['type'] == 'w' and m['role'] != 'inner' for m in members):
                self.boundaries.append({'id': int(rel.id), 'tags': tags, 'members': members})
        elif relevant_relation(tags):
            relation = {'id': int(rel.id), 'tags': tags, 'members': members}
            self.relations.append(relation)
            self.member_ids.update(m['ref'] for m in members if m['type'] == 'w')


class BoundaryWayPass(osmium.SimpleHandler):
    def __init__(self, ids):
        super().__init__()
        self.ids = ids
        self.ways = {}

    def way(self, way):
        if int(way.id) in self.ids:
            nodes = coords_of(way)
            if nodes:
                self.ways[int(way.id)] = {'id': int(way.id), 'nodes': nodes}


class CityDataPass(osmium.SimpleHandler):
    def __init__(self, boundary, bbox, keep_way_ids):
        super().__init__()
        self.boundary = boundary
        self.bbox = bbox
        self.keep_way_ids = keep_way_ids
        self.ways = {}
        self.nodes = []
        self.scanned = 0
        self.saved = 0

    def in_bbox(self, coords):
        xs = [p[0] for p in coords]
        ys = [p[1] for p in coords]
        return not (max(xs) < self.bbox[0] or min(xs) > self.bbox[2] or max(ys) < self.bbox[1] or min(ys) > self.bbox[3])

    def node(self, node):
        if not node.location.valid():
            return
        tags = tags_of(node)
        if not has_named_poi(tags) and tags.get('name') != '五一广场':
            return
        lon, lat = float(node.lon), float(node.lat)
        if not (self.bbox[0] <= lon <= self.bbox[2] and self.bbox[1] <= lat <= self.bbox[3]):
            return
        if self.boundary.covers(Point(lon, lat)):
            self.nodes.append({'id': int(node.id), 'lon': lon, 'lat': lat, 'tags': tags})

    def way(self, way):
        self.scanned += 1
        if self.scanned % 500000 == 0:
            print(f'PBF ways scanned={self.scanned:,} retained={self.saved:,}', flush=True)
        tags = tags_of(way)
        way_id = int(way.id)
        if way_id not in self.keep_way_ids and not relevant_way(tags):
            return
        nodes = coords_of(way)
        if len(nodes) < 2:
            return
        coords = [(n[1], n[2]) for n in nodes]
        if way_id not in self.keep_way_ids and not self.in_bbox(coords):
            return
        if way_id not in self.keep_way_ids:
            geom = None
            if coords[0] == coords[-1] and len(coords) >= 4 and any(k in tags for k in ('building', 'natural', 'waterway', 'landuse', 'leisure')):
                try:
                    geom = Polygon(coords)
                except Exception:
                    geom = None
            if geom is None:
                geom = LineString(coords)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty or not geom.intersects(self.boundary):
                return
        self.ways[way_id] = {'id': way_id, 'tags': tags, 'nodes': nodes}
        self.saved += 1


def main():
    # libosmium's Windows path handling is ANSI-based; keep its input path ASCII.
    os.chdir(ROOT)
    if not PBF.is_file():
        raise FileNotFoundError(PBF)
    if not SOURCE.is_file():
        raise FileNotFoundError(f'Missing source receipt: {SOURCE}')
    source = json.loads(SOURCE.read_text(encoding='utf-8'))
    actual_bytes = PBF.stat().st_size
    if source.get('bytes') != actual_bytes:
        raise RuntimeError(f'PBF size differs from source receipt: {actual_bytes} != {source.get("bytes")}')
    print('PASS 1/3: reading administrative and multipolygon relations', flush=True)
    pbf_input = PBF.relative_to(ROOT).as_posix()
    rel_pass = RelationPass()
    rel_pass.apply_file(pbf_input, locations=False)
    if not rel_pass.boundaries:
        raise RuntimeError('No relation named 长沙市 with boundary=administrative exists in this PBF')
    boundary_rel = max(rel_pass.boundaries, key=lambda r: sum(m['type'] == 'w' for m in r['members']))
    boundary_roles = {m['ref']: m['role'] for m in boundary_rel['members'] if m['type'] == 'w'}
    print(f'PASS 2/3: resolving {len(boundary_roles)} boundary member ways (no admin_level assumption)', flush=True)
    boundary_pass = BoundaryWayPass(set(boundary_roles))
    boundary_pass.apply_file(pbf_input, locations=True, idx='flex_mem')
    boundary_geom = polygon_from_members(
        [{'type': 'way', 'ref': ref, 'role': role} for ref, role in boundary_roles.items()],
        boundary_pass.ways,
    )
    if boundary_geom is None:
        raise RuntimeError(f'Could not polygonize Changsha relation {boundary_rel["id"]}; refusing to invent boundary')
    bbox = boundary_geom.bounds
    print(f'BOUNDARY relation={boundary_rel["id"]} admin_level={boundary_rel["tags"].get("admin_level")} bounds={bbox}', flush=True)

    keep_ids = set(boundary_roles) | rel_pass.member_ids
    print('PASS 3/3: streaming bounded features then exact boundary intersection', flush=True)
    data_pass = CityDataPass(boundary_geom, bbox, keep_ids)
    data_pass.apply_file(pbf_input, locations=True, idx='flex_mem')

    ways_for_relations = {**boundary_pass.ways, **data_pass.ways}
    accepted_relations = []
    unsupported_nested = 0
    for relation in rel_pass.relations:
        if any(m['type'] == 'r' for m in relation['members']):
            unsupported_nested += 1
        geom = polygon_from_members(relation['members'], ways_for_relations)
        if geom is not None and geom.intersects(boundary_geom):
            accepted_relations.append(relation)
    accepted_member_ids = {m['ref'] for r in accepted_relations for m in r['members'] if m['type'] == 'w'}
    accepted_ways = [w for wid, w in data_pass.ways.items() if wid not in rel_pass.member_ids or wid in accepted_member_ids]

    pbf_hash = hashlib.sha256()
    with PBF.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            pbf_hash.update(block)
    receipt = {**source, 'actualBytes': actual_bytes, 'actualSha256': pbf_hash.hexdigest(), 'verifiedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    boundary_payload = {
        'source': receipt,
        'relation': boundary_rel,
        'geojson': mapping(boundary_geom),
        'memberWayCount': len(boundary_roles),
        'resolvedMemberWayCount': len(boundary_pass.ways),
        'adminLevel': boundary_rel['tags'].get('admin_level'),
    }
    world_payload = {
        'source': receipt,
        'boundaryRelationId': boundary_rel['id'],
        'boundary': mapping(boundary_geom),
        'ways': accepted_ways,
        'relations': accepted_relations,
        'nodes': data_pass.nodes,
        'stats': {
            'wayCallbacks': data_pass.scanned, 'retainedWayCount': len(accepted_ways),
            'namedPoiNodeCount': len(data_pass.nodes), 'candidateRelationCount': len(rel_pass.relations),
            'retainedRelationCount': len(accepted_relations), 'nestedRelationsUnsupported': unsupported_nested,
        },
    }
    RAW.mkdir(parents=True, exist_ok=True)
    BOUNDARY_OUT.write_text(json.dumps(boundary_payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    WORLD_OUT.write_text(json.dumps(world_payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'SAVED boundary={BOUNDARY_OUT.stat().st_size:,}B ways={len(accepted_ways):,} relations={len(accepted_relations):,} namedNodes={len(data_pass.nodes):,}', flush=True)


if __name__ == '__main__':
    main()
