import json,csv
from pathlib import Path
ROOT=Path('.')
DOCS=ROOT/'docs'; DOCS.mkdir(exist_ok=True)
ADMIN=ROOT/'data/admin'
YEARS=sorted(int(p.stem.split('_')[1]) for p in ADMIN.glob('admin_*.geojson'))
METHOD={
  'version':'v125',
  'projection':'+proj=eqdc +lat_1=50 +lat_2=70 +lat_0=60 +lon_0=75 +datum=WGS84 +units=m +no_defs',
  'unit_of_length':'meters / kilometers',
  'main_principle_ru':'Разделены две аналитические плоскости: природная морфология границ и административно-инфраструктурная преемственность/совпадение. Унаследованность больше не конкурирует с реками, озерами, берегом и водоразделами как класс природного происхождения.',
  'physical_priority':['береговая линия','река','озеро / водная гладь','водораздел сточных бассейнов','водораздел бессточных областей стока','болота / заболоченные массивы (расчет требует векторного слоя болот)','не объяснено физико-географическими рубежами'],
  'administrative_infrastructure_axis':['совпадение с границами слоя 2021 года (для 2021 самоссылка отключена)','совпадение с низовой муниципальной/сельсоветской сеткой MO_retrospecular','приуроченность к железной дороге'],
  'tolerances_km':{'coastline':5.0,'river':1.0,'lake':1.0,'watershed_between_48_59_N':3.0,'watershed_north_of_59_or_south_of_48_N':6.0,'admin_2021_match':2.5,'municipal_lower_boundaries_match':2.5,'railway_match':1.5,'wetland_recommended_strict_contact':1.0,'wetland_recommended_broad_contact':3.0},
  'geometry_diagnostic':{'sinuosity_threshold_for_straight_candidate':1.04,'minimum_segment_length_km_for_geometric_candidate':10.0,'axis_aligned_tolerance_degrees':7.5,'note_ru':'Прямолинейность считается только как диагностический признак для участков, не объясненных природными факторами; она не заменяет природную классификацию.'},
  'wetlands_status_ru':'Векторный слой болот в v125 не был предоставлен; screenshot не используется как геоданные. Поля nb_wetland_* оставлены как null/0-data slot и будут пересчитаны после добавления GeoJSON/SHP слоя болот.',
  'source_basis_ru':'Сегменты v124 используются как готовая нарезка границ; inherited из v124 переведен в unexplained_physical, а административные совпадения пересчитаны отдельными булевыми признаками.'
}

def write_csv(path,rows):
    if not rows: return
    keys=[]
    for r in rows:
        for k in r:
            if k not in keys: keys.append(k)
    with open(path,'w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=keys,delimiter=';'); w.writeheader(); w.writerows(rows)

def nf(v):
    return float(v) if isinstance(v,(int,float)) else 0.0

unit_rows=[]; year_rows=[]
for y in YEARS:
    g=json.load(open(ADMIN/f'admin_{y}.geojson',encoding='utf-8'))
    sums={k:0.0 for k in ['total','coast','river','lake','watershed_flowing','watershed_endo','watershed','unexplained','match_2021','match_mo','admin_memory','rail','admin_infra_union','geometric','rectilinear']}
    units=0
    for ft in g.get('features',[]):
        p=ft.get('properties',{})
        if p.get('nb_method_version')!='v125': continue
        units+=1
        row={k:p.get(k) for k in ['year','unit_id','name','unit_type','admin_parent','admin_intermediate','admin_superparent'] if k in p}
        for k,v in p.items():
            if k.startswith('nb_'): row[k]=v
        unit_rows.append(row)
        sums['total']+=nf(p.get('nb_total_boundary_km'))
        sums['coast']+=nf(p.get('nb_coast_km'))
        sums['river']+=nf(p.get('nb_river_km'))
        sums['lake']+=nf(p.get('nb_lake_km'))
        sums['watershed_flowing']+=nf(p.get('nb_watershed_flowing_km'))
        sums['watershed_endo']+=nf(p.get('nb_watershed_endo_km'))
        sums['watershed']+=nf(p.get('nb_watershed_km'))
        sums['unexplained']+=nf(p.get('nb_unexplained_physical_km'))
        sums['match_2021']+=nf(p.get('nb_match_2021_km'))
        sums['match_mo']+=nf(p.get('nb_match_mo_km'))
        sums['admin_memory']+=nf(p.get('nb_admin_memory_km'))
        sums['rail']+=nf(p.get('nb_rail_km'))
        sums['admin_infra_union']+=nf(p.get('nb_admin_infra_union_km'))
        sums['geometric']+=nf(p.get('nb_geometric_candidate_km'))
        sums['rectilinear']+=nf(p.get('nb_rectilinear_candidate_km'))
    total=sums['total']
    pc=lambda x: round(x/total*100,2) if total else None
    year_rows.append({'year':y,'units':units,'total_boundary_km':round(total,3),'coast_pct':pc(sums['coast']),'river_pct':pc(sums['river']),'lake_pct':pc(sums['lake']),'watershed_flowing_pct':pc(sums['watershed_flowing']),'watershed_endo_pct':pc(sums['watershed_endo']),'watershed_total_pct':pc(sums['watershed']),'wetland_pct':None,'unexplained_physical_pct':pc(sums['unexplained']),'match_2021_pct':None if y==2021 else pc(sums['match_2021']),'match_mo_pct':pc(sums['match_mo']),'admin_memory_pct':pc(sums['admin_memory']),'rail_pct':pc(sums['rail']),'admin_infra_union_pct':pc(sums['admin_infra_union']),'geometric_candidate_pct':pc(sums['geometric']),'rectilinear_candidate_pct':pc(sums['rectilinear'])})

write_csv(DOCS/'v125_boundary_unit_metrics.csv',unit_rows)
write_csv(DOCS/'v125_boundary_year_summary.csv',year_rows)
with open(ROOT/'data/natural_boundaries/natural_boundary_method_v125.json','w',encoding='utf-8') as f: json.dump(METHOD,f,ensure_ascii=False,indent=2)
with open(ROOT/'data/natural_boundaries/natural_boundary_metrics_by_year_v125.json','w',encoding='utf-8') as f: json.dump(year_rows,f,ensure_ascii=False,indent=2)
with open(ROOT/'data/natural_boundaries/natural_boundary_metrics_by_year.json','w',encoding='utf-8') as f: json.dump(year_rows,f,ensure_ascii=False,indent=2)
# manifest
mp=ROOT/'data/manifest.json'
manifest=json.load(open(mp,encoding='utf-8'))
nb=manifest.setdefault('layers',{}).setdefault('natural_boundaries',{})
nb['metrics_by_year']='data/natural_boundaries/natural_boundary_metrics_by_year.json'
nb['metrics_by_year_v125']='data/natural_boundaries/natural_boundary_metrics_by_year_v125.json'
nb['method']='data/natural_boundaries/natural_boundary_method_v125.json'
ref=nb.setdefault('reference_sources',{})
ref['railways']='data/railways/railways.geojson'
ref['wetlands']=None
ref['wetlands_note']='not provided in v125; screenshot is not geodata'
json.dump(manifest,open(mp,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
write_csv(DOCS/'v125_change_report.csv',[
 {'item':'methodology','status':'done','note':'Разделены природная морфология и административно-инфраструктурная плоскость совпадений.'},
 {'item':'inherited_reclassification','status':'done','note':'v124 inherited больше не является физическим классом; в природной оси такие участки считаются unexplained_physical.'},
 {'item':'watershed_split','status':'done','note':'Водоразделы разделены на сточные и бессточные по ENDO-бассейнам.'},
 {'item':'admin_memory','status':'done','note':'Отдельно считаются совпадение с 2021, MO_retrospecular и их union.'},
 {'item':'railway_match','status':'done','note':'Добавлен признак границ рядом с ЖД; допуск 1,5 км.'},
 {'item':'geometry_diagnostic','status':'done','note':'Добавлен простой диагностический показатель прямолинейных необъясненных участков.'},
 {'item':'wetlands','status':'pending_geodata','note':'Векторный слой болот не был загружен; поля/методика подготовлены, расчет не выполнен.'}
])
print('wrote',len(unit_rows),'unit rows',len(year_rows),'years')
