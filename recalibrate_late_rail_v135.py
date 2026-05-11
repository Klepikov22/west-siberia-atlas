import json, math
from pathlib import Path
import geopandas as gpd
import networkx as nx
BASE=Path(__file__).resolve().parent; DATA=BASE/'data'; OUT=DATA/'connectivity'; CRS='EPSG:3576'
YEARS=[1939,1947,1959,1964,1970,1979,1989,2021]
rails=gpd.read_file(DATA/'railways/railways.geojson')
if rails.crs is None: rails.set_crs(4326, inplace=True)
rails=rails.to_crs(CRS)
def active_rails(year):
    import pandas as pd
    df=rails.copy(); start=pd.to_numeric(df.get('year_open'), errors='coerce').fillna(9999); close=pd.to_numeric(df.get('year_close'), errors='coerce')
    return df[(start<=year) & (close.isna() | (year<=close))]
class RefIndex:
    def __init__(self, gdf):
        self.geoms=[g for g in gdf.geometry if g is not None and not g.is_empty]
        from shapely.strtree import STRtree
        self.tree=STRtree(self.geoms) if self.geoms else None
    def dwithin(self, geom, meters):
        if self.tree is None or geom is None or geom.is_empty: return False
        try: return len(self.tree.query(geom, predicate='dwithin', distance=meters))>0
        except Exception: return False
    def dist(self, geom):
        if self.tree is None: return None
        try:
            i=self.tree.nearest(geom); return geom.distance(self.geoms[int(i)])/1000
        except Exception: return None

def fid(row): return str(row.get('unit_id') or row.get('topology_node_id') or row.get('id') or '')
for year in YEARS:
    ep=OUT/'edges'/f'connectivity_edges_{year}.geojson'; np=OUT/'nodes'/f'connectivity_nodes_{year}.geojson'; ap=DATA/'admin'/f'admin_{year}.geojson'
    e_fc=json.load(open(ep,encoding='utf-8')); n_fc=json.load(open(np,encoding='utf-8'))
    eg=gpd.GeoDataFrame.from_features(e_fc['features'], crs=4326).to_crs(CRS)
    ridx=RefIndex(active_rails(year))
    G=nx.Graph()
    for f in n_fc['features']:
        nid=str(f['properties'].get('unit_id') or f['properties'].get('topology_node_id') or '')
        if nid: G.add_node(nid)
    counts={}
    for i,f in enumerate(e_fc['features']):
        p=f['properties']; geom=eg.geometry.iloc[i]
        rail_hit=ridx.dwithin(geom,5000)
        if rail_hit:
            p['adv_corridor_rail']=True; p['adv_rail_distance_km']=round(ridx.dist(geom),3) if ridx.dist(geom) is not None else 0
            p['adv_edge_class']='rail_corridor'; p['adv_edge_label']='коридор: железная дорога'; p['adv_passable']=True; p['adv_blocked_reason']=None
            dist=float(p.get('adv_distance_km') or max(geom.length/1000,1))
            imp=max(dist,1)/3.0
            if p.get('adv_barrier_highland'): imp*=1.15
            if p.get('adv_barrier_wetland'): imp*=1.05
            p['adv_impedance']=round(imp,4); p['adv_strength']=round(100/(1+imp),4)
            p['adv_method']='v135_corridor_priority_connectivity_late_rail_overlay'
        else:
            p['adv_method']=p.get('adv_method') or 'v135_corridor_priority_connectivity'
        cls=p.get('adv_edge_class','normal_contact'); counts[cls]=counts.get(cls,0)+1
        if p.get('adv_passable',True) is not False:
            sid=str(p.get('adv_source_id') or p.get('source_id') or ''); tid=str(p.get('adv_target_id') or p.get('target_id') or '')
            if sid and tid: G.add_edge(sid,tid,weight=float(p.get('adv_impedance') or 1),strength=float(p.get('adv_strength') or 0),edge_class=cls)
    # metrics
    deg=dict(G.degree()); wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try: btw=nx.betweenness_centrality(G, k=min(80,len(G)), seed=42, weight='weight', normalized=True) if len(G)>160 else nx.betweenness_centrality(G, weight='weight', normalized=True)
    except Exception: btw={n:0 for n in G.nodes}
    try: close=nx.closeness_centrality(G, distance=None if len(G)>160 else 'weight')
    except Exception: close={n:0 for n in G.nodes}
    try: kcore=nx.core_number(G) if G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception: kcore={n:0 for n in G.nodes}
    comps=list(nx.connected_components(G)) if len(G) else []
    comp_id={n:i for i,c in enumerate(sorted(comps,key=len,reverse=True),1) for n in c}; comp_size={n:len(c) for c in comps for n in c}
    incident={}
    for p in [f['properties'] for f in e_fc['features']]:
        cls=p.get('adv_edge_class','normal_contact')
        for n in [str(p.get('adv_source_id') or p.get('source_id') or ''), str(p.get('adv_target_id') or p.get('target_id') or '')]:
            if not n: continue
            incident.setdefault(n,{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0})
            if 'corridor' in cls: incident[n]['corridor']+=1
            if 'barrier' in cls or cls.startswith('blocked'): incident[n]['barrier']+=1
            if cls.startswith('blocked'): incident[n]['blocked']+=1
            if cls=='blocked_wetland': incident[n]['wetland_blocked']+=1
            if cls=='main_watershed_barrier' or p.get('adv_barrier_main_watershed'): incident[n]['watershed']+=1
    adv_by={}
    for f in n_fc['features']:
        p=f['properties']; nid=str(p.get('unit_id') or p.get('topology_node_id') or '')
        adv={
          'adv_graph_method':'v135_corridor_priority_connectivity','adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),
          'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),
          'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),
          'adv_corridor_edges_incident':incident.get(nid,{}).get('corridor',0),'adv_barrier_edges_incident':incident.get(nid,{}).get('barrier',0),
          'adv_blocked_edges_incident':incident.get(nid,{}).get('blocked',0),'adv_wetland_blocked_edges_incident':incident.get(nid,{}).get('wetland_blocked',0),
          'adv_main_watershed_edges_incident':incident.get(nid,{}).get('watershed',0),
          'adv_graph_nodes':len(G.nodes),'adv_graph_edges':G.number_of_edges(),'adv_graph_components':nx.number_connected_components(G) if len(G) else 0,'adv_graph_density':round(float(nx.density(G)),6) if len(G)>1 else 0,
          'adv_graph_blocked_edges':counts.get('blocked_highland',0)+counts.get('blocked_wetland',0),
          'adv_graph_corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),
          'adv_graph_barrier_edges':counts.get('minor_river_barrier',0)+counts.get('main_watershed_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0)+counts.get('blocked_wetland',0)
        }
        p.update(adv); adv_by[nid]=adv
    json.dump(e_fc, open(ep,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    json.dump(n_fc, open(np,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    admin=json.load(open(ap,encoding='utf-8'))
    for f in admin['features']:
        uid=str(f.get('properties',{}).get('unit_id') or '')
        if uid in adv_by: f['properties'].update(adv_by[uid])
    json.dump(admin, open(ap,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    print(year, counts.get('rail_corridor',0), 'rail corridors')
