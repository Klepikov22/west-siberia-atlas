#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v108: merge two 1876 sliver fragments into their intended districts and
add support data for population-vs-ATE correlation diagnostics.

Changes:
- 1876 raw OBJECTID 5 -> Каинский округ (adm_1876_10)
- 1876 raw OBJECTID 28 -> Кокпектинский округ (adm_1876_19)
- rebuild topology/connectivity for 1876 and refresh multiyear metrics for 1876
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from statistics import mean
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent
ADMIN = ROOT / 'data' / 'admin'
TOPO = ROOT / 'data' / 'topology'
DOCS = ROOT / 'docs'
DOCS.mkdir(exist_ok=True)
ADMIN_1876 = ADMIN / 'admin_1876.geojson'


def load_json(p: Path):
    with p.open('r', encoding='utf-8') as f:
        return json.load(f)


def write_json(p: Path, obj, indent=None):
    with p.open('w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def clean_geom(g):
    if g is None:
        return None
    if not g.is_valid:
        g = make_valid(g)
    return g


def feature_id(p: dict) -> str:
    return str(p.get('unit_id') or p.get('raw_objectid') or p.get('OBJECTID') or '').strip()


def merge_1876_slivers():
    gj = load_json(ADMIN_1876)
    features = gj.get('features', [])
    merge_plan = {
        '5': {'target_unit_id': 'adm_1876_10', 'target_name': 'Каинский округ'},
        '28': {'target_unit_id': 'adm_1876_19', 'target_name': 'Кокпектинский округ'},
    }
    by_raw = {}
    by_uid = {}
    for f in features:
        p = f.get('properties') or {}
        raw = str(p.get('raw_objectid') or p.get('OBJECTID') or '').strip()
        uid = str(p.get('unit_id') or '').strip()
        if raw:
            by_raw[raw] = f
        if uid:
            by_uid[uid] = f

    log_rows = []
    remove_raw = set()
    for raw, spec in merge_plan.items():
        src = by_raw.get(raw)
        tgt = by_uid.get(spec['target_unit_id'])
        if not src or not tgt:
            raise RuntimeError(f'Cannot find source raw={raw} or target {spec}')
        sp = src.get('properties') or {}
        tp = tgt.setdefault('properties', {})
        src_geom = clean_geom(shape(src.get('geometry')))
        tgt_geom = clean_geom(shape(tgt.get('geometry')))
        merged = clean_geom(unary_union([tgt_geom, src_geom]))
        tgt['geometry'] = mapping(merged)
        old_note = str(tp.get('v108_merge_note') or '').strip()
        note = f"v108: присоединён технический фрагмент OBJECTID {raw} ({sp.get('name') or sp.get('_display_name')})"
        tp['v108_merge_note'] = (old_note + '; ' + note).strip('; ') if old_note else note
        merged_ids = [x for x in str(tp.get('v108_merged_raw_objectids') or '').split(';') if x.strip()]
        if raw not in merged_ids:
            merged_ids.append(raw)
        tp['v108_merged_raw_objectids'] = ';'.join(merged_ids)
        remove_raw.add(raw)
        log_rows.append({
            'year': 1876,
            'source_raw_objectid': raw,
            'source_unit_id': sp.get('unit_id'),
            'source_name': sp.get('name') or sp.get('_display_name'),
            'source_area_km2_before': sp.get('area_km2'),
            'target_unit_id': tp.get('unit_id'),
            'target_name': tp.get('name'),
            'target_area_km2_before': tp.get('area_km2'),
            'operation': 'geometry_union_and_remove_source_feature',
        })

    new_features = []
    for f in features:
        p = f.get('properties') or {}
        raw = str(p.get('raw_objectid') or p.get('OBJECTID') or '').strip()
        if raw in remove_raw:
            continue
        new_features.append(f)
    gj['features'] = new_features
    gj.setdefault('properties', {})['v108_1876_sliver_merge'] = 'OBJECTID 5 merged to Каинский округ; OBJECTID 28 merged to Кокпектинский округ'
    write_json(ADMIN_1876, gj)

    with (DOCS / 'v108_1876_sliver_merge.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','source_raw_objectid','source_unit_id','source_name','source_area_km2_before','target_unit_id','target_name','target_area_km2_before','operation']
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(log_rows)
    return log_rows


def exec_module_until(path: Path, stop_marker: str):
    text = path.read_text(encoding='utf-8')
    if stop_marker in text:
        text = text.split(stop_marker)[0]
    ns = {'__file__': str(path), '__name__': f'_v108_partial_{path.stem}'}
    exec(compile(text, str(path), 'exec'), ns)
    return ns


def rebuild_1876_topology():
    # Reuse the existing v94 topology algorithm, but call only rebuild_year(1876)
    ns = exec_module_until(ROOT / 'scripts_topology_v94.py', '# Rebuild target topology/admin layers.')
    summary, metrics, edge_rows, excluded = ns['rebuild_year'](1876)

    metrics_path = TOPO / 'topology_metrics_by_year.json'
    rows = load_json(metrics_path)
    by_year = {int(r['year']): r for r in rows}
    before = dict(by_year.get(1876, {}))
    by_year[1876] = metrics
    write_json(metrics_path, [by_year[y] for y in sorted(by_year)], indent=2)

    with (DOCS / 'v108_1876_topology_summary.csv').open('w', encoding='utf-8', newline='') as f:
        fields = list(summary.keys())
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerow(summary)
    with (DOCS / 'v108_1876_topology_edges.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','source_id','source_name','source_parent','target_id','target_name','target_parent','boundary_km','relation','contact_method','is_bridge']
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(edge_rows)
    with (DOCS / 'v108_1876_topology_before_after.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['metric','before','after']
        keys = ['nodes','edges','components','graph_density','cyclomatic','articulation_points','avg_degree','bridges','max_degree','max_degree_name']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for k in keys:
            w.writerow({'metric': k, 'before': before.get(k), 'after': metrics.get(k)})
    return summary, metrics


def refresh_multiyear_1876():
    # Use the v104/v103-compatible metric calculator for the single affected year.
    ns = exec_module_until(ROOT / 'recalc_v104_stat_exclusions.py', "def main():")
    path = TOPO / 'multiyear_metrics_by_year.json'
    rows = load_json(path)
    before = next((dict(r) for r in rows if int(r.get('year')) == 1876), {})
    out = []
    for r in rows:
        if int(r.get('year')) == 1876:
            nr, _ = ns['metrics_for_year'](1876, r)
            nr['v108_1876_geometry_scope_note'] = 'OBJECTID 5 merged to Каинский округ; OBJECTID 28 merged to Кокпектинский округ; topology and multiyear metrics refreshed'
            out.append(nr)
        else:
            out.append(r)
    write_json(path, out, indent=2)

    after = next((dict(r) for r in out if int(r.get('year')) == 1876), {})
    with (DOCS / 'v108_1876_multiyear_metrics_before_after.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['metric','before','after','delta']
        keys = ['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','total_area_km2','avg_area_km2','total_population','population_density','rail_length_km_total','avg_adjacency','nodes','edges','components','graph_density','cyclomatic','bridges','articulation_points','avg_degree','avg_lower_units_per_upper_ate','avg_area_upper_ate_km2','avg_area_middle_ate_km2']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for k in keys:
            b, a = before.get(k), after.get(k)
            delta = ''
            if isinstance(b, (int,float)) and isinstance(a, (int,float)):
                delta = a - b
            w.writerow({'metric': k, 'before': b, 'after': a, 'delta': delta})
    return before, after


def pearson(xs, ys):
    pairs = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None and math.isfinite(float(x)) and math.isfinite(float(y))]
    if len(pairs) < 2:
        return None
    xs = [p[0] for p in pairs]; ys = [p[1] for p in pairs]
    mx, my = mean(xs), mean(ys)
    sx = math.sqrt(sum((x-mx)**2 for x in xs))
    sy = math.sqrt(sum((y-my)**2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys)) / (sx*sy)


def write_population_correlation_diagnostics():
    rows = load_json(TOPO / 'multiyear_metrics_by_year.json')
    records=[]
    for target_key, label in [('lower_ate_count','Население ↔ число АТЕ нижнего уровня'), ('upper_ate_count','Население ↔ число АТЕ верхнего уровня')]:
        valid=[r for r in rows if r.get('total_population') is not None and r.get(target_key) is not None]
        r = pearson([x.get('total_population') for x in valid], [x.get(target_key) for x in valid])
        records.append({'metric': label, 'x': 'total_population', 'y': target_key, 'years_count': len(valid), 'pearson_r': round(r, 6) if r is not None else '', 'r2': round(r*r, 6) if r is not None else ''})
    with (DOCS / 'v108_population_ate_correlation_summary.csv').open('w', encoding='utf-8', newline='') as f:
        fields=['metric','x','y','years_count','pearson_r','r2']
        w=csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(records)
    return records


def main():
    merges = merge_1876_slivers()
    summary, metrics = rebuild_1876_topology()
    before, after = refresh_multiyear_1876()
    # Recalculate area-dispersion metrics after the 1876 geometry merge.
    ns105 = {'__file__': str(ROOT / 'recalc_v105_area_dispersion.py'), '__name__': '_v108_recalc_v105'}
    exec(compile((ROOT / 'recalc_v105_area_dispersion.py').read_text(encoding='utf-8'), str(ROOT / 'recalc_v105_area_dispersion.py'), 'exec'), ns105)
    ns105['main']()
    corr = write_population_correlation_diagnostics()
    print('v108 1876 merge and topology refresh complete')
    print('merge rows:', merges)
    print('1876 nodes/edges:', metrics.get('nodes'), metrics.get('edges'), 'avg_degree', metrics.get('avg_degree'))
    print('1876 lower count before/after:', before.get('lower_ate_count'), after.get('lower_ate_count'))
    print('correlations:', corr)

if __name__ == '__main__':
    main()
