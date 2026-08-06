#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-process sprites from .raw_v1/ preserving all detached parts.

Replaces tools/clean-sprites.py v4 which used "largest connected component"
cropping and destroyed fine details (especially for slim ships with
wingtips / cannons as separate components, and ships on solid/gradient
backgrounds where bg+ship merged into one giant component).

New strategy: cv2.floodFill from dense edge seeds with color tolerance.
Everything reachable from the image border = background. Everything else
= subject. This preserves detached parts (wingtips, cannons, sensor pods)
and works uniformly across solid, gradient, and checkerboard backgrounds.

The known watermark in the bottom-right is explicitly masked as bg so it
never inflates the bounding box.

Usage:  python tools/reprocess-sprites.py
"""
import os
import sys

import numpy as np
from PIL import Image
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
RAW = os.path.join(ROOT, ".raw_v1")  # originals (moved out of assets/)

# Watermark rect at 1024x1024 (bottom-right corner)
WM_BOX = (770, 910, 1024, 1024)
# Color tolerance for bg flood-fill (per-channel, BGR space)
TOLERANCE = 40
# Transparent padding kept around the cropped subject
MARGIN = 6
# Step between edge flood seeds (smaller = more thorough, slower)
SEED_STEP = 6

# longest-edge target per role
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


def find_subject_mask(arr_rgb):
    """cv2.grabCut with central-rect hint + watermark forced to bg.

    Replaces the earlier flood-fill approach which bled into ships whose
    panel-line colors sat close to the bg gradient. grabCut's GMM-based
    segmentation cleanly separates "centered object" from "surrounding bg"
    even when their colors are similar.

    The bottom-right watermark is force-marked as definite bg so it can
    never be included in the foreground, regardless of how grabCut decides.
    """
    H, W = arr_rgb.shape[:2]
    bgr = cv2.cvtColor(arr_rgb, cv2.COLOR_RGB2BGR)
    mask = np.full((H, W), cv2.GC_PR_BGD, dtype=np.uint8)
    # Watermark rect -> definite bg
    sx_s, sy_s = W / 1024.0, H / 1024.0
    wx1 = int(WM_BOX[0] * sx_s); wy1 = int(WM_BOX[1] * sy_s)
    wx2 = int(WM_BOX[2] * sx_s); wy2 = int(WM_BOX[3] * sy_s)
    mask[wy1:wy2, wx1:wx2] = cv2.GC_BGD
    # Generous central rect as probable-fg hint (5% inset)
    inset = int(min(H, W) * 0.05)
    rect = (inset, inset, W - 2 * inset, H - 2 * inset)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, mask, rect, bgd_model, fgd_model,
                    5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return np.zeros((H, W), dtype=bool)
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    # Belt + suspenders: force watermark to bg in final mask too
    fg[wy1:wy2, wx1:wx2] = False
    # Morphological close to plug small grabCut holes inside the ship
    kernel = np.ones((5, 5), np.uint8)
    fg_u8 = cv2.morphologyEx((fg.astype(np.uint8)) * 255,
                             cv2.MORPH_CLOSE, kernel, iterations=2)
    return fg_u8 > 127


def process(raw_path, dst_path, target):
    im = Image.open(raw_path).convert("RGB")
    arr = np.array(im, dtype=np.uint8)
    H, W = arr.shape[:2]
    before_size = os.path.getsize(raw_path)

    subj = find_subject_mask(arr)
    ys, xs = np.where(subj)
    if len(xs) == 0:
        print("  no subject found:", os.path.basename(raw_path))
        return None

    x1, x2 = int(xs.min()), int(xs.max()) + 1
    y1, y2 = int(ys.min()), int(ys.max()) + 1
    x1 = max(0, x1 - MARGIN)
    y1 = max(0, y1 - MARGIN)
    x2 = min(W, x2 + MARGIN)
    y2 = min(H, y2 + MARGIN)
    cropped = arr[y1:y2, x1:x2]
    subj_crop = subj[y1:y2, x1:x2]
    # Alpha: bg=0, subject=255. This naturally preserves every detached
    # part because the subject mask is the complement of "edge-connected bg".
    alpha = np.where(subj_crop, 255, 0).astype(np.uint8)
    rgba = np.dstack([cropped, alpha])

    ch, cw = rgba.shape[:2]
    scale = target / float(max(cw, ch))
    if scale < 1.0:
        new_w = max(1, round(cw * scale))
        new_h = max(1, round(ch * scale))
        img = Image.fromarray(rgba, "RGBA").resize(
            (new_w, new_h), Image.LANCZOS
        )
    else:
        img = Image.fromarray(rgba, "RGBA")
    img.save(dst_path, "PNG", optimize=True)
    after_size = os.path.getsize(dst_path)
    return (H, W), (y2 - y1, x2 - x1), img.size, before_size, after_size


def main():
    if not os.path.isdir(RAW):
        print("missing source dir:", RAW)
        return 1
    print("source:", RAW)
    print("dest:  ", ASSETS, "\n")

    rows = []
    for name in sorted(os.listdir(RAW)):
        if not name.endswith(".png"):
            continue
        tgt = target_for(name)
        if tgt is None:
            continue
        r = process(os.path.join(RAW, name), os.path.join(ASSETS, name), tgt)
        if r:
            orig, crop, final, b, a = r
            print(
                "  %-24s %s -> crop %s -> %-12s  %6dKB -> %5dKB"
                % (name, "%dx%d" % orig, "%dx%d" % crop,
                   "%dx%d" % final, b // 1024, a // 1024)
            )
            rows.append((name, final, a))
    print("\nprocessed %d sprites" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())