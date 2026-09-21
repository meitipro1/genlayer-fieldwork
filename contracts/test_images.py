"""Tests for the contract's image handling.

Run with:  python contracts/test_images.py

`_preflight`, `_dhash` and `_BytesFile` are extracted out of fieldwork.py by
parsing the file, so this exercises exactly the code that ships rather than a
copy that can drift away from it.

Requires Pillow locally. The GenVM runtime has Pillow too - the SDK's own
`gl.nondet.web.render(mode="screenshot")` imports it.
"""

import io
import pathlib
import random
import re
import sys

import PIL.Image
import PIL.ImageDraw
import PIL.ImageFilter
import PIL.JpegImagePlugin

CONTRACT = pathlib.Path(__file__).with_name("fieldwork.py")


def load_from_contract():
    src = CONTRACT.read_text(encoding="utf-8")
    env = {}
    for name in ("MIN_EDGE", "DARK_MEAN", "BRIGHT_MEAN"):
        m = re.search(rf"^{name}\s*=\s*(\d+)", src, re.M)
        assert m, f"{name} not found in the contract"
        env[name] = int(m.group(1))

    parts = []
    m = re.search(r"^class _BytesFile:.*?(?=\n(?:def |class )|\Z)", src, re.M | re.S)
    assert m, "_BytesFile not found"
    parts.append(m.group(0))
    for func in ("_preflight", "_dhash"):
        m = re.search(rf"^def {func}\(.*?(?=\n(?:def |class )|\Z)", src, re.M | re.S)
        assert m, f"{func} not found"
        parts.append(m.group(0))

    exec(compile("\n\n".join(parts), "fieldwork_extract", "exec"), env)
    return env


ENV = load_from_contract()
_preflight = ENV["_preflight"]
_dhash = ENV["_dhash"]
MIN_EDGE, DARK_MEAN, BRIGHT_MEAN = ENV["MIN_EDGE"], ENV["DARK_MEAN"], ENV["BRIGHT_MEAN"]


def photo(w=1200, h=900, seed=3):
    """A plausible outdoor photograph: mid tones, texture, soft edges."""
    rng = random.Random(seed)
    img = PIL.Image.new("RGB", (w, h), (150, 145, 132))
    d = PIL.ImageDraw.Draw(img)
    d.rectangle([0, h // 2, w, h], fill=(120, 115, 104))
    d.rectangle([int(w * 0.62), int(h * 0.28), int(w * 0.77), int(h * 0.55)], fill=(47, 93, 58))
    px = img.load()
    for _ in range(w * h // 12):
        x, y = rng.randrange(w), rng.randrange(h)
        r, g, b = px[x, y]
        n = rng.randint(-26, 26)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img.filter(PIL.ImageFilter.GaussianBlur(0.5))


def enc(img, fmt="JPEG", q=92):
    b = io.BytesIO()
    img.save(b, format=fmt, quality=q)
    return b.getvalue()


def scale(img, factor):
    return img.point(lambda v: max(0, min(255, int(v * factor))))


def test_preflight():
    cases = [
        ("normal daylight photo", enc(photo()), False, ""),
        ("normal, PNG", enc(photo(), fmt="PNG"), False, ""),
        ("large 4000px photo", enc(photo(4000, 3000)), False, ""),
        ("exactly at MIN_EDGE", enc(photo(MIN_EDGE, 360)), False, ""),
        ("dusk, still gradeable", enc(scale(photo(), 0.30)), False, ""),
        ("bright day, still gradeable", enc(scale(photo(), 1.55)), False, ""),
        ("thumbnail 320px", enc(photo(320, 240)), True, "too small"),
        ("lens cap", enc(PIL.Image.new("RGB", (1200, 900), (3, 3, 3))), True, "too dark"),
        ("very underexposed", enc(scale(photo(), 0.05)), True, "too dark"),
        ("sun into lens", enc(PIL.Image.new("RGB", (1200, 900), (252, 252, 250))), True, "washed out"),
        ("blown highlights", enc(scale(photo(), 2.4)), True, "washed out"),
        ("a PDF, not an image", b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", True, "could not be opened"),
        ("empty upload", b"", True, "could not be opened"),
        ("truncated jpeg", enc(photo())[:40], True, "could not be opened"),
    ]
    bad = 0
    for label, data, should_refuse, expect in cases:
        got = _preflight(data, "after")
        ok = (got != "") == should_refuse and (expect in got if expect else True)
        bad += 0 if ok else 1
        print(f"  [{'ok  ' if ok else 'FAIL'}] {label:<28} {got[:52] or 'accepted'}")

    msg = _preflight(enc(photo(64, 48)), "before")
    ok = "before" in msg
    bad += 0 if ok else 1
    print(f"  [{'ok  ' if ok else 'FAIL'}] refusal names which photograph")

    # A JPEG with no JFIF/EXIF header. Pillow reads it, the vision model does
    # not, and unhandled it aborts the transaction and leaves the task stuck as
    # claimed with no reason. Measured: a real 900x600 file with magic ffd8ffdb
    # returned NondetException INVALID_IMAGE on Studio.
    jfif = enc(photo())
    assert jfif[:4].hex() == "ffd8ffe0", "fixture is not JFIF"
    stripped = b"\xff\xd8" + jfif[2 + 2 + int.from_bytes(jfif[4:6], "big") :]
    for label, data, want in (
        ("a JFIF jpeg is accepted", jfif, False),
        ("a jpeg with no JFIF header is refused", stripped, True),
    ):
        got = _preflight(data, "after")
        ok = (got != "") == want and (("re-save" in got) if want else True)
        bad += 0 if ok else 1
        print(f"  [{'ok  ' if ok else 'FAIL'}] {label:<38} {got[:44] or 'accepted'}")
    return bad


class no_jpeg_decoder:
    """Make the host's Pillow behave like the runner's.

    The bug this exists for: every test above passes on a JPEG because the host
    Pillow links libjpeg. The runner's does not - measured on Studio against
    py-genlayer:1jb45aa8..., `PIL.features.check_codec("jpg")` is False there.
    A JPEG opens (the header parse is pure Python) and then raises
    `OSError: decoder jpeg not available` on the first pixel access.

    So the whole suite was green while `_preflight` refused every real
    photograph on chain. This reproduces the runner by making JpegImageFile.load
    raise exactly what the runner raises.
    """

    def __enter__(self):
        self._real = PIL.JpegImagePlugin.JpegImageFile.load

        def dead(_self, *a, **k):
            raise OSError("decoder jpeg not available")

        PIL.JpegImagePlugin.JpegImageFile.load = dead
        return self

    def __exit__(self, *exc):
        PIL.JpegImagePlugin.JpegImageFile.load = self._real
        return False


def test_runner_has_no_jpeg_decoder():
    """What pre-flight must do when it cannot see the pixels.

    The rule: a decoder we do not ship is our limitation, never the worker's.
    Anything the header alone can prove is still enforced; anything needing
    pixels is skipped rather than failed.
    """
    bad = 0
    with no_jpeg_decoder():
        cases = [
            # header-only checks still work on a JPEG
            ("jpeg, too small          -> refused", enc(photo(320, 240)), True, "too small"),
            ("not an image at all      -> refused", b"%PDF-1.7\n1 0 obj\n", True, "could not be opened"),
            ("truncated jpeg           -> refused", enc(photo())[:40], True, "could not be opened"),
            # pixel checks are skipped, never turned into a refusal
            ("normal jpeg              -> accepted", enc(photo()), False, ""),
            ("pitch black jpeg         -> accepted", enc(PIL.Image.new("RGB", (1200, 900), (2, 2, 2))), False, ""),
            ("blown out jpeg           -> accepted", enc(PIL.Image.new("RGB", (1200, 900), (253, 253, 252))), False, ""),
            # PNG decodes here, so it keeps the full check
            ("png, pitch black         -> refused", enc(PIL.Image.new("RGB", (1200, 900), (2, 2, 2)), fmt="PNG"), True, "too dark"),
            ("png, normal              -> accepted", enc(photo(), fmt="PNG"), False, ""),
        ]
        for label, data, should_refuse, expect in cases:
            got = _preflight(data, "after")
            ok = (got != "") == should_refuse and (expect in got if expect else True)
            bad += 0 if ok else 1
            print(f"  [{'ok  ' if ok else 'FAIL'}] {label:<38} {got[:44] or 'accepted'}")

        # And the hash must stay deterministic rather than blow up.
        h1 = _dhash(enc(photo()))
        h2 = _dhash(enc(photo()))
        ok = h1 == h2 == ""
        bad += 0 if ok else 1
        print(f"  [{'ok  ' if ok else 'FAIL'}] dhash returns \"\" on jpeg, deterministically")
    return bad


def test_determinism():
    """Validators recompute both of these, so identical bytes must agree."""
    a = enc(photo())
    bad = 0
    for name, fn in (("preflight", _preflight), ("dhash", _dhash)):
        left = fn(a, "after") if name == "preflight" else fn(a)
        right = fn(bytes(a), "after") if name == "preflight" else fn(bytes(a))
        ok = left == right
        bad += 0 if ok else 1
        print(f"  [{'ok  ' if ok else 'FAIL'}] {name} is deterministic on identical bytes")
    return bad


def test_phash_is_not_a_fraud_signal():
    """The measurement behind the decision not to match perceptually.

    If this ever starts passing cleanly, perceptual reuse detection becomes
    worth revisiting. Today it does not: the same place on another day scores
    closer than the same photograph re-encoded.
    """
    after = photo(seed=1)
    same_reencoded = _dhash(enc(after, q=45))
    base = _dhash(enc(after))
    other_day = _dhash(enc(scale(photo(seed=1), 1.06)))

    def dist(x, y):
        return bin(int(x, 16) ^ int(y, 16)).count("1")

    d_same = dist(base, same_reencoded)
    d_other = dist(base, other_day)
    print(f"  same photograph, re-encoded      distance {d_same}")
    print(f"  same place, another day          distance {d_other}")
    overlapping = d_other <= d_same
    print(
        f"  [{'ok  ' if overlapping else 'note'}] populations overlap "
        f"({d_other} <= {d_same}), so no threshold separates them"
    )
    return 0


def main():
    bad = 0
    print("preflight")
    bad += test_preflight()
    print("\nwhat the runner can actually decode")
    bad += test_runner_has_no_jpeg_decoder()
    print("\ndeterminism")
    bad += test_determinism()
    print("\nwhy there is no perceptual reuse check")
    bad += test_phash_is_not_a_fraud_signal()
    print("\n" + ("all image checks passed" if bad == 0 else f"{bad} FAILURES"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
