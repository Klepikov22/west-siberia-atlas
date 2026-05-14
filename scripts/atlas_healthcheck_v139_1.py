#!/usr/bin/env python3
"""Compatibility wrapper: v139.1 was superseded by v139.2 in this package."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("atlas_healthcheck_v139_2.py")), run_name="__main__")
