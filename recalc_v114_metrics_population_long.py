#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json,csv,math,re
from pathlib import Path
from collections import defaultdict, Counter
import networkx as nx
ROOT=Path(__file__).resolve().parent
ADMIN=ROOT/'data'/'admin'; TOPO=ROOT/'data'/'topology'; DOCS=ROOT/'docs'; DOCS.mkdir(exist_ok=True)
STAT_EXCL={1926:{'Шадринский округ','Курганский округ','Ирбитский округ'},1930:{'Ачинский округ'},2021:{'Курганская область'}}

def num(x):
    try:
        if x is None or x=='': return None
        v=float(x); return v if math.isfinite(v) else None
    except Exception: return None

def clean(x): return str(x or '').strip()
def stat_excluded(p,year):
    vals={clean(p.get(k)) for k in ['name','admin_parent','admin_intermediate','admin_superparent','_display_top_atd','_display_mid_atd']}
    return bool(vals & STAT_EXCL.get(year,set()))
def sumfield(feats,k):
    return sum((num(f['properties'].get(k)) or 0) for f in feats)
def mean(xs): return sum(xs)/len(xs) if xs else None
def r(v,nd=6):
    if v is None: return None
    try: return round(float(v),nd)
    except Exception: return None

def relation(a,b,props):
    pa=props[a]; pb=props[b]
    if clean(pa.get('admin_parent')) and clean(pa.get('admin_parent'))==clean(pb.get('admin_parent')): return 'same_parent'
    if clean(pa.get('admin_superparent')) and clean(pa.get('admin_superparent'))==clean(pb.get('admin_superparent')): return 'same_superparent'
    return 'cross_parent'

def graph_metrics(year, valid_ids):
    path=TOPO/f'topology_{year}.geojson'
    props={}
    gj=json.loads((ADMIN/f'admin_{year}.geojson').read_text(encoding='utf-8'))
    for f in gj['features']: props[clean(f['properties'].get('unit_id'))]=f['properties']
    G=nx.Graph(); G.add_nodes_from(valid_ids)
    if path.exists():
        topo=json.loads(path.read_text(encoding='utf-8'))
        for e in topo.get('features',[]):
            p=e['properties']; a=clean(p.get('source_id')); b=clean(p.get('target_id'))
            if a in valid_ids and b in valid_ids: G.add_edge(a,b)
    n=G.number_of_nodes(); m=G.number_of_edges(); comps=nx.number_connected_components(G) if n else 0
    deg=dict(G.degree())
    rel=Counter()
    for a,b in G.edges: rel[relation(a,b,props)]+=1
    density=nx.density(G) if n>1 else 0
    arts=list(nx.articulation_points(G)) if n>1 else []
    bridges=list(nx.bridges(G)) if n>1 else []
    # centralities for aggregate only
    if n>1:
        dc=nx.degree_centrality(G)
        close=nx.closeness_centrality(G)
    else:
        dc={x:0 for x in G.nodes}; close={x:0 for x in G.nodes}
    bet=nx.betweenness_centrality(G,normalized=True) if n>2 else {x:0 for x in G.nodes}
    try: core=nx.core_number(G) if n else {}
    except Exception: core={x:0 for x in G.nodes}
    def avgdict(d): return r(mean(list(d.values())) or 0,6)
    def max_name(d):
        if not d: return (0,'—')
        node=max(d,key=lambda k:d[k]); return (d[node], props.get(node,{}).get('name','—'))
    maxdeg=max_name(deg); maxbet=max_name(bet); maxclose=max_name(close); maxcore=max_name(core)
    return {
        'nodes':n,'edges':m,'components':comps,'graph_density':r(density,6),'cyclomatic':m-n+comps,
        'articulation_points':len(arts),'avg_degree':r(sum(deg.values())/n if n else 0,6),
        'avg_degree_centrality':avgdict(dc),'avg_betweenness':avgdict(bet),'avg_closeness':avgdict(close),'avg_k_core':avgdict(core),
        'avg_external_degree':None,'avg_internal_degree':None,'avg_external_share':None,'avg_super_external_degree':None,
        'same_parent_edges':rel.get('same_parent',0),'same_superparent_edges':rel.get('same_superparent',0),'cross_parent_edges':rel.get('cross_parent',0),'other_edges':m-rel.get('same_parent',0)-rel.get('same_superparent',0)-rel.get('cross_parent',0),
        'max_degree':maxdeg[0],'max_degree_name':maxdeg[1],'max_betweenness':r(maxbet[0],6),'max_betweenness_name':maxbet[1],'max_closeness':r(maxclose[0],6),'max_closeness_name':maxclose[1],'max_k_core':maxcore[0],'max_k_core_name':maxcore[1],
        'bridges':len(bridges),'articulation_points_computed':len(arts)
    }

def calc_row(year, oldrow):
    feats=json.loads((ADMIN/f'admin_{year}.geojson').read_text(encoding='utf-8'))['features']
    stat_feats=[f for f in feats if not stat_excluded(f['properties'],year)]
    analytic=[f for f in stat_feats if not f['properties'].get('topology_excluded') and not f['properties'].get('adjacency_excluded')]
    pop_feats=stat_feats
    areas=[num(f['properties'].get('area_km2')) for f in analytic]; areas=[x for x in areas if x and x>0]
    total_area=sum(areas) if areas else None
    total_pop=sumfield(pop_feats,'population')
    total_urban=sumfield(pop_feats,'urban_pop')
    total_rural=sumfield(pop_feats,'rural_pop')
    rails=[num(f['properties'].get('rail_length_km')) or 0 for f in analytic]
    rail_segs=[num(f['properties'].get('rail_segments_count')) or 0 for f in analytic]
    degrees=[num(f['properties'].get('topo_degree')) for f in analytic]; degrees=[x for x in degrees if x is not None]
    supers={clean(f['properties'].get('admin_superparent')) for f in analytic if clean(f['properties'].get('admin_superparent'))}
    mids=set(); parents=set()
    for f in analytic:
        p=f['properties']; sup=clean(p.get('admin_superparent')); inter=clean(p.get('admin_intermediate')); parent=clean(p.get('admin_parent')); name=clean(p.get('name'))
        if parent and parent not in {sup,name}: parents.add(parent)
        if inter and inter not in {sup,parent,name}: mids.add(inter)
        elif parent and parent not in {sup,name}: mids.add(parent)
    row=dict(oldrow)
    row.update({
        'ate_total_count':len(stat_feats),'upper_ate_count':len(supers) or (1 if analytic else 0),'middle_ate_count':len(mids),'lower_ate_count':len(analytic),
        'total_area_km2':r(total_area,3),'avg_area_km2':r(total_area/len(areas),3) if areas else None,
        'total_population':r(total_pop,3),'avg_population':r(total_pop/len(pop_feats),3) if pop_feats else None,'population_density':r(total_pop/total_area,6) if total_area else None,
        'urban_population':r(total_urban,3),'rural_population':r(total_rural,3),'urban_share':r(total_urban/total_pop,6) if total_pop else None,
        'rail_length_km_total':r(sum(rails),3),'rail_density_km_1000':r(sum(rails)/total_area*1000,6) if total_area else None,'rail_segments_count_sum':r(sum(rail_segs),3),
        'avg_adjacency':r(sum(degrees)/len(degrees),6) if degrees else None,'source_admin_features':len(feats),'analytics_features':len(analytic),
        'population_metrics_method_v103':'v114_population_includes_regular_A TE_and_kept_city_center_polygons; stat-scope exclusions preserved',
        'population_features_v103':len(pop_feats),'population_nonzero_features_v103':sum(1 for f in pop_feats if (num(f['properties'].get('population')) or 0)>0),
        'statistical_scope_method_v104':'preserved_v114_stat_scope_exclusions',
        'stat_excluded_units_v104':'; '.join(sorted(STAT_EXCL.get(year,set()))),
        'stat_excluded_features_v104':len(feats)-len(stat_feats),
        'stat_excluded_area_km2_v104':r(sum((num(f['properties'].get('area_km2')) or 0) for f in feats if stat_excluded(f['properties'],year)),3),
        'stat_excluded_population_v104':r(sum((num(f['properties'].get('population')) or 0) for f in feats if stat_excluded(f['properties'],year)),3),
    })
    valid_ids={clean(f['properties'].get('unit_id')) for f in analytic}
    row.update(graph_metrics(year, valid_ids))
    return row

def regenerate_population_long():
    fields=['year','unit_id','name','unit_type','admin_parent','population','urban_pop','rural_pop','urban_share','area_km2','density','rail_length_km','rail_density_km_1000','rail_segments_count','population_source_year','population_source_unit','population_basis','population_quality','population_method','population_note','population_source','population_reconstruction_version','population_recalc_note','urban_pop_method','urban_pop_source','merged_city_names_v114']
    rows=[]
    for path in sorted(ADMIN.glob('admin_*.geojson'),key=lambda p:int(re.search(r'(\d+)',p.name).group(1))):
        year=int(re.search(r'(\d+)',path.name).group(1))
        for f in json.loads(path.read_text(encoding='utf-8'))['features']:
            p=f['properties']; rows.append({k:p.get(k) for k in fields} | {'year':year})
    with (ROOT/'data'/'population_long.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)

def main():
    mpath=TOPO/'multiyear_metrics_by_year.json'
    rows=json.loads(mpath.read_text(encoding='utf-8')); by={int(r['year']):r for r in rows}
    before=[]; after=[]
    for y in [1918,1923,1926,1930]:
        before.append({'year':y,'total_population':by[y].get('total_population'),'urban_population':by[y].get('urban_population'),'rural_population':by[y].get('rural_population'),'nodes':by[y].get('nodes'),'edges':by[y].get('edges')})
        by[y]=calc_row(y,by[y])
        after.append({'year':y,'total_population':by[y].get('total_population'),'urban_population':by[y].get('urban_population'),'rural_population':by[y].get('rural_population'),'nodes':by[y].get('nodes'),'edges':by[y].get('edges')})
    out=[by[y] for y in sorted(by)]
    mpath.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    with (DOCS/'v114_multiyear_metrics_before_after.csv').open('w',encoding='utf-8',newline='') as f:
        fields=['stage','year','total_population','urban_population','rural_population','nodes','edges']; w=csv.DictWriter(f,fieldnames=fields); w.writeheader();
        for r in before: w.writerow({'stage':'before',**r})
        for r in after: w.writerow({'stage':'after',**r})
    regenerate_population_long()
    print('v114 metrics fixed')
if __name__=='__main__': main()
