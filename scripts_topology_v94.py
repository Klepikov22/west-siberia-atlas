#!/usr/bin/env python3
# Rebuild selected topology layers for Victor's West Siberia atlas.
import json, csv, math, re, os
from pathlib import Path
from itertools import combinations
from collections import defaultdict, Counter

import networkx as nx
from shapely.geometry import shape, mapping, LineString, Point, MultiPolygon
from shapely.ops import transform
from shapely.validation import make_valid
from shapely.strtree import STRtree
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parent
ADMIN_DIR = ROOT/'data'/'admin'
TOPO_DIR = ROOT/'data'/'topology'
DOCS_DIR = ROOT/'docs'
TOPO_DIR.mkdir(parents=True, exist_ok=True)
DOCS_DIR.mkdir(parents=True, exist_ok=True)

TARGET_YEARS = [1700,1719,1724,1727,1783,1805,1821,1838,1848,1918,1923]
MIN_BOUNDARY_M = 1000.0
SNAP_TOL_M = 180.0  # catches sub-pixel/gis digitising gaps without spanning real corridors
NEAR_MIN_BOUNDARY_M = 5000.0  # near-gap repair is intentionally stricter than exact/overlap contiguity
MAX_SLIVER_WIDTH_M = 3500.0
MAX_SLIVER_AREA_SHARE = 0.025

crs_src = CRS.from_epsg(4326)
crs_dst = CRS.from_proj4('+proj=laea +lat_0=58 +lon_0=82 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
to_m = Transformer.from_crs(crs_src, crs_dst, always_xy=True).transform
from_m = Transformer.from_crs(crs_dst, crs_src, always_xy=True).transform

SPECIAL_CODES = {
    'unstable_control','low_control_frontier','weak_control_frontier','weak_control','low_control',
    'no_uezd_russian_siberia','disputed_affiliation','disputed_berezov_mangazeya',
    'double_tax_volosts','qing_frontier','kazakh_steppe','mining_department','context_only',
    'external_district_context','uncertain_or_disputed_by_name','transferred_to_semipalatinsk_context'
}
SPECIAL_NAME_RE = re.compile(r'(спорн|неясн|двоедан|слаб[а-я\- ]*контрол|низк[а-я\- ]*контрол|переданн|передан\b|контекст)', re.I)
CITY_RE = re.compile(r'(город|горсовет|городск|^г\.|\bг\s)', re.I)
UPPER_RE = re.compile(r'(губерния|область|край|республика|наместничество|АО|автономная область)$', re.I)
MIDDLE_RE = re.compile(r'(провинция|округ|отдел)$', re.I)
LOWER_RE = re.compile(r'(уезд|район|волость|административная единица|сельсовет)', re.I)

TOPO_FIELDS = [
 'topo_degree','topo_degree_centrality','topo_betweenness','topo_closeness','topo_k_core',
 'topo_component_id','topo_component_size','topo_internal_degree','topo_external_degree','topo_external_share',
 'topo_super_internal_degree','topo_super_external_degree','topo_boundary_km_total','topo_boundary_km_avg',
 'topo_graph_nodes','topo_graph_edges','topo_graph_density','topo_graph_components','topo_graph_cyclomatic',
 'topo_graph_bridges','topo_graph_articulation_points','topo_articulation_point','topo_articulation_point_computed',
 'topo_bridge_incident_count','topo_bridge_endpoint'
]


def finite(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None

def fmt_float(v, nd=6):
    if v is None: return None
    try:
        n=float(v)
        if not math.isfinite(n): return None
        return round(n, nd)
    except Exception:
        return None

def as_false(v):
    return v is False or str(v).strip().lower() in {'false','0','нет','no','n'}

def is_high_subordination(p):
    s=' '.join(str(p.get(k,'')).lower() for k in ['unit_type','name','admin_parent','admin_intermediate','admin_superparent'])
    return bool(re.search(r'(областн|краев|республикан).{0,25}подчин', s))

def is_small_city_excluded(p):
    area=finite(p.get('area_km2')) or 0.0
    s=' '.join(str(p.get(k,'')).lower() for k in ['unit_type','name'])
    return bool(CITY_RE.search(s)) and 0 < area < 50 and not is_high_subordination(p)

def is_micro_fragment(p):
    area=finite(p.get('area_km2')) or 0.0
    name=str(p.get('name') or '').strip()
    # v94: topology/adjacency ignores all sub-50 km² polygons as cartographic micro-fragments;
    # this also covers the city polygons that should not become graph neighbours.
    return (not name and area < 1.0) or (area > 0 and area < 50.0)

def exclusion_reason(p):
    # Preserve explicit previous exclusions for context / transfer / uncertain layers.
    old_reason=str(p.get('topology_exclusion_reason') or '').strip()
    old_excl=bool(p.get('topology_excluded'))
    name=str(p.get('name') or '')
    unit_type=str(p.get('unit_type') or '')
    code=str(p.get('special_status_code') or '').strip()
    status=str(p.get('special_status') or '').strip()
    role=str(p.get('map_display_role') or '').strip().lower()
    if is_micro_fragment(p):
        return 'micro_or_city_polygon_area_lt_50_km2'
    if as_false(p.get('include_in_analytics')):
        return 'special_or_uncertain_status'
    if code and code != 'normal':
        return 'special_or_uncertain_status'
    if code in SPECIAL_CODES:
        return 'special_or_uncertain_status'
    if status:
        return 'special_or_uncertain_status'
    if SPECIAL_NAME_RE.search(' '.join([name, unit_type, role])):
        return old_reason or 'special_or_uncertain_status'
    if is_small_city_excluded(p):
        return 'city_or_gorsovet_area_lt_50_km2'
    if old_excl and old_reason:
        return old_reason
    return ''

def geom_clean(g):
    try:
        if not g.is_valid:
            g=make_valid(g)
        if g.geom_type=='GeometryCollection':
            polys=[]
            for x in g.geoms:
                if x.geom_type=='Polygon': polys.append(x)
                elif x.geom_type=='MultiPolygon': polys.extend(list(x.geoms))
            if not polys: return None
            g=MultiPolygon(polys)
        if g.is_empty: return None
        return g
    except Exception:
        return None

def representative_lonlat(gm):
    pt=gm.representative_point()
    rp=transform(from_m, pt)
    return rp.x, rp.y

def extract_poly_parts(g):
    if g.is_empty: return []
    if g.geom_type=='Polygon': return [g]
    if g.geom_type=='MultiPolygon': return list(g.geoms)
    if g.geom_type=='GeometryCollection':
        out=[]
        for x in g.geoms:
            out.extend(extract_poly_parts(x))
        return out
    return []

def contact_length_m(g1, g2):
    """Robust estimate of factual contiguity length.
    1) exact shared boundary;
    2) narrow sliver overlap (misregistered borders);
    3) near-coincident digitising gap under SNAP_TOL_M.
    """
    method='shared_boundary'
    length=0.0
    try:
        inter_b = g1.boundary.intersection(g2.boundary)
        if not inter_b.is_empty:
            length=max(length, float(inter_b.length))
    except Exception:
        pass
    if length >= MIN_BOUNDARY_M:
        return length, method

    try:
        inter = g1.intersection(g2)
        if not inter.is_empty:
            parts=extract_poly_parts(inter)
            if parts:
                per=sum(float(p.boundary.length) for p in parts)
                area=sum(float(p.area) for p in parts)
                est=per/2.0
                min_area=max(1.0, min(float(g1.area), float(g2.area)))
                width=area/max(est,1.0)
                if est >= MIN_BOUNDARY_M and (area/min_area <= MAX_SLIVER_AREA_SHARE or width <= MAX_SLIVER_WIDTH_M):
                    return est, 'overlap_sliver_boundary'
            # GeometryCollection line overlaps sometimes land here.
            line_len=0.0
            if inter.geom_type in ('LineString','MultiLineString','LinearRing'):
                line_len=float(inter.length)
            elif inter.geom_type=='GeometryCollection':
                for x in inter.geoms:
                    if x.geom_type in ('LineString','MultiLineString','LinearRing'):
                        line_len+=float(x.length)
            if line_len >= MIN_BOUNDARY_M:
                return line_len, 'intersection_line_boundary'
    except Exception:
        pass

    try:
        if g1.distance(g2) <= SNAP_TOL_M:
            # estimate coincident border length within tolerance; min() suppresses point/corner contacts.
            near1 = g1.boundary.intersection(g2.buffer(SNAP_TOL_M)).length
            near2 = g2.boundary.intersection(g1.buffer(SNAP_TOL_M)).length
            near = min(float(near1), float(near2))
            if near >= NEAR_MIN_BOUNDARY_M:
                return near, 'near_coincident_boundary_snap'
    except Exception:
        pass
    return 0.0, 'none'

def relation(a,b):
    ap=str(a.get('admin_parent') or '')
    bp=str(b.get('admin_parent') or '')
    asup=str(a.get('admin_superparent') or '')
    bsup=str(b.get('admin_superparent') or '')
    if ap and ap==bp: return 'same_parent'
    if asup and asup==bsup: return 'same_superparent'
    return 'cross_parent'

def component_ids(G):
    comp_map={}; sizes={}
    comps=sorted(nx.connected_components(G), key=lambda c:(-len(c), sorted(c)[0] if c else ''))
    for i,comp in enumerate(comps,1):
        sizes[i]=len(comp)
        for n in comp: comp_map[n]=i
    return comp_map, sizes

def safe_sum(vals):
    xs=[finite(v) for v in vals]
    xs=[x for x in xs if x is not None]
    return sum(xs) if xs else None

def write_json(path,obj,indent=None):
    with open(path,'w',encoding='utf-8') as f:
        json.dump(obj,f,ensure_ascii=False,indent=indent)

def rebuild_year(year):
    path=ADMIN_DIR/f'admin_{year}.geojson'
    gj=json.load(open(path,encoding='utf-8'))
    features=gj.get('features',[])

    # v94 explicit cleanup: remove the detached Turukhansk micro-fragment in 1805.
    removed=[]
    if year==1805:
        new=[]
        for f in features:
            p=f.get('properties') or {}
            if str(p.get('unit_id'))=='adm_1805_017' and 'Турухан' in str(p.get('name') or ''):
                removed.append({'unit_id':p.get('unit_id'), 'name':p.get('name'), 'area_km2':p.get('area_km2')})
                continue
            new.append(f)
        features=new
        gj['features']=features

    items=[]; excluded=[]; geoms=[]
    for idx,f in enumerate(features):
        p=f.setdefault('properties',{})
        if not p.get('unit_id'):
            p['unit_id']=f'adm_{year}_{idx+1:03d}'
        # clean geometry and recalc area for layer itself.
        g=geom_clean(shape(f.get('geometry')))
        if g is None:
            reason='empty_or_invalid_geometry'
        else:
            gm=transform(to_m, g)
            p['area_km2']=round(float(gm.area)/1e6,3)
            reason=exclusion_reason(p)
        p['topology_excluded']=bool(reason)
        p['topology_exclusion_reason']=reason
        p['adjacency_excluded']=bool(reason)
        p['adjacency_exclusion_reason']=reason
        p['adjacency_method']='v94_factual_rook_contiguity_excluding_special_uncertain_small_cities'
        p['adjacent_count']=None if reason else 0
        p['adjacent_names']='' if reason else []
        p['adjacent_unit_ids']='' if reason else []
        p['adjacent_units']='' if reason else []
        for k in TOPO_FIELDS:
            p[k]=None
        if reason:
            excluded.append({'year':year,'unit_id':p.get('unit_id'),'name':p.get('name'),'unit_type':p.get('unit_type'),'area_km2':p.get('area_km2'),'reason':reason,'special_status_code':p.get('special_status_code')})
            continue
        if g is None:
            continue
        gm=transform(to_m,g)
        lon,lat=representative_lonlat(gm)
        item={'idx':idx,'feature':f,'props':p,'id':str(p.get('unit_id')),'geom':gm,'lon':lon,'lat':lat}
        items.append(item); geoms.append(gm)

    G=nx.Graph()
    for it in items:
        G.add_node(it['id'])
    edges=[]
    if len(items)>1:
        tree=STRtree(geoms)
        for i,it in enumerate(items):
            # query with small buffer to catch near-coincident boundaries
            candidates=tree.query(it['geom'].buffer(SNAP_TOL_M))
            for j in candidates:
                j=int(j)
                if j<=i: continue
                jt=items[j]
                length, method=contact_length_m(it['geom'], jt['geom'])
                if length >= MIN_BOUNDARY_M:
                    a,b=it['id'],jt['id']
                    if a==b: continue
                    rel=relation(it['props'],jt['props'])
                    G.add_edge(a,b,boundary_m=length,relation=rel,method=method)
                    edges.append((it,jt,length,rel,method))

    n=G.number_of_nodes(); m=G.number_of_edges()
    deg=dict(G.degree())
    if n:
        deg_cent=nx.degree_centrality(G) if n>1 else {node:0 for node in G.nodes}
        bet=nx.betweenness_centrality(G, normalized=True) if n>2 else {node:0 for node in G.nodes}
        close=nx.closeness_centrality(G) if n>1 else {node:0 for node in G.nodes}
        try: core=nx.core_number(G)
        except Exception: core={node:0 for node in G.nodes}
        comp_map, comp_sizes=component_ids(G)
        arts=set(nx.articulation_points(G)) if n>1 else set()
        bridges=set(tuple(sorted(e)) for e in nx.bridges(G)) if n>1 else set()
        density=nx.density(G) if n>1 else 0.0
        comps=nx.number_connected_components(G) if n else 0
        cyclomatic=m-n+comps if n else 0
        boundary_sums={node:0.0 for node in G.nodes}
        bridge_incident=Counter()
        for a,b,data in G.edges(data=True):
            boundary_sums[a]+=data.get('boundary_m',0.0)
            boundary_sums[b]+=data.get('boundary_m',0.0)
            if tuple(sorted((a,b))) in bridges:
                bridge_incident[a]+=1; bridge_incident[b]+=1
        byid={it['id']:it for it in items}
        for node in G.nodes:
            p=byid[node]['props']
            parent=str(p.get('admin_parent') or '')
            superp=str(p.get('admin_superparent') or '')
            internal=external=internal_super=external_super=0
            neigh_names=[]; neigh_ids=[]
            for nb in sorted(G.neighbors(node), key=lambda x: byid[x]['props'].get('name') or ''):
                q=byid[nb]['props']
                neigh_names.append(q.get('name') or nb); neigh_ids.append(nb)
                if str(q.get('admin_parent') or '')==parent: internal+=1
                else: external+=1
                if superp and str(q.get('admin_superparent') or '')==superp: internal_super+=1
                elif superp: external_super+=1
            p['topo_degree']=int(deg.get(node,0))
            p['topo_degree_centrality']=fmt_float(deg_cent.get(node,0),6)
            p['topo_betweenness']=fmt_float(bet.get(node,0),6)
            p['topo_closeness']=fmt_float(close.get(node,0),6)
            p['topo_k_core']=int(core.get(node,0))
            p['topo_component_id']=int(comp_map.get(node,0))
            p['topo_component_size']=int(comp_sizes.get(comp_map.get(node,0),0))
            p['topo_internal_degree']=int(internal)
            p['topo_external_degree']=int(external)
            p['topo_external_share']=fmt_float(external/max(1,deg.get(node,0)),6) if deg.get(node,0) else 0
            p['topo_super_internal_degree']=int(internal_super)
            p['topo_super_external_degree']=int(external_super)
            p['topo_boundary_km_total']=round(boundary_sums.get(node,0.0)/1000,3)
            p['topo_boundary_km_avg']=round((boundary_sums.get(node,0.0)/1000)/max(1,deg.get(node,0)),3) if deg.get(node,0) else 0
            p['topo_graph_nodes']=int(n); p['topo_graph_edges']=int(m); p['topo_graph_density']=fmt_float(density,6)
            p['topo_graph_components']=int(comps); p['topo_graph_cyclomatic']=int(cyclomatic)
            p['topo_graph_bridges']=int(len(bridges)); p['topo_graph_articulation_points']=int(len(arts))
            p['topo_articulation_point']=bool(node in arts); p['topo_articulation_point_computed']=bool(node in arts)
            p['topo_bridge_incident_count']=int(bridge_incident.get(node,0)); p['topo_bridge_endpoint']=bool(bridge_incident.get(node,0)>0)
            p['adjacent_count']=int(deg.get(node,0))
            p['adjacent_names']=neigh_names
            p['adjacent_unit_ids']=neigh_ids
            p['adjacent_units']=[{'unit_id':uid,'name':byid[uid]['props'].get('name')} for uid in neigh_ids]
        for f in features:
            p=f['properties']
            if p.get('topology_excluded'):
                p['topo_graph_nodes']=int(n); p['topo_graph_edges']=int(m); p['topo_graph_density']=fmt_float(density,6)
                p['topo_graph_components']=int(comps); p['topo_graph_cyclomatic']=int(cyclomatic)
                p['topo_graph_bridges']=int(len(bridges)); p['topo_graph_articulation_points']=int(len(arts))

    # Edge geojson
    bridges=set(tuple(sorted(e)) for e in nx.bridges(G)) if n>1 else set()
    edge_features=[]
    for it,jt,length,rel,method in sorted(edges, key=lambda e:(e[0]['props'].get('name') or '', e[1]['props'].get('name') or '')):
        a=it['props']; b=jt['props']
        line=LineString([(it['lon'],it['lat']),(jt['lon'],jt['lat'])])
        key=tuple(sorted((it['id'],jt['id'])))
        edge_features.append({'type':'Feature','geometry':mapping(line),'properties':{
            'year':year,
            'source_id':a.get('unit_id'), 'source_name':a.get('name'), 'source_parent':a.get('admin_parent'),
            'target_id':b.get('unit_id'), 'target_name':b.get('name'), 'target_parent':b.get('admin_parent'),
            'boundary_km':round(length/1000,3), 'relation':rel,
            'method':'v94_factual_rook_contiguity_shared_overlap_or_snap_ge_1km_excluding_special_uncertain_small_cities',
            'contact_method':method,
            'is_bridge': bool(key in bridges)
        }})
    topo={'type':'FeatureCollection','name':f'topology_{year}','features':edge_features,
          'properties':{'year':year,'nodes':n,'edges':m,'min_shared_boundary_km':1.0,
                        'excluded_special_zones':True,'excluded_small_cities_lt_50_km2':True,
                        'excluded_special_uncertain_zones':True,'excluded_microfragments_lt_50_km2':True,
                        'algorithm':'v94_factual_rook_contiguity_shared_boundary_overlap_sliver_or_snap'}}
    write_json(TOPO_DIR/f'topology_{year}.geojson', topo)

    # Node geojson
    node_features=[]
    byid={it['id']:it for it in items}
    for node in sorted(G.nodes, key=lambda uid: byid[uid]['props'].get('name') or uid):
        it=byid[node]; p=dict(it['props'])
        p['topology_node_id']=node; p['node_lon']=it['lon']; p['node_lat']=it['lat']; p['year']=year
        node_features.append({'type':'Feature','geometry':{'type':'Point','coordinates':[it['lon'],it['lat']]},'properties':p})
    nodes={'type':'FeatureCollection','name':f'topology_nodes_{year}','features':node_features,
           'properties':{'year':year,'nodes':n,'rebuilt_v94':True,'nodes_snap_to_admin_representative_points':True}}
    write_json(TOPO_DIR/f'topology_nodes_{year}.geojson', nodes)
    write_json(path, gj)

    rel_counts=Counter(e[3] for e in edges)
    vals=lambda field: [finite(byid[node]['props'].get(field)) for node in G.nodes if finite(byid[node]['props'].get(field)) is not None]
    def avg(field):
        xs=vals(field); return round(sum(xs)/len(xs),6) if xs else 0
    def max_name(field):
        best=None
        for node in G.nodes:
            p=byid[node]['props']; v=finite(p.get(field))
            if v is None: continue
            if best is None or v>best[0]: best=(v,p.get('name'))
        return best or (0,'—')
    maxdeg=max_name('topo_degree'); maxbet=max_name('topo_betweenness'); maxclose=max_name('topo_closeness'); maxcore=max_name('topo_k_core')
    summary={'year':year,'features_total':len(features),'nodes_in_graph':n,'edges':m,'excluded':len(features)-n,
             'components':nx.number_connected_components(G) if n else 0,
             'density':round(nx.density(G),6) if n>1 else 0,
             'cyclomatic':m-n+(nx.number_connected_components(G) if n else 0),
             'bridges':len(bridges),'articulation_points':len(list(nx.articulation_points(G))) if n>1 else 0,
             'max_degree':max(dict(G.degree()).values()) if n else 0,
             'avg_degree':round(sum(dict(G.degree()).values())/n,3) if n else 0,
             'removed_features':json.dumps(removed,ensure_ascii=False) if removed else ''}
    metrics={'year':year,'nodes':n,'edges':m,'components':summary['components'],'graph_density':summary['density'],
             'cyclomatic':summary['cyclomatic'],'articulation_points':summary['articulation_points'],
             'avg_degree':round(sum(dict(G.degree()).values())/n,6) if n else 0,
             'avg_degree_centrality':avg('topo_degree_centrality'),'avg_betweenness':avg('topo_betweenness'),
             'avg_closeness':avg('topo_closeness'),'avg_k_core':avg('topo_k_core'),
             'avg_external_degree':avg('topo_external_degree'),'avg_internal_degree':avg('topo_internal_degree'),
             'avg_external_share':avg('topo_external_share'),'avg_super_external_degree':avg('topo_super_external_degree'),
             'same_parent_edges':rel_counts.get('same_parent',0),'same_superparent_edges':rel_counts.get('same_superparent',0),
             'cross_parent_edges':rel_counts.get('cross_parent',0),'other_edges':m-rel_counts.get('same_parent',0)-rel_counts.get('same_superparent',0)-rel_counts.get('cross_parent',0),
             'max_degree':maxdeg[0],'max_degree_name':maxdeg[1],
             'max_betweenness':maxbet[0],'max_betweenness_name':maxbet[1],
             'max_closeness':maxclose[0],'max_closeness_name':maxclose[1],
             'max_k_core':maxcore[0],'max_k_core_name':maxcore[1],
             'bridges':len(bridges),'articulation_points_computed':summary['articulation_points']}
    edge_rows=[]
    for ef in edge_features:
        p=ef['properties']
        edge_rows.append({'year':year,'source_id':p['source_id'],'source_name':p['source_name'],'source_parent':p['source_parent'],
                          'target_id':p['target_id'],'target_name':p['target_name'],'target_parent':p['target_parent'],
                          'boundary_km':p['boundary_km'],'relation':p['relation'],'contact_method':p['contact_method'],'is_bridge':p['is_bridge']})
    return summary, metrics, edge_rows, excluded


def admin_metrics_for_year(year, topo_metric_by_year):
    gj=json.load(open(ADMIN_DIR/f'admin_{year}.geojson',encoding='utf-8'))
    feats=gj.get('features',[])
    analytic=[]
    for f in feats:
        p=f.get('properties') or {}
        # Use topology/adjacency exclusion after v94 rebuild if available; otherwise preserve existing topology_excluded.
        if not p.get('topology_excluded'):
            analytic.append(f)
    areas=[finite(f['properties'].get('area_km2')) for f in analytic]
    areas=[a for a in areas if a is not None and a>0]
    pops=[finite(f['properties'].get('population')) for f in analytic]
    pops=[p for p in pops if p is not None and p>=0]
    urban=[finite(f['properties'].get('urban_pop')) for f in analytic]
    urban=[u for u in urban if u is not None and u>=0]
    rural=[finite(f['properties'].get('rural_pop')) for f in analytic]
    rural=[r for r in rural if r is not None and r>=0]
    rail=[finite(f['properties'].get('rail_length_km')) for f in analytic]
    rail=[r for r in rail if r is not None and r>=0]
    rail_seg=[finite(f['properties'].get('rail_segments_count')) for f in analytic]
    rail_seg=[r for r in rail_seg if r is not None and r>=0]
    degrees=[finite(f['properties'].get('topo_degree')) for f in analytic]
    degrees=[d for d in degrees if d is not None]
    total_area=sum(areas) if areas else None
    total_pop=sum(pops) if pops else None
    total_urban=sum(urban) if urban else None
    total_rural=sum(rural) if rural else None
    rail_total=sum(rail) if rail else 0.0

    # Count administrative levels from parent/intermediate/superparent distinct values and leaf count.
    supers=set(); mids=set(); lowers=0
    for f in analytic:
        p=f['properties']
        sup=str(p.get('admin_superparent') or '').strip()
        parent=str(p.get('admin_parent') or '').strip()
        inter=str(p.get('admin_intermediate') or '').strip()
        name=str(p.get('name') or '').strip()
        if sup: supers.add(sup)
        if inter and inter not in {sup, parent, name}: mids.add(inter)
        elif parent and parent not in {sup, name}: mids.add(parent)
        lowers+=1
    row={
        'year':year,
        'ate_total_count':len(feats),
        'upper_ate_count':len(supers) or (1 if analytic else 0),
        'middle_ate_count':len(mids),
        'lower_ate_count':lowers,
        'total_area_km2':round(total_area,3) if total_area is not None else None,
        'avg_area_km2':round(total_area/len(areas),3) if areas else None,
        'total_population':round(total_pop,3) if total_pop is not None else None,
        'avg_population':round(total_pop/len(pops),3) if pops else None,
        'population_density':round(total_pop/total_area,6) if total_pop is not None and total_area else None,
        'urban_population':round(total_urban,3) if total_urban is not None else None,
        'rural_population':round(total_rural,3) if total_rural is not None else None,
        'urban_share':round(total_urban/total_pop,6) if total_urban is not None and total_pop else None,
        'rail_length_km_total':round(rail_total,3),
        'rail_density_km_1000':round(rail_total/total_area*1000,6) if total_area else None,
        'rail_segments_count_sum':round(sum(rail_seg),3) if rail_seg else 0.0,
        'avg_adjacency':round(sum(degrees)/len(degrees),6) if degrees else None,
        'source_admin_features':len(feats),
        'analytics_features':len(analytic),
    }
    if year in topo_metric_by_year:
        row.update(topo_metric_by_year[year])
    return row

# Rebuild target topology/admin layers.
summaries=[]; metric_rows_by_year={}; all_edges=[]; all_excluded=[]
for y in TARGET_YEARS:
    s,m,edges,excluded=rebuild_year(y)
    summaries.append(s); metric_rows_by_year[y]=m; all_edges.extend(edges); all_excluded.extend(excluded)

# Merge topology metrics for all years: recompute selected, keep others from current JSON.
metrics_path=TOPO_DIR/'topology_metrics_by_year.json'
old_metrics=[]
if metrics_path.exists(): old_metrics=json.load(open(metrics_path,encoding='utf-8'))
old_by_year={int(r['year']):r for r in old_metrics}
old_by_year.update(metric_rows_by_year)
metric_rows=[old_by_year[y] for y in sorted(old_by_year)]
write_json(metrics_path, metric_rows, indent=2)

# Recompute multiyear metrics over all admin years, using updated topology metrics where available.
topo_metric_by_year={int(r['year']):r for r in metric_rows}
years=[]
for p in ADMIN_DIR.glob('admin_*.geojson'):
    m=re.search(r'(\d+)', p.name)
    if m: years.append(int(m.group(1)))
multiyear=[admin_metrics_for_year(y, topo_metric_by_year) for y in sorted(years)]
write_json(TOPO_DIR/'multiyear_metrics_by_year.json', multiyear, indent=2)

# Update manifest and version metadata.
manifest_path=ROOT/'data'/'manifest.json'
manifest=json.load(open(manifest_path,encoding='utf-8'))
manifest.setdefault('layers',{})['topology']={str(y):f'data/topology/topology_{y}.geojson' for y in sorted(years) if (TOPO_DIR/f'topology_{y}.geojson').exists()}
manifest.setdefault('layers',{})['topology_nodes']={str(y):f'data/topology/topology_nodes_{y}.geojson' for y in sorted(years) if (TOPO_DIR/f'topology_nodes_{y}.geojson').exists()}
manifest.setdefault('layers',{})['topology_metrics']='data/topology/topology_metrics_by_year.json'
manifest.setdefault('layers',{})['multiyear_metrics']='data/topology/multiyear_metrics_by_year.json'
write_json(manifest_path, manifest, indent=2)

# Docs CSVs.
with open(DOCS_DIR/'v94_topology_graph_summary.csv','w',encoding='utf-8',newline='') as f:
    fields=list(summaries[0].keys())
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(summaries)
with open(DOCS_DIR/'v94_topology_graph_edges.csv','w',encoding='utf-8',newline='') as f:
    fields=['year','source_id','source_name','source_parent','target_id','target_name','target_parent','boundary_km','relation','contact_method','is_bridge']
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(all_edges)
with open(DOCS_DIR/'v94_topology_graph_excluded_features.csv','w',encoding='utf-8',newline='') as f:
    fields=['year','unit_id','name','unit_type','area_km2','reason','special_status_code']
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(all_excluded)

print('v94 rebuild done')
for s in summaries:
    print(s['year'], 'nodes', s['nodes_in_graph'], 'edges', s['edges'], 'excluded', s['excluded'], 'removed', s['removed_features'])
