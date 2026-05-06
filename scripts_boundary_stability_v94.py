#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, math, numbers, csv, time
from pathlib import Path
from collections import Counter, defaultdict
from shapely.geometry import shape, LineString
from shapely.ops import transform
from shapely.strtree import STRtree
try:
    from shapely.validation import make_valid
except Exception:
    make_valid = None
from pyproj import Transformer

ROOT=Path('.')
ADMIN=ROOT/'data'/'admin'; STAB=ROOT/'data'/'stability'; DOCS=ROOT/'docs'
STAB.mkdir(exist_ok=True, parents=True); DOCS.mkdir(exist_ok=True, parents=True)
manifest=json.loads((ROOT/'data'/'manifest.json').read_text(encoding='utf-8'))
YEARS=[int(y) for y in manifest.get('years',[]) if (ADMIN/f'admin_{int(y)}.geojson').exists()]
MIN_LINE_M=5000.0
MIN_OUTPUT_YEARS=2
# Real linelet from boundary intersection; no centroid/graph connector geometry.
proj='+proj=aeqd +lat_0=59 +lon_0=80 +datum=WGS84 +units=m +no_defs'
to_m=Transformer.from_crs('EPSG:4326', proj, always_xy=True)
to_ll=Transformer.from_crs(proj, 'EPSG:4326', always_xy=True)

def s(v): return '' if v is None else str(v).strip()
def truthy(v):
    return v is True or (isinstance(v,(int,float)) and v!=0) or (isinstance(v,str) and v.strip().lower() in ('1','true','yes','да'))
def clean(p):
    if truthy(p.get('topology_excluded')) or truthy(p.get('adjacency_excluded')): return False
    if p.get('include_in_analytics') is False or s(p.get('include_in_analytics')).lower()=='false': return False
    if p.get('include_in_selection') is False or s(p.get('include_in_selection')).lower()=='false': return False
    code=s(p.get('special_status_code')).lower()
    if code and code not in ('normal','none','false'): return False
    unit=s(p.get('unit_type')).lower(); name=s(p.get('name')).lower(); st=s(p.get('special_status')).lower()
    bad=['спор','неясн','слабого контроля','неустойчив','двоедан','передан','передава','контекст','цин','особая реконструкц']
    if any(w in (unit+' '+name+' '+st) for w in bad): return False
    try: area=float(p.get('area_km2'))
    except Exception: area=None
    if area is not None and area <= 1: return False
    if area is not None and area < 50 and any(w in unit for w in ['город','горсовет','посёлок','поселок']): return False
    return True

def valid_poly(g):
    if g is None or g.is_empty: return None
    try:
        if not g.is_valid:
            g=make_valid(g) if make_valid else g.buffer(0)
    except Exception:
        try: g=g.buffer(0)
        except Exception: return None
    if g is None or g.is_empty: return None
    if g.geom_type in ('Polygon','MultiPolygon'): return g
    if g.geom_type=='GeometryCollection':
        polys=[x for x in g.geoms if x.geom_type in ('Polygon','MultiPolygon') and not x.is_empty]
        if not polys: return None
        from shapely.ops import unary_union
        try: return unary_union(polys)
        except Exception: return polys[0]
    return None

def as_lines(g):
    if g is None or g.is_empty: return []
    if g.geom_type=='LineString': return [g]
    if g.geom_type=='MultiLineString': return list(g.geoms)
    if g.geom_type=='GeometryCollection':
        out=[]
        for x in g.geoms: out.extend(as_lines(x))
        return out
    return []

def midpoint_ll(line):
    p=line.interpolate(line.length/2)
    return to_ll.transform(p.x,p.y)

def coords_ll(line):
    ll=transform(to_ll.transform, line)
    coords=[]
    for x,y in ll.coords:
        c=[round(float(x),6), round(float(y),6)]
        if not coords or coords[-1]!=c: coords.append(c)
    return coords

def longest_streak(years):
    st=set(map(int,years)); best=cur=0
    for y in YEARS:
        if y in st:
            cur+=1; best=max(best,cur)
        else: cur=0
    return best

features_by_year={}; excluded=Counter(); kept=Counter()
for year in YEARS:
    gj=json.loads((ADMIN/f'admin_{year}.geojson').read_text(encoding='utf-8'))
    arr=[]
    for idx,f in enumerate(gj.get('features',[])):
        p=f.get('properties') or {}
        if not clean(p):
            excluded[year]+=1; continue
        try:
            g=valid_poly(shape(f.get('geometry')))
            if g is None: excluded[year]+=1; continue
            gm=transform(to_m.transform, g)
            if gm is None or gm.is_empty: excluded[year]+=1; continue
        except Exception:
            excluded[year]+=1; continue
        arr.append({
            'geom':gm, 'boundary':gm.boundary if gm is not None and (not gm.is_empty) else None, 'unit_id':s(p.get('unit_id')) or f'adm_{year}_{idx+1}',
            'name':s(p.get('name') or p.get('_display_name') or p.get('Uezd') or p.get('Gov') or f'АТЕ {idx+1}'),
            'parent':s(p.get('admin_parent') or p.get('_display_top_atd') or p.get('Gov')),
            'superparent':s(p.get('admin_superparent') or p.get('admin_intermediate')),
            'unit_type':s(p.get('unit_type') or p.get('_display_unit_type')),
        })
    features_by_year[year]=arr; kept[year]=len(arr)

segments=[]; shared_by_year=Counter(); shared_km_by_year=Counter()
for year in YEARS:
    arr=features_by_year[year]
    print('extract',year,len(arr),flush=True)
    if len(arr)<2: continue
    geoms=[x['geom'] for x in arr]
    tree=STRtree(geoms)
    for i,a in enumerate(arr):
        for h in tree.query(geoms[i]):
            j=int(h) if isinstance(h,numbers.Integral) else geoms.index(h)
            if j<=i: continue
            b=arr[j]
            try:
                bi=a.get('boundary'); bj=b.get('boundary')
                if bi is None or bj is None or bi.is_empty or bj.is_empty:
                    continue
                inter=bi.intersection(bj)
            except Exception:
                continue
            for ln in as_lines(inter):
                if ln is None or ln.is_empty or ln.length < MIN_LINE_M: continue
                lon,lat=midpoint_ll(ln)
                tol=15.0 if lat>=59.0 else 10.0
                segments.append({'geom':ln,'year':year,'source_id':a['unit_id'],'target_id':b['unit_id'],
                                 'source_name':a['name'],'target_name':b['name'],'source_parent':a['parent'],'target_parent':b['parent'],
                                 'source_superparent':a['superparent'],'target_superparent':b['superparent'],
                                 'source_type':a['unit_type'],'target_type':b['unit_type'],
                                 'mid_lon':lon,'mid_lat':lat,'tol_km':tol,'length_km':ln.length/1000.0})
                shared_by_year[year]+=1; shared_km_by_year[year]+=ln.length/1000.0
print('segments',len(segments),flush=True)

by_year=defaultdict(list)
for seg in segments: by_year[seg['year']].append(seg)
indices={}
for y,arr in by_year.items():
    geoms=[x['geom'] for x in arr]
    indices[y]=(arr,geoms,STRtree(geoms))

out=[]; by_count=Counter(); by_ref=Counter(); by_zone=Counter(); by_class=Counter()
start=time.time()
for idx,seg in enumerate(segments):
    if idx and idx%1000==0: print('match',idx,'/',len(segments),'out',len(out),'elapsed',round(time.time()-start,1),flush=True)
    geom=seg['geom']; tol_m=seg['tol_km']*1000
    query_geom=geom.buffer(tol_m)
    min_by_year={seg['year']:0.0}
    for y,(arr,geoms,tree) in indices.items():
        if y==seg['year']: continue
        try: hits=tree.query(query_geom)
        except Exception: hits=range(len(arr))
        best=None
        for h in hits:
            j=int(h) if isinstance(h,numbers.Integral) else geoms.index(h)
            try: d=geom.distance(arr[j]['geom'])
            except Exception: continue
            if d<=tol_m and (best is None or d<best): best=d
        if best is not None: min_by_year[y]=best/1000.0
    years=sorted(min_by_year)
    n=len(years)
    if n<MIN_OUTPUT_YEARS: continue
    offs=list(min_by_year.values()); mean=sum(offs)/len(offs); maxd=max(offs)
    cls='очень высокая' if n>=12 else 'высокая' if n>=8 else 'средняя' if n>=4 else 'низкая'
    cc=coords_ll(geom)
    if len(cc)<2: continue
    props={
      'stability_id':f'bs94_{len(out)+1:06d}', 'kind':'геометрическая устойчивость настоящих границ АТД',
      'method':'actual_shared_boundary_line_to_line_v94','boundary_role':'internal_shared_boundary','reference_year':seg['year'],
      'source_id':seg['source_id'],'target_id':seg['target_id'],'source_name':seg['source_name'],'target_name':seg['target_name'],
      'source_parent':seg['source_parent'],'target_parent':seg['target_parent'],'source_superparent':seg['source_superparent'],'target_superparent':seg['target_superparent'],
      'source_type':seg['source_type'],'target_type':seg['target_type'],'segment_length_km':round(seg['length_km'],3),
      'mid_lat':round(seg['mid_lat'],6),'mid_lon':round(seg['mid_lon'],6),'lat_zone':'севернее/на 59° с.ш.' if seg['mid_lat']>=59 else 'южнее 59° с.ш.',
      'tolerance_km':seg['tol_km'],'years_count':n,'years_total':len(YEARS),'stability_share':round(n/len(YEARS),4),
      'years':years,'year_from':years[0],'year_to':years[-1],'time_span_years':years[-1]-years[0],'max_streak_slices':longest_streak(years),
      'mean_offset_km':round(mean,3),'max_offset_km':round(maxd,3),'stability_class':cls,
      'note':'v94: выводится настоящий сегмент общей границы полигонов АТЕ; совпадение считается по расстоянию линия-к-линии, а не по центроидам/узлам.'}
    out.append({'type':'Feature','geometry':{'type':'LineString','coordinates':cc},'properties':props})
    by_count[n]+=1; by_ref[seg['year']]+=1; by_zone[props['lat_zone']]+=1; by_class[cls]+=1

fc={'type':'FeatureCollection','name':'boundary_stability_v94_actual_boundaries','properties':{
    'version':'v94','analysis':'geometric_boundary_stability_actual_shared_boundaries','years':YEARS,'years_total':len(YEARS),
    'minimum_line_km':MIN_LINE_M/1000,'minimum_output_years':MIN_OUTPUT_YEARS,
    'tolerance_rule':'15 км для середины настоящего сегмента севернее/на 59° с.ш.; 10 км южнее',
    'source':'cleaned admin polygons; actual shared polygon boundaries; line-to-line proximity',
    'kept_admin_features':sum(kept.values()),'source_shared_segments':len(segments),'features':len(out)},'features':out}
(STAB/'boundary_stability_v94.geojson').write_text(json.dumps(fc,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
summary={'version':'v94','method':'actual_shared_boundary_line_to_line_v94','years_total':len(YEARS),'years':YEARS,'kept_admin_features':dict(sorted(kept.items())),'excluded_admin_features_by_year':dict(sorted(excluded.items())),'source_shared_segments_total':len(segments),'source_shared_segments_by_year':dict(sorted(shared_by_year.items())),'source_shared_km_by_year':{str(k):round(v,3) for k,v in sorted(shared_km_by_year.items())},'output_features':len(out),'by_stability_count':{str(k):v for k,v in sorted(by_count.items())},'by_reference_year':{str(k):v for k,v in sorted(by_ref.items())},'by_zone':dict(by_zone),'by_class':dict(by_class),'note':'Real shared boundaries only; no centroid/graph connector geometry.'}
(STAB/'boundary_stability_v94_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
for name, rows in [
 ('v94_boundary_stability_summary.csv', [('metric','value'),('version','v94'),('method','actual_shared_boundary_line_to_line_v94'),('source_shared_segments_total',len(segments)),('output_features',len(out)),('tolerance_rule','15 km north/on 59N; 10 km south')]),
 ('v94_boundary_stability_by_count.csv', [('years_count','segments')]+[(k,v) for k,v in sorted(by_count.items())]),
 ('v94_boundary_stability_by_year.csv', [('reference_year','segments')]+[(k,v) for k,v in sorted(by_ref.items())])]:
    with (DOCS/name).open('w',encoding='utf-8',newline='') as f:
        csv.writer(f).writerows(rows)
print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
