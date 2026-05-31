"""Shared pytest fixtures for the multi-tenant authz test suite.

The tests target a RUNNING dev API on localhost:8000 (the same one
`smoke_authz.py` hits). This matches our current dev loop and keeps
the first pytest suite ground-floor cheap — no test DB, no alembic
bootstrap, no FastAPI TestClient async-session juggling. Future work
(pilot P0 #3 deepening): mount tests/ in docker-compose.dev.yml and
wire a per-session test DB so CI can run this without a live server.

Each `token_<role>` fixture is session-scoped — logs in once per
pytest session, returns the access token. If the API isn't reachable
the whole module skips with a clear message.

Run:
    cd apps/api
    uv run pytest tests/                  # all tests
    uv run pytest tests/ -k impersonate   # just the impersonation tests
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

BASE = "http://localhost:8000"
PWD = "nova2026!"


# ─────────────────────────────────────────────────────
# Low-level HTTP helper — exported for tests so each one can do its
# own request without re-deriving the boilerplate.
# ─────────────────────────────────────────────────────
def http(method: str, path: str, token: str | None = None, body=None):
    """Hit the dev API. Returns (status_code, parsed_json_or_str).

    - status_code = HTTP status (int)
    - parsed_json_or_str = json.loads(body) on success, or the raw
      response body string on error (so failing tests get a useful
      payload in pytest's diff output).
    """
    headers: dict[str, str] = {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read()
        try:
            return resp.status, json.loads(raw)
        except json.JSONDecodeError:
            return resp.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw.decode("utf-8", "replace")


def _login(email: str) -> str:
    code, body = http("POST", "/auth/login", body={"email": email, "password": PWD})
    if code != 200 or not isinstance(body, dict) or "access_token" not in body:
        pytest.skip(
            f"Cannot login as {email} (got {code}). "
            "Is the dev API running on localhost:8000 with the seed users? "
            "Try: docker compose -f docker-compose.dev.yml up && python -m app.cli seed"
        )
    return body["access_token"]


# Skip the whole module if the API isn't reachable at all — gives a
# cleaner failure than 13 individual login errors.
def _probe_api() -> bool:
    try:
        urllib.request.urlopen(BASE + "/health", timeout=2)
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.fixture(scope="session", autouse=True)
def _api_must_be_reachable():
    if not _probe_api():
        pytest.skip(
            f"API not reachable at {BASE}. "
            "Start dev stack first: docker compose -f docker-compose.dev.yml up"
        )


# ─────────────────────────────────────────────────────
# Token fixtures — one per seeded user.
# All session-scoped: login once, reuse across the run.
# Tokens expire in 60min (jwt_access_token_expire_minutes default), so
# session scope is safe for any reasonable pytest run length.
# ─────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def token_maria() -> str:
    """site_admin (id=4) — god mode."""
    return _login("maria@novafora.com")


@pytest.fixture(scope="session")
def token_jon() -> str:
    """dsp_owner @ Safety First LLC (DSP A, id=1)."""
    return _login("jon@safetyfirst.com")


@pytest.fixture(scope="session")
def token_jorge() -> str:
    """dsp_owner @ Service Logistic LLC (DSP B, id=9)."""
    return _login("jorgeelceiba@gmail.com")


@pytest.fixture(scope="session")
def token_olger() -> str:
    """vendor_admin @ Dulles Midas (Vendor A: mechanical/pm/cnmr)."""
    return _login("olger@dullesmidas.com")


@pytest.fixture(scope="session")
def token_mike() -> str:
    """vendor_admin @ Capital Body Shop (Vendor B: body)."""
    return _login("mike@capitalbody.com")


@pytest.fixture(scope="session")
def token_david() -> str:
    """technician @ Dulles Midas."""
    return _login("david@dullesmidas.com")


# ─────────────────────────────────────────────────────
# Test data constants — IDs that must exist in the seeded dev DB.
# Re-seed if any of these fail to resolve.
# ─────────────────────────────────────────────────────
DSP_A_VAN = "VAN-0113"   # Safety First
DSP_A_INS = "INS-00037"  # Safety First
DSP_B_VAN = "VAN-0164"   # Service Logistic
DSP_B_INS = "INS-00053"  # Service Logistic
VENDOR_A_RO = "RO-PR13"  # Dulles Midas's primary RO (WO id=13)
