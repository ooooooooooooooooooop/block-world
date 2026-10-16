"""Extract source-backed OSM geocode candidates for still-unlocated Changsha POIs.

Run from the repository root: python scripts/extract_named_pois.py
"""
from collections import defaultdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
PBF_RELATIVE = "data/raw/hunan-latest.osm.pbf"
OUTPUT = ROOT / "data" / "extra-geocodes.json"
sys.path.insert(0, str(ROOT / ".python-deps"))

from link_pois import ALIASES, normalized  # noqa: E402
import osmium  # noqa: E402

# These are supported by official government pages. The Yang Kaihui page treats
# the memorial scenic area as a complex containing the former residence; it is
# used only for a record whose official name identifies that scenic area.
VERIFIED_ALIAS_SOURCES = [
    {
        "targetNeedle": "杨开慧纪念馆",
        "aliases": ["杨开慧纪念馆景区", "杨开慧故居"],
        "sourceTitle": "杨开慧故居",
        "sourceUrl": "https://hunan.gov.cn/hnszf/c101474/202108/t20210827_20403654.html",
        "reason": "湖南省政府页面称杨开慧纪念馆景区由故居、陵园和陈列馆等组成；此点位仍只是场景候选，不代表具体入口。",
    },
    {
        "targetNeedle": "洋湖湿地",
        "aliases": ["洋湖国家湿地公园"],
        "sourceTitle": "探寻洋湖国家湿地公园的前世今生",
        "sourceUrl": "https://lyj.hunan.gov.cn/lyj/xxgk_71167/gzdt/mtkl/202602/t20260206_33911784.html",
        "reason": "湖南省林业局以“洋湖国家湿地公园”为正式名称；用于 PRD/台账“洋湖湿地”目标的名称匹配。",
    },
]

# Broad bounds of the source province snapshot. These guard against malformed
# or non-WGS84 coordinates; they do not assert a Changsha administrative point.
BOUNDS = {"minLon": 108.0, "maxLon": 115.0, "minLat": 24.0, "maxLat": 31.0}


def tag_map(obj):
    return {tag.k: tag.v for tag in obj.tags}


def name_variants(tags):
    for key in ("name", "name:zh", "alt_name", "alt_name:zh"):
        value = tags.get(key, "").strip()
        if value:
            for variant in value.split(";"):
                variant = variant.strip()
                if variant:
                    yield variant


def target_name_keys(poi):
    keys = {}
    canonical = poi.get("name", "").strip()
    if canonical:
        keys[normalized(canonical)] = ("exact-match", None)
    for alias_group in VERIFIED_ALIAS_SOURCES:
        if alias_group["targetNeedle"] in normalized(canonical):
            for alias in alias_group["aliases"]:
                keys[normalized(alias)] = ("verified-alias", alias_group)
    return {key: value for key, value in keys.items() if len(key) > 1}


def point_in_ring(x, z, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, z1 = previous
        x2, z2 = current
        # Treat a point on an edge as inside the administrative polygon.
        cross = (x - x1) * (z2 - z1) - (z - z1) * (x2 - x1)
        if abs(cross) <= 1e-6 and min(x1, x2) - 1e-6 <= x <= max(x1, x2) + 1e-6 and min(z1, z2) - 1e-6 <= z <= max(z1, z2) + 1e-6:
            return True
        if (z1 > z) != (z2 > z):
            crossing_x = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def in_changsha_boundary(lon, lat, rings):
    x = math.radians(lon - 113.0) * 6371008.8 * math.cos(math.radians(28.2))
    z = -math.radians(lat - 28.2) * 6371008.8
    return any(point_in_ring(x, z, ring) for ring in rings)


def main():
    if Path.cwd().resolve() != ROOT.resolve():
        raise RuntimeError("Run this script with the repository root as the working directory.")
    pbf = ROOT / PBF_RELATIVE
    if not pbf.is_file():
        raise FileNotFoundError(pbf)

    catalog = json.loads((ROOT / "data" / "pois.json").read_text(encoding="utf-8"))
    targets = [p for p in catalog["records"] if p.get("position") is None and p.get("status") != "public-map-candidate"]
    key_index = defaultdict(list)
    for poi in targets:
        for key, (method, evidence) in target_name_keys(poi).items():
            key_index[key].append((poi, method, evidence))

    map_data = json.loads((ROOT / "data" / "map.json").read_text(encoding="utf-8"))
    boundary_rings = map_data.get("boundary")
    if not boundary_rings:
        raise ValueError("data/map.json has no boundary polygon")
    # Normalize either a single flat ring or the current list-of-rings shape.
    if boundary_rings and isinstance(boundary_rings[0][0], (int, float)):
        boundary_rings = [boundary_rings]

    output_records = []
    seen = set()
    stats = {"namedNodesScanned": 0, "namedWaysScanned": 0, "invalidNodeCoordinates": 0,
             "waysWithoutCompleteGeometry": 0, "namedObjectsMatched": 0}

    def record_match(name, lon, lat, osm_type, osm_id, tags, coordinate_method):
        if not (BOUNDS["minLon"] <= lon <= BOUNDS["maxLon"] and BOUNDS["minLat"] <= lat <= BOUNDS["maxLat"]):
            return
        key = normalized(name)
        matches = key_index.get(key, [])
        if not matches:
            return
        stats["namedObjectsMatched"] += 1
        for poi, method, evidence in matches:
            identity = (poi["id"], osm_type, str(osm_id))
            if identity in seen:
                continue
            seen.add(identity)
            record = {
                "name": name,
                "lon": lon,
                "lat": lat,
                "osmType": osm_type,
                "osmId": int(osm_id),
                "tags": tags,
                "matchedPoiId": poi["id"],
                "matchMethod": method,
                "coordinateMethod": coordinate_method,
                "inChangshaBoundary": in_changsha_boundary(lon, lat, boundary_rings),
            }
            if evidence:
                record["aliasEvidence"] = {
                    "sourceTitle": evidence["sourceTitle"],
                    "url": evidence["sourceUrl"],
                    "reason": evidence["reason"],
                }
            output_records.append(record)

    class NamedObjectHandler(osmium.SimpleHandler):
        def node(self, node):
            tags = tag_map(node)
            variants = list(name_variants(tags))
            if not variants:
                return
            stats["namedNodesScanned"] += 1
            if not node.location.valid():
                stats["invalidNodeCoordinates"] += 1
                return
            # Each text variant carries its own match type (name, Chinese name,
            # or alternate name) while the full original tag set is retained.
            for variant in variants:
                record_match(variant, node.location.lon, node.location.lat,
                             "node", node.id, tags, "node-location-wgs84")

        def way(self, way):
            tags = tag_map(way)
            variants = list(name_variants(tags))
            if not variants:
                return
            stats["namedWaysScanned"] += 1
            refs = list(way.nodes)
            if not refs or any(not ref.location.valid() for ref in refs):
                stats["waysWithoutCompleteGeometry"] += 1
                return
            lon = sum(ref.location.lon for ref in refs) / len(refs)
            lat = sum(ref.location.lat for ref in refs) / len(refs)
            for variant in variants:
                record_match(variant, lon, lat, "way", way.id, tags,
                             "way-vertex-mean-wgs84")

    # Use the required ASCII relative path and locations=True so ways carry
    # their complete node coordinates on Windows as well as Unix.
    NamedObjectHandler().apply_file(PBF_RELATIVE, locations=True)

    counts = {
        **stats,
        "targetUnlocatedPois": len(targets),
        "officialTargets": sum(p.get("status") in ("listed_in_official_source", "official_4A_increment_district_candidate_from_prd") for p in targets),
        "prdTargets": sum(p.get("status") == "candidate_requires_verification" for p in targets),
        "matchRecords": len(output_records),
        "uniqueMatchedPois": len({r["matchedPoiId"] for r in output_records}),
        "exactMatches": sum(r["matchMethod"] == "exact-match" for r in output_records),
        "verifiedAliases": sum(r["matchMethod"] == "verified-alias" for r in output_records),
        "unmatchedTargetPois": len({p["id"] for p in targets} - {r["matchedPoiId"] for r in output_records}),
        "legacyAliasMappingsReviewed": len(ALIASES),
        "provinceBounds": BOUNDS,
        "insideChangshaBoundary": sum(r["inChangshaBoundary"] for r in output_records),
        "outsideChangshaBoundary": sum(not r["inChangshaBoundary"] for r in output_records),
    }
    payload = {
        "schemaVersion": 1,
        "source": {
            "file": PBF_RELATIVE,
            "provider": "Geofabrik Hunan OSM snapshot",
            "url": "https://download.geofabrik.de/asia/china/hunan.html",
            "license": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors",
            "coordinateSystem": "WGS84",
            "warning": "Named-object coordinates are location candidates, not verified entrances.",
        },
        "matching": "normalized exact target name or explicitly sourced alias; no fuzzy matches",
        "boundaryCheck": {"source": "data/map.json#boundary", "method": "point-in-polygon after converting WGS84 with origin 113,28.2 and radius 6371008.8 m"},
        "counts": counts,
        "records": output_records,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(counts, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
