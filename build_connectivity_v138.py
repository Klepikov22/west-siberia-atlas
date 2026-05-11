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
VERSION='v138_component_connectivity_length_weighted'

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


def corridor_score_from_distance(dist_km, limit_km, max_score):
    """Linear-decay local corridor score. 0 means no local support."""
    if dist_km is None:
        return 0.0
    try:
        d=float(dist_km)
    except Exception:
        return 0.0
    if not math.isfinite(d) or d > limit_km:
        return 0.0
    return round(max_score * max(0.0, 1.0 - d/limit_km), 4)

def component_profile(*flags):
    return '+'.join([name for name, ok in flags if ok]) or 'none'




def distance_proxy_length_km(dist_km, radius_km, contact_km=0.0):
    """Fast proxy for the local length of a corridor/barrier near the transition zone.

    Exact overlay of every edge with every railway/river segment is too heavy for the
    full historical stack.  The proxy converts distance to a chord length inside a
    local search band and adds a small term for long shared borders when the object
    is very close to the border.
    """
    try:
        d=float(dist_km)
        r=float(radius_km)
        ck=max(0.0,float(contact_km or 0.0))
    except Exception:
        return 0.0
    if not math.isfinite(d) or d>r:
        return 0.0
    chord=2.0*math.sqrt(max(0.0, r*r-d*d))
    if d<=1.0 and ck>0:
        chord += min(ck, r)
    return round(float(chord),3)

def local_line_length_km(ref_idx, contact, buffer_m):
    """Fast proxy length of reference lines inside a local buffer around transition geometry."""
    if ref_idx is None or ref_idx.tree is None or contact is None or contact.is_empty:
        return 0.0
    try:
        d=ref_idx.min_dist_km(contact)
        ck=float(getattr(contact,'length',0.0) or 0.0)/1000.0
        return distance_proxy_length_km(d, float(buffer_m)/1000.0, ck)
    except Exception:
        return 0.0

def local_polygon_contact_km(poly_idx, contact):
    """Fast proxy length of a local transition that lies in/near polygonal barriers."""
    if poly_idx is None or poly_idx.tree is None or contact is None or contact.is_empty:
        return 0.0
    try:
        ck=float(getattr(contact,'length',0.0) or 0.0)/1000.0
        if poly_idx.intersects(contact):
            return round(max(ck, 1.0),3)
        if poly_idx.dwithin(contact,3000):
            return round(max(min(ck, 3.0), 1.0),3)
        return 0.0
    except Exception:
        return 0.0

def length_factor(local_km, full_km, floor=0.35, cap=1.20):
    """Soft factor: a nearby but very short touch counts weaker than a long local corridor."""
    try:
        x=max(0.0,float(local_km or 0.0))
    except Exception:
        x=0.0
    if x<=0:
        return floor
    return min(cap, floor+(1.0-floor)*math.sqrt(min(1.0, x/max(0.001, full_km))))

def barrier_severity_from_length(local_km, contact_km, full_km, hit=False):
    """0..1 severity used for barriers; long local overlap means stronger impedance."""
    try:
        lk=max(0.0,float(local_km or 0.0))
        ck=max(0.0,float(contact_km or 0.0))
    except Exception:
        lk,ck=0.0,0.0
    if ck>=1.0:
        return min(1.0, lk/ck)
    if lk>0:
        return min(1.0, lk/max(0.001,full_km))
    return 0.45 if hit else 0.0

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
 'version':'v138',
 'name':'Компонентный эвристический граф потенциальной связности АТЕ с учётом длины локальных коридоров и барьеров',
 'base_graph':'Исходной рамкой остаётся обычный граф геометрической смежности topology_YYYY.geojson. v138 не заменяет его, а присваивает каждому ребру независимые компоненты коридоров и барьеров.',
 'core_fix':'Ребро не получает один взаимоисключающий тип. Для каждой связи отдельно считаются речная, дорожная/трактовая и железнодорожная компоненты, а также болотный, рельефный, водораздельный и речной барьерный импеданс. v138 дополнительно учитывает локальную длину коридора или барьера около общей границы: короткое касание даёт меньший вклад, протяжённый локальный коридор или барьер — больший.',
 'positive_components':{
  'rail_score':'Локальная близость железной дороги к полосе общей границы соседних АТЕ; используется с 1897 г. по year_open/year_close. Максимальный вес 3.2, радиус локального поиска 18 км. Итоговый score умножается на коэффициент локальной длины ЖД в этой полосе.',
  'old_road_score':'Локальная близость Сибирского тракта и дорог юга Томской губернии; используются до 1897 г. Максимальный вес 2.2, радиус 25 км. Итоговый score умножается на коэффициент локальной длины дороги.',
  'navigable_river_score':'Локальная близость судоходной реки/канала. Максимальный вес 2.2 до 1876 г., 1.6 в 1876–1914 гг., 0.9 после 1914 г.; радиус 25 км. Итоговый score умножается на коэффициент локальной длины судоходной реки. Судоходная река не снимается болотами, а проходит через них как коридор.'},
 'negative_components':{
  'wetland_impedance':'Болотность общей границы повышает импеданс. При наличии коридора штраф ослабляется, но не исчезает.',
  'relief_impedance':'Маска высот >400 м применяется только севернее 50° с.ш.; повышает импеданс пропорционально локальной длине пересечения общей границы с орографическим барьером, но не отменяет транспортный/речной коридор автоматически.',
  'main_watershed_impedance':'Главный водораздел между крупными MAIN_BAS повышает импеданс с учётом длины водораздельного барьера в локальной полосе общей границы.',
  'minor_river_impedance':'Несудоходные реки дают слабый барьер, если нет локальной судоходной речной компоненты.'},
 'formula':'raw corridor scores are multiplied by local length factors; positive_bonus = 1 + rail_score + old_road_score + navigable_river_score; barrier_multiplier = wetland_impedance * relief_impedance * watershed_impedance * minor_river_impedance; final_impedance = distance_km / positive_bonus * barrier_multiplier; final_strength = 100 * positive_bonus / (positive_bonus + final_impedance).',
 'distance_thresholds_km':{'rail_local':18.0,'old_road_local':25.0,'navigable_local':25.0,'minor_river_local':1.5,'highland_local':3.0,'main_watershed_local':4.0,'wetland_band':1.0},
 'interpretation':'Карта рёбер показывает мультикомпонентный класс связи. Цвет отражает ведущий коридор или профиль импеданса; числовые поля позволяют фильтровать по итоговой силе и импедансу.'}
(OUT/'connectivity_method_v138.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')
# Keep legacy manifest paths valid too.
(OUT/'connectivity_method_v135.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'connectivity_method_v129.json').write_text(json.dumps(method,ensure_ascii=False,indent=2),encoding='utf-8')

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
    nav_idx=nav_idx_all  # v137: rivers remain a potential corridor, but with lower weight after 1914

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

        # v137 component model: score positive corridors and negative barriers independently.
        # The final edge class is a compact legend label derived from the component profile.
        rail_dist = rail_idx.min_dist_km(contact) if rail_idx.tree is not None else None
        road_dist = road_idx.min_dist_km(contact) if road_idx.tree is not None else None
        nav_dist = nav_idx.min_dist_km(contact) if nav_idx.tree is not None else None

        # v138: proximity alone is not enough.  A corridor component is weighted by
        # the length of the active railway/road/navigable river inside the local
        # transition zone around the shared border.
        rail_local_km = local_line_length_km(rail_idx, contact, 18000) if rail_idx.tree is not None else 0.0
        road_local_km = local_line_length_km(road_idx, contact, 25000) if road_idx.tree is not None else 0.0
        nav_local_km = local_line_length_km(nav_idx, contact, 25000) if nav_idx.tree is not None else 0.0

        nav_max = 2.2 if year <= 1876 else (1.6 if year <= 1914 else 0.9)
        rail_score_raw = corridor_score_from_distance(rail_dist, 18.0, 3.2)
        road_score_raw = corridor_score_from_distance(road_dist, 25.0, 2.2)
        nav_score_raw = corridor_score_from_distance(nav_dist, 25.0, nav_max)
        rail_score = round(rail_score_raw * length_factor(rail_local_km, 14.0, floor=0.42, cap=1.18), 4)
        road_score = round(road_score_raw * length_factor(road_local_km, 18.0, floor=0.40, cap=1.15), 4)
        nav_score = round(nav_score_raw * length_factor(nav_local_km, 22.0, floor=0.38, cap=1.18), 4)
        # A very small local touch can be visible in the source data, but it should not
        # define the class unless the score remains meaningful after length weighting.
        rail_hit = rail_score >= 0.18 and rail_local_km >= 0.75
        road_hit = road_score >= 0.14 and road_local_km >= 0.75
        nav_hit = nav_score >= 0.12 and nav_local_km >= 1.00
        positive_score = round(rail_score + road_score + nav_score, 4)
        corridor_count = sum([rail_hit, road_hit, nav_hit])

        # Local barriers. v138 also weights them by the local length/extent of the barrier.
        contact_len_km = float(getattr(contact, 'length', 0.0) or 0.0) / 1000.0
        river_hit = river_idx.dwithin(contact,1500)
        minor_river_local_km = local_line_length_km(river_idx, contact, 1500) if river_idx.tree is not None else 0.0
        minor_barrier = bool(river_hit and not nav_hit and positive_score < 0.25)
        wet_block, wet_frac, wet_centroid = wetland_block(contact, mid, wet_idx)
        north_of_50 = bool(c_lat is not None and c_lat>=50.0)
        relief_local_km = local_polygon_contact_km(high_idx, contact) if north_of_50 else 0.0
        high_hit = bool(north_of_50 and (relief_local_km > 0 or high_idx.dwithin(contact,3000)))
        main_ws_local_km = local_line_length_km(main_ws_idx, contact, 4000) if main_ws_idx.tree is not None else 0.0
        main_ws_hit = bool(main_ws_local_km > 0 or main_ws_idx.dwithin(contact,4000))

        wet_severity = max(float(wet_frac or 0), 1.0 if wet_centroid else 0.0)
        relief_severity = barrier_severity_from_length(relief_local_km, contact_len_km, 8.0, high_hit)
        watershed_severity = barrier_severity_from_length(main_ws_local_km, contact_len_km, 8.0, main_ws_hit)
        minor_river_severity = barrier_severity_from_length(minor_river_local_km, contact_len_km, 5.0, minor_barrier)
        wet_impedance = 1.0 + 1.8 * wet_severity
        relief_impedance = 1.0 + 1.85 * relief_severity
        watershed_impedance = 1.0 + 1.15 * watershed_severity
        minor_river_impedance = 1.0 + 0.25 * minor_river_severity if minor_barrier else 1.0
        # Corridors do not erase barriers, but they reduce their practical penalty.
        if positive_score > 0.10:
            wet_impedance = 1.0 + (wet_impedance - 1.0) * 0.45
            relief_impedance = 1.0 + (relief_impedance - 1.0) * 0.62
            watershed_impedance = 1.0 + (watershed_impedance - 1.0) * 0.72
            minor_river_impedance = 1.0 + (minor_river_impedance - 1.0) * 0.55
        barrier_multiplier = round(wet_impedance * relief_impedance * watershed_impedance * minor_river_impedance, 4)
        positive_bonus = max(1.0, 1.0 + positive_score)
        impedance = max(dist_km,1.0) / positive_bonus * barrier_multiplier
        strength = round(min(100.0, 100.0 * positive_bonus / (positive_bonus + impedance)), 4)

        blocked_reason = None
        # Only an extreme, corridorless barrier becomes a non-passable edge. Most barriers now stay as weak/impeded edges.
        if positive_score < 0.10 and barrier_multiplier >= 4.0 and strength < 2.0:
            blocked_reason = 'high_component_impedance'
        blocked = blocked_reason is not None
        if blocked:
            strength = 0.0
            impedance = float('inf')

        has_wet_imp = wet_impedance > 1.12
        has_relief_imp = relief_impedance > 1.12
        has_ws_imp = watershed_impedance > 1.12
        has_minor_imp = minor_river_impedance > 1.04
        barrier_count = sum([has_wet_imp, has_relief_imp, has_ws_imp, has_minor_imp])

        if blocked:
            cls='blocked_high_impedance'
        elif corridor_count >= 2:
            cls='mixed_corridor_impedance' if barrier_count else 'mixed_corridor'
        elif rail_hit:
            cls='rail_with_impedance' if barrier_count else 'rail_corridor'
        elif road_hit:
            cls='old_road_with_impedance' if barrier_count else 'old_road_corridor'
        elif nav_hit:
            cls='navigable_river_with_impedance' if barrier_count else 'navigable_river_corridor'
        elif barrier_count >= 2:
            cls='normal_multiple_impedance'
        elif has_wet_imp:
            cls='normal_wetland_impedance'
        elif has_relief_imp:
            cls='normal_relief_impedance'
        elif has_ws_imp:
            cls='normal_watershed_impedance'
        elif has_minor_imp:
            cls='normal_minor_river_impedance'
        else:
            cls='normal_contact'

        counts[cls]=counts.get(cls,0)+1
        props=clean_props({k:v for k,v in p0.items() if k!='geometry'})
        props.update({
          'year':year,'adv_source_id':sid,'adv_target_id':tid,
          'adv_edge_class':cls,'adv_edge_label':label_map.get(cls,cls),'adv_passable':not blocked,
          'adv_impedance':None if blocked else round(float(impedance),4),'adv_strength':strength,'adv_distance_km':round(float(dist_km),3),
          'adv_corridor_rail':bool(rail_hit),'adv_corridor_old_road':bool(road_hit),'adv_corridor_navigable_river':bool(nav_hit),
          'adv_rail_score':round(float(rail_score),4),'adv_old_road_score':round(float(road_score),4),'adv_navigable_river_score':round(float(nav_score),4),
          'adv_rail_score_raw':round(float(rail_score_raw),4),'adv_old_road_score_raw':round(float(road_score_raw),4),'adv_navigable_river_score_raw':round(float(nav_score_raw),4),
          'adv_rail_local_km':round(float(rail_local_km),3),'adv_old_road_local_km':round(float(road_local_km),3),'adv_navigable_river_local_km':round(float(nav_local_km),3),
          'adv_positive_corridor_score':round(float(positive_score),4),'adv_positive_bonus':round(float(positive_bonus),4),
          'adv_corridor_profile':component_profile(('rail',rail_hit),('old_road',road_hit),('navigable_river',nav_hit)),
          'adv_barrier_minor_river':bool(minor_barrier),'adv_barrier_highland':bool(high_hit),'adv_barrier_main_watershed':bool(main_ws_hit),
          'adv_barrier_wetland':bool(wet_block),'adv_wetland_overlap_frac':wet_frac,'adv_wetland_centroid_hit':bool(wet_centroid),
          'adv_contact_local_km':round(float(contact_len_km),3),'adv_minor_river_local_km':round(float(minor_river_local_km),3),'adv_relief_barrier_km':round(float(relief_local_km),3),'adv_main_watershed_barrier_km':round(float(main_ws_local_km),3),
          'adv_relief_severity':round(float(relief_severity),4),'adv_watershed_severity':round(float(watershed_severity),4),'adv_minor_river_severity':round(float(minor_river_severity),4),
          'adv_wetland_impedance':round(float(wet_impedance),4),'adv_relief_impedance':round(float(relief_impedance),4),
          'adv_watershed_impedance':round(float(watershed_impedance),4),'adv_minor_river_impedance':round(float(minor_river_impedance),4),
          'adv_barrier_impedance_multiplier':round(float(barrier_multiplier),4),
          'adv_barrier_profile':component_profile(('wetland',has_wet_imp),('relief',has_relief_imp),('main_watershed',has_ws_imp),('minor_river',has_minor_imp)),
          'adv_blocked_reason':blocked_reason,
          'adv_contact_method':contact_method,'adv_contact_lat':round(c_lat,6) if c_lat is not None else None,'adv_contact_lon':round(c_lon,6) if c_lon is not None else None,
          'adv_contact_local_test':'shared-border band / nearest-boundary proxy; corridor is counted near the common border, not by distant river/rail inside both polygons',
          'adv_rail_distance_km':round(rail_idx.min_dist_km(contact),3) if rail_idx.tree is not None else None,
          'adv_old_road_distance_km':round(road_idx.min_dist_km(contact),3) if road_idx.tree is not None else None,
          'adv_navigable_distance_km':round(nav_idx_all.min_dist_km(contact),3) if nav_idx_all.tree is not None else None,
          'adv_method':VERSION,'adv_model':'component_scores_v138_length_weighted'
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
    incident={n:{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0,'rail':0,'road':0,'river':0,'wetland_impedance':0,'relief_impedance':0,'watershed_impedance':0,'strength_sum':0.0,'impedance_sum':0.0,'impedance_count':0,'rail_local_km':0.0,'old_road_local_km':0.0,'navigable_river_local_km':0.0,'relief_barrier_km':0.0,'main_watershed_barrier_km':0.0} for n in all_node_ids}
    for p in edge_debug:
        cls=p['adv_edge_class']
        for n in [p['adv_source_id'],p['adv_target_id']]:
            incident.setdefault(n,{'corridor':0,'barrier':0,'blocked':0,'wetland_blocked':0,'watershed':0,'rail':0,'road':0,'river':0,'wetland_impedance':0,'relief_impedance':0,'watershed_impedance':0,'strength_sum':0.0,'impedance_sum':0.0,'impedance_count':0,'rail_local_km':0.0,'old_road_local_km':0.0,'navigable_river_local_km':0.0,'relief_barrier_km':0.0,'main_watershed_barrier_km':0.0})
            has_corr=bool(p.get('adv_corridor_rail') or p.get('adv_corridor_old_road') or p.get('adv_corridor_navigable_river'))
            has_bar=bool((p.get('adv_barrier_impedance_multiplier') or 1)>1.12)
            if has_corr: incident[n]['corridor']+=1
            if has_bar or cls.startswith('blocked'): incident[n]['barrier']+=1
            if p.get('adv_passable') is False or cls.startswith('blocked'): incident[n]['blocked']+=1
            if (p.get('adv_wetland_impedance') or 1)>1.12: incident[n]['wetland_impedance']+=1
            if (p.get('adv_relief_impedance') or 1)>1.12: incident[n]['relief_impedance']+=1
            if (p.get('adv_watershed_impedance') or 1)>1.12: incident[n]['watershed_impedance']+=1
            if p.get('adv_barrier_wetland'): incident[n]['wetland_blocked']+=1
            if p.get('adv_barrier_main_watershed'): incident[n]['watershed']+=1
            if p.get('adv_corridor_rail'): incident[n]['rail']+=1
            if p.get('adv_corridor_old_road'): incident[n]['road']+=1
            if p.get('adv_corridor_navigable_river'): incident[n]['river']+=1
            incident[n]['rail_local_km']+=to_float(p.get('adv_rail_local_km'),0) or 0
            incident[n]['old_road_local_km']+=to_float(p.get('adv_old_road_local_km'),0) or 0
            incident[n]['navigable_river_local_km']+=to_float(p.get('adv_navigable_river_local_km'),0) or 0
            incident[n]['relief_barrier_km']+=to_float(p.get('adv_relief_barrier_km'),0) or 0
            incident[n]['main_watershed_barrier_km']+=to_float(p.get('adv_main_watershed_barrier_km'),0) or 0
            st=to_float(p.get('adv_strength'),0) or 0
            incident[n]['strength_sum']+=st
            im=to_float(p.get('adv_impedance'),None)
            if im is not None and math.isfinite(im):
                incident[n]['impedance_sum']+=float(im); incident[n]['impedance_count']+=1

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
    impedance_vals=[to_float(p.get('adv_impedance'),None) for p in edge_debug if to_float(p.get('adv_impedance'),None) is not None and math.isfinite(to_float(p.get('adv_impedance'),0))]
    rail_local_total=sum(to_float(p.get('adv_rail_local_km'),0) or 0 for p in edge_debug)
    old_road_local_total=sum(to_float(p.get('adv_old_road_local_km'),0) or 0 for p in edge_debug)
    navigable_local_total=sum(to_float(p.get('adv_navigable_river_local_km'),0) or 0 for p in edge_debug)
    relief_barrier_total_km=sum(to_float(p.get('adv_relief_barrier_km'),0) or 0 for p in edge_debug)
    main_watershed_barrier_total_km=sum(to_float(p.get('adv_main_watershed_barrier_km'),0) or 0 for p in edge_debug)

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
          'adv_rail_edges_incident':incident.get(nid,{}).get('rail',0),'adv_old_road_edges_incident':incident.get(nid,{}).get('road',0),
          'adv_navigable_river_edges_incident':incident.get(nid,{}).get('river',0),
          'adv_rail_local_km_incident':round(float(incident.get(nid,{}).get('rail_local_km',0)),3),
          'adv_old_road_local_km_incident':round(float(incident.get(nid,{}).get('old_road_local_km',0)),3),
          'adv_navigable_river_local_km_incident':round(float(incident.get(nid,{}).get('navigable_river_local_km',0)),3),
          'adv_relief_barrier_km_incident':round(float(incident.get(nid,{}).get('relief_barrier_km',0)),3),
          'adv_main_watershed_barrier_km_incident':round(float(incident.get(nid,{}).get('main_watershed_barrier_km',0)),3),
          'adv_wetland_impedance_edges_incident':incident.get(nid,{}).get('wetland_impedance',0),'adv_relief_impedance_edges_incident':incident.get(nid,{}).get('relief_impedance',0),
          'adv_watershed_impedance_edges_incident':incident.get(nid,{}).get('watershed_impedance',0),
          'adv_avg_edge_strength_incident':round(float(incident.get(nid,{}).get('strength_sum',0))/max(1,int(incident.get(nid,{}).get('corridor',0)+incident.get(nid,{}).get('barrier',0))),4),
          'adv_avg_edge_impedance_incident':round(float(incident.get(nid,{}).get('impedance_sum',0))/max(1,int(incident.get(nid,{}).get('impedance_count',0))),4),
          'adv_graph_nodes':graph_nodes,'adv_graph_edges':graph_edges,'adv_graph_components':comps_count,'adv_graph_density':round(float(density),6),
          'adv_graph_blocked_edges':blocked_total,
          'adv_graph_corridor_edges':corridor_total,
          'adv_graph_barrier_edges':barrier_total,
          'adv_graph_rail_edges':rail_total,'adv_graph_old_road_edges':road_total,'adv_graph_navigable_river_edges':river_total,
          'adv_graph_wetland_impedance_edges':wetland_imp_total,'adv_graph_relief_impedance_edges':relief_imp_total,'adv_graph_watershed_impedance_edges':watershed_imp_total
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
      'blocked_edges':blocked_total,
      'corridor_edges':corridor_total,
      'barrier_edges':barrier_total,
      'rail_corridor_edges':rail_total,'old_road_corridor_edges':road_total,'navigable_river_corridor_edges':river_total,
      'rail_local_km':round(float(rail_local_total),3),'old_road_local_km':round(float(old_road_local_total),3),'navigable_river_local_km':round(float(navigable_local_total),3),
      'relief_barrier_km':round(float(relief_barrier_total_km),3),'main_watershed_barrier_km':round(float(main_watershed_barrier_total_km),3),
      'wetland_impedance_edges':wetland_imp_total,'relief_impedance_edges':relief_imp_total,'watershed_impedance_edges':watershed_imp_total,
      'mixed_corridor_edges':counts.get('mixed_corridor',0)+counts.get('mixed_corridor_impedance',0),
      'normal_contact_edges':counts.get('normal_contact',0),
      'avg_edge_strength':round(float(sum(strength_vals)/len(strength_vals)),6) if strength_vals else 0,
      'avg_edge_impedance':round(float(sum(impedance_vals)/len(impedance_vals)),6) if impedance_vals else 0,
      'avg_degree':round(float(sum(deg.values())/len(deg)),6) if deg else 0,'avg_weighted_degree':round(float(sum(wdeg.values())/len(wdeg)),6) if wdeg else 0,
      'avg_betweenness':round(float(sum(btw.values())/len(btw)),6) if btw else 0,'avg_closeness':round(float(sum(close.values())/len(close)),6) if close else 0,
      'largest_component':max([len(c) for c in comps], default=0)
    })

(OUT/'connectivity_metrics_by_year.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
pd.DataFrame(metrics).to_csv(BASE/'v138_connectivity_metrics_by_year.csv',index=False)
print('done v138',len(metrics))
