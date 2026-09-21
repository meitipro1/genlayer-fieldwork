"""Generate the brand assets from the mark's own geometry.

    python scripts/make_brand.py

There is no SVG rasteriser on this machine, so the mark is drawn directly from
the same numbers the SVG path uses rather than converted from it. Every figure
below is read off `components/Logo.tsx`, and the two shapes are:

  brackets  four corner elbows on a 24 unit grid, stroke 2.1, round caps,
            corner radius 1.6
  pin       a circle of radius 4.25 centred at (12, 10.78) with a triangle
            down to the tip at (12, 17.63), then a hole of radius 1.5

The triangle's top corners are the tangent points from the tip to that circle,
which is what makes the teardrop meet the circle smoothly instead of showing a
seam. Drawn at 6x and downsampled, because PIL has no antialiasing of its own.
"""

import pathlib
import math

import PIL.Image
import PIL.ImageDraw

OUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "brand"

# Straight from app/globals.css. If the palette moves, these move with it.
DARK_BG = "#101216"
DARK_PANEL = "#171a1f"
DARK_ACCENT = "#7ac943"
LIGHT_BG = "#f5f6f2"
LIGHT_PANEL = "#ffffff"
LIGHT_ACCENT = "#427716"

SS = 6  # supersampling factor

# --- geometry, on the 24 unit viewBox -------------------------------------
STROKE = 2.1
RADIUS = 1.6
PIN_C = (12.0, 10.78)
PIN_R = 4.25
PIN_TIP = (12.0, 17.63)
HOLE_R = 1.5


def _tangent_points():
    """Where the teardrop's straight edges meet the circle."""
    cx, cy = PIN_C
    d = PIN_TIP[1] - cy
    theta = math.acos(PIN_R / d)
    dx = PIN_R * math.sin(theta)
    dy = PIN_R * math.cos(theta)
    return (cx - dx, cy + dy), (cx + dx, cy + dy)


def draw_mark(size: int, fg: str, hole: str) -> PIL.Image.Image:
    """The mark alone, on transparency."""
    n = size * SS
    img = PIL.Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = PIL.ImageDraw.Draw(img)
    u = n / 24.0                      # one viewBox unit in pixels
    w = max(1, round(STROKE * u))     # stroke width
    p = lambda x, y: (x * u, y * u)   # noqa: E731 - point helper

    def stroke(points):
        """A polyline with round caps and round joins.

        PIL has neither, so the join is made by hand: a disc at every vertex,
        the same diameter as the stroke. Stroking the straights and arcing the
        elbow separately leaves a visible step at all eight corners, because
        `arc` ends on a radial cut that a butt-ended line cannot meet. Sampling
        the elbow into the same polyline removes the seam entirely.
        """
        px = [p(x, y) for x, y in points]
        d.line(px, fill=fg, width=w, joint="curve")
        r = w / 2
        for x, y in px:
            d.ellipse([x - r, y - r, x + r, y + r], fill=fg)

    def elbow(cx, cy, a0, a1, steps=24):
        """The corner radius, sampled as points on the arc."""
        return [
            (
                cx + RADIUS * math.cos(math.radians(a)),
                cy + RADIUS * math.sin(math.radians(a)),
            )
            for a in (a0 + (a1 - a0) * i / steps for i in range(steps + 1))
        ]

    # Four brackets, each one continuous path: free end, elbow, free end.
    for (start, cc, a0, a1, end) in [
        ((2, 7.6), (3.6, 3.6), 180, 270, (7.6, 2)),        # top left
        ((16.4, 2), (20.4, 3.6), 270, 360, (22, 7.6)),     # top right
        ((22, 16.4), (20.4, 20.4), 0, 90, (16.4, 22)),     # bottom right
        ((7.6, 22), (3.6, 20.4), 90, 180, (2, 16.4)),      # bottom left
    ]:
        stroke([start, *elbow(cc[0], cc[1], a0, a1), end])

    # The pin: circle, then the teardrop taper, then the hole punched through.
    cx, cy = PIN_C
    r = PIN_R * u
    d.ellipse([cx * u - r, cy * u - r, cx * u + r, cy * u + r], fill=fg)
    left, right = _tangent_points()
    d.polygon([p(*left), p(*PIN_TIP), p(*right)], fill=fg)
    hr = HOLE_R * u
    d.ellipse([cx * u - hr, cy * u - hr, cx * u + hr, cy * u + hr], fill=hole)

    return img.resize((size, size), PIL.Image.LANCZOS)


def on_plate(size: int, fg: str, bg: str, hole: str, pad: float = 0.18,
             radius: float = 0.22) -> PIL.Image.Image:
    """The mark centred on a rounded square, for avatars and listings."""
    img = PIL.Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate = PIL.Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    pd = PIL.ImageDraw.Draw(plate)
    pd.rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1],
        radius=int(size * SS * radius), fill=bg,
    )
    img.paste(plate.resize((size, size), PIL.Image.LANCZOS), (0, 0))

    inner = int(size * (1 - pad * 2))
    mark = draw_mark(inner, fg, hole)
    img.alpha_composite(mark, ((size - inner) // 2, (size - inner) // 2))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made = []

    for name, size, fg, hole in [
        ("mark-accent-512.png", 512, DARK_ACCENT, DARK_BG),
        ("mark-light-accent-512.png", 512, LIGHT_ACCENT, LIGHT_PANEL),
        ("mark-ink-512.png", 512, "#eef1f4", DARK_BG),
    ]:
        img = draw_mark(size, fg, hole)
        img.save(OUT / name)
        made.append(name)

    for name, size, fg, bg, hole in [
        ("logo-square-512.png", 512, DARK_ACCENT, DARK_BG, DARK_BG),
        ("logo-square-light-512.png", 512, LIGHT_ACCENT, LIGHT_BG, LIGHT_BG),
        ("logo-square-256.png", 256, DARK_ACCENT, DARK_BG, DARK_BG),
        ("logo-square-1024.png", 1024, DARK_ACCENT, DARK_BG, DARK_BG),
    ]:
        img = on_plate(size, fg, bg, hole)
        img.save(OUT / name)
        made.append(name)

    for name in made:
        f = OUT / name
        with PIL.Image.open(f) as im:
            print(f"  [ok] {name:<28} {im.size[0]}x{im.size[1]}  "
                  f"{f.stat().st_size // 1024} KB  {im.mode}")

    print(f"\n{len(made)} files in {OUT}")


if __name__ == "__main__":
    main()
