#!/usr/bin/env python3
"""Flat cartoon picture -> multi-colour SVG for Blender's SVG -> Grease Pencil import.

Usage (vtracer's binding segfaults on Python 3.14 whenever a keyword is passed, so pin 3.12):
  uv run -q --no-project --python 3.12 --with vtracer --with pillow --with svgpathtools \
      python -I vectorize.py <image> <out.svg> [--stacked] [--mirror] [--drop "#D8D8D8" ...]

--stacked  vtracer's layered mode. Default is cutout (side-by-side regions): use cutout for
           anything that will be deformed by bones, stacked tears (hidden layers show).
--mirror   flip horizontally (e.g. make a character face right).
--drop     remove shapes of these exact colours (stray sticker/shadow bits found in the report).

Always: re-encodes the input as real PNG (".png" files are often JPEG) and drops the
full-canvas background plus large neutral-light shapes (sticker borders). Prints the remaining
neutral-light shapes with their position so you can decide what else to --drop (white socks
and eye highlights are neutral-light too, so they are reported, not removed).
"""
import argparse, os, re, tempfile

import vtracer
from PIL import Image
from svgpathtools import parse_path

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--stacked", action="store_true")
ap.add_argument("--mirror", action="store_true")
ap.add_argument("--drop", nargs="*", default=[])
a = ap.parse_args()
drop = {c.upper() for c in a.drop}

with tempfile.TemporaryDirectory() as tmp:
    png = os.path.join(tmp, "in.png")
    Image.open(a.src).convert("RGBA").save(png)
    raw = os.path.join(tmp, "raw.svg")
    vtracer.convert_image_to_svg_py(png, raw, colormode="color", mode="spline",
                                    hierarchical="stacked" if a.stacked else "cutout",
                                    filter_speckle=8, color_precision=5, layer_difference=24)
    svg = open(raw).read()

W, H = (int(v) for v in re.search(r'width="(\d+)" height="(\d+)"', svg).groups())
PATH = re.compile(r'<path d="([^"]*)" fill="(#[0-9A-Fa-f]{6})" transform="translate\(([\d.-]+),([\d.-]+)\)"\s*/>\n?')
kept, report = [], []
for m in PATH.finditer(svg):
    d, col, tx, ty = m.groups(); col = col.upper()
    r, g, b = (int(col[i:i + 2], 16) for i in (1, 3, 5))
    x0, x1, y0, y1 = parse_path(d).bbox()
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2 + float(tx), (y0 + y1) / 2 + float(ty)
    neutral_light = min(r, g, b) > 180 and max(r, g, b) - min(r, g, b) < 20
    if col in drop or (neutral_light and (w > 0.25 * W or h > 0.25 * H)):
        print(f"dropped {col} {w:.0f}x{h:.0f} at ({cx:.0f},{cy:.0f})")
        continue
    if neutral_light:
        report.append(f"  neutral-light {col} {w:.0f}x{h:.0f} at ({cx:.0f},{cy:.0f})")
    kept.append(m.group(0).rstrip("\n"))

head = svg[:svg.index("<path")]
body = "\n".join(kept)
if a.mirror:
    body = f'<g transform="translate({W},0) scale(-1,1)">\n{body}\n</g>'
open(a.out, "w").write(f"{head}{body}\n</svg>\n")
print(f"paths kept: {len(kept)} -> {a.out}  (coords are before --mirror)")
print("\n".join(report) or "  no other neutral-light shapes")
