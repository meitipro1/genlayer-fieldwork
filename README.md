<div align="center">

# Fieldwork

**Evidence in, settlement out.**

Bounties for physical work, settled by photograph against a written standard.
The verdict and the payment leave the contract as a single transaction.

[![Built by InferNode](https://img.shields.io/badge/built%20by-InferNode-7ac943?style=flat-square)](https://github.com/meitipro)
[![GenLayer](https://img.shields.io/badge/GenLayer-Intelligent%20Contract-101216?style=flat-square)](https://genlayer.com)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-101216?style=flat-square)](https://nextjs.org)

</div>

---

## Overview

Someone posts a real world task and writes down exactly what "done" looks like.
They photograph how the place looks right now, and they lock the payment. A
worker claims it, does the work, and photographs the result. An Intelligent
Contract on GenLayer grades the two photographs against the written standard and
settles.

Two design decisions carry the product:

**The standard is frozen before anyone spends time.** The acceptance test is
written at posting, published on the task page, and is the exact text handed to
the graders. The contract refuses a test too vague to grade from a photograph
before the task can be funded.

**The before photograph belongs to whoever is paying.** A worker who supplies
both frames can photograph a mess, clear it, photograph it again, and be paid
for work nobody needed. Taking that frame at posting time removes the whole
class of fraud, and it gives the worker something honest in return: they can see
the state they are being measured against before they walk anywhere.

---

## How it works

| | Step | What the contract does |
| --- | --- | --- |
| 1 | The poster writes an acceptance test and photographs the place | Opens the photograph, reads the test, and refuses either if nobody could grade it - before the money is committed |
| 2 | The poster funds the task | Holds the reward plus the fee. Overpayment is banked rather than stranded |
| 3 | A worker claims it | Issues a six character code derived from the task, the worker and the moment, for the window the poster chose |
| 4 | The worker photographs the finished work with the code in frame | One frame, not two - the before frame is already on the task |
| 5 | Validators grade | Every validator fetches the same two photographs and grades them against the same text |
| 6 | Settlement | Verdict and payment in one transaction, and a public receipt is left behind |

Validators must agree on three judgements before a coin moves: **the code is
legible**, **both frames show the same place**, and **the acceptance test
passed**. No single party decides - not the poster, not one model, not one node.

---

## Why this needs GenLayer

The contract does not use a model as a backend. It uses one where a **judgement
has to be settled between parties who do not trust each other**.

A poster and a worker disagree about whether a job was done. Today the poster
decides, days later, with a model they own, which is exactly the arrangement
workers distrust. Here the standard is public before anyone spends time, several
validators grade the same evidence against that same text independently, and
they must agree before a single coin moves.

Nothing about that reduces to a deterministic API call, and nothing about it is
safe to let one party compute. That boundary is the whole architecture:

- **The contract owns** the acceptance test, the challenge code, the grading,
  the reuse checks and the payout.
- **The frontend owns** the camera, the checklist, the uploads and the copy.
- **Storage owns** the photographs, content addressed so every validator
  provably grades identical bytes.

---

## The contract

**38 methods, 30 view and 8 write**, `genvm-lint` clean. There is no build step
between the source and the chain: what runs is the file as written, with line
endings normalised to LF so a deployment compares byte for byte against any
clone. The running site serves it at `/api/contract-source`, and
`npm run verify-source` diffs a deployed address against this repository.

Each method keeps a one paragraph summary of its rule. The reasoning behind each
rule is in [`contracts/RATIONALE.md`](contracts/RATIONALE.md), method by method,
because on-chain bytes are a cost.

### Behaviour worth knowing

- **The claim window is the poster's choice**, between ten minutes and a week.
  Below ten minutes a task is not a task but a trap; above a week one worker can
  sit on it to keep everyone else off.
- **A rejection does not cost the claim.** Most failures are lighting and
  framing, not fraud, so the task stays with the worker and can be retaken
  inside the same window.
- **An abandoned task returns to the pool carrying nothing of the failed
  attempt** - not the photograph, not the judgements, not the graded stamp.
- **A poster cannot cancel out from under a live claim.** A worker told to
  retake keeps the task until their window runs out.
- **A task can carry its own deadline, and anyone can close it once it
  passes.** An unclaimed task used to hold its reward until the poster came
  back. `expire_task` now sends the reward and the fee back to the poster in
  one transaction, and a claim is clamped so it can never outlive the deadline
  it was taken under. With no deadline set, a task behaves exactly as before.
- **Photographs are refused before a grader is paid for.** Anything unopenable,
  or too small for a six character code to be legible, costs a retake and
  nothing else.

---

## The site

Next.js 14, App Router. Nine screens, one job each: find work, read the
standard, photograph the result, and a public receipt for every settled task -
rejections published beside payments, so the record is one you can check rather
than one you have to trust.

### Nothing is announced before the chain has settled

A GenLayer receipt carries three fields that all read like a verdict, and two of
them lie. `status` is `FINALIZED` on a refused call, because refusing is a
perfectly successful transaction. `result` is `MAJORITY_AGREE`, because
validators agreeing that a call failed is still agreement. Only
`consensus_data.leader_receipt[].execution_result` answers "did my code run".

So every write asserts that field, waits for finality, holds, and then **reads
the answer back off the chain** rather than off the receipt that arrived first.
Where an answer genuinely is not available, the interface says so instead of
guessing at one.

### The exposure check the contract cannot run

The contract's pre-flight measures exposure and refuses a frame too dark or too
washed out to grade, but the Pillow build inside GenVM has no JPEG decoder, so
on the JPEGs this site uploads that measurement is skipped rather than failed.
The submit screen runs the same measurement, on the same pixels the validators
will fetch and against the contract's own thresholds, before anything is sent.
It never blocks a submission: the graders decide, not the page.

---

## What stands between a photograph and a payment

Seven mechanisms, all of them in the contract, all of them running on every
submission.

1. **A standard that cannot move.** The acceptance test is frozen at posting and
   is the exact text the graders are handed.
2. **A gate before the money.** A model refuses a test too vague to grade from a
   photograph, and refuses a before frame nobody could grade, before a coin is
   committed.
3. **The before frame from the poster.** Staging a mess and clearing it stops
   being possible when the person paying owns the starting photograph.
4. **A code nobody can know in advance.** Issued at claim time, required in the
   worker's frame. A recycled photograph carries the wrong one.
5. **Identical bytes for every grader.** Photographs are content addressed, and
   the contract refuses any other kind of url.
6. **Independent graders who must agree.** Three judgements, every validator
   reaching its own, compared rather than blessed.
7. **A public receipt.** Both photographs, the exact text, the judgements and
   the reason - published for every settled task.

---

<div align="center">

Built by **InferNode**

</div>
