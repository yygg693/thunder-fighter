#!/usr/bin/env python3
"""
Post-process AI-generated sprites: remove the opaque light-gray background and
bottom-right watermark that ImageGen leaves behind despite background=transparent.

WHY A SECOND STAGE IS NEEDED (history / root cause)
  ImageGen ships many sprites whose SUBJECT is itself gray/metal (bosses, the
  stealth skin). The subject is identical in COLOR to the background gray, so a
  naive "key out all neutral-gray" destroys gray ships. The only reliable
  distinction for the *border* background is CONNECTIVITY (bg touches edges,
  subject sits interior) -> edge-seeded flood. But a lot of the leftover gray is
  a DITHERED / FILLED gray field that was shattered into many *disconnected*
  interior blobs by the AI. Those blobs are neither edge-connected (flood can't
  reach them) nor large-enough to trip the old "colored image" neutral-fill
  branch (they sit between SPECK_MAX and BG_FILL_MIN), nor are they caught by the
  colored-only key fallback for gray ships. -> they survive as the "mosaic".

THE FIX (this file)
  After the edge-flood, we label every opaque connected component and classify it
  with TWO orthogonal signals:
    1. neutral?        avg channel-spread (saturation) of the component.
    2. smooth?         internal gradient energy + internal edge-pixel fraction.
                       A smooth gray FILL has near-zero internal gradient (flat
                       gray, no panel lines/edges). A detailed ship hull -- even
                       a gray one -- has high internal gradient (cockpit, armor
                       seams, engine rims, weave gaps).
  We then DELETE components that are neutral AND smooth (background fill), while
  PROTECTING: the dominant/largest component, clearly colored components, and
  detailed components. This works for gray bosses AND colored bosses AND gray
  skins, and automatically spares the stealth skin (dark gray, dominant, and its
  gray is below the bright-neutral threshold so it is never even selected).

Run after generating new assets/player_*.png and assets/boss_*.png.
"""
import os
from collections import Counter
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

PATTERNS = [
    'player_cyan_knight.png', 'player_crimson_falcon.png', 'player_emerald.png',
    'player_violet.png', 'player_stealth.png', 'player_golden.png',
    'boss_sentinel.png', 'boss_scorpion.png', 'boss_carrier.png',
    'boss_core.png', 'boss_phaser.png', 'boss_void.png', 'boss_weaverqueen.png',
]

WM_SAT_MAX = 45         # watermark is near-gray
WM_BRIGHT_MIN = 130     # watermark is fairly light
WM_RIGHT = 250          # width of bottom-right corner strip to scan
WM_BOTTOM = 120         # height of bottom-right corner strip to scan

SEED_STEP = 12          # edge seed spacing (denser = more robust)
SEED_TOL = 70           # floodfill tolerance from each edge seed
SEED_SAT_MAX = 30       # edge seed must be near-neutral (background, not colored subject)
SEED_BRIGHT_MIN = 300   # edge seed must be bright (background, not dark subject)

ALPHA_TH = 128          # pixel considered "opaque" for component analysis

# ---- neutral-fill (background) classification ---------------------------------
SPECK_MAX = 2000        # connected components smaller than this = dithered specks -> removed
SAT_NEUTRAL = 18        # component avg channel-spread below this -> "gray"
COLOR_SAT_MIN = 25      # component avg channel-spread at/above this -> "colored" (kept)
GRAD_FILL = 7.0         # internal gradient mean below this (and edgeFrac below) -> smooth fill
EDGE_FILL = 0.10        # internal edge-pixel fraction below this -> smooth fill
GRAD_SUBJECT = 9.0      # internal gradient mean at/above this -> detailed (kept)
EDGE_SUBJECT = 0.12     # internal edge-pixel fraction at/above this -> detailed (kept)
FILL_SIZE_MAX = 8000    # neutral-smooth components larger than this are NOT auto-removed
                        # (insurance: never eat a large gray hull that somehow reads smooth)
EDGE_GRAD_PIXEL = 30    # per-pair 3-channel abs-diff sum above this marks a pixel as "edgy"


def detect_bg(px, w, h):
    """Dominant neutral-bright opaque color (bucketed). Returns (r,g,b) or None."""
    cnt = Counter()
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r, g, b, a = px[x, y]
            if a > 200 and (r + g + b) > 360 and (max(r, g, b) - min(r, g, b)) < 20:
                cnt[(r // 4 * 4, g // 4 * 4, b // 4 * 4)] += 1
    if not cnt:
        return None
    return cnt.most_common(1)[0][0]


def is_bg_seed(c, bg, tol=SEED_TOL, sat_max=SEED_SAT_MAX, bright_min=SEED_BRIGHT_MIN):
    r, g, b, a = c
    if a < 200:
        return False
    if (r + g + b) < bright_min:
        return False
    if (max(r, g, b) - min(r, g, b)) > sat_max:   # saturated -> likely colored subject
        return False
    if bg is None:
        return False
    return abs(r - bg[0]) < tol and abs(g - bg[1]) < tol and abs(b - bg[2]) < tol


def clean(path):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()
    bg = detect_bg(px, w, h)
    if bg is None:
        _wipe_watermark(img, w, h)
        img.save(path)
        return path

    # 1) Edge-seeded flood: clear the edge-connected bright-neutral background,
    #    preserve the (possibly gray) interior subject.
    step = SEED_STEP
    seeds = []
    for x in range(0, w, step):
        seeds.append((x, 0))
        seeds.append((x, h - 1))
    for y in range(0, h, step):
        seeds.append((0, y))
        seeds.append((w - 1, y))
    for (sx, sy) in seeds:
        if is_bg_seed(px[sx, sy], bg):
            ImageDraw.floodfill(img, (sx, sy), (0, 0, 0, 0), thresh=SEED_TOL)

    # 2) Connected-component filtering with neutral/smooth discrimination:
    #    delete dithered specks and smooth neutral "fill" background blobs, while
    #    protecting the ship (colored / detailed / dominant).
    filter_background_fill(img)

    _wipe_watermark(img, w, h)
    img.save(path)
    return path


def filter_background_fill(img):
    """Remove background artifacts (dithered specks + smooth neutral fill blobs).

    For every opaque connected component we compute:
      * avg channel-spread  (saturation) -> neutral vs colored
      * internal gradient mean (sum of |d| over opaque-opaque neighbor pairs)
      * internal edge-pixel fraction (pixels with an opaque-opaque neighbor whose
        3-channel abs-diff sum exceeds EDGE_GRAD_PIXEL)
    A component is background fill iff it is NEUTRAL and SMOOTH (low gradient,
    low edge fraction) and not the dominant/colored/detailed subject. This is
    color-agnostic, so it cleans both gray and colored ships correctly.
    """
    w, h = img.size
    px = img.load()
    mask = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[x, y][3] > ALPHA_TH:
                mask[row + x] = 1
    labels = [0] * (w * h)
    comps = []
    cur = 0
    for i in range(w * h):
        if mask[i] and labels[i] == 0:
            cur += 1
            stack = [i]
            labels[i] = cur
            comp = []
            while stack:
                p = stack.pop()
                comp.append(p)
                x = p % w
                y = p // w
                if x + 1 < w:
                    q = p + 1
                    if mask[q] and labels[q] == 0:
                        labels[q] = cur
                        stack.append(q)
                if x - 1 >= 0:
                    q = p - 1
                    if mask[q] and labels[q] == 0:
                        labels[q] = cur
                        stack.append(q)
                if y + 1 < h:
                    q = p + w
                    if mask[q] and labels[q] == 0:
                        labels[q] = cur
                        stack.append(q)
                if y - 1 >= 0:
                    q = p - w
                    if mask[q] and labels[q] == 0:
                        labels[q] = cur
                        stack.append(q)
            comps.append(comp)

    ncomp = cur
    # per-component aggregates
    sat_sum = [0] * (ncomp + 1)
    grad_sum = [0] * (ncomp + 1)
    pair_cnt = [0] * (ncomp + 1)
    edge_cnt = [0] * (ncomp + 1)
    # per-pixel internal gradient + edge flag
    pix_grad = [0] * (w * h)
    pix_edge = bytearray(w * h)

    for p in range(w * h):
        if not mask[p]:
            continue
        x = p % w
        y = p // w
        r, g, b = px[x, y][:3]
        lab = labels[p]
        sat_sum[lab] += (max(r, g, b) - min(r, g, b))
        # look right and down for opaque-opaque neighbors
        for dx, dy in ((1, 0), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                q = ny * w + nx
                if mask[q]:
                    rr, gg, bb = px[nx, ny][:3]
                    d = abs(r - rr) + abs(g - gg) + abs(b - bb)
                    pix_grad[p] += d
                    grad_sum[lab] += d
                    pair_cnt[lab] += 1
                    if d > EDGE_GRAD_PIXEL:
                        pix_edge[p] = 1

    for p in range(w * h):
        if mask[p]:
            edge_cnt[labels[p]] += pix_edge[p]

    # dominant (largest) component index
    largest = max(range(1, ncomp + 1), key=lambda c: len(comps[c - 1]))

    for ci in range(1, ncomp + 1):
        comp = comps[ci - 1]
        size = len(comp)
        avg_sat = sat_sum[ci] / size if size else 0
        grad_mean = grad_sum[ci] / pair_cnt[ci] if pair_cnt[ci] else 0.0
        edge_frac = edge_cnt[ci] / size if size else 0.0

        neutral = avg_sat < SAT_NEUTRAL
        smooth = (grad_mean < GRAD_FILL) and (edge_frac < EDGE_FILL)
        colored = avg_sat >= COLOR_SAT_MIN
        detailed = (grad_mean >= GRAD_SUBJECT) or (edge_frac >= EDGE_SUBJECT)
        is_subject = colored or detailed or (ci == largest)

        if size < SPECK_MAX:
            kill = True                      # tiny dithered speck
        elif neutral and smooth and (size < FILL_SIZE_MAX) and (not is_subject):
            kill = True                      # smooth neutral fill = background
        else:
            kill = False

        if kill:
            for p in comp:
                x = p % w
                y = p // w
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return img


def _wipe_watermark(img, w, h):
    px = img.load()
    for y in range(h - WM_BOTTOM, h):
        for x in range(w - WM_RIGHT, w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            bright = max(r, g, b)
            sat = max(r, g, b) - min(r, g, b)
            if sat < WM_SAT_MAX and bright > WM_BRIGHT_MIN:
                img.putpixel((x, y), (r, g, b, 0))


def main():
    for name in PATTERNS:
        path = os.path.join(ASSETS, name)
        if not os.path.exists(path):
            print(f"SKIP (missing): {name}")
            continue
        clean(path)
        print(f"CLEAN: {name}")


if __name__ == '__main__':
    main()
