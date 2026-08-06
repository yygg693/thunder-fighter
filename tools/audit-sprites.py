#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Objective sprite quality audit for thunder-fighter.

For every non-bg PNG in assets/:
  * w, h, file size
  * foreground mask = alpha > 50
  * coverage ratio (FG / total)
  * content bbox of FG (left/top/right/bottom), bbox size
  * off-center: (bbox_cx - W/2, bbox_cy - H/2) in pixels, plus normalized
  * interior "holes": flood fill transparent from border; enclosed
    transparent pixels = holes; report hole count + total hole area
  * FG connected components count and the area share of the biggest one
    (lowest share => the sprite is made of many disconnected islands)

Run:  python tools/audit-sprites.py
"""
import os
import sys
import numpy as np
from PIL import Image

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")


def audit(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    arr = np.array(im, dtype=np.uint8)
    alpha = arr[..., 3]
    rgb = arr[..., :3]

    # FG mask: opaque-ish pixels (alpha > 50) AND above BG floor
    bright = rgb.max(axis=2)
    fg = ((alpha > 50) & (bright > 30)).astype(np.uint8)

    cov = float(fg.sum()) / (w * h)
    ys, xs = np.where(fg)
    if len(xs) == 0:
        return None
    bx1, by1, bx2, by2 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    bw, bh = bx2 - bx1, by2 - by1
    bcx = (bx1 + bx2) / 2.0
    bcy = (by1 + by2) / 2.0
    offx = bcx - w / 2.0
    offy = bcy - h / 2.0

    # Holes via cv2 flood fill from border (over NOT-FG = transparent region)
    # We mark transparent area, then flood fill from the 4 image borders
    # with a new label; remaining transparent pixels with NO label = holes.
    not_fg = (1 - fg)
    if HAS_CV2:
        mask = (not_fg * 255).astype(np.uint8)
        # floodFill requires a 1-px padded mask; we make a local copy
        fmask = np.zeros((h + 2, w + 2), dtype=np.uint8)
        fmask[1:-1, 1:-1] = mask
        ff = mask.copy()
        ffmask = np.zeros((h + 2, w + 2), dtype=np.uint8)
        cv2.floodFill(ff, ffmask, (0, 0), 255)
        # pixels flooded from border = reachable bg; the rest of not_fg = holes
        holes = (not_fg & (ff < 128))
        hole_count = 0
        # count distinct hole blobs
        n, _, _, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
        hole_count = max(0, n - 1)
        hole_area = int(holes.sum())
    else:
        holes = np.zeros_like(fg)
        hole_count = 0
        hole_area = 0

    # FG connected components
    if HAS_CV2:
        n, _, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
        n_fg = max(0, n - 1)
        if n_fg > 0:
            areas = stats[1:, cv2.CC_STAT_AREA]
            biggest_share = float(areas.max()) / max(1, int(areas.sum()))
        else:
            biggest_share = 1.0
    else:
        n_fg = 0
        biggest_share = 1.0

    return dict(
        name=os.path.basename(path),
        w=w, h=h,
        cov=cov,
        bbox=f"{bw}x{bh}@{bx1},{by1}",
        off=f"({offx:+.0f},{offy:+.0f})",
        holes_n=hole_count,
        hole_area=hole_area,
        n_fg=n_fg,
        biggest_share=biggest_share,
    )


def main():
    rows = []
    for n in sorted(os.listdir(ASSETS)):
        if not n.endswith(".png"):
            continue
        if n.startswith("bg_"):
            continue
        p = os.path.join(ASSETS, n)
        r = audit(p)
        if r is None:
            continue
        rows.append(r)

    # pretty print
    print(f"{'name':<20} {'size':<11} {'cov%':>5} {'bbox':<14} {'off':<10} {'holes':>6} {'FGcc':>4} {'biggest%':>8}")
    for r in rows:
        print(f"{r['name']:<20} {r['w']}x{r['h']:<7} {r['cov']*100:>4.0f}  {r['bbox']:<14} {r['off']:<10} {r['holes_n']:>3}({r['hole_area']:>5}) {r['n_fg']:>4} {r['biggest_share']*100:>7.0f}")


if __name__ == "__main__":
    sys.exit(main() or 0)