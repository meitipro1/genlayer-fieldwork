# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# What can Pillow actually do inside GenVM?
#
# Kept rather than deleted, because it is the only honest way to answer that.
# It found the bug behind fieldwork.py's pre-flight: a well formed baseline JPEG
# opens (header parsing is pure Python, so `.size` is genuinely correct) and
# then dies on `load()` with "decoder jpeg not available" - the runner's Pillow
# has no libjpeg. Every local test passed because the host's Pillow does.
#
#   node scripts/probe-run.mjs [url]
#
# `codecs()` lists what the build supports; `look(url)` walks a real photograph
# through the same steps pre-flight takes and reports where it stops. Run it
# again after any runner upgrade, and record what it says in
# contracts/README.md rather than assuming the answer carried over.

from genlayer import *

import hashlib


class _BytesFile:
    """Identical to the one in fieldwork.py, so the probe tests the real thing."""

    def __init__(self, data: bytes):
        self._d = data
        self._p = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = len(self._d) - self._p
        chunk = self._d[self._p : self._p + n]
        self._p = self._p + len(chunk)
        return chunk

    def seek(self, off: int, whence: int = 0) -> int:
        if whence == 0:
            self._p = off
        elif whence == 1:
            self._p = self._p + off
        else:
            self._p = len(self._d) + off
        return self._p

    def tell(self) -> int:
        return self._p


def _try(lines: list, label: str, fn):
    try:
        lines.append(label + ": OK " + str(fn()))
        return True
    except Exception as e:
        lines.append(label + ": FAILED " + type(e).__name__ + ": " + str(e)[:160])
        return False


class Contract(gl.Contract):
    out: str

    def __init__(self):
        self.out = ""

    @gl.public.write
    def codecs(self) -> str:
        """Which decoders the runner's Pillow was built with."""

        def leader():
            lines = []
            import PIL

            lines.append("PIL version: " + str(getattr(PIL, "__version__", "?")))

            import PIL.Image

            core = getattr(PIL.Image, "core", None)
            lines.append("core: " + str(type(core).__name__))
            if core is not None:
                names = [n for n in dir(core) if "decoder" in n or "encoder" in n]
                lines.append("codecs: " + ",".join(sorted(names)))

            _try(lines, "import PIL.features", lambda: __import__("PIL.features"))
            try:
                import PIL.features

                for codec in ("jpg", "zlib", "libtiff", "jpg_2000", "webp"):
                    lines.append(
                        "  feature " + codec + ": " + str(PIL.features.check_codec(codec))
                    )
            except Exception as e:
                lines.append("features: " + type(e).__name__ + " " + str(e)[:100])

            # Can it make and read back a raw image with no codec at all?
            img = PIL.Image.new("RGB", (8, 8), (200, 10, 10))
            _try(lines, "new+convert+resize", lambda: str(
                sum(list(img.convert("L").resize((4, 4)).getdata()))
            ))

            # A 1x1 PNG, decoded through the zip decoder rather than libjpeg.
            png = bytes.fromhex(
                "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
                "de0000000c4944415408d763f8cfc00000030101007a2b1ff40000000049454e"
                "44ae426082"
            )
            _try(lines, "png open", lambda: str(PIL.Image.open(_BytesFile(png)).size))
            _try(
                lines,
                "png load",
                lambda: str(list(PIL.Image.open(_BytesFile(png)).convert("L").getdata())),
            )
            return "\n".join(lines)

        self.out = str(gl.vm.run_nondet_unsafe(leader, lambda r: True))
        return self.out

    @gl.public.write
    def look(self, url: str) -> str:
        def leader():
            lines = []
            res = gl.nondet.web.request(url, method="GET")
            lines.append("status: " + str(res.status))
            body = res.body
            lines.append("len: " + str(len(body) if body is not None else -1))
            if body:
                lines.append("head: " + body[:8].hex())
                lines.append("sha: " + hashlib.sha256(body).hexdigest()[:16])

            import PIL.Image

            img = PIL.Image.open(_BytesFile(body))
            lines.append("format: " + str(img.format))
            lines.append("size: " + str(img.size))
            lines.append("mode: " + str(img.mode))
            _try(lines, "load", lambda: str(img.load() is not None))
            _try(lines, "convert L", lambda: str(img.convert("L").size))
            return "\n".join(lines)

        self.out = str(gl.vm.run_nondet_unsafe(leader, lambda r: True))
        return self.out

    @gl.public.view
    def report(self) -> str:
        return self.out
