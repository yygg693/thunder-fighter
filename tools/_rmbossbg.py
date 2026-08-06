#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Key out the opaque colored background from the 3 dark bosses (phaser/void/weaverqueen).

The other 4 bosses were generated on pure-black backgrounds, so clean-sprites.py
(BG_FLOOR=30) removed their bg. These 3 got COLORED backgrounds (gray / dark-blue /
purple-gray) that sit above the 30 floor, leaving them as opaque rectangles.

Fix: color-key the detected background color from border + dominant cluster,
flood-fill any interior bg islands from the borders, blank the AI watermark box,
then feather the alpha edge.

Run:  python tools/_rmbossbg.py
Writes ./_boss_{kind}_clean.png (verification), then you audit + composite.
"""
import os
from collections import Counter, deque
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

# Tuned per-boss to eat the shaded halo while preserving art.
# phaser bg ~gray 168; art bright purple/white.
# void bg ~dark blue-purple 47; art bright purple cracks.
# weaverqueen bg ~purple-gray 107; art bright threads.
TOLS = {
    "phaser": 90,
    "void": 76,
    "weaverqueen": 84,
}
FEATHER = 2       # alpha Gaussian blur radius (soft edge)
# Backgrounds are neutral (near-zero saturation); boss art is saturated (purple/
# blue threads, cracks, crystal). Gate is_bg on LOW saturation so a light-grey
# body on a grey bg (phaser) is kept, while the neutral-grey bg floods away.
SAT_FLOOR = 45     # max (max-min channel) for a pixel to count as "neutral bg"
WM_BOX = (770, 910, 1024, 1024)  # AI watermark stamp at 1024x1024
BOSSES = ["phaser", "void", "weaverqueen"]


def detect_bg(im):
    """Background color = average of border pixels blended with the most common
    quantized opaque color. Border average alone can be skewed by the watermark
    or shading; blending with the dominant cluster centers it on the true bg."""
    w, h = im.size
    px = im.load()
    bs = []
    for x in range(w):
        bs.append(px[0, x][:3]); bs.append(px[h - 1, x][:3])
    for y in range(h):
        bs.append(px[y, 0][:3]); bs.append(px[y, w - 1][:3])
    border_bg = [sum(c[i] for c in bs) // len(bs) for i in range(3)]
    cnt = Counter()
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r, g, b, a = px[x, y]
            if a > 128:
                cnt[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] += 1
    dom = cnt.most_common(1)[0][0] if cnt else border_bg
    # weighted blend: border average is local, dominant is global
    bg = [int((border_bg[i] + dom[i]) / 2) for i in range(3)]
    return bg


def remove_bg(src, dst, tol, feather):
    """Key out opaque bg by flood-filling every background-colored region reachable
    from the image borders (plus enclosed interior holes). This preserves ALL art —
    including disconnected side pieces (e.g. weaverqueen's tendrils) and mid-tone
    bodies (e.g. phaser's crystal) — because only background-colored pixels that
    connect to the border are removed. Art pixels, even if mid-tone, sit interior
    and are never reached by the flood, so they survive.

    This replaced an earlier 'keep largest connected component' approach which
    (a) destroyed phaser's sparse mid-tone body and (b) amputated weaverqueen's
    disconnected tendrils.
    """
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = detect_bg(im)

    def diff(p):
        return max(abs(p[0] - bg[0]), abs(p[1] - bg[1]), abs(p[2] - bg[2]))

    def sat(p):
        return max(p) - min(p)

    # Pre-blank the AI watermark box to bg color (it touches the right/bottom
    # borders, so the flood reaches it anyway; blanking just makes it explicit).
    for y in range(max(0, WM_BOX[1]), min(h, WM_BOX[3])):
        for x in range(max(0, WM_BOX[0]), min(w, WM_BOX[2])):
            px[x, y] = (bg[0], bg[1], bg[2], 255)

    # is_bg: opaque, close to the detected neutral bg color, AND low saturation.
    # The saturation gate is what saves a light-grey body (phaser) that is close
    # in lightness to its grey bg — the body is purple (saturated), the bg is
    # neutral (desaturated). Halos are neutral-grey too, so they still flood.
    is_bg = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3] > 128 and diff(p[:3]) <= tol and sat(p[:3]) < SAT_FLOOR:
                is_bg[y][x] = True

    # Flood-fill from every border bg pixel.
    removed = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg[y][x] and not removed[y][x]:
                q.append((y, x)); removed[y][x] = True
    for y in range(h):
        for x in (0, w - 1):
            if is_bg[y][x] and not removed[y][x]:
                q.append((y, x)); removed[y][x] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and is_bg[ny][nx] and not removed[ny][nx]:
                removed[ny][nx] = True
                q.append((ny, nx))

    # Remove enclosed interior bg holes (bg-colored regions NOT touching a border,
    # e.g. gaps between the boss's legs) so they don't render as opaque blocks.
    seen = [[False] * w for _ in range(h)]
    for sy in range(h):
        for sx in range(w):
            if is_bg[sy][sx] and not removed[sy][sx] and not seen[sy][sx]:
                comp = []
                qq = deque([(sy, sx)])
                seen[sy][sx] = True
                touches = False
                while qq:
                    y, x = qq.popleft()
                    comp.append((y, x))
                    if y == 0 or y == h - 1 or x == 0 or x == w - 1:
                        touches = True
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and is_bg[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            qq.append((ny, nx))
                if not touches:
                    for (y, x) in comp:
                        removed[y][x] = True

    # Keep everything NOT removed.
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    kept = 0
    for y in range(h):
        for x in range(w):
            if not removed[y][x]:
                r, g, b, a = px[x, y]
                op[x, y] = (r, g, b, a)
                kept += 1

    if feather > 0:
        a2 = out.split()[3].filter(ImageFilter.GaussianBlur(feather))
        out.putalpha(a2)
    out.save(dst)
    total = w * h
    return bg, kept, total


def edge_clear(path, margin=8):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    c = t = 0
    for y in range(h):
        for x in range(w):
            if x < margin or x >= w - margin or y < margin or y >= h - margin:
                t += 1
                if px[x, y][3] < 10:
                    c += 1
    return 100 * c / max(t, 1)


def composite(path, dst, bg=(18, 22, 38)):
    """Paste the (now transparent) boss onto a dark nebula-ish background to eyeball it."""
    bgimg = Image.new("RGBA", (1024, 1024), bg + (255,))
    boss = Image.open(path).convert("RGBA")
    bgimg.alpha_composite(boss, (0, 0))
    bgimg.convert("RGB").save(dst)


if __name__ == "__main__":
    for b in BOSSES:
        src = os.path.join(ASSETS, f"boss_{b}.png")
        clean = os.path.join(ROOT, f"_boss_{b}_clean.png")
        comp = os.path.join(ROOT, f"_boss_{b}_composite.png")
        bg, kept, total = remove_bg(src, clean, TOLS[b], FEATHER)
        ec = edge_clear(clean)
        composite(clean, comp)
        print(f"{b:12s} bg={tuple(bg)} kept={kept}/{total} "
              f"({100*kept/total:.1f}% of canvas) edge_clear={ec:.1f}%")
