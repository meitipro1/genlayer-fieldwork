"""Direct-mode tests for the Fieldwork contract.

    pytest tests/direct -v

No server and no chain: the VM runs in memory and web/LLM calls are mocked, so
these exercise business logic, validation and state transitions in ~milliseconds.
Validator agreement is NOT exercised here - that needs the integration tests or
a real network.
"""

import io
import json
import pathlib
import re
import urllib.error
import urllib.request

import PIL.Image
import PIL.ImageDraw
import pytest

CONTRACT = str(pathlib.Path(__file__).resolve().parents[2] / "contracts" / "fieldwork.py")


def _direct_mode_available() -> bool:
    """gltest's direct mode needs a GenVM build that is not published yet.

    gltest/direct/sdk_loader.py fetches
    `<releases>/download/<version>/genvm-universal.tar.xz`, and no genvm release
    ships that asset - they carry genvm-linux-amd64 / genvm-linux-arm64 only. So
    these tests cannot run anywhere today, on any OS. They are written and kept
    because they are correct and will run the moment the asset appears; the
    deterministic half of the contract is covered meanwhile by
    contracts/test_contract_logic.py, and the whole flow is covered on a real
    chain by scripts/e2e.mjs.
    """
    url = (
        "https://github.com/genlayerlabs/genvm/releases/download/"
        "v0.3.0-rc7/genvm-universal.tar.xz"
    )
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10):
            return True
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return False


pytestmark = pytest.mark.skipif(
    not _direct_mode_available(),
    reason="genvm-universal.tar.xz is not published in any genvm release, so "
    "gltest direct mode cannot start. See _direct_mode_available().",
)

GEN = 10**18
FEE_BPS = 600

GOOD = {
    "title": "Clear the bin area behind 14 Mill St",
    "place": "Mill St, behind the parade",
    "test": (
        "The bin area is empty. No bags remain against the wall, the ground is "
        "clear of loose litter, and both bins are upright with their lids closed."
    ),
    "pass": "Wall and ground clear, bins upright, lids down, code legible.",
    "fail": "Bags moved out of shot rather than removed.",
}

CID_A = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzda"
CID_B = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdb"
URL_A = f"https://ipfs.io/ipfs/{CID_A}"
URL_B = f"https://ipfs.io/ipfs/{CID_B}"
CID_C = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdc"
URL_C = f"https://ipfs.io/ipfs/{CID_C}"


def photo(seed: int = 1, w: int = 1200, h: int = 900, shade: int = 150) -> bytes:
    """A baseline JFIF JPEG big enough and bright enough to clear pre-flight."""
    img = PIL.Image.new("RGB", (w, h), (shade, shade - 5, shade - 18))
    d = PIL.ImageDraw.Draw(img)
    d.rectangle([0, h // 2, w, h], fill=(shade - 30, shade - 35, shade - 46))
    d.rectangle([60 * seed, 100, 300 + 40 * seed, 400], fill=(47, 93, 58))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def re_escape(url: str) -> str:
    """mock_web matches on a regex, and a URL is full of regex metacharacters."""
    return re.escape(url)


def web_ok(body: bytes):
    return {"response": {"status": 200, "headers": {}, "body": body}, "method": "GET"}


def gradeable(vm, yes: bool = True):
    """Answer the acceptance-test reviewer."""
    vm.mock_llm(
        r"(?s).*acceptance_test.*",
        json.dumps({"gradeable": yes, "reason": "names visible things"}),
    )


def graded(vm, *, saw=True, code=True, place=True, passed=True, reason="looks clear"):
    """Answer the photograph grader."""
    vm.mock_llm(
        r"(?s).*Two photographs are attached.*",
        json.dumps(
            {
                "saw_images": saw,
                "code_visible": code,
                "same_place": place,
                "test_passed": passed,
                "reason": reason,
            }
        ),
    )


def post(contract, vm, sender, *, reward=18, rep=0, before=URL_A, before_bytes=None, code="", window=0, open_for=0, **over):
    """Post a task. The before photograph belongs to the poster, so it is
    fetched and vetted here rather than at submission time."""
    body = {**GOOD, **over}
    vm.mock_web(re_escape(before), web_ok(before_bytes if before_bytes else photo(1)))
    vm.sender = sender
    vm.value = reward * GEN + reward * GEN * FEE_BPS // 10000
    return contract.post_task(
        body["title"],
        body["place"],
        body["test"],
        body["pass"],
        body["fail"],
        before,
        51505100,
        -122600,
        reward * GEN,
        rep,
        code,
        window,
        open_for,
    )


@pytest.fixture
def contract(direct_deploy):
    return direct_deploy(CONTRACT, FEE_BPS)


# ---------------------------------------------------------------- posting


def test_posts_a_gradeable_task(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    assert int(contract.total_tasks()) == 1
    assert contract.title_of(task_id) == GOOD["title"]
    assert contract.status_of(task_id) == "open"
    assert int(contract.reward_of(task_id)) == 18 * GEN
    assert int(contract.fee_bps_value()) == FEE_BPS


def test_refuses_a_vague_task(contract, direct_vm, direct_alice):
    gradeable(direct_vm, False)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, test="Make the yard look nice and clean please")
    assert "cannot be graded" in str(err.value)
    assert int(contract.total_tasks()) == 0


def test_refuses_when_underfunded(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.sender = direct_alice
    direct_vm.value = 1 * GEN
    with pytest.raises(Exception) as err:
        contract.post_task(
            GOOD["title"], GOOD["place"], GOOD["test"], GOOD["pass"], GOOD["fail"],
            URL_A, 51505100, -122600, 18 * GEN, 0, "", 0,
        )
    assert "reward plus the fee" in str(err.value)


def test_requires_both_examples(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, **{"pass": "   "})
    assert "pass example and a fail example" in str(err.value)


def test_requires_a_test_long_enough_to_be_fair(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, test="clean it")
    assert "too short" in str(err.value)


def test_refuses_a_before_photograph_nobody_could_grade(
    contract, direct_vm, direct_alice
):
    """Vetting the poster's frame at posting time rather than at submission
    time. A task funded with an unusable before photograph is unwinnable, and
    the worker would be the one who walked there to find out."""
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, before_bytes=photo(1, w=200, h=150))
    assert "too small" in str(err.value)
    assert int(contract.total_tasks()) == 0


def test_refuses_a_before_url_outside_content_addressed_storage(
    contract, direct_vm, direct_alice
):
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, before="https://example.com/b.jpg")
    assert "content addressed" in str(err.value)


def test_a_published_code_is_used_instead_of_an_issued_one(
    contract, direct_vm, direct_alice, direct_bob
):
    """The whole point: the code is knowable before anyone claims, so a tester
    can prepare the photograph. It is weaker on purpose and labelled as such."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, code="ABC234")
    assert contract.fixed_code_of(task_id) == "ABC234"

    direct_vm.sender = direct_bob
    assert contract.claim(task_id) == "ABC234"
    assert contract.challenge_code_of(task_id) == "ABC234"


def test_a_published_code_is_normalised_and_checked(
    contract, direct_vm, direct_alice
):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, code="  abc234 ")
    assert contract.fixed_code_of(task_id) == "ABC234"

    for bad, expect in (("ABC23", "exactly six"), ("ABCDEFG", "exactly six"), ("ABC23O", "may only use")):
        gradeable(direct_vm, True)
        with pytest.raises(Exception) as err:
            post(contract, direct_vm, direct_alice, code=bad)
        assert expect in str(err.value)


def test_no_published_code_still_issues_one_at_claim(
    contract, direct_vm, direct_alice, direct_bob
):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)
    assert contract.fixed_code_of(task_id) == ""

    direct_vm.sender = direct_bob
    code = contract.claim(task_id)
    assert len(code) == 6
    assert all(c in "23456789ABCDEFGHJKMNPQRSTVWXYZ" for c in code)


def test_the_poster_chooses_the_claim_window(
    contract, direct_vm, direct_alice, direct_bob
):
    """Ninety minutes is right for a bin area and wrong for a job with a van."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, window=240)
    assert int(contract.claim_minutes_of(task_id)) == 240

    gradeable(direct_vm, True)
    default_id = post(contract, direct_vm, direct_alice)
    assert int(contract.claim_minutes_of(default_id)) == 90


def test_an_unusable_claim_window_is_refused(contract, direct_vm, direct_alice):
    for window, expect in ((5, "leaves no time"), (60 * 24 * 30, "away from everyone")):
        gradeable(direct_vm, True)
        with pytest.raises(Exception) as err:
            post(contract, direct_vm, direct_alice, window=window)
        assert expect in str(err.value)


# ---------------------------------------------------------------- claiming


def test_claim_issues_a_readable_code(contract, direct_vm, direct_alice, direct_bob):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_bob
    code = contract.claim(task_id)

    assert len(code) == 6
    # No I, L, O, U, 0 or 1 - the code is handwritten and read back by a model.
    assert set(code) <= set("23456789ABCDEFGHJKMNPQRSTVWXYZ")
    assert contract.status_of(task_id) == "claimed"
    assert contract.challenge_code_of(task_id) == code
    assert len(contract.claim_expires_of(task_id)) == 19


def test_cannot_claim_twice(contract, direct_vm, direct_alice, direct_bob, direct_charlie):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_bob
    contract.claim(task_id)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception) as err:
        contract.claim(task_id)
    assert "not open" in str(err.value)


def test_reputation_gates_high_value_work(contract, direct_vm, direct_alice, direct_bob):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, rep=5)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.claim(task_id)
    assert "reputation too low" in str(err.value)


def test_unknown_task_is_refused(contract, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with pytest.raises(Exception) as err:
        contract.status_of(999)
    assert "no task with that id" in str(err.value)


# ---------------------------------------------------------------- submitting


def _claimed(contract, direct_vm, alice, bob):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, alice)
    direct_vm.sender = bob
    contract.claim(task_id)
    return task_id


def test_a_passing_submission_is_paid(contract, direct_vm, direct_alice, direct_bob):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    status = contract.submit(task_id, URL_B)

    assert status == "paid"
    assert contract.status_of(task_id) == "paid"
    assert len(contract.content_hash_of(task_id)) == 64
    assert int(contract.reputation_of(direct_bob)) == 1


def test_a_failing_test_is_rejected_and_the_claim_survives(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm, passed=False, reason="bags still against the wall")

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    status = contract.submit(task_id, URL_B)

    assert status == "rejected"
    # The claim is still theirs, so they can retake without losing the task.
    assert contract.claimed_by(task_id) == direct_bob
    assert "bags still" in contract.reason_of(task_id)


def test_a_grader_that_cannot_see_refuses_instead_of_guessing(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    # A text-only model answering confidently about images it never received.
    graded(direct_vm, saw=False, code=True, place=True, passed=True)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    status = contract.submit(task_id, URL_B)

    assert status == "rejected"
    assert "could not see" in contract.reason_of(task_id)


def test_a_too_small_photograph_never_reaches_the_model(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2, w=200, h=150)))
    graded(direct_vm)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    status = contract.submit(task_id, URL_B)

    assert status == "rejected"
    assert "too small" in contract.reason_of(task_id)


def test_a_dark_photograph_is_refused_with_advice(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2, shade=4)))
    graded(direct_vm)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    status = contract.submit(task_id, URL_B)

    assert status == "rejected"
    assert "too dark" in contract.reason_of(task_id)


def test_only_the_claimant_may_submit(contract, direct_vm, direct_alice, direct_bob, direct_charlie):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.submit(task_id, URL_B)
    assert "not yours" in str(err.value)


def test_handing_back_the_posters_photograph_is_refused(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.submit(task_id, URL_A)
    assert "poster" in str(err.value)


def test_a_url_outside_content_addressed_storage_is_refused(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.submit(task_id, "https://example.com/after.jpg")
    assert "content addressed" in str(err.value)


def test_http_urls_are_refused(contract, direct_vm, direct_alice, direct_bob):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.submit(task_id, f"http://ipfs.io/ipfs/{CID_B}")
    assert "https" in str(err.value)


def test_a_rejection_records_which_judgement_failed(
    contract, direct_vm, direct_alice, direct_bob
):
    """The point of storing them: a rejected receipt has to say WHAT failed.

    "The code was not legible" means retake it. "The test did not pass" means
    the work is not done. Collapsing both into "rejected" wastes a trip."""
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm, code=True, place=True, passed=False, reason="bags still there")

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.submit(task_id, URL_B) == "rejected"

    judged = json.loads(contract.judgements_of(task_id))
    assert judged["code_visible"] is True
    assert judged["same_place"] is True
    assert judged["test_passed"] is False
    assert judged["graded_at"] != ""


def test_nothing_is_recorded_before_a_grading(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)
    assert contract.judgements_of(task_id) == ""


def test_a_paid_task_records_all_three(
    contract, direct_vm, direct_alice, direct_bob
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.submit(task_id, URL_B) == "paid"

    judged = json.loads(contract.judgements_of(task_id))
    assert all(judged[k] for k in ("code_visible", "same_place", "test_passed"))


def test_a_reuse_rejection_still_records_the_photograph(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    """A receipt with a verdict and no photograph is a broken image.

    This path refuses before the vision call, so it used to return without
    storing after_url at all - unlike every other rejection."""
    # First task: pay it, so its CID lands in seen_cids.
    first = _claimed(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.submit(first, URL_B) == "paid"

    # Second task: submit the same photograph.
    gradeable(direct_vm, True)
    second = post(contract, direct_vm, direct_alice, before=URL_C)
    direct_vm.sender = direct_charlie
    contract.claim(second)
    direct_vm.value = 0
    assert contract.submit(second, URL_B) == "rejected"

    assert "already used" in contract.reason_of(second)
    assert contract.after_url_of(second) == URL_B, (
        "the rejected photograph must be on the task, or its receipt has "
        "a verdict and nothing to show for it"
    )


# ---------------------------------------------------------------- abandonment


def test_a_rejected_task_returns_to_the_pool_when_the_claim_runs_out(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    """The bug this guards: a rejection leaves the claim with its owner so they
    can retake. A worker who is rejected and then walks away used to leave the
    task stuck in `rejected` for ever - unclaimable by anyone, reward locked."""
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm, passed=False, reason="bags still against the wall")

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.submit(task_id, URL_B) == "rejected"

    # ... and the worker never comes back. The claim window runs out.
    direct_vm.datetime = "2099-01-01T00:00:00"

    direct_vm.sender = direct_charlie
    code = contract.claim(task_id)

    assert len(code) == 6
    assert contract.status_of(task_id) == "claimed"
    assert contract.claimed_by(task_id) == direct_charlie


def test_release_expired_frees_a_rejected_task_too(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm, passed=False)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.submit(task_id, URL_B)

    direct_vm.datetime = "2099-01-01T00:00:00"

    # Anyone may do this, not just the poster or the worker.
    direct_vm.sender = direct_charlie
    assert contract.release_expired(task_id) == "open"
    assert contract.challenge_code_of(task_id) == ""
    assert contract.reason_of(task_id) == ""


def test_a_live_claim_cannot_be_taken_from_the_worker(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception) as err:
        contract.release_expired(task_id)
    assert "not expired" in str(err.value)


# ---------------------------------------------------------------- money


def test_overpaying_is_banked_rather_than_lost(contract, direct_vm, direct_alice):
    """The bug this guards: post_task accepted `value >= reward + fee` and did
    nothing with the excess. Nothing refunded it and nothing could withdraw it,
    so it was locked in the contract for ever."""
    gradeable(direct_vm, True)
    reward = 18
    owed = reward * GEN + reward * GEN * FEE_BPS // 10000
    extra = 5 * GEN

    direct_vm.sender = direct_alice
    direct_vm.value = owed + extra
    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    contract.post_task(
        GOOD["title"], GOOD["place"], GOOD["test"], GOOD["pass"], GOOD["fail"],
        URL_A, 51505100, -122600, reward * GEN, 0, "", 0, 0,
    )

    # The fee for this task, plus every wei of the overpayment.
    expected = reward * GEN * FEE_BPS // 10000 + extra
    assert int(contract.fees_accrued_value()) == expected


# ---------------------------------------------------------------- lifecycle


def test_poster_can_cancel_an_open_task(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_alice
    assert contract.cancel_task(task_id) == "cancelled"
    assert contract.status_of(task_id) == "cancelled"


def test_a_stranger_cannot_cancel(contract, direct_vm, direct_alice, direct_bob):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.cancel_task(task_id)
    assert "only the poster" in str(err.value)


def test_only_owner_withdraws_fees(contract, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.withdraw_fees(direct_bob)
    assert "only owner" in str(err.value)


def test_task_json_round_trips(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice)

    row = json.loads(contract.task_json(task_id))
    assert row["title"] == GOOD["title"]
    assert row["status"] == "open"
    assert row["reward"] == str(18 * GEN)
    assert row["lat_e6"] == 51505100
    # Latitude and longitude must survive as signed values.
    assert row["lng_e6"] == -122600


def re_escape(url: str) -> str:
    import re

    return re.escape(url)


# ---------------------------------------------------- deadlines and expiry
#
# A funded task used to have no deadline of its own. The reward sat in the
# contract from the moment of posting until the poster personally cancelled,
# and release_expired only ever recycled a *claim*, never the task, so a poster
# who posted and walked away locked the money for good and left an undoable job
# on the map beside it. Everything below is that hole, and the ways of getting
# the fix wrong that a review of it turned up.


DEADLINE_MINUTES = 24 * 60


def _minus_minutes(stamp: str, minutes: int) -> str:
    import datetime as _dt

    base = _dt.datetime.fromisoformat(stamp)
    return (base - _dt.timedelta(minutes=minutes)).isoformat()[:19]


def test_a_task_with_no_deadline_can_never_be_expired(
    contract, direct_vm, direct_alice, direct_bob
):
    """The one that hands a task to a stranger for nothing.

    "" is the no-deadline sentinel and every real timestamp sorts above "" in
    Python, so a deadline check written the obvious way is True for every
    deadline-free task the instant it is posted. Written that way, any passer by
    could close a task nobody meant to close, across the whole contract at once.
    """
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=0)

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "no deadline" in str(err.value)
    assert contract.status_of(task_id) == "open"


def test_anyone_can_close_a_task_whose_deadline_passed(
    contract, direct_vm, direct_alice, direct_bob
):
    """The milestone itself. Not the poster, anyone."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    assert contract.open_until_of(task_id) != ""

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.expire_task(task_id) == "expired"
    assert contract.status_of(task_id) == "expired"


def test_a_task_cannot_be_closed_before_its_deadline(
    contract, direct_vm, direct_alice, direct_bob
):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "open until" in str(err.value)
    assert contract.status_of(task_id) == "open"


def test_closing_a_task_twice_is_refused(
    contract, direct_vm, direct_alice, direct_bob
):
    """The double refund. The status is written before the payment and checked
    against a positive allow-list, so a second call cannot reach the transfer."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.expire_task(task_id)

    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "open and unclaimed" in str(err.value)
    assert contract.status_of(task_id) == "expired"


def test_a_paid_task_can_never_be_expired(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    """Paying the reward to the worker and then again to the poster, the second
    time out of another task's escrow. A denylist of statuses would let this
    through, so the guard is an allow-list of exactly one."""
    task_id = _claimed(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(re_escape(URL_A), web_ok(photo(1)))
    direct_vm.mock_web(re_escape(URL_B), web_ok(photo(2)))
    graded(direct_vm)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    assert contract.submit(task_id, URL_B) == "paid"

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_charlie
    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "open and unclaimed" in str(err.value)
    assert contract.status_of(task_id) == "paid"


def test_a_cancelled_task_can_never_be_expired(
    contract, direct_vm, direct_alice, direct_bob
):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    assert contract.cancel_task(task_id) == "cancelled"

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "open and unclaimed" in str(err.value)


def test_expiring_a_task_leaves_the_accrued_fees_alone(
    contract, direct_vm, direct_alice, direct_bob
):
    """The fee is banked on a payout and handed back on a withdrawal, never
    both. Accruing it here as well would leave the owner owed money the contract
    does not hold, and withdraw_fees has no balance check to catch it."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    before = int(contract.fees_accrued_value())

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.expire_task(task_id)

    assert int(contract.fees_accrued_value()) == before


def test_a_task_cannot_be_claimed_after_its_deadline(
    contract, direct_vm, direct_alice, direct_bob
):
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.claim(task_id)
    assert "closed to new claims" in str(err.value)
    assert contract.status_of(task_id) == "open"


def test_a_claim_window_never_outlives_the_deadline(
    contract, direct_vm, direct_alice, direct_bob
):
    """The invariant every other method leans on.

    Without it, a worker claiming one second before the deadline with the seven
    day maximum window would hold the task for a week past its close, blocking
    the refund the whole time, because submit checks only claim_expires and
    knows nothing about the task's own deadline. Clamping here means a live
    claim is always inside the deadline, so nothing downstream ever has to
    decide whether to cut a worker off mid-job.
    """
    gradeable(direct_vm, True)
    # A one day deadline against a three day claim window: the window loses.
    task_id = post(
        contract, direct_vm, direct_alice, window=3 * 24 * 60, open_for=DEADLINE_MINUTES
    )
    deadline = contract.open_until_of(task_id)

    direct_vm.sender = direct_bob
    contract.claim(task_id)

    assert contract.claim_expires_of(task_id) == deadline


def test_a_claim_is_refused_when_too_little_time_remains(
    contract, direct_vm, direct_alice, direct_bob
):
    """A window of five minutes is not an offer, it is a trap, which is the same
    reason _clean_claim_minutes has a floor at all."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, window=10, open_for=60)
    deadline = contract.open_until_of(task_id)

    direct_vm.datetime = _minus_minutes(deadline, 5)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception) as err:
        contract.claim(task_id)
    assert "no longer time to reach the place" in str(err.value)


def test_an_abandoned_claim_past_the_deadline_closes_in_one_call(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    """expire_task returns a dead claim to the pool itself before it judges the
    task, so a stranger does not have to send release_expired first and then
    this. Two transactions to recover somebody else's money is a fix nobody
    would bother to use."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    direct_vm.sender = direct_bob
    contract.claim(task_id)
    assert contract.status_of(task_id) == "claimed"

    direct_vm.datetime = "2099-01-01T00:00:00"
    direct_vm.sender = direct_charlie
    direct_vm.value = 0
    assert contract.expire_task(task_id) == "expired"


def test_a_live_claim_is_never_closed_out_from_under_the_worker(
    contract, direct_vm, direct_alice, direct_bob, direct_charlie
):
    """A worker standing at the place with a valid code must not lose the job to
    a stranger's transaction. They cannot: the claim is clamped inside the
    deadline, so a live claim means the deadline has not passed."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    direct_vm.sender = direct_bob
    contract.claim(task_id)

    direct_vm.sender = direct_charlie
    direct_vm.value = 0
    with pytest.raises(Exception) as err:
        contract.expire_task(task_id)
    assert "open and unclaimed" in str(err.value)
    assert contract.status_of(task_id) == "claimed"
    assert contract.claimed_by(task_id) == direct_bob


def test_a_deadline_shorter_than_its_own_claim_window_is_refused(
    contract, direct_vm, direct_alice
):
    """Advertising a window the task cannot honour. Refused at posting, where
    the poster can still fix it, rather than clamped quietly behind them."""
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, window=4 * 60, open_for=2 * 60)
    assert "closes sooner than the claim window" in str(err.value)


def test_an_unusable_deadline_is_refused(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, window=10, open_for=30)
    assert "under an hour" in str(err.value)

    gradeable(direct_vm, True)
    with pytest.raises(Exception) as err:
        post(contract, direct_vm, direct_alice, open_for=400 * 24 * 60)
    assert "at most a year" in str(err.value)


def test_a_deadline_survives_a_return_to_the_pool(
    contract, direct_vm, direct_alice, direct_bob
):
    """Clearing open_until in _return_to_pool reads like tidiness and is the
    whole bug back: the task would go into the pool immortal, unexpirable, its
    reward locked exactly as it was before this existed."""
    gradeable(direct_vm, True)
    task_id = post(contract, direct_vm, direct_alice, window=10, open_for=DEADLINE_MINUTES)
    deadline = contract.open_until_of(task_id)

    direct_vm.sender = direct_bob
    contract.claim(task_id)
    # Past the claim window, still inside the task's own deadline.
    direct_vm.datetime = _minus_minutes(deadline, 60)
    direct_vm.value = 0
    contract.release_expired(task_id)

    assert contract.status_of(task_id) == "open"
    assert contract.open_until_of(task_id) == deadline


def test_task_json_carries_the_deadline(contract, direct_vm, direct_alice):
    gradeable(direct_vm, True)
    with_deadline = post(contract, direct_vm, direct_alice, open_for=DEADLINE_MINUTES)
    gradeable(direct_vm, True)
    without = post(contract, direct_vm, direct_alice, before=URL_C, open_for=0)

    assert json.loads(contract.task_json(with_deadline))["open_until"] != ""
    # Empty, never absent. A missing key becomes NaN on the site, and NaN loses
    # every comparison it is in, so a closed task would read as open on screen.
    assert json.loads(contract.task_json(without))["open_until"] == ""
