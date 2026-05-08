#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v107: correct Екатеринбургское ведомство attribution and exclude requested
1745/1765 contextual/mining units from statistics and multiyear trends.

Requested changes:
- 1745 and 1765: do not count Екатеринбургский уезд in statistics/trends;
  re-attribute it as Екатеринбургское ведомство, a lower-level mining/office
  unit within Тобольская провинция, not a regular uezd.
- 1765: do not count Исетская провинция in statistics/trends.

Map polygons are retained. The units are marked as non-analytic/contextual for
statistics/topology metrics. Topology edges in source files are not deleted, but
per-layer graph metrics are recalculated after removing the excluded nodes.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

import networkx as nx

ROOT = Path(__file__).resolve().parent
ADMIN = ROOT / "data" / "admin"
TOPO = ROOT / "data" / "topology"
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)
MIN_AREA_KM2 = 50.0

# Historical/statistical exclusions requested before + new v107 scope corrections.
EXCLUSIONS_EXTENDED = {
    1745: {"Екатеринбургское ведомство", "Екатеринбургский уезд"},
    1765: {"Исетская провинция", "Екатеринбургское ведомство", "Екатеринбургский уезд"},
    1926: {"Шадринский округ", "Курганский округ", "Ирбитский округ"},
    1930: {"Ачинский округ"},
    2021: {"Курганская область"},
}

TOPO_FIELDS_DEFAULTS = {
    "topo_degree": 0,
    "topo_degree_centrality": None,
    "topo_betweenness": None,
    "topo_closeness": None,
    "topo_k_core": None,
    "topo_component_id": None,
    "topo_component_size": None,
    "topo_internal_degree": 0,
    "topo_external_degree": 0,
    "topo_external_share": None,
    "topo_boundary_km_total": 0,
    "topo_boundary_km_avg": None,
    "topo_graph_nodes": 0,
    "topo_graph_edges": 0,
    "topo_graph_density": None,
    "topo_graph_components": 0,
    "topo_graph_cyclomatic": None,
    "topo_articulation_point": False,
    "topo_super_internal_degree": 0,
    "topo_super_external_degree": 0,
    "topo_graph_bridges": 0,
    "topo_bridge_incident_count": 0,
    "topo_bridge_endpoint": False,
    "topo_articulation_point_computed": False,
    "topo_graph_articulation_points": 0,
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean(x) -> str:
    return str(x or "").strip()


def finite(x):
    try:
        if x in (None, ""):
            return None
        n = float(x)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def truthy(x) -> bool:
    if isinstance(x, bool):
        return x
    return str(x or "").strip().lower() in {"1", "true", "yes", "y", "да"}


def unit_id_from_feature(f):
    p = f.get("properties") or {}
    return clean(p.get("unit_id") or p.get("topology_node_id") or p.get("node_id") or p.get("id"))


def values_for_exclusion(p):
    return {clean(p.get(k)) for k in [
        "name", "_display_name", "Uezd", "Prov",
        "admin_parent", "admin_intermediate", "admin_superparent",
        "_display_top_atd", "_display_mid_atd", "_display_low_atd",
    ] if clean(p.get(k))}


def exclusion_reason(p, year: int):
    targets = EXCLUSIONS_EXTENDED.get(year, set())
    hit = values_for_exclusion(p) & targets
    if hit:
        return sorted(hit)[0]
    return None


def mark_nonanalytic(p: dict, reason: str, note: str):
    p["include_in_analytics"] = False
    p["statistical_excluded_v107"] = True
    p["statistical_exclusion_reason_v107"] = reason
    p["statistical_scope_note_v107"] = note
    p["adjacency_excluded"] = True
    p["adjacency_exclusion_reason"] = reason
    p["topology_excluded"] = True
    p["topology_exclusion_reason"] = reason
    p["include_in_selection"] = True


def update_ekaterinburg_attributes(p: dict, year: int):
    old_name = clean(p.get("name") or p.get("Uezd") or p.get("_display_name"))
    p["Uezd"] = "Екатеринбургское ведомство"
    p["name"] = "Екатеринбургское ведомство"
    p["unit_type"] = "горнозаводское ведомство"
    p["_display_name"] = "Екатеринбургское ведомство"
    p["_display_top_atd"] = "Сибирская губерния"
    p["_display_mid_atd"] = "Тобольская провинция"
    p["_display_low_atd"] = "Екатеринбургское ведомство"
    p["_display_unit_type"] = "горнозаводское ведомство"
    p["_display_hierarchy"] = "Сибирская губерния → Тобольская провинция → Екатеринбургское ведомство"
    p["_province_affiliation"] = "Тобольская провинция"
    p["_province_note"] = "v107: низовой горнозаводской/ведомственный уровень в составе Тобольской провинции; не обычный уезд"
    p["_display_map_atd"] = "Тобольская провинция"
    p["admin_parent"] = "Тобольская провинция"
    p["admin_intermediate"] = "Тобольская провинция"
    p["admin_superparent"] = "Сибирская губерния"
    p["atd_hierarchy"] = "Сибирская губерния → Тобольская провинция → Екатеринбургское ведомство"
    p["special_status"] = "горнозаводское ведомство; исключено из обычной статистики АТЕ"
    p["special_status_code"] = "mining_department"
    p["map_display_role"] = p.get("map_display_role") or "admin_polygon"
    p["reconstruction_note"] = (
        clean(p.get("reconstruction_note")) + " " if clean(p.get("reconstruction_note")) else ""
    ) + f"v107: {old_name or 'Екатеринбургский уезд'} переатрибутирован как Екатеринбургское ведомство — низовой ведомственный контур в составе Тобольской провинции, а не регулярный уезд; исключён из сопоставимой статистики и динамики метрик."
    mark_nonanalytic(
        p,
        "v107_stat_scope: Екатеринбургское ведомство не считается обычной АТЕ сопоставимого ряда",
        "Екатеринбургский объект оставлен на карте как ведомственный контур, но исключён из статистики/динамики и топологического графа.",
    )


def update_iset_attributes(p: dict):
    p["special_status"] = "внешний контекст; исключено из статистики Западной Сибири"
    p["special_status_code"] = "external_district_context"
    p["reconstruction_note"] = (
        clean(p.get("reconstruction_note")) + " " if clean(p.get("reconstruction_note")) else ""
    ) + "v107: Исетская провинция сохранена на карте как контекстный внешний/пограничный контур, но исключена из статистики и динамики метрик сопоставимого охвата Западной Сибири."
    mark_nonanalytic(
        p,
        "v107_stat_scope: Исетская провинция исключена из сопоставимой статистики Западной Сибири",
        "Контекстный объект сохранён в картографическом слое, но не участвует в статистике/динамике и топологическом графе.",
    )


def update_admin_attributes():
    rows = []
    for year in [1745, 1765]:
        path = ADMIN / f"admin_{year}.geojson"
        gj = load_json(path)
        for f in gj.get("features", []):
            p = f.get("properties") or {}
            uid = clean(p.get("unit_id"))
            before = {
                "year": year,
                "unit_id": uid,
                "old_name": clean(p.get("name")),
                "old_unit_type": clean(p.get("unit_type")),
                "old_admin_parent": clean(p.get("admin_parent")),
                "old_admin_intermediate": clean(p.get("admin_intermediate")),
                "old_admin_superparent": clean(p.get("admin_superparent")),
                "old_include_in_analytics": p.get("include_in_analytics"),
            }
            changed = False
            if uid in {"adm_1745_014", "adm_1765_010"} or clean(p.get("name")) == "Екатеринбургский уезд":
                update_ekaterinburg_attributes(p, year)
                changed = True
            if uid == "adm_1765_008" or clean(p.get("name")) == "Исетская провинция":
                update_iset_attributes(p)
                changed = True
            if changed:
                rows.append({
                    **before,
                    "new_name": clean(p.get("name")),
                    "new_unit_type": clean(p.get("unit_type")),
                    "new_admin_parent": clean(p.get("admin_parent")),
                    "new_admin_intermediate": clean(p.get("admin_intermediate")),
                    "new_admin_superparent": clean(p.get("admin_superparent")),
                    "new_include_in_analytics": p.get("include_in_analytics"),
                    "special_status_code": clean(p.get("special_status_code")),
                    "statistical_exclusion_reason_v107": clean(p.get("statistical_exclusion_reason_v107")),
                })
        write_json(path, gj)
    with (DOCS / "v107_1745_1765_attribution_and_exclusions.csv").open("w", encoding="utf-8", newline="") as f:
        fields = [
            "year", "unit_id", "old_name", "new_name", "old_unit_type", "new_unit_type",
            "old_admin_parent", "new_admin_parent", "old_admin_intermediate", "new_admin_intermediate",
            "old_admin_superparent", "new_admin_superparent", "old_include_in_analytics", "new_include_in_analytics",
            "special_status_code", "statistical_exclusion_reason_v107",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)
    return rows


def normal_topology_feature(p: dict) -> bool:
    if p.get("include_in_analytics") is False:
        return False
    if truthy(p.get("topology_excluded")) or truthy(p.get("adjacency_excluded")):
        return False
    area = finite(p.get("area_km2"))
    if area is not None and area < MIN_AREA_KM2:
        return False
    code = clean(p.get("special_status_code")).lower()
    if code and code not in {"normal", "none"}:
        return False
    return True


def relation_between(a: dict, b: dict) -> str:
    if clean(a.get("admin_parent")) and clean(a.get("admin_parent")) == clean(b.get("admin_parent")):
        return "same_parent"
    if clean(a.get("admin_superparent")) and clean(a.get("admin_superparent")) == clean(b.get("admin_superparent")):
        return "same_superparent"
    return "cross_parent"


def graph_metrics_and_node_props(year: int, admin_gj: dict):
    by_id = {clean((f.get("properties") or {}).get("unit_id")): (f.get("properties") or {}) for f in admin_gj.get("features", []) if clean((f.get("properties") or {}).get("unit_id"))}
    allowed = {uid for uid, p in by_id.items() if normal_topology_feature(p)}
    edges_gj = load_json(TOPO / f"topology_{year}.geojson")
    G = nx.Graph()
    G.add_nodes_from(sorted(allowed))
    relation_counts = Counter()
    internal = Counter(); external = Counter(); super_internal = Counter(); super_external = Counter()
    boundary_total = Counter(); boundary_count = Counter()
    used_edges = []
    for e in edges_gj.get("features", []):
        p = e.get("properties") or {}
        u = clean(p.get("source_id")); v = clean(p.get("target_id"))
        if not u or not v or u not in allowed or v not in allowed or u == v:
            continue
        rel = relation_between(by_id[u], by_id[v])
        bkm = finite(p.get("boundary_km")) or 0.0
        G.add_edge(u, v, relation=rel, boundary_km=bkm, is_bridge=bool(p.get("is_bridge")))
        used_edges.append((u, v, rel, bkm, p))
        relation_counts[rel] += 1
        boundary_total[u] += bkm; boundary_total[v] += bkm
        boundary_count[u] += 1; boundary_count[v] += 1
        if rel == "same_parent":
            internal[u] += 1; internal[v] += 1
        else:
            external[u] += 1; external[v] += 1
        if clean(by_id[u].get("admin_superparent")) == clean(by_id[v].get("admin_superparent")):
            super_internal[u] += 1; super_internal[v] += 1
        else:
            super_external[u] += 1; super_external[v] += 1
    n = G.number_of_nodes(); m = G.number_of_edges()
    components = list(nx.connected_components(G)) if n else []
    component_index = {}
    component_size = {}
    for idx, comp in enumerate(sorted(components, key=lambda c: (-len(c), sorted(c)[0] if c else "")), start=1):
        for uid in comp:
            component_index[uid] = idx
            component_size[uid] = len(comp)
    deg = dict(G.degree())
    dc = nx.degree_centrality(G) if n > 1 else {u: 0.0 for u in G.nodes}
    bc = nx.betweenness_centrality(G, normalized=True) if n > 1 and m > 0 else {u: 0.0 for u in G.nodes}
    cc = nx.closeness_centrality(G) if n > 1 and m > 0 else {u: 0.0 for u in G.nodes}
    try:
        core = nx.core_number(G) if m > 0 else {u: 0 for u in G.nodes}
    except Exception:
        core = {u: 0 for u in G.nodes}
    bridges = set(tuple(sorted(x)) for x in nx.bridges(G)) if m > 0 else set()
    arts = set(nx.articulation_points(G)) if m > 0 else set()
    bridge_incident = Counter()
    for u, v in bridges:
        bridge_incident[u] += 1; bridge_incident[v] += 1
    density = nx.density(G) if n > 1 else 0.0
    comps_count = nx.number_connected_components(G) if n else 0
    cyclomatic = m - n + comps_count if n else None

    node_props = {}
    for uid in by_id:
        if uid not in allowed:
            node_props[uid] = {**TOPO_FIELDS_DEFAULTS}
            continue
        d = deg.get(uid, 0)
        node_props[uid] = {
            "topo_degree": int(d),
            "topo_degree_centrality": round(float(dc.get(uid, 0)), 6),
            "topo_betweenness": round(float(bc.get(uid, 0)), 6),
            "topo_closeness": round(float(cc.get(uid, 0)), 6),
            "topo_k_core": int(core.get(uid, 0)),
            "topo_component_id": component_index.get(uid),
            "topo_component_size": component_size.get(uid),
            "topo_internal_degree": int(internal[uid]),
            "topo_external_degree": int(external[uid]),
            "topo_external_share": round(float(external[uid]) / d, 6) if d else 0.0,
            "topo_boundary_km_total": round(float(boundary_total[uid]), 3),
            "topo_boundary_km_avg": round(float(boundary_total[uid]) / boundary_count[uid], 3) if boundary_count[uid] else None,
            "topo_graph_nodes": n,
            "topo_graph_edges": m,
            "topo_graph_density": round(float(density), 6) if density is not None else None,
            "topo_graph_components": comps_count,
            "topo_graph_cyclomatic": cyclomatic,
            "topo_articulation_point": uid in arts,
            "topo_super_internal_degree": int(super_internal[uid]),
            "topo_super_external_degree": int(super_external[uid]),
            "topo_graph_bridges": len(bridges),
            "topo_bridge_incident_count": int(bridge_incident[uid]),
            "topo_bridge_endpoint": bridge_incident[uid] > 0,
            "topo_articulation_point_computed": uid in arts,
            "topo_graph_articulation_points": len(arts),
        }
    def avg(vals):
        vals = list(vals)
        return sum(vals) / len(vals) if vals else None
    ext_share_vals = [(external[u] / deg.get(u, 1)) if deg.get(u, 0) else 0.0 for u in G.nodes]
    def best(mapping):
        if not mapping:
            return None, "—"
        uid, val = sorted(mapping.items(), key=lambda kv: (kv[1], clean(by_id.get(kv[0], {}).get("name")) or kv[0]), reverse=True)[0]
        return val, clean(by_id.get(uid, {}).get("name")) or uid
    maxdeg, maxdegname = best(deg)
    maxb, maxbname = best(bc)
    maxc, maxcname = best(cc)
    maxcore, maxcorename = best(core)
    global_metrics = {
        "year": year,
        "nodes": n,
        "edges": m,
        "components": comps_count,
        "graph_density": round(float(density), 6) if n > 1 else 0.0,
        "cyclomatic": cyclomatic,
        "articulation_points": len(arts),
        "avg_degree": round(avg(deg.values()), 6) if n else None,
        "avg_degree_centrality": round(avg(dc.values()), 6) if n else None,
        "avg_betweenness": round(avg(bc.values()), 6) if n else None,
        "avg_closeness": round(avg(cc.values()), 6) if n else None,
        "avg_k_core": round(avg(core.values()), 6) if n else None,
        "avg_external_degree": round(avg(external[u] for u in G.nodes), 6) if n else None,
        "avg_internal_degree": round(avg(internal[u] for u in G.nodes), 6) if n else None,
        "avg_external_share": round(avg(ext_share_vals), 6) if n else None,
        "avg_super_external_degree": round(avg(super_external[u] for u in G.nodes), 6) if n else None,
        "same_parent_edges": relation_counts.get("same_parent", 0),
        "same_superparent_edges": relation_counts.get("same_superparent", 0),
        "cross_parent_edges": relation_counts.get("cross_parent", 0),
        "other_edges": sum(v for k, v in relation_counts.items() if k not in {"same_parent", "same_superparent", "cross_parent"}),
        "max_degree": float(maxdeg) if maxdeg is not None else None,
        "max_degree_name": maxdegname,
        "max_betweenness": round(float(maxb), 6) if maxb is not None else None,
        "max_betweenness_name": maxbname,
        "max_closeness": round(float(maxc), 6) if maxc is not None else None,
        "max_closeness_name": maxcname,
        "max_k_core": float(maxcore) if maxcore is not None else None,
        "max_k_core_name": maxcorename,
        "bridges": len(bridges),
        "articulation_points_computed": len(arts),
    }
    adj = defaultdict(list)
    for u, v, rel, bkm, ep in used_edges:
        adj[u].append((v, bkm, rel)); adj[v].append((u, bkm, rel))
    return global_metrics, node_props, adj, used_edges, allowed


def apply_topology_metrics(year: int):
    admin_path = ADMIN / f"admin_{year}.geojson"
    gj = load_json(admin_path)
    global_metrics, node_props, adj, used_edges, allowed = graph_metrics_and_node_props(year, gj)
    by_id = {clean((f.get("properties") or {}).get("unit_id")): (f.get("properties") or {}) for f in gj.get("features", [])}
    for f in gj.get("features", []):
        p = f.get("properties") or {}
        uid = clean(p.get("unit_id"))
        if uid in node_props:
            p.update(node_props[uid])
        if uid in allowed:
            items = sorted(adj.get(uid, []), key=lambda x: clean(by_id.get(x[0], {}).get("name")))
            p["adjacent_unit_ids"] = [x[0] for x in items]
            p["adjacent_names"] = [clean(by_id.get(x[0], {}).get("name")) or x[0] for x in items]
            p["adjacent_count"] = len(items)
            p["adjacent_units"] = "; ".join(p["adjacent_names"])
            p["adjacency_method"] = "v107 filtered topology graph; statistical/context exclusions removed"
        else:
            p["adjacent_unit_ids"] = []
            p["adjacent_names"] = []
            p["adjacent_count"] = 0
            p["adjacent_units"] = ""
            if truthy(p.get("statistical_excluded_v107")):
                p["adjacency_method"] = "excluded_from_v107_statistics_and_topology"
    write_json(admin_path, gj)

    # Sync node properties where a topology node exists.
    nodes_path = TOPO / f"topology_nodes_{year}.geojson"
    if nodes_path.exists():
        nodes = load_json(nodes_path)
        for nf in nodes.get("features", []):
            p = nf.get("properties") or {}
            uid = clean(p.get("unit_id") or p.get("topology_node_id"))
            admin_p = by_id.get(uid, {})
            if admin_p:
                for k in ["name", "unit_type", "admin_parent", "admin_intermediate", "admin_superparent", "special_status", "special_status_code", "include_in_analytics", "topology_excluded", "topology_exclusion_reason", "adjacency_excluded", "adjacency_exclusion_reason", "statistical_excluded_v107", "statistical_exclusion_reason_v107"]:
                    if k in admin_p:
                        p[k] = admin_p[k]
            if uid in node_props:
                p.update(node_props[uid])
        write_json(nodes_path, nodes)

    return global_metrics, used_edges, allowed


def update_topology_metrics_json(year_metrics):
    path = TOPO / "topology_metrics_by_year.json"
    rows = load_json(path)
    by_year = {int(r.get("year")): r for r in rows}
    for y, gm in year_metrics.items():
        row = by_year.get(y, {"year": y})
        row.update(gm)
        row["topology_metrics_method_v107"] = "existing topology edges filtered by v107 statistical/context exclusions before graph metrics are computed"
        by_year[y] = row
    out = [by_year[y] for y in sorted(by_year)]
    write_json(path, out)


def import_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def recalc_base_multiyear_metrics():
    v104 = import_module(ROOT / "recalc_v104_stat_exclusions.py", "v104_recalc")
    v104.EXCLUSIONS = {k: set(v) for k, v in EXCLUSIONS_EXTENDED.items()}
    metrics_path = TOPO / "multiyear_metrics_by_year.json"
    rows = load_json(metrics_path)
    before = {int(r["year"]): dict(r) for r in rows}
    out = []
    excluded_rows = []
    compare = []
    update_years = set(EXCLUSIONS_EXTENDED)
    keys_to_compare = [
        "ate_total_count", "upper_ate_count", "middle_ate_count", "lower_ate_count", "total_area_km2",
        "total_population", "rail_length_km_total", "avg_adjacency", "nodes", "edges", "components",
        "graph_density", "bridges", "articulation_points", "avg_lower_units_per_upper_ate",
        "avg_area_upper_ate_km2", "avg_area_middle_ate_km2",
    ]
    for r in rows:
        y = int(r["year"])
        if y in update_years:
            nr, excl = v104.metrics_for_year(y, r)
            nr["statistical_scope_method_v107"] = "v104 custom Western Siberia trend scope plus v107 exclusion of 1745/1765 Екатеринбургское ведомство and 1765 Исетская провинция; source map polygons retained"
            nr["stat_excluded_units_v107"] = "; ".join(sorted(EXCLUSIONS_EXTENDED.get(y, set())))
            nr["stat_excluded_features_v107"] = len(excl)
            out.append(nr)
            for f in excl:
                p = f.get("properties") or {}
                excluded_rows.append({
                    "year": y,
                    "unit_id": p.get("unit_id"),
                    "name": p.get("name"),
                    "unit_type": p.get("unit_type"),
                    "admin_parent": p.get("admin_parent"),
                    "admin_intermediate": p.get("admin_intermediate"),
                    "admin_superparent": p.get("admin_superparent"),
                    "area_km2": p.get("area_km2"),
                    "population": p.get("population"),
                    "excluded_by": v104.exclude_reason(p, y),
                })
            b = before.get(y, {})
            for key in keys_to_compare:
                after = nr.get(key); prev = b.get(key)
                compare.append({
                    "year": y,
                    "metric": key,
                    "before": prev,
                    "after": after,
                    "delta": (after - prev) if isinstance(after, (int, float)) and isinstance(prev, (int, float)) else "",
                })
        else:
            out.append(r)
    write_json(metrics_path, out)
    with (DOCS / "v107_stat_scope_excluded_features.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year", "unit_id", "name", "unit_type", "admin_parent", "admin_intermediate", "admin_superparent", "area_km2", "population", "excluded_by"]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(excluded_rows)
    with (DOCS / "v107_multiyear_metrics_before_after.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year", "metric", "before", "after", "delta"]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(compare)


def recalc_area_dispersion_v107():
    v105 = import_module(ROOT / "recalc_v105_area_dispersion.py", "v105_recalc")
    v105.STAT_EXCLUDED_BY_YEAR = {k: set(v) for k, v in EXCLUSIONS_EXTENDED.items()}
    rows = load_json(TOPO / "multiyear_metrics_by_year.json")
    by_year = {int(r["year"]): r for r in rows}
    summary_rows = []
    context_rows = []
    exclusion_rows = []
    for year, row in sorted(by_year.items()):
        path = ADMIN / f"admin_{year}.geojson"
        if not path.exists():
            continue
        gj = load_json(path)
        included = []
        for f in gj.get("features", []):
            p = f.get("properties") or {}
            exc, reason = v105.should_exclude_feature(p, year)
            if exc:
                exclusion_rows.append({
                    "year": year,
                    "unit_id": v105.clean_str(p.get("unit_id")),
                    "name": v105.clean_str(p.get("name") or p.get("Name")),
                    "admin_parent": v105.clean_str(p.get("admin_parent")),
                    "admin_intermediate": v105.clean_str(p.get("admin_intermediate")),
                    "admin_superparent": v105.clean_str(p.get("admin_superparent")),
                    "area_km2": v105.num(p.get("area_km2")),
                    "reason": reason,
                })
                continue
            included.append(f)
        upper = v105.group_areas(included, year, "upper")
        middle = v105.group_areas(included, year, "middle")
        lower = v105.group_areas(included, year, "lower")
        v105.add_level_metrics(row, "upper", list(upper.values()))
        v105.add_level_metrics(row, "middle", list(middle.values()))
        v105.add_level_metrics(row, "lower", list(lower.values()))
        contexts = []
        for ctx in sorted(upper):
            e = v105.context_stats_entry(ctx, included, year)
            if e:
                contexts.append(e)
                context_rows.append(e)
        row["area_dispersion_contexts"] = contexts
        row["area_context_count_v105"] = len(contexts)
        row["area_cv_lower_within_upper_mean"] = v105.rnd(v105.mean(e.get("area_cv_lower_ate") for e in contexts), 6)
        row["area_cv_lower_within_upper_max"] = v105.rnd(v105.max_or_none(e.get("area_cv_lower_ate") for e in contexts), 6)
        row["area_gini_lower_within_upper_mean"] = v105.rnd(v105.mean(e.get("area_gini_lower_ate") for e in contexts), 6)
        row["area_gini_lower_within_upper_max"] = v105.rnd(v105.max_or_none(e.get("area_gini_lower_ate") for e in contexts), 6)
        row["area_p90_p10_lower_within_upper_mean"] = v105.rnd(v105.mean(e.get("area_p90_p10_ratio_lower_ate") for e in contexts), 6)
        row["area_p90_p10_lower_within_upper_max"] = v105.rnd(v105.max_or_none(e.get("area_p90_p10_ratio_lower_ate") for e in contexts), 6)
        row["area_dispersion_method_v105"] = (
            "areas grouped by hierarchy level; excludes topology/adjacency excluded, special/uncertain/context polygons, "
            "polygons <50 km2, v104 statistical-scope exclusions for 1926/1930/2021, and v107 exclusions for 1745/1765"
        )
        row["area_dispersion_scope_note_v107"] = "1745/1765 Екатеринбургское ведомство and 1765 Исетская провинция excluded from dispersion statistics"
        summary_rows.append({"year": year, **{k: row.get(k) for k in v105.AREA_METRIC_KEYS if k in row}})
    write_json(TOPO / "multiyear_metrics_by_year.json", rows)
    with (DOCS / "v107_area_dispersion_metrics_by_year.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year"] + [k for k in v105.AREA_METRIC_KEYS if any(k in r for r in summary_rows)]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for r in summary_rows:
            w.writerow({k: r.get(k) for k in fields})
    with (DOCS / "v107_area_dispersion_contexts.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year", "context", "area_count_middle_ate", "area_cv_middle_ate", "area_gini_middle_ate", "area_p90_p10_ratio_middle_ate", "area_count_lower_ate", "area_cv_lower_ate", "area_gini_lower_ate", "area_p90_p10_ratio_lower_ate", "area_mean_lower_ate_km2", "area_min_lower_ate_km2", "area_max_lower_ate_km2"]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for r in context_rows:
            w.writerow({k: r.get(k) for k in fields})
    with (DOCS / "v107_area_dispersion_excluded_features.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year", "unit_id", "name", "admin_parent", "admin_intermediate", "admin_superparent", "area_km2", "reason"]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for r in exclusion_rows:
            w.writerow({k: r.get(k) for k in fields})


def update_manifest_and_version():
    # app.js / index cache version
    app_path = ROOT / "app.js"
    text = app_path.read_text(encoding="utf-8")
    text = text.replace("const APP_VERSION = '106';", "const APP_VERSION = '107';")
    app_path.write_text(text, encoding="utf-8")
    index = ROOT / "index.html"
    html = index.read_text(encoding="utf-8")
    html = html.replace("style.css?v=106", "style.css?v=107").replace("app.js?v=106", "app.js?v=107")
    index.write_text(html, encoding="utf-8")
    manifest_path = ROOT / "data" / "manifest.json"
    m = load_json(manifest_path)
    m["app_version"] = "107"
    note = "v107: для слоёв 1745/1765 Екатеринбургский объект переатрибутирован как Екатеринбургское ведомство в составе Тобольской провинции, исключён из сопоставимой статистики/динамики; Исетская провинция 1765 исключена как внешний контекст. Пересчитаны графовые и картометрические метрики динамики."
    notes = m.setdefault("notes", [])
    if note not in notes:
        notes.append(note)
    ch = m.setdefault("changelog", [])
    if not any(isinstance(x, dict) and str(x.get("version")) == "107" for x in ch):
        ch.append({"version": "107", "note": note})
    write_json(manifest_path, m)
    (ROOT / "README_v107.md").write_text("""# v107\n\n- 1745/1765: Екатеринбургский объект переатрибутирован как Екатеринбургское ведомство, низовой ведомственный контур в составе Тобольской провинции, а не регулярный уезд.\n- 1745/1765: Екатеринбургское ведомство исключено из статистики, динамики метрик и топологического графа сопоставимых АТЕ.\n- 1765: Исетская провинция исключена из статистики, динамики метрик и топологического графа как внешний контекст.\n- Пересчитаны adjacency/topology-поля для 1745 и 1765, `topology_metrics_by_year.json`, `multiyear_metrics_by_year.json` и показатели разброса площадей.\n- Добавлены диагностические CSV `docs/v107_*`.\n""", encoding="utf-8")


def main():
    attr_rows = update_admin_attributes()
    year_metrics = {}
    topo_diag = []
    for year in [1745, 1765]:
        gm, used_edges, allowed = apply_topology_metrics(year)
        year_metrics[year] = gm
        topo_diag.append({"year": year, "allowed_nodes_after_v107": len(allowed), "edges_after_v107": len(used_edges), "avg_degree_after_v107": gm.get("avg_degree")})
    update_topology_metrics_json(year_metrics)
    with (DOCS / "v107_topology_metrics_summary.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["year", "allowed_nodes_after_v107", "edges_after_v107", "avg_degree_after_v107"]
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(topo_diag)
    recalc_base_multiyear_metrics()
    recalc_area_dispersion_v107()
    update_manifest_and_version()
    print("v107 complete")
    print("Changed attribution/exclusions:", len(attr_rows))
    for r in attr_rows:
        print(r["year"], r["unit_id"], r["old_name"], "->", r["new_name"], "/", r["new_admin_parent"])
    for r in topo_diag:
        print("topology", r)


if __name__ == "__main__":
    main()
