#!/usr/bin/env python3
"""Build the source-backed Changsha POI ledger from the official .doc and PRD seeds.

Uses Python's standard library only. The source .doc is read-only; generated files
are limited to data/pois.json, data/pois.csv, data/sources.json and the audit note.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DOC = ROOT / "data/raw/hunan-a-scenic-20250225.doc"
PRD = ROOT / "长沙方块城市漫游-PRD.md"
JSON_OUT = ROOT / "data/pois.json"
CSV_OUT = ROOT / "data/pois.csv"
SOURCES_OUT = ROOT / "data/sources.json"
AUDIT_OUT = ROOT / "docs/景点清单核对.md"
GRADES = {"5A", "4A", "3A", "2A"}

# These are source locality values, not a fuzzy text search. "望城市" is kept
# because it is the literal source value and is separately flagged for review.
CHANGSHA_LOCALITIES = {
    "长沙市", "长沙", "长沙县", "浏阳市", "宁乡市", "天心区", "开福区",
    "芙蓉区", "雨花区", "望城区", "望城市", "湖南湘江新区", "湘江新区",
}

# (name, district candidate, category, parent name, official-record merge target)
# These are the concrete named objects from the PRD's explicitly non-exhaustive
# starter list and key-scene table. Generic mentions are recorded separately.
PRD_SEEDS = [
    ("隆平水稻博物馆", "芙蓉区", "博物馆", "隆平水稻文化园景区", None, 143),
    ("马王堆汉墓墓坑遗址", "芙蓉区", "考古遗址", None, None, 143),
    ("浏阳河风光带", "芙蓉区", "线性景观", None, None, 143),
    ("浏阳河婚庆文化园", "芙蓉区", "A级景区", "浏阳河风光带", "浏阳河婚庆文化园", 143),
    ("天心阁", "天心区", "历史建筑", None, "长沙天心阁", 144),
    ("天心阁古城墙", "天心区", "历史遗迹", "天心阁", None, 144),
    ("太平街", "天心区", "历史街区", None, None, 144),
    ("贾谊故居", "天心区", "故居", None, None, 144),
    ("坡子街", "天心区", "历史街区", None, None, 144),
    ("火宫殿", "天心区", "文化游览点", None, None, 144),
    ("杜甫江阁", "天心区", "历史建筑", None, None, 144),
    ("都正街", "天心区", "历史街区", None, None, 144),
    ("白沙古井", "天心区", "历史遗迹", None, None, 144),
    ("湖南第一师范城南书院", "天心区", "历史建筑", None, None, 144),
    ("白果园与西文庙坪", "天心区", "历史街区", None, None, 144),
    ("白果园历史文化旅游街区", "天心区", "A级景区", "白果园与西文庙坪", "白果园历史文化旅游街区", 144),
    ("西文庙坪", "天心区", "历史街区", "白果园与西文庙坪", None, 144),
    ("长沙简牍博物馆", "天心区", "博物馆", None, None, 144),
    ("长沙生态动物园", "天心区", "A级景区", None, "长沙生态动物园", 144),
    ("岳麓山", "岳麓区", "山岳景区", "长沙市岳麓山-橘子洲旅游区", None, 145),
    ("岳麓山登山游道", "岳麓区", "游览路线", "岳麓山", None, 164),
    ("爱晚亭", "岳麓区", "历史建筑", "岳麓山", None, 145),
    ("麓山寺", "岳麓区", "寺庙", "岳麓山", None, 145),
    ("云麓宫", "岳麓区", "历史建筑", "岳麓山", None, 145),
    ("岳麓书院", "岳麓区", "历史建筑", "岳麓山", None, 145),
    ("新民学会旧址", "岳麓区", "历史建筑", None, None, 145),
    ("橘子洲", "岳麓区", "洲岛景区", "长沙市岳麓山-橘子洲旅游区", None, 145),
    ("橘子洲青年毛泽东艺术雕塑", "岳麓区", "雕塑地标", "橘子洲", None, 163),
    ("橘子洲洲头步道", "岳麓区", "游览路线", "橘子洲", None, 163),
    ("湖南大学公共游览节点", "岳麓区", "校园公共游览点", None, None, 145),
    ("后湖", "岳麓区", "湖泊游览区", None, None, 145),
    ("梅溪湖", "岳麓区", "湖泊游览区", None, None, 145),
    ("梅溪湖国际文化艺术中心", "岳麓区", "文化建筑", "梅溪湖", None, 145),
    ("洋湖湿地", "岳麓区", "湿地景区", None, "长沙市洋湖湿地景区", 145),
    ("洋湖水街", "岳麓区", "街区游览点", "洋湖湿地", None, 145),
    ("谢子龙影像艺术馆", "岳麓区", "美术馆", None, None, 145),
    ("李自健美术馆", "岳麓区", "美术馆", None, None, 145),
    ("巴溪洲", "岳麓区", "洲岛景区", None, "巴溪洲生态旅游景区", 145),
    ("湘江欢乐城", "岳麓区", "主题游览区", None, None, 145),
    ("长沙华谊兄弟电影小镇", "岳麓区", "主题游览区", None, "长沙华谊兄弟（长沙）电影小镇", 145),
    ("烈士公园", "开福区", "公园", None, None, 146),
    ("开福寺", "开福区", "寺庙", None, None, 146),
    ("潮宗街", "开福区", "历史街区", None, "潮宗街文化旅游区", 146),
    ("清水塘景区", "开福区", "A级景区", None, "长沙市清水塘景区", 146),
    ("长沙滨江文化园", "开福区", "A级景区", None, "长沙滨江文化园景区", 146),
    ("三馆一厅", "开福区", "文化场馆组团", "长沙滨江文化园", None, 146),
    ("长沙世界之窗", "开福区", "A级景区", None, "长沙世界之窗", 146),
    ("长沙海底世界", "开福区", "A级景区", None, "长沙海底世界", 146),
    ("长沙园林生态园", "开福区", "A级景区", None, "长沙园林生态园景区", 146),
    ("沙坪湘绣小镇", "开福区", "A级景区", None, "长沙沙坪湘绣小镇", 146),
    ("湖南省植物园", "雨花区", "植物园", None, "湖南省森林植物园", 147),
    ("湖南雨花非遗馆", "雨花区", "非遗场馆", None, "湖南雨花非遗馆", 147),
    ("圭塘河游览空间", "雨花区", "线性景观", None, None, 147),
    ("跳马乡村旅游点", "雨花区", "乡村游览点", None, None, 147),
    ("铜官窑古镇", "望城区", "A级景区", None, "长沙市新华联铜官窑古镇景区", 148),
    ("铜官窑国家考古遗址公园", "望城区", "考古遗址公园", None, "长沙铜官窑国家考古遗址公园", 148),
    ("铜官古街", "望城区", "历史街区", "铜官窑古镇", None, 148),
    ("靖港古镇", "望城区", "A级景区", None, "长沙市靖港古镇景区", 148),
    ("乔口", "望城区", "水乡游览点", None, None, 148),
    ("新康戏乡", "望城区", "A级景区", None, "望城新康戏乡景区", 148),
    ("书堂山欧阳询文化园", "望城区", "A级景区", None, "望城区书堂山欧阳询文化园", 148),
    ("黑麋峰", "望城区", "山岳景区", None, "长沙黑麋峰国家森林公园", 148),
    ("雷锋纪念馆", "望城区", "纪念馆", None, "长沙市雷锋纪念馆", 148),
    ("月亮岛", "望城区", "洲岛游览点", None, None, 148),
    ("千龙湖", "望城区", "A级景区", None, "长沙千龙湖生态旅游区", 148),
    ("松雅湖", "长沙县", "湖泊游览区", None, None, 149),
    ("杨开慧纪念馆", "长沙县", "纪念馆", None, "长沙市杨开慧纪念馆", 149),
    ("田汉文化园", "长沙县", "文化园", None, "长沙市田汉文化园旅游区", 149),
    ("黄兴故居", "长沙县", "故居", None, "长沙县黄兴故居纪念馆", 149),
    ("徐特立故居", "长沙县", "故居", None, None, 149),
    ("许光达故居", "长沙县", "故居", None, None, 149),
    ("浔龙河", "长沙县", "文旅片区", None, None, 149),
    ("金井茶园", "长沙县", "乡村游览点", None, None, 149),
    ("湘丰茶博园", "长沙县", "A级景区", None, "湘丰茶博园", 149),
    ("影珠山", "长沙县", "山岳景区", None, "长沙县影珠山景区", 149),
    ("大山冲", "长沙县", "森林游览点", None, None, 149),
    ("春华渡槽", "长沙县", "历史水利设施", None, None, 149),
    ("大围山", "浏阳市", "山岳景区", None, "长沙市大围山国家森林公园", 150),
    ("胡耀邦故里", "浏阳市", "纪念地", None, "长沙市浏阳胡耀邦故里旅游区", 150),
    ("秋收起义文家市会师旧址及纪念馆", "浏阳市", "纪念地", "长沙市浏阳秋收起义纪念园", None, 150),
    ("谭嗣同故居", "浏阳市", "故居", None, None, 150),
    ("浏阳文庙", "浏阳市", "历史建筑", None, None, 150),
    ("道吾山", "浏阳市", "山岳游览点", None, None, 150),
    ("周洛大峡谷", "浏阳市", "A级景区", None, "浏阳市周洛大峡谷景区", 150),
    ("浏阳石牛寨", "浏阳市", "A级景区", None, "浏阳石牛寨风景区", 150),
    ("赤马湖", "浏阳市", "A级景区", None, "浏阳市赤马湖风景区", 150),
    ("皇龙峡", "浏阳市", "A级景区", None, "皇龙峡生态旅游区", 150),
    ("西溪磐石大峡谷", "浏阳市", "A级景区", None, "长沙浏阳市西溪磐石大峡谷风景区", 150),
    ("官渡古镇", "浏阳市", "古镇", None, None, 150),
    ("浏阳河城区段", "浏阳市", "线性景观", None, None, 150),
    ("花炮文化游览点", "浏阳市", "文化游览点", "花炮文化博览园", None, 150),
    ("花明楼刘少奇故里", "宁乡市", "纪念地", "长沙市花明楼景区", None, 151),
    ("刘少奇故居与纪念馆", "宁乡市", "故居/纪念馆", "花明楼刘少奇故里", None, 151),
    ("炭河里国家考古遗址公园及博物馆", "宁乡市", "考古遗址与博物馆", None, None, 151),
    ("炭河古城", "宁乡市", "主题游览区", None, None, 151),
    ("沩山密印景区", "宁乡市", "A级景区", None, "长沙市沩山密印景区", 151),
    ("灰汤旅游区", "宁乡市", "温泉游览区", None, None, 151),
    ("千佛洞", "宁乡市", "A级景区", None, "长沙宁乡千佛洞", 151),
    ("迴龙山", "宁乡市", "A级景区", None, "长沙宁乡迴龙山景区", 151),
    ("方特东方神画", "宁乡市", "主题游览区", None, None, 151),
    ("资福窑", "宁乡市", "A级景区", None, "长沙资福窑景区", 151),
    ("五一广场", "芙蓉区", "城市公共空间", None, None, 153),
    ("黄兴南路步行街", "天心区", "步行街", None, None, 153),
    ("国金中心", "芙蓉区", "城市地标", None, None, 153),
    ("湘江及沿岸游览带", None, "线性景观", None, None, 153),
    ("浏阳河及沿岸游览带", None, "线性景观", None, None, 153),
    ("大围山接入路线", "浏阳市", "游览路线", "大围山", None, 170),
]

UNRESOLVED_PRD_MENTIONS = [
    {"text": "相关汉文化游览节点", "district": "芙蓉区", "prdLines": [143]},
    {"text": "岳麓山景区内未逐名列出的游道与节点", "district": "岳麓区", "prdLines": [145, 164]},
    {"text": "湖南大学标志性公共游览节点的具体名单", "district": "岳麓区", "prdLines": [145]},
    {"text": "三馆一厅的各馆厅准确名称与边界", "district": "开福区", "prdLines": [146]},
    {"text": "沙坪湘绣相关游览点（超出已列名景区的部分）", "district": "开福区", "prdLines": [146]},
    {"text": "跳马乡村旅游点逐项名单", "district": "雨花区", "prdLines": [147]},
    {"text": "乔口片区内具体游览点", "district": "望城区", "prdLines": [148]},
    {"text": "望城区官方登记乡村游览点名单", "district": "望城区", "prdLines": [148]},
    {"text": "长沙县官方旅游资料中未逐名列出的游览点", "district": "长沙县", "prdLines": [149]},
    {"text": "浏阳河城区段和花炮文化的完整游览边界", "district": "浏阳市", "prdLines": [150]},
    {"text": "宁乡市官方登记乡村游览点名单", "district": "宁乡市", "prdLines": [151]},
    {"text": "主要商业天际线的建筑逐项名单", "district": None, "prdLines": [153]},
]

DISTRICT_MAP = {
    "长沙县": ("长沙县", "source_direct"), "浏阳市": ("浏阳市", "source_direct"),
    "宁乡市": ("宁乡市", "source_direct"), "天心区": ("天心区", "source_direct"),
    "开福区": ("开福区", "source_direct"), "芙蓉区": ("芙蓉区", "source_direct"),
    "雨花区": ("雨花区", "source_direct"), "望城区": ("望城区", "source_direct"),
    "望城市": (None, "source_value_needs_review"), "长沙市": (None, "city_only_needs_district"),
    "长沙": (None, "city_abbreviation_needs_review"), "湖南湘江新区": (None, "management_area_to_county_district_unresolved"),
    "湘江新区": (None, "management_area_to_county_district_unresolved"),
}

OLD_2024_4A_NAMES = [
    "长沙世界之窗", "长沙海底世界", "长沙天心阁", "湖南省博物馆", "长沙市雷锋纪念馆",
    "长沙市大围山国家森林公园", "长沙市杨开慧纪念馆", "长沙市靖港古镇景区", "长沙市浏阳苍坊旅游区",
    "长沙生态动物园", "湖南省森林植物园", "石燕湖生态旅游景区", "长沙市宁乡紫龙湾旅游区",
    "长沙市沩山密印景区", "长沙市洋湖湿地景区", "长沙市关山旅游区", "长沙黑麋峰国家森林公园",
    "长沙千龙湖生态旅游区", "长沙市浏阳秋收起义纪念园", "长沙市新华联铜官窑古镇景区",
    "长沙市田汉文化园旅游区", "长沙滨江文化园景区", "长沙铜官窑国家考古遗址公园",
    "长沙市望城光明大观园景区", "长沙县影珠山景区", "长沙华谊兄弟(长沙)电影小镇",
    "长沙县天华山旅游景区", "长沙园林生态园景区", "隆平水稻文化园景区", "浏阳市周洛大峡谷景区",
]

OLD_NAME_EQUIVALENTS = {
    "长沙市浏阳苍坊旅游区": "长沙市浏阳胡耀邦故里旅游区",
    "长沙县天华山旅游景区": "长沙县天华山景区",
    "长沙华谊兄弟(长沙)电影小镇": "长沙华谊兄弟（长沙）电影小镇",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def cfb_streams(path: Path) -> dict[str, bytes]:
    data = path.read_bytes()
    if data[:8] != bytes.fromhex("d0cf11e0a1b11ae1"):
        raise ValueError("Input is not an OLE CFB document")
    sector_size = 1 << struct.unpack_from("<H", data, 30)[0]
    if sector_size != 512:
        raise ValueError(f"Unsupported CFB sector size: {sector_size}")
    fat_count = struct.unpack_from("<I", data, 44)[0]
    dir_start = struct.unpack_from("<I", data, 48)[0]
    difat = struct.unpack_from("<109I", data, 76)
    fat_sectors = [s for s in difat if s < 0xFFFFFFFA][:fat_count]
    if len(fat_sectors) != fat_count:
        raise ValueError("CFB FAT sector chain needs unsupported DIFAT extension")

    def sector(sid: int) -> bytes:
        start = (sid + 1) * sector_size
        chunk = data[start:start + sector_size]
        if len(chunk) != sector_size:
            raise ValueError(f"Truncated CFB sector {sid}")
        return chunk

    fat: list[int] = []
    for sid in fat_sectors:
        fat.extend(struct.unpack(f"<{sector_size // 4}I", sector(sid)))

    def chain(start: int) -> list[int]:
        out: list[int] = []
        seen: set[int] = set()
        sid = start
        while sid < 0xFFFFFFFA and sid not in seen:
            if sid >= len(fat):
                raise ValueError("CFB chain points outside FAT")
            seen.add(sid)
            out.append(sid)
            sid = fat[sid]
        if sid in seen:
            raise ValueError("Cycle in CFB sector chain")
        return out

    directory_chain = chain(dir_start)
    directory = b"".join(sector(sid) for sid in directory_chain)
    entries = []
    for offset in range(0, len(directory), 128):
        entry = directory[offset:offset + 128]
        if len(entry) != 128:
            continue
        name_len = struct.unpack_from("<H", entry, 64)[0]
        obj_type = entry[66]
        if obj_type == 0 or name_len < 2:
            continue
        name = entry[:name_len - 2].decode("utf-16le", errors="strict")
        start = struct.unpack_from("<I", entry, 116)[0]
        size = struct.unpack_from("<Q", entry, 120)[0]
        entries.append((name, obj_type, start, size))

    streams = {}
    for name, obj_type, start, size in entries:
        if obj_type != 2 or start >= 0xFFFFFFFA or size == 0:
            continue
        raw = b"".join(sector(sid) for sid in chain(start))[:size]
        streams[name] = raw
    return streams


def clean_cell(value: str) -> str:
    # Word table cells can contain a paragraph break caused by wrapping/page flow.
    value = value.replace("\r", "").replace("\n", "")
    return re.sub(r"\s+", " ", value).strip()


def parse_a_grade_rows() -> tuple[list[dict], dict]:
    streams = cfb_streams(RAW_DOC)
    word = streams.get("WordDocument")
    if not word:
        raise ValueError("CFB WordDocument stream is missing")
    fc_min, fc_mac = struct.unpack_from("<II", word, 24)
    if not (32 <= fc_min < fc_mac <= len(word)):
        raise ValueError(f"Invalid FIB text bounds: fcMin={fc_min}, fcMac={fc_mac}, stream={len(word)}")
    text = word[fc_min:fc_mac].decode("utf-16le", errors="strict")
    if "湖南省A级旅游景区名录表" not in text or "截至2025年1月底" not in text:
        raise ValueError("FIB text-range header/cutoff validation failed")
    cells = text.split("\x07")
    all_rows: list[dict] = []
    formats = Counter()
    for i, cell in enumerate(cells):
        grade = cell.strip()
        if grade not in GRADES:
            continue
        if i == 0 or i + 1 >= len(cells):
            raise ValueError(f"Grade cell is at document boundary: {i}")
        if clean_cell(cells[i + 1]):
            name, locality, layout = cells[i - 1], cells[i + 1], "name-grade-location"
        else:
            if i < 2:
                raise ValueError(f"Grade row lacks preceding name/location cells: {i}")
            name, locality, layout = cells[i - 2], cells[i - 1], "name-location-grade"
        name = clean_cell(name)
        locality = clean_cell(locality)
        if not name or not locality:
            raise ValueError(f"Empty name/locality at grade cell {i}")
        formats[layout] += 1
        all_rows.append({
            "sourceRowOrdinal": len(all_rows) + 1,
            "sourceCellIndex": i,
            "name": name,
            "rawName": cells[i - 1] if layout == "name-grade-location" else cells[i - 2],
            "locality": locality,
            "grade": grade,
            "layout": layout,
        })

    grade_counts = Counter(row["grade"] for row in all_rows)
    expected = Counter({"5A": 13, "4A": 200, "3A": 470, "2A": 11})
    if len(all_rows) != 694 or grade_counts != expected:
        raise ValueError(f"Official source row validation failed: rows={len(all_rows)}, grades={dict(grade_counts)}")
    selected = [r for r in all_rows if r["locality"] in CHANGSHA_LOCALITIES]
    selected_counts = Counter(r["grade"] for r in selected)
    if len(selected) != 84 or selected_counts != Counter({"5A": 2, "4A": 32, "3A": 50}):
        raise ValueError(f"Changsha locality validation failed: rows={len(selected)}, grades={dict(selected_counts)}")
    diagnostics = {
        "fibFcMin": fc_min, "fibFcMac": fc_mac, "textEncoding": "UTF-16LE",
        "gradeCells": len(all_rows), "gradeCounts": dict(grade_counts),
        "changshaSourceRows": len(selected), "changshaGradeCounts": dict(selected_counts),
        "rowLayouts": dict(formats), "rawLocalityCounts": dict(sorted(Counter(r["locality"] for r in selected).items())),
        "allRows": all_rows,
    }
    return selected, diagnostics


def norm(value: str) -> str:
    return re.sub(r"[\s\-—–（）()·、，,。:：]", "", value).lower()


def make_sources(diagnostics: dict, qing_matches: list[dict]) -> dict:
    source_4a_names = {
        norm(row["name"]): row["name"]
        for row in diagnostics["allRows"]
        if row["grade"] == "4A" and row["locality"] in CHANGSHA_LOCALITIES
    }
    reconciled = []
    handbook_only = []
    matched_current = set()
    for old_name in OLD_2024_4A_NAMES:
        current_name = OLD_NAME_EQUIVALENTS.get(old_name, old_name)
        current_key = norm(current_name)
        if current_key in source_4a_names:
            reconciled.append({"handbookName": old_name, "2025SourceName": source_4a_names[current_key]})
            matched_current.add(current_key)
        else:
            handbook_only.append(old_name)
    if len(reconciled) != 30:
        raise ValueError(f"2024/2025 official 4A cross-check found only {len(reconciled)}/30 matches")
    only_2025 = [name for key, name in source_4a_names.items() if key not in matched_current]
    expected_only_2025 = {"长沙县三珍虎园景区", "长沙浏阳市西溪磐石大峡谷风景区"}
    if {norm(name) for name in only_2025} != {norm(name) for name in expected_only_2025} or handbook_only:
        raise ValueError(f"2024/2025 4A delta check changed: only2025={only_2025}, only2024={handbook_only}")
    variants = [
        {"2024": match["handbookName"], "2025": match["2025SourceName"]}
        for match in reconciled if norm(match["handbookName"]) != norm(match["2025SourceName"])
    ]
    return {
        "schemaVersion": 1,
        "retrievedAt": "2026-10-14",
        "sources": [
            {
                "id": "hunan-a-20250225",
                "title": "湖南省A级旅游景区名录表（截至2025年1月底）",
                "publisher": "湖南省文化和旅游厅",
                "publishedAt": "2025-02-25",
                "sourceCutoff": "2025-01-31",
                "url": "https://whhlyt.hunan.gov.cn/whhlyt/cyfz/ggxxcx/lyajjqcx/202404/t20240407_33271070.html",
                "attachmentPath": "data/raw/hunan-a-scenic-20250225.doc",
                "attachmentBytes": RAW_DOC.stat().st_size,
                "attachmentSha256": sha256(RAW_DOC),
                "parser": {
                    "method": "CFB/OLE directory and FAT chain, WordDocument stream; FIB fcMin/fcMac range; UTF-16LE; grade-cell and adjacent table-cell extraction",
                    "evidence": {k: v for k, v in diagnostics.items() if k != "allRows"},
                    "validation": "694 non-empty name/locality rows; grade counts match 13/200/470/11; Changsha locality values yield 84 rows (2/32/50/0)",
                },
                "completeness": "Complete extraction of rows present in this attachment; not proof that the attachment is a current 2026 census.",
            },
            {
                "id": "hunan-4a-handbook-20241223",
                "title": "2024湖南简况手册：184个4A景区",
                "publisher": "湖南省人民政府门户网站",
                "publishedAt": "2024-12-23",
                "url": "https://www.hunan.gov.cn/topic/2020hnjksc/jkscwzewm/202412/t20241223_33533686.html",
                "evidence": "正文列出长沙市4A景区30个；与2025名录按名称及两处明确名称变体核对。",
                "comparison": {
                    "handbookCount": 30,
                    "matchedTo2025Source": len(reconciled),
                    "matchedNames": reconciled,
                    "nameVariants": variants,
                    "2025OnlyComparedWithHandbook": only_2025,
                    "handbookOnlyAfterNameReconciliation": handbook_only,
                    "handbookNameInventory": OLD_2024_4A_NAMES,
                    "note": "这里核对的是两个官方页面所列名称，不据此判定升降级、撤销或实际范围变化。",
                },
            },
            {
                "id": "hunan-qingshuitang-20260803",
                "title": "关于确定8家旅游景区为4A级旅游景区的公告",
                "publisher": "湖南省旅游景区质量等级评定委员会 / 湖南省文化和旅游厅",
                "publishedAt": "2026-08-03",
                "url": "https://whhlyt.hunan.gov.cn/whhlyt/xxgk2019/xxgkml/tzgg/202608/t20260803_34038645.html",
                "exactStatement": "公告将“长沙市清水塘景区”列入正式确定为国家4A级旅游景区的8家名单。",
                "all2025RowsNameAliasScan": {"terms": ["清水塘", "中共湘区委员会旧址", "中国共产党长沙历史馆"], "matches": qing_matches},
                "note": "未在2025名录全省694个记录名中发现上述名称/别名；故独立登记新记录。地址及是否与PRD所指具体游览边界相同仍待核。",
            },
            {
                "id": "prd-candidates-20261014",
                "title": "长沙方块城市漫游 PRD 的景点策划起始清单与典型场景",
                "publisher": "项目PRD",
                "file": PRD.name,
                "fileSha256": sha256(PRD),
                "evidenceLines": [143, 153, 163, 170],
                "url": None,
                "status": "Candidate seeds only; PRD explicitly says the list is not complete.",
                "note": "记录为待核候选。名字、行政区、开放状态、可参观边界需后续官方逐项核验。",
            },
        ],
    }


def build_records(source_rows: list[dict], diagnostics: dict) -> tuple[list[dict], list[dict]]:
    records: list[dict] = []
    by_norm: dict[str, dict] = {}
    for row in source_rows:
        district, district_status = DISTRICT_MAP[row["locality"]]
        poi = {
            "id": f"cs-a-2025-{row['sourceRowOrdinal']:04d}",
            "name": row["name"],
            "district": district,
            "category": "A级景区",
            "aliases": [],
            "position": None,
            "world": None,
            "model": None,
            "sourceIds": ["hunan-a-20250225"],
            "status": "listed_in_official_source",
            "grade": row["grade"],
            "administrativeLocationRaw": row["locality"],
            "districtResolution": district_status,
            "sourceEvidence": {
                "sourceRowOrdinal": row["sourceRowOrdinal"],
                "sourceCellIndex": row["sourceCellIndex"],
                "rawName": row["rawName"],
                "rawAffiliation": row["locality"],
                "rowLayout": row["layout"],
                "sourceCutoff": "2025-01-31",
            },
            "parentId": None,
        }
        records.append(poi)
        by_norm[norm(poi["name"])] = poi

    def find_official(target: str) -> dict | None:
        return by_norm.get(norm(target))

    # Check all 694 source names, including non-Changsha rows, before applying
    # the verified 2026 Qing Shuitang increment.
    q_terms = ("清水塘", "中共湘区委员会旧址", "中国共产党长沙历史馆")
    q_matches = [r for r in diagnostics["allRows"] if any(term in r["name"] for term in q_terms)]
    if q_matches:
        q_record = next((find_official(r["name"]) for r in source_rows if any(t in r["name"] for t in q_terms)), None)
        if q_record is None:
            raise ValueError("Potential Qing Shuitang duplicate found in provincial source; manual deduplication required")
        q_record["sourceIds"].append("hunan-qingshuitang-20260803")
        q_record["gradeHistory"] = [{"grade": q_record["grade"], "sourceId": "hunan-a-20250225", "cutoff": "2025-01-31"}, {"grade": "4A", "sourceId": "hunan-qingshuitang-20260803", "date": "2026-08-03"}]
        q_record["status"] = "officially_reconfirmed_or_updated_4A_same_source_entity_review_boundary"
        q_record["sourceEvidence"]["increment"] = "hunan-qingshuitang-20260803"
    else:
        q_record = {
            "id": "cs-a-2026-qingshuitang",
            "name": "长沙市清水塘景区",
            "district": None,
            "districtCandidate": "开福区",
            "category": "A级景区",
            "aliases": ["清水塘景区"],
            "position": None,
            "world": None,
            "model": None,
            "sourceIds": ["hunan-qingshuitang-20260803", "prd-candidates-20261014"],
            "status": "official_4A_increment_district_candidate_from_prd",
            "grade": "4A",
            "administrativeLocationRaw": "长沙市",
            "districtResolution": "开福区 is the PRD's candidate assignment; official announcement names city only",
            "sourceEvidence": {"announcementDate": "2026-08-03", "nameAliasScan": "No match among 694 names in 2025 provincial source"},
            "parentId": None,
        }
        records.append(q_record)
        by_norm[norm(q_record["name"])] = q_record

    # Apply hand-reviewed explicit synonym targets; never fuzzy-merge names.
    for name, district, category, parent_name, merge_target, prd_line in PRD_SEEDS:
        merged = find_official(merge_target) if merge_target else None
        if merged:
            if name not in merged["aliases"] and name != merged["name"]:
                merged["aliases"].append(name)
            if "prd-candidates-20261014" not in merged["sourceIds"]:
                merged["sourceIds"].append("prd-candidates-20261014")
            merged.setdefault("candidateMentions", []).append({"name": name, "districtCandidate": district, "prdLine": prd_line, "mergeNote": "explicit PRD-to-source name mapping; verify identity and boundary"})
            if parent_name:
                merged["parentNameForLink"] = parent_name
            if merged["district"] is None and district:
                merged["districtCandidate"] = district
                merged["districtResolution"] = f"candidate from PRD line {prd_line}; official A-list affiliation is {merged['administrativeLocationRaw']}"
            if "nameVariantNeedsReview" in merged and name not in merged["nameVariantNeedsReview"]:
                merged["nameVariantNeedsReview"].append(name)
            continue

        # Keep candidate names separate where no explicit source identity is given.
        if norm(name) in by_norm:
            existing = by_norm[norm(name)]
            existing.setdefault("candidateMentions", []).append({"name": name, "districtCandidate": district, "prdLine": prd_line, "mergeNote": "exact normalized name"})
            if "prd-candidates-20261014" not in existing["sourceIds"]:
                existing["sourceIds"].append("prd-candidates-20261014")
            continue
        pid = "cs-prd-" + hashlib.sha1(norm(name).encode("utf-8")).hexdigest()[:10]
        poi = {
            "id": pid,
            "name": name,
            "district": district,
            "category": category,
            "aliases": [],
            "position": None,
            "world": None,
            "model": None,
            "sourceIds": ["prd-candidates-20261014"],
            "status": "candidate_requires_verification",
            "grade": None,
            "administrativeLocationRaw": None,
            "districtResolution": "candidate_from_prd",
            "parentNameForLink": parent_name,
            "sourceEvidence": {"prdLines": [prd_line], "basis": "non-exhaustive PRD starting list / key-scene table"},
            "parentId": None,
        }
        records.append(poi)
        by_norm[norm(name)] = poi

    # Preserve official 2024 name variants as searchable aliases on matching rows.
    for old, current in OLD_NAME_EQUIVALENTS.items():
        target = find_official(current)
        if target and old not in target["aliases"]:
            target["aliases"].append(old)
            target.setdefault("nameVariantNeedsReview", []).append(old)

    # Resolve parent links by exact normalized title or explicit aliases.
    title_index = {}
    for r in records:
        title_index[norm(r["name"])] = r
        for alias in r.get("aliases", []):
            title_index.setdefault(norm(alias), r)
    for r in records:
        parent_name = r.pop("parentNameForLink", None)
        if parent_name:
            parent = title_index.get(norm(parent_name))
            if parent and parent["id"] != r["id"]:
                r["parentId"] = parent["id"]
            else:
                r["parentLinkNeedsReview"] = parent_name

    # Keep only non-empty, unique source identifiers and aliases.
    ids = [r["id"] for r in records]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate generated POI IDs")
    for r in records:
        r["sourceIds"] = list(dict.fromkeys(r["sourceIds"]))
        r["aliases"] = list(dict.fromkeys(r["aliases"]))
    return records, q_matches


def main() -> None:
    if not RAW_DOC.is_file() or not PRD.is_file():
        raise SystemExit("Required source file missing")
    selected, diagnostics = parse_a_grade_rows()
    records, q_matches = build_records(selected, diagnostics)
    sources = make_sources(diagnostics, q_matches)
    source_ids = {s["id"] for s in sources["sources"]}
    if any(sid not in source_ids for r in records for sid in r["sourceIds"]):
        raise ValueError("POI references a missing source ID")

    official_base = [r for r in records if r["id"].startswith("cs-a-2025-")]
    candidate_only = [r for r in records if r["status"] == "candidate_requires_verification"]
    district_counts = Counter(r["administrativeLocationRaw"] for r in official_base)
    data = {
        "schemaVersion": 1,
        "city": "长沙市",
        "asOf": "2026-10-14",
        "scope": ["芙蓉区", "天心区", "岳麓区", "开福区", "雨花区", "望城区", "长沙县", "浏阳市", "宁乡市"],
        "counts": {
            "records": len(records),
            "officialChangshaRowsFrom2025Source": len(official_base),
            "officialIncrementRecords": len([r for r in records if "hunan-qingshuitang-20260803" in r["sourceIds"]]),
            "prdOnlyCandidates": len(candidate_only),
            "coordinatesAssigned": sum(1 for r in records if r["position"] is not None),
            "worldPositionsAssigned": sum(1 for r in records if r["world"] is not None),
            "officialSourceGrades": dict(Counter(r["grade"] for r in official_base)),
        },
        "sourceCoverage": {
            "officialAList": {
                "sourceId": "hunan-a-20250225",
                "sourceStatedCutoff": "2025-01-31",
                "provinceRowsExtracted": 694,
                "changshaRowsByExactSourceLocality": 84,
                "changshaGradeCounts": {"5A": 2, "4A": 32, "3A": 50, "2A": 0},
                "rawChangshaLocalityCounts": diagnostics["rawLocalityCounts"],
                "status": "Complete extraction for the rows present in the attachment; later cancellations, name changes and other updates are not comprehensively reconciled through 2026-10-14.",
            },
            "postCutoffOfficialChanges": {
                "verifiedAdditions": ["长沙市清水塘景区 (4A, 2026-08-03)"],
                "status": "One formal city-relevant 4A announcement checked. Do not interpret the number as a current full census until all later notices/revocations are audited.",
            },
            "prdSupplement": {
                "sourceId": "prd-candidates-20261014",
                "candidateRecordsAfterExplicitMerges": len(candidate_only),
                "status": "PRD starter list and key scene names only; explicitly not exhaustive. Does not prove all public-cultural, urban-tourism, rural-tourism or non-A attractions have been found.",
                "unresolvedMentions": UNRESOLVED_PRD_MENTIONS,
            },
            "geography": {
                "positionAndWorldAreNull": True,
                "unresolvedAdminAssignments": sorted({r["administrativeLocationRaw"] for r in official_base if r["district"] is None}),
                "status": "Coordinates and world positions intentionally left null for the main agent's source-backed GIS matching.",
            },
        },
        "records": records,
    }

    JSON_OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with CSV_OUT.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "name", "district", "category", "grade", "aliases", "position", "world", "sourceIds", "status", "parentId", "administrativeLocationRaw"])
        for r in records:
            writer.writerow([r["id"], r["name"], r["district"] or "", r["category"], r["grade"] or "", "|".join(r["aliases"]), "", "", "|".join(r["sourceIds"]), r["status"], r["parentId"] or "", r["administrativeLocationRaw"] or ""])
    SOURCES_OUT.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    loc_rows = "\n".join(f"| {loc} | {count} |" for loc, count in sorted(diagnostics["rawLocalityCounts"].items()))
    candidate_count = len(candidate_only)
    comparison = next(x["comparison"] for x in sources["sources"] if x["id"] == "hunan-4a-handbook-20241223")
    variant_text = "；".join(f"{v['2024']} → {v['2025']}" for v in comparison["nameVariants"])
    delta_text = "、".join(comparison["2025OnlyComparedWithHandbook"])
    doc = f"""# 长沙景点台账核对记录

基准日期：2026-10-14。机器台账：`data/pois.json` / `data/pois.csv`；生成器：`scripts/prepare_pois.py`。

## 可核验的 A 级名录抽取

- 原始来源：湖南省文化和旅游厅 2025-02-25 发布的《湖南省A级旅游景区名录表》，附件标题注明“截至2025年1月底”。原件为 `data/raw/hunan-a-scenic-20250225.doc`，SHA-256：`{sha256(RAW_DOC)}`。
- 解析方法：只读 CFB/OLE `WordDocument` 流；读取 FIB `fcMin={diagnostics['fibFcMin']}`、`fcMac={diagnostics['fibFcMac']}` 指定的正文范围，按 UTF-16LE 解码；等级单元格前后解析名录表格的两种邻格次序。
- 全省附件抽取到 {diagnostics['gradeCells']} 条非空名称/归属记录，等级计数 5A={diagnostics['gradeCounts'].get('5A', 0)}、4A={diagnostics['gradeCounts'].get('4A', 0)}、3A={diagnostics['gradeCounts'].get('3A', 0)}、2A={diagnostics['gradeCounts'].get('2A', 0)}。解析布局计数：`{json.dumps(diagnostics['rowLayouts'], ensure_ascii=False)}`。每条抽取行均保留原名、原归属、等级、原顺序及单元格索引。
- 以附件原始归属字段的明确长沙取值筛选，得到 84 条：5A=2、4A=32、3A=50、2A=0。原始归属计数如下，归属原文保存在记录中：

| 原始归属 | 条数 |
| --- | ---: |
{loc_rows}

## 名称核对与后续公告

- 与湖南省人民政府 2024-12-23《2024湖南简况手册》列出的长沙30个4A景区逐名核对：{comparison['matchedTo2025Source']}项都能在2025附件找到；名称差异为：{variant_text}；2025附件另列{delta_text}。这里只做名称比对，不推断升降级或范围变化。
- 对2025年全省694条原名扫描“清水塘”“中共湘区委员会旧址”“中国共产党长沙历史馆”，未发现命中。湖南省旅游景区质量等级评定委员会2026-08-03公告明确把“长沙市清水塘景区”确定为4A，因此将公告记录合入台账；区县归属仍是 PRD 候选，须用地址/边界再核。

## 补充候选与未闭合范围

- 从 PRD 的九区县起始策划清单、城市线性对象和典型场景提取具体命名项；与 A 级记录通过显式别名映射合并后，仍有 {candidate_count} 条 PRD 候选记录待核。候选不等于完整开放景点，也不代表已经制作或还原。
- PRD 本身说明该清单“并非完整名录”。未逐项列名的汉文化节点、乡村旅游点、三馆一厅组成、主要天际线等保存在 JSON 的 `sourceCoverage.prdSupplement.unresolvedMentions`。
- 不能据此宣称已经穷尽全长沙的博物馆、纪念馆、可参观文保点、城市公园/街区/水岸、乡村和工业旅游点。2025-01-31至2026-10-14的全部新增、撤销、改名公告还没有做全量对账。
- 原文归属“望城市”未静默纠正；“长沙市”“长沙”以及“湘江新区”类没有精确映射到 PRD 九个县级行政单位，统一保留原归属并将 `district` 留空或标记候选。
- 所有记录 `position`、`world` 当前为 null；坐标由主代理使用已下载的真实地理数据另行匹配。没有填造任何坐标。

## 当前生成计数

| 集合 | 数量 |
| --- | ---: |
| 2025 官方附件长沙行 | 84 |
| 2026 官方增补记录 | {data['counts']['officialIncrementRecords']} |
| PRD 独立候选（显式合并后） | {candidate_count} |
| 台账记录总数 | {len(records)} |
| 有坐标记录 | 0 |

运行 `python scripts/prepare_pois.py` 可重建三份机器数据；生成器遇到附件结构、截止日或行数/等级计数不一致时会失败退出。
"""
    AUDIT_OUT.write_text(doc, encoding="utf-8")
    print(json.dumps({
        "written": [str(JSON_OUT.relative_to(ROOT)), str(CSV_OUT.relative_to(ROOT)), str(SOURCES_OUT.relative_to(ROOT)), str(AUDIT_OUT.relative_to(ROOT))],
        "rawDocSha256": sha256(RAW_DOC),
        "officialProvinceGrades": diagnostics["gradeCounts"],
        "changshaRows": len(official_base),
        "changshaGrades": data["counts"]["officialSourceGrades"],
        "layouts": diagnostics["rowLayouts"],
        "candidateOnly": candidate_count,
        "totalRecords": len(records),
        "qingshuitangSourceMatches": q_matches,
        "allCoordinatesNull": all(r["position"] is None and r["world"] is None for r in records),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
