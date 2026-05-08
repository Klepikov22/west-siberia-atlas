#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v104: adjust multiyear trend statistics for a custom Western Siberia scope.
Only the multiyear statistics JSON is changed; source admin/topology map layers stay intact.
"""
from __future__ import annotations
import csv, json, math, re
from pathlib import Path
from collections import Counter, defaultdict
import networkx as nx

ROOT=Path(__file__).resolve().parent
ADMIN_DIR=ROOT/'data'/'admin'
TOPO_DIR=ROOT/'data'/'topology'
DOCS_DIR=ROOT/'docs'
DOCS_DIR.mkdir(exist_ok=True)

# Year-specific statistical-frame exclusions requested by Victor.
EXCLUSIONS={
    1926:{'Шадринский округ','Курганский округ','Ирбитский округ'},
    1930:{'Ачинский округ'},
    2021:{'Курганская область'},
}

POP_KEYS=('population','urban_pop','rural_pop')


def finite(v):
    try:
        if v is None or v=='': return None
        n=float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def load_json(p:Path):
    with p.open('r',encoding='utf-8') as f: return json.load(f)


def write_json(p:Path,obj):
    with p.open('w',encoding='utf-8') as f:
        json.dump(obj,f,ensure_ascii=False,indent=2)
        f.write('\n')


def unit_id(f):
    p=f.get('properties') or {}
    return str(p.get('unit_id') or p.get('topology_node_id') or '').strip()


def exclude_reason(p, year:int):
    targets=EXCLUSIONS.get(year,set())
    vals=[str(p.get(k) or '').strip() for k in ('admin_parent','admin_intermediate','admin_superparent')]
    for v in vals:
        if v in targets:
            return v
    # For safety: if a middle/upper feature itself is ever stored as a polygon.
    name=str(p.get('name') or '').strip()
    if name in targets:
        return name
    return None


def is_in_scope(f, year:int):
    return exclude_reason(f.get('properties') or {},year) is None


def is_analytic(f):
    p=f.get('properties') or {}
    if p.get('include_in_analytics') is False: return False
    if p.get('topology_excluded'): return False
    code=str(p.get('special_status_code') or 'normal').strip().lower()
    if code not in ('','normal','none'): return False
    return True


def is_hierarchy_normal(f):
    if not is_analytic(f): return False
    a=finite((f.get('properties') or {}).get('area_km2'))
    return a is None or a>=50


def hierarchy_keys(p):
    sup=str(p.get('admin_superparent') or '').strip()
    parent=str(p.get('admin_parent') or '').strip()
    inter=str(p.get('admin_intermediate') or '').strip()
    name=str(p.get('name') or '').strip()
    mid=''
    if inter and inter not in {sup,parent,name}: mid=inter
    elif parent and parent not in {sup,name}: mid=parent
    return sup,mid,parent


def graph_metrics(year:int, scoped_analytic):
    admin_props={unit_id(f):(f.get('properties') or {}) for f in scoped_analytic if unit_id(f)}
    topo_nodes_path=TOPO_DIR/f'topology_nodes_{year}.geojson'
    topo_edges_path=TOPO_DIR/f'topology_{year}.geojson'
    if not topo_nodes_path.exists() or not topo_edges_path.exists():
        return {}
    node_gj=load_json(topo_nodes_path)
    edge_gj=load_json(topo_edges_path)
    allowed=set()
    for f in node_gj.get('features',[]):
        p=f.get('properties') or {}
        uid=str(p.get('unit_id') or p.get('topology_node_id') or '').strip()
        if uid and uid in admin_props:
            allowed.add(uid)
    G=nx.Graph()
    G.add_nodes_from(allowed)
    edge_rows=[]
    relation_counts=Counter()
    internal=Counter(); external=Counter(); super_external=Counter()
    for e in edge_gj.get('features',[]):
        p=e.get('properties') or {}
        u=str(p.get('source_id') or '').strip(); v=str(p.get('target_id') or '').strip()
        if not u or not v or u not in allowed or v not in allowed: continue
        rel=str(p.get('relation') or 'unknown')
        G.add_edge(u,v,relation=rel,boundary_km=finite(p.get('boundary_km')) or 0.0)
        edge_rows.append((u,v,rel,p))
        relation_counts[rel]+=1
        if rel=='same_parent':
            internal[u]+=1; internal[v]+=1
        else:
            external[u]+=1; external[v]+=1
        su=admin_props.get(u,{}).get('admin_superparent')
        sv=admin_props.get(v,{}).get('admin_superparent')
        if su!=sv:
            super_external[u]+=1; super_external[v]+=1
    n=G.number_of_nodes(); m=G.number_of_edges()
    if n==0:
        return {
            'nodes':0,'edges':0,'components':0,'graph_density':None,'cyclomatic':None,'articulation_points':0,
            'avg_degree':None,'avg_degree_centrality':None,'avg_betweenness':None,'avg_closeness':None,'avg_k_core':None,
            'avg_external_degree':None,'avg_internal_degree':None,'avg_external_share':None,'avg_super_external_degree':None,
            'same_parent_edges':0,'same_superparent_edges':0,'cross_parent_edges':0,'other_edges':0,
            'max_degree':None,'max_degree_name':'—','max_betweenness':None,'max_betweenness_name':'—',
            'max_closeness':None,'max_closeness_name':'—','max_k_core':None,'max_k_core_name':'—','bridges':0,'articulation_points_computed':0,
        }
    comps=nx.number_connected_components(G)
    deg=dict(G.degree())
    dc=nx.degree_centrality(G) if n>1 else {u:0.0 for u in G.nodes}
    bc=nx.betweenness_centrality(G,normalized=True) if n>1 and m>0 else {u:0.0 for u in G.nodes}
    cc=nx.closeness_centrality(G) if n>1 and m>0 else {u:0.0 for u in G.nodes}
    try:
        core=nx.core_number(G) if m>0 else {u:0 for u in G.nodes}
    except Exception:
        core={u:0 for u in G.nodes}
    bridges=list(nx.bridges(G)) if m>0 else []
    arts=list(nx.articulation_points(G)) if m>0 else []
    def avg(vals):
        vals=list(vals)
        return sum(vals)/len(vals) if vals else None
    ext_share=[]
    for u in G.nodes:
        d=deg.get(u,0)
        ext_share.append((external[u]/d) if d else 0.0)
    def best_value(mapping, reverse=True):
        if not mapping: return (None,'—')
        items=list(mapping.items())
        items.sort(key=lambda kv:(kv[1], admin_props.get(kv[0],{}).get('name') or kv[0]), reverse=reverse)
        uid,val=items[0]
        return val, admin_props.get(uid,{}).get('name') or uid
    maxdeg,maxdegname=best_value(deg)
    maxb,maxbname=best_value(bc)
    maxc,maxcname=best_value(cc)
    maxcore,maxcorename=best_value(core)
    return {
        'nodes':n,
        'edges':m,
        'components':comps,
        'graph_density':round(nx.density(G),6) if n>1 else 0.0,
        'cyclomatic':m-n+comps,
        'articulation_points':len(arts),
        'avg_degree':round(avg(deg.values()),6),
        'avg_degree_centrality':round(avg(dc.values()),6),
        'avg_betweenness':round(avg(bc.values()),6),
        'avg_closeness':round(avg(cc.values()),6),
        'avg_k_core':round(avg(core.values()),6),
        'avg_external_degree':round(avg(external[u] for u in G.nodes),6),
        'avg_internal_degree':round(avg(internal[u] for u in G.nodes),6),
        'avg_external_share':round(avg(ext_share),6),
        'avg_super_external_degree':round(avg(super_external[u] for u in G.nodes),6),
        'same_parent_edges':relation_counts.get('same_parent',0),
        'same_superparent_edges':relation_counts.get('same_superparent',0),
        'cross_parent_edges':relation_counts.get('cross_parent',0),
        'other_edges':sum(v for k,v in relation_counts.items() if k not in {'same_parent','same_superparent','cross_parent'}),
        'max_degree':float(maxdeg) if maxdeg is not None else None,
        'max_degree_name':maxdegname,
        'max_betweenness':round(float(maxb),6) if maxb is not None else None,
        'max_betweenness_name':maxbname,
        'max_closeness':round(float(maxc),6) if maxc is not None else None,
        'max_closeness_name':maxcname,
        'max_k_core':float(maxcore) if maxcore is not None else None,
        'max_k_core_name':maxcorename,
        'bridges':len(bridges),
        'articulation_points_computed':len(arts),
    }


def metrics_for_year(year:int, old_row:dict):
    gj=load_json(ADMIN_DIR/f'admin_{year}.geojson')
    feats=gj.get('features',[])
    in_scope=[f for f in feats if is_in_scope(f,year)]
    excluded=[f for f in feats if not is_in_scope(f,year)]
    analytic=[f for f in in_scope if is_analytic(f)]
    normal=[f for f in in_scope if is_hierarchy_normal(f)]
    areas=[finite((f.get('properties') or {}).get('area_km2')) for f in analytic]
    areas=[a for a in areas if a is not None and a>0]
    total_area=sum(areas) if areas else None
    # Population in v103 method: all in-scope analytical objects, including small city polygons.
    pop_feats=[f for f in in_scope if (f.get('properties') or {}).get('include_in_analytics') is not False]
    pops=[finite((f.get('properties') or {}).get('population')) for f in pop_feats]
    pops_nonneg=[p for p in pops if p is not None and p>=0]
    pops_positive=[p for p in pops if p is not None and p>0]
    total_pop=sum(pops_nonneg) if pops_nonneg else None
    urbans=[finite((f.get('properties') or {}).get('urban_pop')) for f in pop_feats]
    urbans=[u for u in urbans if u is not None and u>=0]
    total_urban=sum(urbans) if urbans else None
    total_rural=(total_pop-total_urban) if total_pop is not None and total_urban is not None else None
    rails=[finite((f.get('properties') or {}).get('rail_length_km')) for f in analytic]
    rails=[r for r in rails if r is not None and r>=0]
    rail_segs=[finite((f.get('properties') or {}).get('rail_segments_count')) for f in analytic]
    rail_segs=[r for r in rail_segs if r is not None and r>=0]
    supers=set(); mids=set(); lowers=0; parents=set()
    for f in analytic:
        p=f.get('properties') or {}
        sup,mid,parent=hierarchy_keys(p)
        if sup: supers.add(sup)
        if mid: mids.add(mid)
        if parent: parents.add(parent)
        lowers+=1
    row=dict(old_row)
    row.update({
        'ate_total_count':len(in_scope),
        'upper_ate_count':len(supers) or (1 if analytic else 0),
        'middle_ate_count':len(mids),
        'lower_ate_count':lowers,
        'total_area_km2':round(total_area,3) if total_area is not None else None,
        'avg_area_km2':round(total_area/len(areas),3) if areas else None,
        'total_population':round(total_pop,3) if total_pop is not None else None,
        'avg_population':round(total_pop/len(pops_positive),6) if total_pop is not None and pops_positive else None,
        'population_density':round(total_pop/total_area,6) if total_pop is not None and total_area else None,
        'urban_population':round(total_urban,3) if total_urban is not None else None,
        'rural_population':round(total_rural,3) if total_rural is not None else None,
        'urban_share':round(total_urban/total_pop,6) if total_urban is not None and total_pop else None,
        'rail_length_km_total':round(sum(rails),3) if rails else 0.0,
        'rail_density_km_1000':round((sum(rails)/total_area*1000),6) if total_area else None,
        'rail_segments_count_sum':round(sum(rail_segs),3) if rail_segs else 0.0,
        'source_admin_features':len(in_scope),
        'analytics_features':len(analytic),
    })
    gmetrics=graph_metrics(year,analytic)
    row.update(gmetrics)
    if gmetrics.get('avg_degree') is not None:
        row['avg_adjacency']=gmetrics.get('avg_degree')
    # v100 hierarchy metrics, recalculated on normal polygons >=50 km2 inside the v104 scope.
    normal_areas_by_sup=defaultdict(float); normal_areas_by_mid=defaultdict(float); normal_areas_by_parent=defaultdict(float)
    normal_sup=set(); normal_mid=set(); normal_parent=set()
    for f in normal:
        p=f.get('properties') or {}
        a=finite(p.get('area_km2')) or 0.0
        sup,mid,parent=hierarchy_keys(p)
        if sup:
            normal_sup.add(sup); normal_areas_by_sup[sup]+=a
        if mid:
            normal_mid.add(mid); normal_areas_by_mid[mid]+=a
        if parent:
            normal_parent.add(parent); normal_areas_by_parent[parent]+=a
    total_normal_area=sum(normal_areas_by_sup.values())
    row.update({
        'v100_normal_features':len(normal),
        'upper_ate_count_v100':len(normal_sup) or (1 if normal else 0),
        'middle_ate_count_v100':len(normal_mid),
        'parent_ate_count':len(normal_parent),
        'avg_lower_units_per_upper_ate':round(len(normal)/(len(normal_sup) or 1),6) if normal else None,
        'avg_lower_units_per_parent_ate':round(len(normal)/len(normal_parent),6) if normal_parent else None,
        'avg_area_upper_ate_km2':round(total_normal_area/len(normal_sup),3) if normal_sup else None,
        'avg_area_middle_ate_km2':round(sum(normal_areas_by_mid.values())/len(normal_mid),3) if normal_mid else None,
        'avg_area_parent_ate_km2':round(sum(normal_areas_by_parent.values())/len(normal_parent),3) if normal_parent else None,
        'hierarchy_metrics_method_v100':'normal analytic polygons only; topology/adjacency excluded, special_status_code!=normal, include_in_analytics=false and area<50 km2 removed; upper/middle areas are sums of leaf polygon areas by hierarchy keys',
        'population_metrics_method_v103':'sum of population over all include_in_analytics!=false admin GeoJSON features; city/small polygons under 50 km2 are included for population, but remain excluded from topology/adjacency',
    })
    # v103 diagnostics recalculated in the new v104 scope.
    row['population_features_v103']=len(pop_feats)
    row['population_nonzero_features_v103']=len(pops_positive)
    small_pop=0.0; topo_excl_pop=0.0
    for f in pop_feats:
        p=f.get('properties') or {}
        pop=finite(p.get('population')) or 0.0
        a=finite(p.get('area_km2')) or 0.0
        if 0<a<50: small_pop+=pop
        if p.get('topology_excluded'): topo_excl_pop+=pop
    row['small_polygon_population_under_50_km2_v103']=round(small_pop,3)
    row['topology_excluded_population_included_v103']=round(topo_excl_pop,3)
    excluded_area=sum(finite((f.get('properties') or {}).get('area_km2')) or 0.0 for f in excluded)
    excluded_pop=sum(finite((f.get('properties') or {}).get('population')) or 0.0 for f in excluded)
    row['statistical_scope_method_v104']='custom Western Siberia trend scope; requested out-of-scope okrugs/oblast removed from multiyear statistics only; source map layers are unchanged'
    row['stat_excluded_units_v104']='; '.join(sorted(EXCLUSIONS.get(year,set())))
    row['stat_excluded_features_v104']=len(excluded)
    row['stat_excluded_area_km2_v104']=round(excluded_area,3)
    row['stat_excluded_population_v104']=round(excluded_pop,3)
    return row, excluded


def main():
    path=TOPO_DIR/'multiyear_metrics_by_year.json'
    rows=load_json(path)
    before={int(r['year']):dict(r) for r in rows}
    excluded_rows=[]; compare=[]
    out=[]
    for r in rows:
        y=int(r['year'])
        if y in EXCLUSIONS:
            nr,excl=metrics_for_year(y,r)
            out.append(nr)
            for f in excl:
                p=f.get('properties') or {}
                excluded_rows.append({
                    'year':y,
                    'unit_id':p.get('unit_id'),
                    'name':p.get('name'),
                    'unit_type':p.get('unit_type'),
                    'admin_parent':p.get('admin_parent'),
                    'admin_intermediate':p.get('admin_intermediate'),
                    'admin_superparent':p.get('admin_superparent'),
                    'area_km2':p.get('area_km2'),
                    'population':p.get('population'),
                    'urban_pop':p.get('urban_pop'),
                    'topology_excluded':p.get('topology_excluded'),
                    'excluded_by':exclude_reason(p,y),
                })
            b=before[y]
            for key in ['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','total_area_km2','total_population','urban_population','rural_population','population_density','rail_length_km_total','avg_adjacency','nodes','edges','components','graph_density','bridges','articulation_points','avg_lower_units_per_upper_ate','avg_area_upper_ate_km2']:
                compare.append({'year':y,'metric':key,'before':b.get(key),'after':nr.get(key),'delta':(nr.get(key)-b.get(key)) if isinstance(nr.get(key),(int,float)) and isinstance(b.get(key),(int,float)) else ''})
        else:
            out.append(r)
    write_json(path,out)
    with (DOCS_DIR/'v104_stat_scope_excluded_features.csv').open('w',encoding='utf-8',newline='') as f:
        fields=['year','unit_id','name','unit_type','admin_parent','admin_intermediate','admin_superparent','area_km2','population','urban_pop','topology_excluded','excluded_by']
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(excluded_rows)
    with (DOCS_DIR/'v104_multiyear_metrics_before_after.csv').open('w',encoding='utf-8',newline='') as f:
        fields=['year','metric','before','after','delta']
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(compare)
    print('v104 multiyear statistical scope rebuilt')
    for y in sorted(EXCLUSIONS):
        r=next(x for x in out if int(x['year'])==y)
        print(y,'excluded',r['stat_excluded_features_v104'],'features; population',r['total_population'],'area',r['total_area_km2'],'nodes',r.get('nodes'),'edges',r.get('edges'))

if __name__=='__main__':
    main()
