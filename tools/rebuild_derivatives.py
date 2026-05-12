#!/usr/bin/env python3
"""
Rebuild derived GeoJSON layers from the authoritative base inputs.

v143 scope:
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
from shapely.ops import linemerge, unary_union

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


OCEAN_MASK_CACHE = None

def load_ocean_mask():
    """Return a small buffer around the Arctic Ocean polygon used only to suppress coastline linework."""
    global OCEAN_MASK_CACHE
    if OCEAN_MASK_CACHE is not None:
        return OCEAN_MASK_CACHE
    candidates = [
        DATA / "hydro" / "water_ocean_lakes_west_siberia.geojson",
        DATA / "hydro" / "water_ocean_lakes_full.geojson",
    ]
    ocean_geoms = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            gj = load_json(path)
        except Exception:
            continue
        for f in gj.get("features", []):
            props = f.get("properties", {}) or {}
            vals = " ".join(str(props.get(k, "")) for k in ("water_kind", "layer", "type", "featurecla", "name", "name_ru")).lower()
            if "ocean" in vals or "море" in vals or "карское" in vals or "ледовит" in vals:
                try:
                    ocean_geoms.append(shape(f.get("geometry")))
                except Exception:
                    pass
    if not ocean_geoms:
        OCEAN_MASK_CACHE = False
        return None
    try:
        # Degree buffer is intentionally small: it removes only coast-adjacent linework,
        # not inland administrative boundaries.
        OCEAN_MASK_CACHE = unary_union(ocean_geoms).buffer(0.045)
        return OCEAN_MASK_CACHE
    except Exception:
        OCEAN_MASK_CACHE = False
        return None


def safe_shape(geometry):
    try:
        g = shape(geometry)
        if not g.is_valid:
            try:
                from shapely.validation import make_valid
                g = make_valid(g)
            except Exception:
                g = g.buffer(0)
        return g
    except Exception:
        return None


def geom_key(props: Dict[str, Any], fallback: str, *names: str) -> str:
    for name in names:
        v = clean_id(props.get(name))
        if v and v.lower() not in ("none", "null", "nan"):
            return v
    return fallback


def key_upper(props: Dict[str, Any], uid: str) -> str:
    return geom_key(props, uid, "admin_superparent", "admin_parent", "_admin_parent")


def key_intermediate(props: Dict[str, Any], uid: str) -> str:
    return geom_key(props, key_upper(props, uid), "admin_intermediate", "admin_parent", "_admin_parent", "admin_superparent")


def trim_ocean_linework(geom, ocean_mask):
    if geom is None or geom.is_empty:
        return []
    parts = list(iter_line_parts(geom))
    out = []
    for line in parts:
        g = line
        if ocean_mask is not None:
            try:
                lb = line.bounds; ob = ocean_mask.bounds
                intersects_bbox = not (lb[2] < ob[0] or lb[0] > ob[2] or lb[3] < ob[1] or lb[1] > ob[3])
                if intersects_bbox:
                    g = line.difference(ocean_mask)
            except Exception:
                g = line
        for part in iter_line_parts(g):
            if geodesic_km(part) >= 0.12:
                out.append(part)
    return out


def build_group_boundary(geoms_by_key: Dict[str, List[Any]], ocean_mask=None):
    """Build full outlines around dissolved groups; remove only Arctic coastline fragments."""
    boundary_parts: List[LineString] = []
    group_count = 0
    for key, geoms in geoms_by_key.items():
        valid = [g for g in geoms if g is not None and not g.is_empty]
        if not valid:
            continue
        group_count += 1
        try:
            dissolved = unary_union(valid)
            b = dissolved.boundary
        except Exception:
            # Fallback: use individual boundaries for this group.
            try:
                b = GeometryCollection([g.boundary for g in valid])
            except Exception:
                continue
        boundary_parts.extend(trim_ocean_linework(b, ocean_mask))

    if not boundary_parts:
        return None, 0.0, group_count
    try:
        # Keep this fast: linework is a visual cache. Duplicated coincident lines are acceptable
        # and much cheaper than full overlay dissolution for all historical years.
        merged = linemerge(MultiLineString(boundary_parts))
    except Exception:
        merged = MultiLineString(boundary_parts)
    merged = rounded_geom(merged)
    km = sum(geodesic_km(part) for part in iter_line_parts(merged))
    return merged, km, group_count


def build_boundary_levels_for_year(admin_path: Path) -> Dict[str, Any]:
    gj = load_json(admin_path)
    features = gj.get("features", [])
    ocean_mask = load_ocean_mask()

    unit_geoms: Dict[str, List[Any]] = defaultdict(list)
    intermediate_geoms: Dict[str, List[Any]] = defaultdict(list)
    upper_geoms: Dict[str, List[Any]] = defaultdict(list)
    disputed_geoms: Dict[str, List[Any]] = defaultdict(list)

    for idx, f in enumerate(features):
        props = f.get("properties", {}) or {}
        uid = clean_id(props.get("unit_id") or f.get("id") or f"unit_{idx}")
        geom = safe_shape(f.get("geometry"))
        if geom is None or geom.is_empty:
            continue
        unit_geoms[uid].append(geom)
        intermediate_geoms[key_intermediate(props, uid)].append(geom)
        upper_geoms[key_upper(props, uid)].append(geom)
        if prop_text_has_marker(props):
            disputed_geoms[uid].append(geom)

    level_specs = [
        ("lower", unit_geoms, "полные контуры нижних АТЕ"),
        ("intermediate", intermediate_geoms, "полные контуры промежуточных групп АТЕ"),
        ("upper", upper_geoms, "полные контуры верхнеуровневых АТЕ"),
        ("disputed", disputed_geoms, "контуры спорных / особых объектов"),
    ]

    out_features = []
    for level, groups, note_kind in level_specs:
        if not groups:
            continue
        geom, km, group_count = build_group_boundary(groups, ocean_mask=ocean_mask)
        if geom is None or km <= 0:
            continue
        out_features.append({
            "type": "Feature",
            "properties": {
                "level": level,
                "level_label": LEVEL_LABELS[level],
                "style_class": level,
                "source": "derived_from_admin_polygon_outlines_v143",
                "groups_count": int(group_count),
                "boundary_km": round(km, 3),
                "note": (
                    f"{note_kind}; слой построен из фактических полигональных границ admin_YYYY.geojson. "
                    "Графовые рёбра между центрами не используются. Прибрежные фрагменты у океана вырезаны по океанической маске."
                ),
            },
            "geometry": mapping(geom),
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
    manifest["app_version"] = 143
    manifest["version"] = "v143"
    layers = manifest.setdefault("layers", {})
    years = manifest.get("years") or []
    layers["admin_boundary_levels"] = {
        str(y): f"data/admin_boundary_levels/admin_boundary_levels_{y}.geojson" for y in years
        if (BOUNDARY_DIR / f"admin_boundary_levels_{y}.geojson").exists()
    }
    note = (
        "v143: производные слои считаются rebuildable cache. Источник истины — базовые admin/hydro/railways/reference слои; "
        "границы уровней АТД пересобираются из полных контуров полигонов/диссольвов по иерархии, а не из графовых рёбер."
    )
    if isinstance(manifest.get("notes"), list):
        if note not in manifest["notes"]:
            manifest["notes"].append(note)
    else:
        manifest.setdefault("notes", {})["derived_data_architecture_v143"] = note
    dump_json(manifest_path, manifest)

    derived = {
        "version": "v143",
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
        "note": "v143 rebuilds complete admin boundary outlines by dissolved hierarchy. Natural-boundary metrics and cost-graph layers remain generated files, but are marked as next candidates for the same rebuild pipeline.",
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
        write_summary(rows, ROOT / "v143_admin_boundary_levels_summary.csv")
    update_manifest()
    print(f"v143 rebuild complete: boundary level files={len(rows)}")


if __name__ == "__main__":
    main()
