#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v117: normalize city / district unit_type attributes and refresh lightweight tabular outputs."""
from pathlib import Path
import json, csv, re, math, collections

ROOT=Path(__file__).resolve().parent
ADMIN=ROOT/'data'/'admin'
DOCS=ROOT/'docs'; DOCS.mkdir(exist_ok=True)

CITY_NAME_RE=re.compile(r'(^г\.?\s+|^город\s+|\bгорсовет\b|\bгорсоветский\b|\bг\.?\s)', re.I)
CITY_UNIT_RE=re.compile(r'(город|горсовет|городск|центр округа)', re.I)

# Explicit 2021 modern municipal statuses inferred from current atlas schema and checked against official/regional summaries.
# Existing v116 2021 layer used "район" for city / urban-okrug objects and "округ" for municipal okrugs.

def num(x):
    try:
        if x is None or x=='': return None
        v=float(x)
        return v if math.isfinite(v) else None
    except Exception:
        return None

def write_geo(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')), encoding='utf-8')

def is_city_like(p, year):
    name=str(p.get('name') or '').strip()
    unit=str(p.get('unit_type') or '').strip()
    area=num(p.get('area_km2')) or 0
    text=' '.join([name, unit, str(p.get('admin_parent') or ''), str(p.get('admin_intermediate') or '')])
    if CITY_UNIT_RE.search(unit) or CITY_NAME_RE.search(name):
        return True
    # In the late Soviet layers a compact polygon with district type is normally a city / gorodskoy sovet contour.
    # Do not apply blindly to 2021: it has its own municipal normalization.
    if year in {1939,1947,1959,1964,1970,1979,1989} and 0 < area < 700:
        # Skip a few known false positives that are compact / defective rural districts in the source geometry.
        if name in {'Коченевский район','Сургутский район'}:
            return False
        return True
    return False

def normalize_1939_1989_city_types(p, year):
    if year not in {1939,1947,1959,1964,1970,1979,1989}:
        return None
    if is_city_like(p, year):
        # v117 explicit exception: two 1947 republican-subordination cities are their own upper/lower level.
        n=str(p.get('name') or '').lower()
        if year==1947 and ('новосибирск' in n or 'омск' in n) and ('горсовет' in n or n.startswith('омск') or n.startswith('новосибир')):
            return 'город республиканского подчинения'
        return 'горсовет'
    return None

def normalize_2021(p):
    unit=str(p.get('unit_type') or '').strip().lower()
    name=str(p.get('name') or '').strip().lower()
    if 'муниципальный район' in unit:
        return 'муниципальный район'
    if unit == 'округ' or 'муниципальный округ' in name or 'муниципальный округ' in unit:
        return 'муниципальный округ'
    # In v116, remaining 2021 "район" entries are city / urban-okrug polygons: cities, ZATO, workers' settlement Kольцово,
    # and city-okrug style names in Kemerovo, Tyumen, KhMAO, YaNAO etc.
    if unit == 'район' or name.startswith('город ') or name.startswith('г ') or name.startswith('зато') or 'поселок кольцово' in name:
        return 'городской округ'
    return p.get('unit_type')

def set_1947_republican_city_parent(p):
    n=str(p.get('name') or '').lower()
    if re.search(r'(^|\b)новосибирск', n) and 'горсовет' in n:
        label='Новосибирск — город республиканского подчинения'
    elif re.search(r'(^|\b)омск', n) and 'горсовет' in n:
        label='Омск — город республиканского подчинения'
    else:
        return False
    p['unit_type']='город республиканского подчинения'
    p['admin_parent']=label
    p['admin_intermediate']=label
    p['admin_superparent']=label
    p['atd_level_top']='город республиканского подчинения'
    p['atd_level_lower']='город республиканского подчинения'
    p['v117_type_note']='выделено из областного подчинения как самостоятельный верхний и нижний уровень АТД'
    return True

def update_admin_files():
    ops=[]
    for year in [1926,1930,1939,1947,1959,1964,1970,1979,1989,2021]:
        path=ADMIN/f'admin_{year}.geojson'
        data=json.loads(path.read_text(encoding='utf-8'))
        changed=0
        for f in data.get('features',[]):
            p=f.get('properties') or {}
            old=p.get('unit_type')
            new=None
            reason=''
            if year in {1926,1930}:
                if str(old).strip().lower() in {'город','центр округа'}:
                    new='центр округа'; reason='v117: отдельный город-центр окружного уровня'
            elif year==2021:
                new=normalize_2021(p); reason='v117: современная муниципальная типология 2021'
            else:
                new=normalize_1939_1989_city_types(p, year); reason='v117: городские контуры 1939–1989 нормализованы как горсоветы'
            if new and new != old:
                p['unit_type']=new
                p['v117_previous_unit_type']=old
                p['v117_unit_type_reason']=reason
                changed+=1
                ops.append({'year':year,'unit_id':p.get('unit_id'),'name':p.get('name'),'old_unit_type':old,'new_unit_type':new,'reason':reason,'area_km2':p.get('area_km2'),'admin_parent':p.get('admin_parent')})
            if year==1947:
                before=p.get('admin_parent')
                if set_1947_republican_city_parent(p):
                    ops.append({'year':year,'unit_id':p.get('unit_id'),'name':p.get('name'),'old_unit_type':old,'new_unit_type':p.get('unit_type'),'reason':'v117: город республиканского подчинения вынесен из области','area_km2':p.get('area_km2'),'admin_parent':p.get('admin_parent'),'old_admin_parent':before})
        write_geo(path, data)
        print(year, 'changed', changed)
    with (DOCS/'v117_unit_type_normalization.csv').open('w',encoding='utf-8',newline='') as fp:
        fields=['year','unit_id','name','old_unit_type','new_unit_type','reason','area_km2','admin_parent','old_admin_parent']
        w=csv.DictWriter(fp,fieldnames=fields); w.writeheader(); w.writerows(ops)
    return ops

def regenerate_population_long():
    fields=['year','unit_id','name','unit_type','admin_parent','admin_intermediate','admin_superparent','population','urban_pop','rural_pop','urban_share','area_km2','density','rail_length_km','rail_density_km_1000','rail_segments_count','population_source_year','population_source_unit','population_basis','population_quality','population_method','population_note','population_source','population_reconstruction_version','population_recalc_note','urban_pop_method','urban_pop_source','merged_city_names_v114','v117_previous_unit_type','v117_unit_type_reason','v117_type_note']
    rows=[]
    for path in sorted(ADMIN.glob('admin_*.geojson'), key=lambda p:int(re.search(r'(\d+)',p.name).group(1))):
        year=int(re.search(r'(\d+)',path.name).group(1))
        data=json.loads(path.read_text(encoding='utf-8'))
        for f in data.get('features',[]):
            p=f.get('properties') or {}
            rows.append({k:(year if k=='year' else p.get(k)) for k in fields})
    with (ROOT/'data'/'population_long.csv').open('w',encoding='utf-8',newline='') as fp:
        w=csv.DictWriter(fp,fieldnames=fields); w.writeheader(); w.writerows(rows)

def update_multiyear_type_notes():
    # Preserve numeric metrics; add a small audit column where relevant so tables expose the type normalization.
    path=ROOT/'data'/'topology'/'multiyear_metrics_by_year.json'
    rows=json.loads(path.read_text(encoding='utf-8'))
    touched={1926,1930,1939,1947,1959,1964,1970,1979,1989,2021}
    for r in rows:
        try: y=int(r.get('year'))
        except Exception: continue
        if y in touched:
            r['unit_type_normalization_v117']='city/urban unit_type normalized for interface filtering; numeric metrics unchanged unless source attributes are grouped by unit_type'
    path.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')

def main():
    update_admin_files()
    regenerate_population_long()
    update_multiyear_type_notes()
    print('v117 unit type normalization complete')

if __name__=='__main__':
    main()
