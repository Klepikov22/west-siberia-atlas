#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations
import json, csv, math, re
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union
from shapely.validation import make_valid
from pyproj import CRS, Transformer

ROOT=Path(__file__).resolve().parent
ADMIN=ROOT/'data'/'admin'; URBAN=ROOT/'data'/'urban'; DOCS=ROOT/'docs'; DOCS.mkdir(exist_ok=True)
crs_src=CRS.from_epsg(4326); crs_dst=CRS.from_proj4('+proj=laea +lat_0=58 +lon_0=82 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
to_m=Transformer.from_crs(crs_src,crs_dst,always_xy=True).transform

def load(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def save(p,o): Path(p).write_text(json.dumps(o,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def num(v,d=0.0):
    try:
        if v is None or v=='': return d
        x=float(v); return x if math.isfinite(x) else d
    except Exception: return d

def clean(g):
    try:
        g=make_valid(g)
        g=g.buffer(0)
        if not g.is_valid: g=make_valid(g)
    except Exception: pass
    return g

def area_km2(g):
    try: return round(clean(transform(to_m,g)).area/1e6,3)
    except Exception: return None

def add(p,k,v): p[k]=round(num(p.get(k))+num(v),6)
def note(old,t):
    old=str(old or '').strip(); return old+'; '+t if old else t

def update_density(p, force_zero=False):
    if force_zero:
        p['density']=0; return
    area=num(p.get('area_km2')); pop=num(p.get('population'))
    p['density']=round(pop/area,6) if area>0 else None
    if p.get('urban_pop') is not None and pop>0:
        p['urban_share']=round(num(p.get('urban_pop'))/pop,6)

KEEP_1926={
 'Барабинск','Барнаул','Бийск','Ишим','Камень-на-Оби','Кузнецк / Сталинск / Новокузнецк',
 'Ново-Николаевск / Новосибирск','Омск','Славгород','Тара','Тобольск','Томск','Тюмень'
}
KEEP_1930={
 'Барнаул','Бийск','Ишим','Каинск / Куйбышев','Камень-на-Оби','Ново-Николаевск / Новосибирск',
 'Омск','Рубцовск','Славгород','Тобольск','Томск','Тюмень','Щегловск / Кемерово',
 'Ойрот-Тура / Горно-Алтайск'
}

def is_city_poly(p):
    uid=str(p.get('unit_id') or '')
    typ=str(p.get('unit_type') or '').lower()
    return uid.startswith('urban_') or 'город' in typ or 'рп' in typ or 'пгт' in typ

def merge_into(host, city):
    hp=host['properties']; cp=city['properties']
    try:
        hg=clean(shape(host['geometry'])); cg=clean(shape(city['geometry']))
        ug=clean(unary_union([hg,cg])); host['geometry']=mapping(ug); hp['area_km2']=area_km2(ug)
    except Exception: pass
    pop=num(cp.get('population')); urban=num(cp.get('urban_pop')); rural=num(cp.get('rural_pop'))
    add(hp,'population',pop); add(hp,'urban_pop',urban); add(hp,'rural_pop',rural)
    add(hp,'strict_city_pop',num(cp.get('strict_city_pop'),urban)); add(hp,'worker_settlement_pop',num(cp.get('worker_settlement_pop'))); add(hp,'broader_urban_pop',num(cp.get('broader_urban_pop'),urban))
    hp['urban_pop_method']='v114_city_polygon_merged_to_host_ate'; hp['urban_pop_source']='city_layer_merged_from_micro_polygons'
    ids=[x for x in str(hp.get('merged_city_ids_v114') or '').split('; ') if x]; ids.append(str(cp.get('unit_id') or '')); hp['merged_city_ids_v114']='; '.join(dict.fromkeys(ids))
    names=[x for x in str(hp.get('merged_city_names_v114') or '').split('; ') if x]; names.append(str(cp.get('name') or '')); hp['merged_city_names_v114']='; '.join(dict.fromkeys(names))
    hp['population_recalc_note']=note(hp.get('population_recalc_note'),f"v114: присоединён городской микрополигон {cp.get('name')} ({int(round(pop))} чел.)")
    update_density(hp)

def update_city_points_from_polygons(year):
    pts_path=URBAN/f'urban_points_{year}.geojson'; poly_path=URBAN/f'urban_polygons_{year}.geojson'
    if not pts_path.exists() or not poly_path.exists(): return
    pts=load(pts_path); polys=load(poly_path)
    by_name={str(f['properties'].get('name') or '').lower(): f['properties'] for f in polys.get('features',[])}
    by_uid={str(f['properties'].get('unit_id') or ''): f['properties'] for f in polys.get('features',[])}
    for f in pts.get('features',[]):
        p=f['properties']; pp=by_uid.get(str(p.get('urban_id') or '')) or by_name.get(str(p.get('name') or '').lower())
        if pp:
            for k in ['admin_parent','admin_intermediate','admin_superparent','host_unit_id','host_name','settlement_status','urban_pop_source','urban_pop_method']:
                if pp.get(k) not in (None,''): p[k]=pp.get(k)
        p['point_layer_role']='city_point'; p['display_label']=p.get('name'); p['display_population']=p.get('population')
    save(pts_path,pts)

def add_novo(year,pop,host_id,host_name,parent):
    path=URBAN/f'urban_points_{year}.geojson'; pts=load(path) if path.exists() else {'type':'FeatureCollection','features':[]}
    pts['features']=[f for f in pts.get('features',[]) if str(f.get('properties',{}).get('name'))!='Ново-Омск']
    props={'source':'v114_manual_city_point','name':'Ново-Омск','canonical_name':'Ново-Омск','year':year,'lon':73.3,'lat':55.0,'population':pop,'status':'городское поселение','settlement_type':'городское поселение','include_city':True,'include_worker_settlement':False,'include_broader_urban':True,'strict_city_pop':pop,'worker_settlement_pop':0,'broader_urban_pop':pop,'population_quality':'manual_control_from_user','urban_id':f'urban_{year}_novo_omsk_v114','admin_parent':parent,'admin_intermediate':parent,'admin_superparent':'РСФСР','host_unit_id':host_id,'host_name':host_name,'status_note':'v114: добавлено по указанию пользователя; координаты 55°00′ с. ш., 73°18′ в. д.'}
    pts['features'].append({'type':'Feature','geometry':{'type':'Point','coordinates':[73.3,55.0]},'properties':props})
    save(path,pts)

def process_year(year):
    keep_names=KEEP_1926 if year==1926 else KEEP_1930 if year==1930 else set()
    gj=load(ADMIN/f'admin_{year}.geojson'); feats=gj['features']; byid={str(f['properties'].get('unit_id')):f for f in feats}; out=[]; ops=[]
    for f in feats:
        p=f['properties']; uid=str(p.get('unit_id') or ''); name=str(p.get('name') or '')
        if not is_city_poly(p): out.append(f); continue
        if year==1930 and uid=='urban_1930_14':
            p['population']=126591; p['urban_pop']=126591; p['rural_pop']=0; p['strict_city_pop']=126591; p['broader_urban_pop']=126591; p['urban_share']=1.0; p['density']=0
            p['population_recalc_note']=note(p.get('population_recalc_note'),'v114: Омск исправлен до 126 591 чел. по контрольному значению пользователя')
        keep = year in (1926,1930) and name in keep_names
        if keep:
            p['include_in_selection']=True; p['filter_exempt_metric_filters']=True; p['topology_excluded']=True; p['topology_exclusion_reason']='v114_kept_city_center_polygon_excluded_from_topology'; p['city_center_polygon_kept_v114']=True
            update_density(p, force_zero=True)
            p['population_recalc_note']=note(p.get('population_recalc_note'),'v114: город-центр оставлен отдельным полигоном, выведен из метрических фильтров и исключён из топологии')
            out.append(f); ops.append({'year':year,'action':'kept_city_center_polygon','unit_id':uid,'name':name,'host_unit_id':p.get('host_unit_id'),'host_name':p.get('host_name'),'population':p.get('population'),'urban_pop':p.get('urban_pop')}); continue
        host=byid.get(str(p.get('host_unit_id') or ''))
        if host and host is not f:
            merge_into(host,f); ops.append({'year':year,'action':'merged_city_to_host','unit_id':uid,'name':name,'host_unit_id':p.get('host_unit_id'),'host_name':host['properties'].get('name'),'population':p.get('population'),'urban_pop':p.get('urban_pop')})
        else:
            out.append(f); ops.append({'year':year,'action':'kept_no_host','unit_id':uid,'name':name,'host_unit_id':p.get('host_unit_id'),'host_name':p.get('host_name'),'population':p.get('population'),'urban_pop':p.get('urban_pop')})
    gj['features']=out
    if year==1926:
        sos=next((f for f in out if f['properties'].get('unit_id')=='adm_1926_110'),None)
        if sos:
            p=sos['properties']; add(p,'population',11070); add(p,'urban_pop',11070); p['rural_pop']=num(p.get('rural_pop')); add(p,'strict_city_pop',11070); add(p,'broader_urban_pop',11070); p['urban_pop_method']='v114_manual_novo_omsk_added_to_sosnovsky'; p['urban_pop_source']='user_control_value'; p['merged_city_names_v114']=note(p.get('merged_city_names_v114'),'Ново-Омск'); p['population_recalc_note']=note(p.get('population_recalc_note'),'v114: включён Ново-Омск, 11 070 чел. городского населения'); update_density(p); ops.append({'year':year,'action':'manual_add_novo_omsk','unit_id':p.get('unit_id'),'name':p.get('name'),'host_unit_id':p.get('unit_id'),'host_name':p.get('name'),'population':11070,'urban_pop':11070})
        add_novo(1926,11070,'adm_1926_110','Сосновский','Омский округ')
    if year==1930:
        r4=next((f for f in out if f['properties'].get('unit_id')=='adm_1930_94'),None)
        if r4:
            p=r4['properties']; add(p,'population',14316); add(p,'urban_pop',14316); p['rural_pop']=num(p.get('rural_pop')); add(p,'strict_city_pop',14316); add(p,'broader_urban_pop',14316); p['urban_pop_method']='v114_manual_novo_omsk_added_to_omsk_district_4'; p['urban_pop_source']='user_control_value'; p['merged_city_names_v114']=note(p.get('merged_city_names_v114'),'Ново-Омск'); p['population_recalc_note']=note(p.get('population_recalc_note'),'v114: включён Ново-Омск, 14 316 чел. городского населения'); update_density(p); ops.append({'year':year,'action':'manual_add_novo_omsk','unit_id':p.get('unit_id'),'name':p.get('name'),'host_unit_id':p.get('unit_id'),'host_name':p.get('name'),'population':14316,'urban_pop':14316})
        r8=next((f for f in out if f['properties'].get('unit_id')=='adm_1930_104'),None)
        if r8:
            p=r8['properties']; p['rural_pop']=192293; p['urban_pop']=65526; p['strict_city_pop']=65526; p['broader_urban_pop']=65526; p['population']=257819; p['urban_share']=round(65526/257819,6); update_density(p); p['population_method']='v114_overlay_growth_then_control_total_calibration'; p['population_confidence']='estimated_control_calibrated'; p['urban_pop_source']='user_omsk_okrug_urban_total_residual'; p['population_recalc_note']=note(p.get('population_recalc_note'),'v114: район №8 Омского округа заполнен как 192 293 сельского населения; 65 526 городского остатка для контроля городского населения округа 222 789'); ops.append({'year':year,'action':'fill_omsk_okrug_district_8','unit_id':p.get('unit_id'),'name':p.get('name'),'host_unit_id':p.get('unit_id'),'host_name':p.get('name'),'population':p.get('population'),'urban_pop':p.get('urban_pop')})
        add_novo(1930,14316,'adm_1930_94','Безымянный район №4 (Омский округ)','Омский округ')
    for f in out:
        p=f['properties']
        if p.get('area_km2') is None: p['area_km2']=area_km2(clean(shape(f['geometry'])))
        update_density(p, force_zero=bool(p.get('city_center_polygon_kept_v114')))
    save(ADMIN/f'admin_{year}.geojson',gj)
    return ops

def update_combined():
    combined={'type':'FeatureCollection','features':[]}
    for p in sorted(URBAN.glob('urban_points_*.geojson')):
        if re.match(r'urban_points_\d{4}\.geojson$',p.name): combined['features'].extend(load(p).get('features',[]))
    save(URBAN/'urban_points_1918_1939.geojson',combined)

def main():
    ops=[]
    for y in [1918,1923,1926,1930]: update_city_points_from_polygons(y)
    for y in [1930,1926,1918,1923]: ops.extend(process_year(y)); update_city_points_from_polygons(y)
    update_combined()
    manifest=load(ROOT/'data'/'manifest.json')
    centers=manifest.setdefault('layers',{}).setdefault('centers',{})
    for y in [1918,1923,1926,1930]: centers[str(y)]=f'data/urban/urban_points_{y}.geojson'
    manifest['layers']['urban_points_by_year']={str(y):f'data/urban/urban_points_{y}.geojson' for y in [1918,1923,1926,1930,1939] if (URBAN/f'urban_points_{y}.geojson').exists()}
    manifest['app_version']='114'; manifest.setdefault('changelog',[]).append('v114: city micro-polygons merged into host ATE for 1918/1923 and selectively for 1926/1930; Novo-Omsk and Omsk okrug controls applied.')
    save(ROOT/'data'/'manifest.json',manifest)
    with (DOCS/'v114_city_polygon_merge_operations.csv').open('w',encoding='utf-8',newline='') as f:
        fields=['year','action','unit_id','name','host_unit_id','host_name','population','urban_pop']; w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(ops)
    print('v114 city ops',len(ops))
if __name__=='__main__': main()
