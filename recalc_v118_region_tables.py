#!/usr/bin/env python3
# v118: 1930 Kuznetsk district naming + 2021-region metric-table scopes + additional city/district counters.
import csv, json, math, os, re
from pathlib import Path
from collections import defaultdict
from copy import deepcopy

from shapely.geometry import shape
from shapely.ops import unary_union, transform
from shapely.prepared import prep
from pyproj import Transformer

BASE = Path(__file__).resolve().parent
DATA = BASE / 'data'
ADMIN = DATA / 'admin'
TOPO = DATA / 'topology'
DOCS = BASE / 'docs'
DOCS.mkdir(exist_ok=True)

OLD = 'Щегловский округ'
NEW = 'Кузнецкий округ'
VERSION_NOTE = 'v118: Щегловский округ переименован в Кузнецкий округ; добавлены счётчики типов и региональные срезы таблиц по контурам 2021 г.'


def read_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def write_json(p, obj):
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

def num(v, default=0.0):
    try:
        if v is None or v == '': return default
        n = float(v)
        if math.isfinite(n): return n
    except Exception:
        pass
    return default

def is_truthy_false(v):
    return v is False or str(v).lower() in ('false','0','no','нет')

def include_stats(p):
    # Use the broad analytical scope used for multiyear tables: exclude explicit statistical/analytical false flags and context-only disputed objects.
    if p.get('include_in_analytics') is False or p.get('stat_scope_excluded') is True:
        return False
    code = str(p.get('special_status_code') or '').lower()
    if code and code not in ('normal',''):
        # keep urban/city units with normal numeric stats, but not special context polygons
        if any(x in code for x in ('context','disputed','double_tax','unstable','low_control','qing','kazakh_steppe','external')):
            return False
    return True

DISTRICT_TYPE_RE = re.compile(r'(^|\s)(район|уезд)($|\s)|муниципальн(?:ый|ого)\s+(?:район|округ)', re.I)
URBAN_TYPE_RE = re.compile(r'город|горсовет|городской округ|центр округа|республиканского подчинения|зато', re.I)

def is_district_like(p):
    t = str(p.get('unit_type') or '')
    return bool(DISTRICT_TYPE_RE.search(t))

def is_urban_rank(p):
    t = str(p.get('unit_type') or '')
    return bool(URBAN_TYPE_RE.search(t))

def lower_like(p):
    # Lower unit for count/average: use explicit unit types where possible.
    return is_district_like(p) or is_urban_rank(p) or str(p.get('unit_type') or '').lower().strip() in ('волость','округ')

def repair_1930_names():
    changed=[]
    # Admin layer, topology nodes: full property replacement.
    for rel in ['data/admin/admin_1930.geojson','data/topology/topology_nodes_1930.geojson']:
        path=BASE/rel
        gj=read_json(path)
        c=0
        for f in gj.get('features',[]):
            p=f.get('properties',{})
            before={k:p.get(k) for k in ['name','admin_parent','admin_intermediate','admin_superparent','original_parent','name_v78','adjacent_names','adjacent_units']}
            for k,v in list(p.items()):
                if isinstance(v,str) and OLD in v:
                    p[k]=v.replace(OLD, NEW)
                    c+=1
                elif isinstance(v,list):
                    def repl(x):
                        if isinstance(x,str): return x.replace(OLD,NEW)
                        if isinstance(x,dict):
                            y=dict(x)
                            for kk,vv in list(y.items()):
                                if isinstance(vv,str): y[kk]=vv.replace(OLD,NEW)
                            return y
                        return x
                    nv=[repl(x) for x in v]
                    if nv!=v:
                        p[k]=nv; c+=1
            if p.get('admin_parent')==NEW or p.get('admin_intermediate')==NEW or OLD in str(before.get('name') or ''):
                p['v118_previous_parent_label']=OLD
                p['v118_parent_label_note']='Щегловский округ нормализован как Кузнецкий округ для слоя 1930 г.'
        write_json(path, gj)
        changed.append((rel,c))
    # Topology edges: source/target parent names and embedded strings.
    path=BASE/'data/topology/topology_1930.geojson'
    gj=read_json(path)
    c=0
    for f in gj.get('features',[]):
        p=f.get('properties',{})
        for k,v in list(p.items()):
            if isinstance(v,str) and OLD in v:
                p[k]=v.replace(OLD,NEW); c+=1
    write_json(path, gj)
    changed.append(('data/topology/topology_1930.geojson',c))
    # Population long CSV.
    p=DATA/'population_long.csv'
    rows=[]
    with open(p, encoding='utf-8-sig', newline='') as f:
        r=csv.DictReader(f)
        fields=list(r.fieldnames or [])
        for row in r:
            for k,v in list(row.items()):
                if isinstance(v,str) and OLD in v:
                    row[k]=v.replace(OLD,NEW)
            if row.get('year')=='1930' and (row.get('admin_parent')==NEW or row.get('admin_intermediate')==NEW):
                for extra in ['v118_previous_parent_label','v118_parent_label_note']:
                    if extra not in fields: fields.append(extra)
                row['v118_previous_parent_label']=OLD
                row['v118_parent_label_note']='Щегловский округ нормализован как Кузнецкий округ для слоя 1930 г.'
            rows.append(row)
    with open(p, 'w', encoding='utf-8', newline='') as f:
        w=csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader(); w.writerows(rows)
    changed.append(('data/population_long.csv',sum(1 for r in rows if r.get('v118_previous_parent_label')==OLD)))
    with open(DOCS/'v118_1930_kuznetsk_rename.csv','w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['file','changed_strings_or_rows']); w.writerows(changed)


def compute_global_counters_for_rows():
    rows=read_json(TOPO/'multiyear_metrics_by_year.json')
    by_year={int(r['year']):r for r in rows if 'year' in r}
    diag=[]
    for ap in sorted(ADMIN.glob('admin_*.geojson')):
        year=int(ap.stem.split('_')[1])
        gj=read_json(ap)
        feats=[f for f in gj.get('features',[]) if include_stats(f.get('properties',{}))]
        dist=[f for f in feats if is_district_like(f.get('properties',{}))]
        dist_no_urban=[f for f in dist if num(f.get('properties',{}).get('urban_pop'),0)<=0]
        urb=[f for f in feats if is_urban_rank(f.get('properties',{}))]
        row=by_year.get(year)
        if not row: continue
        row['district_like_units_count']=len(dist)
        row['district_without_urban_pop_count']=len(dist_no_urban)
        row['urban_rank_units_count']=len(urb)
        row['type_count_method_v118']='district_like: район/уезд/муниципальный район/муниципальный округ; urban_rank: город/горсовет/городской округ/центр округа/город республиканского подчинения; explicit analytical exclusions removed.'
        diag.append([year,len(feats),len(dist),len(dist_no_urban),len(urb)])
    rows=sorted(by_year.values(), key=lambda r:int(r['year']))
    write_json(TOPO/'multiyear_metrics_by_year.json', rows)
    with open(DOCS/'v118_global_type_counters.csv','w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['year','features_in_stats','district_like_units_count','district_without_urban_pop_count','urban_rank_units_count']); w.writerows(diag)


# Equal-area projection for fractions.
TRANS = Transformer.from_crs('EPSG:4326','EPSG:6933', always_xy=True).transform

def safe_shape(g):
    try:
        geom=shape(g)
        if not geom.is_valid:
            geom=geom.buffer(0)
        return geom
    except Exception:
        return None

def region_2021_unions():
    gj=read_json(ADMIN/'admin_2021.geojson')
    groups=defaultdict(list)
    for f in gj.get('features',[]):
        p=f.get('properties',{})
        reg=str(p.get('admin_parent') or p.get('admin_intermediate') or p.get('name') or '').strip()
        if not reg: continue
        geom=safe_shape(f.get('geometry'))
        if geom is None or geom.is_empty: continue
        groups[reg].append(transform(TRANS, geom))
    regions=[]
    for name, geoms in sorted(groups.items(), key=lambda kv: kv[0]):
        u=unary_union(geoms)
        if not u.is_valid: u=u.buffer(0)
        regions.append({'region':name,'geom':u,'prep':prep(u),'area_m2':u.area})
    return regions

def empty_metrics(year, region):
    return {
        'year':year,'region_2021':region,
        'ate_total_count':0,'upper_ate_count':0,'middle_ate_count':0,'lower_ate_count':0,
        'total_area_km2':0.0,'avg_area_km2':None,
        'total_population':0.0,'avg_population':None,'population_density':None,'urban_population':0.0,'rural_population':0.0,'urban_share':None,
        'rail_length_km_total':0.0,'rail_density_km_1000':None,'rail_segments_count_sum':0.0,
        'avg_adjacency':None,'nodes':0,'edges':None,'avg_degree':None,'avg_betweenness':None,'avg_closeness':None,'avg_k_core':None,
        'district_like_units_count':0,'district_without_urban_pop_count':0,'urban_rank_units_count':0,
        '_sum_area_count':0,'_sum_population_count':0,'_sum_adj':0.0,'_adj_n':0,'_deg_sum':0.0,'_deg_n':0,'_bet_sum':0.0,'_bet_n':0,'_clo_sum':0.0,'_clo_n':0,'_core_sum':0.0,'_core_n':0
    }

def finish_metrics(m):
    cnt=m.pop('_sum_area_count',0); pcnt=m.pop('_sum_population_count',0)
    adj_sum=m.pop('_sum_adj',0.0); adj_n=m.pop('_adj_n',0)
    deg_sum=m.pop('_deg_sum',0.0); deg_n=m.pop('_deg_n',0)
    bet_sum=m.pop('_bet_sum',0.0); bet_n=m.pop('_bet_n',0)
    clo_sum=m.pop('_clo_sum',0.0); clo_n=m.pop('_clo_n',0)
    core_sum=m.pop('_core_sum',0.0); core_n=m.pop('_core_n',0)
    m['avg_area_km2']=m['total_area_km2']/m['ate_total_count'] if m.get('ate_total_count') else None
    m['avg_population']=m['total_population']/m['ate_total_count'] if m.get('ate_total_count') else None
    m['population_density']=m['total_population']/m['total_area_km2'] if m['total_area_km2'] else None
    m['urban_share']=m['urban_population']/m['total_population'] if m['total_population'] else None
    m['rail_density_km_1000']=m['rail_length_km_total']/m['total_area_km2']*1000 if m['total_area_km2'] else None
    m['avg_adjacency']=adj_sum/adj_n if adj_n else None
    m['avg_degree']=deg_sum/deg_n if deg_n else None
    m['avg_betweenness']=bet_sum/bet_n if bet_n else None
    m['avg_closeness']=clo_sum/clo_n if clo_n else None
    m['avg_k_core']=core_sum/core_n if core_n else None
    if m['nodes']:
        m['edges']=round(deg_sum/2,3) if deg_n else None
    # rounding
    for k,v in list(m.items()):
        if isinstance(v,float) and math.isfinite(v):
            if k.endswith('_count') or k in ('nodes',):
                m[k]=int(round(v))
            else:
                m[k]=round(v,6)
    m['regional_scope_method_v118']='historical ATE apportioned to 2021 regional contours by equal-area overlay for additive values; type counts assigned by largest overlay share; graph values are node-subset diagnostics, not full re-topologization.'
    return m

def hierarchy_level(p):
    t=str(p.get('unit_type') or '').lower()
    # Use current project fields first.
    if p.get('admin_parent') and str(p.get('name')) == str(p.get('admin_parent')):
        return 'upper'
    if 'губерн' in t or t in ('область','край','республика'):
        return 'upper'
    if str(p.get('admin_intermediate') or '') and str(p.get('admin_intermediate')) != str(p.get('admin_parent') or ''):
        if str(p.get('name') or '') == str(p.get('admin_intermediate') or ''):
            return 'middle'
    if 'провинц' in t or (('округ' in t) and not is_urban_rank(p) and not is_district_like(p)):
        return 'middle'
    return 'lower'

def compute_2021_region_metrics():
    regions=region_2021_unions()
    reg_names=[r['region'] for r in regions]
    rows=[]
    assignment_diag=[]
    for ap in sorted(ADMIN.glob('admin_*.geojson')):
        year=int(ap.stem.split('_')[1])
        gj=read_json(ap)
        metrics={name:empty_metrics(year,name) for name in reg_names}
        for f in gj.get('features',[]):
            p=f.get('properties',{})
            if not include_stats(p):
                continue
            geom=safe_shape(f.get('geometry'))
            if geom is None or geom.is_empty: continue
            try:
                g=transform(TRANS, geom)
            except Exception:
                continue
            if not g.is_valid: g=g.buffer(0)
            ga=g.area
            if not ga or ga<=0: continue
            overlaps=[]
            for r in regions:
                if not r['prep'].intersects(g): continue
                try:
                    inter=g.intersection(r['geom'])
                except Exception:
                    inter=g.buffer(0).intersection(r['geom'])
                ia=inter.area if not inter.is_empty else 0.0
                if ia>0:
                    overlaps.append((r['region'], ia/ga))
            if not overlaps:
                continue
            overlaps.sort(key=lambda x:x[1], reverse=True)
            primary=overlaps[0][0]
            pp=p
            # Assign non-additive counts once to the primary 2021 region.
            m=metrics[primary]
            m['ate_total_count']+=1
            lvl=hierarchy_level(pp)
            if lvl=='upper': m['upper_ate_count']+=1
            elif lvl=='middle': m['middle_ate_count']+=1
            else: m['lower_ate_count']+=1
            if is_district_like(pp):
                m['district_like_units_count']+=1
                if num(pp.get('urban_pop'),0)<=0: m['district_without_urban_pop_count']+=1
            if is_urban_rank(pp):
                m['urban_rank_units_count']+=1
            if pp.get('topology_excluded') is not True:
                m['nodes']+=1
                deg=num(pp.get('topo_degree'), None)
                if deg is not None:
                    m['_deg_sum']+=deg; m['_deg_n']+=1
                bet=num(pp.get('topo_betweenness'), None)
                if bet is not None:
                    m['_bet_sum']+=bet; m['_bet_n']+=1
                clo=num(pp.get('topo_closeness'), None)
                if clo is not None:
                    m['_clo_sum']+=clo; m['_clo_n']+=1
                core=num(pp.get('topo_k_core'), None)
                if core is not None:
                    m['_core_sum']+=core; m['_core_n']+=1
                adj=num(pp.get('adjacent_count'), None)
                if adj is not None:
                    m['_sum_adj']+=adj; m['_adj_n']+=1
            assignment_diag.append([year, pp.get('unit_id'), pp.get('name'), primary, round(overlaps[0][1],6), '; '.join(f'{a}:{b:.3f}' for a,b in overlaps[:4])])
            # Additive values apportioned by intersection fractions.
            total_area_prop=num(pp.get('area_km2'),0)
            total_pop=num(pp.get('population'),0)
            urban=num(pp.get('urban_pop'),0)
            rural=num(pp.get('rural_pop'),0)
            rail=num(pp.get('rail_length_km'),0)
            seg=num(pp.get('rail_segments_count'),0)
            for name,frac in overlaps:
                mm=metrics[name]
                mm['total_area_km2']+=total_area_prop*frac
                mm['total_population']+=total_pop*frac
                mm['urban_population']+=urban*frac
                mm['rural_population']+=rural*frac
                mm['rail_length_km_total']+=rail*frac
                mm['rail_segments_count_sum']+=seg*frac
                mm['_sum_area_count']+=frac
                if total_pop>0: mm['_sum_population_count']+=frac
        for name in reg_names:
            rows.append(finish_metrics(metrics[name]))
    rows.sort(key=lambda r:(int(r['year']), r['region_2021']))
    write_json(TOPO/'multiyear_metrics_by_2021_region.json', rows)
    with open(DOCS/'v118_2021_region_scope_assignment.csv','w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['year','unit_id','name','primary_2021_region','primary_overlap_share','top_overlaps']); w.writerows(assignment_diag)
    # Add to manifest if absent.
    man=read_json(DATA/'manifest.json')
    man.setdefault('layers',{})['multiyear_metrics_by_2021_region']='data/topology/multiyear_metrics_by_2021_region.json'
    man['app_version']='118'
    man['v118_note']='Tables can be recalculated by selected 2021 regional contours.'
    write_json(DATA/'manifest.json', man)


def write_readme():
    text='''# v118\n\nИзменения:\n\n- В слое 1930 г. Щегловский округ переименован в Кузнецкий округ во всех районах, узлах, рёбрах и population_long.csv.\n- В multiyear_metrics_by_year.json добавлены счётчики: районные/уездные единицы без городского населения и города районного ранга.\n- Добавлен файл data/topology/multiyear_metrics_by_2021_region.json для пересчёта таблиц метрик по контурам регионов 2021 г.\n- В интерфейс таблиц добавлен выбор охвата: весь ряд, выбранные регионы 2021 г. или ряд без выбранных регионов.\n\nМетод регионального охвата: исторические АТЕ накладываются на контуры регионов 2021 г. в равновеликой проекции; суммарные показатели аппроксимируются по доле площади пересечения, счётчики типов закрепляются за регионом наибольшего пересечения.\n'''
    (BASE/'README_v118.md').write_text(text, encoding='utf-8')

if __name__ == '__main__':
    repair_1930_names()
    compute_global_counters_for_rows()
    compute_2021_region_metrics()
    write_readme()
    print('v118 data rebuild done')
