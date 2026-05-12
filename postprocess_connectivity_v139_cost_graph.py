import json, math, csv
from pathlib import Path
import networkx as nx
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
from shapely.strtree import STRtree

BASE=Path(__file__).resolve().parent
DATA=BASE/'data'; OUT=DATA/'connectivity'
CRS_METRIC='EPSG:3576'; CRS_WGS='EPSG:4326'
VERSION='v139_cost_graph_component_impedance'

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

def to_float(v, default=None):
    try:
        if v is None: return default
        if isinstance(v,str) and v.strip() in ('','—','None','null','inf','Infinity'): return default
        x=float(v)
        if not math.isfinite(x): return default
        return x
    except Exception: return default

def clean(v):
    if isinstance(v,float) and (math.isnan(v) or math.isinf(v)): return None
    if isinstance(v,dict): return {str(k):clean(x) for k,x in v.items()}
    if isinstance(v,list): return [clean(x) for x in v]
    return v

def score_from_distance(dist_km, limit_km, max_score):
    d=to_float(dist_km, None)
    if d is None or d>limit_km: return 0.0
    return max_score*max(0.0, 1.0-d/limit_km)

def proxy_len_from_dist(dist_km, radius_km, edge_km=0.0):
    d=to_float(dist_km, None)
    if d is None or d>radius_km: return 0.0
    chord=2.0*math.sqrt(max(0.0, radius_km*radius_km-d*d))
    if d<=1.0: chord += min(max(0.0, to_float(edge_km,0) or 0), radius_km)
    return round(chord,3)

def length_factor(local_km, full_km, floor=0.38, cap=1.18):
    x=max(0.0, to_float(local_km,0) or 0)
    if x<=0: return floor
    return min(cap, floor+(1.0-floor)*math.sqrt(min(1.0, x/max(0.001,full_km))))

def component_profile(flags): return '+'.join([name for name, ok in flags if ok]) or 'none'

def geodf(path):
    g=gpd.read_file(path)
    if g.crs is None: g.set_crs(4326, inplace=True)
    return g.to_crs(CRS_METRIC)

class Index:
    def __init__(self, geoms):
        self.geoms=[g for g in geoms if g is not None and not g.is_empty]
        self.tree=STRtree(self.geoms) if self.geoms else None
    def nearest_dist_km(self, geom):
        if self.tree is None or geom is None or geom.is_empty: return None
        try:
            i=int(self.tree.nearest(geom)); return geom.distance(self.geoms[i])/1000.0
        except Exception: return None
    def dwithin(self, geom, meters):
        if self.tree is None or geom is None or geom.is_empty: return False
        try: return len(self.tree.query(geom, predicate='dwithin', distance=meters))>0
        except Exception: return False

print('v139 reference indices...')
rivers=geodf(DATA/'hydro/rivers_full.geojson')
mask=rivers.apply(lambda r: ('irtysh' in str(dict(r)).lower()) or ('иртыш' in str(dict(r)).lower()), axis=1)
irtysh_idx=Index([g for g in rivers.loc[mask].geometry])
# also persist enriched navigable reference for reproducibility
try:
    nav=geodf(OUT/'reference/navigable_rivers.geojson')
    extra=rivers.loc[mask].copy(); extra['v139_added_as_navigable']='Irtysh full course from rivers_full'
    # write in WGS84 to a separate file; do not disturb original layer schema
    pd.concat([nav, extra], ignore_index=True, sort=False).to_crs(4326).to_file(OUT/'reference/navigable_rivers_v139_with_irtysh.geojson', driver='GeoJSON')
except Exception as e:
    print('write enriched navigable reference failed:', e)
high=geodf(OUT/'reference/elevation_over_400m.geojson')
try:
    high['geometry']=high.geometry.buffer(0).simplify(2500, preserve_topology=True)
except Exception: pass
high_idx=Index([g for g in high.geometry])

def contact_point_metric(p, geom=None):
    lon=to_float(p.get('adv_contact_lon'), None); lat=to_float(p.get('adv_contact_lat'), None)
    if lon is None or lat is None:
        try:
            coords=geom.get('coordinates')
            if geom.get('type')=='LineString' and coords:
                mid=coords[len(coords)//2]; lon,lat=float(mid[0]),float(mid[1])
        except Exception: pass
    if lon is None or lat is None: return None, None, None
    try:
        gs=gpd.GeoSeries([Point(lon,lat)], crs=4326).to_crs(CRS_METRIC)
        return lon, lat, gs.iloc[0]
    except Exception:
        return lon, lat, None

method={
 'version':'v139',
 'name':'Стоимостной граф потенциальной связности АТЕ с компонентными коридорами и импедансами',
 'core':'Рёбра геометрической смежности рассматриваются как стоимостные переходы: ЖД, исторические дороги и судоходные реки снижают стоимость связи, болота, главный водораздел, рельеф и несудоходные реки повышают импеданс.',
 'v139_changes':['орографический барьер >400 м учитывается западнее 84° в.д. только севернее 50° с.ш., восточнее 84° в.д. — севернее 49° с.ш.;','все течение Иртыша из полного речного слоя добавлено как судоходная речная компонента;','панель фильтра рёбер получила числовой ввод силы и импеданса, а не только фиксированные категории.'],
 'formula':'positive_bonus = 1 + rail_score + old_road_score + navigable_river_score; impedance = distance_km / positive_bonus × wetland_impedance × relief_impedance × watershed_impedance × minor_river_impedance; strength = 100 × positive_bonus / (positive_bonus + impedance).'
}
for name in ['connectivity_method_v139.json','connectivity_method_v138.json','connectivity_method_v137.json','connectivity_method_v135.json','connectivity_method_v129.json']:
    (OUT/name).write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')

years=sorted(int(p.stem.split('_')[-1]) for p in (OUT/'edges').glob('connectivity_edges_*.geojson'))
metrics=[]
for year in years:
    print('year',year, flush=True)
    edge_path=OUT/'edges'/f'connectivity_edges_{year}.geojson'; node_path=OUT/'nodes'/f'connectivity_nodes_{year}.geojson'; admin_path=DATA/'admin'/f'admin_{year}.geojson'
    edge_fc=json.load(open(edge_path,encoding='utf-8')); node_fc=json.load(open(node_path,encoding='utf-8'))
    G=nx.Graph(); node_ids=[]
    for feat in node_fc.get('features',[]):
        p=feat.setdefault('properties',{}); nid=str(p.get('unit_id') or p.get('topology_node_id') or p.get('node_id') or '')
        if nid: G.add_node(nid); node_ids.append(nid)
    edge_debug=[]; counts={k:0 for k in label_map}
    for feat in edge_fc.get('features',[]):
        p=feat.setdefault('properties',{}); sid=str(p.get('adv_source_id') or p.get('source_id') or ''); tid=str(p.get('adv_target_id') or p.get('target_id') or '')
        dist=max(1.0, to_float(p.get('adv_distance_km'), to_float(p.get('distance_km'),1)) or 1.0)
        edge_km=max(0.0, to_float(p.get('adv_contact_local_km'), to_float(p.get('boundary_km'),dist)) or dist)
        lon,lat,pt=contact_point_metric(p, feat.get('geometry'))
        # v139: all Irtysh as navigable corridor evidence.
        irtysh_dist=irtysh_idx.nearest_dist_km(pt) if pt is not None else None
        nav_dist_old=to_float(p.get('adv_navigable_distance_km'), None)
        if irtysh_dist is not None and (nav_dist_old is None or irtysh_dist < nav_dist_old):
            p['adv_navigable_distance_km_before_v139']=nav_dist_old
            p['adv_navigable_distance_km']=round(float(irtysh_dist),3)
            p['adv_v139_irtysh_added']=True
        else:
            p['adv_v139_irtysh_added']=False
        nav_max=2.2 if year<=1876 else (1.6 if year<=1914 else 0.9)
        rail_raw=score_from_distance(p.get('adv_rail_distance_km'),18,3.2)
        road_raw=score_from_distance(p.get('adv_old_road_distance_km'),25,2.2)
        nav_raw=score_from_distance(p.get('adv_navigable_distance_km'),25,nav_max)
        rail_local=max(to_float(p.get('adv_rail_local_km'),0) or 0, proxy_len_from_dist(p.get('adv_rail_distance_km'),18,edge_km))
        road_local=max(to_float(p.get('adv_old_road_local_km'),0) or 0, proxy_len_from_dist(p.get('adv_old_road_distance_km'),25,edge_km))
        nav_local=max(to_float(p.get('adv_navigable_river_local_km'),0) or 0, proxy_len_from_dist(p.get('adv_navigable_distance_km'),25,edge_km))
        rail_score=round(rail_raw*length_factor(rail_local,14,0.42,1.18),4)
        road_score=round(road_raw*length_factor(road_local,18,0.40,1.15),4)
        nav_score=round(nav_raw*length_factor(nav_local,22,0.38,1.18),4)
        rail_hit=rail_score>=0.18 and rail_local>=0.75
        road_hit=road_score>=0.14 and road_local>=0.75
        nav_hit=nav_score>=0.12 and nav_local>=1.0
        pos_score=round(rail_score+road_score+nav_score,4); corridor_count=sum([rail_hit,road_hit,nav_hit])
        wet_frac=max(0.0,min(1.0,to_float(p.get('adv_wetland_overlap_frac'),0) or 0)); wet_centroid=bool(p.get('adv_wetland_centroid_hit')); wet_flag=bool(p.get('adv_barrier_wetland'))
        wet_severity=max(wet_frac,1.0 if wet_centroid else (0.75 if wet_flag else 0.0))
        # v139 relief gate: W 84E / 50N, E 84E / 49N
        relief_threshold=49.0 if (lon is not None and lon>=84.0) else 50.0
        relief_allowed=bool(lat is not None and lat>=relief_threshold)
        high_now=bool(relief_allowed and pt is not None and high_idx.dwithin(pt,3000))
        relief_flag=high_now or (bool(p.get('adv_barrier_highland')) and relief_allowed)
        ws_flag=bool(p.get('adv_barrier_main_watershed'))
        minor_flag=bool(p.get('adv_barrier_minor_river')) and not nav_hit and pos_score<0.25
        relief_len=round(min(edge_km, max(8.0, to_float(p.get('adv_relief_barrier_km'),0) or 0)) if relief_flag else 0.0,3)
        ws_len=round(min(edge_km, max(8.0, to_float(p.get('adv_main_watershed_barrier_km'),0) or 0)) if ws_flag else 0.0,3)
        minor_len=round(min(edge_km, max(5.0, to_float(p.get('adv_minor_river_local_km'),0) or 0)) if minor_flag else 0.0,3)
        relief_sev=min(1.0, relief_len/max(1.0,min(edge_km,8.0))) if relief_flag else 0.0
        ws_sev=min(1.0, ws_len/max(1.0,min(edge_km,8.0))) if ws_flag else 0.0
        minor_sev=min(1.0, minor_len/max(1.0,min(edge_km,5.0))) if minor_flag else 0.0
        wet_imp=1+1.8*wet_severity; relief_imp=1+1.85*relief_sev; ws_imp=1+1.15*ws_sev; minor_imp=1+0.25*minor_sev if minor_flag else 1.0
        if pos_score>0.10:
            wet_imp=1+(wet_imp-1)*0.45; relief_imp=1+(relief_imp-1)*0.62; ws_imp=1+(ws_imp-1)*0.72; minor_imp=1+(minor_imp-1)*0.55
        barrier_mult=round(wet_imp*relief_imp*ws_imp*minor_imp,4); positive_bonus=max(1.0,1+pos_score)
        impedance=dist/positive_bonus*barrier_mult; strength=round(min(100,100*positive_bonus/(positive_bonus+impedance)),4)
        blocked_reason=None
        if pos_score<0.10 and barrier_mult>=4.0 and strength<2.0:
            blocked_reason='high_component_impedance'; strength=0.0; impedance=None
        has_wet=wet_imp>1.12; has_relief=relief_imp>1.12; has_ws=ws_imp>1.12; has_minor=minor_imp>1.04
        barrier_count=sum([has_wet,has_relief,has_ws,has_minor])
        if blocked_reason: cls='blocked_high_impedance'
        elif corridor_count>=2: cls='mixed_corridor_impedance' if barrier_count else 'mixed_corridor'
        elif rail_hit: cls='rail_with_impedance' if barrier_count else 'rail_corridor'
        elif road_hit: cls='old_road_with_impedance' if barrier_count else 'old_road_corridor'
        elif nav_hit: cls='navigable_river_with_impedance' if barrier_count else 'navigable_river_corridor'
        elif barrier_count>=2: cls='normal_multiple_impedance'
        elif has_wet: cls='normal_wetland_impedance'
        elif has_relief: cls='normal_relief_impedance'
        elif has_ws: cls='normal_watershed_impedance'
        elif has_minor: cls='normal_minor_river_impedance'
        else: cls='normal_contact'
        counts[cls]=counts.get(cls,0)+1
        p.update({
            'year':year,'adv_source_id':sid,'adv_target_id':tid,'adv_edge_class':cls,'adv_edge_label':label_map.get(cls,cls),'adv_passable':blocked_reason is None,
            'adv_impedance':None if impedance is None else round(float(impedance),4),'adv_strength':strength,'adv_distance_km':round(float(dist),3),
            'adv_corridor_rail':bool(rail_hit),'adv_corridor_old_road':bool(road_hit),'adv_corridor_navigable_river':bool(nav_hit),
            'adv_rail_score_raw':round(float(rail_raw),4),'adv_old_road_score_raw':round(float(road_raw),4),'adv_navigable_river_score_raw':round(float(nav_raw),4),
            'adv_rail_score':round(float(rail_score),4),'adv_old_road_score':round(float(road_score),4),'adv_navigable_river_score':round(float(nav_score),4),
            'adv_rail_local_km':round(float(rail_local),3),'adv_old_road_local_km':round(float(road_local),3),'adv_navigable_river_local_km':round(float(nav_local),3),
            'adv_positive_corridor_score':round(float(pos_score),4),'adv_positive_bonus':round(float(positive_bonus),4),'adv_corridor_profile':component_profile([('rail',rail_hit),('old_road',road_hit),('navigable_river',nav_hit)]),
            'adv_barrier_minor_river':bool(minor_flag),'adv_barrier_highland':bool(relief_flag),'adv_barrier_main_watershed':bool(ws_flag),'adv_barrier_wetland':bool(wet_flag),
            'adv_v139_relief_threshold_lat':relief_threshold,'adv_v139_relief_allowed':relief_allowed,
            'adv_relief_barrier_km':round(float(relief_len),3),'adv_main_watershed_barrier_km':round(float(ws_len),3),'adv_minor_river_local_km':round(float(minor_len),3),
            'adv_relief_severity':round(float(relief_sev),4),'adv_watershed_severity':round(float(ws_sev),4),'adv_minor_river_severity':round(float(minor_sev),4),
            'adv_wetland_impedance':round(float(wet_imp),4),'adv_relief_impedance':round(float(relief_imp),4),'adv_watershed_impedance':round(float(ws_imp),4),'adv_minor_river_impedance':round(float(minor_imp),4),'adv_barrier_impedance_multiplier':round(float(barrier_mult),4),
            'adv_barrier_profile':component_profile([('wetland',has_wet),('relief',has_relief),('main_watershed',has_ws),('minor_river',has_minor)]),'adv_blocked_reason':blocked_reason,
            'adv_method':VERSION,'adv_model':'cost_graph_component_scores_v139_length_weighted'
        })
        edge_debug.append(p.copy())
        if sid and tid and blocked_reason is None:
            G.add_edge(sid,tid,weight=float(impedance),strength=strength,edge_class=cls)
    comps=list(nx.connected_components(G)) if len(G) else []
    comp_id={n:i for i,c in enumerate(sorted(comps,key=len,reverse=True),1) for n in c}; comp_size={n:len(c) for c in comps for n in c}
    deg=dict(G.degree()); wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try: btw=nx.betweenness_centrality(G,k=min(80,len(G)),seed=42,weight='weight',normalized=True) if len(G)>160 else nx.betweenness_centrality(G,weight='weight',normalized=True) if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: btw={n:0 for n in G.nodes}
    try: close=nx.closeness_centrality(G,distance=None if len(G)>160 else 'weight') if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: close={n:0 for n in G.nodes}
    try: kcore=nx.core_number(G) if G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception: kcore={n:0 for n in G.nodes}
    def new_inc(): return {'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0,'rail':0,'road':0,'river':0,'wetland_impedance':0,'relief_impedance':0,'watershed_impedance':0,'strength_sum':0.0,'impedance_sum':0.0,'impedance_count':0,'rail_local_km':0.0,'old_road_local_km':0.0,'navigable_river_local_km':0.0,'relief_barrier_km':0.0,'main_watershed_barrier_km':0.0}
    incident={n:new_inc() for n in node_ids}
    for p in edge_debug:
        for n in [p.get('adv_source_id'),p.get('adv_target_id')]:
            if not n: continue
            inc=incident.setdefault(n,new_inc())
            has_corr=bool(p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river'))
            has_bar=bool((p.get('adv_barrier_impedance_multiplier') or 1)>1.12)
            if has_corr: inc['corridor']+=1
            if has_bar or p.get('adv_edge_class','').startswith('blocked'): inc['barrier']+=1
            if p.get('adv_passable') is False: inc['blocked']+=1
            if p.get('adv_barrier_wetland'): inc['wetland_blocked']+=1
            if p.get('adv_barrier_main_watershed'): inc['watershed']+=1
            if p.get('adv_corridor_rail'): inc['rail']+=1
            if p.get('adv_corridor_old_road'): inc['road']+=1
            if p.get('adv_corridor_navigable_river'): inc['river']+=1
            if (p.get('adv_wetland_impedance') or 1)>1.12: inc['wetland_impedance']+=1
            if (p.get('adv_relief_impedance') or 1)>1.12: inc['relief_impedance']+=1
            if (p.get('adv_watershed_impedance') or 1)>1.12: inc['watershed_impedance']+=1
            inc['rail_local_km']+=to_float(p.get('adv_rail_local_km'),0) or 0; inc['old_road_local_km']+=to_float(p.get('adv_old_road_local_km'),0) or 0; inc['navigable_river_local_km']+=to_float(p.get('adv_navigable_river_local_km'),0) or 0
            inc['relief_barrier_km']+=to_float(p.get('adv_relief_barrier_km'),0) or 0; inc['main_watershed_barrier_km']+=to_float(p.get('adv_main_watershed_barrier_km'),0) or 0
            inc['strength_sum']+=to_float(p.get('adv_strength'),0) or 0; im=to_float(p.get('adv_impedance'),None)
            if im is not None: inc['impedance_sum']+=im; inc['impedance_count']+=1
    graph_nodes=len(G.nodes); graph_edges=G.number_of_edges(); density=nx.density(G) if graph_nodes>1 else 0; comps_count=nx.number_connected_components(G) if graph_nodes else 0
    adv_by_unit={}
    for feat in node_fc.get('features',[]):
        p=feat.setdefault('properties',{}); nid=str(p.get('unit_id') or p.get('topology_node_id') or p.get('node_id') or '')
        inc=incident.get(nid,new_inc())
        degree=max(1,int(deg.get(nid,0)))
        adv={'adv_graph_method':VERSION,'adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),'adv_corridor_edges_incident':inc['corridor'],'adv_barrier_edges_incident':inc['barrier'],'adv_blocked_edges_incident':inc['blocked'],'adv_wetland_blocked_edges_incident':inc['wetland_blocked'],'adv_main_watershed_edges_incident':inc['watershed'],'adv_rail_edges_incident':inc['rail'],'adv_old_road_edges_incident':inc['road'],'adv_navigable_river_edges_incident':inc['river'],'adv_rail_local_km_incident':round(inc['rail_local_km'],3),'adv_old_road_local_km_incident':round(inc['old_road_local_km'],3),'adv_navigable_river_local_km_incident':round(inc['navigable_river_local_km'],3),'adv_relief_barrier_km_incident':round(inc['relief_barrier_km'],3),'adv_main_watershed_barrier_km_incident':round(inc['main_watershed_barrier_km'],3),'adv_wetland_impedance_edges_incident':inc['wetland_impedance'],'adv_relief_impedance_edges_incident':inc['relief_impedance'],'adv_watershed_impedance_edges_incident':inc['watershed_impedance'],'adv_avg_edge_strength_incident':round(inc['strength_sum']/degree,4),'adv_avg_edge_impedance_incident':round(inc['impedance_sum']/max(1,inc['impedance_count']),4),'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),'adv_graph_blocked_edges':sum(1 for p in edge_debug if p.get('adv_passable') is False),'adv_graph_corridor_edges':sum(1 for p in edge_debug if p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river')),'adv_graph_barrier_edges':sum(1 for p in edge_debug if (p.get('adv_barrier_impedance_multiplier') or 1)>1.12),'adv_graph_rail_edges':sum(1 for p in edge_debug if p.get('adv_corridor_rail')),'adv_graph_old_road_edges':sum(1 for p in edge_debug if p.get('adv_corridor_old_road')),'adv_graph_navigable_river_edges':sum(1 for p in edge_debug if p.get('adv_corridor_navigable_river')),'adv_graph_wetland_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_wetland_impedance') or 1)>1.12),'adv_graph_relief_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_relief_impedance') or 1)>1.12),'adv_graph_watershed_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_watershed_impedance') or 1)>1.12)}
        p.update(adv); adv_by_unit[nid]=adv
    json.dump(clean(edge_fc),open(edge_path,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    json.dump(clean(node_fc),open(node_path,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    admin_fc=json.load(open(admin_path,encoding='utf-8'))
    for feat in admin_fc.get('features',[]):
        uid=str(feat.get('properties',{}).get('unit_id') or '')
        if uid in adv_by_unit: feat['properties'].update(adv_by_unit[uid])
    json.dump(clean(admin_fc),open(admin_path,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    metrics.append({'year':year,'nodes':graph_nodes,'edges':graph_edges,'components':comps_count,'density':round(float(density),6),'blocked_edges':sum(1 for p in edge_debug if p.get('adv_passable') is False),'corridor_edges':sum(1 for p in edge_debug if p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river')),'barrier_edges':sum(1 for p in edge_debug if (p.get('adv_barrier_impedance_multiplier') or 1)>1.12),'rail_corridor_edges':sum(1 for p in edge_debug if p.get('adv_corridor_rail')),'old_road_corridor_edges':sum(1 for p in edge_debug if p.get('adv_corridor_old_road')),'navigable_river_corridor_edges':sum(1 for p in edge_debug if p.get('adv_corridor_navigable_river')),'rail_local_km':round(sum(to_float(p.get('adv_rail_local_km'),0) or 0 for p in edge_debug),3),'old_road_local_km':round(sum(to_float(p.get('adv_old_road_local_km'),0) or 0 for p in edge_debug),3),'navigable_river_local_km':round(sum(to_float(p.get('adv_navigable_river_local_km'),0) or 0 for p in edge_debug),3),'relief_barrier_km':round(sum(to_float(p.get('adv_relief_barrier_km'),0) or 0 for p in edge_debug),3),'main_watershed_barrier_km':round(sum(to_float(p.get('adv_main_watershed_barrier_km'),0) or 0 for p in edge_debug),3),'wetland_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_wetland_impedance') or 1)>1.12),'relief_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_relief_impedance') or 1)>1.12),'watershed_impedance_edges':sum(1 for p in edge_debug if (p.get('adv_watershed_impedance') or 1)>1.12),'mixed_corridor_edges':counts.get('mixed_corridor',0)+counts.get('mixed_corridor_impedance',0),'normal_contact_edges':counts.get('normal_contact',0),'avg_edge_strength':round(sum(to_float(p.get('adv_strength'),0) or 0 for p in edge_debug)/max(1,len(edge_debug)),6),'avg_edge_impedance':round(sum(to_float(p.get('adv_impedance'),0) or 0 for p in edge_debug if to_float(p.get('adv_impedance'),None) is not None)/max(1,sum(1 for p in edge_debug if to_float(p.get('adv_impedance'),None) is not None)),6),'avg_degree':round(sum(dict(G.degree()).values())/max(1,graph_nodes),4),'avg_weighted_degree':round(sum(wdeg.values())/max(1,len(wdeg)),6),'avg_betweenness':round(sum(btw.values())/max(1,len(btw)),6),'avg_closeness':round(sum(close.values())/max(1,len(close)),6),'largest_component':max([len(c) for c in comps], default=0)})

json.dump(clean(metrics),open(OUT/'connectivity_metrics_by_year.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
with open(BASE/'v139_connectivity_metrics_by_year.csv','w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(metrics[0].keys())); w.writeheader(); w.writerows(metrics)
print('done', VERSION, len(metrics))
