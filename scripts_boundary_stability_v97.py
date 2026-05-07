#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, csv
from pathlib import Path
from collections import Counter
ROOT=Path('.')
STAB=ROOT/'data'/'stability'; DOCS=ROOT/'docs'; STAB.mkdir(exist_ok=True,parents=True); DOCS.mkdir(exist_ok=True,parents=True)
NORTH=4.0; SOUTH=3.0
src=json.loads((STAB/'boundary_stability_v96.geojson').read_text(encoding='utf-8'))
features=[]; by_count=Counter(); by_class=Counter(); by_ref=Counter(); dropped=0
for f in src.get('features',[]):
    p=dict(f.get('properties') or {})
    lat=float(p.get('mid_lat') or 0); tol=NORTH if lat>=59 else SOUTH
    maxoff=float(p.get('max_offset_km') or 0)
    if maxoff>tol:
        dropped+=1; continue
    p['stability_id']=f'bs97_{len(features)+1:06d}'
    p['method']='actual_ate_boundary_narrow_visual_buffer_v97_3_4km'
    p['tolerance_km']=tol
    p['lat_zone']='севернее/на 59° с.ш.' if lat>=59 else 'южнее 59° с.ш.'
    p['visual_buffer_km']=tol
    p['note']='v97: узкий режим по реальным сегментам границ АТЕ. Допуск уменьшен до 4 км севернее/на 59° с.ш. и 3 км южнее; K-линий и перемычек нет. Веб-карта может показывать визуальный буфер как широкий полупрозрачный ход поверх этой же линии.'
    n=int(p.get('years_count') or 0)
    p['stability_class']='очень высокая' if n>=12 else 'высокая' if n>=8 else 'средняя' if n>=4 else 'низкая'
    features.append({'type':'Feature','geometry':f.get('geometry'),'properties':p})
    by_count[n]+=1; by_class[p['stability_class']]+=1; by_ref[p.get('reference_year')]+=1
fc={'type':'FeatureCollection','name':'boundary_stability_v97_actual_boundaries_3_4km','properties':{'version':'v97','analysis':'geometric_stability_actual_ate_boundaries_narrow_visual_buffer','years':src.get('properties',{}).get('years',[]),'years_total':src.get('properties',{}).get('years_total',30),'tolerance_north_km':NORTH,'tolerance_south_km':SOUTH,'latitude_split':59,'source':'v96 real ATE boundary linelets narrowed to 3/4 km tolerance; visual buffer rendered in Leaflet as a broad translucent stroke','features':len(features),'dropped_by_new_tolerance':dropped},'features':features}
(STAB/'boundary_stability_v97.geojson').write_text(json.dumps(fc,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
summary={'version':'v97','method':'actual_ate_boundary_narrow_visual_buffer_v97_3_4km','features':len(features),'dropped_by_new_tolerance':dropped,'tolerance_north_km':NORTH,'tolerance_south_km':SOUTH,'by_count':dict(sorted(by_count.items())),'by_class':dict(by_class),'by_reference_year':dict(sorted((str(k),v) for k,v in by_ref.items()))}
(STAB/'boundary_stability_v97_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
for name,rows in [('v97_boundary_stability_summary.csv',[('metric','value'),('version','v97'),('method',summary['method']),('features',len(features)),('dropped_by_new_tolerance',dropped),('tolerance_north_km',NORTH),('tolerance_south_km',SOUTH)]),('v97_boundary_stability_by_count.csv',[('years_count','segments')]+[(k,v) for k,v in sorted(by_count.items())]),('v97_boundary_stability_by_reference_year.csv',[('reference_year','segments')]+[(str(k),v) for k,v in sorted(by_ref.items(), key=lambda kv: str(kv[0]))])]:
    with (DOCS/name).open('w',encoding='utf-8',newline='') as f: csv.writer(f).writerows(rows)
print(json.dumps(summary,ensure_ascii=False,indent=2))
