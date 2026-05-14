#!/usr/bin/env python3
"""Static healthcheck for the West Siberia web atlas package.
Run from the project root: python scripts/atlas_healthcheck_v139_1.py
"""
from __future__ import annotations
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
INDEX = ROOT / "index.html"
MANIFEST = ROOT / "data" / "manifest.json"
EXPECTED_VERSION = "139.1"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f"OK: {msg}")


def load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        fail(f"JSON parse failed: {path.relative_to(ROOT)}: {exc}")


def check_js_syntax() -> None:
    try:
        res = subprocess.run(["node", "--check", str(APP)], cwd=ROOT, text=True, capture_output=True)
    except FileNotFoundError:
        print("WARN: node is not installed; skipped JS syntax check")
        return
    if res.returncode != 0:
        fail("node --check app.js failed:\n" + res.stderr)
    ok("app.js syntax")


def check_versions() -> None:
    app_text = APP.read_text(encoding="utf-8")
    html = INDEX.read_text(encoding="utf-8")
    manifest = load_json(MANIFEST)
    if f"const APP_VERSION = '{EXPECTED_VERSION}'" not in app_text:
        fail("APP_VERSION mismatch")
    if f"app.js?v={EXPECTED_VERSION}" not in html or f"style.css?v={EXPECTED_VERSION}" not in html:
        fail("index.html cache-busting version mismatch")
    if str(manifest.get("app_version")) != EXPECTED_VERSION or manifest.get("version") != f"v{EXPECTED_VERSION}":
        fail("manifest version mismatch")
    ok("version sync")


def check_no_early_init() -> None:
    app_text = APP.read_text(encoding="utf-8")
    forbidden = "init().then("
    if forbidden in app_text:
        fail("early init().then(...) call still exists")
    boot_idx = max(app_text.rfind("v139_1_StabilizationLayer"), app_text.rfind("v139StabilizationLayer"))
    init_call_idx = app_text.rfind("await init();")
    if boot_idx < 0 or init_call_idx < boot_idx:
        fail("final v139.1 bootstrap does not own init()")
    ok("single final bootstrap owns init()")


def check_manifest_paths() -> None:
    manifest = load_json(MANIFEST)
    missing: list[str] = []

    def walk(value):
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, str) and (value.startswith("data/") or value.startswith("./data/")):
            p = value[2:] if value.startswith("./") else value
            if not (ROOT / p).exists():
                missing.append(p)

    walk(manifest)
    if missing:
        fail("missing manifest paths:\n" + "\n".join(missing[:50]))
    ok("manifest paths")


def check_data_json() -> None:
    bad = []
    for path in sorted((ROOT / "data").rglob("*.json")) + sorted((ROOT / "data").rglob("*.geojson")):
        try:
            with path.open("r", encoding="utf-8") as f:
                json.load(f)
        except Exception as exc:
            bad.append(f"{path.relative_to(ROOT)}: {exc}")
    if bad:
        fail("bad data json:\n" + "\n".join(bad[:50]))
    ok("data JSON/GeoJSON parse")


def check_known_regressions() -> None:
    app_text = APP.read_text(encoding="utf-8")
    known_bad = ["data/hydro/north_cap.geojson", "$('hydroToggle')", "$('railToggle')", "$('centersToggle')", "side.insertBefore(holder, years.parentElement)"]
    found = [x for x in known_bad if x in app_text]
    if found:
        fail("known regression strings still present: " + ", ".join(found))
    required = ["openTopologyTrends", "v139StableTrendsBound", "advMinStrengthNumberV139", "advMaxImpedanceNumberV139"]
    missing = [x for x in required if x not in app_text]
    if missing:
        fail("required stabilization strings missing: " + ", ".join(missing))
    ok("known regression guards")


def main() -> None:
    check_js_syntax()
    check_versions()
    check_no_early_init()
    check_manifest_paths()
    check_data_json()
    check_known_regressions()
    print("\nHealthcheck passed.")


if __name__ == "__main__":
    main()

