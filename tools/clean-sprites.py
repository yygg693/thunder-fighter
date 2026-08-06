#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI-generated sprite cleaner for thunder-fighter (v4, largest-component crop).

Generation pipeline:
  * ImageGen is asked for sprites on a "solid pure black background" with
    "NO watermark, NO signature, NO text, NO AI branding". The model usually
    honours the black background (~77% of pixels are near-black) but it
    ALWAYS stamps a small watermark in the bottom-right corner that cannot
    be removed by prompt alone.
  * The v3 cleaner used a bbox of "any pixel above the BG floor" to crop.
    That fails on slim ships (diver, sniper) where the halo + faint engine
    trail extends the bbox 3-4x wider than the actual subject.

New strategy:
  1. Paint over the known watermark rectangle with pure (0,0,0) so it
     becomes invisible once alpha gating removes BG pixels.
  2. Threshold the image to a binary foreground mask.
  3. Find the LARGEST connected component and crop to its bounding box
     with a generous margin. This guarantees slim ships crop tightly.
  4. Rescale so the longest edge matches the role target size.
  5. Save as optimized RGBA PNG.

Run:  python tools/clean-sprites.py
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

# bottom-right watermark rect (x1, y1, x2, y2) at 1024x1024
WM_BOX = (770, 910, 1024, 1024)
BG_FLOOR = 30           # pixel max channel value at or below this is "background"
EDGE_RADIUS = 1.5       # soften alpha edge
CROP_MARGIN = 8         # px around the largest component to keep
FLOOD_FLOOR = 64        # stricter threshold when finding the foreground component

TARGETS = {
    "player": 160,
    "boss": 384,
    "enemy_": 128,
    "item_": 64,
}


def target_for(name):
    for prefix, size in TARGETS.items():
        if name.startswith(prefix):
            return size
    return None


def largest_component_bbox(arr):
    """Crop to the bbox of the largest connected non-background component."""
    if HAS_CV2:
        # use cv2 with the stricter floor so we ignore faint halos
        fg = (arr.max(axis=2) >= FLOOD_FLOOR).astype(np.uint8) * 255
        n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
        if n <= 1:
            return None
        # skip the background label (0); pick the biggest by area
        areas = stats[1:, cv2.CC_STAT_AREA]
        best = 1 + int(np.argmax(areas))
        x = stats[best, cv2.CC_STAT_LEFT]
        y = stats[best, cv2.CC_STAT_TOP]
        w = stats[best, cv2.CC_STAT_WIDTH]
        h = stats[best, cv2.CC_STAT_HEIGHT]
        return (x, y, x + w, y + h)

    # Pure-numpy fallback: flood-fill from the four corners with BG_FLOOR,
    # then take the bbox of whatever is NOT flooded.
    bright = arr.max(axis=2)
    fg = (bright > BG_FLOOR).astype(np.uint8)
    h, w = fg.shape
    # simple connected components via scipy? we don't want scipy dependency.
    # Use a cheap bounding box: scan for the first/last row/col with any FG.
    ys, xs = np.where(fg)
    if len(xs) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def process(path):
    im = Image.open(path).convert("RGB")
    arr = np.array(im, dtype=np.uint8)
    h, w, _ = arr.shape

    # 1. paint watermark rect pure black
    x1, y1, x2, y2 = WM_BOX
    sx, sy = w / 1024.0, h / 1024.0
    wx1 = max(0, int(x1 * sx))
    wy1 = max(0, int(y1 * sy))
    wx2 = min(w, int(x2 * sx))
    wy2 = min(h, int(y2 * sy))
    arr[wy1:wy2, wx1:wx2] = 0

    # 2. crop to largest FG component (with margin) BEFORE we touch alpha
    bbox = largest_component_bbox(arr)
    if bbox is None:
        return
    bx1, by1, bx2, by2 = bbox
    bx1 = max(0, bx1 - CROP_MARGIN)
    by1 = max(0, by1 - CROP_MARGIN)
    bx2 = min(w, bx2 + CROP_MARGIN)
    by2 = min(h, by2 + CROP_MARGIN)
    arr = arr[by1:by2, bx1:bx2]

    # 3. alpha by threshold
    brightness = arr.max(axis=2)
    alpha = np.where(brightness <= BG_FLOOR, 0, 255).astype(np.uint8)

    # 4. soften alpha edge
    if EDGE_RADIUS > 0:
        blurred = Image.fromarray(alpha, "L").filter(
            ImageFilter.GaussianBlur(radius=EDGE_RADIUS))
        alpha = np.array(blurred)
        alpha = np.where(alpha < 50, 0,
                         np.where(alpha > 200, 255, alpha)).astype(np.uint8)

    rgba = np.dstack([arr, alpha])

    # 5. resize to role target
    target = target_for(os.path.basename(path))
    if target is None:
        return
    ch, cw = rgba.shape[:2]
    scale = target / float(max(cw, ch))
    if scale < 1.0:
        new_w = max(1, round(cw * scale))
        new_h = max(1, round(ch * scale))
        img = Image.fromarray(rgba, "RGBA").resize((new_w, new_h), Image.LANCZOS)
    else:
        img = Image.fromarray(rgba, "RGBA")

    img.save(path, "PNG", optimize=True)


def main():
    if not os.path.isdir(ASSETS):
        print("no assets dir at", ASSETS)
        return 1
    targets = [n for n in sorted(os.listdir(ASSETS))
               if n.endswith(".png") and not n.startswith("bg_")]
    for n in targets:
        p = os.path.join(ASSETS, n)
        before = os.path.getsize(p)
        process(p)
        after = os.path.getsize(p)
        print("%-22s %6.0fKB -> %5.0fKB" % (n, before / 1024.0, after / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())