# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import hashlib


class Contract(gl.Contract):
    last: str

    def __init__(self):
        self.last = ""

    @gl.public.write
    def fetch_only(self, image_url: str) -> str:
        """What the contract actually received. No model involved.

        Confirms whether the bytes reaching exec_prompt are a real image before
        blaming the model. A gateway answering 403 returns a text error page
        that only fails later, as INVALID_IMAGE with no context.
        """

        def leader_fn():
            res = gl.nondet.web.request(image_url, method="GET")
            body = res.body
            if body is None:
                return {"out": "status=" + str(res.status) + " body=None"}
            magic = ""
            for b in body[:4]:
                magic = magic + format(b, "02x")
            kind = "unknown"
            if magic.startswith("ffd8ff"):
                kind = "jpeg"
            elif magic.startswith("89504e47"):
                kind = "png"
            elif magic.startswith("47494638"):
                kind = "gif"
            elif magic.startswith("52494646"):
                kind = "webp"
            return {
                "out": "status="
                + str(res.status)
                + " bytes="
                + str(len(body))
                + " magic="
                + magic
                + " kind="
                + kind
                + " sha="
                + hashlib.sha256(body).hexdigest()[:12]
            }

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            return leader_fn()["out"] == leader_res.calldata["out"]

        v = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.last = str(v["out"])
        return self.last

    @gl.public.write
    def describe_text(self, image_url: str) -> str:
        """Vision with response_format left at its default of text."""
        return self._describe(image_url, False)

    @gl.public.write
    def describe_json(self, image_url: str) -> str:
        """Vision with response_format='json'.

        The SDK's own typing has a quirk here: the json overload declares
        `image` singular while the runtime reads `images`. Worth testing both
        paths separately rather than assuming they behave the same.
        """
        return self._describe(image_url, True)

    def _describe(self, image_url: str, as_json: bool) -> str:
        def leader_fn():
            res = gl.nondet.web.request(image_url, method="GET")
            if res.status != 200:
                raise gl.vm.UserError(
                    "the image host answered " + str(res.status) + ", not 200"
                )
            body = res.body
            if body is None or len(body) < 128:
                raise gl.vm.UserError("that url did not return an image")

            prompt = (
                "One photograph is attached. Answer only from what you can see. "
                "Name the main subject in at most six words."
            )
            if as_json:
                out = gl.nondet.exec_prompt(
                    prompt + ' Return json: {"subject":"max 6 words"}',
                    images=[body],
                    response_format="json",
                )
                text = str(out.get("subject", ""))
            else:
                text = str(
                    gl.nondet.exec_prompt(prompt, images=[body])
                )
            return {"out": text[:160]}

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            # Two vision models describe the same photograph differently, so
            # only require that the validator also produced something.
            mine = leader_fn()
            return len(str(mine["out"])) > 0

        v = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.last = str(v["out"])
        return self.last

    @gl.public.view
    def answer(self) -> str:
        return self.last
