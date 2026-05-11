import json, math, warnings
from pathlib import Path
import geopandas as gpd
import pandas as pd
import networkx as nx
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
from shapely.ops import unary_union, nearest_points

warnings.filterwarnings('ignore')
BASE=Path(__file__).resolve().parent
DATA=BASE/'data'
OUT=DATA/'connectivity'
OUT.mkdir(exist_ok=True)
(OUT/'edges').mkdir(exist_ok=True)
(OUT/'nodes').mkdir(exist_ok=True)
REF=OUT/'reference'
CRS_METRIC='EPSG:3576'
CRS_WGS='EPSG:4326'
VERSION='v135_corridor_priority_connectivity'

# --- IO / helpers ---------------------------------------------------------
def read(path):
    g=gpd.read_file(path)
    if g.crs is None:
        g=g.set_crs(4326)
    return g.to_crs(CRS_METRIC)

def to_float(v, default=None):
    try:
        if v is None or pd.isna(v): return default
        return float(v)
    except Exception:
        return default

def clean_value(v):
    try:
        import numpy as np
        if isinstance(v, np.generic): return v.item()
        if isinstance(v, np.ndarray): return v.tolist()
    except Exception:
        pass
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
        if not isinstance(v,(list,dict,tuple,set)) and pd.isna(v): return None
    except Exception:
        pass
    if isinstance(v,(list,tuple,set)): return [clean_value(x) for x in v]
    if isinstance(v,dict): return {str(k):clean_value(x) for k,x in v.items()}
    return v

def clean_props(d): return {str(k):clean_value(v) for k,v in d.items()}
def geoms(gdf): return [g for g in gdf.geometry if g is not None and not g.is_empty]
def fid(row): return str(row.get('unit_id') or row.get('topology_node_id') or row.get('id') or row.get('OBJECTID') or '')
def line_between(a,b): return LineString([(a.x,a.y),(b.x,b.y)])

def geom_parts(g):
    if g is None or g.is_empty: return []
    if hasattr(g,'geoms'):
        out=[]
        for x in g.geoms: out.extend(geom_parts(x))
        return out
    return [g]

class RefIndex:
    def __init__(self, geometries):
        self.geoms=[g for g in (geometries or []) if g is not None and not g.is_empty]
        self.tree=STRtree(self.geoms) if self.geoms else None
    def _idxs(self, geom, predicate=None, distance=None):
        if self.tree is None or geom is None or geom.is_empty: return []
        try:
            if predicate == 'dwithin':
                return list(self.tree.query(geom, predicate='dwithin', distance=distance))
            if predicate:
                return list(self.tree.query(geom, predicate=predicate))
            return list(self.tree.query(geom))
        except Exception:
            return []
    def dwithin(self, geom, meters):
        return len(self._idxs(geom, 'dwithin', meters))>0
    def intersects(self, geom):
        return len(self._idxs(geom, 'intersects'))>0
    def min_dist_km(self, geom):
        if self.tree is None or geom is None or geom.is_empty: return None
        try:
            idx=self.tree.nearest(geom)
            return geom.distance(self.geoms[int(idx)])/1000.0
        except Exception:
            return None
    def candidates(self, geom, predicate='intersects', distance=None):
        idxs=self._idxs(geom, predicate, distance)
        out=[]
        for i in idxs:
            try: out.append(self.geoms[int(i)])
            except Exception: pass
        return out

# --- active temporal layers ----------------------------------------------
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

# --- local transition geometry --------------------------------------------
def local_contact(pa, pb, conn=None):
    """v135: build a local transition geometry from the actual common border.

    Corridors are tested against the shared border (or a nearest-boundary proxy), not
    against the whole centre-to-centre connector and not just a single midpoint.
    This keeps false distant Ob/Irtysh links out, but allows real rail/road/river
    crossings near the common border to be counted.
    """
    try:
        if pa is not None and pb is not None and not pa.is_empty and not pb.is_empty:
            shared = pa.boundary.intersection(pb.boundary)
            if shared is None or shared.is_empty or getattr(shared, 'length', 0) < 50:
                # small digitization gaps: take boundary pieces within 2 km of the neighbour
                shared = pa.boundary.intersection(pb.buffer(2000))
                if shared is None or shared.is_empty or getattr(shared, 'length', 0) < 50:
                    shared = pb.boundary.intersection(pa.buffer(2000))
            if shared is not None and not shared.is_empty and getattr(shared, 'length', 0) >= 50:
                return shared, 'shared_boundary_local_band'
            # no stable shared segment: use nearest boundary-to-boundary transition
            a,b = nearest_points(pa.boundary, pb.boundary)
            if a.distance(b) <= 6000:
                return LineString([(a.x,a.y),(b.x,b.y)]), 'nearest_boundary_gap_proxy'
    except Exception:
        pass
    if conn is None or conn.is_empty or not hasattr(conn,'length') or conn.length<=0:
        return None, 'no_connector'
    try:
        return conn.interpolate(0.5, normalized=True), 'fallback_centerline_midpoint'
    except Exception:
        return None, 'centerline_midpoint_failed'

def contact_midpoint(g):
    if g is None or g.is_empty: return None
    if g.geom_type=='Point': return g
    try:
        if hasattr(g,'length') and g.length>0:
            return g.interpolate(0.5, normalized=True)
    except Exception:
        pass
    try: return g.representative_point()
    except Exception: return g.centroid

def wgs_point(point, crs_metric=CRS_METRIC):
    try:
        gs=gpd.GeoSeries([point], crs=crs_metric).to_crs(CRS_WGS)
        p=gs.iloc[0]
        return float(p.x), float(p.y)
    except Exception:
        return None, None

# --- wetland / watershed helpers -----------------------------------------
def _sample_points_along(g, n=11):
    if g is None or g.is_empty: return []
    parts=[x for x in geom_parts(g) if not x.is_empty]
    lines=[x for x in parts if hasattr(x,'length') and x.length>0]
    if not lines:
        try: return [g.representative_point()]
        except Exception: return []
    longest=max(lines, key=lambda x:x.length)
    if longest.length<=0: return []
    if longest.length < 1000: return [longest.interpolate(0.5, normalized=True)]
    return [longest.interpolate(i/(n-1), normalized=True) for i in range(n)]

def wetland_block(contact, mid, wet_idx):
    if contact is None or contact.is_empty: return False, 0.0, False
    pt = mid if mid is not None else contact
    centroid_hit = bool(pt is not None and not pt.is_empty and (wet_idx.intersects(pt) or wet_idx.dwithin(pt, 1000)))
    samples=_sample_points_along(contact, 11)
    if samples:
        hits=sum(1 for p in samples if wet_idx.intersects(p) or wet_idx.dwithin(p,1000))
        frac=hits/len(samples)
    else:
        frac=1.0 if centroid_hit else 0.0
    # method rule: block only if the common-border centre is wetland or most of the local transition is wetland.
    return bool(centroid_hit or frac>=0.80), float(frac), bool(centroid_hit)

# --- load references ------------------------------------------------------
print('Loading references...')
tract=read(REF/'siberian_tract.geojson')
tomsk=read(REF/'tomsk_roads_south.geojson')
nav=read(REF/'navigable_rivers.geojson')
high=read(REF/'elevation_over_400m.geojson')
rails=read(DATA/'railways/railways.geojson')
rivers=read(DATA/'hydro/rivers_full.geojson')
wetlands=read(DATA/'natural_boundaries/reference/wetlands_west_siberia.json')
oro=read(DATA/'natural_boundaries/reference/orography_clipped1.json')

# Fix invalids and build indices.
for df in [tract,tomsk,nav,high,rails,rivers,wetlands,oro]:
    try: df['geometry']=df.geometry.buffer(0) if df.geom_type.isin(['Polygon','MultiPolygon']).any() else df.geometry
    except Exception: pass
try:
    high_geom=high.geometry.iloc[0].buffer(0).simplify(2500, preserve_topology=True)
    high_list=list(high_geom.geoms) if hasattr(high_geom,'geoms') else [high_geom]
except Exception:
    high_list=geoms(high)
high_idx=RefIndex(high_list)
river_idx=RefIndex(geoms(rivers))
nav_idx_all=RefIndex(geoms(nav))
wet_idx=RefIndex(geoms(wetlands))

print('Preparing main watershed barriers...')
try:
    # Only borders between major MAIN_BAS polygons are used as a coarse main-watershed barrier.
    main_ws = oro[['MAIN_BAS','geometry']].dissolve(by='MAIN_BAS').reset_index()
    main_ws_lines=[]
    for g in main_ws.geometry:
        try:
            b=g.boundary.simplify(1500, preserve_topology=True)
            main_ws_lines.extend(geom_parts(b))
        except Exception:
            pass
    main_ws_idx=RefIndex(main_ws_lines)
except Exception as e:
    print('main watershed preparation failed', e)
    main_ws_idx=RefIndex([])

# --- years/method ---------------------------------------------------------
years=sorted(int(p.stem.split('_')[-1]) for p in (DATA/'topology').glob('topology_*.geojson') if 'nodes' not in p.stem and p.stem.split('_')[-1].isdigit())
method={
 'version':'v135',
 'name':'Эвристический граф потенциальной связности АТЕ · приоритет коридоров у общей границы',
 'base_graph':'Сохраняется обычная геометрическая смежность topology_YYYY.geojson; продвинутый граф является отдельной моделью потенциальной связности.',
 'core_fix':'v135 проверяет транспортные и речные коридоры по локальной полосе общей границы соседних АТЕ. Коридоры имеют приоритет над болотными и прочими барьерами: судоходная река, тракт или ЖД не должны сниматься только потому, что проходят через заболоченную территорию.',
 'corridors':{
  'navigable_rivers':'Судоходная река считается коридором, если она пересекает или проходит вблизи локальной полосы общей границы соседних АТЕ. Водный коридор имеет приоритет над болотным барьером.',
  'siberian_tract':'Сибирский тракт используется по активным участкам Year_начала_движ–Год_закрытия и только до 1897 г.; проверяется локально у общей границы.',
  'tomsk_roads_south':'Дороги юга Томской губернии используются с 1850 г. до 1897 г.; проверяются локально у общей границы.',
  'railways':'Железные дороги используются с 1897 г. по year_open/year_close; коридор засчитывается при прохождении рядом с общей границей/точкой входа между соседними АТЕ и имеет высший транспортный приоритет.'},
 'barriers':{
  'wetlands':'Болота снимают ребро только при отсутствии транспортного/речного коридора. Условие: центр общей границы в болотах или 80% контрольных точек локального перехода находятся в болотах/1-км допуске.',
  'highland':'Маска высот >400 м используется как сильный орографический барьер только севернее 50° с.ш.; южнее 50° с.ш. этот слой не блокирует связи.',
  'main_watershed':'Учитываются только главные водоразделы, выведенные по границам крупных MAIN_BAS. Они повышают импеданс, но сами по себе не всегда снимают ребро.',
  'minor_rivers':'Несудоходные реки используются как слабый локальный барьер, если рядом нет судоходного коридора.'},
 'distance_thresholds_km':{'rail_local':5.0,'old_road_local':8.0,'navigable_local':10.0,'minor_river_local':1.5,'highland_local':3.0,'main_watershed_local':4.0,'wetland_band':1.0},
 'weights':'impedance = расстояние между узлами / бонус локального коридора * штраф локального барьера; коридоры имеют приоритет над болотами. Снятые болотами/рельефом рёбра остаются в линейном слое, но исключаются из сетевых метрик.'}
(OUT/'connectivity_method_v135.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')
# Keep legacy manifest path valid too.
(OUT/'connectivity_method_v129.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')

label_map={
 'rail_corridor':'локальный коридор: железная дорога',
 'old_road_corridor':'локальный коридор: Сибирский тракт / исторические дороги',
 'navigable_river_corridor':'локальный коридор: судоходная река',
 'mixed_corridor':'локальный смешанный транспортный коридор',
 'normal_contact':'обычное соседство',
 'minor_river_barrier':'барьер: несудоходная река',
 'main_watershed_barrier':'барьер: главный водораздел',
 'highland_barrier':'барьер: рельеф >400 м',
 'blocked_highland':'снято: рельеф >400 м без коридора',
 'blocked_wetland':'снято: болотный массив / заболоченный разрыв'}

metrics=[]
admin_adv_cache={}
for year in years:
    print('year',year, flush=True)
    edge_path=DATA/'topology'/f'topology_{year}.geojson'
    node_path=DATA/'topology'/f'topology_nodes_{year}.geojson'
    admin_path=DATA/'admin'/f'admin_{year}.geojson'
    edges=gpd.read_file(edge_path); nodes=gpd.read_file(node_path)
    for df in [edges,nodes]:
        if df.crs is None: df.set_crs(4326, inplace=True)
    edges_m=edges.to_crs(CRS_METRIC); nodes_m=nodes.to_crs(CRS_METRIC)
    node_geom={fid(r):r.geometry for _,r in nodes_m.iterrows()}
    admin_gdf=gpd.read_file(admin_path)
    if admin_gdf.crs is None: admin_gdf.set_crs(4326, inplace=True)
    admin_m=admin_gdf.to_crs(CRS_METRIC)
    # simplified polygons are enough for local transition tests and much faster for late district layers
    admin_geom={str(r.get('unit_id') or ''): (r.geometry.buffer(0).simplify(500, preserve_topology=True) if r.geometry is not None and not r.geometry.is_empty else r.geometry) for _,r in admin_m.iterrows()}

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
    edge_debug=[]

    for idx,row_m in edges_m.iterrows():
        row=edges.iloc[idx]
        p0=row.to_dict(); sid=str(p0.get('source_id') or ''); tid=str(p0.get('target_id') or '')
        if not sid or not tid: continue
        graph_line=row_m.geometry
        a=node_geom.get(sid); b=node_geom.get(tid)
        conn=line_between(a,b) if a is not None and b is not None else graph_line
        dist_km=(conn.length/1000.0) if conn is not None else max(to_float(p0.get('boundary_km'),1),1)

        pa=admin_geom.get(sid); pb=admin_geom.get(tid)
        contact, contact_method=local_contact(pa, pb, conn)
        if contact is None or contact.is_empty:
            contact=graph_line
        mid=contact_midpoint(contact)
        c_lon,c_lat=wgs_point(mid) if mid is not None else (None,None)

        # Local corridors only: no more classifying by long center-to-center line.
        # v135: test corridors against the shared-border band, with realistic tolerance for
        # generalized historical lines. Transport corridors override wetland barriers.
        rail_hit=rail_idx.dwithin(contact,5000)
        road_hit=road_idx.dwithin(contact,8000)
        nav_hit=nav_idx.dwithin(contact,10000)
        # In 1897-1914 navigable rivers remain meaningful, but rail has visual/class priority.

        # Local barriers.
        river_hit=river_idx.dwithin(contact,1500)
        nav_near=nav_idx_all.dwithin(contact,10000)
        minor_barrier=bool(river_hit and not nav_near)
        wet_block, wet_frac, wet_centroid=wetland_block(contact, mid, wet_idx)
        north_of_50 = bool(c_lat is not None and c_lat>=50.0)
        high_hit=bool(north_of_50 and high_idx.dwithin(contact,3000))
        main_ws_hit=bool(main_ws_idx.dwithin(contact,4000))

        corridor_count=sum([rail_hit,road_hit,nav_hit])
        blocked_reason=None
        if wet_block and corridor_count==0:
            blocked_reason='wetland'
        elif high_hit and corridor_count==0:
            blocked_reason='highland'
        blocked=blocked_reason is not None

        impedance=max(dist_km,1.0)
        bonuses=[]
        if rail_hit: bonuses.append(3.0)
        if road_hit: bonuses.append(2.0)
        if nav_hit: bonuses.append(1.8 if year<=1876 else 1.25)
        if bonuses: impedance/=max(bonuses)
        if minor_barrier: impedance*=1.25
        if main_ws_hit: impedance*=1.45
        if high_hit: impedance*=2.5
        if wet_block: impedance*=3.2
        if blocked: impedance=float('inf')
        strength=0.0 if blocked else round(100.0/(1.0+impedance),4)

        if blocked_reason=='wetland': cls='blocked_wetland'
        elif blocked_reason=='highland': cls='blocked_highland'
        # Corridor class has priority; railway/tract must not be hidden by a weaker mixed class.
        elif rail_hit: cls='rail_corridor'
        elif road_hit: cls='old_road_corridor'
        elif nav_hit: cls='navigable_river_corridor'
        elif corridor_count>=2: cls='mixed_corridor'
        elif high_hit: cls='highland_barrier'
        elif main_ws_hit: cls='main_watershed_barrier'
        elif minor_barrier: cls='minor_river_barrier'
        else: cls='normal_contact'

        counts[cls]=counts.get(cls,0)+1
        props=clean_props({k:v for k,v in p0.items() if k!='geometry'})
        props.update({
          'year':year,'adv_source_id':sid,'adv_target_id':tid,
          'adv_edge_class':cls,'adv_edge_label':label_map.get(cls,cls),'adv_passable':not blocked,
          'adv_impedance':None if blocked else round(float(impedance),4),'adv_strength':strength,'adv_distance_km':round(float(dist_km),3),
          'adv_corridor_rail':bool(rail_hit),'adv_corridor_old_road':bool(road_hit),'adv_corridor_navigable_river':bool(nav_hit),
          'adv_barrier_minor_river':bool(minor_barrier),'adv_barrier_highland':bool(high_hit),'adv_barrier_main_watershed':bool(main_ws_hit),
          'adv_barrier_wetland':bool(wet_block),'adv_wetland_overlap_frac':wet_frac,'adv_wetland_centroid_hit':bool(wet_centroid),
          'adv_blocked_reason':blocked_reason,
          'adv_contact_method':contact_method,'adv_contact_lat':round(c_lat,6) if c_lat is not None else None,'adv_contact_lon':round(c_lon,6) if c_lon is not None else None,
          'adv_contact_local_test':'shared-border band / nearest-boundary proxy; corridor is counted near the common border, not by distant river/rail inside both polygons',
          'adv_rail_distance_km':round(rail_idx.min_dist_km(contact),3) if rail_idx.tree is not None else None,
          'adv_old_road_distance_km':round(road_idx.min_dist_km(contact),3) if road_idx.tree is not None else None,
          'adv_navigable_distance_km':round(nav_idx_all.min_dist_km(contact),3) if nav_idx_all.tree is not None else None,
          'adv_method':VERSION
        })
        edge_features.append({'type':'Feature','geometry':row.geometry.__geo_interface__,'properties':props})
        edge_debug.append(props)
        if not blocked:
            G.add_edge(sid,tid,weight=float(impedance),strength=strength,edge_class=cls)

    comps=list(nx.connected_components(G)) if len(G) else []
    sorted_comps=sorted(comps,key=len,reverse=True)
    comp_id={n:i for i,c in enumerate(sorted_comps,1) for n in c}; comp_size={n:len(c) for c in comps for n in c}
    deg=dict(G.degree()); wdeg={n:sum(float(d.get('strength') or 0) for _,_,d in G.edges(n,data=True)) for n in G.nodes}
    try:
        if len(G)>160:
            # large late-Soviet/modern graphs: use deterministic approximation to keep browser-build feasible
            btw=nx.betweenness_centrality(G, k=min(80,len(G)), seed=42, weight='weight', normalized=True)
        else:
            btw=nx.betweenness_centrality(G, weight='weight', normalized=True) if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: btw={n:0 for n in G.nodes}
    try:
        # Weighted closeness is expensive and unstable for the heuristic impedance graph; use topology distance for large graphs.
        close=nx.closeness_centrality(G, distance=None if len(G)>160 else 'weight') if len(G)>1 else {n:0 for n in G.nodes}
    except Exception: close={n:0 for n in G.nodes}
    try: kcore=nx.core_number(G) if len(G)>0 and G.number_of_edges()>0 else {n:0 for n in G.nodes}
    except Exception: kcore={n:0 for n in G.nodes}

    all_node_ids=[fid(r) for _,r in nodes.iterrows() if fid(r)]
    incident={n:{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0} for n in all_node_ids}
    for p in edge_debug:
        cls=p['adv_edge_class']
        for n in [p['adv_source_id'],p['adv_target_id']]:
            incident.setdefault(n,{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0})
            if 'corridor' in cls: incident[n]['corridor']+=1
            if 'barrier' in cls or cls.startswith('blocked'): incident[n]['barrier']+=1
            if cls.startswith('blocked'): incident[n]['blocked']+=1
            if cls=='blocked_wetland': incident[n]['wetland_blocked']+=1
            if cls=='main_watershed_barrier' or p.get('adv_barrier_main_watershed'): incident[n]['watershed']+=1

    graph_nodes=len(G.nodes); graph_edges=G.number_of_edges(); comps_count=nx.number_connected_components(G) if graph_nodes else 0; density=nx.density(G) if graph_nodes>1 else 0
    node_features=[]; adv_by_unit={}
    for _,row in nodes.iterrows():
        p=clean_props({k:v for k,v in row.to_dict().items() if k!='geometry'}); nid=fid(row)
        adv={
          'adv_graph_method':VERSION,'adv_degree':int(deg.get(nid,0)),'adv_weighted_degree':round(float(wdeg.get(nid,0)),4),
          'adv_betweenness':round(float(btw.get(nid,0)),6),'adv_closeness':round(float(close.get(nid,0)),6),'adv_k_core':int(kcore.get(nid,0)),
          'adv_component_id':int(comp_id.get(nid,0)),'adv_component_size':int(comp_size.get(nid,0)),
          'adv_corridor_edges_incident':incident.get(nid,{}).get('corridor',0),'adv_barrier_edges_incident':incident.get(nid,{}).get('barrier',0),
          'adv_blocked_edges_incident':incident.get(nid,{}).get('blocked',0),'adv_wetland_blocked_edges_incident':incident.get(nid,{}).get('wetland_blocked',0),
          'adv_main_watershed_edges_incident':incident.get(nid,{}).get('watershed',0),
          'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),
          'adv_graph_blocked_edges':counts.get('blocked_highland',0)+counts.get('blocked_wetland',0),
          'adv_graph_corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),
          'adv_graph_barrier_edges':counts.get('minor_river_barrier',0)+counts.get('main_watershed_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0)+counts.get('blocked_wetland',0)
        }
        p.update(adv); adv_by_unit[nid]=adv
        node_features.append({'type':'Feature','geometry':row.geometry.__geo_interface__,'properties':p})

    # Write connectivity layers.
    (OUT/'edges'/f'connectivity_edges_{year}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':edge_features},ensure_ascii=False),encoding='utf-8')
    (OUT/'nodes'/f'connectivity_nodes_{year}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':node_features},ensure_ascii=False),encoding='utf-8')

    # Attach updated advanced graph metrics to admin_YYYY.geojson for map modes.
    admin_fc=json.load(open(admin_path,encoding='utf-8'))
    for feat in admin_fc.get('features',[]):
        uid=str(feat.get('properties',{}).get('unit_id') or '')
        if uid in adv_by_unit:
            feat['properties'].update(clean_props(adv_by_unit[uid]))
    tmp_admin=admin_path.with_suffix(admin_path.suffix+'.tmp')
    with open(tmp_admin,'w',encoding='utf-8') as f:
        json.dump(admin_fc,f,ensure_ascii=False,separators=(',',':'))
    tmp_admin.replace(admin_path)

    metrics.append({
      'year':year,'nodes':graph_nodes,'edges':graph_edges,'components':comps_count,'density':round(float(density),6),
      'blocked_edges':counts.get('blocked_highland',0)+counts.get('blocked_wetland',0),'blocked_highland_edges':counts.get('blocked_highland',0),'blocked_wetland_edges':counts.get('blocked_wetland',0),
      'corridor_edges':counts.get('rail_corridor',0)+counts.get('old_road_corridor',0)+counts.get('navigable_river_corridor',0)+counts.get('mixed_corridor',0),
      'barrier_edges':counts.get('minor_river_barrier',0)+counts.get('main_watershed_barrier',0)+counts.get('highland_barrier',0)+counts.get('blocked_highland',0)+counts.get('blocked_wetland',0),
      'rail_corridor_edges':counts.get('rail_corridor',0),'old_road_corridor_edges':counts.get('old_road_corridor',0),'navigable_river_corridor_edges':counts.get('navigable_river_corridor',0),'mixed_corridor_edges':counts.get('mixed_corridor',0),
      'minor_river_barrier_edges':counts.get('minor_river_barrier',0),'main_watershed_barrier_edges':counts.get('main_watershed_barrier',0),'highland_barrier_edges':counts.get('highland_barrier',0),
      'normal_contact_edges':counts.get('normal_contact',0),
      'avg_degree':round(float(sum(deg.values())/len(deg)),6) if deg else 0,'avg_weighted_degree':round(float(sum(wdeg.values())/len(wdeg)),6) if wdeg else 0,
      'avg_betweenness':round(float(sum(btw.values())/len(btw)),6) if btw else 0,'avg_closeness':round(float(sum(close.values())/len(close)),6) if close else 0,
      'largest_component':max([len(c) for c in comps], default=0)
    })

(OUT/'connectivity_metrics_by_year.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
pd.DataFrame(metrics).to_csv(BASE/'v135_connectivity_metrics_by_year.csv',index=False)
print('done',len(metrics))
