"""DFS CMR repair marketplace — Phase 1 behavior (spec v0.4 §3–§9)."""

from __future__ import annotations

import asyncio
import re
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlmodel import select

from tests.marketplace.conftest import bearer

pytestmark = pytest.mark.asyncio


# ─────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────
async def submit(client, user, van, offers, total, **extra):
    body = {
        "vehicle_id": van.id_str,
        "lines": [{"offer_id": o.id_str} for o in offers],
        "total": str(total),
        **extra,
    }
    return await client.post("/marketplace/quotes", json=body, headers=bearer(user))


def review_token_from(outbox) -> str:
    for msg in reversed(outbox):
        m = re.search(r"/marketplace/review\?t=([A-Za-z0-9_-]{43})", msg.text)
        if m:
            return m.group(1)
    raise AssertionError("no review link in outbox")


def rt(token: str) -> dict:
    return {"X-Review-Token": token}


async def state_of(maker, model, id_):
    async with maker() as s:
        row = (await s.execute(select(model).where(model.id == id_))).scalar_one()
        return row


# ─────────────────────────────────────────────────────
# §3 rules + eligibility
# ─────────────────────────────────────────────────────
async def test_rule_seed_matches_spec_and_migration(db):
    from app.models.marketplace import MarketplaceRule
    from app.services.marketplace.rules import seed_rows

    rows = (await db.execute(select(MarketplaceRule))).scalars().all()
    got = {r.part: (r.category, sorted(r.defect_types), r.specialty.value) for r in rows}
    want = {
        r["part"]: (r["category"], sorted(r["defect_types"]), r["specialty"]) for r in seed_rows()
    }
    assert got == want
    assert len(got) == 27


async def test_eligibility_rules(db):
    from app.services.marketplace.eligibility import is_rule_eligible
    from app.services.marketplace.rules import active_rules_by_part

    rules = await active_rules_by_part(db)
    # Lights: damage is in, "doesn't light up" is AMR (Amazon-paid) → out.
    assert is_rule_eligible(rules, "tail_light", "cracked")
    assert is_rule_eligible(rules, "headlight", "cover_missing")
    assert not is_rule_eligible(rules, "headlight", "not_working")
    assert not is_rule_eligible(rules, "tail_light", "flickering")
    assert not is_rule_eligible(rules, "turn_signal", "intermittent")
    # Glass
    assert is_rule_eligible(rules, "windshield", "cracked")
    assert is_rule_eligible(rules, "window", "broken")
    # Body damage: every type.
    assert is_rule_eligible(rules, "body_damage", "scratch")
    assert is_rule_eligible(rules, "body_damage", "anything_new")
    # Panels: physical damage only.
    assert is_rule_eligible(rules, "bumper", "dent")
    assert not is_rule_eligible(rules, "bumper", "not_working")
    # Steps / mirrors
    assert is_rule_eligible(rules, "side_step", "bent")
    assert is_rule_eligible(rules, "side_mirror", "mount_damaged")
    # Pilot items explicitly out (warning lamp, undercarriage) and mechanical parts.
    assert not is_rule_eligible(rules, "warning_lamp", "on_or_flashing")
    assert not is_rule_eligible(rules, "undercarriage", "hanging")
    assert not is_rule_eligible(rules, "tire", "low_tread")


async def test_sync_creates_offers_idempotent_and_dedupes_nightly_reports(scenario, world, db):
    from app.models.marketplace import MarketplaceOffer
    from app.services.marketplace.eligibility import sync_offers

    offers = scenario["offers"]
    assert set(offers) == {"tail_light", "side_mirror", "bumper"}  # headlight not_working is out
    assert offers["tail_light"].station == "DDC4"
    assert offers["bumper"].specialty.value == "body"
    assert offers["side_mirror"].specialty.value == "general"

    # Re-run: nothing new.
    again = await sync_offers(db)
    await db.commit()
    assert again.created == [] and again.withdrawn == []

    # Next night the inspector reports the same cracked tail light again → no 2nd offer.
    night2 = await world.inspection(scenario["van"], scenario["owner"])
    await world.defect(
        scenario["van"],
        scenario["owner"],
        "tail_light",
        "cracked",
        position="rear_left",
        inspection=night2,
    )
    third = await sync_offers(db)
    await db.commit()
    assert third.created == []
    count = len((await db.execute(select(MarketplaceOffer))).scalars().all())
    assert count == 3


async def test_defect_on_active_work_order_is_not_offered(world, db):
    from app.models.work_orders import (
        RepairRequest,
        RepairRequestDefect,
        RepairType,
        StatusTrackingMode,
        VendorWorkshop,
        WorkOrder,
        WorkOrderStatus,
    )
    from app.services.marketplace.eligibility import sync_offers

    dsp = await world.org("DSP X", "dsp")
    owner = await world.user(dsp, "dsp_owner")
    van = await world.vehicle(dsp)
    d = await world.defect(van, owner, "windshield", "cracked")
    vendor = await world.org("Shop", "vendor")
    ws = VendorWorkshop(
        name="Shop",
        organization_id=vendor.id,
        status_tracking_mode=StatusTrackingMode.INTERNAL,
        repair_types=["body"],
    )
    rr = RepairRequest(vehicle_id=van.id, dsp_id=dsp.id, repair_type=RepairType.BODY)
    db.add_all([ws, rr])
    await db.flush()
    db.add(RepairRequestDefect(repair_request_id=rr.id, defect_id=d.id))
    db.add(
        WorkOrder(
            repair_request_id=rr.id,
            vehicle_id=van.id,
            vendor_workshop_id=ws.id,
            dsp_id=dsp.id,
            status=WorkOrderStatus.ACCEPTED,
            status_tracking_mode=StatusTrackingMode.INTERNAL,
        )
    )
    await db.commit()

    result = await sync_offers(db)
    assert result.created == []


# ─────────────────────────────────────────────────────
# §4 shop side
# ─────────────────────────────────────────────────────
async def test_board_masks_dsp_and_filters_by_specialty(client, scenario):
    r = await client.get("/marketplace/board", headers=bearer(scenario["admin_a"]))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["shop"]["specialties"] == ["general"]
    (van,) = data["vans"]
    assert van["station"] == "DDC4"
    assert van["vehicle"]["vin"] == scenario["van"].vin
    # DSP identity + internal identifiers hidden before approval.
    assert van["vehicle"]["fleet_id"] is None and van["vehicle"]["plate"] is None
    assert "Safety First" not in r.text
    labels = {o["part"] for o in van["offers"]}
    assert labels == {"tail_light", "side_mirror"}  # general shop: no bumper
    tail = next(o for o in van["offers"] if o["part"] == "tail_light")
    assert tail["notes"] == "Lens cracked, bulb works"
    assert len(tail["photos"]) == 1 and tail["photos"][0]["url"].startswith("http")

    body = await client.get("/marketplace/board", headers=bearer(scenario["admin_body"]))
    assert {o["part"] for o in body.json()["vans"][0]["offers"]} == {"bumper"}


async def test_several_shops_quote_same_van_and_never_see_each_other(client, scenario, outbox):
    o = scenario["offers"]
    ra = await submit(
        client,
        scenario["admin_a"],
        scenario["van"],
        [o["tail_light"]],
        "180.00",
        reply_to_email="quotes@chemas.com",
    )
    rb = await submit(
        client, scenario["admin_b"], scenario["van"], [o["tail_light"], o["side_mirror"]], "320.00"
    )
    assert ra.status_code == 201, ra.text
    assert rb.status_code == 201, rb.text
    qa, qb = ra.json(), rb.json()
    assert qa["fee_amount"] == "18.00" and qa["shop_keeps"] == "162.00"
    assert qb["fee_amount"] == "32.00"
    assert qa["dsp"] is None

    # Each shop sees only its own quote — on the board and in /quotes.
    board_a = (await client.get("/marketplace/board", headers=bearer(scenario["admin_a"]))).json()
    assert board_a["vans"][0]["my_quote"]["id"] == qa["id"]
    assert "320" not in str(board_a)
    mine_a = (await client.get("/marketplace/quotes", headers=bearer(scenario["admin_a"]))).json()
    assert [q["id"] for q in mine_a] == [qa["id"]]
    # Touching the other shop's quote looks like it doesn't exist.
    r = await client.post(
        f"/marketplace/quotes/{qb['id']}/withdraw", headers=bearer(scenario["admin_a"])
    )
    assert r.status_code == 404

    # One live quote per shop per van.
    dup = await submit(client, scenario["admin_a"], scenario["van"], [o["side_mirror"]], "90")
    assert dup.status_code == 409

    # The DSP got one email per quote.
    dsp_mails = [m for m in outbox if m.to == "owner@safetyfirst.com"]
    assert len(dsp_mails) == 2


async def test_shop_cannot_quote_outside_specialty(client, scenario):
    r = await submit(
        client, scenario["admin_a"], scenario["van"], [scenario["offers"]["bumper"]], 500
    )
    assert r.status_code == 404


async def test_technician_cannot_quote(client, scenario, world):
    tech = await world.user(scenario["shop_a"], "technician")
    r = await submit(client, tech, scenario["van"], [scenario["offers"]["tail_light"]], 100)
    assert r.status_code == 403


async def test_shop_withdraw(client, scenario):
    q = (
        await submit(
            client, scenario["admin_a"], scenario["van"], [scenario["offers"]["tail_light"]], 100
        )
    ).json()
    r = await client.post(
        f"/marketplace/quotes/{q['id']}/withdraw", headers=bearer(scenario["admin_a"])
    )
    assert r.status_code == 200 and r.json()["state"] == "withdrawn"
    again = await submit(
        client, scenario["admin_a"], scenario["van"], [scenario["offers"]["tail_light"]], 95
    )
    assert again.status_code == 201


# ─────────────────────────────────────────────────────
# §9 DSP token page + decisions
# ─────────────────────────────────────────────────────
async def test_review_page_lists_live_quotes_side_by_side(client, scenario, outbox):
    o = scenario["offers"]
    await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 180)
    await submit(client, scenario["admin_b"], scenario["van"], [o["tail_light"]], 150)
    token = review_token_from(outbox)
    r = await client.get("/marketplace/review", headers=rt(token))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["dsp_name"] == "Safety First LLC"
    assert data["vehicle"]["fleet_id"] == "PR006"
    assert [q["shop_name"] for q in data["live_quotes"]] == ["Dulles Midas", "Chemas Autohaus"]
    # Both quote emails carry the SAME link (one token per DSP per van).
    links = {
        re.search(r"t=([A-Za-z0-9_-]{43})", m.text).group(1)
        for m in outbox
        if m.to == "owner@safetyfirst.com"
    }
    assert links == {token}


async def test_approval_awards_marks_overlaps_not_selected_records_fee(
    client, scenario, outbox, maker
):
    from app.models.marketplace import MarketplaceOffer, MarketplaceQuote
    from app.models.work_orders import RepairRequestDefect, WorkOrder

    o = scenario["offers"]
    qa = (
        await submit(
            client,
            scenario["admin_a"],
            scenario["van"],
            [o["tail_light"], o["side_mirror"]],
            "300.00",
        )
    ).json()
    qb = (
        await submit(client, scenario["admin_b"], scenario["van"], [o["tail_light"]], "120")
    ).json()
    qbody = (
        await submit(client, scenario["admin_body"], scenario["van"], [o["bumper"]], "650")
    ).json()
    token = review_token_from(outbox)
    outbox.clear()

    r = await client.post(
        f"/marketplace/review/quotes/{qa['id']}/approve",
        json={"note": "Go ahead, Friday works"},
        headers=rt(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "approved"
    assert r.json()["work_ref"].startswith("WO-")

    a = await state_of(maker, MarketplaceQuote, int(qa["id"][3:]))
    assert a.state.value == "approved"
    assert a.fee_status.value == "owed" and a.fee_amount == Decimal("30.00")
    assert a.decision_note == "Go ahead, Friday works" and a.decided_at is not None
    b = await state_of(maker, MarketplaceQuote, int(qb["id"][3:]))
    assert b.state.value == "not_selected"  # overlapped on the tail light
    body_q = await state_of(maker, MarketplaceQuote, int(qbody["id"][3:]))
    assert body_q.state.value == "submitted"  # no shared defect → still alive
    for part in ("tail_light", "side_mirror"):
        off = await state_of(maker, MarketplaceOffer, o[part].id)
        assert off.state.value == "awarded" and off.awarded_quote_id == a.id

    # Work for a `vendor` shop is an RR + WO on its workshop, pending acceptance.
    wo = await state_of(maker, WorkOrder, a.work_order_id)
    assert wo.status.value == "pending_acceptance"
    async with maker() as s:
        linked = set(
            (
                await s.execute(
                    select(RepairRequestDefect.defect_id).where(
                        RepairRequestDefect.repair_request_id == wo.repair_request_id
                    )
                )
            )
            .scalars()
            .all()
        )
    assert linked == {scenario["defects"]["tail"].id, scenario["defects"]["mirror"].id}

    # Winner + loser are notified; the token page still works (bumper is open).
    subjects = {(m.to, m.subject.split(":")[0]) for m in outbox}
    assert ("chema@chemas.com", "Approved") in subjects
    assert any(m.to == "olger@midas.com" and "not selected" in m.subject for m in outbox)
    page = await client.get("/marketplace/review", headers=rt(token))
    assert page.status_code == 200
    assert [q["id"] for q in page.json()["live_quotes"]] == [qbody["id"]]


async def test_concurrent_approvals_of_overlapping_quotes_only_one_wins(
    client, scenario, outbox, maker
):
    from app.models.marketplace import MarketplaceQuote

    o = scenario["offers"]
    qa = (await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 100)).json()
    qb = (
        await submit(
            client, scenario["admin_b"], scenario["van"], [o["tail_light"], o["side_mirror"]], 200
        )
    ).json()
    token = review_token_from(outbox)

    ra, rb = await asyncio.gather(
        client.post(f"/marketplace/review/quotes/{qa['id']}/approve", json={}, headers=rt(token)),
        client.post(f"/marketplace/review/quotes/{qb['id']}/approve", json={}, headers=rt(token)),
    )
    codes = sorted([ra.status_code, rb.status_code])
    assert codes == [200, 409], (ra.text, rb.text)
    a = await state_of(maker, MarketplaceQuote, int(qa["id"][3:]))
    b = await state_of(maker, MarketplaceQuote, int(qb["id"][3:]))
    assert sorted([a.state.value, b.state.value]) == ["approved", "not_selected"]


async def test_concurrent_approvals_at_service_level(scenario, maker, client, outbox):
    """Same race straight against the service with two DB sessions."""
    from app.services.marketplace.quotes import QuoteError, approve_quote
    from app.services.marketplace.review_tokens import resolve_review_token

    o = scenario["offers"]
    qa = (await submit(client, scenario["admin_a"], scenario["van"], [o["side_mirror"]], 80)).json()
    qb = (await submit(client, scenario["admin_b"], scenario["van"], [o["side_mirror"]], 70)).json()
    token = review_token_from(outbox)

    async def approve(quote_id: str):
        async with maker() as s:
            tok = await resolve_review_token(s, token)
            try:
                await approve_quote(s, tok, int(quote_id[3:]), note=None)
                await asyncio.sleep(0.2)  # hold the locks a moment
                await s.commit()
                return "won"
            except QuoteError as exc:
                await s.rollback()
                return exc.status_code

    results = await asyncio.gather(approve(qa["id"]), approve(qb["id"]))
    assert sorted(results, key=str) == sorted(["won", 409], key=str)


async def test_reject_then_requote_and_no_quote_after_award(client, scenario, outbox):
    o = scenario["offers"]
    qa = (await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 300)).json()
    token = review_token_from(outbox)
    r = await client.post(
        f"/marketplace/review/quotes/{qa['id']}/reject",
        json={"reason": "Too expensive"},
        headers=rt(token),
    )
    assert r.status_code == 200 and r.json()["state"] == "rejected"
    assert any("not accepted" in m.subject and "Too expensive" in m.text for m in outbox)
    # Reject needs a reason.
    assert (
        await client.post(
            f"/marketplace/review/quotes/{qa['id']}/reject", json={}, headers=rt(token)
        )
    ).status_code == 422

    # Rejected shop may quote again while the offer is open.
    again = await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 210)
    assert again.status_code == 201, again.text

    # Another shop wins it → nobody can quote that defect any more.
    qb = (await submit(client, scenario["admin_b"], scenario["van"], [o["tail_light"]], 190)).json()
    ok = await client.post(
        f"/marketplace/review/quotes/{qb['id']}/approve", json={}, headers=rt(token)
    )
    assert ok.status_code == 200
    late = await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 150)
    assert late.status_code == 409
    assert "awarded" in late.json()["detail"]
    # …and the awarded offer is gone from every board.
    board = (await client.get("/marketplace/board", headers=bearer(scenario["admin_a"]))).json()
    parts = {of["part"] for v in board["vans"] for of in v["offers"]}
    assert "tail_light" not in parts


async def test_ask_for_lower_price_then_revise(client, scenario, outbox):
    o = scenario["offers"]
    q = (await submit(client, scenario["admin_a"], scenario["van"], [o["side_mirror"]], 400)).json()
    token = review_token_from(outbox)
    r = await client.post(
        f"/marketplace/review/quotes/{q['id']}/request-revision",
        json={"note": "Can you do 300?"},
        headers=rt(token),
    )
    assert r.status_code == 200 and r.json()["state"] == "revision_requested"
    # The DSP can't approve while a revision is pending (spec: approve from submitted).
    blocked = await client.post(
        f"/marketplace/review/quotes/{q['id']}/approve", json={}, headers=rt(token)
    )
    assert blocked.status_code == 409

    outbox.clear()
    rev = await client.post(
        f"/marketplace/quotes/{q['id']}/revise",
        json={"total": "320.00"},
        headers=bearer(scenario["admin_a"]),
    )
    assert rev.status_code == 200, rev.text
    assert rev.json()["state"] == "submitted" and rev.json()["revision"] == 2
    assert rev.json()["fee_amount"] == "32.00"
    assert any(m.subject.startswith("Revised quote") for m in outbox)

    # Stale page (revision 1) can't approve the new price blindly.
    stale = await client.post(
        f"/marketplace/review/quotes/{q['id']}/approve",
        json={"expected_revision": 1},
        headers=rt(token),
    )
    assert stale.status_code == 409
    ok = await client.post(
        f"/marketplace/review/quotes/{q['id']}/approve",
        json={"expected_revision": 2},
        headers=rt(token),
    )
    assert ok.status_code == 200


async def test_dsp_masked_before_approval_revealed_after(client, scenario, outbox):
    o = scenario["offers"]
    win = (
        await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 100)
    ).json()
    lose = (
        await submit(client, scenario["admin_b"], scenario["van"], [o["tail_light"]], 120)
    ).json()
    assert win["dsp"] is None and win["vehicle"]["fleet_id"] is None
    token = review_token_from(outbox)
    await client.post(f"/marketplace/review/quotes/{win['id']}/approve", json={}, headers=rt(token))

    mine = (await client.get("/marketplace/quotes", headers=bearer(scenario["admin_a"]))).json()
    (w,) = mine
    assert w["dsp"] == {"name": "Safety First LLC", "phone": "703-555-0100", "address": None}
    assert w["vehicle"]["fleet_id"] == "PR006"
    assert w["work_ref"].startswith("WO-")

    theirs = (await client.get("/marketplace/quotes", headers=bearer(scenario["admin_b"]))).json()
    (l_,) = theirs
    assert l_["id"] == lose["id"] and l_["state"] == "not_selected"
    assert l_["dsp"] is None and l_["vehicle"]["fleet_id"] is None
    assert "Safety First" not in str(theirs)


async def test_review_token_rejects_bad_and_used_up_tokens(client, scenario, outbox):
    o = scenario["offers"]
    assert (await client.get("/marketplace/review")).status_code == 404
    assert (await client.get("/marketplace/review", headers=rt("garbage"))).status_code == 404
    assert (await client.get("/marketplace/review", headers=rt("A" * 43))).status_code == 404

    qa = (
        await submit(
            client, scenario["admin_a"], scenario["van"], [o["tail_light"], o["side_mirror"]], 250
        )
    ).json()
    qbody = (
        await submit(client, scenario["admin_body"], scenario["van"], [o["bumper"]], 600)
    ).json()
    token = review_token_from(outbox)
    assert (
        await client.post(
            f"/marketplace/review/quotes/{qa['id']}/approve", json={}, headers=rt(token)
        )
    ).status_code == 200
    last = await client.post(
        f"/marketplace/review/quotes/{qbody['id']}/approve", json={}, headers=rt(token)
    )
    assert last.status_code == 200
    assert last.json()["token_used_up"] is True
    # Every offer on the van is decided → the link is used up.
    assert (await client.get("/marketplace/review", headers=rt(token))).status_code == 410
    assert (
        await client.post(
            f"/marketplace/review/quotes/{qa['id']}/reject", json={"reason": "x"}, headers=rt(token)
        )
    ).status_code == 410


async def test_token_cannot_touch_another_vans_quote(client, scenario, world, outbox):
    o = scenario["offers"]
    van2 = await world.vehicle(scenario["dsp"])
    await world.defect(van2, scenario["owner"], "side_step", "bent")
    from app.services.marketplace.eligibility import sync_offers

    async with world.s as s:
        res = await sync_offers(s)
        await s.commit()
    step = res.created[0]
    q2 = (await submit(client, scenario["admin_a"], van2, [step], 75)).json()
    await submit(client, scenario["admin_a"], scenario["van"], [o["tail_light"]], 100)
    token_van1 = review_token_from(outbox)
    r = await client.post(
        f"/marketplace/review/quotes/{q2['id']}/approve", json={}, headers=rt(token_van1)
    )
    assert r.status_code == 404


# ─────────────────────────────────────────────────────
# Collision with Nova Fora routing (§4)
# ─────────────────────────────────────────────────────
async def test_offer_withdrawn_when_router_creates_wo(client, scenario, outbox, maker):
    from app.models.marketplace import MarketplaceOffer, MarketplaceQuote
    from app.models.work_orders import (
        RepairRequest,
        RepairRequestDefect,
        RepairType,
        StatusTrackingMode,
        VendorWorkshop,
    )
    from app.services.wo_router import route_repair_request

    o = scenario["offers"]
    q = (
        await submit(
            client, scenario["admin_a"], scenario["van"], [o["tail_light"], o["side_mirror"]], 200
        )
    ).json()
    outbox.clear()

    async with maker() as s:
        s.add(
            VendorWorkshop(
                name="Router Shop",
                status_tracking_mode=StatusTrackingMode.INTERNAL,
                repair_types=["mechanical"],
            )
        )
        rr = RepairRequest(
            vehicle_id=scenario["van"].id,
            dsp_id=scenario["dsp"].id,
            repair_type=RepairType.MECHANICAL,
        )
        s.add(rr)
        await s.flush()
        s.add(
            RepairRequestDefect(repair_request_id=rr.id, defect_id=scenario["defects"]["tail"].id)
        )
        await s.flush()
        wo = await route_repair_request(s, repair_request_id=rr.id)
        assert wo is not None
        await s.commit()

    tail = await state_of(maker, MarketplaceOffer, o["tail_light"].id)
    assert tail.state.value == "withdrawn" and tail.withdrawn_reason == "routed_to_work_order"
    mirror = await state_of(maker, MarketplaceOffer, o["side_mirror"].id)
    assert mirror.state.value == "open"
    closed = await state_of(maker, MarketplaceQuote, int(q["id"][3:]))
    assert closed.state.value == "withdrawn" and closed.closed_reason == "offer_withdrawn"
    assert any(m.to == "chema@chemas.com" and "closed" in m.subject for m in outbox)

    # The shop can re-quote what's still open.
    again = await submit(client, scenario["admin_a"], scenario["van"], [o["side_mirror"]], 90)
    assert again.status_code == 201


# ─────────────────────────────────────────────────────
# Work creation
# ─────────────────────────────────────────────────────
async def test_body_repair_vendor_award_goes_to_body_repair_flow(client, scenario, outbox, maker):
    from app.models.body_repair import BodyRepairQuote, BodyRepairRequest
    from app.models.marketplace import MarketplaceQuote

    q = (
        await submit(
            client,
            scenario["admin_body"],
            scenario["van"],
            [scenario["offers"]["bumper"]],
            "650.00",
        )
    ).json()
    token = review_token_from(outbox)
    r = await client.post(
        f"/marketplace/review/quotes/{q['id']}/approve", json={}, headers=rt(token)
    )
    assert r.status_code == 200 and r.json()["work_ref"].startswith("BRR-")
    mq = await state_of(maker, MarketplaceQuote, int(q["id"][3:]))
    req = await state_of(maker, BodyRepairRequest, mq.body_repair_request_id)
    assert req.status.value == "quote_selected"
    assert req.assigned_vendor_id == scenario["body"].id
    assert req.approved_list_cents == 65000
    brq = await state_of(maker, BodyRepairQuote, req.selected_quote_id)
    assert brq.status.value == "selected" and brq.list_cents == 65000
    assert brq.platform_fee_cents == 0  # the DSP pays the shop's price, no markup
    assert mq.work_order_id is None


# ─────────────────────────────────────────────────────
# §9 email headers
# ─────────────────────────────────────────────────────
async def test_dsp_quote_email_from_name_and_reply_to(client, scenario, outbox, monkeypatch):
    from app.services import email as email_service
    from app.services.email import _build_mime

    r = await submit(
        client,
        scenario["admin_a"],
        scenario["van"],
        [scenario["offers"]["tail_light"]],
        180,
        reply_to_email="quotes@chemas.com",
    )
    assert r.status_code == 201
    (msg,) = [m for m in outbox if m.to == "owner@safetyfirst.com"]
    mime = _build_mime(msg, "Nova Fora <jescalona@dantzigfleets.com>")
    assert mime["From"] == "Chemas Autohaus via DFS <jescalona@dantzigfleets.com>"
    assert mime["Reply-To"] == "quotes@chemas.com"
    assert mime["To"] == "owner@safetyfirst.com"
    for label in (
        "Approve this quote",
        "Reject",
        "Ask for lower price",
        "Compare all quotes for this van",
    ):
        assert label in msg.html
    for action in ("approve", "reject", "revise", "compare"):
        assert f"action={action}" in msg.html

    # Through the real SMTP path, with a fake server.
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            pass

        def starttls(self):
            pass

        def login(self, u, p):
            pass

        def send_message(self, m):
            sent.append(m)

        def quit(self):
            pass

    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(
        email_service,
        "get_settings",
        lambda: type(
            "S",
            (),
            {
                "gmail_client_id": "",
                "gmail_client_secret": "",
                "gmail_refresh_token": "",
                "gmail_sender": "",
                "smtp_host": "smtp.gmail.com",
                "smtp_port": 587,
                "smtp_user": "u",
                "smtp_password": "p",
                "smtp_use_tls": True,
                "smtp_from": "Nova Fora <jescalona@dantzigfleets.com>",
            },
        )(),
    )
    assert email_service.send(msg) is True
    assert sent[0]["From"] == "Chemas Autohaus via DFS <jescalona@dantzigfleets.com>"
    assert sent[0]["Reply-To"] == "quotes@chemas.com"

    # Invitations are unchanged: plain SMTP_FROM, no Reply-To.
    inv = email_service.render_invitation_email(
        invitee_name="X",
        inviter_name="Y",
        org_label="Z",
        role_label="R",
        accept_url="https://a",
        expires_in_days=7,
    )
    inv.to = "x@y.com"
    plain = _build_mime(inv, "Nova Fora <noreply@example.com>")
    assert plain["From"] == "Nova Fora <noreply@example.com>"
    assert plain["Reply-To"] is None


async def test_shop_facing_email_comes_from_dfs_mailbox(client, scenario, outbox):
    from app.services.email import _build_mime

    q = (
        await submit(
            client, scenario["admin_a"], scenario["van"], [scenario["offers"]["tail_light"]], 100
        )
    ).json()
    token = review_token_from(outbox)
    outbox.clear()
    await client.post(
        f"/marketplace/review/quotes/{q['id']}/reject", json={"reason": "no"}, headers=rt(token)
    )
    (msg,) = outbox
    mime = _build_mime(msg, "Nova Fora <jescalona@dantzigfleets.com>")
    assert mime["From"] == "DFS Repair Marketplace <jescalona@dantzigfleets.com>"


# ─────────────────────────────────────────────────────
# §8 prospects
# ─────────────────────────────────────────────────────
async def test_prospect_magic_link_first_quote_accepts_terms_and_invites(
    client, scenario, world, db, outbox, maker
):
    from app.models.invitation import Invitation
    from app.models.marketplace import MarketplaceShopProfile
    from app.services.marketplace.shops import ensure_shop_profile, magic_link_token

    admin = await world.org("Ops", "platform")
    await world.user(admin, "site_admin", email="ops@dfs.com")
    prospect = await world.org("Leesburg Glass", "vendor")
    profile = await ensure_shop_profile(db, prospect)
    profile.contact_email = "info@leesburgglass.com"
    token = await magic_link_token(db, profile)
    await db.commit()
    hdr = {"X-Marketplace-Invite": token}

    board = await client.get("/marketplace/board", headers=hdr)
    assert board.status_code == 200, board.text
    assert board.json()["shop"]["is_prospect"] is True
    assert board.json()["shop"]["onboarding_status"] == "prospect"

    body = {
        "vehicle_id": scenario["van"].id_str,
        "lines": [{"offer_id": scenario["offers"]["tail_light"].id_str}],
        "total": "140",
    }
    # First quote without terms → refused.
    r = await client.post("/marketplace/quotes", json=body, headers=hdr)
    assert r.status_code == 422
    r = await client.post(
        "/marketplace/quotes",
        headers=hdr,
        json={
            **body,
            "account_email": "owner@leesburgglass.com",
            "account_name": "Ana Ruiz",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["reply_to_email"] == "info@leesburgglass.com"

    async with maker() as s:
        p = (
            await s.execute(
                select(MarketplaceShopProfile).where(
                    MarketplaceShopProfile.organization_id == prospect.id
                )
            )
        ).scalar_one()
        assert p.terms_accepted_at is not None and p.onboarding_status.value == "invited"
        inv = (
            await s.execute(select(Invitation).where(Invitation.org_id == prospect.id))
        ).scalar_one()
        assert inv.email == "owner@leesburgglass.com" and inv.role.value == "vendor_admin"
    assert any(
        m.to == "owner@leesburgglass.com" and "/signup/accept?token=" in m.text for m in outbox
    )

    # Bad magic link → 401.
    assert (
        await client.get("/marketplace/board", headers={"X-Marketplace-Invite": "B" * 43})
    ).status_code == 401


# ─────────────────────────────────────────────────────
# §5 daily digest
# ─────────────────────────────────────────────────────
async def test_digest_per_station_specialty_once_and_claude_fallback(
    scenario, world, db, monkeypatch
):
    from app.services import email as email_service
    from app.services.marketplace.digest import run_digest
    from app.services.marketplace.shops import ensure_shop_profile

    prospect = await world.org("Fairfax Body Works", "body_repair_vendor")
    prof = await ensure_shop_profile(db, prospect)
    prof.contact_email = "hello@fairfaxbody.com"
    await db.commit()

    sent = []
    monkeypatch.setattr(email_service, "send", lambda m: sent.append(m) or True)

    calls = []

    async def failing_opener(facts):
        calls.append(facts)
        return None  # Claude unavailable → template alone

    res = await run_digest(db, opener_fn=failing_opener)
    assert res.offers == 3 and res.stations == ["DDC4"]
    by_to = {m.to: m for m in sent}
    # general shops get lights + mirror, body shops get the bumper.
    assert (
        "Taillight" in by_to["chema@chemas.com"].text
        or "tail" in by_to["chema@chemas.com"].text.lower()
    )
    assert "bumper" not in by_to["chema@chemas.com"].text.lower()
    assert "bumper" in by_to["mike@capitalbody.com"].text.lower()
    # Prospect gets a magic link; registered shops get the plain board link.
    assert "/marketplace/board?invite=" in by_to["hello@fairfaxbody.com"].text
    assert "invite=" not in by_to["chema@chemas.com"].text
    # DSP name never appears in a digest.
    assert all("Safety First" not in m.text for m in sent)
    assert "Here are today's new repair opportunities near DDC4" in by_to["chema@chemas.com"].text
    assert res.claude_used == 0 and calls

    # Second run the same day: nothing new.
    sent.clear()
    again = await run_digest(db, opener_fn=failing_opener)
    assert again.offers == 0 and sent == []


async def test_digest_uses_claude_opener_and_rejects_price_talk(scenario, db, monkeypatch):
    from app.services import email as email_service
    from app.services.marketplace.digest import run_digest

    sent = []
    monkeypatch.setattr(email_service, "send", lambda m: sent.append(m) or True)

    async def opener(facts):
        return f"Good morning {facts.shop_name}! Fresh repairs are waiting near {facts.station}."

    res = await run_digest(db, opener_fn=opener)
    assert res.claude_used >= 2
    assert all(m.text.startswith("Good morning") for m in sent)


async def test_claude_opener_guards(monkeypatch):
    from app.services.marketplace import digest

    assert await digest.claude_opener(digest.OpenerFacts("S", "DDC4", 1, 1, ["lights"])) is None
    assert not digest._opener_is_safe("We can do it for $200!")
    assert digest._opener_is_safe("Fresh repairs near DDC4 today.")


async def test_offer_reoffered_only_after_cooldown(scenario, world, db, client, outbox):
    """An awarded physical defect reported again the next night is NOT re-offered."""
    from app.services.marketplace.eligibility import sync_offers

    o = scenario["offers"]
    q = (await submit(client, scenario["admin_a"], scenario["van"], [o["side_mirror"]], 90)).json()
    token = review_token_from(outbox)
    await client.post(f"/marketplace/review/quotes/{q['id']}/approve", json={}, headers=rt(token))
    from app.models.base import utc_now

    night2 = await world.inspection(scenario["van"], scenario["owner"])
    await world.defect(
        scenario["van"],
        scenario["owner"],
        "side_mirror",
        "broken",
        position="driver",
        reported_at=utc_now() + timedelta(minutes=1),
        inspection=night2,
    )
    async with world.s as s:
        res = await sync_offers(s)
        await s.commit()
    assert res.created == []


async def test_gmail_api_transport_keeps_display_name_and_reply_to(
    client, scenario, outbox, monkeypatch
):
    """Spec §9: Gmail API (OAuth refresh token) sends RAW MIME, so From display
    name and Reply-To survive. SMTP is only the fallback."""
    import base64
    import email as pyemail
    import json as _json

    import httpx

    from app.services import email as email_service

    r = await submit(
        client,
        scenario["admin_a"],
        scenario["van"],
        [scenario["offers"]["tail_light"]],
        180,
        reply_to_email="quotes@chemas.com",
    )
    assert r.status_code == 201
    (msg,) = [m for m in outbox if m.to == "owner@safetyfirst.com"]

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == "oauth2.googleapis.com":
            form = dict(x.split("=", 1) for x in request.content.decode().split("&"))
            assert form["grant_type"] == "refresh_token" and form["refresh_token"] == "rt-123"
            return httpx.Response(200, json={"access_token": "at-xyz", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer at-xyz"
        return httpx.Response(200, json={"id": "18c", "threadId": "18c"})

    settings = type(
        "S",
        (),
        {
            "gmail_client_id": "cid",
            "gmail_client_secret": "secret",
            "gmail_refresh_token": "rt-123",
            "gmail_sender": "jescalona@dantzigfleets.com",
            "smtp_host": "smtp.should-not-be-used",
            "smtp_from": "Nova Fora <noreply@example.com>",
        },
    )()
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        email_service, "_gmail_http", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    email_service._gmail_token.clear()

    assert email_service.send(msg) is True
    send_req = calls[-1]
    assert send_req.url.path == "/gmail/v1/users/me/messages/send"
    raw = _json.loads(send_req.content)["raw"]
    mime = pyemail.message_from_bytes(base64.urlsafe_b64decode(raw))
    assert mime["From"] == "Chemas Autohaus via DFS <jescalona@dantzigfleets.com>"
    assert mime["Reply-To"] == "quotes@chemas.com"
    assert mime["To"] == "owner@safetyfirst.com"

    # Invitations through Gmail: Nova Fora display name on the Gmail mailbox, no Reply-To.
    inv = email_service.render_invitation_email(
        invitee_name="X",
        inviter_name="Y",
        org_label="Z",
        role_label="R",
        accept_url="https://a",
        expires_in_days=7,
    )
    inv.to = "x@y.com"
    assert email_service.send(inv) is True
    inv_mime = pyemail.message_from_bytes(
        base64.urlsafe_b64decode(_json.loads(calls[-1].content)["raw"])
    )
    assert inv_mime["From"] == "Nova Fora <jescalona@dantzigfleets.com>"
    assert inv_mime["Reply-To"] is None
    # Access token cached: one token call for two sends.
    assert sum(1 for c in calls if c.url.host == "oauth2.googleapis.com") == 1
    email_service._gmail_token.clear()
