#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v109: support-level population reconstruction for early anchor layers and
1897 topology refresh after splitting Semipalatinsk / Ust-Kamenogorsk.

Population values for 1783, 1809, 1821, 1838 and 1848 are not treated as
full census observations at the leaf ATE level. They are benchmark-normalized
reconstructions from provincial/control totals, distributed to regular ATEs
with 1897-density and historical-geographic proxy weights. The control and
quality metadata are written into every touched feature.
"""
from __future__ import annotations

import csv
import json
import math
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from statistics import median

from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely.validation import make_valid
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
ADMIN = DATA / 'admin'
TOPO = DATA / 'topology'
DOCS = ROOT / 'docs'
DOCS.mkdir(exist_ok=True)
UPLOADED_1897 = ROOT.parent / 'admin_1897.geojson'

SUPPORT_YEARS = [1783, 1809, 1821, 1838, 1848]
CHANGED_YEARS = SUPPORT_YEARS + [1897]


def load_json(path: Path):
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path: Path, obj, indent=None):
    with path.open('w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def finite(x):
    try:
        if x is None or x == '':
            return None
        v = float(x)
        return v if math.isfinite(v) else None
    except Exception:
        return None


def clean_str(x) -> str:
    if x is None:
        return ''
    s = str(x).strip()
    if s.lower() in {'none','null','nan'}:
        return ''
    return s


def yes(x) -> bool:
    if isinstance(x, bool):
        return x
    return str(x).strip().lower() in {'1','true','yes','да','y'}


# --- dynamic import of previous project calculation code --------------------

def exec_module_until(path: Path, stop_marker: str):
    text = path.read_text(encoding='utf-8')
    if stop_marker in text:
        text = text.split(stop_marker)[0]
    ns = {'__file__': str(path), '__name__': f'_v109_partial_{path.stem}'}
    exec(compile(text, str(path), 'exec'), ns)
    return ns


TOPO_NS = exec_module_until(ROOT / 'scripts_topology_v94.py', '# Rebuild target topology/admin layers.')
V104_NS = exec_module_until(ROOT / 'recalc_v104_stat_exclusions.py', 'def main():')
V105_NS = exec_module_until(ROOT / 'recalc_v105_area_dispersion.py', 'if __name__ == "__main__":')

# Projection functions from v94 topology script.
to_m = TOPO_NS['to_m']


# --- normalization / weights ------------------------------------------------

def normalize_name(name: str) -> str:
    s = clean_str(name).lower().replace('ё', 'е')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\b(уезд|округ|область|губерния|наместничество|внешний|военный|волость|степь|территория|в составе)\b', ' ', s)
    s = re.sub(r'[^а-яa-z0-9]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def base_key(name: str) -> str:
    s = normalize_name(name)
    if not s:
        return ''
    # Keep compound names that are historically meaningful.
    compounds = ['усть каменогор', 'семи палат', 'семипалат', 'ново никола', 'зайсан']
    for c in compounds:
        if c in s:
            return c.replace(' ', '_')
    first = s.split()[0]
    # stem-like simplification, enough for district matching.
    for suf in ['ский','ской','ская','ское','цкий','цкой','цкая','цкое','ый','ой','ая','ое','ий','ой']:
        if first.endswith(suf) and len(first) > len(suf)+3:
            first = first[:-len(suf)]
            break
    return first


FALLBACK_DENSITY = {
    # North / forest zone
    'турухан': 0.004, 'березов': 0.035, 'берез': 0.035, 'сургут': 0.035,
    'нарым': 0.08, 'енисей': 0.12, 'краснояр': 0.22, 'ачин': 0.6,
    # Tobolsk south-western belt
    'тоболь': 1.0, 'тар': 1.9, 'омск': 2.0, 'тюкалин': 3.35,
    'ишим': 6.35, 'курган': 10.3, 'ялуторов': 8.35, 'тюмен': 6.0,
    'турин': 0.9,
    # Tomsk / Altai / Kuznetsk belt
    'томск': 1.0, 'каин': 2.3, 'бий': 2.9, 'бийск': 2.9, 'кузнец': 1.7,
    'барнаул': 4.45, 'колыван': 3.3, 'змеиногор': 2.85, 'мариин': 1.6,
    # Steppe / south-east
    'семипалат': 1.3, 'семи_палат': 1.3, 'усть_каменогор': 2.6, 'зайсан': 1.5,
    'киргиз': 0.02, 'акмолин': 0.75, 'атбасар': 0.65, 'петропавл': 2.25,
    'кокчетав': 2.3, 'каркаралин': 0.82, 'павлодар': 1.4,
}


def compute_reference_densities_1897() -> dict:
    path = ADMIN / 'admin_1897.geojson'
    gj = load_json(path)
    vals = defaultdict(list)
    for f in gj.get('features', []):
        p = f.get('properties') or {}
        name = clean_str(p.get('name'))
        pop = finite(p.get('population'))
        area = finite(p.get('area_km2'))
        if not name or pop is None or pop <= 0 or area is None or area <= 0:
            continue
        k = base_key(name)
        if k:
            vals[k].append(pop / area)
    ref = {}
    for k, xs in vals.items():
        if xs:
            ref[k] = median(xs)
    # Hand aliases.
    if 'березов' in ref: ref['берез'] = ref['березов']
    if 'бий' in ref: ref['бийск'] = ref['бий']
    if 'семипалатин' in ref: ref['семипалат'] = ref['семипалатин']
    if 'усть_каменогор' in ref: ref['усть каменогор'] = ref['усть_каменогор']
    return ref


def proxy_density(name: str, ref: dict, group_median: float | None = None) -> float:
    k = base_key(name)
    if k in ref:
        return max(0.002, ref[k])
    # Try partial stem containment.
    for kk, vv in ref.items():
        if k and (k in kk or kk in k):
            return max(0.002, vv)
    if k in FALLBACK_DENSITY:
        return FALLBACK_DENSITY[k]
    for kk, vv in FALLBACK_DENSITY.items():
        if k and (k in kk or kk in k):
            return vv
    return group_median or 0.8


def alloc_integer(total: int, weights: list[float]) -> list[int]:
    if not weights:
        return []
    s = sum(w for w in weights if w > 0)
    if s <= 0:
        weights = [1.0] * len(weights)
        s = len(weights)
    raw = [total * (max(0.0, w) / s) for w in weights]
    ints = [int(math.floor(x)) for x in raw]
    rem = total - sum(ints)
    order = sorted(range(len(raw)), key=lambda i: raw[i] - ints[i], reverse=True)
    for i in order[:rem]:
        ints[i] += 1
    return ints


def touched_feature_row(year, p, old_pop, new_pop, control, weight):
    return {
        'year': year,
        'unit_id': p.get('unit_id'),
        'name': p.get('name'),
        'admin_parent': p.get('admin_parent'),
        'unit_type': p.get('unit_type'),
        'area_km2': p.get('area_km2'),
        'old_population': old_pop,
        'new_population': new_pop,
        'density': p.get('density'),
        'control_unit': control.get('unit'),
        'control_total': control.get('total'),
        'source_year': control.get('source_year'),
        'quality': control.get('quality'),
        'method': control.get('method'),
        'allocation_weight': round(weight, 6),
    }


# Control totals. These are intentionally sparse and explicit.
# The project notes / final answer explain the source hierarchy and reliability.
CONTROL_GROUPS = {
    1783: [
        {
            'unit': 'Тобольское наместничество',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Тобольское наместничество' and not yes(p.get('topology_excluded')),
            'total': 514700,
            'source_year': 1785,
            'basis': 'оба пола; губернский/наместнический контроль',
            'quality': 'benchmark_control_total',
            'method': 'v109_density_proxy_distribution_to_regular_uezd_polygons',
            'source': 'БРЭ: Тобольская губерния / Тобольское наместничество, население свыше 514,7 тыс. чел. в 1785 г.',
            'note': 'Контроль относится к Тобольскому наместничеству; распределено по регулярным уездам слоя 1783.'
        },
        {
            'unit': 'Колыванское наместничество',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Колыванское наместничество' and not yes(p.get('topology_excluded')),
            'total': 88200,
            'source_year': 1782,
            'basis': '44,1 тыс. ревизских душ приписных крестьян × 2; частичный минимум обоего пола',
            'quality': 'partial_control_minimum_estimate',
            'method': 'v109_revision_souls_x2_density_proxy_distribution',
            'source': 'БРЭ: Колыванская область, 44,1 тыс. ревизских душ приписных крестьян Колывано-Воскресенских заводов в 1782 г.',
            'note': 'Это не полный итог Колыванского наместничества, а минимальная опора по основной учтённой группе населения; использовать осторожно.'
        },
    ],
    1809: [
        {
            'unit': 'Томская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Томская губерния' and not yes(p.get('topology_excluded')),
            'total': 220000,
            'source_year': 1808,
            'basis': 'оба пола; ближайший губернский контроль',
            'quality': 'benchmark_control_total_near_year',
            'method': 'v109_density_proxy_distribution_to_regular_uezd_polygons',
            'source': 'Список населённых мест Томской губернии: первая достоверная цифра около 1808 г. — 220 тыс. жителей обоего пола.',
            'note': 'Использовано как контроль к слою 1809; границы и сопоставимость требуют оговорки.'
        },
        {
            'unit': 'Тобольская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Тобольская губерния' and not yes(p.get('topology_excluded')),
            'total': 394477,
            'source_year': 1809,
            'basis': 'оба пола; линейная ретрооценка от контроля 1846 и переписи 1897',
            'quality': 'rough_backcast_from_1846_1897_controls',
            'method': 'v109_linear_backcast_provincial_total_then_density_proxy_distribution',
            'source': 'БРЭ: Тобольская губерния 831 151 чел. в 1846 г.; перепись 1897 г. — 1 433 043 чел. в губернии.',
            'note': 'Оценка нужна для непрерывности ряда; заменить при появлении прямых ревизских итогов по Тобольской губернии.'
        },
    ],
    1821: [
        {
            'unit': 'Томская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Томская губерния' and not yes(p.get('topology_excluded')),
            'total': 306125,
            'source_year': 1821,
            'basis': 'оба пола; интерполяция 1808–1824',
            'quality': 'interpolated_between_benchmarks',
            'method': 'v109_interpolation_220000_1808_to_326000_1824_then_density_proxy_distribution',
            'source': 'Список населённых мест Томской губернии: 220 тыс. в 1808 г.; 326 тыс. в 1824 г.; среднегодовой прирост 6 625 чел.',
            'note': '306 125 = 220 000 + 13 × 6 625; распределено по регулярным уездам слоя 1821.'
        },
        {
            'unit': 'Тобольская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Тобольская губерния' and not yes(p.get('topology_excluded')),
            'total': 536102,
            'source_year': 1821,
            'basis': 'оба пола; линейная ретрооценка от контроля 1846 и переписи 1897',
            'quality': 'rough_backcast_from_1846_1897_controls',
            'method': 'v109_linear_backcast_provincial_total_then_density_proxy_distribution',
            'source': 'БРЭ: Тобольская губерния 831 151 чел. в 1846 г.; перепись 1897 г. — 1 433 043 чел. в губернии.',
            'note': 'Оценка нужна для непрерывности ряда; заменить при появлении прямых ревизских итогов по Тобольской губернии.'
        },
    ],
    1838: [
        {
            'unit': 'Томская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Томская губерния' and not yes(p.get('topology_excluded')),
            'total': 453814,
            'source_year': 1838,
            'basis': 'оба пола; расчёт от 1835 к 1838',
            'quality': 'interpolated_from_near_benchmark',
            'method': 'v109_421000_1835_plus_3x10938_then_density_proxy_distribution',
            'source': 'Список населённых мест Томской губернии: 421 тыс. в 1835 г.; среднегодовой прирост 1835–1851 гг. 10 938 чел.',
            'note': '453 814 = 421 000 + 3 × 10 938; распределено по регулярным округам Томской губернии.'
        },
        {
            'unit': 'Тобольская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Тобольская губерния' and not yes(p.get('topology_excluded')),
            'total': 736746,
            'source_year': 1838,
            'basis': 'оба пола; линейная ретрооценка от контроля 1846 и переписи 1897',
            'quality': 'rough_backcast_from_1846_1897_controls',
            'method': 'v109_linear_backcast_provincial_total_then_density_proxy_distribution',
            'source': 'БРЭ: Тобольская губерния 831 151 чел. в 1846 г.; перепись 1897 г. — 1 433 043 чел. в губернии.',
            'note': 'Омская область в слое 1838 сохраняет уже внесённые проектные значения; этот контроль распределён только по Тобольской губернии.'
        },
    ],
    1848: [
        {
            'unit': 'Тобольская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Тобольская губерния' and not yes(p.get('topology_excluded')),
            'total': 831151,
            'source_year': 1846,
            'basis': 'оба пола; ближайший губернский контроль',
            'quality': 'benchmark_control_total_near_year',
            'method': 'v109_density_proxy_distribution_to_regular_okrug_polygons',
            'source': 'БРЭ: Тобольская губерния, 831 151 житель обоего пола в 1846 г.',
            'note': 'Использовано как ближайший контроль для слоя 1848.'
        },
        {
            'unit': 'Томская губерния',
            'selector': lambda p: clean_str(p.get('admin_parent')) == 'Томская губерния' and not yes(p.get('topology_excluded')),
            'total': 563186,
            'source_year': 1848,
            'basis': 'оба пола; расчёт от 1851 без семипалатинско-усть-каменогорского хвоста',
            'quality': 'interpolated_from_near_benchmark',
            'method': 'v109_596000_1851_minus_3x10938_then_density_proxy_distribution',
            'source': 'Список населённых мест Томской губернии: сопоставимая оценка около 596 тыс. в 1851 г.; среднегодовой прирост 10 938 чел.',
            'note': '563 186 = 596 000 − 3 × 10 938; регулярная томская рамка без отдельной степной добавки.'
        },
    ],
}

# Separate 1848 semipalatinsk / ust-kamenogorsk tail included by request.
SPECIAL_POP_ASSIGNMENTS = [
    {
        'year': 1848,
        'unit_id': 'adm_1848_2',
        'population': 25000,
        'unit': 'Семипалатинский и Усть-Каменогорский уезды в рамке Томской губернии',
        'source_year': 1848,
        'basis': 'оба пола; разница между общим контролем Томской губернии 1851 и сопоставимой рамкой без Семипалатинска/Усть-Каменогорска',
        'quality': 'rough_tail_estimate',
        'method': 'v109_621000_1851_minus_596000_1851_tail_kept_for_1848',
        'source': 'Список населённых мест Томской губернии: общий итог 1851 около 621 тыс.; сопоставимый без Семипалатинска/Усть-Каменогорска около 596 тыс.',
        'note': 'Добавка включена по просьбе пользователя: в 1848 учитывать Семипалатинск и Усть-Каменогорск, откатив общий томский контроль на 3 года.'
    }
]


def prepare_1897_from_upload():
    if not UPLOADED_1897.exists():
        raise FileNotFoundError(f'Uploaded 1897 layer not found: {UPLOADED_1897}')
    dst = ADMIN / 'admin_1897.geojson'
    before = load_json(dst)
    shutil.copyfile(UPLOADED_1897, dst)
    after = load_json(dst)
    # Normalize duplicate unit_id in uploaded split. Keep old Semipalatinsk id and create new Ust-Kamenogorsk id.
    seen = set()
    changes = []
    for i, f in enumerate(after.get('features', []), start=1):
        p = f.setdefault('properties', {})
        name = clean_str(p.get('name'))
        uid = clean_str(p.get('unit_id')) or f'adm_1897_{i}'
        if name == 'Усть-Каменогорский уезд' and uid == 'adm_1897_16':
            p['unit_id'] = 'adm_1897_31'
            p['raw_objectid'] = p.get('raw_objectid') or '31'
            p['v109_split_note'] = 'v109: отделён от прежнего совмещённого Семипалатинского уезда; population preserved from uploaded split'
            changes.append({'name': name, 'old_unit_id': uid, 'new_unit_id': p['unit_id']})
            uid = p['unit_id']
        if uid in seen:
            new_uid = f'adm_1897_{i:02d}_dupfix'
            changes.append({'name': name, 'old_unit_id': uid, 'new_unit_id': new_uid})
            p['unit_id'] = new_uid
            uid = new_uid
        seen.add(uid)
        p['year'] = 1897
        if p.get('admin_parent') and not p.get('admin_superparent'):
            # Do not force the map mode; this makes hierarchy metrics understand the upper level.
            p['admin_superparent'] = p.get('admin_parent')
        if p.get('admin_parent') and not p.get('admin_intermediate'):
            p['admin_intermediate'] = p.get('admin_parent')
        if p.get('name') and not p.get('unit_type'):
            p['unit_type'] = 'уезд' if 'уезд' in p.get('name').lower() else ('округ' if 'округ' in p.get('name').lower() else p.get('unit_type'))
    write_json(dst, after)
    with (DOCS / 'v109_1897_uploaded_layer_replacement.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['metric','before','after']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        w.writerow({'metric':'feature_count', 'before':len(before.get('features',[])), 'after':len(after.get('features',[]))})
        w.writerow({'metric':'total_population', 'before':sum(finite((x.get('properties') or {}).get('population')) or 0 for x in before.get('features',[])), 'after':sum(finite((x.get('properties') or {}).get('population')) or 0 for x in after.get('features',[]))})
    with (DOCS / 'v109_1897_unit_id_split_fix.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['name','old_unit_id','new_unit_id']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(changes)


def recalc_rail_for_year(year: int):
    rail_path = DATA / 'railways' / 'railways.geojson'
    if not rail_path.exists():
        return []
    rail_gj = load_json(rail_path)
    rail_items = []
    for rf in rail_gj.get('features', []):
        rp = rf.get('properties') or {}
        yo = finite(rp.get('year_open'))
        yc = finite(rp.get('year_close'))
        if yo is not None and yo > year:
            continue
        if yc is not None and yc <= year:
            continue
        try:
            g = shape(rf.get('geometry'))
            if not g.is_valid:
                g = make_valid(g)
            gm = transform(to_m, g)
            if not gm.is_empty:
                rail_items.append(gm)
        except Exception:
            continue
    if not rail_items:
        return []
    tree = STRtree(rail_items)
    gj = load_json(ADMIN / f'admin_{year}.geojson')
    rows = []
    for f in gj.get('features', []):
        p = f.get('properties') or {}
        try:
            pg = shape(f.get('geometry'))
            if not pg.is_valid:
                pg = make_valid(pg)
            pm = transform(to_m, pg)
        except Exception:
            continue
        length = 0.0; segs = 0
        for idx in tree.query(pm):
            rg = rail_items[int(idx)]
            inter = pm.intersection(rg)
            if not inter.is_empty:
                L = float(inter.length) / 1000.0
                if L > 0.01:
                    length += L; segs += 1
        old_len = finite(p.get('rail_length_km')) or 0.0
        p['rail_length_km'] = round(length, 2)
        area = finite(p.get('area_km2'))
        p['rail_density_km_1000'] = round(length / area * 1000, 3) if area and area > 0 else 0.0
        p['rail_segments_count'] = segs
        rows.append({'year':year, 'unit_id':p.get('unit_id'), 'name':p.get('name'), 'old_rail_length_km':round(old_len,2), 'new_rail_length_km':p['rail_length_km'], 'segments':segs})
    write_json(ADMIN / f'admin_{year}.geojson', gj)
    return rows


def update_density_fields(year:int):
    path = ADMIN / f'admin_{year}.geojson'
    gj = load_json(path)
    for f in gj.get('features', []):
        p = f.setdefault('properties', {})
        pop = finite(p.get('population'))
        area = finite(p.get('area_km2'))
        p['density'] = round(pop / area, 6) if pop is not None and area and area > 0 else None
        urban = finite(p.get('urban_pop'))
        p['urban_share'] = round(urban / pop, 6) if urban is not None and pop and pop > 0 else None
    write_json(path, gj)


def apply_population_controls():
    ref = compute_reference_densities_1897()
    rows = []
    # Clear previous v109 marks / preserve non-v109 values outside controls.
    for year in SUPPORT_YEARS:
        path = ADMIN / f'admin_{year}.geojson'
        gj = load_json(path)
        for f in gj.get('features', []):
            p = f.setdefault('properties', {})
            for k in list(p.keys()):
                if str(k).startswith('population_') and str(k).endswith('_v109'):
                    p.pop(k, None)
            # If the field was produced by v109, clear before recalculation.
            if clean_str(p.get('population_reconstruction_version')) == 'v109':
                p['population'] = None
                p['urban_pop'] = None
                p['rural_pop'] = None
                p['urban_share'] = None
                p['density'] = None
        write_json(path, gj)

    for year, controls in CONTROL_GROUPS.items():
        path = ADMIN / f'admin_{year}.geojson'
        gj = load_json(path)
        feats = gj.get('features', [])
        for control in controls:
            selected = [f for f in feats if control['selector'](f.get('properties') or {})]
            # group-specific median fallback from known/ref densities
            dens_vals = []
            for f in selected:
                p = f.get('properties') or {}
                dens_vals.append(proxy_density(p.get('name'), ref, None))
            group_med = median(dens_vals) if dens_vals else 0.8
            weights = []
            for f in selected:
                p = f.get('properties') or {}
                area = finite(p.get('area_km2')) or 0.0
                dens = proxy_density(p.get('name'), ref, group_med)
                # Slightly dampen extreme area effect: equivalent settled-area mass.
                weights.append(max(0.001, area * dens))
            pops = alloc_integer(int(control['total']), weights)
            for f, pop, weight in zip(selected, pops, weights):
                p = f.setdefault('properties', {})
                old = p.get('population')
                p['population'] = int(pop)
                p['urban_pop'] = None
                p['rural_pop'] = None
                p['urban_share'] = None
                p['population_v109'] = int(pop)
                p['population_reconstruction_version'] = 'v109'
                p['population_source'] = control['source']
                p['population_source_year'] = control['source_year']
                p['population_source_unit'] = control['unit']
                p['population_basis'] = control['basis']
                p['population_quality'] = control['quality']
                p['population_method'] = control['method']
                p['population_note'] = control['note']
                rows.append(touched_feature_row(year, p, old, pop, control, weight))
        # Special additions (e.g. 1848 steppe tail).
        for spec in [s for s in SPECIAL_POP_ASSIGNMENTS if s['year'] == year]:
            for f in feats:
                p = f.setdefault('properties', {})
                if clean_str(p.get('unit_id')) == spec['unit_id']:
                    old = p.get('population')
                    p['population'] = int(spec['population'])
                    p['urban_pop'] = None
                    p['rural_pop'] = None
                    p['urban_share'] = None
                    p['population_v109'] = int(spec['population'])
                    p['population_reconstruction_version'] = 'v109'
                    p['population_source'] = spec['source']
                    p['population_source_year'] = spec['source_year']
                    p['population_source_unit'] = spec['unit']
                    p['population_basis'] = spec['basis']
                    p['population_quality'] = spec['quality']
                    p['population_method'] = spec['method']
                    p['population_note'] = spec['note']
                    p['population_trend_include_v109'] = True
                    # Include only for population analytics; topology stays excluded.
                    p['include_in_analytics'] = True
                    rows.append({
                        'year': year, 'unit_id': p.get('unit_id'), 'name': p.get('name'),
                        'admin_parent': p.get('admin_parent'), 'unit_type': p.get('unit_type'),
                        'area_km2': p.get('area_km2'), 'old_population': old, 'new_population': spec['population'],
                        'density': p.get('density'), 'control_unit': spec['unit'], 'control_total': spec['population'],
                        'source_year': spec['source_year'], 'quality': spec['quality'], 'method': spec['method'],
                        'allocation_weight': '',
                    })
        write_json(path, gj)
        update_density_fields(year)

    with (DOCS / 'v109_population_support_assignments.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','unit_id','name','admin_parent','unit_type','area_km2','old_population','new_population','density','control_unit','control_total','source_year','quality','method','allocation_weight']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

    # Control summaries.
    summary = []
    for year in SUPPORT_YEARS:
        gj = load_json(ADMIN / f'admin_{year}.geojson')
        by_src = defaultdict(float)
        by_parent = defaultdict(float)
        for f in gj.get('features', []):
            p = f.get('properties') or {}
            pop = finite(p.get('population'))
            if pop is None: continue
            by_parent[clean_str(p.get('admin_parent')) or '—'] += pop
            by_src[clean_str(p.get('population_source_unit')) or 'existing_or_uncontrolled'] += pop
        for k, v in sorted(by_parent.items()):
            summary.append({'year':year, 'group_type':'admin_parent', 'group':k, 'population_sum':int(round(v))})
        for k, v in sorted(by_src.items()):
            summary.append({'year':year, 'group_type':'population_source_unit', 'group':k, 'population_sum':int(round(v))})
    with (DOCS / 'v109_population_support_control_sums.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','group_type','group','population_sum']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(summary)


def rebuild_topology_years(years):
    metrics_path = TOPO / 'topology_metrics_by_year.json'
    rows = load_json(metrics_path)
    by_year = {int(r['year']): r for r in rows}
    summaries=[]; all_edges=[]; excluded_all=[]
    for y in years:
        summary, metrics, edges, excluded = TOPO_NS['rebuild_year'](y)
        by_year[y] = metrics
        summaries.append(summary)
        all_edges.extend(edges)
        excluded_all.extend(excluded)
        update_density_fields(y)  # v94 rewrites admin files; restore density after area recalculation.
    write_json(metrics_path, [by_year[y] for y in sorted(by_year)], indent=2)
    with (DOCS / 'v109_topology_rebuild_summary.csv').open('w', encoding='utf-8', newline='') as f:
        fields = sorted({k for row in summaries for k in row.keys()})
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(summaries)
    with (DOCS / 'v109_topology_edges_1897.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','source_id','source_name','source_parent','target_id','target_name','target_parent','boundary_km','relation','contact_method','is_bridge']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows([e for e in all_edges if int(e['year']) == 1897])
    with (DOCS / 'v109_topology_excluded_features.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','unit_id','name','unit_type','area_km2','reason','special_status_code']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(excluded_all)


def refresh_multiyear_metrics(years):
    path = TOPO / 'multiyear_metrics_by_year.json'
    rows = load_json(path)
    before = {int(r['year']): dict(r) for r in rows}
    out=[]; compare=[]
    for r in rows:
        y = int(r.get('year'))
        if y in years:
            nr, excluded = V104_NS['metrics_for_year'](y, r)
            nr['population_reconstruction_scope_v109'] = 'early support population series added for 1783/1809/1821/1838/1848; 1897 topology refreshed after Semipalatinsk/Ust-Kamenogorsk split'
            if y in SUPPORT_YEARS:
                nr['population_metrics_method_v109'] = 'population sums use v109 support-level provincial/control benchmarks written to admin GeoJSON; quality varies by feature population_quality'
            if y == 1897:
                nr['v109_1897_topology_note'] = 'admin_1897.geojson replaced by uploaded split layer; Ust-Kamenogorsk assigned unique unit_id adm_1897_31; topology/area/rail metrics refreshed; total population preserved'
            out.append(nr)
            b = before.get(y, {})
            keys = ['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','total_area_km2','avg_area_km2','total_population','population_density','urban_population','rural_population','urban_share','rail_length_km_total','rail_density_km_1000','avg_adjacency','nodes','edges','components','graph_density','cyclomatic','bridges','articulation_points','avg_degree','avg_lower_units_per_upper_ate','avg_area_upper_ate_km2','avg_area_middle_ate_km2']
            for k in keys:
                bv, av = b.get(k), nr.get(k)
                delta = ''
                if isinstance(bv,(int,float)) and isinstance(av,(int,float)):
                    delta = av - bv
                compare.append({'year':y,'metric':k,'before':bv,'after':av,'delta':delta})
        else:
            out.append(r)
    write_json(path, out, indent=2)
    with (DOCS / 'v109_multiyear_metrics_before_after.csv').open('w', encoding='utf-8', newline='') as f:
        fields = ['year','metric','before','after','delta']
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(compare)

    # Re-run area dispersion enrichment globally, so changed areas/hierarchy for 1897 are reflected.
    V105_NS['main']()


def update_population_long():
    path = DATA / 'population_long.csv'
    existing=[]; cols=[]
    if path.exists():
        with path.open('r', encoding='utf-8', newline='') as f:
            r = csv.DictReader(f)
            cols = r.fieldnames or []
            existing = list(r)
    changed_set = {str(y) for y in CHANGED_YEARS}
    existing = [r for r in existing if str(r.get('year')) not in changed_set]
    base_cols = ['year','unit_id','name','unit_type','admin_parent','population','urban_pop','rural_pop','urban_share','area_km2','density','rail_length_km','rail_density_km_1000','rail_segments_count']
    extra_cols = ['population_source_year','population_source_unit','population_basis','population_quality','population_method','population_note','population_source','population_reconstruction_version']
    cols = list(dict.fromkeys((cols or base_cols) + extra_cols))
    rows = existing[:]
    for y in CHANGED_YEARS:
        gj = load_json(ADMIN / f'admin_{y}.geojson')
        for f in gj.get('features', []):
            p = f.get('properties') or {}
            row = {c:'' for c in cols}
            for c in cols:
                if c in p:
                    row[c] = p.get(c)
            row.update({
                'year': y,
                'unit_id': p.get('unit_id',''),
                'name': p.get('name',''),
                'unit_type': p.get('unit_type',''),
                'admin_parent': p.get('admin_parent',''),
                'population': p.get('population',''),
                'urban_pop': p.get('urban_pop',''),
                'rural_pop': p.get('rural_pop',''),
                'urban_share': p.get('urban_share',''),
                'area_km2': p.get('area_km2',''),
                'density': p.get('density',''),
                'rail_length_km': p.get('rail_length_km',''),
                'rail_density_km_1000': p.get('rail_density_km_1000',''),
                'rail_segments_count': p.get('rail_segments_count',''),
            })
            rows.append(row)
    def sort_key(r):
        try: y=int(float(r.get('year') or 0))
        except Exception: y=0
        return (y, str(r.get('unit_id') or ''))
    rows.sort(key=sort_key)
    with path.open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader(); w.writerows(rows)


def update_app_version():
    # app.js
    app = ROOT / 'app.js'
    text = app.read_text(encoding='utf-8')
    text = re.sub(r"const APP_VERSION = '\d+';", "const APP_VERSION = '109';", text)
    app.write_text(text, encoding='utf-8')
    # index.html
    idx = ROOT / 'index.html'
    text = idx.read_text(encoding='utf-8')
    text = re.sub(r'style\.css\?v=\d+', 'style.css?v=109', text)
    text = re.sub(r'app\.js\?v=\d+', 'app.js?v=109', text)
    text = re.sub(r'Дипломный веб-атлас · v\d+', 'Дипломный веб-атлас · v109', text)
    idx.write_text(text, encoding='utf-8')
    # manifest
    man_path = DATA / 'manifest.json'
    man = load_json(man_path)
    man['app_version'] = 109
    entry = {'version': '109', 'note': 'Опорная реконструкция населения для 1783/1809/1821/1838/1848; замена слоя 1897 с разделением Семипалатинского и Усть-Каменогорского уездов; пересчёт топологии, областных метрик, population_long и диагностик.'}
    changelog = man.get('changelog')
    if isinstance(changelog, list):
        changelog = [x for x in changelog if not (isinstance(x, dict) and str(x.get('version')) == '109')]
        changelog.append(entry)
        man['changelog'] = changelog
    elif isinstance(changelog, dict):
        changelog['v109'] = entry['note']
    else:
        man['changelog'] = [entry]
    write_json(man_path, man, indent=2)


def main():
    prepare_1897_from_upload()
    # Rebuild 1897 topology immediately after replacement to recalc true areas.
    rebuild_topology_years([1897])
    rail_rows = recalc_rail_for_year(1897)
    update_density_fields(1897)
    with (DOCS / 'v109_1897_rail_recalc.csv').open('w', encoding='utf-8', newline='') as f:
        fields=['year','unit_id','name','old_rail_length_km','new_rail_length_km','segments']
        w=csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rail_rows)

    apply_population_controls()
    # Support layers need topology rebuild after v94 may have area updates from earlier? Rebuild all support years for consistency.
    rebuild_topology_years(SUPPORT_YEARS + [1897])
    # v94 rebuild overwrites rail values for 1897? It doesn't touch rail; but rewrite density after area updates.
    rail_rows = recalc_rail_for_year(1897)
    update_density_fields(1897)
    with (DOCS / 'v109_1897_rail_recalc.csv').open('w', encoding='utf-8', newline='') as f:
        fields=['year','unit_id','name','old_rail_length_km','new_rail_length_km','segments']
        w=csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rail_rows)

    refresh_multiyear_metrics(CHANGED_YEARS)
    update_population_long()
    update_app_version()
    print('v109 done')


if __name__ == '__main__':
    main()
