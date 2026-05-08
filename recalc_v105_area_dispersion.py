#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v105: add area-dispersion hierarchy metrics for multiyear trend chart.

The goal is not to alter map layers, but to enrich
`data/topology/multiyear_metrics_by_year.json` with indicators that allow
checking whether the spread of areas inside comparable ATE levels narrows over
time. The scope follows v104 statistical exclusions and excludes special /
uncertain / weak-control polygons and polygons < 50 km².
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from statistics import median
from typing import Iterable, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
ADMIN = DATA / "admin"
METRICS_PATH = DATA / "topology" / "multiyear_metrics_by_year.json"
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)

MIN_AREA_KM2 = 50.0

STAT_EXCLUDED_BY_YEAR = {
    1926: {"Шадринский округ", "Курганский округ", "Ирбитский округ"},
    1930: {"Ачинский округ"},
    2021: {"Курганская область"},
}

BAD_STATUS_TOKENS = (
    "спор", "двоедан", "слаб", "неяс", "uncertain", "disputed", "weak", "context", "special", "low_control"
)

AREA_METRIC_KEYS = [
    "area_count_upper_ate", "area_count_middle_ate", "area_count_lower_ate",
    "area_mean_upper_ate_km2", "area_mean_middle_ate_km2", "area_mean_lower_ate_km2",
    "area_median_upper_ate_km2", "area_median_middle_ate_km2", "area_median_lower_ate_km2",
    "area_stddev_upper_ate_km2", "area_stddev_middle_ate_km2", "area_stddev_lower_ate_km2",
    "area_cv_upper_ate", "area_cv_middle_ate", "area_cv_lower_ate",
    "area_gini_upper_ate", "area_gini_middle_ate", "area_gini_lower_ate",
    "area_p90_p10_ratio_upper_ate", "area_p90_p10_ratio_middle_ate", "area_p90_p10_ratio_lower_ate",
    "area_q75_q25_ratio_upper_ate", "area_q75_q25_ratio_middle_ate", "area_q75_q25_ratio_lower_ate",
    "area_range_ratio_upper_ate", "area_range_ratio_middle_ate", "area_range_ratio_lower_ate",
    "area_min_upper_ate_km2", "area_min_middle_ate_km2", "area_min_lower_ate_km2",
    "area_max_upper_ate_km2", "area_max_middle_ate_km2", "area_max_lower_ate_km2",
    "area_context_count_v105",
    "area_cv_lower_within_upper_mean", "area_cv_lower_within_upper_max",
    "area_gini_lower_within_upper_mean", "area_gini_lower_within_upper_max",
    "area_p90_p10_lower_within_upper_mean", "area_p90_p10_lower_within_upper_max",
]


def clean_str(x) -> str:
    if x is None:
        return ""
    s = str(x).strip()
    if s.lower() in {"none", "null", "nan"}:
        return ""
    return s


def num(x) -> Optional[float]:
    try:
        if x is None:
            return None
        n = float(x)
        if math.isfinite(n):
            return n
    except Exception:
        pass
    return None


def is_truthy(x) -> bool:
    if isinstance(x, bool):
        return x
    if x is None:
        return False
    return str(x).strip().lower() in {"1", "true", "yes", "y", "да"}


def should_exclude_feature(p: dict, year: int) -> Tuple[bool, str]:
    area = num(p.get("area_km2"))
    if area is None or area < MIN_AREA_KM2:
        return True, "area_lt_50_km2_or_missing"
    if not clean_str(p.get("name") or p.get("Name")) or not clean_str(p.get("unit_type") or p.get("_unit_type")):
        return True, "missing_name_or_unit_type"
    if is_truthy(p.get("topology_excluded")) or is_truthy(p.get("adjacency_excluded")):
        return True, clean_str(p.get("topology_exclusion_reason") or p.get("adjacency_exclusion_reason") or "topology_or_adjacency_excluded")
    if p.get("include_in_analytics") is False:
        return True, "include_in_analytics_false"
    joined = " ".join(clean_str(p.get(k)) for k in [
        "special_status", "special_status_code", "data_confidence", "boundary_confidence",
        "_uncertain_code", "_uncertain_label", "map_display_role", "topology_exclusion_reason",
        "adjacency_exclusion_reason"
    ]).lower()
    if any(tok in joined for tok in BAD_STATUS_TOKENS):
        # Keep ordinary "normal" low/noise-free records; this catches only explicit special contexts.
        if "normal" not in joined or any(tok in joined for tok in ["спор", "двоедан", "слаб", "неяс", "uncertain", "disputed", "weak", "context", "low_control"]):
            return True, "special_uncertain_or_context_status"
    excluded_names = STAT_EXCLUDED_BY_YEAR.get(year, set())
    if excluded_names:
        candidates = {
            clean_str(p.get("admin_parent")), clean_str(p.get("admin_intermediate")), clean_str(p.get("admin_superparent")),
            clean_str(p.get("name")), clean_str(p.get("_display_top_atd")), clean_str(p.get("_display_mid_atd"))
        }
        if candidates & excluded_names:
            return True, "v104_stat_scope_exclusion"
    return False, ""


def percentile(sorted_vals: List[float], q: float) -> Optional[float]:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_vals[int(pos)]
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def gini(values: Iterable[float]) -> Optional[float]:
    vals = sorted(float(v) for v in values if v is not None and math.isfinite(float(v)) and float(v) >= 0)
    n = len(vals)
    if n == 0:
        return None
    total = sum(vals)
    if total <= 0:
        return 0.0
    # Gini = (2*sum(i*x_i)/(n*sum(x))) - (n+1)/n, i = 1..n
    return (2 * sum((i + 1) * x for i, x in enumerate(vals)) / (n * total)) - ((n + 1) / n)


def stats(values: Iterable[float]) -> Dict[str, Optional[float]]:
    vals = [float(v) for v in values if v is not None and math.isfinite(float(v)) and float(v) >= 0]
    vals.sort()
    n = len(vals)
    if n == 0:
        return {k: None for k in ["count", "mean", "median", "stddev", "cv", "gini", "p10", "p25", "p75", "p90", "p90_p10_ratio", "q75_q25_ratio", "range_ratio", "min", "max"]}
    mean = sum(vals) / n
    if n > 1:
        var = sum((v - mean) ** 2 for v in vals) / n
        std = math.sqrt(var)
    else:
        std = 0.0
    p10 = percentile(vals, 0.10)
    p25 = percentile(vals, 0.25)
    p75 = percentile(vals, 0.75)
    p90 = percentile(vals, 0.90)
    minv, maxv = vals[0], vals[-1]
    def ratio(a, b):
        if a is None or b is None or b <= 0:
            return None
        return a / b
    return {
        "count": n,
        "mean": mean,
        "median": median(vals),
        "stddev": std,
        "cv": (std / mean) if mean > 0 else None,
        "gini": gini(vals),
        "p10": p10,
        "p25": p25,
        "p75": p75,
        "p90": p90,
        "p90_p10_ratio": ratio(p90, p10),
        "q75_q25_ratio": ratio(p75, p25),
        "range_ratio": ratio(maxv, minv),
        "min": minv,
        "max": maxv,
    }


def rnd(x, nd=6):
    if x is None:
        return None
    try:
        n = float(x)
        if not math.isfinite(n):
            return None
        return round(n, nd)
    except Exception:
        return None


def area_group_key(p: dict, year: int, level: str) -> Optional[str]:
    sup = clean_str(p.get("admin_superparent"))
    inter = clean_str(p.get("admin_intermediate"))
    parent = clean_str(p.get("admin_parent"))
    if level == "upper":
        return sup or "Весь статистический охват"
    if level == "middle":
        if inter and inter != sup:
            return inter
        if (not inter) and parent and (not sup or parent != sup):
            return parent
        return None
    return clean_str(p.get("unit_id")) or clean_str(p.get("name")) or None


def group_areas(features: List[dict], year: int, level: str, restrict_upper: Optional[str] = None) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for f in features:
        p = f.get("properties") or {}
        if restrict_upper is not None:
            uk = area_group_key(p, year, "upper")
            if uk != restrict_upper:
                continue
        key = area_group_key(p, year, level)
        if not key:
            continue
        area = num(p.get("area_km2"))
        if area is None:
            continue
        out[key] = out.get(key, 0.0) + area
    return out


def add_level_metrics(row: dict, prefix: str, values: List[float]):
    s = stats(values)
    row[f"area_count_{prefix}_ate"] = int(s["count"] or 0)
    row[f"area_mean_{prefix}_ate_km2"] = rnd(s["mean"], 3)
    row[f"area_median_{prefix}_ate_km2"] = rnd(s["median"], 3)
    row[f"area_stddev_{prefix}_ate_km2"] = rnd(s["stddev"], 3)
    row[f"area_cv_{prefix}_ate"] = rnd(s["cv"], 6)
    row[f"area_gini_{prefix}_ate"] = rnd(s["gini"], 6)
    row[f"area_p90_p10_ratio_{prefix}_ate"] = rnd(s["p90_p10_ratio"], 6)
    row[f"area_q75_q25_ratio_{prefix}_ate"] = rnd(s["q75_q25_ratio"], 6)
    row[f"area_range_ratio_{prefix}_ate"] = rnd(s["range_ratio"], 6)
    row[f"area_min_{prefix}_ate_km2"] = rnd(s["min"], 3)
    row[f"area_max_{prefix}_ate_km2"] = rnd(s["max"], 3)


def context_stats_entry(context: str, features: List[dict], year: int) -> Optional[dict]:
    lower = list(group_areas(features, year, "lower", restrict_upper=context).values())
    middle = list(group_areas(features, year, "middle", restrict_upper=context).values())
    if not lower and not middle:
        return None
    entry = {"context": context, "context_key": context, "year": year}
    for prefix, values in [("lower", lower), ("middle", middle)]:
        s = stats(values)
        entry[f"area_count_{prefix}_ate"] = int(s["count"] or 0)
        entry[f"area_mean_{prefix}_ate_km2"] = rnd(s["mean"], 3)
        entry[f"area_median_{prefix}_ate_km2"] = rnd(s["median"], 3)
        entry[f"area_stddev_{prefix}_ate_km2"] = rnd(s["stddev"], 3)
        entry[f"area_cv_{prefix}_ate"] = rnd(s["cv"], 6)
        entry[f"area_gini_{prefix}_ate"] = rnd(s["gini"], 6)
        entry[f"area_p90_p10_ratio_{prefix}_ate"] = rnd(s["p90_p10_ratio"], 6)
        entry[f"area_q75_q25_ratio_{prefix}_ate"] = rnd(s["q75_q25_ratio"], 6)
        entry[f"area_range_ratio_{prefix}_ate"] = rnd(s["range_ratio"], 6)
        entry[f"area_min_{prefix}_ate_km2"] = rnd(s["min"], 3)
        entry[f"area_max_{prefix}_ate_km2"] = rnd(s["max"], 3)
    return entry


def mean(vals: Iterable[Optional[float]]) -> Optional[float]:
    xs = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return sum(xs) / len(xs) if xs else None


def max_or_none(vals: Iterable[Optional[float]]) -> Optional[float]:
    xs = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return max(xs) if xs else None


def main():
    rows = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    by_year = {int(r["year"]): r for r in rows}

    summary_rows = []
    context_rows = []
    exclusion_rows = []

    for year, row in sorted(by_year.items()):
        path = ADMIN / f"admin_{year}.geojson"
        if not path.exists():
            continue
        gj = json.loads(path.read_text(encoding="utf-8"))
        included = []
        for f in gj.get("features", []):
            p = f.get("properties") or {}
            exc, reason = should_exclude_feature(p, year)
            if exc:
                exclusion_rows.append({
                    "year": year,
                    "unit_id": clean_str(p.get("unit_id")),
                    "name": clean_str(p.get("name") or p.get("Name")),
                    "admin_parent": clean_str(p.get("admin_parent")),
                    "admin_intermediate": clean_str(p.get("admin_intermediate")),
                    "admin_superparent": clean_str(p.get("admin_superparent")),
                    "area_km2": num(p.get("area_km2")),
                    "reason": reason,
                })
                continue
            included.append(f)

        upper = group_areas(included, year, "upper")
        middle = group_areas(included, year, "middle")
        lower = group_areas(included, year, "lower")

        add_level_metrics(row, "upper", list(upper.values()))
        add_level_metrics(row, "middle", list(middle.values()))
        add_level_metrics(row, "lower", list(lower.values()))

        contexts = []
        for ctx in sorted(upper):
            e = context_stats_entry(ctx, included, year)
            if e:
                contexts.append(e)
                context_rows.append(e)
        row["area_dispersion_contexts"] = contexts
        row["area_context_count_v105"] = len(contexts)

        row["area_cv_lower_within_upper_mean"] = rnd(mean(e.get("area_cv_lower_ate") for e in contexts), 6)
        row["area_cv_lower_within_upper_max"] = rnd(max_or_none(e.get("area_cv_lower_ate") for e in contexts), 6)
        row["area_gini_lower_within_upper_mean"] = rnd(mean(e.get("area_gini_lower_ate") for e in contexts), 6)
        row["area_gini_lower_within_upper_max"] = rnd(max_or_none(e.get("area_gini_lower_ate") for e in contexts), 6)
        row["area_p90_p10_lower_within_upper_mean"] = rnd(mean(e.get("area_p90_p10_ratio_lower_ate") for e in contexts), 6)
        row["area_p90_p10_lower_within_upper_max"] = rnd(max_or_none(e.get("area_p90_p10_ratio_lower_ate") for e in contexts), 6)
        row["area_dispersion_method_v105"] = (
            "areas grouped by hierarchy level; excludes topology/adjacency excluded, special/uncertain/context polygons, "
            "polygons <50 km2, and v104 statistical-scope exclusions for 1926/1930/2021"
        )

        summary_rows.append({"year": year, **{k: row.get(k) for k in AREA_METRIC_KEYS if k in row}})

    METRICS_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    with (DOCS / "v105_area_dispersion_metrics_by_year.csv").open("w", newline="", encoding="utf-8") as f:
        fields = ["year"] + [k for k in AREA_METRIC_KEYS if any(k in r for r in summary_rows)]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in summary_rows:
            w.writerow({k: r.get(k) for k in fields})

    with (DOCS / "v105_area_dispersion_contexts.csv").open("w", newline="", encoding="utf-8") as f:
        fields = ["year", "context", "area_count_middle_ate", "area_cv_middle_ate", "area_gini_middle_ate", "area_p90_p10_ratio_middle_ate", "area_count_lower_ate", "area_cv_lower_ate", "area_gini_lower_ate", "area_p90_p10_ratio_lower_ate", "area_mean_lower_ate_km2", "area_min_lower_ate_km2", "area_max_lower_ate_km2"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in context_rows:
            w.writerow({k: r.get(k) for k in fields})

    with (DOCS / "v105_area_dispersion_excluded_features.csv").open("w", newline="", encoding="utf-8") as f:
        fields = ["year", "unit_id", "name", "admin_parent", "admin_intermediate", "admin_superparent", "area_km2", "reason"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in exclusion_rows:
            w.writerow({k: r.get(k) for k in fields})

    print(f"Updated {METRICS_PATH}")
    print(f"Years updated: {len(summary_rows)}; context rows: {len(context_rows)}; excluded rows: {len(exclusion_rows)}")


if __name__ == "__main__":
    main()
