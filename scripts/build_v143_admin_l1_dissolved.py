#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build dissolved ATE-1 masks/outlines for v143.

Purpose:
- avoid the old segment-count heuristic that drew broken first-level boundaries
  along internal ATE-2 seams when neighbouring polygons did not share identical vertices;
- provide a safe fill underlay for tiny internal gaps/white pinholes in categorical
  parent-level maps.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from collections import defaultdict
from typing import Any, Dict, Iterable, List

from shapely.geometry import shape, mapping, Polygon, MultiPolygon, GeometryCollection
from shapely.ops import unary_union
from shapely import make_valid, set_precision

ROOT = Path(__file__).resolve().parents[1]
ADMIN_DIR = ROOT / 'data' / 'admin'
OUT_DIR = ROOT / 'data' / 'admin_l1_dissolved'
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Coordinates are lon/lat. This is deliberately small: enough to suppress
# sub-pixel cracks/duplicate vertices, not enough to simplify real historical lines.
PRECISION_GRID = 1e-6
# Drop only microscopic polygon crumbs after make_valid / union, in square degrees.
MIN_PART_AREA = 1e-9


def parent_name(props: Dict[str, Any]) -> str:
    return str(props.get('admin_superparent') or props.get('admin_parent') or props.get('region') or props.get('Governorate') or props.get('name') or 'АТД-1').strip() or 'АТД-1'


def clean_polygonal(geom):
    """Return valid polygonal geometry; discard lines/points from make_valid."""
    if geom is None or geom.is_empty:
        return None
    try:
        geom = set_precision(geom, PRECISION_GRID)
    except Exception:
        pass
    if not geom.is_valid:
        try:
            geom = make_valid(geom)
        except Exception:
            geom = geom.buffer(0)
    if geom.is_empty:
        return None
    if geom.geom_type in ('Polygon', 'MultiPolygon'):
        return geom
    if isinstance(geom, GeometryCollection):
        parts = [g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon') and not g.is_empty]
        if not parts:
            return None
        return unary_union(parts)
    return None


def remove_interiors_and_tiny_parts(geom):
    """For the dissolved ATE-1 mask we intentionally remove interior holes.

    These holes are the main source of visible white islands/fragmented outlines in
    the viewer. The mask is not used for analytics; it is a cartographic underlay
    and first-level outline only, so preserving ATE-2 geometry happens in the
    original admin layer above it.
    """
    geom = clean_polygonal(geom)
    if geom is None or geom.is_empty:
        return None
    polys: List[Polygon] = []
    src = [geom] if geom.geom_type == 'Polygon' else list(geom.geoms)
    for p in src:
        if p.is_empty or p.area < MIN_PART_AREA:
            continue
        try:
            ext = list(p.exterior.coords)
            if len(ext) >= 4:
                q = Polygon(ext)  # no interior rings
                if not q.is_valid:
                    q = make_valid(q)
                if q.geom_type == 'Polygon' and q.area >= MIN_PART_AREA:
                    polys.append(q)
                elif q.geom_type == 'MultiPolygon':
                    polys.extend([pp for pp in q.geoms if pp.area >= MIN_PART_AREA])
        except Exception:
            continue
    if not polys:
        return None
    if len(polys) == 1:
        return polys[0]
    return MultiPolygon(polys)


def year_from_path(path: Path) -> int:
    m = re.search(r'(\d{4})', path.name)
    return int(m.group(1)) if m else 0


def build_for_file(path: Path) -> Dict[str, Any]:
    year = year_from_path(path)
    gj = json.loads(path.read_text(encoding='utf-8'))
    groups: Dict[str, List[Any]] = defaultdict(list)
    invalid_input = 0
    input_features = 0
    for f in gj.get('features', []):
        input_features += 1
        props = f.get('properties') or {}
        try:
            g0 = shape(f.get('geometry'))
        except Exception:
            continue
        if not g0.is_valid:
            invalid_input += 1
        g = clean_polygonal(g0)
        if g is None or g.is_empty:
            continue
        groups[parent_name(props)].append(g)

    out_features = []
    removed_holes = 0
    multipart_parents = 0
    for idx, (parent, geoms) in enumerate(sorted(groups.items(), key=lambda kv: kv[0])):
        if not geoms:
            continue
        try:
            u = unary_union(geoms)
        except Exception:
            u = unary_union([make_valid(g) for g in geoms])
        # count holes before removing them
        check = clean_polygonal(u)
        if check is not None:
            polys = [check] if check.geom_type == 'Polygon' else list(check.geoms) if check.geom_type == 'MultiPolygon' else []
            removed_holes += sum(len(p.interiors) for p in polys)
        u2 = remove_interiors_and_tiny_parts(u)
        if u2 is None or u2.is_empty:
            continue
        if u2.geom_type == 'MultiPolygon' and len(u2.geoms) > 1:
            multipart_parents += 1
        out_features.append({
            'type': 'Feature',
            'properties': {
                'year': year,
                'unit_id': f'l1_{year}_{idx+1:03d}',
                'name': parent,
                'admin_parent': parent,
                'admin_superparent': parent,
                'map_display_role': 'admin_l1_dissolved_mask',
                'source': path.name,
                'method': 'v143_shapely_unary_union_by_admin_superparent_without_interiors'
            },
            'geometry': mapping(u2)
        })

    fc = {
        'type': 'FeatureCollection',
        'name': f'admin_l1_dissolved_{year}',
        'features': out_features
    }
    out_path = OUT_DIR / f'admin_l1_dissolved_{year}.geojson'
    out_path.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return {
        'year': year,
        'admin_file': path.name,
        'output_file': str(out_path.relative_to(ROOT)),
        'input_features': input_features,
        'parents': len(groups),
        'output_features': len(out_features),
        'invalid_input_features': invalid_input,
        'removed_interior_rings_from_dissolved_mask': removed_holes,
        'multipart_parent_features': multipart_parents,
    }


def main():
    rows = []
    for path in sorted(ADMIN_DIR.glob('admin_*.geojson'), key=year_from_path):
        rows.append(build_for_file(path))
    diag = {
        'version': 'v143',
        'purpose': 'Dissolved ATE-1 masks/outlines for clean HSE export and screen rendering; no analytics fields changed.',
        'precision_grid_degrees': PRECISION_GRID,
        'min_part_area_square_degrees': MIN_PART_AREA,
        'years': rows,
    }
    (ROOT / 'docs').mkdir(exist_ok=True)
    (ROOT / 'docs' / 'v143_l1_dissolve_diagnostics.json').write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(diag, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
