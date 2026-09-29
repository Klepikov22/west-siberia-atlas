#!/usr/bin/env python3
"""Check the GeoJSON contract used by the administrative map and selection tools."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(manifest_path: Path, strict_labels: bool = False) -> tuple[list[str], list[str], int]:
    manifest_path = manifest_path.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    paths = manifest.get("layers", {}).get("admin", {})
    years = manifest.get("years", [])
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(paths, dict) or not paths:
        return ["В манифесте отсутствует layers.admin"], [], 0
    if not isinstance(years, list) or not years:
        errors.append("В манифесте отсутствует years")
    for year in years if isinstance(years, list) else []:
        if str(year) not in paths:
            errors.append(f"{year}: нет пути в layers.admin")
    count = 0
    for year, relative_path in paths.items():
        # The manifest is normally data/manifest.json; data/... paths are relative to project root.
        if not isinstance(relative_path, str):
            errors.append(f"{year}: путь административного слоя должен быть строкой")
            continue
        project_root = manifest_path.parent.parent
        candidate = project_root / relative_path
        if not candidate.is_file():
            errors.append(f"{year}: файл административного слоя не найден: {relative_path}")
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            errors.append(f"{year}: нельзя прочитать GeoJSON: {exc}")
            continue
        if not isinstance(data, dict) or data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            errors.append(f"{year}: ожидается FeatureCollection с массивом features")
            continue
        seen: set[str] = set()
        for index, feature in enumerate(data["features"]):
            count += 1
            label = f"{year}, объект #{index + 1}"
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                errors.append(f"{label}: ожидается GeoJSON Feature")
                continue
            props = feature.get("properties")
            if not isinstance(props, dict):
                errors.append(f"{label}: properties должен быть объектом")
                continue
            uid = str(props.get("unit_id") or "").strip()
            if not uid:
                errors.append(f"{label}: отсутствует unit_id")
            elif uid in seen:
                errors.append(f"{label}: повторяется unit_id={uid}")
            else:
                seen.add(uid)
            missing = [key for key in ("name", "unit_type", "admin_parent") if not props.get(key)]
            if missing:
                (errors if strict_labels else warnings).append(
                    f"{label} ({uid or 'без ID'}): пустые поля {', '.join(missing)}"
                )
            geometry = feature.get("geometry") or {}
            kind = geometry.get("type")
            if kind not in ("Polygon", "MultiPolygon"):
                errors.append(f"{label}: выборка работает только с Polygon/MultiPolygon, получен {kind}")
                continue
            coordinates = geometry.get("coordinates")
            polygons = [coordinates] if kind == "Polygon" else coordinates
            if not isinstance(polygons, list) or not polygons:
                errors.append(f"{label}: пустые координаты")
                continue
            for polygon_index, polygon in enumerate(polygons):
                if not isinstance(polygon, list) or not polygon:
                    errors.append(f"{label}: пустой полигон #{polygon_index + 1}")
                    continue
                for ring_index, ring in enumerate(polygon):
                    target = f"{label}, полигон #{polygon_index + 1}, контур #{ring_index + 1}"
                    if not isinstance(ring, list) or len(ring) < 4:
                        errors.append(f"{target}: контур короче четырёх точек")
                        continue
                    if ring[0] != ring[-1]:
                        errors.append(f"{target}: контур не замкнут")
                    for point in ring:
                        if (not isinstance(point, list) or len(point) < 2 or
                            any(isinstance(v, bool) or not isinstance(v, (int, float)) or
                                not math.isfinite(v) for v in point[:2]) or
                            not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
                            errors.append(f"{target}: неверная координата [долгота, широта]")
                            break
    return errors, warnings, count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "manifest.json")
    parser.add_argument("--strict-labels", action="store_true", help="считать пустые подписи ошибками")
    args = parser.parse_args()
    errors, warnings, count = validate(args.manifest, args.strict_labels)
    for warning in warnings:
        print("WARNING:", warning)
    for error in errors:
        print("ERROR:", error)
    print(f"Проверено {count} административных объектов: {len(errors)} ошибок, {len(warnings)} предупреждений")
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
