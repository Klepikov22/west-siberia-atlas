#!/usr/bin/env python3
# Recalculate railway length metrics using geodesic length after clipping,
# avoiding Web Mercator length inflation at Siberian latitudes.
import csv, json, math
from pathlib import Path
from collections import defaultdict
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely.strtree import STRtree
from shapely.validation import make_valid
from pyproj import CRS, Transformer, Geod

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'
ADMIN=DATA/'admin'
RAIL=DATA/'railways'/'railways.geojson'
POP=DATA/'population_long.csv'
REPORT=ROOT/'v131_rail_length_recalc_summary.csv'

# Local LAEA projection is used only for robust intersections; final lengths are geodesic.
LAEA=CRS.from_proj4('+proj=laea +lat_0=62 +lon_0=75 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
TO_M=Transformer.from_crs('EPSG:4326',LAEA,always_xy=True).transform
FROM_M=Transformer.from_crs(LAEA,'EPSG:4326',always_xy=True).transform
GEOD=Geod(ellps='WGS84')

def load(path):
    with open(path,'r',encoding='utf-8') as f: return json.load(f)

def save(path,obj):
    with open(path,'w',encoding='utf-8') as f: json.dump(obj,f,ensure_ascii=False,separators=(',',':'))

def num(v):
    try:
        if v is None or v=='': return None
        n=float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None

def clean(g):
    if g is None or g.is_empty: return g
    if not g.is_valid:
        g=make_valid(g)
    if not g.is_valid:
        g=g.buffer(0)
    return g

def geod_len_km(g):
    if g is None or g.is_empty: return 0.0
    gt=g.geom_type
    if gt in ('LineString','LinearRing'):
        return abs(GEOD.geometry_length(g))/1000.0
    if gt in ('MultiLineString','GeometryCollection'):
        return sum(geod_len_km(x) for x in g.geoms)
    # Polygon intersections can appear only from invalid inputs; ignore area length for railway length.
    return 0.0

def active_rails(year):
    rail=load(RAIL)
    out=[]
    for f in rail.get('features',[]):
        p=f.get('properties') or {}
        yo=num(p.get('year_open'))
        yc=num(p.get('year_close'))
        if yo is not None and yo>year: continue
        if yc is not None and yc<=year: continue
        try:
            g=shape(f.get('geometry'))
            if g.is_empty: continue
            gm=transform(TO_M, clean(g))
            if not gm.is_empty: out.append(gm)
        except Exception:
            continue
    return out

def recalc_year(year):
    path=ADMIN/f'admin_{year}.geojson'
    gj=load(path)
    rails=active_rails(year)
    tree=STRtree(rails) if rails else None
    before=after=0.0
    features=gj.get('features',[])
    for f in features:
        p=f.setdefault('properties',{})
        old=num(p.get('rail_length_km')) or 0.0
        before+=old
        length=0.0; segs=0
        if tree:
            try:
                pg=clean(shape(f.get('geometry')))
                pm=clean(transform(TO_M, pg))
                for idx in tree.query(pm):
                    rg=rails[int(idx)]
                    try:
                        inter=pm.intersection(rg)
                    except Exception:
                        inter=pm.buffer(0).intersection(rg)
                    L=geod_len_km(transform(FROM_M, inter))
                    if L>0.01:
                        length+=L; segs+=1
            except Exception:
                pass
        p['rail_length_km']=round(length,2)
        area=num(p.get('area_km2'))
        p['rail_density_km_1000']=round(length/area*1000,3) if area and area>0 else 0.0
        p['rail_segments_count']=segs
        p['rail_length_method_v131']='geodesic_length_after_LAEA_clip'
        after+=length
    save(path,gj)
    return {'year':year,'features':len(features),'rail_km_before_webmercator_like':round(before,2),'rail_km_after_geodesic':round(after,2),'ratio_after_before':round(after/before,4) if before else None}

def years():
    ys=[]
    for p in sorted(ADMIN.glob('admin_*.geojson')):
        try: ys.append(int(p.stem.split('_')[1]))
        except Exception: pass
    return ys

def update_population_long():
    if not POP.exists(): return
    lookup={}
    for y in years():
        gj=load(ADMIN/f'admin_{y}.geojson')
        for f in gj.get('features',[]):
            p=f.get('properties') or {}
            lookup[(str(y),str(p.get('unit_id')))]={
                'rail_length_km':p.get('rail_length_km',''),
                'rail_density_km_1000':p.get('rail_density_km_1000',''),
                'rail_segments_count':p.get('rail_segments_count','')
            }
    with open(POP,'r',encoding='utf-8-sig',newline='') as f:
        rows=list(csv.DictReader(f))
        fieldnames=f.readline if False else rows[0].keys() if rows else []
    # Need preserve original header order
    with open(POP,'r',encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f); fields=reader.fieldnames; rows=list(reader)
    for r in rows:
        d=lookup.get((str(r.get('year')),str(r.get('unit_id'))))
        if d:
            for k,v in d.items():
                if k in r: r[k]=v
    with open(POP,'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields)
        w.writeheader(); w.writerows(rows)

def update_multiyear_metrics():
    path=DATA/'topology'/'multiyear_metrics_by_year.json'
    if not path.exists(): return
    data=load(path)
    admin_aggs={}
    for y in years():
        gj=load(ADMIN/f'admin_{y}.geojson')
        feats=gj.get('features',[])
        rail=sum(num((f.get('properties') or {}).get('rail_length_km')) or 0.0 for f in feats)
        segs=sum(num((f.get('properties') or {}).get('rail_segments_count')) or 0.0 for f in feats)
        area=sum(num((f.get('properties') or {}).get('area_km2')) or 0.0 for f in feats)
        admin_aggs[y]=(rail,segs,area)
    for row in data:
        y=int(row.get('year'))
        if y not in admin_aggs: continue
        rail,segs,area=admin_aggs[y]
        row['rail_length_km_total']=round(rail,3)
        row['rail_segments_count_sum']=round(segs,3)
        row['rail_density_km_1000']=round(rail/area*1000,6) if area else 0.0
        row['rail_length_method_v131']='geodesic_length_after_LAEA_clip'
    save(path,data)

def main():
    rows=[recalc_year(y) for y in years()]
    update_population_long()
    update_multiyear_metrics()
    with open(REPORT,'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print('done', REPORT)
    for r in rows:
        if r['year'] in (1897,1914,1926,1989,2021): print(r)

if __name__=='__main__': main()
