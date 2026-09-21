"""Build a zip of before/after pairs to test the whole product against.

    python scripts/make_test_set.py [out_dir]

Seven pairs, each an honest job with its own acceptance test and its own six
character code. The zip includes a README carrying the text to paste into the
console, so a pair and its test cannot drift apart.

The before frame never carries the code. The poster shoots it when the task is
posted and the code does not exist until somebody claims, so a code there would
be one the contract never issued. Use the "Set the code yourself" field on the
console to make the pairs usable end to end by one person.

Output is baseline JFIF JPEG at 1400x1050, which is what the contract's
pre-flight wants: a header its decoder can read, and a long edge a six
character code stays legible at.
"""

import pathlib
import random
import shutil
import sys
import zipfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1400, 1050
HORIZON = int(H * 0.52)
# One code per pair. Six characters from CODE_ALPHABET, which has no I, L,
# O, U, 0 or 1 because the code is written by hand and read back by a model.
# The bins pair keeps TEST42 so that it matches public/samples/bins-after.jpg,
# the frame the site's own one-press example uses.
CODES = {
    "01-bins": "TEST42",
    "02-charger": "CHRG47",
    "03-shelf": "RACK52",
    "04-noticeboard": "BRD739",
    "05-shutter": "SHTR63",
    "06-gutter": "GTTR95",
    "07-flytip": "BRDG24",
}


def font(size, bold=True):
    for name in (
        "arialbd.ttf" if bold else "arial.ttf",
        "DejaVuSans-Bold.ttf",
        "DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- scenery


def outdoor(rng, wall=(163, 152, 138), ground=(126, 121, 110)):
    """A wall above, a paved ground below. The backdrop for most jobs."""
    img = Image.new("RGB", (W, H), (176, 170, 156))
    d = ImageDraw.Draw(img)
    for y in range(0, HORIZON):
        t = y / HORIZON
        d.line([(0, y), (W, y)], fill=(int(188 - 22 * t), int(183 - 20 * t), int(170 - 16 * t)))
    brick_h = 46
    for row, y in enumerate(range(60, HORIZON, brick_h)):
        offset = 0 if row % 2 == 0 else 96
        for x in range(-96 + offset, W, 192):
            sh = rng.randint(-10, 10)
            d.rectangle(
                [x, y, x + 186, y + brick_h - 8],
                fill=(wall[0] + sh, wall[1] + sh, wall[2] + sh),
            )
    for y in range(HORIZON, H):
        t = (y - HORIZON) / (H - HORIZON)
        d.line(
            [(0, y), (W, y)],
            fill=(int(ground[0] + 26 * t), int(ground[1] + 24 * t), int(ground[2] + 22 * t)),
        )
    for x in range(0, W + 200, 168):
        d.line([(x, HORIZON), (x - 120, H)], fill=(112, 107, 98), width=3)
    for y in range(HORIZON + 40, H, 84):
        d.line([(0, y), (W, y)], fill=(114, 109, 100), width=3)
    d.rectangle([0, HORIZON - 10, W, HORIZON + 6], fill=(138, 131, 119))
    return img, d


def indoor(rng):
    """A shop aisle: a floor, a back wall and a shelf unit."""
    img = Image.new("RGB", (W, H), (222, 220, 214))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, HORIZON], fill=(228, 226, 220))
    for y in range(HORIZON, H):
        t = (y - HORIZON) / (H - HORIZON)
        d.line([(0, y), (W, y)], fill=(int(196 - 16 * t), int(194 - 16 * t), int(188 - 14 * t)))
    for x in range(0, W, 150):
        d.line([(x, HORIZON), (x - 90, H)], fill=(184, 182, 176), width=2)
    return img, d


def bin_(d, x, y, w, h, lid_open=False):
    body, dark = (46, 92, 57), (34, 68, 42)
    d.rectangle([x, y, x + w, y + h], fill=body)
    d.rectangle([x, y, x + 14, y + h], fill=dark)
    for i in range(1, 4):
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
    d.ellipse([x + 6, y + h - 10, x + 34, y + h + 18], fill=(28, 28, 30))
    d.ellipse([x + w - 34, y + h - 10, x + w - 6, y + h + 18], fill=(28, 28, 30))
    d.ellipse([x - 16, y + h + 6, x + w + 16, y + h + 30], fill=(104, 99, 90))


def bags(d, rng, spots=((250, 596, 96), (394, 612, 80), (522, 598, 72), (142, 620, 68))):
    for cx, cy, r in spots:
        d.ellipse([cx - r, cy - int(r * 0.74), cx + r, cy + int(r * 0.74)], fill=(44, 44, 49))
        d.ellipse(
            [cx - int(r * 0.55), cy - int(r * 0.95), cx + int(r * 0.5), cy - int(r * 0.15)],
            fill=(58, 58, 64),
        )
    for cx, cy, r in spots[:3]:
        d.ellipse([cx - r, cy + int(r * 0.6), cx + r, cy + int(r * 0.86)], fill=(108, 103, 94))


def litter(d, rng, n=26):
    for _ in range(n):
        x = rng.randint(120, W - 120)
        y = rng.randint(HORIZON + 60, H - 60)
        w = rng.randint(14, 34)
        h = rng.randint(8, 18)
        shade = rng.choice([(214, 209, 196), (198, 186, 160), (176, 190, 172)])
        d.polygon(
            [(x, y), (x + w, y - rng.randint(2, 8)), (x + w - 4, y + h), (x - 3, y + h - 3)],
            fill=shade,
        )


def charger(d, x, y, lit=True, dirty=False):
    d.rectangle([x, y, x + 210, y + 430], fill=(58, 62, 70))
    d.rectangle([x, y, x + 14, y + 430], fill=(44, 48, 55))
    screen = (26, 92, 44) if lit else (30, 30, 34)
    d.rectangle([x + 34, y + 50, x + 176, y + 190], fill=screen)
    if lit:
        f = font(28)
        d.text((x + 52, y + 82), "READY", font=f, fill=(214, 244, 220))
        d.text((x + 58, y + 126), "41", font=font(44), fill=(214, 244, 220))
    if dirty:
        for i in range(60):
            px = x + 34 + (i * 37) % 142
            py = y + 50 + (i * 23) % 140
            d.ellipse([px, py, px + 12, py + 10], fill=(120, 112, 96))
    d.rectangle([x + 40, y + 250, x + 170, y + 286], fill=(38, 40, 46))
    d.text((x + 62, y + 256), "41", font=font(26), fill=(210, 210, 214))


def shelf(d, stocked=True):
    """A shelving bay: backboard, uprights, two shelves with label strips.

    The first version of this was two grey bars on a grey floor, which no grader
    could read as a shelf at all, and the acceptance test mentions facing labels
    that were not drawn. A fixture has to contain the things its own test names.
    """
    x0, y0, x1, y1 = 300, 190, 1100, 830
    # backboard and uprights
    d.rectangle([x0, y0, x1, y1], fill=(206, 204, 198))
    d.rectangle([x0, y0, x0 + 26, y1], fill=(158, 156, 150))
    d.rectangle([x1 - 26, y0, x1, y1], fill=(158, 156, 150))
    d.rectangle([x0, y0, x1, y0 + 22], fill=(168, 166, 160))

    for shelf_y in (y0 + 250, y0 + 560):
        # the shelf itself, with a front lip and a label strip
        d.rectangle([x0 + 26, shelf_y, x1 - 26, shelf_y + 26], fill=(176, 174, 168))
        d.rectangle([x0 + 26, shelf_y + 26, x1 - 26, shelf_y + 44], fill=(238, 236, 230))
        for i in range(6):
            lx = x0 + 60 + i * 122
            d.rectangle([lx, shelf_y + 30, lx + 86, shelf_y + 40], fill=(120, 118, 112))

        if stocked:
            for i in range(6):
                bx = x0 + 52 + i * 122
                top = shelf_y - 150
                d.rectangle([bx, top, bx + 96, shelf_y], fill=(178, 62, 54))
                d.rectangle([bx + 6, top + 6, bx + 90, top + 20], fill=(146, 48, 42))
                d.rectangle([bx + 12, top + 40, bx + 84, top + 84], fill=(240, 236, 228))
                d.rectangle([bx + 22, top + 100, bx + 74, top + 118], fill=(240, 236, 228))


def poster_wall(d, rng, papered=True):
    d.rectangle([420, 210, 980, 620], fill=(72, 64, 54))
    d.rectangle([432, 222, 968, 608], fill=(150, 142, 128))
    if papered:
        for i in range(9):
            px = 448 + (i % 3) * 176
            py = 238 + (i // 3) * 124
            d.rectangle(
                [px, py, px + 150, py + 104],
                fill=rng.choice([(220, 214, 200), (198, 206, 214), (222, 206, 190)]),
            )
            d.line([(px, py + 20), (px + 150, py + 20)], fill=(120, 116, 108), width=3)


def graffiti(d, rng, box=(320, 170, 1080, HORIZON - 20)):
    """Paint, kept inside the shutter.

    The acceptance test names the shutter and nothing else, so paint spilling
    onto the brick would make the before and after differ in a way the written
    standard does not cover. A fixture that tests something other than its own
    test is worse than no fixture.
    """
    x0, y0, x1, y1 = box
    for _ in range(7):
        x = rng.randint(x0, x1 - 260)
        y = rng.randint(y0 + 20, y1 - 60)
        col = rng.choice([(190, 60, 130), (60, 110, 200), (230, 190, 60)])
        pts = [(x, y)]
        for _ in range(6):
            nx = min(x1 - 10, pts[-1][0] + rng.randint(20, 60))
            ny = min(y1 - 10, max(y0 + 10, pts[-1][1] + rng.randint(-45, 45)))
            pts.append((nx, ny))
        d.line(pts, fill=col, width=rng.randint(10, 18), joint="curve")


def code_card(img, code, rng):
    """Paper with the challenge code, held in frame. After frames only."""
    cw, ch = 420, 250
    card = Image.new("RGB", (cw, ch), (252, 250, 243))
    cd = ImageDraw.Draw(card)
    cd.rectangle([0, 0, cw - 1, ch - 1], outline=(206, 199, 184), width=3)
    cd.text((26, 22), "FIELDWORK", font=font(30, bold=False), fill=(120, 114, 102))
    size = 96
    f_code = font(size)
    while f_code.getbbox(code)[2] > cw - 60 and size > 40:
        size -= 6
        f_code = font(size)
    box = f_code.getbbox(code)
    cd.text(((cw - (box[2] - box[0])) / 2 - box[0], 104), code, font=f_code, fill=(16, 16, 14))

    rotated = card.rotate(-7, expand=True, fillcolor=(0, 0, 0))
    mask = (
        Image.new("RGB", (cw, ch), (255, 255, 255))
        .rotate(-7, expand=True, fillcolor=(0, 0, 0))
        .convert("L")
    )
    pos = (78, H - rotated.size[1] - 54)
    d = ImageDraw.Draw(img)
    hx, hy = pos[0] + rotated.size[0] - 120, pos[1] + rotated.size[1] - 34
    d.ellipse([hx - 40, hy - 20, hx + 90, hy + 90], fill=(196, 158, 128))
    d.ellipse([hx - 20, hy - 40, hx + 40, hy + 30], fill=(206, 168, 136))
    img.paste(rotated, pos, mask)
    return img


def finish(img, rng):
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


# ---------------------------------------------------------------- scenarios


def bins(rng, done):
    img, d = outdoor(rng)
    bin_(d, 900, 470, 190, 250, lid_open=not done)
    bin_(d, 1130, 470, 190, 250, lid_open=False)
    if not done:
        bags(d, rng)
        litter(d, rng)
    return img


def charger_scene(rng, done):
    img, d = indoor(rng)
    charger(d, 560, 300, lit=done, dirty=not done)
    return img


def shelf_scene(rng, done):
    img, d = indoor(rng)
    shelf(d, stocked=done)
    return img


def noticeboard(rng, done):
    img, d = outdoor(rng)
    poster_wall(d, rng, papered=not done)
    return img


def shutter(rng, done):
    img, d = outdoor(rng, wall=(120, 124, 130))
    d.rectangle([300, 150, 1100, HORIZON + 10], fill=(140, 144, 150))
    for y in range(160, HORIZON, 26):
        d.line([(300, y), (1100, y)], fill=(122, 126, 132), width=6)
    if not done:
        graffiti(d, rng)
    return img


def gutter(rng, done):
    img, d = outdoor(rng)
    d.rectangle([0, 300, W, 360], fill=(96, 100, 106))
    d.rectangle([0, 300, W, 314], fill=(120, 124, 130))
    if not done:
        for i in range(70):
            x = rng.randint(20, W - 40)
            # Height derived from the top edge, never an independent random
            # bottom: two independent offsets can invert and Pillow refuses a
            # box whose y1 is above its y0.
            top = 312 + rng.randint(0, 24)
            d.ellipse(
                [x, top, x + rng.randint(18, 34), top + rng.randint(10, 22)],
                fill=rng.choice([(122, 94, 44), (96, 78, 40), (140, 110, 52)]),
            )
    return img


def flytip(rng, done):
    img, d = outdoor(rng)
    if not done:
        bags(d, rng, spots=((320, 640, 120), (560, 660, 104), (800, 640, 92), (1040, 660, 84)))
        d.rectangle([420, 470, 700, 600], fill=(92, 78, 64))
        d.rectangle([760, 500, 980, 610], fill=(74, 82, 92))
        litter(d, rng, n=40)
    return img


SCENARIOS = [
    (
        "01-bins",
        bins,
        "Clear the bin area behind 14 Mill St",
        "The bin area is empty. No bags remain against the wall, the ground is "
        "clear of loose litter, and both bins are upright with their lids closed.",
        "Wall and ground both visible and clear, bins upright, lids down, code legible.",
        "Bags moved out of shot rather than removed.",
    ),
    (
        "02-charger",
        charger_scene,
        "Photograph charger 41 and its display",
        "Charger 41 is shown head on with its screen readable. The screen shows a "
        "status line and the charger's unit number is visible in the same frame.",
        "Screen readable without glare, unit number 41 visible, code held beside it.",
        "Screen dark or washed out, or the unit number cropped out of frame.",
    ),
    (
        "03-shelf",
        shelf_scene,
        "Restock the brand X shelf in aisle 7",
        "Both shelves carry product across their full width. No empty gaps remain "
        "on either shelf and the facing labels are visible.",
        "Both rows full front to back, labels showing, code legible in frame.",
        "One row filled and the other left empty.",
    ),
    (
        "04-noticeboard",
        noticeboard,
        "Clear the noticeboard at Ashfield Green",
        "The noticeboard is empty. No posters or flyers remain pinned to it and "
        "the board surface is visible across its whole width.",
        "Bare board edge to edge, frame visible, code legible in frame.",
        "Posters torn leaving paper corners still pinned.",
    ),
    (
        "05-shutter",
        shutter,
        "Remove the graffiti from the shutter on Weston Road",
        "The shutter is clear of paint marks. Its ribbed surface is visible across "
        "the full width with no coloured tags remaining.",
        "Whole shutter in frame and free of paint, code legible in frame.",
        "Paint covered over with a patch in a different colour.",
    ),
    (
        "06-gutter",
        gutter,
        "Clear the gutter along the Canal Rd frontage",
        "The gutter run is clear of leaves and debris. The channel is visible along "
        "its full length with nothing sitting in it.",
        "Empty channel visible end to end, code legible in frame.",
        "Leaves pushed to one end rather than removed.",
    ),
    (
        "07-flytip",
        flytip,
        "Clear the fly tipping under the Canal Rd bridge",
        "The area under the bridge is clear. No bags, furniture or loose litter "
        "remain and the ground surface is visible.",
        "Ground visible and clear across the span, code legible in frame.",
        "Items moved further under the bridge rather than taken away.",
    ),
]


def save_jfif(img, path, quality=88):
    img.save(path, format="JPEG", quality=quality, optimize=True)


def build(out_dir: pathlib.Path) -> pathlib.Path:
    work = out_dir / "fieldwork-test-photos"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    lines = [
        "Fieldwork test photographs",
        "=" * 26,
        "",
        "Seven before/after pairs. Each is a complete job with its own written",
        "acceptance test and its own code.",
        "",
        "Each after frame carries the code listed with that pair. Put that exact",
        'code in the console\'s "Set the code yourself" field when you post the',
        "task, and the pair runs end to end for one person. The before frames",
        "carry no code, because the poster shoots those before any claim exists.",
        "",
        "All files are baseline JFIF JPEG at 1400x1050.",
        "",
    ]

    for key, fn, title, test, passes, fails in SCENARIOS:
        rng = random.Random(hash(key) & 0xFFFF)
        before = finish(fn(rng, False), random.Random(11))
        rng = random.Random(hash(key) & 0xFFFF)
        after = fn(rng, True)
        after = code_card(after, CODES[key], random.Random(7))
        after = finish(after, random.Random(12))
        save_jfif(before, work / f"{key}-before.jpg")
        save_jfif(after, work / f"{key}-after.jpg")
        lines += [
            f"{key}",
            f"  Code            {CODES[key]}",
            f"  Title           {title}",
            f"  Acceptance test {test}",
            f"  Passes          {passes}",
            f"  Fails           {fails}",
            "",
        ]

    lines += [
        "Using these",
        "-" * 11,
        "1. Post a task from /console with the title and acceptance test above,",
        "   the matching -before.jpg, and that pair's code in the code field.",
        "2. Claim it. The code will be the one you chose.",
        "3. Submit the matching -after.jpg.",
        "",
        "One setting to get right before a seven pair run:",
        "  Claim window   1 day. Each step takes minutes on chain, and the",
        "                 90 minute default can run out part way through.",
        "",
        "On the Studio network the verdict and the receipt are real, and balances",
        "move on a live network.",
        "",
    ]

    (work / "README.txt").write_text("\n".join(lines), encoding="utf-8")

    zip_path = out_dir / "fieldwork-test-photos.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(work.iterdir()):
            z.write(f, f"fieldwork-test-photos/{f.name}")

    return zip_path


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.cwd()
    out.mkdir(parents=True, exist_ok=True)
    zip_path = build(out)

    print(f"wrote {zip_path}  ({zip_path.stat().st_size // 1024} KB)\n")
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
    print(f"{len(names)} files")

    # Prove the fixtures are what they claim to be, rather than assuming.
    import io

    work = out / "fieldwork-test-photos"
    bad = 0
    for f in sorted(work.glob("*.jpg")):
        raw = f.read_bytes()
        im = Image.open(io.BytesIO(raw))
        magic = raw[:4].hex()
        # Every frame here has to clear the contract's own pre-flight: a
        # baseline JFIF header, and a long edge the code can be read at.
        ok = magic == "ffd8ffe0" and max(im.size) >= 480
        bad += 0 if ok else 1
        print(
            f"  [{'ok  ' if ok else 'FAIL'}] {f.name:28} {im.size[0]}x{im.size[1]}  magic={magic}"
        )
    print("\nall fixtures are what the README says" if bad == 0 else f"\n{bad} FAILURES")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
