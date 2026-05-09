
import json, math, sys, time
from pathlib import Path
from collections import defaultdict
import geopandas as gpd
from shapely.strtree import STRtree
from shapely.geometry import mapping

ROOT=Path('.')
CRS_METRIC='+proj=eqdc +lat_1=50 +lat_2=70 +lat_0=60 +lon_0=75 +datum=WGS84 +units=m +no_defs'
SEG_DIR=ROOT/'data'/'natural_boundaries'/'segments'; ADMIN_DIR=ROOT/'data'/'admin'
PHYS_LABELS={'coastline':'береговая линия','river':'река','lake':'озеро / водная гладь','watershed_flowing':'водораздел сточных бассейнов','watershed_endo':'водораздел бессточных областей','wetland':'болото / заболоченный массив','unexplained_physical':'не объяснено природными рубежами'}
PHYS_ORDER=['coastline','river','lake','watershed_flowing','watershed_endo','wetland','unexplained_physical']

def build_tree(geoms):
    clean=[g for g in geoms if g is not None and not g.is_empty]
    return STRtree(clean) if clean else None

def dwithin(tree, geom, dist):
    if tree is None or geom is None or geom.is_empty: return False
    return len(tree.query(geom, predicate='dwithin', distance=dist))>0

def sample_fracs(geom_m, tests, step=5000.0):
    # tests: [(name, tree, dist_m), ...]. Returns sample fraction per test and union fraction.
    length=geom_m.length if geom_m is not None and not geom_m.is_empty else 0.0
    if length<=0: return {name:0.0 for name,_,_ in tests}|{'__union__':0.0}
    n=max(3, min(200, int(math.ceil(length/step))+1))
    hits={name:0 for name,_,_ in tests}; union=0
    for i in range(n):
        pt=geom_m.interpolate((i/(n-1))*length)
        anyhit=False
        for name,tree,dist in tests:
            ok=dwithin(tree, pt, dist)
            if ok:
                hits[name]+=1; anyhit=True
        if anyhit: union+=1
    out={name:h/n for name,h in hits.items()}; out['__union__']=union/n
    return out

def endo_fraction(geom_w, geom_m, tree, step=5000.0):
    length=geom_m.length if geom_m is not None and not geom_m.is_empty else 0.0
    if length<=0 or tree is None: return 0.0
    n=max(3, min(200, int(math.ceil(length/step))+1)); hits=0
    for i in range(n):
        t=i/(n-1)
        ptm=geom_m.interpolate(t*length)
        try:
            lat=geom_w.interpolate(t, normalized=True).y
        except Exception:
            lat=None
        dist=3000.0 if (lat is not None and math.isfinite(lat) and 48.0<=lat<=59.0) else 6000.0
        if dwithin(tree, ptm, dist): hits+=1
    return hits/n

def first_last_coords(geom):
    if geom is None or geom.is_empty: return None,None
    if geom.geom_type=='LineString':
        coords=list(geom.coords); return coords[0],coords[-1]
    if geom.geom_type=='MultiLineString':
        parts=list(geom.geoms)
        if not parts: return None,None
        part=max(parts,key=lambda x:x.length); coords=list(part.coords); return coords[0],coords[-1]
    return None,None

def bearing_axis_deg(p0,p1):
    if not p0 or not p1: return None,None
    dx=p1[0]-p0[0]; dy=p1[1]-p0[1]
    if abs(dx)+abs(dy)==0: return None,None
    ang=abs(math.degrees(math.atan2(dy,dx)))%180.0
    return ang,min(ang,abs(ang-90.0),abs(ang-180.0))

def pct(part,total): return round(part/total*100.0,2) if total and total>0 else None

def km(m): return round(float(m)/1000.0,3)

YEARS=[int(x) for x in sys.argv[1:]] or sorted(int(p.stem.split('_')[1]) for p in ADMIN_DIR.glob('admin_*.geojson'))
print('Load refs for',YEARS, flush=True)
mo=gpd.read_file(ROOT/'data/natural_boundaries/reference/MO_retrospecular_boundaries_selsoviets.json').to_crs(CRS_METRIC); mo_tree=build_tree([g.boundary for g in mo.geometry])
admin2021=gpd.read_file(ROOT/'data/admin/admin_2021.geojson').to_crs(CRS_METRIC); admin2021_tree=build_tree([g.boundary for g in admin2021.geometry])
rail=gpd.read_file(ROOT/'data/railways/railways.geojson').to_crs(CRS_METRIC); rail_tree=build_tree(list(rail.geometry))
orog=gpd.read_file(ROOT/'data/natural_boundaries/reference/orography_clipped1.json'); orog_m=orog.to_crs(CRS_METRIC); endo=orog_m[orog_m.get('ENDO',0).fillna(0).astype(int)==1]; endo_tree=build_tree([g.boundary for g in endo.geometry])
print('Refs loaded', flush=True)
for year in YEARS:
    t0=time.time(); seg_path=SEG_DIR/f'natural_boundary_segments_{year}.geojson'; adm_path=ADMIN_DIR/f'admin_{year}.geojson'
    seg_w=gpd.read_file(seg_path); seg_m=seg_w.to_crs(CRS_METRIC)
    out=[]; metrics=defaultdict(lambda:defaultdict(float))
    for i in range(len(seg_w)):
        row=seg_w.iloc[i]; geom_w=row.geometry; geom_m=seg_m.geometry.iloc[i]
        props={k:(None if isinstance(v,float) and math.isnan(v) else v) for k,v in row.drop(labels='geometry').to_dict().items()}
        length_m=float(geom_m.length) if geom_m is not None and not geom_m.is_empty else float(props.get('boundary_km') or 0)*1000.0
        length_km=length_m/1000.0; uid=props.get('unit_id')
        old=props.get('boundary_origin_v124') or props.get('boundary_origin') or 'unexplained'
        if old=='watershed':
            ef=endo_fraction(geom_w, geom_m, endo_tree)
            physical='watershed_endo' if ef>=0.5 else 'watershed_flowing'
            phys_parts={'watershed_endo':ef,'watershed_flowing':1-ef}
        elif old in ('coastline','river','lake','wetland'):
            physical=old; phys_parts={physical:1.0}
        else:
            physical='unexplained_physical'; phys_parts={physical:1.0}
        tests=[]
        if year!=2021: tests.append(('match_2021',admin2021_tree,2500.0))
        tests += [('match_mo',mo_tree,2500.0),('rail',rail_tree,1500.0)]
        fr=sample_fracs(geom_m, tests)
        f2021=fr.get('match_2021',0.0); fmo=fr.get('match_mo',0.0); frail=fr.get('rail',0.0)
        fadmin=sample_fracs(geom_m, ([('m2021',admin2021_tree,2500.0)] if year!=2021 else [])+[('mo',mo_tree,2500.0)])['__union__']
        finfra=fr['__union__']
        p0m,p1m=first_last_coords(geom_m); chord=math.hypot(p1m[0]-p0m[0],p1m[1]-p0m[1]) if p0m and p1m else 0.0
        sinu=length_m/chord if chord>1 else None
        p0w,p1w=first_last_coords(geom_w); angle,axis=bearing_axis_deg(p0w,p1w)
        geomcand=bool(physical=='unexplained_physical' and sinu is not None and sinu<=1.04 and length_km>=10.0)
        rectcand=bool(geomcand and axis is not None and axis<=7.5)
        if physical!='unexplained_physical': shape_class='physical_explained'
        elif geomcand: shape_class='rectilinear_geometric_candidate' if rectcand else 'straight_geometric_candidate'
        else: shape_class='unexplained_non_geometric'
        m=metrics[uid]; m['total_m']+=length_m
        for cls,frac in phys_parts.items():
            m[f'{cls}_m']+=length_m*frac
            if cls.startswith('watershed_'): m['watershed_total_m']+=length_m*frac
        m['match_2021_m']+=length_m*f2021; m['match_mo_m']+=length_m*fmo; m['rail_m']+=length_m*frail; m['admin_memory_m']+=length_m*fadmin; m['admin_infra_union_m']+=length_m*finfra
        if geomcand: m['geometric_candidate_m']+=length_m
        if rectcand: m['rectilinear_candidate_m']+=length_m
        props.update({'boundary_origin_v124':old,'physical_origin':physical,'physical_origin_label':PHYS_LABELS.get(physical,physical),'boundary_origin':physical,'boundary_origin_label':PHYS_LABELS.get(physical,physical),'admin_match_2021':bool(f2021>=0.5),'admin_match_2021_frac':round(f2021,3),'admin_match_mo':bool(fmo>=0.5),'admin_match_mo_frac':round(fmo,3),'admin_memory_match':bool(fadmin>=0.5),'admin_memory_match_frac':round(fadmin,3),'rail_match':bool(frail>=0.5),'rail_match_frac':round(frail,3),'shape_class':shape_class,'sinuosity':round(float(sinu),4) if sinu is not None and math.isfinite(sinu) else None,'axis_angle_deg':round(float(angle),2) if angle is not None and math.isfinite(angle) else None,'axis_distance_deg':round(float(axis),2) if axis is not None and math.isfinite(axis) else None,'geometric_candidate':geomcand,'rectilinear_candidate':rectcand,'boundary_km':round(length_km,3),'method':'v125_sample_fraction_physical_axis_plus_admin_infra_axis_from_v124_segments'})
        out.append({'type':'Feature','properties':props,'geometry':mapping(geom_w)})
    tmp=seg_path.with_suffix('.tmp'); json.dump({'type':'FeatureCollection','features':out},open(tmp,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':')); tmp.replace(seg_path)
    unit_metrics={}
    for uid,m in metrics.items():
        total=m.get('total_m',0.0); class_m={cls:m.get(f'{cls}_m',0.0) for cls in PHYS_ORDER if cls!='wetland'}; dom=max(class_m,key=lambda k:class_m[k]) if class_m else 'unexplained_physical'
        d={'nb_total_boundary_km':km(total),'nb_coast_km':km(m.get('coastline_m',0.0)),'nb_coast_pct':pct(m.get('coastline_m',0.0),total),'nb_river_km':km(m.get('river_m',0.0)),'nb_river_pct':pct(m.get('river_m',0.0),total),'nb_lake_km':km(m.get('lake_m',0.0)),'nb_lake_pct':pct(m.get('lake_m',0.0),total),'nb_watershed_flowing_km':km(m.get('watershed_flowing_m',0.0)),'nb_watershed_flowing_pct':pct(m.get('watershed_flowing_m',0.0),total),'nb_watershed_endo_km':km(m.get('watershed_endo_m',0.0)),'nb_watershed_endo_pct':pct(m.get('watershed_endo_m',0.0),total),'nb_watershed_km':km(m.get('watershed_total_m',0.0)),'nb_watershed_pct':pct(m.get('watershed_total_m',0.0),total),'nb_wetland_km':None,'nb_wetland_pct':None,'nb_wetland_data_available':False,'nb_unexplained_physical_km':km(m.get('unexplained_physical_m',0.0)),'nb_unexplained_physical_pct':pct(m.get('unexplained_physical_m',0.0),total),'nb_unexplained_km':km(m.get('unexplained_physical_m',0.0)),'nb_unexplained_pct':pct(m.get('unexplained_physical_m',0.0),total),'nb_match_2021_km':None if year==2021 else km(m.get('match_2021_m',0.0)),'nb_match_2021_pct':None if year==2021 else pct(m.get('match_2021_m',0.0),total),'nb_match_mo_km':km(m.get('match_mo_m',0.0)),'nb_match_mo_pct':pct(m.get('match_mo_m',0.0),total),'nb_admin_memory_km':km(m.get('admin_memory_m',0.0)),'nb_admin_memory_pct':pct(m.get('admin_memory_m',0.0),total),'nb_rail_km':km(m.get('rail_m',0.0)),'nb_rail_pct':pct(m.get('rail_m',0.0),total),'nb_admin_infra_union_km':km(m.get('admin_infra_union_m',0.0)),'nb_admin_infra_union_pct':pct(m.get('admin_infra_union_m',0.0),total),'nb_geometric_candidate_km':km(m.get('geometric_candidate_m',0.0)),'nb_geometric_candidate_pct':pct(m.get('geometric_candidate_m',0.0),total),'nb_rectilinear_candidate_km':km(m.get('rectilinear_candidate_m',0.0)),'nb_rectilinear_candidate_pct':pct(m.get('rectilinear_candidate_m',0.0),total),'nb_dominant_physical_origin':dom,'nb_dominant_physical_origin_label':PHYS_LABELS.get(dom,dom),'nb_dominant_physical_origin_pct':pct(class_m.get(dom,0.0),total),'nb_dominant_origin':dom,'nb_dominant_origin_label':PHYS_LABELS.get(dom,dom),'nb_dominant_origin_pct':pct(class_m.get(dom,0.0),total),'nb_method_version':'v125','nb_method_note':'v125: physical morphology is separate from admin/MO/rail matches; match metrics use sample fractions along segment, not all-or-nothing dwithin; wetlands require a vector wetland layer.'}
        unit_metrics[uid]=d
    adm=json.load(open(adm_path,encoding='utf-8')); nb_keys=set()
    for ft in adm.get('features',[]): nb_keys.update(k for k in ft.get('properties',{}) if k.startswith('nb_'))
    for ft in adm.get('features',[]):
        p=ft.setdefault('properties',{})
        for k in nb_keys: p.pop(k,None)
        if p.get('unit_id') in unit_metrics: p.update(unit_metrics[p.get('unit_id')])
    tmp=adm_path.with_suffix('.tmp'); json.dump(adm,open(tmp,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':')); tmp.replace(adm_path)
    print(year, len(seg_w), 'segments', f'{time.time()-t0:.1f}s', flush=True)
