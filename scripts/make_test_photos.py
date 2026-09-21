"""Generate a before/after pair that satisfies one specific acceptance test.

    python scripts/make_test_photos.py 4KWJX2

The code must be the one the contract issued when you claimed the task - it is
different for every claim, and the grader checks it is legible in the AFTER
frame. Only the after frame carries it: the poster shoots the before frame when
the task is posted, which is before any code exists.

The acceptance test these are drawn for:

    The bin area is empty. No bags remain against the wall, the ground is clear
    of loose litter, and both bins are upright with their lids closed.

So the pair is drawn to make each clause checkable:
  before  bags against the wall, litter on the ground, one lid open
  after   wall clear, ground clear, both bins upright with lids down

Framing is identical in both, because the grader also has to agree they are the
same place. Output is baseline JFIF JPEG - a JPEG without a JFIF header is
rejected by the node as INVALID_IMAGE.
"""

import pathlib
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1400, 1050
OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "test-photos"

HORIZON = int(H * 0.52)


def font(size, bold=True):
    """A face that is actually legible to a vision model."""
    for name in ("arialbd.ttf" if bold else "arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wall_and_ground(rng):
    img = Image.new("RGB", (W, H), (176, 170, 156))
    d = ImageDraw.Draw(img)

    # sky glow above the wall so it reads as outdoors
    for y in range(0, HORIZON):
        t = y / HORIZON
        d.line([(0, y), (W, y)], fill=(int(188 - 22 * t), int(183 - 20 * t), int(170 - 16 * t)))

    # brick courses
    brick_h = 46
    for row, y in enumerate(range(60, HORIZON, brick_h)):
        offset = 0 if row % 2 == 0 else 96
        for x in range(-96 + offset, W, 192):
            shade = rng.randint(-10, 10)
            d.rectangle(
                [x, y, x + 186, y + brick_h - 8],
                fill=(163 + shade, 152 + shade, 138 + shade),
            )

    # ground
    for y in range(HORIZON, H):
        t = (y - HORIZON) / (H - HORIZON)
        d.line([(0, y), (W, y)], fill=(int(126 + 26 * t), int(121 + 24 * t), int(110 + 22 * t)))

    # paving joints, so "the ground" is a readable surface
    for x in range(0, W + 200, 168):
        d.line([(x, HORIZON), (x - 120, H)], fill=(112, 107, 98), width=3)
    for i, y in enumerate(range(HORIZON + 40, H, 84)):
        d.line([(0, y), (W, y)], fill=(114, 109, 100), width=3)

    # kerb line where wall meets ground
    d.rectangle([0, HORIZON - 10, W, HORIZON + 6], fill=(138, 131, 119))
    return img, d


def bin_(d, x, y, w, h, lid_open=False):
    """A wheelie bin. Lid open in the before frame, closed in the after."""
    body = (46, 92, 57)
    dark = (34, 68, 42)
    d.rectangle([x, y, x + w, y + h], fill=body)
    d.rectangle([x, y, x + 14, y + h], fill=dark)          # side shading
    for i in range(1, 4):                                    # ribs
        yy = y + int(h * i / 4)
        d.line([(x + 8, yy), (x + w - 8, yy)], fill=dark, width=3)

    if lid_open:
        d.polygon(
            [(x - 8, y + 6), (x + w - 30, y - 46), (x + w + 4, y - 30), (x + w + 6, y + 12)],
            fill=(30, 62, 38),
        )
    else:
        d.rectangle([x - 10, y - 20, x + w + 10, y + 4], fill=(30, 62, 38))
        d.rectangle([x + w // 2 - 26, y - 30, x + w // 2 + 26, y - 18], fill=(24, 52, 32))

    # wheels
    d.ellipse([x + 6, y + h - 10, x + 34, y + h + 18], fill=(28, 28, 30))
    d.ellipse([x + w - 34, y + h - 10, x + w - 6, y + h + 18], fill=(28, 28, 30))
    # contact shadow
    d.ellipse([x - 16, y + h + 6, x + w + 16, y + h + 30], fill=(104, 99, 90))


def bags(d, rng):
    """Rubbish bags heaped against the wall - the thing that must be gone."""
    for cx, cy, r in ((250, 596, 96), (394, 612, 80), (522, 598, 72), (142, 620, 68)):
        d.ellipse([cx - r, cy - int(r * 0.74), cx + r, cy + int(r * 0.74)], fill=(44, 44, 49))
        d.ellipse(
            [cx - int(r * 0.55), cy - int(r * 0.95), cx + int(r * 0.5), cy - int(r * 0.15)],
            fill=(58, 58, 64),
        )
        # tied neck
        d.polygon(
            [(cx - 14, cy - int(r * 0.9)), (cx + 12, cy - int(r * 0.9)), (cx + 2, cy - int(r * 1.15))],
            fill=(38, 38, 43),
        )
    for cx, cy, r in ((250, 596, 96), (394, 612, 80), (522, 598, 72)):
        d.ellipse([cx - r, cy + int(r * 0.6), cx + r, cy + int(r * 0.86)], fill=(108, 103, 94))


def litter(d, rng):
    """Loose litter on the ground - the other clause of the test."""
    for _ in range(26):
        x = rng.randint(120, W - 120)
        y = rng.randint(HORIZON + 60, H - 60)
        w = rng.randint(14, 34)
        h = rng.randint(8, 18)
        shade = rng.choice([(214, 209, 196), (198, 186, 160), (176, 190, 172)])
        d.polygon(
            [(x, y), (x + w, y - rng.randint(2, 8)), (x + w - 4, y + h), (x - 3, y + h - 3)],
            fill=shade,
        )


def code_card(img, code, rng):
    """A hand-held paper with the challenge code, kept in frame in both shots."""
    cw, ch = 420, 250
    card = Image.new("RGB", (cw, ch), (252, 250, 243))
    cd = ImageDraw.Draw(card)
    cd.rectangle([0, 0, cw - 1, ch - 1], outline=(206, 199, 184), width=3)

    f_small = font(30, bold=False)
    cd.text((26, 22), "FIELDWORK", font=f_small, fill=(120, 114, 102))

    size = 96
    f_code = font(size)
    while f_code.getbbox(code)[2] > cw - 60 and size > 40:
        size -= 6
        f_code = font(size)
    box = f_code.getbbox(code)
    cd.text(((cw - (box[2] - box[0])) / 2 - box[0], 104), code, font=f_code, fill=(16, 16, 14))

    card = card.rotate(-7, expand=True, fillcolor=(0, 0, 0))
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rectangle([0, 0, card.size[0], card.size[1]], fill=255)
    mask = Image.new("RGB", (cw, ch), (255, 255, 255)).rotate(-7, expand=True, fillcolor=(0, 0, 0)).convert("L")

    pos = (78, H - card.size[1] - 54)

    # a hand holding it, so it reads as held rather than pasted on
    d = ImageDraw.Draw(img)
    hx, hy = pos[0] + card.size[0] - 120, pos[1] + card.size[1] - 34
    d.ellipse([hx - 40, hy - 20, hx + 90, hy + 90], fill=(196, 158, 128))
    d.ellipse([hx - 20, hy - 40, hx + 40, hy + 30], fill=(206, 168, 136))

    img.paste(card, pos, mask)
    return img


def finish(img, rng, seed_shift=0):
    """Photo-like grain and a slight vignette, then a bounded JPEG."""
    px = img.load()
    for _ in range(W * H // 26):
        x, y = rng.randrange(W), rng.randrange(H)
        r, g, b = px[x, y]
        n = rng.randint(-13, 13)
        px[x, y] = (
            max(0, min(255, r + n)),
            max(0, min(255, g + n)),
            max(0, min(255, b + n)),
        )
    return img.filter(ImageFilter.GaussianBlur(0.45))


def build(code: str):
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- BEFORE: bags against the wall, litter on the ground, one lid open ----
    # No code card. The poster shoots this when the task is posted, and the
    # challenge code is not issued until somebody claims it - so a code in this
    # frame would be a code the contract never asked for.
    rng = random.Random(11)
    before, d = wall_and_ground(rng)
    bin_(d, 900, 470, 190, 250, lid_open=True)
    bin_(d, 1130, 470, 190, 250, lid_open=False)
    bags(d, rng)
    litter(d, rng)
    before = finish(before, rng)

    # ---- AFTER: wall clear, ground clear, both lids closed. Same framing. ----
    rng = random.Random(11)
    after, d = wall_and_ground(rng)
    bin_(d, 900, 470, 190, 250, lid_open=False)
    bin_(d, 1130, 470, 190, 250, lid_open=False)
    after = code_card(after, code, rng)
    after = finish(after, rng)

    paths = []
    for name, im in (("before", before), ("after", after)):
        p = OUT / f"{name}-{code}.jpg"
        im.save(p, format="JPEG", quality=88, optimize=True)
        paths.append(p)

    print(f"code: {code}\n")
    for p in paths:
        head = p.read_bytes()[:4].hex()
        im = Image.open(p)
        grey = im.convert("L").resize((32, 32))
        mean = sum(grey.getdata()) // 1024
        ok = head.startswith("ffd8ffe0") and max(im.size) >= 480 and 12 < mean < 243
        print(
            f"  {p.name:<24} {im.size[0]}x{im.size[1]}  "
            f"{p.stat().st_size // 1024:>4} KB  magic={head}  mean={mean}  "
            f"{'PASSES pre-flight' if ok else 'WOULD BE REFUSED'}"
        )
    print(f"\nsaved in {OUT}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        print("give the challenge code the contract issued, e.g.  4KWJX2")
        raise SystemExit(1)
    build(sys.argv[1].strip().upper())
