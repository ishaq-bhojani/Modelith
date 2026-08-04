"""
Renders build/icon.png from the same geometry as build/icon.svg.

Why this is not a browser: `BrowserWindow.icon` needs a raster and will not
take SVG, so a PNG has to exist. Two browser-based attempts failed in ways that
cost more than they were worth — `capturePage()` deadlocks on a window that
never paints, and an in-page canvas decode of the SVG never settles. Pillow is
already installed and the artwork is simple enough to draw directly: a rounded
rect with a linear gradient, plus three round-capped strokes.

The trade-off is that the geometry lives in two places. build/icon.svg stays
the source of truth (electron-builder reads it to generate the .icns/.ico/PNG
set); this script mirrors it only to produce the one raster Electron needs at
runtime. Change the SVG and you must change the constants here to match — the
values below are lifted directly from it and are checked by
tests/unit/icon-geometry.test.ts.

Run: python scripts/render-icon.py
"""
from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = int(0.224 * SIZE)          # 22.4% corner radius, per the brand spec
MARK_SCALE = 656 / 24               # the mark is 656px of the 1024 tile
MARK_OFFSET = (SIZE - 656) / 2      # centred
STROKE = 2.4 * MARK_SCALE           # 2.4 units in the mark's own 24-unit space

# linear-gradient(140deg, #7c81ff 0%, #494fdf 52%, #3a40c4 100%)
STOPS = [(0.0, (0x7C, 0x81, 0xFF)), (0.52, (0x49, 0x4F, 0xDF)), (1.0, (0x3A, 0x40, 0xC4))]

# The three strokes, in the mark's 24-unit space. Taken from icon.svg's paths:
#   M9.4 7 4.6 12l4.8 5   m14.6 7 4.8 5-4.8 5   M13.3 6.4 10.7 17.6
POLYLINES = [
    [(9.4, 7), (4.6, 12), (9.4, 17)],
    [(14.6, 7), (19.4, 12), (14.6, 17)],
    [(13.3, 6.4), (10.7, 17.6)],
]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient_colour(t):
    """Colour at position t (0..1) along the gradient line."""
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            span = t1 - t0
            return lerp(c0, c1, 0.0 if span == 0 else (t - t0) / span)
    return STOPS[-1][1]


def build_gradient():
    """
    A CSS angle is measured clockwise from "to top", so 140deg gives the
    direction vector (sin140, -cos140) = (0.643, 0.766) — right and downward in
    image space. Project each pixel onto that axis to get its position.
    """
    dx, dy = 0.6428, 0.7660
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    # Projection range across the square, so t spans exactly 0..1 corner to corner.
    lo = min(x * dx + y * dy for x in (0, SIZE) for y in (0, SIZE))
    hi = max(x * dx + y * dy for x in (0, SIZE) for y in (0, SIZE))
    for y in range(SIZE):
        ydy = y * dy
        for x in range(SIZE):
            px[x, y] = gradient_colour(((x * dx + ydy) - lo) / (hi - lo))
    return img


def to_tile(pt):
    return (pt[0] * MARK_SCALE + MARK_OFFSET, pt[1] * MARK_SCALE + MARK_OFFSET)


def main():
    tile = build_gradient()

    # Rounded-rect alpha mask: everything outside the corners must be fully
    # transparent, or the icon reads as a white square with a tile painted on it.
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(tile, (0, 0), mask)

    # The mark. Pillow has no round line caps, so each vertex gets a circle of
    # the stroke's diameter — which is exactly what a round cap and a round
    # join both are.
    draw = ImageDraw.Draw(icon)
    r = STROKE / 2
    for line in POLYLINES:
        pts = [to_tile(p) for p in line]
        draw.line(pts, fill=(255, 255, 255, 255), width=round(STROKE))
        for (x, y) in pts:
            draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255))

    icon.save("build/icon.png")
    print(f"wrote build/icon.png ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
