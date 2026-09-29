#!/usr/bin/env python3
"""Read-only structural checks for the packaged static atlas."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifest.json"
INDEX = ROOT / "index.html"
APP = ROOT / "app.js"
RUNTIME = ROOT / "map-runtime.js"
GEOMETRY = ROOT / "atlas-geometry.js"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    app = APP.read_text(encoding="utf-8")
    html = INDEX.read_text(encoding="utf-8")
    match = re.search(r"const APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", app)
    if not match:
        raise SystemExit("APP_VERSION не найден в app.js")
    version = match.group(1)
    if manifest.get("app_version") != version or manifest.get("version") != f"v{version}":
        raise SystemExit("Версии app.js и data/manifest.json различаются")
    for asset in ("atlas-geometry.js", "app.js", "style.css", "selection-sketch.js", "map-runtime.js", "timeline-axis.js"):
        if f'{asset}?v={version}' not in html:
            raise SystemExit(f"В index.html не синхронизирован {asset}")
    order = [html.index(f'{asset}?v={version}') for asset in
             ("atlas-geometry.js", "app.js", "selection-sketch.js", "map-runtime.js", "timeline-axis.js")]
    if order != sorted(order):
        raise SystemExit("Неверный порядок JS: geometry → app → sketch → runtime → timeline")

    paths: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, str) and value.startswith("data/"):
            if "{year}" in value:
                paths.update(value.replace("{year}", str(year)) for year in manifest["years"])
            else:
                paths.add(value)

    collect(manifest)
    missing = [name for name in sorted(paths) if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Отсутствуют пути из manifest:\n" + "\n".join(missing[:20]))

    for script in (GEOMETRY, APP, ROOT / "selection-sketch.js", RUNTIME, ROOT / "timeline-axis.js"):
        subprocess.run(["node", "--check", str(script)], check=True, cwd=ROOT)

    print(f"OK: v{version}, {len(paths)} путей данных, синтаксис пяти JS-файлов")


if __name__ == "__main__":
    main()
