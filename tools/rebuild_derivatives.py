#!/usr/bin/env python3
"""
Rebuild derived GeoJSON layers from the authoritative base inputs.

v142 scope:
- rebuilds administrative boundary-level overlays from data/admin/admin_YYYY.geojson;
- writes data/derived_manifest.json with source hashes and generated outputs;
- intentionally treats generated layers as rebuildable cache, not hand-edited sources.

Authoritative base inputs remain admin polygons, railways, hydrography and uploaded reference layers.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from pyproj import Geod
from shapely.geometry import GeometryCollection, LineString, MultiLineString, mapping, shape
from shapely.ops import linemerge

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ADMIN_DIR = DATA / "admin"
BOUNDARY_DIR = DATA / "admin_boundary_levels"
GEOD = Geod(ellps="WGS84")

LEVEL_LABELS = {
    "upper": "верхний уровень АТД",
    "intermediate": "промежуточный уровень АТД",
    "lower": "нижний уровень АТД",
    "disputed": "спорные / особые границы",
}

SPECIAL_TEXT_MARKERS = (
    "спор", "двоед", "неясн", "особ", "uncertain", "disputed", "special"
)


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def year_from_admin_path(path: Path) -> int:
    return int(path.stem.split("_")[-1])


def clean_id(value: Any) -> str:
    return str(value or "").strip()


def as_adjacent_ids(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, dict):
                uid = item.get("unit_id") or item.get("id")
                if uid:
                    out.append(clean_id(uid))
            else:
                s = clean_id(item)
                if s:
                    out.append(s)
        return out
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        # Some older layers store semicolon-separated names in adjacent_units, but unit ids usually live in adjacent_unit_ids.
        if s.startswith("["):
            try:
                return as_adjacent_ids(json.loads(s))
            except Exception:
                pass
        return [x.strip() for x in s.replace(",", ";").split(";") if x.strip()]
    return []


def prop_text_has_marker(props: Dict[str, Any]) -> bool:
    keys = (
        "unit_type", "special_status", "special_status_code", "_uncertain", "_uncertain_code",
        "_uncertain_label", "_display_status", "admin_parent", "admin_intermediate", "admin_superparent",
        "adjacency_exclusion_reason", "topology_exclusion_reason", "map_display_role",
        "is_special_reconstruction_area",
    )
    for k in keys:
        v = props.get(k)
        if v is True:
            return True
        s = str(v or "").lower()
        if any(m in s for m in SPECIAL_TEXT_MARKERS):
            return True
    return False


def parent_key(props: Dict[str, Any], *names: str) -> str:
    for name in names:
        v = clean_id(props.get(name))
        if v:
            return v
    return ""


def classify_boundary(p1: Dict[str, Any], p2: Dict[str, Any]) -> str:
    if prop_text_has_marker(p1) or prop_text_has_marker(p2):
        return "disputed"
    super1 = parent_key(p1, "admin_superparent", "admin_parent")
    super2 = parent_key(p2, "admin_superparent", "admin_parent")
    if super1 and super2 and super1 != super2:
        return "upper"
    inter1 = parent_key(p1, "admin_intermediate", "admin_parent")
    inter2 = parent_key(p2, "admin_intermediate", "admin_parent")
    if inter1 and inter2 and inter1 != inter2:
        return "intermediate"
    parent1 = parent_key(p1, "admin_parent")
    parent2 = parent_key(p2, "admin_parent")
    if parent1 and parent2 and parent1 != parent2:
        return "intermediate"
    return "lower"


def iter_line_parts(geom) -> Iterable[LineString]:
    if geom.is_empty:
        return
    if isinstance(geom, LineString):
        if len(geom.coords) >= 2:
            yield geom
    elif isinstance(geom, MultiLineString):
        for part in geom.geoms:
            if len(part.coords) >= 2:
                yield part
    elif isinstance(geom, GeometryCollection):
        for g in geom.geoms:
            yield from iter_line_parts(g)


def geodesic_km(line: LineString) -> float:
    coords = list(line.coords)
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords[:-1], coords[1:]):
        try:
            _, _, dist = GEOD.inv(float(x1), float(y1), float(x2), float(y2))
            if math.isfinite(dist):
                total += dist
        except Exception:
            continue
    return total / 1000.0


def rounded_geom(geom, ndigits: int = 6):
    # keep files small and stable while preserving map-scale accuracy
    def rxy(c):
        return (round(float(c[0]), ndigits), round(float(c[1]), ndigits))
    if isinstance(geom, LineString):
        return LineString([rxy(c) for c in geom.coords])
    if isinstance(geom, MultiLineString):
        return MultiLineString([[rxy(c) for c in part.coords] for part in geom.geoms])
    return geom


def build_boundary_levels_for_year(admin_path: Path) -> Dict[str, Any]:
    gj = load_json(admin_path)
    features = gj.get("features", [])
    by_id: Dict[str, Dict[str, Any]] = {}
    geom_by_id: Dict[str, Any] = {}
    for f in features:
        props = f.get("properties", {}) or {}
        uid = clean_id(props.get("unit_id") or f.get("id"))
        if not uid:
            continue
        by_id[uid] = props
        try:
            geom_by_id[uid] = shape(f.get("geometry"))
        except Exception:
            pass

    pairs = set()
    for uid, props in by_id.items():
        for vid in as_adjacent_ids(props.get("adjacent_unit_ids")):
            if vid in by_id and vid != uid:
                pairs.add(tuple(sorted((uid, vid))))

    # Fallback for years where adjacency was not populated: use spatial boundary intersections.
    # This is intentionally conservative and only used when no stored rook adjacency exists.
    if not pairs:
        ids = list(geom_by_id)
        for i, uid in enumerate(ids):
            b1 = geom_by_id[uid].boundary
            for vid in ids[i + 1:]:
                try:
                    inter = b1.intersection(geom_by_id[vid].boundary)
                    if any(geodesic_km(part) >= 1.0 for part in iter_line_parts(inter)):
                        pairs.add((uid, vid))
                except Exception:
                    continue

    grouped: Dict[str, List[LineString]] = defaultdict(list)
    pair_count_by_level = defaultdict(int)
    km_by_level = defaultdict(float)

    for uid, vid in sorted(pairs):
        g1, g2 = geom_by_id.get(uid), geom_by_id.get(vid)
        if g1 is None or g2 is None:
            continue
        try:
            inter = g1.boundary.intersection(g2.boundary)
        except Exception:
            continue
        lines = []
        for line in iter_line_parts(inter):
            km = geodesic_km(line)
            if km >= 0.2:
                lines.append(line)
        if not lines:
            continue
        level = classify_boundary(by_id[uid], by_id[vid])
        pair_count_by_level[level] += 1
        for line in lines:
            grouped[level].append(line)
            km_by_level[level] += geodesic_km(line)

    out_features = []
    for level in ("lower", "intermediate", "upper", "disputed"):
        lines = grouped.get(level, [])
        if not lines:
            continue
        try:
            merged = linemerge(MultiLineString(lines))
        except Exception:
            merged = MultiLineString(lines)
        # linemerge may return LineString or MultiLineString. Keep one feature per level for speed.
        merged = rounded_geom(merged)
        out_features.append({
            "type": "Feature",
            "properties": {
                "level": level,
                "level_label": LEVEL_LABELS[level],
                "style_class": level,
                "source": "derived_from_admin_polygon_shared_boundaries_v142",
                "pairs_count": int(pair_count_by_level[level]),
                "boundary_km": round(km_by_level[level], 3),
                "note": "Построено по фактическим общим границам полигонов АТЕ; прямые графовые рёбра между центрами не используются; внешняя береговая линия океана не включается.",
            },
            "geometry": mapping(merged),
        })
    return {"type": "FeatureCollection", "features": out_features}


def rebuild_admin_boundary_levels(years: List[int] | None = None) -> List[Dict[str, Any]]:
    BOUNDARY_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for admin_path in sorted(ADMIN_DIR.glob("admin_*.geojson"), key=year_from_admin_path):
        year = year_from_admin_path(admin_path)
        if years and year not in years:
            continue
        out = build_boundary_levels_for_year(admin_path)
        out_path = BOUNDARY_DIR / f"admin_boundary_levels_{year}.geojson"
        dump_json(out_path, out)
        total_km = sum(float(f["properties"].get("boundary_km") or 0) for f in out.get("features", []))
        rows.append({
            "year": year,
            "features": len(out.get("features", [])),
            "total_km": round(total_km, 3),
            **{f"{f['properties']['level']}_km": f["properties"].get("boundary_km", 0) for f in out.get("features", [])},
            "output": str(out_path.relative_to(ROOT)),
        })
    return rows


def write_summary(rows: List[Dict[str, Any]], path: Path) -> None:
    if not rows:
        return
    fieldnames = sorted(set().union(*(r.keys() for r in rows)), key=lambda x: (x not in ("year", "features", "total_km", "output"), x))
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def update_manifest() -> None:
    manifest_path = DATA / "manifest.json"
    manifest = load_json(manifest_path)
    manifest["app_version"] = 142
    manifest["version"] = "v142"
    layers = manifest.setdefault("layers", {})
    years = manifest.get("years") or []
    layers["admin_boundary_levels"] = {
        str(y): f"data/admin_boundary_levels/admin_boundary_levels_{y}.geojson" for y in years
        if (BOUNDARY_DIR / f"admin_boundary_levels_{y}.geojson").exists()
    }
    note = (
        "v142: производные слои считаются rebuildable cache. Источник истины — базовые admin/hydro/railways/reference слои; "
        "границы уровней АТД пересобираются из фактических общих границ полигонов, а не из графовых рёбер."
    )
    if isinstance(manifest.get("notes"), list):
        if note not in manifest["notes"]:
            manifest["notes"].append(note)
    else:
        manifest.setdefault("notes", {})["derived_data_architecture_v142"] = note
    dump_json(manifest_path, manifest)

    derived = {
        "version": "v142",
        "principle": "derived layers are rebuildable cache, not authoritative source data",
        "authoritative_sources": {
            "admin": sorted(str(p.relative_to(ROOT)) for p in ADMIN_DIR.glob("admin_*.geojson")),
            "railways": sorted(str(p.relative_to(ROOT)) for p in (DATA / "railways").glob("*.geojson")),
            "hydro": sorted(str(p.relative_to(ROOT)) for p in (DATA / "hydro").glob("*.geojson")),
            "connectivity_reference": sorted(str(p.relative_to(ROOT)) for p in (DATA / "connectivity" / "reference").glob("*.geojson")),
            "natural_boundary_reference": sorted(str(p.relative_to(ROOT)) for p in (DATA / "natural_boundaries" / "reference").glob("*.geojson")),
        },
        "generated_layers": {
            "admin_boundary_levels": sorted(str(p.relative_to(ROOT)) for p in BOUNDARY_DIR.glob("admin_boundary_levels_*.geojson")),
        },
        "source_hashes": {
            str(p.relative_to(ROOT)): file_sha256(p)
            for p in sorted(ADMIN_DIR.glob("admin_*.geojson"))
        },
        "note": "v142 implements the architecture for boundary-level overlays first. Natural-boundary metrics and cost-graph layers remain generated files, but are marked as next candidates for the same rebuild pipeline.",
    }
    dump_json(DATA / "derived_manifest.json", derived)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundary-levels", action="store_true", help="rebuild administrative boundary level overlays")
    ap.add_argument("--all", action="store_true", help="rebuild all implemented derived layers")
    ap.add_argument("--years", nargs="*", type=int, help="optional years to rebuild")
    args = ap.parse_args()
    if not (args.boundary_levels or args.all):
        args.all = True
    rows = []
    if args.boundary_levels or args.all:
        rows = rebuild_admin_boundary_levels(args.years)
        write_summary(rows, ROOT / "v142_admin_boundary_levels_summary.csv")
    update_manifest()
    print(f"v142 rebuild complete: boundary level files={len(rows)}")


if __name__ == "__main__":
    main()
