#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v121: reconstruct district-age attribute for regular district-like units from 1926 onward.

The age is not a legal-continuity assertion. It is a cartographic proxy based on
1) inherited/similar names and centroid proximity, and 2) conservative geometric continuity.
"""
import json, re, math, csv, os
from pathlib import Path
from difflib import SequenceMatcher
from shapely.geometry import shape
from shapely.ops import transform
from shapely.validation import make_valid
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent
ADMIN = ROOT / 'data' / 'admin'
DOCS = ROOT / 'docs'
DOCS.mkdir(exist_ok=True)
YEARS = [1926,1930,1939,1947,1959,1964,1970,1979,1989,2021]
transformer = Transformer.from_crs('EPSG:4326','EPSG:3857', always_xy=True)

def norm_name(s):
    s = str(s or '').lower().replace('ё','е')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'№\s*\d+', ' ', s)
    s = re.sub(r'[^а-яa-z0-9\- ]+', ' ', s)
    s = s.replace('-', ' ')
    # remove administrative generic words that change across periods
    stop = {
        'район','района','районный','районная','районное',
        'муниципальный','муниципального','муниципальная','муниципальное',
        'округ','округа','окружной','административный','административного',
        'национальный','национального','сельский','сельского','промышленный',
        'городской','городского','совет','горсовет','волость','уезд','уезда',
        'им','имени'
    }
    parts = [p for p in re.split(r'\s+', s.strip()) if p and p not in stop]
    return ' '.join(parts)

def type_is_district(p):
    ut = str(p.get('unit_type') or '').lower().replace('ё','е').strip()
    name = str(p.get('name') or '').lower().replace('ё','е')
    # Explicitly exclude cities / city soviets / district-rank urban units.
    if any(x in ut for x in ['горсовет','город','центр округа','городской округ']):
        return False
    if ut in {'район','муниципальный район','муниципальный округ','промышленный район'}:
        return True
    if 'район' in ut and 'город' not in ut and 'совет' not in ut:
        return True
    if not ut and 'район' in name:
        return True
    return False

def age_class(v):
    if v is None:
        return None
    try: v = int(v)
    except Exception: return None
    lo = (v // 10) * 10
    hi = lo + 9
    if lo >= 90:
        return '90 лет и старше'
    return f'{lo}–{hi} лет'

def safe_geom(geom):
    try:
        g = shape(geom)
        if not g.is_valid:
            g = make_valid(g)
        gp = transform(transformer.transform, g)
        if not gp.is_valid:
            gp = make_valid(gp)
        return gp
    except Exception:
        return None

def rec_from_feature(year, idx, f, origin=None):
    p = f.get('properties') or {}
    g = safe_geom(f.get('geometry'))
    if g is None or g.is_empty:
        centroid = None; area = 0.0
    else:
        centroid = g.representative_point()
        area = max(float(g.area), 0.0)
    return {
        'year': year,
        'idx': idx,
        'feature': f,
        'props': p,
        'id': str(p.get('unit_id') or f'adm_{year}_{idx}'),
        'name': str(p.get('name') or ''),
        'name_key': norm_name(p.get('name') or ''),
        'parent_key': norm_name(p.get('admin_parent') or p.get('admin_intermediate') or ''),
        'geom': g,
        'centroid': centroid,
        'area': area,
        'origin_year': origin if origin is not None else year,
    }

def dist_km(a,b):
    if a is None or b is None or a.get('centroid') is None or b.get('centroid') is None: return float('inf')
    return a['centroid'].distance(b['centroid'])/1000.0

def name_sim(a,b):
    if not a or not b: return 0.0
    if a == b: return 1.0
    return SequenceMatcher(None, a, b).ratio()

def overlap_stats(a,b):
    ga, gb = a.get('geom'), b.get('geom')
    if ga is None or gb is None or ga.is_empty or gb.is_empty:
        return (0.0,0.0,0.0)
    if not ga.bounds or not gb.bounds: return (0.0,0.0,0.0)
    try:
        if not ga.intersects(gb): return (0.0,0.0,0.0)
        inter = ga.intersection(gb).area
        if inter <= 0: return (0.0,0.0,0.0)
        cur_frac = inter / max(a.get('area') or ga.area or 1.0, 1.0)
        prev_frac = inter / max(b.get('area') or gb.area or 1.0, 1.0)
        union = ga.union(gb).area
        iou = inter / max(union, 1.0)
        return (cur_frac, prev_frac, iou)
    except Exception:
        return (0.0,0.0,0.0)

def choose_predecessor(cur, prev_records):
    best = None
    best_score = -1e9
    best_meta = None
    for prev in prev_records:
        d = dist_km(cur, prev)
        sim = name_sim(cur['name_key'], prev['name_key'])
        # quick reject to keep accidental homonyms under control
        if d > 850 and sim < 0.96:
            continue
        cur_frac = prev_frac = iou = 0.0
        need_overlap = (sim < 0.98 or d > 160)
        if need_overlap:
            cur_frac, prev_frac, iou = overlap_stats(cur, prev)
        area_ratio = (cur['area'] / prev['area']) if cur['area'] > 0 and prev['area'] > 0 else 1.0
        ar_penalty = abs(math.log(max(min(area_ratio, 100), 0.01)))
        method = None; confidence = None; ok = False; score = -1e9
        # 1. Same or very similar name near enough: the most useful historical continuity clue.
        if sim >= 0.96 and d <= 260:
            ok = True; method = 'name+centroid'; confidence = 'high' if d <= 90 else 'medium'
            score = 120 + 60*sim - 0.18*d - 8*ar_penalty + 30*iou
        elif sim >= 0.88 and d <= 180:
            ok = True; method = 'fuzzy_name+centroid'; confidence = 'medium'
            score = 95 + 60*sim - 0.22*d - 8*ar_penalty + 25*iou
        # 2. Same territory with weaker or changed name. Conservative: requires real shape continuity.
        if not ok:
            if (iou >= 0.32 and d <= 120) or (cur_frac >= 0.64 and prev_frac >= 0.34 and d <= 95 and 0.38 <= area_ratio <= 2.7):
                ok = True; method = 'geometry+centroid'; confidence = 'medium' if iou >= 0.42 else 'low'
                score = 70 + 80*iou + 20*min(cur_frac, prev_frac) - 0.28*d - 12*ar_penalty + 15*sim
        if ok and score > best_score:
            best = prev; best_score = score
            best_meta = {
                'method': method,
                'confidence': confidence,
                'distance_km': round(d, 1) if math.isfinite(d) else None,
                'name_similarity': round(sim, 3),
                'overlap_current_share': round(cur_frac, 3),
                'overlap_previous_share': round(prev_frac, 3),
                'overlap_iou': round(iou, 3),
                'area_ratio': round(area_ratio, 3) if math.isfinite(area_ratio) else None,
            }
    return best, best_meta

def summarize(vals):
    vals = [v for v in vals if isinstance(v, (int,float)) and math.isfinite(v)]
    if not vals:
        return {'count':0,'avg':None,'median':None,'max':None}
    vals = sorted(vals)
    n = len(vals)
    med = vals[n//2] if n%2 else (vals[n//2-1]+vals[n//2])/2
    return {'count':n, 'avg':round(sum(vals)/n,2), 'median':round(med,2), 'max':max(vals)}

active_prev = []
all_diag = []
summary = []
for year in YEARS:
    path = ADMIN / f'admin_{year}.geojson'
    gj = json.loads(path.read_text(encoding='utf-8'))
    current_records = []
    matched = 0; new = 0; non = 0
    for idx, f in enumerate(gj.get('features') or []):
        p = f.setdefault('properties', {})
        # remove stale values first so mode behaves correctly on non-districts
        for k in ['district_age_years','district_origin_year','district_age_class_10','district_age_basis','district_age_confidence','district_age_predecessor','district_age_predecessor_id','district_age_predecessor_year','district_age_distance_km','district_age_name_similarity','district_age_overlap_iou','district_age_note']:
            p.pop(k, None)
        if not type_is_district(p):
            non += 1
            continue
        cur = rec_from_feature(year, idx, f)
        if not active_prev:
            pred = None; meta = None
        else:
            pred, meta = choose_predecessor(cur, active_prev)
        if pred:
            origin = pred['origin_year']
            matched += 1
            basis = meta['method']
            conf = meta['confidence']
            pred_name = pred['name']
            pred_id = pred['id']
            pred_year = pred['year']
            dist = meta.get('distance_km')
            sim = meta.get('name_similarity')
            iou = meta.get('overlap_iou')
        else:
            origin = year
            new += 1
            basis = 'new_or_unmatched' if active_prev else 'base_year_1926'
            conf = 'base' if not active_prev else 'low'
            pred_name = pred_id = None
            pred_year = dist = sim = iou = None
        age = year - int(origin)
        p['district_origin_year'] = int(origin)
        p['district_age_years'] = int(age)
        p['district_age_class_10'] = age_class(age)
        p['district_age_basis'] = basis
        p['district_age_confidence'] = conf
        p['district_age_predecessor'] = pred_name
        p['district_age_predecessor_id'] = pred_id
        p['district_age_predecessor_year'] = pred_year
        p['district_age_distance_km'] = dist
        p['district_age_name_similarity'] = sim
        p['district_age_overlap_iou'] = iou
        p['district_age_note'] = 'Прокси-возраст района: наследование по названию/близкому написанию и смещению центроида; при смене названия — консервативная геометрическая преемственность. Не является юридической датой учреждения.'
        # store updated rec with origin for next step
        rec = rec_from_feature(year, idx, f, origin=origin)
        current_records.append(rec)
        all_diag.append({
            'year': year,
            'unit_id': p.get('unit_id'),
            'name': p.get('name'),
            'unit_type': p.get('unit_type'),
            'admin_parent': p.get('admin_parent'),
            'origin_year': origin,
            'age_years': age,
            'age_class_10': p['district_age_class_10'],
            'basis': basis,
            'confidence': conf,
            'predecessor_year': pred_year,
            'predecessor_id': pred_id,
            'predecessor_name': pred_name,
            'distance_km': dist,
            'name_similarity': sim,
            'overlap_iou': iou,
        })
    ages=[int((f.get('properties') or {}).get('district_age_years')) for f in gj.get('features') or [] if (f.get('properties') or {}).get('district_age_years') is not None]
    st=summarize(ages)
    summary.append({'year':year,'district_units':st['count'],'matched':matched,'new_or_base':new,'non_district_features':non,'avg_age':st['avg'],'median_age':st['median'],'max_age':st['max']})
    path.write_text(json.dumps(gj, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    active_prev = current_records

with (DOCS/'v121_district_age_assignments.csv').open('w', encoding='utf-8-sig', newline='') as fh:
    writer=csv.DictWriter(fh, fieldnames=['year','unit_id','name','unit_type','admin_parent','origin_year','age_years','age_class_10','basis','confidence','predecessor_year','predecessor_id','predecessor_name','distance_km','name_similarity','overlap_iou'])
    writer.writeheader(); writer.writerows(all_diag)
with (DOCS/'v121_district_age_summary.csv').open('w', encoding='utf-8-sig', newline='') as fh:
    writer=csv.DictWriter(fh, fieldnames=['year','district_units','matched','new_or_base','non_district_features','avg_age','median_age','max_age'])
    writer.writeheader(); writer.writerows(summary)
print(json.dumps(summary, ensure_ascii=False, indent=2))
