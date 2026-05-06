import json, os, glob, csv, math, re
from pathlib import Path
from shapely.geometry import shape, mapping, LineString
from shapely.ops import transform
from shapely.strtree import STRtree
from shapely.validation import make_valid
from pyproj import Transformer, CRS
import networkx as nx

ROOT=Path('/mnt/data/proj_v87')
ADMIN_DIR=ROOT/'data'/'admin'
TOPO_DIR=ROOT/'data'/'topology'
DOCS_DIR=ROOT/'docs'
TOPO_DIR.mkdir(exist_ok=True, parents=True)
DOCS_DIR.mkdir(exist_ok=True, parents=True)

# Equal-area-ish local projection for W Siberia / N Kazakhstan / Urals in meters.
# LAEA centered on central Western Siberia: good enough for boundary length thresholding and node positions.
crs_src=CRS.from_epsg(4326)
crs_dst=CRS.from_proj4('+proj=laea +lat_0=58 +lon_0=82 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
to_m=Transformer.from_crs(crs_src, crs_dst, always_xy=True).transform
from_m=Transformer.from_crs(crs_dst, crs_src, always_xy=True).transform

MIN_BOUNDARY_M=1000.0

SPECIAL_CODES={
    'unstable_control','low_control_frontier','no_uezd_russian_siberia','disputed_affiliation',
    'disputed_berezov_mangazeya','double_tax_volosts','qing_frontier','kazakh_steppe',
    'mining_department','context_only','external_district_context'
}

def as_bool_false(v):
    return v is False or str(v).strip().lower() in {'false','0','нет','no'}

def is_high_subordination(p):
    s=' '.join(str(p.get(k,'')).lower() for k in ['unit_type','name','admin_parent','admin_intermediate','admin_superparent'])
    # Conservative: keep only explicit oblast/republic/krai-subordinated cities if such wording exists.
    return bool(re.search(r'(областн|краев|республикан).{0,25}подчин', s))

def is_small_city_excluded(p):
    ut=str(p.get('unit_type','')).lower()
    name=str(p.get('name','')).lower()
    area=float(p.get('area_km2') or 0)
    is_city=('город' in ut or 'горсовет' in ut or 'городск' in ut or 'город ' in name or name.startswith('г. '))
    return is_city and area>0 and area < 50 and not is_high_subordination(p)

def exclusion_reason(p):
    code=str(p.get('special_status_code') or '').strip()
    name=str(p.get('name') or '').strip()
    area=float(p.get('area_km2') or 0)
    if not name and area < 1:
        return 'unnamed_micro_sliver_lt_1_km2'
    if as_bool_false(p.get('include_in_analytics')) or code in SPECIAL_CODES or (code and code!='normal') or str(p.get('special_status') or '').strip():
        return 'special_or_uncertain_status'
    if is_small_city_excluded(p):
        return 'city_or_gorsovet_area_lt_50_km2'
    return ''

def geom_clean(g):
    try:
        if not g.is_valid:
            g=make_valid(g)
        # extract polygonal parts if geometrycollection
        if g.geom_type=='GeometryCollection':
            parts=[x for x in g.geoms if x.geom_type in ('Polygon','MultiPolygon') and not x.is_empty]
            if not parts:
                return None
            from shapely.geometry import MultiPolygon
            polys=[]
            for p in parts:
                if p.geom_type=='Polygon': polys.append(p)
                elif p.geom_type=='MultiPolygon': polys.extend(list(p.geoms))
            g=MultiPolygon(polys)
        if g.is_empty:
            return None
        return g
    except Exception:
        return None

def finite(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None

def fmt_float(v, nd=6):
    if v is None or not math.isfinite(v): return None
    return round(float(v), nd)

def component_ids(G):
    comp_map={}
    comps=sorted(nx.connected_components(G), key=lambda c:(-len(c), sorted(c)[0] if c else ''))
    for i, comp in enumerate(comps, start=1):
        for n in comp:
            comp_map[n]=i
    return comp_map, {i:len(comp) for i,comp in enumerate(comps,start=1)}

summary=[]
edges_rows=[]
excluded_rows=[]

admin_paths=sorted(ADMIN_DIR.glob('admin_*.geojson'), key=lambda p:int(re.search(r'(\d+)', p.name).group(1)))
for path in admin_paths:
    year=int(re.search(r'(\d+)', path.name).group(1))
    gj=json.load(open(path,encoding='utf-8'))
    features=gj.get('features',[])
    # reset fields
    for idx,f in enumerate(features):
        p=f.setdefault('properties',{})
        if not p.get('unit_id'):
            p['unit_id']=f'adm_{year}_{idx+1}'
        reason=exclusion_reason(p)
        p['topology_excluded']=bool(reason)
        p['topology_exclusion_reason']=reason
        for k in ['topo_degree','topo_degree_centrality','topo_betweenness','topo_closeness','topo_k_core','topo_component_id','topo_component_size','topo_internal_degree','topo_external_degree','topo_external_share','topo_boundary_km_total','topo_boundary_km_avg','topo_graph_nodes','topo_graph_edges','topo_graph_density','topo_graph_components','topo_graph_cyclomatic','topo_articulation_point']:
            p[k]=None if k not in ['topology_excluded'] else p.get(k)
    # prepare included geoms
    items=[]
    for idx,f in enumerate(features):
        p=f['properties']
        if p.get('topology_excluded'):
            excluded_rows.append({'year':year,'unit_id':p.get('unit_id'), 'name':p.get('name'), 'unit_type':p.get('unit_type'), 'area_km2':p.get('area_km2'), 'reason':p.get('topology_exclusion_reason'), 'special_status_code':p.get('special_status_code')})
            continue
        g=geom_clean(shape(f.get('geometry')))
        if g is None:
            p['topology_excluded']=True
            p['topology_exclusion_reason']='empty_or_invalid_geometry'
            excluded_rows.append({'year':year,'unit_id':p.get('unit_id'), 'name':p.get('name'), 'unit_type':p.get('unit_type'), 'area_km2':p.get('area_km2'), 'reason':p.get('topology_exclusion_reason'), 'special_status_code':p.get('special_status_code')})
            continue
        gm=transform(to_m,g)
        if gm.is_empty:
            p['topology_excluded']=True
            p['topology_exclusion_reason']='empty_projected_geometry'
            excluded_rows.append({'year':year,'unit_id':p.get('unit_id'), 'name':p.get('name'), 'unit_type':p.get('unit_type'), 'area_km2':p.get('area_km2'), 'reason':p.get('topology_exclusion_reason'), 'special_status_code':p.get('special_status_code')})
            continue
        rp=transform(from_m, gm.representative_point())
        items.append({'idx':idx,'feature':f,'props':p,'id':str(p.get('unit_id')),'geom':gm,'boundary':gm.boundary,'pt':rp})
    G=nx.Graph()
    for it in items:
        G.add_node(it['id'])
    # adjacency detection
    edges=[]
    if len(items)>1:
        geoms=[it['geom'] for it in items]
        # STRtree in shapely 2 returns indexes
        tree=STRtree(geoms)
        for i,it in enumerate(items):
            candidates=tree.query(it['geom'])
            for j in candidates:
                j=int(j)
                if j<=i: continue
                jt=items[j]
                # bounding / actual shared boundary length
                try:
                    inter=it['boundary'].intersection(jt['boundary'])
                    length=float(inter.length) if not inter.is_empty else 0.0
                except Exception:
                    length=0.0
                if length>=MIN_BOUNDARY_M:
                    a,b=it['id'],jt['id']
                    G.add_edge(a,b,boundary_m=length)
                    edges.append((it,jt,length))
    n=G.number_of_nodes(); m=G.number_of_edges()
    # metrics
    if n:
        deg=dict(G.degree())
        deg_cent=nx.degree_centrality(G) if n>1 else {node:0 for node in G.nodes}
        bet=nx.betweenness_centrality(G, normalized=True) if n>2 else {node:0 for node in G.nodes}
        close=nx.closeness_centrality(G) if n>1 else {node:0 for node in G.nodes}
        try: core=nx.core_number(G)
        except Exception: core={node:0 for node in G.nodes}
        comp_map, comp_sizes=component_ids(G)
        arts=set(nx.articulation_points(G)) if n>1 else set()
        density=nx.density(G) if n>1 else 0.0
        comps=nx.number_connected_components(G) if n else 0
        cyclomatic=m-n+comps if n else 0
        # boundary sums
        boundary_sums={node:0.0 for node in G.nodes}
        for a,b,data in G.edges(data=True):
            boundary_sums[a]+=data.get('boundary_m',0.0)
            boundary_sums[b]+=data.get('boundary_m',0.0)
        byid={it['id']:it for it in items}
        for node in G.nodes:
            p=byid[node]['props']
            parent=str(p.get('admin_parent') or '')
            superp=str(p.get('admin_superparent') or '')
            inter=str(p.get('admin_intermediate') or '')
            internal=0; external=0; internal_super=0; external_super=0
            for nb in G.neighbors(node):
                q=byid[nb]['props']
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
            p['topo_boundary_km_total']=fmt_float(boundary_sums.get(node,0.0)/1000,3)
            p['topo_boundary_km_avg']=fmt_float((boundary_sums.get(node,0.0)/1000)/max(1,deg.get(node,0)),3) if deg.get(node,0) else 0
            p['topo_graph_nodes']=int(n)
            p['topo_graph_edges']=int(m)
            p['topo_graph_density']=fmt_float(density,6)
            p['topo_graph_components']=int(comps)
            p['topo_graph_cyclomatic']=int(cyclomatic)
            p['topo_articulation_point']=bool(node in arts)
        # excluded graph globals
        for f in features:
            p=f['properties']
            if p.get('topology_excluded'):
                p['topo_graph_nodes']=int(n); p['topo_graph_edges']=int(m); p['topo_graph_density']=fmt_float(density,6); p['topo_graph_components']=int(comps); p['topo_graph_cyclomatic']=int(cyclomatic)
    # edge geojson
    edge_features=[]
    for it,jt,length in edges:
        a=it['props']; b=jt['props']
        line=LineString([(it['pt'].x,it['pt'].y),(jt['pt'].x,jt['pt'].y)])
        relation='cross_parent'
        if str(a.get('admin_parent') or '')==str(b.get('admin_parent') or ''):
            relation='same_parent'
        elif str(a.get('admin_superparent') or '') and str(a.get('admin_superparent') or '')==str(b.get('admin_superparent') or ''):
            relation='same_superparent'
        ef={
          'type':'Feature',
          'geometry':mapping(line),
          'properties':{
            'year':year,
            'source_id':a.get('unit_id'), 'source_name':a.get('name'), 'source_parent':a.get('admin_parent'),
            'target_id':b.get('unit_id'), 'target_name':b.get('name'), 'target_parent':b.get('admin_parent'),
            'boundary_km':round(length/1000,3),
            'relation':relation,
            'method':'rook_contiguity_shared_boundary_ge_1km_excluding_special_and_small_cities'
          }
        }
        edge_features.append(ef)
        edges_rows.append({
          'year':year,'source_id':a.get('unit_id'),'source_name':a.get('name'),'source_parent':a.get('admin_parent'),
          'target_id':b.get('unit_id'),'target_name':b.get('name'),'target_parent':b.get('admin_parent'),
          'boundary_km':round(length/1000,3),'relation':relation
        })
    topo={'type':'FeatureCollection','name':f'topology_{year}','features':edge_features,'properties':{'year':year,'nodes':n,'edges':m,'min_shared_boundary_km':1.0,'excluded_special_zones':True,'excluded_small_cities_lt_50_km2':True}}
    json.dump(topo, open(TOPO_DIR/f'topology_{year}.geojson','w',encoding='utf-8'), ensure_ascii=False)
    json.dump(gj, open(path,'w',encoding='utf-8'), ensure_ascii=False)
    summary.append({'year':year,'features_total':len(features),'nodes_in_graph':n,'edges':m,'excluded':len(features)-n,'components':nx.number_connected_components(G) if n else 0,'density':round(nx.density(G),6) if n>1 else 0,'cyclomatic':m-n+(nx.number_connected_components(G) if n else 0),'max_degree':max(dict(G.degree()).values()) if n else 0,'avg_degree':round(sum(dict(G.degree()).values())/n,3) if n else 0})

# update manifest
manifest_path=ROOT/'data'/'manifest.json'
manifest=json.load(open(manifest_path,encoding='utf-8'))
manifest.setdefault('layers',{})['topology']={str(row['year']):f'data/topology/topology_{row["year"]}.geojson' for row in summary}
json.dump(manifest, open(manifest_path,'w',encoding='utf-8'), ensure_ascii=False, indent=2)

# csvs
with open(DOCS_DIR/'v87_topology_graph_summary.csv','w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(summary[0].keys()))
    w.writeheader(); w.writerows(summary)
with open(DOCS_DIR/'v87_topology_graph_edges.csv','w',encoding='utf-8',newline='') as f:
    fields=['year','source_id','source_name','source_parent','target_id','target_name','target_parent','boundary_km','relation']
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(edges_rows)
with open(DOCS_DIR/'v87_topology_graph_excluded_features.csv','w',encoding='utf-8',newline='') as f:
    fields=['year','unit_id','name','unit_type','area_km2','reason','special_status_code']
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(excluded_rows)
print('done', len(summary), 'years')
