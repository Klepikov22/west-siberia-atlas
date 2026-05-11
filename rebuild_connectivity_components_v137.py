import json, math
from pathlib import Path
import pandas as pd
import networkx as nx

BASE=Path(__file__).resolve().parent
DATA=BASE/'data'
OUT=DATA/'connectivity'
VERSION='v137_component_connectivity_postprocess'

def to_float(v, default=None):
    try:
        if v is None: return default
        if isinstance(v,str) and v.strip() in ('','—','None','null'): return default
        x=float(v)
        if not math.isfinite(x): return default
        return x
    except Exception:
        return default

def clean_value(v):
    if isinstance(v,float) and (math.isnan(v) or math.isinf(v)): return None
    if isinstance(v,dict): return {str(k):clean_value(x) for k,x in v.items()}
    if isinstance(v,list): return [clean_value(x) for x in v]
    return v

def score_from_distance(dist_km, limit_km, max_score):
    d=to_float(dist_km, None)
    if d is None or d>limit_km: return 0.0
    return round(max_score*max(0.0,1.0-d/limit_km),4)

def component_profile(flags):
    return '+'.join([name for name, ok in flags if ok]) or 'none'

label_map={
 'mixed_corridor':'смешанный коридор без существенного импеданса',
 'mixed_corridor_impedance':'смешанный коридор + природный импеданс',
 'rail_corridor':'ЖД-коридор',
 'rail_with_impedance':'ЖД-коридор + природный импеданс',
 'old_road_corridor':'тракт / историческая дорога',
 'old_road_with_impedance':'тракт / дорога + природный импеданс',
 'navigable_river_corridor':'судоходная речная связь',
 'navigable_river_with_impedance':'судоходная река + природный импеданс',
 'normal_contact':'обычное соседство',
 'normal_wetland_impedance':'обычное соседство + болотный импеданс',
 'normal_relief_impedance':'обычное соседство + рельефный импеданс',
 'normal_watershed_impedance':'обычное соседство + главный водораздел',
 'normal_minor_river_impedance':'обычное соседство + несудоходная река',
 'normal_multiple_impedance':'обычное соседство + несколько барьеров',
 'blocked_high_impedance':'связь практически разорвана высоким импедансом'}

method={
 'version':'v137',
 'name':'Компонентный эвристический граф потенциальной связности АТЕ',
 'base_graph':'Исходной рамкой остаётся обычный граф геометрической смежности topology_YYYY.geojson. v137 не заменяет его, а присваивает каждому ребру независимые компоненты коридоров и барьеров.',
 'positive_components':{
   'rail_score':'Локальная близость железной дороги к общей границе соседних АТЕ; максимальный вес 3.2, радиус пересчёта 18 км.',
   'old_road_score':'Локальная близость Сибирского тракта / исторической дороги; максимальный вес 2.2, радиус 25 км.',
   'navigable_river_score':'Локальная близость судоходной реки; максимальный вес 2.2 до 1876 г., 1.6 в 1876–1914 гг., 0.9 после 1914 г.; радиус 25 км.'},
 'negative_components':{
   'wetland_impedance':'Болота повышают импеданс; при наличии транспортного/речного коридора штраф ослабляется, но не исчезает.',
   'relief_impedance':'Высоты >400 м севернее 50° с.ш. повышают импеданс.',
   'watershed_impedance':'Главный водораздел повышает импеданс.',
   'minor_river_impedance':'Несудоходная река даёт слабый барьер.'},
 'formula':'positive_bonus = 1 + rail_score + old_road_score + navigable_river_score; barrier_multiplier = wetland_impedance * relief_impedance * watershed_impedance * minor_river_impedance; final_impedance = distance_km / positive_bonus * barrier_multiplier; final_strength = 100 * positive_bonus / (positive_bonus + final_impedance).',
 'implementation_note':'v137 пересобирает компоненты на базе локальных расстояний и барьерных признаков v135, чтобы не смешивать коридоры и препятствия в один взаимоисключающий тип ребра.'}

for fn in ['connectivity_method_v137.json','connectivity_method_v135.json','connectivity_method_v129.json']:
    (OUT/fn).write_text(json.dumps(method, ensure_ascii=False, indent=2), encoding='utf-8')

years=sorted(int(p.stem.split('_')[-1]) for p in (OUT/'edges').glob('connectivity_edges_*.geojson'))
metrics=[]
for year in years:
    print('year',year, flush=True)
    edge_path=OUT/'edges'/f'connectivity_edges_{year}.geojson'
    node_path=OUT/'nodes'/f'connectivity_nodes_{year}.geojson'
    admin_path=DATA/'admin'/f'admin_{year}.geojson'
    edge_fc=json.load(open(edge_path,encoding='utf-8'))
    node_fc=json.load(open(node_path,encoding='utf-8'))
    counts={k:0 for k in label_map}
    edge_debug=[]
    G=nx.Graph()
    all_node_ids=[]
    for feat in node_fc.get('features',[]):
        p=feat.get('properties',{})
        nid=str(p.get('unit_id') or p.get('topology_node_id') or p.get('node_id') or '')
        if nid:
            all_node_ids.append(nid); G.add_node(nid)

    for feat in edge_fc.get('features',[]):
        p=feat.setdefault('properties',{})
        sid=str(p.get('adv_source_id') or p.get('source_id') or '')
        tid=str(p.get('adv_target_id') or p.get('target_id') or '')
        dist_km=to_float(p.get('adv_distance_km'), None)
        if dist_km is None:
            dist_km=to_float(p.get('distance_km'), to_float(p.get('boundary_km'),1.0)) or 1.0

        nav_max=2.2 if year<=1876 else (1.6 if year<=1914 else 0.9)
        rail_score=score_from_distance(p.get('adv_rail_distance_km'),18.0,3.2)
        road_score=score_from_distance(p.get('adv_old_road_distance_km'),25.0,2.2)
        nav_score=score_from_distance(p.get('adv_navigable_distance_km'),25.0,nav_max)
        rail_hit=rail_score>=0.15
        road_hit=road_score>=0.12
        nav_hit=nav_score>=0.10
        positive_score=round(rail_score+road_score+nav_score,4)
        corridor_count=sum([rail_hit,road_hit,nav_hit])

        wet_frac=max(0.0,min(1.0,to_float(p.get('adv_wetland_overlap_frac'),0.0) or 0.0))
        wet_centroid=bool(p.get('adv_wetland_centroid_hit'))
        wet_flag=bool(p.get('adv_barrier_wetland'))
        wet_severity=max(wet_frac,1.0 if wet_centroid else (0.75 if wet_flag else 0.0))
        high_hit=bool(p.get('adv_barrier_highland'))
        ws_hit=bool(p.get('adv_barrier_main_watershed'))
        minor_hit=bool(p.get('adv_barrier_minor_river')) and not nav_hit and positive_score<0.25

        wet_imp=1.0+1.8*wet_severity
        relief_imp=1.0+(1.85 if high_hit else 0.0)
        ws_imp=1.0+(1.15 if ws_hit else 0.0)
        minor_imp=1.25 if minor_hit else 1.0
        if positive_score>0.10:
            wet_imp=1.0+(wet_imp-1.0)*0.45
            relief_imp=1.0+(relief_imp-1.0)*0.62
            ws_imp=1.0+(ws_imp-1.0)*0.72
            minor_imp=1.0+(minor_imp-1.0)*0.55
        barrier_mult=round(wet_imp*relief_imp*ws_imp*minor_imp,4)
        positive_bonus=max(1.0,1.0+positive_score)
        final_imp=max(dist_km,1.0)/positive_bonus*barrier_mult
        final_strength=round(min(100.0,100.0*positive_bonus/(positive_bonus+final_imp)),4)

        blocked_reason=None
        if positive_score<0.10 and barrier_mult>=4.0 and final_strength<2.0:
            blocked_reason='high_component_impedance'
            final_strength=0.0
            final_imp=None
        blocked=blocked_reason is not None
        has_wet=wet_imp>1.12
        has_relief=relief_imp>1.12
        has_ws=ws_imp>1.12
        has_minor=minor_imp>1.04
        barrier_count=sum([has_wet,has_relief,has_ws,has_minor])
        if blocked:
            cls='blocked_high_impedance'
        elif corridor_count>=2:
            cls='mixed_corridor_impedance' if barrier_count else 'mixed_corridor'
        elif rail_hit:
            cls='rail_with_impedance' if barrier_count else 'rail_corridor'
        elif road_hit:
            cls='old_road_with_impedance' if barrier_count else 'old_road_corridor'
        elif nav_hit:
            cls='navigable_river_with_impedance' if barrier_count else 'navigable_river_corridor'
        elif barrier_count>=2:
            cls='normal_multiple_impedance'
        elif has_wet:
            cls='normal_wetland_impedance'
        elif has_relief:
            cls='normal_relief_impedance'
        elif has_ws:
            cls='normal_watershed_impedance'
        elif has_minor:
            cls='normal_minor_river_impedance'
        else:
            cls='normal_contact'
        counts[cls]=counts.get(cls,0)+1
        p.update({
          'year':year,'adv_source_id':sid,'adv_target_id':tid,
          'adv_edge_class':cls,'adv_edge_label':label_map.get(cls,cls),'adv_passable':not blocked,
          'adv_impedance':None if blocked else round(float(final_imp),4),'adv_strength':final_strength,'adv_distance_km':round(float(dist_km),3),
          'adv_corridor_rail':bool(rail_hit),'adv_corridor_old_road':bool(road_hit),'adv_corridor_navigable_river':bool(nav_hit),
          'adv_rail_score':round(float(rail_score),4),'adv_old_road_score':round(float(road_score),4),'adv_navigable_river_score':round(float(nav_score),4),
          'adv_positive_corridor_score':round(float(positive_score),4),'adv_positive_bonus':round(float(positive_bonus),4),
          'adv_corridor_profile':component_profile([('rail',rail_hit),('old_road',road_hit),('navigable_river',nav_hit)]),
          'adv_barrier_minor_river':bool(minor_hit),'adv_barrier_highland':bool(high_hit),'adv_barrier_main_watershed':bool(ws_hit),'adv_barrier_wetland':bool(wet_flag or has_wet),
          'adv_wetland_impedance':round(float(wet_imp),4),'adv_relief_impedance':round(float(relief_imp),4),'adv_watershed_impedance':round(float(ws_imp),4),'adv_minor_river_impedance':round(float(minor_imp),4),
          'adv_barrier_impedance_multiplier':round(float(barrier_mult),4),
          'adv_barrier_profile':component_profile([('wetland',has_wet),('relief',has_relief),('main_watershed',has_ws),('minor_river',has_minor)]),
          'adv_blocked_reason':blocked_reason,
          'adv_method':VERSION,'adv_model':'component_scores_v137'})
        edge_debug.append(p.copy())
        if sid and tid and not blocked:
            G.add_edge(sid,tid,weight=float(final_imp),strength=final_strength,edge_class=cls)

    comps=list(nx.connected_components(G)) if len(G) else []
    sorted_comps=sorted(comps,key=len,reverse=True)
    comp_id={n:i for i,c in enumerate(sorted_comps,1) for n in c}
    comp_size={n:len(c) for c in comps for n in c}
    deg=dict(G.degree())
    wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try:
        btw=nx.betweenness_centrality(G, k=min(80,len(G)), seed=42, weight='weight', normalized=True) if len(G)>160 else (nx.betweenness_centrality(G, weight='weight', normalized=True) if len(G)>1 else {n:0 for n in G.nodes})
    except Exception:
        btw={n:0 for n in G.nodes}
    try:
        close=nx.closeness_centrality(G, distance=None if len(G)>160 else 'weight') if len(G)>1 else {n:0 for n in G.nodes}
    except Exception:
        close={n:0 for n in G.nodes}
    try:
        kcore=nx.core_number(G) if len(G)>0 and G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception:
        kcore={n:0 for n in G.nodes}

    incident={n:{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0,'rail':0,'road':0,'river':0,'wetland_impedance':0,'relief_impedance':0,'watershed_impedance':0,'strength_sum':0.0,'impedance_sum':0.0,'impedance_count':0,'total_edges':0} for n in all_node_ids}
    for p in edge_debug:
        for n in [p.get('adv_source_id'),p.get('adv_target_id')]:
            if not n: continue
            incident.setdefault(n,{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0,'rail':0,'road':0,'river':0,'wetland_impedance':0,'relief_impedance':0,'watershed_impedance':0,'strength_sum':0.0,'impedance_sum':0.0,'impedance_count':0,'total_edges':0})
            incident[n]['total_edges']+=1
            if p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river'): incident[n]['corridor']+=1
            if (p.get('adv_barrier_impedance_multiplier') or 1)>1.12: incident[n]['barrier']+=1
            if p.get('adv_passable') is False: incident[n]['blocked']+=1
            if (p.get('adv_wetland_impedance') or 1)>1.12: incident[n]['wetland_impedance']+=1
            if (p.get('adv_relief_impedance') or 1)>1.12: incident[n]['relief_impedance']+=1
            if (p.get('adv_watershed_impedance') or 1)>1.12: incident[n]['watershed_impedance']+=1
            if p.get('adv_barrier_wetland'): incident[n]['wetland_blocked']+=1
            if p.get('adv_barrier_main_watershed'): incident[n]['watershed']+=1
            if p.get('adv_corridor_rail'): incident[n]['rail']+=1
            if p.get('adv_corridor_old_road'): incident[n]['road']+=1
            if p.get('adv_corridor_navigable_river'): incident[n]['river']+=1
            incident[n]['strength_sum']+=to_float(p.get('adv_strength'),0) or 0
            im=to_float(p.get('adv_impedance'),None)
            if im is not None:
                incident[n]['impedance_sum']+=im; incident[n]['impedance_count']+=1

    graph_nodes=len(G.nodes)
    graph_edges=G.number_of_edges()
    comps_count=nx.number_connected_components(G) if graph_nodes else 0
    density=nx.density(G) if graph_nodes>1 else 0
    corridor_total=sum(1 for p in edge_debug if p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river'))
    rail_total=sum(1 for p in edge_debug if p.get('adv_corridor_rail'))
    road_total=sum(1 for p in edge_debug if p.get('adv_corridor_old_road'))
    river_total=sum(1 for p in edge_debug if p.get('adv_corridor_navigable_river'))
    barrier_total=sum(1 for p in edge_debug if (p.get('adv_barrier_impedance_multiplier') or 1)>1.12)
    blocked_total=sum(1 for p in edge_debug if p.get('adv_passable') is False)
    wetland_imp_total=sum(1 for p in edge_debug if (p.get('adv_wetland_impedance') or 1)>1.12)
    relief_imp_total=sum(1 for p in edge_debug if (p.get('adv_relief_impedance') or 1)>1.12)
    watershed_imp_total=sum(1 for p in edge_debug if (p.get('adv_watershed_impedance') or 1)>1.12)
    strength_vals=[to_float(p.get('adv_strength'),None) for p in edge_debug if to_float(p.get('adv_strength'),None) is not None]
    impedance_vals=[to_float(p.get('adv_impedance'),None) for p in edge_debug if to_float(p.get('adv_impedance'),None) is not None]

    adv_by_unit={}
    for feat in node_fc.get('features',[]):
        p=feat.setdefault('properties',{})
        nid=str(p.get('unit_id') or p.get('topology_node_id') or p.get('node_id') or '')
        inc=incident.get(nid,{})
        avg_strength=(inc.get('strength_sum',0)/max(1,inc.get('total_edges',0)))
        avg_imp=(inc.get('impedance_sum',0)/max(1,inc.get('impedance_count',0)))
        adv={
          'adv_graph_method':VERSION,'adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),
          'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),
          'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),
          'adv_corridor_edges_incident':inc.get('corridor',0),'adv_barrier_edges_incident':inc.get('barrier',0),'adv_blocked_edges_incident':inc.get('blocked',0),
          'adv_wetland_blocked_edges_incident':inc.get('wetland_blocked',0),'adv_main_watershed_edges_incident':inc.get('watershed',0),
          'adv_rail_edges_incident':inc.get('rail',0),'adv_old_road_edges_incident':inc.get('road',0),'adv_navigable_river_edges_incident':inc.get('river',0),
          'adv_wetland_impedance_edges_incident':inc.get('wetland_impedance',0),'adv_relief_impedance_edges_incident':inc.get('relief_impedance',0),'adv_watershed_impedance_edges_incident':inc.get('watershed_impedance',0),
          'adv_avg_edge_strength_incident':round(float(avg_strength),4),'adv_avg_edge_impedance_incident':round(float(avg_imp),4),
          'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),
          'adv_graph_blocked_edges':blocked_total,'adv_graph_corridor_edges':corridor_total,'adv_graph_barrier_edges':barrier_total,
          'adv_graph_rail_edges':rail_total,'adv_graph_old_road_edges':road_total,'adv_graph_navigable_river_edges':river_total,
          'adv_graph_wetland_impedance_edges':wetland_imp_total,'adv_graph_relief_impedance_edges':relief_imp_total,'adv_graph_watershed_impedance_edges':watershed_imp_total}
        p.update(adv)
        adv_by_unit[nid]=adv

    # write updated layers
    with open(edge_path,'w',encoding='utf-8') as f:
        json.dump(edge_fc,f,ensure_ascii=False,separators=(',',':'),default=clean_value)
    with open(node_path,'w',encoding='utf-8') as f:
        json.dump(node_fc,f,ensure_ascii=False,separators=(',',':'),default=clean_value)

    if admin_path.exists():
        admin_fc=json.load(open(admin_path,encoding='utf-8'))
        for feat in admin_fc.get('features',[]):
            uid=str(feat.get('properties',{}).get('unit_id') or '')
            if uid in adv_by_unit:
                feat['properties'].update(adv_by_unit[uid])
        with open(admin_path,'w',encoding='utf-8') as f:
            json.dump(admin_fc,f,ensure_ascii=False,separators=(',',':'),default=clean_value)

    metrics.append({
      'year':year,'nodes':graph_nodes,'edges':graph_edges,'components':comps_count,'density':round(float(density),6),
      'corridor_edges':corridor_total,'rail_corridor_edges':rail_total,'old_road_corridor_edges':road_total,'navigable_river_corridor_edges':river_total,
      'barrier_edges':barrier_total,'wetland_impedance_edges':wetland_imp_total,'relief_impedance_edges':relief_imp_total,'watershed_impedance_edges':watershed_imp_total,
      'blocked_edges':blocked_total,'mixed_corridor_edges':counts.get('mixed_corridor',0)+counts.get('mixed_corridor_impedance',0),'normal_contact_edges':counts.get('normal_contact',0),
      'avg_degree':round(float(sum(deg.values())/len(deg)),6) if deg else 0,'avg_weighted_degree':round(float(sum(wdeg.values())/len(wdeg)),6) if wdeg else 0,
      'avg_betweenness':round(float(sum(btw.values())/len(btw)),6) if btw else 0,'avg_closeness':round(float(sum(close.values())/len(close)),6) if close else 0,
      'avg_edge_strength':round(float(sum(strength_vals)/len(strength_vals)),6) if strength_vals else 0,'avg_edge_impedance':round(float(sum(impedance_vals)/len(impedance_vals)),6) if impedance_vals else 0,
      'largest_component':max([len(c) for c in comps], default=0),
      **{f'class_{k}':counts.get(k,0) for k in label_map}
    })

(OUT/'connectivity_metrics_by_year.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
pd.DataFrame(metrics).to_csv(BASE/'v137_connectivity_metrics_by_year.csv',index=False)
print('done',len(metrics))
