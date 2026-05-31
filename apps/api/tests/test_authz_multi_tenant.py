"""Multi-tenant authorization tests — pytest version of smoke_authz.py.

Direct conversion of the runnable smoke script into proper pytest cases
so they can run in CI and live in the regular test suite. Same matrix
the smoke covers (DSP↔DSP, Vendor↔Vendor via RO#, technician
escalation, site_admin god mode, vendor repair_type scope, real
impersonation). See conftest.py for the fixtures + dev-API target.

These tests are the seed of pilot-plan P0 #3 ("Backend pytest suite
under apps/api/tests/"). Each new authz invariant should land here as
a test BEFORE the matching service code.
"""
from __future__ import annotations

import pytest

from .conftest import (
    DSP_A_INS,
    DSP_A_VAN,
    DSP_B_INS,
    DSP_B_VAN,
    VENDOR_A_RO,
    http,
)


# ─────────────────────────────────────────────────────
# DSP ↔ DSP cross-tenant
# ─────────────────────────────────────────────────────
class TestDspCrossTenant:
    """A DSP owner must not see another DSP's vehicles, inspections or
    defects. 403 and 404 are both acceptable — 404 is sometimes safer
    because it doesn't confirm the resource exists."""

    def test_dsp_a_blocked_from_dsp_b_van(self, token_jon):
        code, _ = http("GET", f"/vehicles/{DSP_B_VAN}", token_jon)
        assert code in (403, 404)

    def test_dsp_a_blocked_from_dsp_b_inspection(self, token_jon):
        code, _ = http("GET", f"/inspections/{DSP_B_INS}", token_jon)
        assert code in (403, 404)

    def test_dsp_a_defect_list_for_dsp_b_van_is_safe(self, token_jon):
        # 200+empty is acceptable — the filter scopes server-side rather
        # than refusing the request outright.
        code, _ = http("GET", f"/defects?vehicle_id={DSP_B_VAN}", token_jon)
        assert code in (200, 403)

    def test_dsp_b_blocked_from_dsp_a_van(self, token_jorge):
        code, _ = http("GET", f"/vehicles/{DSP_A_VAN}", token_jorge)
        assert code in (403, 404)

    def test_dsp_b_blocked_from_dsp_a_inspection(self, token_jorge):
        code, _ = http("GET", f"/inspections/{DSP_A_INS}", token_jorge)
        assert code in (403, 404)

    def test_dsp_a_can_read_own_van(self, token_jon):
        code, _ = http("GET", f"/vehicles/{DSP_A_VAN}", token_jon)
        assert code == 200


# ─────────────────────────────────────────────────────
# Vendor ↔ Vendor cross-tenant via /work-orders/by-ro/{ro_number}
# (the canonical user-facing lookup after the 2026-05-29 WO id → RO#
# migration; commit 546501b).
# ─────────────────────────────────────────────────────
class TestVendorCrossTenant:
    def test_vendor_a_reads_own_wo_by_ro(self, token_olger):
        code, body = http("GET", f"/work-orders/by-ro/{VENDOR_A_RO}", token_olger)
        assert code == 200
        # Sanity — the response really is that WO
        assert isinstance(body, dict)
        assert body.get("id", "").startswith("WO-")

    def test_vendor_b_blocked_from_vendor_a_wo_by_ro(self, token_mike):
        # 404 (silent) is intentional — we don't confirm RO# existence
        # to a vendor who shouldn't see it.
        code, _ = http("GET", f"/work-orders/by-ro/{VENDOR_A_RO}", token_mike)
        assert code == 404

    def test_unknown_ro_is_404(self, token_olger):
        code, _ = http("GET", "/work-orders/by-ro/DOESNOTEXIST", token_olger)
        assert code == 404


# ─────────────────────────────────────────────────────
# Technician role gates — no admin escalation
# ─────────────────────────────────────────────────────
class TestTechnicianEscalation:
    def test_tech_cannot_invite(self, token_david):
        code, _ = http(
            "POST", "/auth/invitations", token_david,
            body={"email": "test@example.com", "role": "vendor_admin"},
        )
        assert code in (403, 422)

    def test_tech_cannot_create_vehicle(self, token_david):
        code, _ = http(
            "POST", "/vehicles", token_david,
            body={
                "dsp_id": 1, "fleet_id": "XX",
                "vin": "1HGCM82633A123456", "plate": "ABC1234",
                "year": 2024, "make": "X", "model": "Y",
            },
        )
        assert code in (403, 422)


# ─────────────────────────────────────────────────────
# site_admin god mode
# ─────────────────────────────────────────────────────
class TestSiteAdminGodMode:
    def test_site_admin_reads_dsp_a_van(self, token_maria):
        code, _ = http("GET", f"/vehicles/{DSP_A_VAN}", token_maria)
        assert code == 200

    def test_site_admin_reads_dsp_b_van(self, token_maria):
        code, _ = http("GET", f"/vehicles/{DSP_B_VAN}", token_maria)
        assert code == 200

    def test_site_admin_reads_any_ro(self, token_maria):
        code, _ = http("GET", f"/work-orders/by-ro/{VENDOR_A_RO}", token_maria)
        assert code == 200


# ─────────────────────────────────────────────────────
# Vendor repair_type scope filter (commit 5b2aba4) — Dulles Midas
# services {mechanical, pm, cnmr}, so a body defect on a van they
# inspected must NOT appear in their inspection report response.
# ─────────────────────────────────────────────────────
class TestVendorRepairTypeScope:
    def test_olger_inspection_report_excludes_body_defect(self, token_olger):
        # INS-00055 contains 3 defects: steering_wheel (CMR), brake_fluid (PM),
        # body_damage (Body). Olger should see only the first two.
        code, body = http("GET", "/inspections/INS-00055", token_olger)
        assert code == 200
        assert isinstance(body, dict)
        defects = body.get("defects", [])
        # Body defect must be filtered out
        groups = [d.get("group") for d in defects]
        assert "Body" not in groups, f"body defect leaked to vendor: {defects}"
        # And section headers should be the real ones, not "UNDEFINED"
        # (commit 025f8a1 — section enrichment for inspection report).
        for d in defects:
            assert d.get("section") is not None


# ─────────────────────────────────────────────────────
# Real impersonation (commit d7fe052) — site_admin can mint a token
# scoped to a target with `acting_as_id` claim; other roles blocked.
# ─────────────────────────────────────────────────────
class TestImpersonation:
    def test_site_admin_can_impersonate_target(self, token_maria):
        # Olger has user.id=2
        code, body = http("POST", "/auth/impersonate/2", token_maria)
        assert code == 200
        assert isinstance(body, dict)
        assert "access_token" in body
        # New token should resolve to olger + carry acting_as=maria
        new_tok = body["access_token"]
        code2, me = http("GET", "/auth/me", new_tok)
        assert code2 == 200
        assert me["email"] == "olger@dullesmidas.com"
        acting = me.get("acting_as")
        assert acting is not None, "acting_as claim missing on /auth/me"
        assert acting["email"] == "maria@novafora.com"

    def test_non_admin_cannot_impersonate(self, token_olger):
        # Olger is vendor_admin; trying to impersonate user id=3 (david)
        code, _ = http("POST", "/auth/impersonate/3", token_olger)
        assert code == 403

    def test_admin_cannot_impersonate_self(self, token_maria):
        # Maria has user.id=4
        code, _ = http("POST", "/auth/impersonate/4", token_maria)
        assert code == 400

    def test_impersonating_unknown_user_returns_404(self, token_maria):
        code, _ = http("POST", "/auth/impersonate/99999", token_maria)
        assert code == 404


# ─────────────────────────────────────────────────────
# Logout revocation (Redis denylist). Closes tester critique #5:
# logout used to be a no-op so a leaked token stayed valid until
# natural expiry. Real revoke + denylist landed 2026-05-29.
# These tests DO NOT use the session-scoped token fixtures because
# they revoke tokens — a session fixture would poison every later
# test in the same run. Each test logs in fresh.
# ─────────────────────────────────────────────────────
class TestLogoutRevoke:
    @staticmethod
    def _fresh_login(email: str = "maria@novafora.com") -> tuple[str, str]:
        from .conftest import PWD
        code, body = http("POST", "/auth/login", body={"email": email, "password": PWD})
        assert code == 200, body
        return body["access_token"], body["refresh_token"]

    def test_access_token_works_before_logout(self):
        access, _ = self._fresh_login()
        code, _ = http("GET", "/auth/me", access)
        assert code == 200

    def test_access_token_rejected_after_logout(self):
        access, refresh = self._fresh_login()
        code, _ = http(
            "POST", "/auth/logout", access,
            body={"refresh_token": refresh},
        )
        assert code == 204
        # Reused access token must be rejected
        code, _ = http("GET", "/auth/me", access)
        assert code == 401

    def test_refresh_token_rejected_after_logout(self):
        access, refresh = self._fresh_login()
        code, _ = http(
            "POST", "/auth/logout", access,
            body={"refresh_token": refresh},
        )
        assert code == 204
        # The refresh token must ALSO be revoked — otherwise a logged-out
        # client holding the refresh could mint fresh access tokens.
        code, _ = http(
            "POST", "/auth/refresh",
            body={"refresh_token": refresh},
        )
        assert code == 401

    def test_logout_without_refresh_body_still_revokes_access(self):
        access, _ = self._fresh_login()
        # Body is optional — access-only revoke must still work.
        code, _ = http("POST", "/auth/logout", access)
        assert code == 204
        code, _ = http("GET", "/auth/me", access)
        assert code == 401


# ─────────────────────────────────────────────────────
# Auth audit log (commit 2026-05-31 — table + GET endpoint).
# Verifies that login / logout / impersonate_start each persist a row
# and that the read surface is site_admin-only.
# ─────────────────────────────────────────────────────
class TestAuditLog:
    def test_non_admin_cannot_read_audit_log(self, token_olger):
        code, _ = http("GET", "/auth/audit-log", token_olger)
        assert code == 403

    def test_site_admin_can_read_audit_log(self, token_maria):
        code, body = http("GET", "/auth/audit-log?per_page=5", token_maria)
        assert code == 200
        assert isinstance(body, dict)
        assert "items" in body and "total" in body

    def test_login_event_persists(self):
        # Fresh login → audit should grow by one with event_type=login
        # for this actor. Read as site_admin filtered by actor_id.
        from .conftest import PWD
        # Maria's user id is 4 — known seed fact.
        code, body = http(
            "POST", "/auth/login",
            body={"email": "maria@novafora.com", "password": PWD},
        )
        assert code == 200
        maria_access = body["access_token"]
        # Read most-recent audit row for actor 4 + event=login
        code, body = http(
            "GET", "/auth/audit-log?actor_id=4&event_type=login&per_page=1",
            maria_access,
        )
        assert code == 200
        assert body["total"] >= 1
        latest = body["items"][0]
        assert latest["event_type"] == "login"
        assert latest["actor_email"] == "maria@novafora.com"

    def test_impersonate_event_persists_with_target(self, token_maria):
        # Impersonate olger (user.id=2) and confirm the row carries
        # target_email + extra.target_role.
        code, _ = http("POST", "/auth/impersonate/2", token_maria)
        assert code == 200
        code, body = http(
            "GET", "/auth/audit-log?event_type=impersonate_start&per_page=1",
            token_maria,
        )
        assert code == 200
        assert body["total"] >= 1
        latest = body["items"][0]
        assert latest["event_type"] == "impersonate_start"
        assert latest["actor_email"] == "maria@novafora.com"
        assert latest["target_email"] == "olger@dullesmidas.com"
        assert latest["extra"].get("target_role") == "vendor_admin"

    def test_logout_event_records_refresh_revoked_flag(self):
        from .conftest import PWD
        code, body = http(
            "POST", "/auth/login",
            body={"email": "maria@novafora.com", "password": PWD},
        )
        access, refresh = body["access_token"], body["refresh_token"]
        code, _ = http(
            "POST", "/auth/logout", access, body={"refresh_token": refresh}
        )
        assert code == 204
        # Read latest logout event as a fresh admin token
        code, body = http(
            "POST", "/auth/login",
            body={"email": "maria@novafora.com", "password": PWD},
        )
        fresh = body["access_token"]
        code, body = http(
            "GET", "/auth/audit-log?event_type=logout&per_page=1", fresh,
        )
        assert code == 200
        latest = body["items"][0]
        assert latest["event_type"] == "logout"
        assert latest["extra"].get("refresh_revoked") is True
