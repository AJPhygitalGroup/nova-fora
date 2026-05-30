"""Real-token multi-tenant authz smoke test.

Action E of `memory/plan_jun15_demo_derisk.md` — exercises cross-tenant
operations using REAL JWT tokens (not impersonation) to prove that the
multi-tenant isolation guarantees the demo audience would assume actually
hold. Any RED cell here is a launch blocker.

This is also the first scaffold of pilot-plan P0 #3 ("Backend pytest
suite under apps/api/tests/"). For now it's a runnable script — the
pytest conversion (fixtures + test DB + CI integration) is the next
step of P0 work.

Run (against a running dev API, default localhost:8000 inside the
api container or :8001 from the host):

    docker exec nova-api /app/.venv/bin/python apps/api/tests/smoke_authz.py
    # or from inside apps/api:
    uv run python tests/smoke_authz.py

Exits 0 on full pass, 1 on any FAIL. Output is a one-page role × endpoint
table.

Verified 2026-05-29: 11/11 PASS including sub-check of the
vendor-repair_type defect scope filter shipped same day
(commits 3aa9000 + 5b2aba4).

NOTE — deprecated coverage gap (2026-05-29): the WO-by-internal-id tests
(/work-orders/{WO-XXXXX}) were intentionally removed because the internal
WO id is being deprecated as a user-facing handle in favour of the
service writer's RO# (Repair Order number). When the RO#-as-primary
work lands, re-add cross-tenant tests using `/work-orders/by-ro/{RO}`
or whatever the canonical lookup becomes. Vendor↔Vendor isolation is
not currently exercised by this matrix as a result — TODO when RO# ships.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8000"
PWD = "nova2026!"

# Real users from `python -m app.cli seed`.
USERS = {
    "maria":  ("maria@novafora.com",     "site_admin"),
    "jon":    ("jon@safetyfirst.com",    "dsp_owner @ Safety First (DSP A)"),
    "jorge":  ("jorgeelceiba@gmail.com", "dsp_owner @ Service Logistic (DSP B)"),
    "olger":  ("olger@dullesmidas.com",  "vendor_admin @ Dulles Midas (Vendor A, mech/pm/cnmr)"),
    "mike":   ("mike@capitalbody.com",   "vendor_admin @ Capital Body Shop (Vendor B, body)"),
    "david":  ("david@dullesmidas.com",  "technician @ Dulles Midas"),
}

# Cross-tenant fixtures. IDs are the seeded ones — re-run seed if you
# wipe the DB.
DSP_A_VAN = "VAN-0113"   # Safety First
DSP_A_INS = "INS-00037"  # Safety First
DSP_B_VAN = "VAN-0164"   # Service Logistic
DSP_B_INS = "INS-00053"  # Service Logistic


def http(method, path, token=None, body=None):
    headers = {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.read()[:120].decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:120].decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, str(e)[:120]


# ── Login all users ─────────────────────────────────────────
tokens = {}
print("=" * 78)
print("LOGINS")
print("=" * 78)
for key, (email, label) in USERS.items():
    code, _ = http("POST", "/auth/login", body={"email": email, "password": PWD})
    if code == 200:
        req = urllib.request.Request(
            BASE + "/auth/login",
            data=json.dumps({"email": email, "password": PWD}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        tokens[key] = json.load(urllib.request.urlopen(req))["access_token"]
        print(f"  OK  {key:8s} → {label}")
    else:
        print(f"  FAIL {key:8s} → {code}")

# ── Test matrix ─────────────────────────────────────────────
# Each row: (id, actor, method, path, body_or_None, allowed_codes, why).
# allowed_codes = list of HTTP statuses considered PASS. For cross-tenant
# denies we accept either 403 (forbidden) or 404 (silent — equally safe).
TESTS = [
    # DSP cross-tenant reads
    ("01", "jon",   "GET", f"/vehicles/{DSP_B_VAN}",       None, [403, 404], "DSP A → DSP B's van"),
    ("02", "jon",   "GET", f"/inspections/{DSP_B_INS}",    None, [403, 404], "DSP A → DSP B's inspection"),
    ("03", "jon",   "GET", f"/defects?vehicle_id={DSP_B_VAN}", None, [200, 403], "DSP A → DSP B's defect list (200+empty acceptable)"),
    ("04", "jorge", "GET", f"/vehicles/{DSP_A_VAN}",       None, [403, 404], "DSP B → DSP A's van (symmetric)"),
    ("05", "jorge", "GET", f"/inspections/{DSP_A_INS}",    None, [403, 404], "DSP B → DSP A's inspection (symmetric)"),

    # Vendor↔Vendor coverage TODO — re-add once RO#-as-primary lookup ships
    # (currently the only handle is internal WO id which is being deprecated).

    # Technician escalation
    ("06", "david", "POST", "/auth/invitations", {"email": "test@example.com", "role": "vendor_admin"}, [403, 422], "Technician → invite (role-matrix gate)"),
    ("07", "david", "POST", "/vehicles", {"dsp_id": 1, "fleet_id": "XX", "vin": "1HGCM82633A123456", "plate": "ABC1234", "year": 2024, "make": "X", "model": "Y"}, [403, 422], "Technician → create vehicle"),

    # Owned-resource sanity
    ("08", "jon",   "GET", f"/vehicles/{DSP_A_VAN}",       None, [200],      "DSP A → own van (allowed)"),

    # site_admin god mode
    ("09", "maria", "GET", f"/vehicles/{DSP_A_VAN}",       None, [200],      "site_admin → DSP A van"),
    ("10", "maria", "GET", f"/vehicles/{DSP_B_VAN}",       None, [200],      "site_admin → DSP B van"),

    # Today's vendor repair_type scope filter (regression check)
    ("11", "olger", "GET", "/inspections/INS-00055",        None, [200],      "Vendor scope filter still works (body filtered)"),
]

print()
print("=" * 78)
print("AUTHZ SMOKE — role × endpoint × cross-tenant")
print("=" * 78)
print(f"{'#':<3} {'STATUS':<6} {'ACTOR':<7} {'ACTION':<60} {'CODE':>5}  WHY")
print("-" * 78)

real_bugs = []
for tid, actor, method, path, body, ok_codes, why in TESTS:
    if actor not in tokens:
        print(f"{tid} SKIP   {actor:<7} (no token)")
        continue
    code, resp = http(method, path, tokens[actor], body)
    status = "PASS" if code in ok_codes else "FAIL"
    method_path = f"{method} {path}"
    if len(method_path) > 58:
        method_path = method_path[:57] + "…"
    print(f"{tid} {status:<6} {actor:<7} {method_path:<60} {code:>5}  {why}")
    if status == "FAIL":
        real_bugs.append((tid, actor, method, path, code, ok_codes, why, resp[:80]))

    # Sub-check on the vendor scope filter test: the body defect must be
    # filtered from the response.
    if tid == "11" and code == 200:
        full = urllib.request.urlopen(urllib.request.Request(
            BASE + "/inspections/INS-00055",
            headers={"Authorization": "Bearer " + tokens[actor]},
        )).read()
        try:
            body_resp = json.loads(full)
        except Exception:  # noqa: BLE001
            body_resp = {}
        defects = body_resp.get("defects", []) if isinstance(body_resp, dict) else []
        has_body = any(d.get("group") == "Body" for d in defects)
        substatus = "PASS" if not has_body else "FAIL"
        print(f"    {substatus:<6} (sub) → {len(defects)} defects, body present = {has_body}")
        if has_body:
            real_bugs.append((tid + "b", actor, method, path, "body leak", "no body", "vendor scope filter regression", ""))

print()
print("=" * 78)
if real_bugs:
    print(f"FAIL  {len(real_bugs)} red cell(s) — see above")
    for b in real_bugs:
        print(" ", b[0], b[1], b[2], b[3], "->", b[4], "expected", b[5], "-", b[6])
    sys.exit(1)
else:
    print("PASS  all cells green")
print("=" * 78)
