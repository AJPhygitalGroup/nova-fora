# `apps/api/tests/`

First scaffold of the pytest suite (pilot-plan P0 #3). The tests target
a RUNNING dev API at `localhost:8000` — the same one `smoke_authz.py`
hits — rather than spinning up a separate test DB. Cheaper to maintain
while we shake out the test patterns; CI integration with a per-run
test DB is the next step.

## Run

```bash
# From apps/api/ with the dev API up on localhost:8000 + seed loaded:
cd apps/api
uv run pytest tests/                      # all
uv run pytest tests/ -k impersonate        # one logical group
uv run pytest tests/test_authz_multi_tenant.py::TestImpersonation -v

# If the dev API isn't reachable, the whole suite skips with a clean
# message — won't blow up with 13 individual login failures.
```

### One-time setup: pytest install in the dev container

The runtime image (`nova-fora-api`) doesn't ship dev deps yet — pytest
is declared in `pyproject.toml` under `[dependency-groups].dev` but
`uv` isn't on the container PATH and the venv has no `pip`. Two paths
to actually RUN pytest:

1. **Local Python install on the host** (fastest):
   ```bash
   # Anywhere with pytest available — these tests only use stdlib + pytest
   pip install pytest pytest-asyncio
   cd apps/api && pytest tests/
   ```
2. **Add `uv` + dev deps to `docker-compose.dev.yml`** — pilot P0 #3
   deepening. Mount `tests/` and re-base the dev image with `uv sync
   --dev` so `docker exec nova-api uv run pytest` works inline.

Until then `smoke_authz.py` remains the runnable proof-of-coverage you
can always invoke via container python (no extra deps):

```bash
docker cp apps/api/tests/smoke_authz.py nova-api:/tmp/_s.py && \
  docker exec nova-api /app/.venv/bin/python /tmp/_s.py
```

## What's here

- `conftest.py` — session-scoped login fixtures for the 6 seed users
  (Maria/Jon/Jorge/Olger/Mike/David). Token reuse keeps the suite fast.
- `test_authz_multi_tenant.py` — pytest version of `smoke_authz.py`,
  covers DSP↔DSP cross-tenant, Vendor↔Vendor via `/work-orders/by-ro/`,
  technician role gates, site_admin god mode, vendor `repair_type`
  scope filter on inspection reports, and the new `/auth/impersonate`
  flow.
- `smoke_authz.py` — original runnable script (kept for one-off
  invocations + manual debugging). The pytest tests are the canonical
  surface going forward.

## Adding tests

Each new authz invariant should land here as a test **before** the
matching service code (or alongside the same commit). The fixtures in
`conftest.py` make a typical cross-tenant assertion ~3 lines:

```python
def test_dsp_a_cannot_read_dsp_b_thing(token_jon):
    code, _ = http("GET", f"/things/{DSP_B_THING_ID}", token_jon)
    assert code in (403, 404)
```
