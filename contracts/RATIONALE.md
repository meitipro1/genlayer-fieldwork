# Fieldwork contract - the reasoning behind each rule

The contract keeps a one paragraph summary on every method. On-chain bytes are a cost, and Studio resets a deploy request much past 55 KB, so the reasoning behind each rule lives here instead, method by method.

Each section is the full docstring the method carried beside the code. The summary that stays in the contract is its first paragraph, word for word.

## `Contract._clean_claim_minutes`

The poster's claim window, or the default when they did not choose.

Bounded on both sides. A window under ten minutes is not a task, it is a
trap: the worker cannot reach the place before it expires and the reward
goes back to the pool. A window over a week lets someone claim a task
purely to keep everyone else off it, which is the same denial of service
with better manners.

## `Contract._clean_open_minutes`

How long the task stays open to new claims, or zero for no deadline.

Zero is the default and it is the behaviour every task posted before
this existed already has: the task stays open until the poster withdraws
it themselves. That is deliberately kept, because a deadline nobody
chose is a deadline nobody expects.

Bounds are checked here rather than at the point of use, because
_plus_minutes hands the number to datetime.timedelta and a large enough
one raises OverflowError. That is not a UserError, so it would not carry
an error class and would not compare between a leader and a validator -
a poster would see a node fall over instead of a sentence telling them
what to change.

A deadline shorter than the claim window it offers is refused rather
than quietly clamped. It would mean advertising a window the task cannot
honour, and the poster is the one who can fix it.

## `Contract._clean_fixed_code`

Validate a poster-chosen code, or "" for the normal issued one.

Exists so a task can be handed to someone who needs the code *before*
they set out: a tester preparing a photograph, or a team running the
product end to end without two people and a walk. The normal code is
issued at claim time and cannot be known in advance, which is exactly
what makes that impossible.

It is a real weakening and the site says so. An issued code proves the
photograph was taken after the claim, because nobody could have known
it before. A published one proves only that the photographer knew a
published string, so it can be staged ahead of time. Fine for a demo,
wrong for paid work, and never the default.

## `Contract._abandoned`

Has the claim on this task run out?

Both `claimed` and `rejected` count. A rejection leaves the claim with
its owner so they can retake inside the window, which means a worker who
is rejected and then walks away leaves the task sitting in `rejected`
with a dead clock. Without this that task never returns to the pool: no
one can claim it and the reward stays locked until the poster notices.

## `Contract._past_deadline`

Has this task's own deadline passed?

The empty check is the whole point of routing every read through here.
"" means the poster set no deadline, and every real stamp sorts above
"", so a bare `now > t.open_until` is True for every deadline-free task
the instant it is posted - which would let a stranger hand the reward
back and close a task that was never meant to close. Same shape as
_abandoned above, guarding against the same mistake for the same reason.

Unlike _abandoned this deliberately has no status clause. A deadline
belongs to the task rather than to an attempt, so it stays true once it
is true. Every caller therefore has to check the status itself, and
expire_task does that first.

## `Contract._return_to_pool`

Hand an abandoned task back to the pool, with nothing of the last
attempt still attached to it.

The claim fields are the obvious half. The submission fields matter just
as much: a task that was rejected and then abandoned kept the previous
worker's after photograph, their three judgements and their graded_at
stamp. Once it was open again the site read those and showed an
available task carrying someone else's failed evidence and a verdict on
work that no longer had anything to do with it.

The attempt is not lost - every grading emitted an event, and the
transaction that made it is on chain. What is dropped here is only the
contract's claim that *this open task* has been graded.

What must NOT be cleared here is anything belonging to the task rather
than to the attempt: before_url, and open_until beside it. Adding
`t.open_until = ""` to the list below reads like tidiness and is the
whole bug back - a task returned to the pool would lose its deadline,
become immortal again, and lock its reward for good.

## `Contract.post_task`

Post a task. The poster supplies the photograph of how it looks now.

The before frame belongs to whoever is paying, not to whoever is being
paid. A worker who supplies both frames can stage the before - shove the
bags into shot, photograph it, move them back out, photograph it again - and collect for work nobody did. Taking that frame at posting time
removes the whole class of fraud, and it also gives the worker something
honest: they can see the state they are being measured against before
they walk anywhere.

The cost is that the challenge code cannot appear in the before frame.
It does not exist yet - it is issued at claim time, to one worker. So
the code is required in the after frame only, and what ties the two
together is the same-place judgement instead.

`fixed_code` is normally "". Setting it publishes the code with the task
so it can be known before anyone claims, which makes the product
testable by one person and weakens the anti-fraud property. See
_clean_fixed_code.

`claim_minutes` is how long a worker gets once they claim. Zero means
the default. The poster picks it because they are the only one who knows
whether the job is a five minute look at a noticeboard or an afternoon
with a van.

`open_minutes` is how long the task stays open to new claims, and zero
means no deadline at all, which is what every task posted before this
parameter existed has. A task with a deadline can be closed by anyone
once it passes, which sends the reward and the fee back to the poster.
Without one, the money sits here until the poster returns to withdraw
it, and a poster who never returns leaves it here for good.

## `Contract.expire_task`

Close a task whose deadline has passed and send the money back.

Anyone may call this, and that is the entire point. The failure being
fixed is a poster who funds a task, walks away and never returns: a
withdrawal only they can make cannot fix that by definition, so the
reward sits here for good and a job nobody can do sits on the map
forever beside it. Opening the call up costs nothing, because the caller
never names a recipient and gains nothing - the money can only go to
t.poster, read out of storage.

A live claim is never cut short here. It cannot be: claim clamps
claim_expires to open_until, so a claim that is still running is still
inside the deadline, and one that is not is abandoned and goes back to
the pool on the line below before anything else is decided. That saves a
caller from having to send release_expired first.

## `Contract.cancel_task`

Withdraw an unpaid task and take the money back.

A `rejected` task is only cancellable once its claim window has run out.
A rejection deliberately leaves the claim with the worker so they can
retake - most failures are lighting and framing, not fraud - and letting
the poster cancel during that window would mean a worker who has already
made the trip is told to retake and then finds the task gone. Waiting
for the window costs the poster minutes and is the difference between a
promise and a suggestion.

## `Contract.task_json`

A whole task in one call.

The per field views below are convenient for a CLI, but a list of
twenty tasks through them is twenty times a dozen round trips. The site
reads this instead.

## `_handle_leader_error`

Decide whether to agree with a leader that failed.

Agreeing on a broken run would lock the failure into state, and blanket
disagreement would punish an honest node for a flaky gateway. So the
validator does the work itself and compares the *class* of failure.

## `_looks_like_image`

Do these first bytes begin one of the formats a grader can read?

JPEG, PNG, GIF, WebP, BMP. Deliberately by magic number rather than by the
content type header, because a gateway serving an error page is perfectly
capable of labelling it image/jpeg.

## `_fetch_photo`

Fetch one photograph, classifying failures for the validator.

A gateway that answers 403, 404 or 504 still returns a body, and it is a
text error page. Passing that on as a photograph fails deep inside the
model as INVALID_IMAGE with no usable reason, so every failure is caught
here and named.

## `_grade`

Run the vision call, or return None if the node would not read an image.

`exec_prompt` raises `NondetException: {'causes': ['INVALID_IMAGE']}` when
the node's decoder refuses a file. Unhandled, that aborts the whole
transaction: the verdict is never written, the task stays `claimed`, and the
worker is told nothing at all. Returning None instead lets the caller turn
it into a normal rejection with advice.

Only INVALID_IMAGE is converted. Every other failure is re-raised, because a
transient model error must stay transient - swallowing one would turn a
retryable blip into a permanent rejection of good work.

Both leader and validator hit the same bytes and so reach the same answer,
which is what keeps this deterministic enough for consensus.

## `_preflight`

Refusal reason for a photograph nobody could grade, or "" if it is fine.

Runs inside the consensus block and its result is compared by every
validator, so it is a pure function of the bytes. It exists to spend a
fraction of a cent instead of a whole vision call on a photograph that is
obviously unusable, and to tell the worker what to change while they are
still standing there.

**The runner's Pillow has no JPEG decoder.** Measured on Studio against
py-genlayer:1jb45aa8..., which ships Pillow 11.3.0.dev0 built with
zip/jpeg2k/gif/raw and `check_codec("jpg") is False`. A JPEG therefore
*opens* - the header parse is pure Python, so `.format` and `.size` are
real - and then raises `OSError: decoder jpeg not available` the moment
anything touches a pixel.

That distinction is the whole design of this function. The dimension check
needs only the header and runs on everything. The brightness check needs
pixels, so on a JPEG it is **skipped rather than failed**: refusing a
perfectly good photograph because this node cannot decode its format would
reject every JPEG ever submitted, which is exactly the bug this replaced.
A missing decoder is our limitation and must never be charged to the worker.

PNG and JPEG 2000 decode fully here, so a client that uploads PNG gets the
brightness check as well. See contracts/README.md.

## `_dhash`

A 64 bit difference hash, computed with integers only.

Recorded on the task so a person reading a receipt can compare it with
another. It decides nothing: see the note at the top of this file for the
measurements showing it cannot separate honest repeat work from reuse.

Undecodable bytes return an empty string rather than raising, because
raising inside a run_nondet_unsafe block surfaces as a bare consensus
disagreement instead of a clean verdict.

In practice this returns "" for every JPEG, because the runner's Pillow has
no JPEG decoder - see the note in _preflight. It is deterministic either
way, which is all consensus needs, and it decides nothing.

## `_BytesFile`

The minimum file-like surface PIL needs to open a buffer.

PIL wants read/seek/tell. The obvious way to supply that is io.BytesIO, but
`io` is on the linter's forbidden import list, so this stands in for it.
