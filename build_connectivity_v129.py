import json, math
from pathlib import Path
import geopandas as gpd
import pandas as pd
import networkx as nx
from shapely.geometry import LineString
from shapely.strtree import STRtree
from shapely.ops import unary_union

BASE=Path(__file__).resolve().parent
DATA=BASE/'data'
OUT=DATA/'connectivity'
OUT.mkdir(exist_ok=True)
(OUT/'edges').mkdir(exist_ok=True)
(OUT/'nodes').mkdir(exist_ok=True)
REF=OUT/'reference'
CRS_METRIC='EPSG:3576'

def read(path):
    g=gpd.read_file(path)
    if g.crs is None: g=g.set_crs(4326)
    return g.to_crs(CRS_METRIC)

def to_float(v, default=None):
    try:
        if v is None or pd.isna(v): return default
        return float(v)
    except Exception: return default

def clean_value(v):
    try:
        import numpy as np
        if isinstance(v, np.generic): return v.item()
        if isinstance(v, np.ndarray): return v.tolist()
    except Exception: pass
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
        if not isinstance(v,(list,dict,tuple,set)) and pd.isna(v): return None
    except Exception: pass
    if isinstance(v,(list,tuple,set)): return [clean_value(x) for x in v]
    if isinstance(v,dict): return {str(k):clean_value(x) for k,x in v.items()}
    return v

def clean_props(d): return {str(k):clean_value(v) for k,v in d.items()}

def geoms(gdf): return [g for g in gdf.geometry if g is not None and not g.is_empty]

class RefIndex:
    def __init__(self, geometries):
        self.geoms=list(geometries or [])
        self.tree=STRtree(self.geoms) if self.geoms else None
    def dwithin(self, geom, meters):
        if self.tree is None or geom is None or geom.is_empty: return False
        try:
            return len(self.tree.query(geom, predicate='dwithin', distance=meters))>0
        except Exception:
            # fallback bbox query + distance
            try: return any(geom.distance(self.geoms[i])<=meters for i in self.tree.query(geom))
            except Exception: return False
    def min_dist_km(self, geom):
        if self.tree is None or geom is None or geom.is_empty: return None
        try:
            idx=self.tree.nearest(geom)
            return geom.distance(self.geoms[int(idx)])/1000.0
        except Exception: return None

def active_siberian_tract(year, tract):
    if year>=1897: return tract.iloc[0:0].copy()
    df=tract.copy()
    start=pd.to_numeric(df.get('Year_начала_движ'), errors='coerce').fillna(pd.to_numeric(df.get('Year_начала_движения'), errors='coerce'))
    close=pd.to_numeric(df.get('Год_закрытия'), errors='coerce')
    return df[(start<=year) & (close.isna() | (year<=close))]

def active_tomsk_roads(year, roads):
    if year>=1897: return roads.iloc[0:0].copy()
    df=roads.copy(); start=pd.to_numeric(df.get('Year'), errors='coerce').fillna(1850)
    return df[(start<=year) & (year<1897)]

def active_rails(year, rails):
    if year<1897: return rails.iloc[0:0].copy()
    df=rails.copy(); start=pd.to_numeric(df.get('year_open'), errors='coerce').fillna(9999); close=pd.to_numeric(df.get('year_close'), errors='coerce')
    return df[(start<=year) & (close.isna() | (year<=close))]

def fid(row): return str(row.get('unit_id') or row.get('topology_node_id') or row.get('id') or row.get('OBJECTID') or '')
def line_between(a,b): return LineString([(a.x,a.y),(b.x,b.y)])

def union_or_none(gdf):
    try: return unary_union(geoms(gdf)) if len(gdf) else None
    except Exception: return None

print('Loading references...')
tract=read(REF/'siberian_tract.geojson')
tomsk=read(REF/'tomsk_roads_south.geojson')
nav=read(REF/'navigable_rivers.geojson')
high=read(REF/'elevation_over_400m.geojson')
rails=read(DATA/'railways/railways.geojson')
rivers=read(DATA/'hydro/rivers_full.geojson')
# high mask cleaned and split into individual polygons for STRtree; simplify to speed up
try:
    high_geom=high.geometry.iloc[0].buffer(0).simplify(2500, preserve_topology=True)
    high_list=list(high_geom.geoms) if hasattr(high_geom,'geoms') else [high_geom]
except Exception:
    high_list=geoms(high)
high_idx=RefIndex(high_list)
river_idx=RefIndex(geoms(rivers))
nav_idx_all=RefIndex(geoms(nav))

years=sorted(int(p.stem.split('_')[-1]) for p in (DATA/'topology').glob('topology_*.geojson') if 'nodes' not in p.stem and p.stem.split('_')[-1].isdigit())
method={
 'version':'v129',
 'name':'Эвристический граф потенциальной связности АТЕ',
 'base_graph':'Используются существующие рёбра смежности topology_YYYY.geojson; базовый топологический граф сохранён отдельно.',
 'corridors':{
  'navigable_rivers':'Судоходные реки как водные коридоры до 1876 г.; в 1897–1914 учитываются как слабый дополнительный коридор.',
  'siberian_tract':'Сибирский тракт используется только по активным участкам Year_начала_движ–Год_закрытия и только до 1897 г.',
  'tomsk_roads_south':'Дороги юга Томской губернии используются с 1850 г. до 1897 г.',
  'railways':'Железные дороги используются с 1897 г. по year_open/year_close.'},
 'barriers':{
  'highland':'Маска высот >400 м используется как сильный орографический барьер; при отсутствии транспортного коридора ребро снимается из advanced-графа.',
  'minor_rivers':'Несудоходные реки используются как слабый барьер, если рядом нет судоходного коридора.'},
 'distance_thresholds_km':{'rail_edge':15,'rail_connector':40,'old_road_edge':12,'old_road_connector':35,'navigable_edge':8,'navigable_connector':25,'minor_river_edge':1.5,'highland_edge':4,'highland_connector':12},
 'weights':'impedance = расстояние между узлами / бонус коридора * штраф барьера; заблокированные рёбра остаются в линейном слое, но исключаются из сетевых метрик.'}
(OUT/'connectivity_method_v129.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')
metrics=[]
label_map={
 'rail_corridor':'коридор: железная дорога','old_road_corridor':'коридор: Сибирский тракт / исторические дороги','navigable_river_corridor':'коридор: судоходная река','mixed_corridor':'смешанный транспортный коридор','normal_contact':'обычное соседство','minor_river_barrier':'барьер: несудоходная река','highland_barrier':'барьер: рельеф >400 м','blocked_highland':'ребро снято: рельеф >400 м без коридора'}
for year in years:
    print('year',year, flush=True)
    edge_path=DATA/'topology'/f'topology_{year}.geojson'; node_path=DATA/'topology'/f'topology_nodes_{year}.geojson'
    edges=gpd.read_file(edge_path); nodes=gpd.read_file(node_path)
    if edges.crs is None: edges=edges.set_crs(4326)
    if nodes.crs is None: nodes=nodes.set_crs(4326)
    edges_m=edges.to_crs(CRS_METRIC); nodes_m=nodes.to_crs(CRS_METRIC)
    node_geom={fid(r):r.geometry for _,r in nodes_m.iterrows()}
    rail_idx=RefIndex(geoms(active_rails(year, rails)))
    road_geoms=geoms(active_siberian_tract(year, tract))+geoms(active_tomsk_roads(year, tomsk))
    road_idx=RefIndex(road_geoms)
    nav_idx=nav_idx_all if year<=1914 else RefIndex([])
    G=nx.Graph()
    for _,n in nodes.iterrows():
        nid=fid(n)
        if nid: G.add_node(nid)
    counts={k:0 for k in label_map}
    edge_features=[]
    for idx,row_m in edges_m.iterrows():
        row=edges.iloc[idx]; p0=row.to_dict(); sid=str(p0.get('source_id') or ''); tid=str(p0.get('target_id') or '')
        if not sid or not tid: continue
        g=row_m.geometry; a=node_geom.get(sid); b=node_geom.get(tid); conn=line_between(a,b) if a is not None and b is not None else g
        dist_km=(conn.length/1000.0) if conn is not None else max(to_float(p0.get('boundary_km'),1),1)
        rail_hit=rail_idx.dwithin(g,15000) or rail_idx.dwithin(conn,40000)
        road_hit=road_idx.dwithin(g,12000) or road_idx.dwithin(conn,35000)
        nav_hit=nav_idx.dwithin(g,8000) or nav_idx.dwithin(conn,25000)
        if year>1876 and year<=1914: nav_hit=nav_hit and not rail_hit
        river_hit=river_idx.dwithin(g,1500)
        nav_near=nav_idx_all.dwithin(g,2500)
        minor_barrier=river_hit and not nav_near
        high_hit=high_idx.dwithin(g,4000) or high_idx.dwithin(conn,12000)
        corridor_count=sum([rail_hit,road_hit,nav_hit])
        blocked=bool(high_hit and corridor_count==0)
        impedance=max(dist_km,1.0)
        bonuses=[]
        if rail_hit: bonuses.append(3.0)
        if road_hit: bonuses.append(2.0)
        if nav_hit: bonuses.append(1.8 if year<=1876 else 1.25)
        if bonuses: impedance/=max(bonuses)
        if minor_barrier: impedance*=1.35
        if high_hit: impedance*=2.8
        if blocked: impedance=float('inf')
        strength=0.0 if blocked else round(100.0/(1.0+impedance),4)
        if blocked: cls='blocked_highland'
        elif corridor_count>=2: cls='mixed_corridor'
        elif rail_hit: cls='rail_corridor'
        elif road_hit: cls='old_road_corridor'
        elif nav_hit: cls='navigable_river_corridor'
        elif high_hit: cls='highland_barrier'
        elif minor_barrier: cls='minor_river_barrier'
        else: cls='normal_contact'
        counts[cls]=counts.get(cls,0)+1
        props=clean_props({k:v for k,v in p0.items() if k!='geometry'})
        props.update({'year':year,'adv_source_id':sid,'adv_target_id':tid,'adv_edge_class':cls,'adv_edge_label':label_map.get(cls,cls),'adv_passable':not blocked,'adv_impedance':None if blocked else round(float(impedance),4),'adv_strength':strength,'adv_distance_km':round(float(dist_km),3),'adv_corridor_rail':bool(rail_hit),'adv_corridor_old_road':bool(road_hit),'adv_corridor_navigable_river':bool(nav_hit),'adv_barrier_minor_river':bool(minor_barrier),'adv_barrier_highland':bool(high_hit),'adv_rail_distance_km':round(rail_idx.min_dist_km(g),3) if rail_idx.tree is not None and rail_hit else None,'adv_old_road_distance_km':round(road_idx.min_dist_km(g),3) if road_idx.tree is not None and road_hit else None,'adv_navigable_distance_km':round(nav_idx_all.min_dist_km(g),3) if nav_hit else None,'adv_method':'v129_heuristic_connectivity_corridors_barriers'})
        edge_features.append({'type':'Feature','geometry':row.geometry.__geo_interface__,'properties':props})
        if not blocked: G.add_edge(sid,tid,weight=float(impedance),strength=strength,edge_class=cls)
    comps=list(nx.connected_components(G)) if len(G) else []
    sorted_comps=sorted(comps,key=len,reverse=True)
    comp_id={n:i for i,c in enumerate(sorted_comps,1) for n in c}; comp_size={n:len(c) for c in comps for n in c}
    deg=dict(G.degree()); wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try: btw=nx.betweenness_centrality(G, weight='weight', normalized=True) if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: btw={n:0 for n in G.nodes}
    try: close=nx.closeness_centrality(G, distance='weight') if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: close={n:0 for n in G.nodes}
    try: kcore=nx.core_number(G) if len(G)>0 and G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception: kcore={n:0 for n in G.nodes}
    incident={n:{'corridor':0,'barrier':0,'blocked':0} for n in G.nodes}
    for f in edge_features:
        p=f['properties']; cls=p['adv_edge_class']
        for n in [p['adv_source_id'],p['adv_target_id']]:
            incident.setdefault(n,{'corridor':0,'barrier':0,'blocked':0})
            if 'corridor' in cls: incident[n]['corridor']+=1
            if 'barrier' in cls or cls.startswith('blocked'): incident[n]['barrier']+=1
            if cls.startswith('blocked'): incident[n]['blocked']+=1
    graph_nodes=len(G.nodes); graph_edges=G.number_of_edges(); comps_count=nx.number_connected_components(G) if graph_nodes else 0; density=nx.density(G) if graph_nodes>1 else 0
    node_features=[]
    for _,row in nodes.iterrows():
        p=clean_props({k:v for k,v in row.to_dict().items() if k!='geometry'}); nid=fid(row)
        p.update({'adv_graph_method':'v129_heuristic_connectivity_corridors_barriers','adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),'adv_corridor_edges_incident':incident.get(nid,{}).get('corridor',0),'adv_barrier_edges_incident':incident.get(nid,{}).get('barrier',0),'adv_blocked_edges_incident':incident.get(nid,{}).get('blocked',0),'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),'adv_graph_blocked_edges':counts.get('blocked_highland',0),'adv_graph_corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),'adv_graph_barrier_edges':counts.get('minor_river_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0)})
        node_features.append({'type':'Feature','geometry':row.geometry.__geo_interface__,'properties':p})
    (OUT/'edges'/f'connectivity_edges_{year}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':edge_features},ensure_ascii=False),encoding='utf-8')
    (OUT/'nodes'/f'connectivity_nodes_{year}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':node_features},ensure_ascii=False),encoding='utf-8')
    metrics.append({'year':year,'nodes':graph_nodes,'edges':graph_edges,'components':comps_count,'density':round(float(density),6),'blocked_edges':counts.get('blocked_highland',0),'corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),'barrier_edges':counts.get('minor_river_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0),'rail_corridor_edges':counts.get('rail_corridor',0),'old_road_corridor_edges':counts.get('old_road_corridor',0),'navigable_river_corridor_edges':counts.get('navigable_river_corridor',0),'mixed_corridor_edges':counts.get('mixed_corridor',0),'minor_river_barrier_edges':counts.get('minor_river_barrier',0),'highland_barrier_edges':counts.get('highland_barrier',0),'avg_degree':round(float(sum(deg.values())/len(deg)),6) if deg else 0,'avg_weighted_degree':round(float(sum(wdeg.values())/len(wdeg)),6) if wdeg else 0,'avg_betweenness':round(float(sum(btw.values())/len(btw)),6) if btw else 0,'avg_closeness':round(float(sum(close.values())/len(close)),6) if close else 0,'largest_component':max([len(c) for c in comps], default=0)})
(OUT/'connectivity_metrics_by_year.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
pd.DataFrame(metrics).to_csv('/mnt/data/v129_connectivity_metrics_by_year.csv',index=False)
print('done',len(metrics))
