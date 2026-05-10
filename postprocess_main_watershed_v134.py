import json, os, glob, math
from pathlib import Path
import geopandas as gpd
from shapely.geometry import Point
from shapely.strtree import STRtree
import networkx as nx

BASE=Path('.')
CRS_METRIC='EPSG:3576'
oro=gpd.read_file('data/natural_boundaries/reference/orography_clipped1.json')
if oro.crs is None: oro=oro.set_crs(4326)
oro=oro.to_crs(CRS_METRIC)
oro['geometry']=oro.geometry.buffer(0)
geoms=list(oro.geometry)
mainbas=[str(x) for x in oro['MAIN_BAS'].tolist()]
tree=STRtree(geoms)

def nearby_mainbas(lon,lat,dist=3000):
    if lon is None or lat is None: return set()
    try:
        pt=gpd.GeoSeries([Point(float(lon),float(lat))], crs=4326).to_crs(CRS_METRIC).iloc[0]
        idxs=tree.query(pt.buffer(dist), predicate='intersects')
        return {mainbas[int(i)] for i in idxs}
    except Exception:
        return set()

def clean(v):
    try:
        if isinstance(v,float) and (math.isnan(v) or math.isinf(v)): return None
    except Exception: pass
    return v

def recompute_year(y):
    ep=Path(f'data/connectivity/edges/connectivity_edges_{y}.geojson')
    np=Path(f'data/connectivity/nodes/connectivity_nodes_{y}.geojson')
    ap=Path(f'data/admin/admin_{y}.geojson')
    edges=json.load(open(ep,encoding='utf-8'))
    nodes=json.load(open(np,encoding='utf-8'))
    changed=0
    for f in edges['features']:
        p=f['properties']
        mb=nearby_mainbas(p.get('adv_contact_lon'), p.get('adv_contact_lat'))
        hit=len(mb)>=2
        p['adv_barrier_main_watershed']=bool(hit)
        p['adv_main_watershed_mainbas_count']=len(mb)
        if hit and p.get('adv_edge_class') not in ('rail_corridor','old_road_corridor','navigable_river_corridor','mixed_corridor','blocked_wetland','blocked_highland','highland_barrier'):
            old=p.get('adv_edge_class')
            p['adv_edge_class']='main_watershed_barrier'
            p['adv_edge_label']='барьер: главный водораздел'
            if p.get('adv_passable') is not False and p.get('adv_impedance') is not None:
                try:
                    imp=float(p['adv_impedance'])*1.45
                    p['adv_impedance']=round(imp,4)
                    p['adv_strength']=round(100/(1+imp),4)
                except Exception: pass
            changed+=1
    json.dump(edges, open(ep,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    G=nx.Graph()
    for n in nodes['features']:
        nid=str(n['properties'].get('unit_id') or n['properties'].get('topology_node_id') or '')
        if nid: G.add_node(nid)
    counts={}
    incident={}
    for f in edges['features']:
        p=f['properties']; cls=p.get('adv_edge_class','normal_contact')
        counts[cls]=counts.get(cls,0)+1
        sid=str(p.get('adv_source_id') or p.get('source_id') or ''); tid=str(p.get('adv_target_id') or p.get('target_id') or '')
        for nid in [sid,tid]:
            incident.setdefault(nid, {'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0})
            if 'corridor' in cls: incident[nid]['corridor']+=1
            if 'barrier' in cls or cls.startswith('blocked'): incident[nid]['barrier']+=1
            if cls.startswith('blocked'): incident[nid]['blocked']+=1
            if cls=='blocked_wetland': incident[nid]['wetland_blocked']+=1
            if p.get('adv_barrier_main_watershed'): incident[nid]['watershed']+=1
        if p.get('adv_passable') is not False and sid and tid:
            try: imp=float(p.get('adv_impedance') or 1)
            except Exception: imp=1.0
            G.add_edge(sid,tid,weight=imp,strength=float(p.get('adv_strength') or 0),edge_class=cls)
    comps=list(nx.connected_components(G)) if len(G) else []
    comp_id={n:i for i,c in enumerate(sorted(comps,key=len,reverse=True),1) for n in c}; comp_size={n:len(c) for c in comps for n in c}
    deg=dict(G.degree()); wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try:
        if len(G)>160: btw=nx.betweenness_centrality(G,k=min(80,len(G)),seed=42,weight='weight',normalized=True)
        else: btw=nx.betweenness_centrality(G, weight='weight', normalized=True) if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: btw={n:0 for n in G.nodes}
    try: close=nx.closeness_centrality(G, distance=None if len(G)>160 else 'weight') if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: close={n:0 for n in G.nodes}
    try: kcore=nx.core_number(G) if len(G)>0 and G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception: kcore={n:0 for n in G.nodes}
    graph_nodes=len(G.nodes); graph_edges=G.number_of_edges(); comps_count=nx.number_connected_components(G) if graph_nodes else 0; density=nx.density(G) if graph_nodes>1 else 0
    adv_by={}
    for nf in nodes['features']:
        p=nf['properties']; nid=str(p.get('unit_id') or p.get('topology_node_id') or '')
        inc=incident.get(nid,{})
        adv={
          'adv_graph_method':'v134_local_contact_connectivity','adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),'adv_corridor_edges_incident':inc.get('corridor',0),'adv_barrier_edges_incident':inc.get('barrier',0),'adv_blocked_edges_incident':inc.get('blocked',0),'adv_wetland_blocked_edges_incident':inc.get('wetland_blocked',0),'adv_main_watershed_edges_incident':inc.get('watershed',0),'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),'adv_graph_blocked_edges':counts.get('blocked_highland',0)+counts.get('blocked_wetland',0),'adv_graph_corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),'adv_graph_barrier_edges':counts.get('minor_river_barrier',0)+counts.get('main_watershed_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0)+counts.get('blocked_wetland',0)}
        p.update(adv); adv_by[nid]=adv
    json.dump(nodes, open(np,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    admin=json.load(open(ap,encoding='utf-8'))
    for af in admin['features']:
        uid=str(af.get('properties',{}).get('unit_id') or '')
        if uid in adv_by: af['properties'].update(adv_by[uid])
    json.dump(admin, open(ap,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    return changed, counts, graph_nodes, graph_edges, comps_count, density

summary=[]
for ep in sorted(glob.glob('data/connectivity/edges/connectivity_edges_*.geojson'), key=lambda p:int(os.path.basename(p).split('_')[-1].split('.')[0])):
    y=int(os.path.basename(ep).split('_')[-1].split('.')[0])
    ch,counts,n,e,c,d=recompute_year(y)
    print(y,'main watershed edges set',ch)
    summary.append({'year':y,'nodes':n,'edges':e,'components':c,'density':round(float(d),6),'main_watershed_barrier_edges':counts.get('main_watershed_barrier',0),'blocked_wetland_edges':counts.get('blocked_wetland',0),'blocked_highland_edges':counts.get('blocked_highland',0),'corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),'normal_contact_edges':counts.get('normal_contact',0),'navigable_river_corridor_edges':counts.get('navigable_river_corridor',0),'rail_corridor_edges':counts.get('rail_corridor',0),'old_road_corridor_edges':counts.get('old_road_corridor',0),'mixed_corridor_edges':counts.get('mixed_corridor',0),'barrier_edges':counts.get('main_watershed_barrier',0)+counts.get('minor_river_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_wetland',0)+counts.get('blocked_highland',0),'blocked_edges':counts.get('blocked_wetland',0)+counts.get('blocked_highland',0)})
json.dump(summary, open('data/connectivity/connectivity_metrics_by_year.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
import pandas as pd
pd.DataFrame(summary).to_csv('/mnt/data/v134_connectivity_metrics_by_year.csv',index=False)
