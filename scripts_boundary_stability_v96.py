#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, math, csv, time, os
from pathlib import Path
from collections import Counter, defaultdict
from shapely.geometry import shape, LineString, Point
from shapely.ops import transform
try:
    from shapely.validation import make_valid
except Exception:
    make_valid=None
from pyproj import Transformer
ROOT=Path('.')
ADMIN=ROOT/'data'/'admin'; STAB=ROOT/'data'/'stability'; DOCS=ROOT/'docs'; HYDRO=ROOT/'data'/'hydro'
STAB.mkdir(parents=True,exist_ok=True); DOCS.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/'data'/'manifest.json').read_text(encoding='utf-8'))
ALL_YEARS=[int(y) for y in manifest.get('years',[]) if (ADMIN/f'admin_{int(y)}.geojson').exists()]
YEARS=ALL_YEARS
TARGET=100000.0; MIN_LEN=10000.0; GRID=60000.0
proj='+proj=aeqd +lat_0=59 +lon_0=80 +datum=WGS84 +units=m +no_defs'
to_m=Transformer.from_crs('EPSG:4326',proj,always_xy=True); to_ll=Transformer.from_crs(proj,'EPSG:4326',always_xy=True)
def ss(v): return '' if v is None else str(v).strip()
def truthy(v): return v is True or (isinstance(v,(int,float)) and v!=0) or (isinstance(v,str) and v.strip().lower() in ('1','true','yes','да'))
def clean(p,year):
    if truthy(p.get('topology_excluded')) or truthy(p.get('adjacency_excluded')): return False
    if p.get('include_in_analytics') is False or ss(p.get('include_in_analytics')).lower()=='false': return False
    if p.get('include_in_selection') is False or ss(p.get('include_in_selection')).lower()=='false': return False
    code=ss(p.get('special_status_code')).lower()
    if code and code not in ('normal','none','false'): return False
    unit=ss(p.get('unit_type')).lower(); text=' '.join([unit,ss(p.get('name')).lower(),ss(p.get('special_status')).lower(),ss(p.get('admin_parent')).lower(),ss(p.get('admin_superparent')).lower(),ss(p.get('note')).lower()])
    bad=['спор','неясн','слабого контроля','слабый контроль','неустойчив','двоедан','передан','передава','контекст','особая реконструкц']
    if any(w in text for w in bad): return False
    if year==1780 and ('тобольск' in text or 'тобольская' in text): return False
    try: area=float(p.get('area_km2'))
    except Exception: area=None
    if area is not None and area<=1: return False
    if area is not None and area<50 and any(w in unit for w in ['город','горсовет','посёлок','поселок']): return False
    return True
def valid(g):
    if g is None or g.is_empty: return None
    try:
        if not g.is_valid: g=make_valid(g) if make_valid else g.buffer(0)
    except Exception:
        try: g=g.buffer(0)
        except Exception: return None
    if g is None or g.is_empty: return None
    if g.geom_type in ('Polygon','MultiPolygon'): return g
    if g.geom_type=='GeometryCollection':
        ps=[x for x in g.geoms if x.geom_type in ('Polygon','MultiPolygon')]
        if not ps: return None
        from shapely.ops import unary_union
        try: return unary_union(ps)
        except Exception: return ps[0]
    return None
def exteriors(g):
    if g.geom_type=='Polygon': return [LineString(g.exterior.coords)]
    out=[]
    for p in g.geoms:
        if not p.is_empty: out.append(LineString(p.exterior.coords))
    return out
def split(line):
    coords=list(line.coords); out=[]
    if len(coords)<2: return out
    cur=[coords[0]]; clen=0.0
    def flush():
        nonlocal cur,clen,out
        if len(cur)>=2:
            try:
                ls=LineString(cur)
                if ls.length>=MIN_LEN: out.append(ls)
            except Exception: pass
        cur=[cur[-1]]; clen=0.0
    for k in range(1,len(coords)):
        sx,sy=cur[-1]; ex,ey=coords[k]
        rem=math.hypot(ex-sx,ey-sy)
        if rem<=1e-8: continue
        guard=0
        while rem>1e-8:
            guard+=1
            if guard>1000: break
            need=TARGET-clen
            if need<=1e-7:
                flush(); need=TARGET
            if rem<=need+1e-7:
                cur.append((ex,ey)); clen+=rem; rem=0
            else:
                t=need/rem; nx=sx+(ex-sx)*t; ny=sy+(ey-sy)*t
                cur.append((nx,ny)); flush(); sx,sy=nx,ny; rem=math.hypot(ex-sx,ey-sy)
    if len(cur)>=2:
        try:
            ls=LineString(cur)
            if ls.length>=MIN_LEN: out.append(ls)
        except Exception: pass
    return out
def angle(line):
    c=list(line.coords); x1,y1=c[0]; x2,y2=c[-1]; return math.degrees(math.atan2(y2-y1,x2-x1))%180
def adiff(a,b):
    d=abs((a-b)%180); return min(d,180-d)
def midll(line):
    p=line.interpolate(line.length/2); return to_ll.transform(p.x,p.y)
def coordsll(line):
    ll=transform(to_ll.transform,line); out=[]
    for x,y in ll.coords:
        c=[round(float(x),6),round(float(y),6)]
        if not out or out[-1]!=c: out.append(c)
    return out
def gridkey(p): return (int(math.floor(p.x/GRID)), int(math.floor(p.y/GRID)))
def streak(years):
    st=set(years); b=c=0
    for y in YEARS:
        if y in st: c+=1; b=max(b,c)
        else: c=0
    return b
features_by_year={}; kept=Counter(); excl=Counter(); segments=[]; by_year=defaultdict(list)
for year in YEARS:
    gj=json.loads((ADMIN/f'admin_{year}.geojson').read_text(encoding='utf-8'))
    print('year',year,flush=True)
    arr=[]
    for i,f in enumerate(gj.get('features',[])):
        p=f.get('properties') or {}
        if not clean(p,year): excl[year]+=1; continue
        try:
            g=valid(shape(f.get('geometry')))
            if g is None: excl[year]+=1; continue
            gm=transform(to_m.transform,g)
        except Exception: excl[year]+=1; continue
        name=ss(p.get('name') or p.get('_display_name') or p.get('Uezd') or p.get('Gov') or f'АТЕ {i+1}')
        for ring in exteriors(gm):
            for ln in split(ring):
                if ln.length<MIN_LEN: continue
                lon,lat=midll(ln); mp=ln.interpolate(ln.length/2); cs=list(ln.coords)
                seg={'geom':ln,'year':year,'name':name,'parent':ss(p.get('admin_parent') or p.get('_display_top_atd') or p.get('Gov')),'type':ss(p.get('unit_type') or p.get('_display_unit_type')),
                     'mid':mp,'start':Point(cs[0]),'end':Point(cs[-1]),'angle':angle(ln),'tol':15.0 if lat>=59 else 10.0,'lat':lat,'lon':lon,'len':ln.length/1000.0}
                segments.append(seg); by_year[year].append(seg)
        kept[year]+=1
print('segments',len(segments),flush=True)
indices={}
for y,arr in by_year.items():
    grid=defaultdict(list)
    for i,seg in enumerate(arr): grid[gridkey(seg['mid'])].append(i)
    indices[y]=(arr,grid)
# Hydro index as grid of river linework for names
river_grid=defaultdict(list); rivers=[]
hp=HYDRO/'rivers_west_siberia.geojson'
if hp.exists():
    hgj=json.loads(hp.read_text(encoding='utf-8'))
    for f in hgj.get('features',[]):
        try: gm=transform(to_m.transform,shape(f.get('geometry')))
        except Exception: continue
        props=f.get('properties') or {}; name=ss(props.get('name_rus') or props.get('name_eng') or 'река')
        idx=len(rivers); rivers.append((gm,name))
        try: c=gm.centroid
        except Exception: continue
        river_grid[gridkey(c)].append(idx)
def near_river(geom):
    try: p=geom.interpolate(geom.length/2)
    except Exception: return ('',None)
    cx,cy=gridkey(p); hits=[]
    for gx in range(cx-3,cx+4):
        for gy in range(cy-3,cy+4): hits.extend(river_grid.get((gx,gy),[]))
    best=None; nm=''
    for i in hits:
        g,n=rivers[i]
        try: d=geom.distance(g)
        except Exception: continue
        if d<=8000 and (best is None or d<best): best=d; nm=n
    return nm, (None if best is None else best/1000.0)
# score all segments, historical years only
candidates=[]
REF_YEARS=[y for y in [1780,1805,1897,1914,1923,1959,1989,2021] if y in YEARS]
score_segments=[seg for seg in segments if seg['year'] in REF_YEARS]
print('score reference segments',len(score_segments),REF_YEARS,flush=True)
for ix,seg in enumerate(score_segments):
    if ix and ix%500==0: print('match',ix,'/',len(score_segments),'cand',len(candidates),flush=True)
    tol=seg['tol']*1000; radius=tol+TARGET*0.35; ckey=gridkey(seg['mid']); rcell=int(math.ceil(radius/GRID))
    years={seg['year']:0.0}
    for y,(arr,grid) in indices.items():
        if y==seg['year']: continue
        hits=[]
        # hard cap candidates before Python sorting/iteration; dense late-Soviet layers can flood one grid window
        for gx in range(ckey[0]-rcell,ckey[0]+rcell+1):
            for gy in range(ckey[1]-rcell,ckey[1]+rcell+1):
                cell=grid.get((gx,gy),[])
                if cell:
                    hits.extend(cell[:80])
                if len(hits)>220:
                    break
            if len(hits)>220:
                break
        best=None
        sx,sy=seg['mid'].x,seg['mid'].y
        if len(hits)>120:
            hits=sorted(hits, key=lambda j: (arr[j]['mid'].x-sx)**2 + (arr[j]['mid'].y-sy)**2)[:120]
        # Fast linelet corridor proxy: midpoint proximity + similar direction.
        # The resulting geometry is still the real boundary linelet, never a connector/K-line.
        for j in hits:
            o=arr[j]
            if adiff(seg['angle'],o['angle'])>42: continue
            mdp=math.hypot(o['mid'].x-sx,o['mid'].y-sy)
            if mdp>radius: continue
            # subtract half-segment allowance so shifted linelet segmentation along the same real border still matches
            val=max(0.0, mdp - TARGET*0.45)
            if val <= tol*1.15 and (best is None or val<best): best=val
        if best is not None: years[y]=best/1000.0
    n=len(years)
    if n>=2:
        offs=list(years.values()); candidates.append({'seg':seg,'years':sorted(years),'n':n,'mean':sum(offs)/len(offs),'maxd':max(offs)})
print('candidates',len(candidates),flush=True)
# v96: no representative thinning; v95 thinning by 45 km created artificial breaks.
candidates.sort(key=lambda c:(c['seg']['year'], -c['n'], c['mean']))
selected=candidates
print('selected (not thinned)',len(selected),flush=True)
features=[]; by_count=Counter(); by_class=Counter(); by_anchor=Counter(); by_ref=Counter()
for c in selected:
    seg=c['seg']; cc=coordsll(seg['geom'])
    if len(cc)<2: continue
    n=c['n']; cls='очень высокая' if n>=12 else 'высокая' if n>=8 else 'средняя' if n>=4 else 'низкая'
    rn,rd=near_river(seg['geom']); anchor='речной рубеж' if rn else 'внешний/внутренний реальный рубеж АТЕ'
    by_count[n]+=1; by_class[cls]+=1; by_anchor[anchor]+=1; by_ref[seg['year']]+=1
    props={'stability_id':f'bs96_{len(features)+1:06d}','kind':'геометрическая устойчивость настоящих границ АТД','method':'actual_ate_boundary_line_to_line_v96_full_period_anchor_linelets_no_thinning','boundary_role':'all_real_ate_boundary','boundary_scope':'internal_and_external_exposed_contours','reference_year':seg['year'],'source_name':seg['name'],'source_parent':seg['parent'],'source_type':seg['type'],'segment_length_km':round(seg['len'],3),'mid_lat':round(seg['lat'],6),'mid_lon':round(seg['lon'],6),'lat_zone':'севернее/на 59° с.ш.' if seg['lat']>=59 else 'южнее 59° с.ш.','tolerance_km':seg['tol'],'years_count':n,'years_total':len(YEARS),'stability_share':round(n/len(YEARS),4),'years':c['years'],'year_from':c['years'][0],'year_to':c['years'][-1],'time_span_years':c['years'][-1]-c['years'][0],'max_streak_slices':streak(c['years']),'mean_offset_km':round(c['mean'],3),'max_offset_km':round(c['maxd'],3),'stability_class':cls,'natural_anchor':anchor,'nearest_river':rn,'nearest_river_distance_km':None if rd is None else round(rd,3),'note':'v96: выводится реальный фрагмент границы нормальной АТЕ. Период расширен до 2021; искусственное прореживание v95 через 45 км убрано.'}
    features.append({'type':'Feature','geometry':{'type':'LineString','coordinates':cc},'properties':props})
fc={'type':'FeatureCollection','name':'boundary_stability_v96_actual_boundaries','properties':{'version':'v96','analysis':'geometric_stability_actual_ate_boundaries','years':YEARS,'years_total':len(YEARS),'source':'cleaned admin polygon exterior boundaries; internal and external contours; full available scope 1700-2021','features':len(features),'source_linelets':len(segments),'candidates':len(candidates)},'features':features}
(STAB/'boundary_stability_v96.geojson').write_text(json.dumps(fc,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
summary={'version':'v96','method':'actual_ate_boundary_line_to_line_v96_full_period_anchor_linelets_no_thinning','years':YEARS,'years_total':len(YEARS),'source_linelets':len(segments),'candidates':len(candidates),'features':len(features),'by_count':dict(sorted(by_count.items())),'by_class':dict(by_class),'by_anchor':dict(by_anchor),'by_reference_year':dict(sorted(by_ref.items())),'note':'Full 1700-2021 real ATE boundary linelets; no centroid/K-line connectors; no v95 45 km thinning.'}
(STAB/'boundary_stability_v96_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
for name,rows in [('v96_boundary_stability_summary.csv',[('metric','value'),('version','v95'),('method',summary['method']),('years','-'.join(map(str,[YEARS[0],YEARS[-1]]))),('source_linelets',len(segments)),('features',len(features))]),('v96_boundary_stability_by_count.csv',[('years_count','segments')]+[(k,v) for k,v in sorted(by_count.items())]),('v96_boundary_stability_by_anchor.csv',[('anchor','segments')]+[(k,v) for k,v in sorted(by_anchor.items())])]:
    with (DOCS/name).open('w',encoding='utf-8',newline='') as f: csv.writer(f).writerows(rows)
print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
