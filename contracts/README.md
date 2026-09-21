# Fieldwork - Intelligent Contracts

Two contracts:

| File | Purpose |
| --- | --- |
| `fieldwork.py` | The product. Tasks, claims, vision grading, reuse detection, payment. |
| `vision_probe.py` | A throwaway probe that answers one question: does image input actually execute on this network? Deploy it first. |

---

## The API names, verified against the pinned SDK

Do not take these from the docs site. `docs.genlayer.com` and
`sdk.genlayer.com/main` both describe a **newer** SDK than the one contracts
actually pin, and at least one symbol they document does not exist in the pinned
version.

The authority is the SDK that `genvm-lint` downloads for the exact hash in the
`Depends` header. On this machine it sits at:

```
~/.cache/genvm-linter/extracted/v0.3.0-rc7.tar/py-lib-genlayer-std/<hash>/genlayer
```

Read that, not the website.

| Purpose | USE THIS | NOT THIS |
| --- | --- | --- |
| Revert | `raise gl.vm.UserError("msg")` | any builtin exception - they crash the WASM with no message |
| Fetch bytes | `gl.nondet.web.request(url, method="GET").body` | - `method` is **keyword-only and required** |
| Vision | `gl.nondet.exec_prompt(p, images=[b1, b2], response_format="json")` | - `images` is keyword-only |
| Consensus block | `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` | - both args are **positional-only** |
| Send value | `gl.get_contract_at(addr).emit_transfer(value=amount)` | **`genlayer.chain.Account` does not exist in the pinned SDK** |
| Current time | `gl.message_raw["datetime"]` → `str` | `datetime.now()` |
| Signed numbers | `i64` | `u256` for anything that can go negative (latitude!) |

### Things that cost time, written down so they cost it once

**`genlayer.chain` is not real here.** `sdk.genlayer.com/main` documents
`genlayer.chain.Account(addr).emit_transfer(value)`. That module does not exist
in the pinned SDK - `genvm-lint check` fails with
`Import error: No module named 'genlayer.chain'`. The pinned SDK puts transfers
on the contract proxy instead: `gl.get_contract_at(addr).emit_transfer(value=…)`,
defined in `gl/genvm_contracts.py`. It works for a plain wallet address too.

**`emit_transfer` defaults to `on='finalized'`.** That is the behaviour we want
and it is the SDK's default, so the brief's "value only moves on finality" rule
is enforced for free. It also raises a bare `ValueError` when value is zero,
which would crash the VM with an empty error, so `_pay()` guards zero itself.

**`io` is a forbidden import, but Pillow is available.** `os`, `random`,
`pathlib`, `http`, `requests` are forbidden too - the list is
`FORBIDDEN_MODULES` in the linter's `lint/safety.py`. `hashlib`, `datetime`,
`urllib.parse` and `dataclasses` are allowed.

`io` being banned looks like it rules out image processing, because the usual
way in is `PIL.Image.open(io.BytesIO(body))`. It does not. **Pillow is present
in the GenVM runtime** - the SDK's own `gl.nondet.web.render(mode="screenshot")`
does `import PIL.Image` and `PIL.Image.open(io.BytesIO(raw))` at
`gl/nondet/web.py:146`. The ban is a linter rule on contract code, not a runtime
limit.

So `import PIL.Image` is fine, and the only thing needed is a stand-in for
`io.BytesIO`. `_BytesFile` at the bottom of `fieldwork.py` is that: the three
methods (`read`, `seek`, `tell`) Pillow actually asks for. Both lint and
validate pass with it.

**`genvm-lint validate` cannot see a class named `Contract`.** This is a bug in
the linter, not in your contract: `validate/sdk_loader.py:223` does
`if not isinstance(obj, type) or name == "Contract": continue`, skipping the
exact name GenLayer convention tells you to use. Both of these contracts and the
GenLayer Identity contracts all report `No contract class found`. To actually
run validation, copy to a temp file with the class renamed:

```bash
sed 's/^class Contract(gl.Contract):/class Probe(gl.Contract):/' contracts/fieldwork.py > /tmp/v.py
PYTHONIOENCODING=utf-8 genvm-lint check /tmp/v.py
```

**On Windows, set `PYTHONIOENCODING=utf-8`.** Otherwise the linter crashes with
`UnicodeEncodeError` trying to print its own tick character, and you cannot tell
a pass from a failure.

---

## Consensus design

Both non-deterministic blocks use `gl.vm.run_nondet_unsafe` with a validator
that **independently reaches its own verdict and compares decisions**. Neither
validator inspects only the leader's output shape, because a format check proves
the leader formatted an answer, not that the answer is right.

| Block | Leader produces | Validator does | Compared |
| --- | --- | --- | --- |
| `post_task` | is this acceptance test gradeable, and is the poster's photograph usable | fetches the same photograph and judges the same test itself | `gradeable`, `refused`, `before_hash` |
| `submit` | three judgements about two photographs | fetches the same bytes and grades again | `code_visible`, `same_place`, `test_passed`, plus `content_hash`, `phash`, `refused` |

The reason strings are deliberately **not** compared. Two graders describe the
same photograph differently, and requiring identical prose would fail consensus
on agreeing verdicts. The hashes are compared precisely because they are pure
functions of bytes every node fetched identically - that is what stops a leader
forging the reuse check.

`prompt_non_comparative` was used for the acceptance-test gate at first and
replaced: deciding gradeable/vague is a classification, and a validator that only
blesses the leader's label lets one node decide alone. Verified on Studio after
the change - the comparative gate still reaches consensus and still refuses
"Make sure the area is nice and clean and looks good when you finish".

### Error classes

Failures carry a class so validators can compare them instead of guessing:

| Prefix | Meaning | Validator rule |
| --- | --- | --- |
| `[EXPECTED]` | business logic | must match exactly |
| `[EXTERNAL]` | gateway 4xx | must match exactly |
| `[TRANSIENT]` | gateway 5xx or unexpected status | agree if both are transient |
| `[LLM_ERROR]` | model returned nothing usable | always disagree, forcing rotation |

`_handle_leader_error` implements that. A validator that simply returned `False`
for every failed leader would punish an honest node for a flaky gateway; one that
agreed with any failure would lock a broken run into state.

The prefix is for consensus, not for the worker. `humanError()` in
`lib/genlayer.ts` strips it before anything is shown.

## Tests

```bash
python contracts/test_contract_logic.py   # url rules, codes, datetimes, LLM parsing
python contracts/test_images.py           # pre-flight, determinism, the phash measurement
pytest tests/direct -q                    # full contract, mocked web + LLM
node scripts/e2e.mjs                      # the real thing, on a real chain
```

The first two parse the helpers straight out of `fieldwork.py` with `ast`, so
they test the code that ships rather than a copy that can drift.

`tests/direct` is written and currently **skips everywhere**: gltest's direct
mode downloads `genvm-universal.tar.xz`, and no genvm release publishes that
asset - they ship `genvm-linux-amd64` / `genvm-linux-arm64` only. The tests are
kept because they are correct and will run the moment it appears. Until then the
deterministic half is covered by the two scripts above and the whole flow by
`scripts/e2e.mjs` against a deployed contract.

## What the contract uses beyond the brief

- **Events** - `TaskPosted`, `TaskClaimed`, `SubmissionGraded`,
  `SubmissionRefused`. The brief's chapter 05 wants an indexer that renders proof
  pages and drives the repeat-verification sample; events are how it follows
  along without polling every task. Event `__init__` takes indexed fields
  positionally before `/` and everything else as `**blob` - any named parameter
  after the `/` fails with `specify / after indexed fields`.
- **An LLM gate on the acceptance test at posting time.** `post_task` runs
  `gl.eq_principle.prompt_non_comparative` and refuses a test that is too vague
  to grade from a photograph. The brief's risk register names vague tests as a
  top risk and only requires that the three fields are non-empty. A bad test
  poisons every submission made against it and the worker carries the cost, so
  this is the highest-leverage place in the contract to spend one LLM call.
- **Pillow** for the pre-flight checks described below.

`min_gas(leader=…, validator=…)` is deliberately **not** set. It is real and
keyword-only, but the right numbers are unknown until the first real submissions
land, and a wrong minimum makes every `submit` fail. Add it once
`genlayer trace <txId>` has shown actual gas for a vision call with two images.

## Two bugs a re-read caught

Neither showed up in lint, typecheck, or any test - both lived in paths nothing
exercised.

**A rejected task could be locked out of the pool for ever.** A rejection
deliberately leaves the claim with its owner so they can retake inside the
window. But `claim` only reopened a task whose status was `claimed`, and
`release_expired` only accepted `claimed` too. So a worker who was rejected and
then walked away left the task sitting in `rejected` with a dead clock: nobody
could claim it, `release_expired` refused it, and the reward stayed locked until
the poster noticed and cancelled. `_abandoned()` now treats `claimed` and
`rejected` alike, and both entry points go through it. It also refuses to read a
blank expiry as "long ago", which string comparison would otherwise do.

**Overpaying a task burned the excess.** `post_task` accepted
`value >= reward + fee` and then did nothing with the difference. A cancel
refunds only the reward and the fee, and `withdraw_fees` pays out only
`fees_accrued`, so anything extra was stranded in the contract with no path out.
The excess is now banked into `fees_accrued`, which makes it withdrawable rather
than lost.

Both are covered: `_abandoned` by eight cases in
`contracts/test_contract_logic.py`, and both by direct-mode tests that will run
when gltest can.

## Two things the brief got wrong

**There is no two image limit.** The brief builds the whole product shape around
"the vision call accepts two, which is why the entire product is a before and
after pair rather than a gallery". The SDK signature is
`images: Sequence[bytes | Image] | None` with no bound anywhere. Before/after is
a good *design* decision - it is what makes the same-place check meaningful - but it is a choice, not a constraint. If a task ever needs three angles, the SDK
will take them.

**The reuse check as written was bypassable.** The brief computes a hash inside
`leader_fn` but its `validator_fn` only compares the three booleans:

```python
return all(mine[k] == theirs[k] for k in ("code_visible", "same_place", "test_passed"))
```

Nothing checks the hash, so a leader could return a hash that is not the
photograph's, walk past `if v["phash"] in self.phashes`, and get paid for an
image already used. `fieldwork.py` compares `content_hash` too. It is a pure
function of the fetched bytes, so honest nodes always agree on it, and a lying
one fails consensus.

---

## Image processing

Three things happen to the pixels, in this order.

**1. Pre-flight, before the model runs.** `_preflight()` opens each photograph
and refuses it if it cannot be decoded, if the long edge is under `MIN_EDGE`
(480px, below which a six character code is not legible), or if mean luminance
is outside `[DARK_MEAN, BRIGHT_MEAN]` = `[12, 243]`. Those bounds are extreme on
purpose: they catch a lens cap or the sun straight into the lens, not a dim
afternoon. A refused photograph never reaches `exec_prompt`, so the most
expensive call in the contract is skipped and the worker gets a specific reason
while they are still standing there.

Covered by `contracts/test_images.py` - 14 cases including the negatives that
matter (a dusk photo and a bright-day photo must still be accepted).

**The runner's Pillow has no JPEG decoder, and that shapes the whole function.**
Measured on Studio against `py-genlayer:1jb45aa8...`, which ships Pillow
11.3.0.dev0:

| codec | `PIL.features.check_codec` |
| --- | --- |
| `jpg` | **False** |
| `zlib` (PNG) | True |
| `jpg_2000` | True |

Also present: `gif`, `raw`, `pcx`, `tga`, `bcn`, `sgi_rle`, `sun_rle`, `xbm`.
Verified with `contracts/probe_preflight.py`, which reports what the node sees
rather than guessing at it.

The consequence is specific: a JPEG **opens** - the header parse is pure Python,
so `.format` and `.size` are genuinely correct - and then raises
`OSError: decoder jpeg not available` the moment anything touches a pixel. So
`_preflight` is split in two. The dimension check needs only the header and runs
on everything. The brightness check needs pixels, and when the decoder is
missing it is **skipped rather than failed**: a decoder we do not ship is our
limitation, and refusing a good photograph over it would reject every JPEG ever
submitted. `_dhash` returns `""` on every JPEG for the same reason, which is
fine because it decides nothing.

This shipped broken and no test caught it, because `test_images.py` runs against
the host's Pillow, which links libjpeg. The guard is now
`test_runner_has_no_jpeg_decoder()`, which monkeypatches `JpegImageFile.load` to
raise exactly what the runner raises and asserts the split above. If you add a
check that touches pixels, add a case there too.

**A JPEG with no JFIF header is refused outright.** Magic `ffd8ffdb` - SOI
straight into the quantisation tables. Pillow opens it happily and the vision
model refuses it with `NondetException: {'causes': ['INVALID_IMAGE']}`. Left
unhandled that aborts the transaction: no verdict is written, the task stays
`claimed`, and the worker is told nothing. Two defences, both needed:

- `_preflight` checks `data[2:4]` is `ffe0` (JFIF) or `ffe1` (EXIF) and refuses
  anything else with an instruction to re-save the file, so the vision call that
  was always going to fail never happens.
- `_grade` wraps `exec_prompt` and converts **only** `INVALID_IMAGE` into a
  clean rejection. Everything else is re-raised, because swallowing a transient
  model error would turn a retryable blip into a permanent rejection of work
  that was actually done.

Covered on chain by `scripts/e2e-full.mjs`, whose no-credential path submits
exactly such a file and asserts the run ends in `rejected` with advice rather
than in a crash.

**A blind grader is an error, never a verdict.** Studio's `llm-router` does not
hand every validator the same model, and some of the allowed families are text
only. Such a model answers confidently about photographs it never received, so
the prompt asks for a `saw_images` boolean and the contract refuses to act on a
verdict when it is false.

The subtlety is *how* it refuses. Returning that as a verdict makes it something
validators compare, and then a blind leader plus a sighted validator disagree,
the round reaches `NO_MAJORITY`, and the transaction stalls in `PROPOSING` with
the task stuck as `claimed` forever. Measured on `0x60743996`: leader
`execution_result` was `SUCCESS`, its verdict was "the grader could not see your
photographs", and consensus was `NO_MAJORITY`.

So it is **raised** as `[TRANSIENT]` instead, which routes it into
`_handle_leader_error`:

- validator also blind: both transient, they agree, and the worker gets a clean
  "please submit again" rather than a hung transaction
- validator can see: it succeeds where the leader failed, disagrees, and the
  round rotates to another leader, which is the only outcome that actually gets
  the work graded

The rule this encodes: **which model a node happens to be given is not a
property of the bytes, so it must never be compared as though it were.**

**Every rejection stores the photograph it rejected.** `t.after_url` is written
before any branch in the deterministic half, and the early reuse check writes it
too. Without that, a task refused for reuse had a verdict, a reason and no
`after_url`, so its public receipt rendered a broken image next to the sentence
explaining what was wrong with a photograph nobody could see.

**2. Exact reuse, deterministic.** The CID is parsed out of the url before
anything is fetched, and `sha256` of the after image is computed in the
consensus block. Both are exact matches against everything already paid for.

**3. A perceptual hash that decides nothing.** `_dhash()` is recorded on the
task and shown on the receipt for human reviewers, and that is all it does.

### Why there is no perceptual reuse check

It was built - dHash plus LSH banding over four 16-bit bands - and then measured,
and the measurement killed it. Distances at 64 bits:

| | distance |
| --- | --- |
| same photograph, re-encoded at q55 | 8 |
| same photograph, resized | 4 - 6 |
| **same place, photographed another day** | **2** |
| a different scene entirely | 16 - 20 |

The populations overlap, and they overlap the wrong way round: honest repeat
work at the same corner scores *closer* than actual reuse. Going to 256 bits made
it worse (39 vs 28). There is no threshold. This is not a tuning problem, it is
the domain - every task in this product is a photograph of the same place, so
"looks almost identical" is the normal case rather than the suspicious one.

The failure mode also is not symmetric: a false positive tells a worker who did
the job that they are a fraud. So it does not vote.

**What actually catches a recycled photograph is the challenge code.** It is
issued at claim time, it is different for every claim, and an old photograph
carries the wrong one - which the vision model is already checking for, in the
call we are already paying for. The brief's own design had the answer; the
perceptual hash was never load-bearing.

`test_images.py` keeps the measurement as a test, so if the numbers ever
separate, the decision can be revisited on evidence.

---

## Vision is proven on Studio - and what it took

`gl.nondet.exec_prompt(images=[...])` **works**. Probe
`0xcB4ad1cdb1DF6C9069592c8eaCb357507F04D65f` on Studio, asked to describe a
photograph of a golden retriever holding a flower, answered
`golden retriever with a flower`.

Reproduce it, with no account and no faucet, because Studio is gasless:

```bash
node scripts/prove-vision.mjs
```

It generates a throwaway in-memory account, deploys `vision_probe.py`, then runs
three steps so a failure names the part that broke: `fetch_only` (are these
really image bytes), `describe_text`, `describe_json`.

Three things cost real time getting there, all worth knowing.

**1. `INVALID_IMAGE` usually means you fetched something that is not an image.**
The first attempt used a Wikimedia URL. Wikimedia answers **403** to a client
with no User-Agent, and the 126-byte `text/plain` error page was handed to the
model as a photograph. The failure surfaced only as
`NondetException {'causes': ['INVALID_IMAGE'], 'ctx': {}}` with no hint. Both
contracts now check `res.status != 200` before trusting the body, which turns
that into a sentence a human can read.

**2. A JPEG without a JFIF header is rejected.** After the fetch was fixed, a
valid 119KB JPEG whose magic bytes were `ffd8ffdb` (SOI followed straight by
DQT, no APP0) still failed `INVALID_IMAGE`. The same subject as a standard
baseline JFIF (`ffd8ffe0`) graded fine at **43KB and at 520KB**, so it is the
container and not the size. `lib/image.ts` therefore re-encodes every upload
through a canvas, which always emits baseline JFIF, and strips EXIF (including
GPS the worker did not mean to publish) on the way.

**3. The router can hand the call to a model that cannot see.** Studio's
validators run `llm-router` with policy `prd-gpt-5-4`, whose allowed families
include the text-only `gpt-oss-120b`. Asked about the same photograph, separate
runs returned `A white toilet bowl` and `No image provided` - the second is
honest, the first is a confident hallucination about an image the model never
received.

That is dangerous for a product that pays people on a model's say-so. The prompt
now requires a `saw_images` boolean and the contract refuses to grade when it is
false, so a blind grader produces a clean "please submit again" instead of a
verdict. Consensus is the backstop - a hallucinating validator disagrees with a
seeing one and the transaction fails rather than paying - but it is better to
catch it as a stated refusal than as an unexplained disagreement.

## Deploy

**Studio is the target network.** Bradbury has a confirmed network bug where a
deploy reports `FINALIZED` with storage changes and yet `gen_getContractCode`
answers "contract code not found" - reproduced with the official CLI, so it is
not a tooling problem. Studio does not have it: the probe deployed and its code
read back straight away.

Studio is also **gasless** (`eth_gasPrice` is `0x0`), and its faucet is not a
URL - it is the water-drop button in the account selector inside
studio.genlayer.com, which funds Studio's own accounts rather than an external
wallet. Because the flow is gasless, nobody needs it.

```bash
genlayer network set studionet
genlayer account create --name fieldwork
```

The deployer becomes the contract `owner`, which is why this one wants a real
named account rather than the throwaway the probe uses.

```bash
# The product. Constructor arg is the take rate in basis points (600 = 6%).
genlayer deploy --contract contracts/fieldwork.py --args 600
```

Put the address in the site env and redeploy:

```
NEXT_PUBLIC_FIELDWORK_CONTRACT=0x…
```

### Verify the deploy actually landed

`ACCEPTED` is not enough; the code is only readable once finalized. This is the
exact check that exposes the Bradbury bug.

```bash
genlayer schema <CONTRACT_ADDRESS>
```

Reading a Studio contract over raw JSON-RPC takes a **bare address string**
(`params: ["0x..."]`). Passing Bradbury's `[{"address": "0x..."}]` shape returns
a psycopg2 "can't adapt type 'dict'" SQL error, which reads like a broken
contract but is just the wrong call shape. `gen_getTransactionByHash` does not
exist on Studio either - use `eth_getTransactionByHash`, and read the real
failure from `consensus_data.leader_receipt.genvm_result.stderr`, because the
`error` field comes back empty.

---

## Method reference

Writes (wallet signed):

- `post_task(title, place, acceptance_test, example_pass, example_fail, before_url, lat_e6, lng_e6, reward, min_reputation, fixed_code)` - **payable**, send `reward + fee`. `fixed_code` is normally `""`
- `claim(task_id) -> str` - returns the six character challenge code
- `submit(task_id, after_url) -> str` - returns `paid` or `rejected`
- `release_expired(task_id)` - returns an abandoned claim to the pool
- `cancel_task(task_id)` - poster only, refunds reward and fee
- `withdraw_fees(to)`, `transfer_ownership(new_owner)` - owner only

Views are one per field (`status_of`, `reason_of`, `challenge_code_of`,
`acceptance_test_of`, `reward_of`, `before_url_of`, `after_url_of`,
`content_hash_of`, `reputation_of`, `total_tasks`, …). Run
`genlayer schema <address>` for the full list.

### The three judgements are stored, not inferred

`Task` carries `code_visible`, `same_place`, `test_passed` and `graded_at`, and
`submit` writes all four the moment the graders agree, **before** it branches
into paid or rejected.

They look redundant on a paid task, because `paid` already means all three were
true. They are not redundant on a rejected one, and that is the case that
matters: "the code was not legible" tells a worker to retake the photograph,
"the test did not pass" tells them the work is not finished, and a bare
`rejected` tells them to guess. The frontend used to hard-code three green ticks
for any paid task and show nothing at all for a rejection, which was both made
up and useless in the same breath.

`graded_at` is `""` until something has actually been graded, so a receipt can
tell an absent verdict from a negative one. A submission refused before the
model ran - an unreadable file, a photograph already used - leaves it empty, and
the receipt says so rather than printing three noes.

### Who supplies the before photograph

The poster, not the worker. A worker who supplies both frames controls the
comparison entirely: they can photograph a mess they made, clear it, and be paid
for work nobody needed. Every check downstream - the acceptance test, the same
place judgement, the pre-flight - is measured against a starting state that the
person being paid chose. Moving that frame to the poster is the difference
between grading work and grading a story about work.

The cost is real and is stated on `/limits`: the challenge code is issued at
claim time, so it does not exist when the poster shoots. The code can therefore
only be checked in the worker's frame. That is the weaker of the two properties,
and staging is the more expensive fraud to be wrong about.

Two consequences in the contract:

- `post_task` fetches and pre-flights the before photograph **before** it takes
  the money, so a task can never be funded with a frame nobody could grade. The
  worker is the one who would otherwise walk there to find that out.
- the before CID is written into `seen_cids` when the task is posted, so handing
  the poster's own file back as an after frame is caught by the same reuse check
  as any other recycled photograph - plus an explicit equality check with a
  better error message.

### A poster can publish the code, and that is a deliberate weakening

`post_task` takes a `fixed_code`. Empty, which is the normal case, means the
contract derives the code at claim time from the task, the worker and the
moment, so nobody can know it in advance. Six characters from `CODE_ALPHABET`
instead means the code is stored on the task and handed out unchanged when
somebody claims.

The reason it exists: the issued code makes the product impossible to try on
your own. You cannot photograph the finished work in advance, because the code
you must hold in the frame does not exist until you claim, and by then you are
supposed to be standing in a car park. A team demonstrating the product, or one
person testing the whole loop, needs the code first.

What it costs, stated plainly because the site states it plainly: an issued code
proves a photograph was taken **after** the claim, since nobody could have known
it before. A published one proves only that the photographer read the task page,
so the work can be staged in advance. Tasks carrying one are labelled `test task`
everywhere they appear and print the code openly on the task page.

Validation happens before any money moves or any node fetches anything, so a
typo costs nothing: exactly six characters, drawn from the same alphabet, upper
cased and trimmed first.

### The challenge code alphabet

`23456789ABCDEFGHJKMNPQRSTVWXYZ` - no `I`, `L`, `O`, `U`, `0` or `1`. The code is
written by hand on a scrap of paper and read back by a vision model, so
characters that are misread by hand are simply not in the alphabet. The brief
used `sha256` hex, which contains `0`, `1` and `O`-alikes.
