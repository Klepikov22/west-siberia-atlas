#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v124: Natural/landscape boundary genesis analysis, optimized with STRtree dwithin queries."""
from __future__ import annotations

import csv, glob, json, math, os, sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

from pyproj import Transformer
from shapely.geometry import shape, mapping, LineString, MultiLineString
from shapely.ops import transform as shp_transform, substring
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
ADMIN_DIR = DATA / 'admin'
NB_DIR = DATA / 'natural_boundaries'
SEG_DIR = NB_DIR / 'segments'
DOCS = ROOT / 'docs'
REF_DIR = NB_DIR / 'reference'

PROJ4 = '+proj=eqdc +lat_1=50 +lat_2=70 +lat_0=60 +lon_0=75 +datum=WGS84 +units=m +no_defs'
TO_M = Transformer.from_crs('EPSG:4326', PROJ4, always_xy=True)
TO_WGS = Transformer.from_crs(PROJ4, 'EPSG:4326', always_xy=True)
CHUNK_M = 10000.0
MIN_RUN_M = 10000.0
SIMPLIFY_M = 180.0

CLASS_ORDER = ['coastline', 'river', 'lake', 'watershed', 'inherited', 'unexplained']
CLASS_LABELS = {
    'coastline': 'береговая линия',
    'river': 'река',
    'lake': 'озеро / водная гладь',
    'watershed': 'водораздел / орографический рубеж',
    'inherited': 'унаследованная / фантомная граница',
    'unexplained': 'не объяснено физико-географически',
}
CLASS_SHORT = {'coastline':'coast','river':'river','lake':'lake','watershed':'watershed','inherited':'inherited','unexplained':'unexplained'}


def log(msg): print(msg, flush=True)
def load_fc(path: Path) -> dict:
    with path.open('r', encoding='utf-8') as f: return json.load(f)
def write_json(path: Path, obj, indent=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False, indent=indent, separators=None if indent else (',', ':'))
def write_fc(path: Path, features: list): write_json(path, {'type':'FeatureCollection','features':features})
def to_m(geom): return shp_transform(TO_M.transform, geom)
def to_wgs(geom): return shp_transform(TO_WGS.transform, geom)

def flatten_lines(geom) -> List[LineString]:
    if geom.is_empty: return []
    gt=geom.geom_type
    if gt=='LineString': return [geom]
    if gt=='LinearRing': return [LineString(geom)]
    if gt=='MultiLineString': return [g for g in geom.geoms if not g.is_empty and g.length>1]
    if gt=='GeometryCollection':
        out=[]
        for g in geom.geoms: out.extend(flatten_lines(g))
        return out
    return []

def geom_boundary_lines(geom) -> List[LineString]: return flatten_lines(geom.boundary)

def make_tree(geoms: List):
    geoms=[g for g in geoms if g is not None and not g.is_empty]
    return (STRtree(geoms) if geoms else None, geoms)

def query_dwithin(seg, tree, geoms, dist: float) -> bool:
    if tree is None or not geoms or seg.is_empty: return False
    try:
        idxs = tree.query(seg, predicate='dwithin', distance=dist)
        return len(idxs) > 0
    except TypeError:
        # Fallback for older APIs.
        minx,miny,maxx,maxy=seg.bounds
        box = LineString([(minx-dist,miny-dist),(maxx+dist,maxy+dist)]).envelope
        for g in tree.query(box):
            if g.distance(seg) <= dist: return True
        return False




def batch_hit_indices(segments, tree, geoms, dist: float) -> set:
    """Return indexes of input segments within dist of any indexed geometry."""
    if tree is None or not geoms or not segments:
        return set()
    try:
        pairs = tree.query(segments, predicate='dwithin', distance=dist)
        # Shapely 2: array shape (2, n), first row = input segment indexes.
        if hasattr(pairs, 'shape') and len(pairs) == 2:
            return set(int(i) for i in pairs[0])
        # Fallback if a flat list is returned for a single geometry.
        return set()
    except TypeError:
        hits=set()
        for idx, seg in enumerate(segments):
            if query_dwithin(seg, tree, geoms, dist): hits.add(idx)
        return hits

def round_coords(obj, nd=5):
    if isinstance(obj,(float,int)): return round(float(obj), nd)
    if isinstance(obj,(list,tuple)): return [round_coords(x,nd) for x in obj]
    return obj

def geom_to_mapping_rounded(geom):
    m=dict(mapping(geom))
    if 'coordinates' in m: m['coordinates']=round_coords(m['coordinates'],5)
    return m




def split_line_max_length(line: LineString, max_len: float = CHUNK_M) -> List[LineString]:
    """Fast linear splitting of a LineString into <= max_len meter pieces."""
    coords = list(line.coords)
    if len(coords) < 2:
        return []
    out=[]
    current=[coords[0]]
    current_len=0.0
    px, py = coords[0][0], coords[0][1]
    for q in coords[1:]:
        qx, qy = q[0], q[1]
        dx, dy = qx-px, qy-py
        dist = math.hypot(dx, dy)
        if dist <= 0:
            continue
        while current_len + dist >= max_len:
            remain = max_len - current_len
            if remain <= 1e-9:
                if len(current) >= 2:
                    seg=LineString(current)
                    if seg.length > 20: out.append(seg)
                current=[(px, py)]
                current_len=0.0
                remain=max_len
            ratio = remain / dist
            nx, ny = px + ratio*(qx-px), py + ratio*(qy-py)
            current.append((nx, ny))
            if len(current) >= 2:
                seg=LineString(current)
                if seg.length > 20: out.append(seg)
            current=[(nx, ny)]
            px, py = nx, ny
            dx, dy = qx-px, qy-py
            dist = math.hypot(dx, dy)
            current_len = 0.0
            if dist <= 0:
                break
        if dist > 0:
            current.append((qx, qy))
            current_len += dist
            px, py = qx, qy
    if len(current) >= 2:
        seg=LineString(current)
        if seg.length > 20:
            out.append(seg)
    return out


def make_line_segment(line: LineString, start_m: float, end_m: float):
    if end_m <= start_m: return None
    try: seg=substring(line, start_m, end_m, normalized=False)
    except Exception: return None
    if seg.is_empty or seg.length < 20 or seg.geom_type == 'Point': return None
    if seg.geom_type == 'MultiLineString':
        parts=[g for g in seg.geoms if g.length>20]
        if not parts: return None
        seg=max(parts, key=lambda g:g.length)
    return seg

def segment_lat(seg) -> float:
    p=seg.interpolate(0.5, normalized=True)
    _, lat=TO_WGS.transform(p.x,p.y)
    return float(lat)


def load_lines_from_fc(path: Path, boundary=False, predicate=None, min_length=100) -> List:
    fc=load_fc(path); out=[]
    for f in fc.get('features',[]):
        if predicate and not predicate(f): continue
        try: geom=to_m(shape(f['geometry']))
        except Exception: continue
        if boundary: lines=geom_boundary_lines(geom)
        else: lines=flatten_lines(geom)
        for line in lines:
            if line.length > min_length:
                # reference lines are used only for proximity tests; light simplification speeds up dwithin queries.
                try:
                    line = line.simplify(180.0, preserve_topology=False)
                except Exception:
                    pass
                if line.length > min_length: out.append(line)
    return out

def load_polygons_from_fc(path: Path, predicate=None) -> List:
    fc=load_fc(path); out=[]
    for f in fc.get('features',[]):
        if predicate and not predicate(f): continue
        try: geom=to_m(shape(f['geometry']))
        except Exception: continue
        if not geom.is_empty: out.append(geom)
    return out


def build_trees() -> Dict[str, Tuple[STRtree, List]]:
    log('Building reference spatial indexes…')
    water_path=DATA/'hydro'/'water_ocean_lakes_full.geojson'
    river_path=DATA/'hydro'/'rivers_full.geojson'
    oro_path=REF_DIR/'orography_clipped1.json'
    mo_path=REF_DIR/'MO_retrospecular_boundaries_selsoviets.json'

    coast_lines=load_lines_from_fc(water_path, boundary=True, predicate=lambda f: ((f.get('properties') or {}).get('water_kind')=='ocean' or (f.get('properties') or {}).get('source_type')=='Ocean'))
    river_lines=load_lines_from_fc(river_path, boundary=False)
    lake_polys=load_polygons_from_fc(water_path, predicate=lambda f: not (((f.get('properties') or {}).get('water_kind')=='ocean') or ((f.get('properties') or {}).get('source_type')=='Ocean')))
    watershed_lines=load_lines_from_fc(oro_path, boundary=True)
    inherited_mo_lines=[]
    if mo_path.exists(): inherited_mo_lines.extend(load_lines_from_fc(mo_path, boundary=True))
    inherited_lines=list(inherited_mo_lines)
    inherited_lines.extend(load_lines_from_fc(ADMIN_DIR/'admin_2021.geojson', boundary=True))

    refs={'coastline':coast_lines,'river':river_lines,'lake':lake_polys,'watershed':watershed_lines,'inherited':inherited_lines,'inherited_mo':inherited_mo_lines}
    trees={k:make_tree(v) for k,v in refs.items()}
    for k,(_,geoms) in trees.items(): log(f'  {k}: {len(geoms)} indexed geometries')
    return trees


def classify_segment(seg, trees) -> str:
    if query_dwithin(seg, *trees['coastline'], 5000.0): return 'coastline'
    if query_dwithin(seg, *trees['river'], 1000.0): return 'river'
    if query_dwithin(seg, *trees['lake'], 1000.0): return 'lake'
    lat=segment_lat(seg)
    ws_tol=3000.0 if 48 <= lat <= 59 else 6000.0
    if query_dwithin(seg, *trees['watershed'], ws_tol): return 'watershed'
    if query_dwithin(seg, *trees['inherited'], 2500.0): return 'inherited'
    return 'unexplained'


def merge_adjacent_runs(chunks):
    runs=[]
    for seg,cls in chunks:
        if not runs or runs[-1][1]!=cls: runs.append([[seg],cls,seg.length])
        else:
            runs[-1][0].append(seg); runs[-1][2]+=seg.length
    return runs

def smooth_short_runs(chunks):
    if not chunks: return chunks
    for _ in range(3):
        runs=merge_adjacent_runs(chunks)
        if len(runs)<=1: break
        new=[]; changed=False
        for i,(segs,cls,length) in enumerate(runs):
            target=cls
            if length < MIN_RUN_M:
                cand=[]
                if i>0: cand.append(runs[i-1])
                if i<len(runs)-1: cand.append(runs[i+1])
                if cand:
                    target=max(cand, key=lambda r:r[2])[1]
                    changed |= (target != cls)
            for s in segs: new.append((s,target))
        chunks=new
        if not changed: break
    return chunks

def coalesce_output_runs(chunks):
    out=[]
    for segs,cls,length in merge_adjacent_runs(chunks):
        if not segs: continue
        if len(segs)==1: geom=segs[0]
        else:
            coords=[]; ok=True
            for j,s in enumerate(segs):
                c=list(s.coords)
                if j==0: coords.extend(c)
                else:
                    if coords and c and math.hypot(coords[-1][0]-c[0][0], coords[-1][1]-c[0][1])<8: coords.extend(c[1:])
                    else: ok=False; break
            geom=LineString(coords) if ok and len(coords)>=2 else MultiLineString(segs)
        out.append((geom,cls,length))
    return out


def classify_feature_boundary(f: dict, year: int, trees):
    p=f.get('properties') or {}
    unit_id=p.get('unit_id') or f'adm_{year}_{p.get("raw_objectid") or p.get("OBJECTID") or p.get("name")}'
    unit_name=p.get('name') or p.get('unit_name') or 'объект'
    try: geom=to_m(shape(f['geometry']))
    except Exception: return defaultdict(float), []

    segments=[]
    for line in geom_boundary_lines(geom):
        if line.length < 100: continue
        try:
            line = line.simplify(250.0, preserve_topology=False)
        except Exception:
            pass
        segments.extend(split_line_max_length(line, CHUNK_M))
    if not segments:
        return defaultdict(float), []

    # Vectorized spatial predicates are much faster than per-segment tree queries.
    coast_hits = batch_hit_indices(segments, *trees['coastline'], 5000.0)
    river_hits = batch_hit_indices(segments, *trees['river'], 1000.0)
    lake_hits = batch_hit_indices(segments, *trees['lake'], 1000.0)
    ws3_hits = batch_hit_indices(segments, *trees['watershed'], 3000.0)
    ws6_hits = batch_hit_indices(segments, *trees['watershed'], 6000.0)
    inherited_key = 'inherited_mo' if int(year) == 2021 and 'inherited_mo' in trees else 'inherited'
    inh_hits = batch_hit_indices(segments, *trees[inherited_key], 2500.0)

    chunks=[]
    for idx, seg in enumerate(segments):
        if idx in coast_hits: cls='coastline'
        elif idx in river_hits: cls='river'
        elif idx in lake_hits: cls='lake'
        else:
            lat=segment_lat(seg)
            if (48 <= lat <= 59 and idx in ws3_hits) or ((lat < 48 or lat > 59) and idx in ws6_hits): cls='watershed'
            elif idx in inh_hits: cls='inherited'
            else: cls='unexplained'
        chunks.append((seg,cls))

    chunks=smooth_short_runs(chunks)
    lengths=defaultdict(float); out=[]
    for geom_run,cls,length_m in coalesce_output_runs(chunks):
        if length_m<20: continue
        lengths[cls]+=length_m
        geom_out=geom_run.simplify(SIMPLIFY_M, preserve_topology=True)
        if geom_out.is_empty: geom_out=geom_run
        geom_wgs=to_wgs(geom_out)
        out.append({'type':'Feature','geometry':geom_to_mapping_rounded(geom_wgs),'properties':{
            'year':year,'unit_id':unit_id,'unit_name':unit_name,'admin_parent':p.get('admin_parent'),'unit_type':p.get('unit_type'),
            'boundary_origin':cls,'boundary_origin_label':CLASS_LABELS[cls],'boundary_km':round(length_m/1000.0,3),
            'method':'v124_segment_midpoint_dwithin_10km_chunks_short_runs_to_neighbor_10km'
        }})
    return lengths, out


def pct_value(n,d): return round(100.0*n/d,2) if d>0 else None

def process_year(path: Path, trees):
    year=int(path.stem.split('_')[-1]); fc=load_fc(path)
    all_segments=[]; year_lengths=Counter(); rows=[]
    feats=fc.get('features',[])
    for idx,f in enumerate(feats,1):
        p=f.get('properties') or {}
        lengths,segs=classify_feature_boundary(f,year,trees)
        total=sum(lengths.values())
        year_lengths.update({k:v for k,v in lengths.items()})
        all_segments.extend(segs)
        for cls in CLASS_ORDER:
            km=lengths.get(cls,0.0)/1000.0
            p[f'nb_{CLASS_SHORT[cls]}_km']=round(km,3)
            p[f'nb_{CLASS_SHORT[cls]}_pct']=pct_value(lengths.get(cls,0.0),total)
        p['nb_total_boundary_km']=round(total/1000.0,3) if total else None
        if total>0:
            dominant=max(CLASS_ORDER, key=lambda c:lengths.get(c,0.0))
            p['nb_dominant_origin']=dominant; p['nb_dominant_origin_label']=CLASS_LABELS[dominant]
            p['nb_dominant_origin_pct']=pct_value(lengths.get(dominant,0.0),total)
        else:
            p['nb_dominant_origin']=None; p['nb_dominant_origin_label']=None; p['nb_dominant_origin_pct']=None
        p['nb_method_version']='v124'
        p['nb_method_note']='Segments: 10 km chunks; dwithin tolerances: coast 5 km, rivers/lakes 1 km, watershed 3/6 km by latitude, inherited 2.5 km; short runs <10 km merged to longer neighbor.'
        rows.append({'year':year,'unit_id':p.get('unit_id'),'name':p.get('name'),'unit_type':p.get('unit_type'),'admin_parent':p.get('admin_parent'),'total_boundary_km':p['nb_total_boundary_km'],**{f'{CLASS_SHORT[cls]}_km':p[f'nb_{CLASS_SHORT[cls]}_km'] for cls in CLASS_ORDER},**{f'{CLASS_SHORT[cls]}_pct':p[f'nb_{CLASS_SHORT[cls]}_pct'] for cls in CLASS_ORDER},'dominant_origin':p['nb_dominant_origin'],'dominant_origin_pct':p['nb_dominant_origin_pct']})
    write_fc(path, feats)
    write_fc(SEG_DIR/f'natural_boundary_segments_{year}.geojson', all_segments)
    total_y=sum(year_lengths.values())
    summary={'year':year,'units':len(feats),'segment_features':len(all_segments),'total_boundary_km':round(total_y/1000.0,3)}
    for cls in CLASS_ORDER:
        summary[f'{CLASS_SHORT[cls]}_km']=round(year_lengths.get(cls,0.0)/1000.0,3)
        summary[f'{CLASS_SHORT[cls]}_pct']=pct_value(year_lengths.get(cls,0.0),total_y)
    log(f'  {year}: units={summary["units"]}, segments={summary["segment_features"]}, total={summary["total_boundary_km"]} km')
    return summary, rows


def update_manifest(years):
    path=DATA/'manifest.json'; m=load_fc(path)
    nb_segments={str(y):f'data/natural_boundaries/segments/natural_boundary_segments_{y}.geojson' for y in years}
    m.setdefault('layers',{})['natural_boundaries']={'segments':nb_segments,'metrics_by_year':'data/natural_boundaries/natural_boundary_metrics_by_year.json','method':'data/natural_boundaries/natural_boundary_method_v124.json','reference_sources':{'municipal_lower_boundaries':'data/natural_boundaries/reference/MO_retrospecular_boundaries_selsoviets.json','watershed_polygons':'data/natural_boundaries/reference/orography_clipped1.json','rivers':'data/hydro/rivers_full.geojson','water':'data/hydro/water_ocean_lakes_full.geojson','admin_2021':'data/admin/admin_2021.geojson'}}
    m['app_version']='124'; m['version']='124'
    m.setdefault('notes',[]).append('v124: добавлен режим анализа происхождения административных границ по природным рубежам: реки, озёра, береговая линия, водоразделы/орография, унаследованные нижние/современные границы и необъяснённые участки.')
    m.setdefault('changelog',[]).append({'version':'124','note':'Boundary-genesis analysis: per-unit percentages and per-year colored line segments of natural/inherited boundary origins.'})
    write_json(path,m)

def write_method_json():
    write_json(NB_DIR/'natural_boundary_method_v124.json',{
        'version':'v124','projection':PROJ4,'unit_of_length':'meters / kilometers',
        'classification_priority':[CLASS_LABELS[c] for c in CLASS_ORDER],
        'segment_chunk_km':CHUNK_M/1000.0,'short_run_smoothing_km':MIN_RUN_M/1000.0,
        'tolerances_km':{'coastline':5.0,'river':1.0,'lake':1.0,'watershed_between_48_59_N':3.0,'watershed_north_of_59_or_south_of_48_N':6.0,'municipal_lower_boundaries_and_2021_admin_except_self_year':2.5},
        'note_ru':'Проценты считаются по длине периметра каждой АТЕ. Общие границы входят в периметр обеих соседних АТЕ. Сегменты классифицируются по dwithin-допускам с жёстким приоритетом; короткие серии <10 км присоединяются к более длинному соседнему типу.'
    }, indent=2)


def main():
    SEG_DIR.mkdir(parents=True,exist_ok=True); DOCS.mkdir(exist_ok=True)
    trees=build_trees(); summaries=[]; all_rows=[]
    paths=sorted(ADMIN_DIR.glob('admin_*.geojson'), key=lambda p:int(p.stem.split('_')[-1]))
    for path in paths:
        summary, rows=process_year(path,trees); summaries.append(summary); all_rows.extend(rows)
    write_json(NB_DIR/'natural_boundary_metrics_by_year.json', summaries, indent=2)
    if all_rows:
        with (DOCS/'v124_natural_boundary_unit_metrics.csv').open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(all_rows[0].keys())); w.writeheader(); w.writerows(all_rows)
    if summaries:
        with (DOCS/'v124_natural_boundary_year_summary.csv').open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(summaries[0].keys())); w.writeheader(); w.writerows(summaries)
    write_method_json(); update_manifest([s['year'] for s in summaries])
    log('Done v124 natural boundary analysis')
if __name__=='__main__': main()
