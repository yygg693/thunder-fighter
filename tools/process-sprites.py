#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sprite post-processor for thunder-fighter.

AI-generated PNGs come out 1024px with huge transparent padding and ~1.2MB each.
Shipping those raw would (a) make sprites render tiny because the visible pixels
occupy a small part of the canvas, and (b) blow up the "double-click to play"
first load. This script:

  1. auto-crops each sprite to its alpha bounding box (with a small margin)
  2. rescales it so its longest edge matches a per-role target size
  3. writes an optimized PNG back in place
  4. converts the nebula backdrop to JPEG (no alpha needed -> far smaller)

Run:  python tools/process-sprites.py
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

# longest-edge target, in CSS pixels * ~3 for crisp rendering on HiDPI screens
TARGETS = {
    "player": 160,
    "boss": 384,
    "enemy_": 128,
    "item_": 64,
}

MARGIN = 2          # px of transparent padding kept after cropping
ALPHA_FLOOR = 8     # alpha below this counts as fully transparent when cropping
BG_NAME = "bg_nebula.png"
BG_SIZE = (720, 1080)
BG_QUALITY = 88


def target_for(name):
    for prefix, size in TARGETS.items():
        if name.startswith(prefix):
            return size
    return None


def alpha_bbox(im):
    """Bounding box of pixels whose alpha exceeds ALPHA_FLOOR."""
    alpha = im.getchannel("A")
    # Everything at/below ALPHA_FLOOR -> 0, anything above -> 255
    mask = alpha.point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    return mask.getbbox()


def process_sprite(path, target):
    im = Image.open(path).convert("RGBA")
    before = os.path.getsize(path)
    ow, oh = im.size

    box = alpha_bbox(im)
    if box:
        left, upper, right, lower = box
        left = max(0, left - MARGIN)
        upper = max(0, upper - MARGIN)
        right = min(ow, right + MARGIN)
        lower = min(oh, lower + MARGIN)
        im = im.crop((left, upper, right, lower))

    cw, ch = im.size
    scale = target / float(max(cw, ch))
    if scale < 1.0:
        im = im.resize((max(1, round(cw * scale)), max(1, round(ch * scale))),
                       Image.LANCZOS)

    im.save(path, "PNG", optimize=True)
    after = os.path.getsize(path)
    return (ow, oh), (cw, ch), im.size, before, after


def process_background():
    src = os.path.join(ASSETS, BG_NAME)
    if not os.path.exists(src):
        return None
    dst = os.path.join(ASSETS, "bg_nebula.jpg")
    im = Image.open(src).convert("RGB")
    before = os.path.getsize(src)
    im = im.resize(BG_SIZE, Image.LANCZOS)
    im.save(dst, "JPEG", quality=BG_QUALITY, optimize=True, progressive=True)
    after = os.path.getsize(dst)
    os.remove(src)
    return before, after


def main():
    if not os.path.isdir(ASSETS):
        print("no assets dir at", ASSETS)
        return 1

    total_before = 0
    total_after = 0
    rows = []

    for name in sorted(os.listdir(ASSETS)):
        if not name.endswith(".png") or name == BG_NAME:
            continue
        target = target_for(name)
        if target is None:
            print("skip (no target rule):", name)
            continue
        path = os.path.join(ASSETS, name)
        orig, cropped, final, before, after = process_sprite(path, target)
        total_before += before
        total_after += after
        rows.append((name, orig, cropped, final, before, after))

    for name, orig, cropped, final, before, after in rows:
        print("%-20s %s -> crop %s -> %s   %6.0fKB -> %5.0fKB" % (
            name,
            "%dx%d" % orig,
            "%dx%d" % cropped,
            "%dx%d" % final,
            before / 1024.0,
            after / 1024.0,
        ))

    bg = process_background()
    if bg:
        b_before, b_after = bg
        total_before += b_before
        total_after += b_after
        print("%-20s PNG -> JPEG %dx%d          %6.0fKB -> %5.0fKB" % (
            "bg_nebula.jpg", BG_SIZE[0], BG_SIZE[1],
            b_before / 1024.0, b_after / 1024.0))

    print("-" * 72)
    print("TOTAL  %.2fMB -> %.2fMB  (%.1f%% smaller)" % (
        total_before / 1048576.0,
        total_after / 1048576.0,
        (1 - total_after / float(total_before)) * 100 if total_before else 0,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
