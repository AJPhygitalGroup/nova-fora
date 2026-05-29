/**
 * Nova Fora API client.
 *
 * Handles:
 *  - Base URL from VITE_API_BASE_URL (build-time env var)
 *  - JWT Bearer token attach on every request
 *  - snake_case → camelCase key transformation on responses (FastAPI returns
 *    snake_case, but the demo components expect camelCase — see
 *    nova-fora-demo/src/data/mockData.js)
 *  - Auto-logout on 401 (token expired / invalid)
 *  - Auto refresh (basic — retries once with refresh_token on 401)
 */

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const ACCESS_KEY = 'nf-access-token';
const REFRESH_KEY = 'nf-refresh-token';

// ─────────────────────────────────────────────────────
// Token storage
// ─────────────────────────────────────────────────────
export const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

export const setTokens = ({ access_token, refresh_token }) => {
  if (access_token) localStorage.setItem(ACCESS_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
};

export const clearTokens = () => {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

// ─────────────────────────────────────────────────────
// Key transform: snake_case → camelCase
// ─────────────────────────────────────────────────────
const snakeToCamel = (str) =>
  str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Fields whose VALUE is an opaque JSON document (JSON Schema, structured
// payload, free-form dict) — we must NOT recurse into them, otherwise the
// inner keys get camelCased and stop matching the snake_case keys the
// backend uses for validation + storage.
//
// V2.2 cases:
//   details_schema       — JSON Schema describing a defect's `details` object
//   threshold            — per-applicability JSON dict (e.g. {"min_tread_32nds": 4})
//   details              — the user-supplied payload itself (must round-trip)
const OPAQUE_JSON_KEYS = new Set([
  'details_schema',
  'detailsSchema',
  'threshold',
  'details',
]);

export function keysToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (obj !== null && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const camelKey = snakeToCamel(k);
        // Stop recursing on opaque JSON payloads
        if (OPAQUE_JSON_KEYS.has(k) || OPAQUE_JSON_KEYS.has(camelKey)) {
          return [camelKey, v];
        }
        return [camelKey, keysToCamel(v)];
      })
    );
  }
  return obj;
}

// ─────────────────────────────────────────────────────
// Core fetch
// ─────────────────────────────────────────────────────
class APIError extends Error {
  constructor(detail, status, payload) {
    // FastAPI 422 returns detail as an array: [{loc, msg, type}, ...]
    // Normalize to a human-readable string so .message / .detail are always
    // safe to render as a React child.
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((e) => `${e.loc?.join('.') || 'field'}: ${e.msg || 'invalid'}`).join('; ')
          : detail
            ? JSON.stringify(detail)
            : `HTTP ${status}`;
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.detail = message;  // always a string
    this.rawPayload = payload;  // original JSON for debugging
  }
}

async function _raw(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getAccessToken();
  if (token && !options.skipAuth) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Send the user's chosen UI language so backend catalogs (defect labels,
  // DVIC items, error messages) can return localized strings. Backend
  // collapses regional variants like es-MX → es internally.
  if (!('Accept-Language' in headers)) {
    try {
      const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('nf-lang')) || 'es';
      headers['Accept-Language'] = lang;
    } catch {
      // localStorage might be unavailable in some embeddings — silently skip.
    }
  }

  const fullUrl = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(fullUrl, { ...options, headers });
  } catch (err) {
    // Browser-level network failure (CORS preflight blocked, DNS, server
    // unreachable, etc). The default TypeError("Failed to fetch") gives
    // zero context — rethrow with the URL + method so the inspector can
    // see what we tried to hit when the alert pops up.
    const method = options.method || 'GET';
    const reason = err?.message || String(err);
    const enriched = new Error(`Network error: ${method} ${fullUrl} — ${reason}`);
    enriched.name = err?.name || 'NetworkError';
    enriched.cause = err;
    throw enriched;
  }

  if (res.status === 204) return null;

  let payload = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  } else {
    payload = await res.text();
  }

  if (!res.ok) {
    const detail =
      (payload && payload.detail) || (typeof payload === 'string' ? payload : res.statusText);
    throw new APIError(detail, res.status, payload);
  }

  return keysToCamel(payload);
}

/**
 * Authenticated fetch with one auto-refresh retry on 401.
 * Use `skipAuth: true` option for public endpoints like /auth/login.
 */
export async function apiFetch(path, options = {}) {
  try {
    return await _raw(path, options);
  } catch (err) {
    if (err.status !== 401 || options.skipAuth || options._retried) throw err;

    // Try refresh once
    const refresh = getRefreshToken();
    if (!refresh) {
      clearTokens();
      throw err;
    }

    try {
      const data = await _raw('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
        skipAuth: true,
      });
      setTokens({
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
      });
    } catch {
      clearTokens();
      throw err;
    }

    // Retry original request with new token
    return _raw(path, { ...options, _retried: true });
  }
}

// ─────────────────────────────────────────────────────
// Auth module
// ─────────────────────────────────────────────────────
export const auth = {
  /** POST /auth/login — stores tokens on success, returns the user profile. */
  async login(email, password) {
    const data = await _raw('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    setTokens({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    });
    return this.me();
  },

  /** GET /auth/me — current user. Throws APIError(401) if not authenticated. */
  me() {
    return apiFetch('/auth/me');
  },

  /** PATCH /auth/me/language — persist the i18n preference. Accepts 'es' / 'en'
   *  (or any locale starting with those — server collapses to the base). */
  setLanguage(lang) {
    return apiFetch('/auth/me/language', {
      method: 'PATCH',
      body: JSON.stringify({ language: lang }),
    });
  },

  /** POST /auth/logout — best-effort; always clears local tokens. */
  async logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore — logout should never fail from the user's perspective
    }
    clearTokens();
  },
};


// ─────────────────────────────────────────────────────
// Invitations — token-based onboarding for new owners + vendors.
// Two surfaces:
//   - Public (no auth): preview + accept by token. Used by /signup/accept page.
//   - Authenticated:    list/create/resend/revoke. Used by AdminPanel.
// ─────────────────────────────────────────────────────
export const invitations = {
  /** POST /auth/invitations — site_admin / dsp_owner / vendor_admin. */
  create(body) {
    return apiFetch('/auth/invitations', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** GET /auth/invitations — scoped to the caller's org by the API. */
  list({ status } = {}) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiFetch(`/auth/invitations${qs}`);
  },

  /** Strip the "INV-" prefix so the integer route param matches. */
  _intId(id) {
    if (typeof id === 'number') return id;
    const m = String(id).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : id;
  },

  /** POST /auth/invitations/{id}/resend — bumps expiry + re-sends email. */
  resend(id) {
    return apiFetch(`/auth/invitations/${this._intId(id)}/resend`, {
      method: 'POST',
    });
  },

  /** DELETE /auth/invitations/{id} — revoke a pending invitation. */
  revoke(id) {
    return apiFetch(`/auth/invitations/${this._intId(id)}`, {
      method: 'DELETE',
    });
  },

  /** GET /auth/invitations/{token}/preview — PUBLIC, no auth. */
  preview(token) {
    return _raw(`/auth/invitations/${encodeURIComponent(token)}/preview`, {
      skipAuth: true,
    });
  },

  /** POST /auth/invitations/{token}/accept — PUBLIC, returns JWT pair. */
  async accept(token, body) {
    const data = await _raw(
      `/auth/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(body)),
        skipAuth: true,
      },
    );
    // Store tokens so the auto-login on the new account is immediate.
    setTokens({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    });
    return data;
  },
};

// ─────────────────────────────────────────────────────
// Vehicles module
// ─────────────────────────────────────────────────────
export const vehicles = {
  /**
   * GET /vehicles — paginated list.
   * params: { dspId?, search?, grounded?, isActive?, page?, perPage? }
   * Returns { items, total, page, perPage } (already camelCase).
   */
  list(params = {}) {
    const q = new URLSearchParams();
    // Frontend uses camelCase, backend expects snake_case
    const paramMap = {
      dspId: 'dsp_id',
      isActive: 'is_active',
      perPage: 'per_page',
    };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      const key = paramMap[k] || k;
      q.set(key, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/vehicles${qs ? '?' + qs : ''}`);
  },

  /** GET /vehicles/{id}. Accepts int or 'VAN-XXXX'. */
  get(id) {
    return apiFetch(`/vehicles/${encodeURIComponent(id)}`);
  },

  /** POST /vehicles — create. Body in camelCase; converted to snake_case below. */
  create(body) {
    return apiFetch('/vehicles', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** PATCH /vehicles/{id}. */
  update(id, body) {
    return apiFetch(`/vehicles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /vehicles/bulk-upsert — sync a parsed Amazon Fleet Data sheet.
   * body: { dspId?, rows: [{fleetId, vin, plate, year, make, model, vehicleClass, ownership, mileage}], deactivateMissing?: bool }
   * Returns: { results: [{fleetId, vin, action, vehicleId?, error?}], summary: {created, updated, skipped, deactivated, error} }
   */
  bulkUpsert(body) {
    return apiFetch('/vehicles/bulk-upsert', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  // ── Customer preferred vendors (spec §10) ─────────
  // Lives under vehicles for ergonomics — the DSP picks their vendor
  // from the same surface where their fleet lives.
  // GET /customer-preferred-vendors?dspId=&vendorWorkshopId=&isPrimary=
  listPreferredVendors(params = {}) {
    const q = new URLSearchParams();
    const map = { dspId: 'dsp_id', vendorWorkshopId: 'vendor_workshop_id', isPrimary: 'is_primary' };
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      q.set(map[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/customer-preferred-vendors${qs ? '?' + qs : ''}`);
  },
  setPreferredVendor(body) {
    return apiFetch('/customer-preferred-vendors', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
  unsetPreferredVendor(rowId) {
    return apiFetch(`/customer-preferred-vendors/${encodeURIComponent(rowId)}`, {
      method: 'DELETE',
    });
  },

  // ── WO V2: van-scoped persistent SW notes ──
  listNotes(id, params = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      q.set(k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/vehicles/${encodeURIComponent(id)}/notes${qs ? '?' + qs : ''}`);
  },
  addNote(id, { body }) {
    return apiFetch(`/vehicles/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },
  deleteNote(id, noteId) {
    return apiFetch(`/vehicles/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
    });
  },

  // ── WO V2: aggregated van detail ──
  // Returns { vehicleIdStr, fleetId, plate, ... kpis, activeWork[], serviceHistory[], defectTimeline[] }.
  woSummary(id, params = {}) {
    const q = new URLSearchParams();
    const paramMap = { historyLimit: 'history_limit' };
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/vehicles/${encodeURIComponent(id)}/wo-summary${qs ? '?' + qs : ''}`);
  },
};

// ─────────────────────────────────────────────────────
// Inspections module — supports DRAFT incremental flow + atomic create
// ─────────────────────────────────────────────────────
export const inspections = {
  /**
   * GET /inspections
   * params: { dspId?, vehicleId?, dateFrom?, dateTo?, result?, status?, page?, perPage? }
   * status defaults to 'submitted' server-side; pass 'draft' for in-progress.
   */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = {
      dspId: 'dsp_id',
      vehicleId: 'vehicle_id',
      dateFrom: 'date_from',
      dateTo: 'date_to',
      perPage: 'per_page',
    };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/inspections${qs ? '?' + qs : ''}`);
  },

  /** GET /inspections/{id} — full detail with defects embedded */
  get(id) {
    return apiFetch(`/inspections/${encodeURIComponent(id)}`);
  },

  /**
   * POST /inspections/{id}/part-marks — mark a single part as pass/N/A.
   * body: { part: 'headlight', status: 'pass' | 'na' }
   * Re-tapping the same part with a different status overwrites the
   * previous mark (UPSERT on the composite PK). Throws 409 if the part
   * already has defects on this inspection — caller should remove the
   * defects first.
   */
  markPart(id, body) {
    return apiFetch(`/inspections/${encodeURIComponent(id)}/part-marks`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /inspections/{id}/part-marks/pass-remaining — bulk-pass.
   * body: { parts: ['headlight', 'tail_light', ...] }
   * Server filters out parts that already have a mark or a defect, then
   * inserts `pass` for the remainder. Returns:
   *   { insertedParts: [...], skippedParts: [...] }
   */
  passRemainingParts(id, parts) {
    return apiFetch(
      `/inspections/${encodeURIComponent(id)}/part-marks/pass-remaining`,
      {
        method: 'POST',
        body: JSON.stringify({ parts }),
      },
    );
  },

  /**
   * POST /inspections — create.
   * If body.defects is empty/missing → DRAFT. Otherwise → SUBMITTED atomic.
   * The wizard always creates DRAFT, then incrementally adds defects+photos.
   */
  create(body) {
    return apiFetch('/inspections', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * LEGACY STUBS — inspection-scoped defect endpoints.
   *
   * V2.2 removed POST /inspections/{id}/defects + DELETE /inspections/{id}/defects/{did}.
   * Defects are now first-class — use `defects.create()` and `defects.delete()`
   * with inspectionId + source='inspection'. These stubs surface a clear
   * error so legacy callers fail loudly instead of 404-ing silently.
   */
  addDefect() {
    return Promise.reject(
      new Error(
        "POST /inspections/{id}/defects was removed in V2.2. Call " +
        "defects.create({vehicleId, inspectionId, source: 'inspection', ...})."
      )
    );
  },
  removeDefect() {
    return Promise.reject(
      new Error(
        'DELETE /inspections/{id}/defects/{did} was removed in V2.2. ' +
        'Call defects.delete(id).'
      )
    );
  },

  /** POST /inspections/{id}/submit — finalize DRAFT. */
  submit(inspectionId, body = {}) {
    return apiFetch(
      `/inspections/${encodeURIComponent(inspectionId)}/submit`,
      { method: 'POST', body: JSON.stringify(camelToSnake(body)) }
    );
  },

  /** POST /inspections/{id}/photos — odometer / overview photos directly on inspection */
  commitInspectionPhoto(inspectionId, body) {
    return apiFetch(
      `/inspections/${encodeURIComponent(inspectionId)}/photos`,
      { method: 'POST', body: JSON.stringify(camelToSnake(body)) }
    );
  },

  /** GET /inspections/{id}/photos */
  listInspectionPhotos(inspectionId) {
    return apiFetch(`/inspections/${encodeURIComponent(inspectionId)}/photos`);
  },
};

// ─────────────────────────────────────────────────────
// Defects module (V2.2 — single canonical table at /defects)
// ─────────────────────────────────────────────────────
export const defects = {
  /**
   * GET /defects — flat list across all inspections + off-inspection sources.
   * params: { dspId?, vehicleId?, inspectionId?, source?, dateFrom?, dateTo?, page?, perPage? }
   */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = {
      dspId: 'dsp_id',
      vehicleId: 'vehicle_id',
      inspectionId: 'inspection_id',
      dateFrom: 'date_from',
      dateTo: 'date_to',
      perPage: 'per_page',
    };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/defects${qs ? '?' + qs : ''}`);
  },

  /** GET /defects/{id} — full detail with classification + group derived */
  get(id) {
    return apiFetch(`/defects/${encodeURIComponent(id)}`);
  },

  /**
   * POST /defects — create one defect (vehicle-scoped, inspection optional).
   * body: {
   *   vehicleId,                                     // 'VAN-XXXX' or int
   *   inspectionId? (required when source='inspection'),
   *   source,                                        // 'inspection' | 'driver_report' | 'maintenance_request' | 'customer_report' | 'shop_finding' | 'other'
   *   part, defectType,                              // V2.2 enum values
   *   position?, details?, notes?, reportedAt?,
   * }
   */
  create(body) {
    return apiFetch('/defects', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** PATCH /defects/{id} — mutate `notes` + `details` only.
   *
   * V2.2: (part, position, defect_type) is immutable post-create. Workflow
   * status lives in a future `defect_status` table — not on the defect row.
   */
  update(id, body) {
    return apiFetch(`/defects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * LEGACY STUB — workflow status mutation.
   *
   * V2.2 §4.3 moved workflow state (pending/acknowledged/sent_to_vendor/
   * scheduled/converted_to_wo/dismissed) off the Defect row into a future
   * `defect_status` table. Until that table + its endpoints land, this
   * stub rejects with a clear message so callers (Defects.jsx,
   * LiveInspectionReportCard.jsx) surface a helpful error rather than
   * 405-ing the user.
   */
  updateStatus() {
    return Promise.reject(
      new Error(
        'Defect workflow status was moved to a future defect_status table ' +
        'in V2.2. Status mutations are not yet supported.'
      )
    );
  },

  /** DELETE /defects/{id} — used by the wizard photo-gate rollback */
  delete(id) {
    return apiFetch(`/defects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ── WO V2 iter-1: defect-level cost approval ─────
  /**
   * POST /defects/{id}/cost — SW writes the estimated cost.
   * body: { estimatedCost: number, fmcCappedAt?: number }
   * Auto-approves if AMR & no shortfall, OR if CMR under DSP threshold.
   * Otherwise stores the cost and pings the DSP for `customer_cost_approve`.
   */
  setCost(id, body) {
    return apiFetch(`/defects/${encodeURIComponent(id)}/cost`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /defects/{id}/cost-decision — DSP approves/rejects above-threshold cost.
   * body: { decision: 'approved' | 'rejected', reason?: string }
   */
  costDecision(id, body) {
    return apiFetch(`/defects/${encodeURIComponent(id)}/cost-decision`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** GET /defects/{id}/photos */
  listPhotos(id) {
    return apiFetch(`/defects/${encodeURIComponent(id)}/photos`);
  },

  /** POST /defects/{id}/photos — commit after presigned PUT succeeds */
  commitPhoto(id, body) {
    return apiFetch(`/defects/${encodeURIComponent(id)}/photos`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** DELETE /defects/{id}/photos/{photoId} — soft delete */
  deletePhoto(defectId, photoId) {
    return apiFetch(
      `/defects/${encodeURIComponent(defectId)}/photos/${encodeURIComponent(photoId)}`,
      { method: 'DELETE' }
    );
  },

  /**
   * Subscribe to defect.created events via SSE.
   *
   * EventSource can't send Authorization headers in browsers, so the access
   * token is passed as `?token=...`. The stream is server-side role-scoped
   * — dsp_owners only see their own org's defects.
   *
   * @returns {() => void} cleanup — call on unmount to close the connection
   */
  subscribe({ onDefect, onError, onOpen } = {}) {
    const token = getAccessToken();
    if (!token) return () => {};
    const url = `${BASE_URL}/defects/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    if (onOpen) es.onopen = onOpen;
    es.onmessage = (e) => {
      if (!onDefect || !e.data) return;
      try {
        const defect = JSON.parse(e.data);
        if (defect && defect.id) onDefect(keysToCamel(defect));
      } catch {
        // malformed payload — skip
      }
    };
    if (onError) es.onerror = onError;
    return () => {
      try { es.close(); } catch { /* noop */ }
    };
  },
};

// ─────────────────────────────────────────────────────
// Defect catalog — fetched once per (vehicle_class) and cached in module scope.
// ─────────────────────────────────────────────────────
const _catalogPromises = new Map();  // vehicle_class → Promise

export const catalog = {
  /**
   * GET /defect-catalog?vehicle_class=X (cached per vehicle_class).
   *
   * V2.2: catalog is filtered server-side by vehicle_class (which rules apply
   * to which class). Frontend caches each class independently — switching
   * vehicles re-uses the cache when classes match.
   */
  load(vehicleClass) {
    if (!vehicleClass) {
      return Promise.reject(new Error('vehicle_class is required'));
    }
    // Cache per (vehicle_class + lang) — switching ES↔EN must re-fetch
    // localized labels rather than serve stale text from the previous lang.
    const lang = (() => {
      try {
        return (typeof localStorage !== 'undefined' && localStorage.getItem('nf-lang')) || 'es';
      } catch {
        return 'es';
      }
    })();
    const key = `${vehicleClass}::${lang}`;
    if (_catalogPromises.has(key)) {
      return _catalogPromises.get(key);
    }
    const promise = apiFetch(
      `/defect-catalog?vehicle_class=${encodeURIComponent(vehicleClass)}`
    ).catch((err) => {
      _catalogPromises.delete(key);
      throw err;
    });
    _catalogPromises.set(key, promise);
    return promise;
  },

  /** Force refetch for a specific vehicle_class (or all if not given). */
  invalidate(vehicleClass) {
    if (vehicleClass) _catalogPromises.delete(vehicleClass);
    else _catalogPromises.clear();
  },

  // ─── helpers — operate on a loaded catalog object ───
  partsForSystem(cat, systemId) {
    return cat.parts.filter((p) =>
      p.appearances.some((a) => a.system === systemId)
    );
  },

  /** Returns { groupKey: [parts] }. groupKey is the display_group or '_flat'. */
  partsByGroup(cat, systemId) {
    const groups = {};
    for (const part of cat.parts) {
      const app = part.appearances.find((a) => a.system === systemId);
      if (!app) continue;
      const key = app.displayGroup || '_flat';
      if (!groups[key]) groups[key] = [];
      groups[key].push(part);
    }
    return groups;
  },

  getPart(cat, partId) {
    return cat.parts.find((p) => p.id === partId);
  },

  getDefectType(part, typeId) {
    return part?.defectTypes?.find((t) => t.id === typeId);
  },

  getSystem(cat, systemId) {
    return cat.systems.find((s) => s.id === systemId);
  },

  getPosition(part, posId) {
    return part?.validPositions?.find((p) => p.id === posId);
  },
};

// ─────────────────────────────────────────────────────
// DVIC Template — section-first checklist driven by Amazon DVIC PDFs.
// Cached per (vehicle_class + ownership) so Branded vs Owner/Rented stay
// separate in the cache (they hide branded-only items).
// ─────────────────────────────────────────────────────
const _dvicTemplateCache = new Map();

function _currentLang() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('nf-lang')) || 'es';
  } catch {
    return 'es';
  }
}

export const dvicTemplate = {
  load(vehicleClass, ownership = null) {
    if (!vehicleClass) {
      return Promise.reject(new Error('vehicle_class is required'));
    }
    // Cache per-language so es and en don't pollute each other's strings.
    const cacheKey = `${vehicleClass}::${ownership || 'any'}::${_currentLang()}`;
    if (_dvicTemplateCache.has(cacheKey)) {
      return _dvicTemplateCache.get(cacheKey);
    }
    const params = new URLSearchParams({ vehicle_class: vehicleClass });
    if (ownership) params.set('ownership', ownership);
    const promise = apiFetch(`/dvic-template?${params.toString()}`)
      .catch((err) => {
        _dvicTemplateCache.delete(cacheKey);
        throw err;
      });
    _dvicTemplateCache.set(cacheKey, promise);
    return promise;
  },
  invalidate(vehicleClass = null, ownership = null) {
    if (!vehicleClass) {
      _dvicTemplateCache.clear();
      return;
    }
    const cacheKey = `${vehicleClass}::${ownership || 'any'}::${_currentLang()}`;
    _dvicTemplateCache.delete(cacheKey);
  },
};

// ─────────────────────────────────────────────────────
// Inspection rules (V2.2 source-rule layer: verbatim PDF text + targets).
// Used by the admin Defect Rules catalog view + custom DSP rule creation.
// ─────────────────────────────────────────────────────
export const inspectionRules = {
  /** GET /inspection-rules?vehicle_class=…&section=…&source=…&q=…&active_only=… */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { vehicleClass: 'vehicle_class', activeOnly: 'active_only' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    return apiFetch(`/inspection-rules${q.toString() ? '?' + q.toString() : ''}`);
  },

  /** GET /inspection-rules/{id}. */
  get(id) {
    return apiFetch(`/inspection-rules/${encodeURIComponent(id)}`);
  },

  /**
   * POST /inspection-rules — create a DSP custom rule.
   * body: {
   *   defectText, source?, section?, parts?, classification?, group?, line?,
   *   rsi?, vsa?, notionId?, vehicleClass: [...], targets: [{part, defectType}],
   *   addToWizard?, wizardPartCategory?, wizardPhotoRequired?, wizardRequiresBranding?
   * }
   * Note: targets is opaque — keep its inner keys as-is. We send camelCase
   * here, but the inner `part`/`defectType` of each target object also gets
   * snake_cased by camelToSnake; the backend expects `defect_type` so
   * that's exactly what we want.
   */
  create(body) {
    return apiFetch('/inspection-rules', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
};


// ─────────────────────────────────────────────────────
// Directory (orgs + users) — small lookups for pickers
// ─────────────────────────────────────────────────────
export const directory = {
  /** GET /organizations?orgType=dsp|vendor|platform */
  organizations(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { orgType: 'org_type' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/organizations${qs ? '?' + qs : ''}`);
  },

  /** GET /users?role=&organizationId= */
  users(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { organizationId: 'organization_id' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/users${qs ? '?' + qs : ''}`);
  },
};

// ─────────────────────────────────────────────────────
// Work Orders module
// ─────────────────────────────────────────────────────
/**
 * V2.0 Work Order API surface.
 *
 * Lifecycle endpoints take no body (or a small action payload) and return
 * the updated WorkOrder. The detail endpoint embeds `lineItems`,
 * `defectResolutions`, `ros`, and `notes` so the UI doesn't N+1.
 *
 * Backend route layout: see `apps/api/app/routes/work_orders.py`.
 */
export const workOrders = {
  /**
   * GET /work-orders — list, role-scoped server-side.
   * params: { status?, dspId?, vendorWorkshopId?, assignedToMe?,
   *           vehicleId?, scheduledWithinHours?, hasConfirmedPickup?, limit? }
   * hasConfirmedPickup=true filters to WOs whose primary RO has both a
   * pickup request AND a DSP confirmation (i.e., the SW "Customer
   * Confirmed Pickup" section). hasConfirmedPickup=false yields the
   * inverse (AWAITING CUSTOMER bucket).
   */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = {
      dspId: 'dsp_id',
      vendorWorkshopId: 'vendor_workshop_id',
      assignedToMe: 'assigned_to_me',
      vehicleId: 'vehicle_id',
      scheduledWithinHours: 'scheduled_within_hours',
      hasConfirmedPickup: 'has_confirmed_pickup',
    };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/work-orders${qs ? '?' + qs : ''}`);
  },

  /** GET /work-orders/{id} — detail with line_items + defect_resolutions + ros + notes */
  get(id) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}`);
  },

  // ── Lifecycle transitions ─────────────────────────
  /** POST /work-orders/{id}/accept — vendor accept; generates line items */
  accept(id) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * POST /work-orders/{id}/decline — vendor decline.
   * body: { reason?, declineReasonCode, reroute? } — declineReasonCode is REQUIRED
   *        (one of the codes in `decline_reason_codes`, e.g. 'specialty_required').
   *        reroute defaults to true server-side.
   */
  decline(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/decline`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** POST /work-orders/{id}/start — accepted → in_progress */
  start(id) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /** POST /work-orders/{id}/complete — body: { lastMileage? } */
  complete(id, body = {}) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** POST /work-orders/{id}/cancel — body: { reason? } */
  cancel(id, body = {}) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /work-orders/{id}/assign-technician
   * body: { technicianId | null,
   *         scheduledAt?: ISO string,
   *         repairBucket?: 'overnight' | 'shop' }
   * Setting scheduledAt or repairBucket inline lets the vendor pin the
   * slot at the same time they assign — the same effect as calling
   * `schedule()` separately afterwards.
   */
  assignTechnician(id, body) {
    // Back-compat: callers used to pass just the technicianId scalar.
    const payload = (typeof body === 'object' && body !== null && !Array.isArray(body))
      ? body
      : { technicianId: body };
    return apiFetch(
      `/work-orders/${encodeURIComponent(id)}/assign-technician`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(payload)),
      }
    );
  },

  /**
   * POST /work-orders/{id}/schedule — vendor pins (or clears) the slot.
   * body: { scheduledAt?: ISO | null, repairBucket?: 'overnight' | 'shop' | null }
   * Resetting either field clears `dspResponse` server-side so the DSP
   * re-confirms.
   */
  schedule(id, body = {}) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/schedule`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /work-orders/{id}/dsp-response — DSP confirms / flags slot.
   * body: { response: 'confirmed' | 'not_available', keyLocation?: string }
   */
  dspResponse(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/dsp-response`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /work-orders/{id}/dsp-reschedule — DSP picks a new slot.
   * Use when the originally-proposed time doesn't work. Server sets
   * dsp_response='confirmed' automatically since the DSP is the one
   * picking the slot.
   * body: { scheduledAt: ISO, keyLocation?: string, notes?: string }
   */
  dspReschedule(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/dsp-reschedule`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  // ── Line items (sub-resource) ─────────────────────
  /**
   * POST /work-orders/{id}/line-items — mid-repair addition.
   * body: { description, category, billingType?, estimatedPrice?, customerRequested? }
   *        category: 'defect_repair' | 'customer_request' | 'vendor_addition' |
   *                  'recall' | 'overhead' | 'uncategorized'
   *        billingType: 'amr' | 'cmr' (defaults to 'cmr' server-side)
   */
  addLineItem(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/line-items`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * PATCH /work-orders/{id}/line-items/{liId}
   * body: { description?, estimatedPrice?, finalPrice?, roId?, status?,
   *         statusReason?, declineReasonCode? }
   */
  patchLineItem(id, liId, body) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(id)}/line-items/${encodeURIComponent(liId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  /**
   * POST /work-orders/{id}/line-items/{liId}/defer — flips to deferred,
   * spawns a follow-up RR if category=defect_repair.
   * body: { reasonCode?, statusReason? } — reasonCode defaults to 'parts_unavailable'
   */
  deferLineItem(id, liId, body = {}) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(id)}/line-items/${encodeURIComponent(liId)}/defer`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  // ── Repair Orders (sub-resource) ──────────────────
  /**
   * POST /work-orders/{id}/ros — attach an RO#.
   * body: { roNumber, isPrimary?, modificationReason? }
   * If isPrimary=true, the server demotes the previous primary.
   */
  addRo(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/ros`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * PATCH /work-orders/{id}/ros/{roId}
   * body: { isPrimary?, modificationReason? }
   */
  patchRo(id, roId, body) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(id)}/ros/${encodeURIComponent(roId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  // ── Notes (sub-resource) ──────────────────────────
  /**
   * POST /work-orders/{id}/notes — append a note to the thread.
   * body: { body, authorRole?, channel? }
   *        authorRole: 'customer' | 'vendor_service_writer' | 'technician' | 'admin' | 'system'
   *        channel: 'internal' | 'customer' (iter-1, defaults to 'internal')
   *        (defaults to 'admin' server-side; the front end should pass an
   *        appropriate role based on the current user.)
   */
  addNote(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * GET /work-orders/{id}/notes?channel=internal|customer
   * Filtered list of the WO's notes by channel. DSP users always get
   * channel='customer' regardless of what they pass.
   */
  listNotes(id, { channel } = {}) {
    const q = channel ? `?channel=${encodeURIComponent(channel)}` : '';
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/notes${q}`);
  },

  // ── WO V2 iter-1: vehicle-scoped pickup ───────────
  /**
   * POST /work-orders/{id}/pickup-request — SW action.
   * body: { pickupType: 'overnight_rush' | 'in_shop',
   *         pickupDurationText?: string }
   * Vehicle-scoped fan-out: writes pickup_requested_at + pickup_type +
   * pickup_duration_text to every primary RO on the same vehicle.
   * Returns: { workOrderId, vehicleId, updatedRoIds, updatedWorkOrderIds }
   */
  /**
   * POST /work-orders/manual — SW wizard creates a WO from scratch
   * (mockup pages 4-6). Chains defect creation + auto-approve + bundler
   * + route + optional RO# attach into one atomic call.
   *
   * body: { vehicleId, part, defectType, position?, description?,
   *         reasonCode: 'newly_discovered'|'secondary'|'auto_integrate'|
   *                      'customer_requested'|'other',
   *         vendorWorkshopId?, roNumber? }
   * Returns: { defectId, repairRequestId, workOrderId, workOrderIdStr, routed }
   */
  manualCreate(body) {
    return apiFetch('/work-orders/manual', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  pickupRequest(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/pickup-request`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /work-orders/{id}/confirm-pickup — customer (DSP) action.
   * body: { scheduledStartAt: ISO,
   *         pickupLocation: string,
   *         keyLocation?: string,
   *         pickupNotes?: string }
   * Vehicle-scoped fan-out: writes the confirmation to every primary RO
   * on the vehicle that had a pending pickup_requested_at, AND flips
   * those WOs to status='in_progress'.
   * Returns: { workOrderId, vehicleId, updatedRoIds, inProgressWorkOrderIds }
   */
  confirmPickup(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/confirm-pickup`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /work-orders/{id}/ros/{roId}/sync-event — stamp an RO sync milestone.
   * body: { event: 'parts_ordered'|'parts_received'|'submitted_to_fmc'|
   *                'fmc_approved'|'no_show',
   *         note?: string }
   * Returns: { roId, workOrderId, event, stampedAt, priorValue }
   * The priorValue carries what the column was before — if non-null, the UI
   * should warn the SW ("you already recorded this 4h ago — overwrite?").
   */
  roSyncEvent(id, roId, body) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(id)}/ros/${encodeURIComponent(roId)}/sync-event`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  /**
   * GET /work-orders/{id}/activity?limit=N&offset=M — merged audit timeline.
   * Returns rows from wo_activity_log spanning the WO itself + its child
   * ROs + notes + the parent RR. Used by the WO modal's Activity panel.
   */
  activity(id, { limit = 100, offset = 0 } = {}) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/activity?${q}`);
  },

  /**
   * Subscribe to work-order state-change events via SSE.
   *
   * Mirrors `defects.subscribe`: EventSource can't send Authorization
   * headers, so the JWT rides on `?token=...`. The stream is server-side
   * role-scoped:
   *   - DSPs see their own org's WOs
   *   - vendors see WOs at their workshops
   *   - technicians see WOs at their workshops or assigned to them
   *   - site_admin sees all
   *
   * Envelope: { event, workOrderId, dspId, vendorWorkshopId,
   *             assignedTechnicianId }
   *
   * @returns {() => void} cleanup — call on unmount to close the connection
   */
  subscribe({ onEvent, onError, onOpen } = {}) {
    const token = getAccessToken();
    if (!token) return () => {};
    const url = `${BASE_URL}/work-orders/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    if (onOpen) es.onopen = onOpen;
    es.onmessage = (e) => {
      if (!onEvent || !e.data) return;
      try {
        const envelope = JSON.parse(e.data);
        if (envelope && envelope.event) onEvent(keysToCamel(envelope));
      } catch {
        // malformed payload — skip
      }
    };
    if (onError) es.onerror = onError;
    return () => {
      try { es.close(); } catch { /* noop */ }
    };
  },
};

// ─────────────────────────────────────────────────────
// Vendor workshops — the workshop catalog (V2.0).
// ─────────────────────────────────────────────────────
/**
 * Workshop catalog (distinct from `organizations` rows where org_type=vendor;
 * the workshop adds repair_types[] + status_tracking_mode that drive routing).
 *
 * Auth: site_admin can mutate; everyone else is read-only.
 */
export const vendorWorkshops = {
  /** GET /vendor-workshops — params: { repairType?, includeInactive? } */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { repairType: 'repair_type', includeInactive: 'include_inactive' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/vendor-workshops${qs ? '?' + qs : ''}`);
  },

  /** GET /vendor-workshops/{id} — accepts 'VW-001' or '1' */
  get(id) {
    return apiFetch(`/vendor-workshops/${encodeURIComponent(id)}`);
  },

  /**
   * POST /vendor-workshops — site_admin only.
   * body: { name, organizationId?, statusTrackingMode?, repairTypes?, isActive? }
   *        repairTypes: array of 'mechanical'|'body'|'tires'|'pm'|'cnmr'|
   *                                 'detailing'|'netradyne'
   *        statusTrackingMode: 'external' (default) | 'internal'
   */
  create(body) {
    return apiFetch('/vendor-workshops', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** PATCH /vendor-workshops/{id} — site_admin only. Partial update. */
  patch(id, body) {
    return apiFetch(`/vendor-workshops/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** DELETE /vendor-workshops/{id} — soft-deactivate (sets is_active=false). */
  deactivate(id) {
    return apiFetch(`/vendor-workshops/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

// ─────────────────────────────────────────────────────
// DSP settings (per-DSP V2.0 config).
// ─────────────────────────────────────────────────────
/**
 * Auth: site_admin OR dsp_owner of the same org_id.
 * GET returns platform defaults if no row exists yet — the front end can
 * surface those as the current effective config without special-casing.
 */
export const dspSettings = {
  /** GET /dsp-settings/{dspId} — int id of the organization row */
  get(dspId) {
    return apiFetch(`/dsp-settings/${encodeURIComponent(dspId)}`);
  },

  /**
   * PATCH /dsp-settings/{dspId} — UPSERT.
   * body: {
   *   cmrAutoApproveThreshold?, preauthDefectGroups?,
   *   notes?, reviewSlaHours?, defaultVarianceTolerance?,
   *   bundlingWindowMinutes?
   * }
   */
  patch(dspId, body) {
    return apiFetch(`/dsp-settings/${encodeURIComponent(dspId)}`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
};

// ─────────────────────────────────────────────────────
// Defect reviews (scope approval workflow).
// ─────────────────────────────────────────────────────
/**
 * `queue` returns defects without any review row yet — the manual review
 * UI. Approval calls into the bundler synchronously so the defect lands
 * on an RR right away.
 */
export const defectReviews = {
  /**
   * GET /defect-reviews/queue
   * params: { dspId? (site_admin-only filter), limit? }
   * For dsp_owner the response is always scoped to their org regardless
   * of the dsp_id param.
   */
  queue(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { dspId: 'dsp_id' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/defect-reviews/queue${qs ? '?' + qs : ''}`);
  },

  /** GET /defect-reviews/defect/{defectId} — history, newest first */
  listForDefect(defectId) {
    return apiFetch(
      `/defect-reviews/defect/${encodeURIComponent(defectId)}`
    );
  },

  /** POST /defect-reviews/defect/{defectId}/approve — body: { reason? } */
  approve(defectId, body = {}) {
    return apiFetch(
      `/defect-reviews/defect/${encodeURIComponent(defectId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  /**
   * POST /defect-reviews/defect/{defectId}/reject
   * body: { reason?, rejectReasonCode? }
   * rejectReasonCode (mockup p.9): 'shop_no_capability' | 'illegitimate_defect' | 'other'.
   * 'illegitimate_defect' attributes a negative mark to the defect's
   * `reportedBy` inspector (drives Inspector KPI).
   */
  reject(defectId, body = {}) {
    return apiFetch(
      `/defect-reviews/defect/${encodeURIComponent(defectId)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(camelToSnake(body)),
      }
    );
  },

  /**
   * Subscribe to defect-review state changes (approved / rejected).
   *
   * Auth: JWT as ?token=... (EventSource browser limit). Stream is
   * server-scoped: DSP-side roles see own-org events; site_admin sees
   * everything; vendor / technician roles get nothing (they don't
   * review defects).
   *
   * Envelope: { event: 'approved' | 'rejected', defectId, dspId,
   *             vendorWorkshopId? }
   *
   * @returns {() => void} cleanup — call on unmount to close the connection
   */
  subscribe({ onEvent, onError, onOpen } = {}) {
    const token = getAccessToken();
    if (!token) return () => {};
    const url = `${BASE_URL}/defect-reviews/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    if (onOpen) es.onopen = onOpen;
    es.onmessage = (e) => {
      if (!onEvent || !e.data) return;
      try {
        const envelope = JSON.parse(e.data);
        if (envelope && envelope.event) onEvent(keysToCamel(envelope));
      } catch {
        // malformed payload — skip
      }
    };
    if (onError) es.onerror = onError;
    return () => {
      try { es.close(); } catch { /* noop */ }
    };
  },
};

// ─────────────────────────────────────────────────────
// Repair Requests (the bundling layer between defects and WOs).
// ─────────────────────────────────────────────────────
/**
 * Created by the bundler when a defect is approved. The UI mostly reads
 * these + offers a force-route and cancel button. The cron driver
 * (`bundle-route-cron` CLI) is the production path for window-elapsed
 * routing; the force-route here lets operators push manually.
 */
export const repairRequests = {
  /**
   * GET /repair-requests — role-scoped.
   * params: { status?, dspId? (site_admin only), limit? }
   */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = { dspId: 'dsp_id' };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/repair-requests${qs ? '?' + qs : ''}`);
  },

  /** GET /repair-requests/{id} — accepts 'RR-NNNNN' or int */
  get(id) {
    return apiFetch(`/repair-requests/${encodeURIComponent(id)}`);
  },

  /** POST /repair-requests/{id}/route — force-route now, skip window */
  route(id) {
    return apiFetch(`/repair-requests/${encodeURIComponent(id)}/route`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * POST /repair-requests/{id}/cancel — cascades to any non-terminal WOs.
   * body: { reason? }
   */
  cancel(id, body = {}) {
    return apiFetch(`/repair-requests/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /repair-requests/{id}/defer-defect — vendor declines a single
   * defect during review. Flips the source DefectResolution to DEFERRED,
   * creates a follow-up RR with parent_repair_request_id pointing back
   * here, and auto-routes the new RR to the next eligible vendor.
   *
   * body: {
   *   defectId,              // required
   *   reason,                // required, free text
   *   repairType?,           // optional override; backend re-derives from defect if missing
   *   targetWorkshopId?,     // optional pin (otherwise router picks first eligible)
   *   excludeWorkshopIds?,   // skip these vendors on the re-route
   * }
   */
  deferDefect(id, body) {
    return apiFetch(`/repair-requests/${encodeURIComponent(id)}/defer-defect`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * POST /repair-requests/{id}/add-defect — mid-find. Forces
   * source='shop_finding'. Lets the SW add a defect the technician
   * found mid-repair without leaving the WO view.
   */
  addDefect(id, body) {
    return apiFetch(`/repair-requests/${encodeURIComponent(id)}/add-defect`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
};

// ─────────────────────────────────────────────────────
// Dashboards — counter aggregates for SW + DSP homes.
// ─────────────────────────────────────────────────────
/**
 * Read-only count rollups powering the chips at the top of the WO v2
 * Service Writer and Customer (DSP) dashboards. Each endpoint packs
 * 5-8 counts in one round-trip so the dashboard renders without an
 * N-fanout of separate queries.
 *
 * Backend: app/routes/dashboards.py.
 */
export const dashboards = {
  /**
   * GET /dashboards/sw/{vendorWorkshopId}/counters — vendor-scoped.
   * Returns: { pending, pendingParts, pendingFmc, readyToSchedule,
   *            awaitingCustomer, inProgress, declined, completed, cancelled }
   * Tenancy: vendor_admin / service_writer / technician must own the
   * workshop; site_admin can hit any.
   */
  swCounters(vendorWorkshopId) {
    const id = encodeURIComponent(vendorWorkshopId);
    return apiFetch(`/dashboards/sw/${id}/counters`);
  },

  /**
   * GET /dashboards/vendor-home/{ws_id}/counters — landing-page tiles.
   * Returns: { adHocDefects24h, rushOrders, vansInspectedToday,
   *            vansTotal, newDefectsToday, defectsPendingFmc,
   *            defectsPendingFmcTotal, scheduledRepairsCount,
   *            defectsRepairedWeek, defectsRepairedPctChange,
   *            pendingFeedback }
   * Optional dsp_id filter narrows everything to one customer.
   */
  vendorHomeCounters(vendorWorkshopId, { dspId } = {}) {
    const q = new URLSearchParams();
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    const qs = q.toString();
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/counters${qs ? '?' + qs : ''}`
    );
  },

  /**
   * GET /dashboards/vendor-home/{ws_id}/ad-hoc-defects — modal list.
   * Returns: [{ id, idStr, part, defectType, position, source,
   *             reportedAt, dspId, dspName }]
   */
  adHocDefects(vendorWorkshopId, { hours = 24, dspId } = {}) {
    const q = new URLSearchParams();
    if (hours) q.set('hours', String(hours));
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/ad-hoc-defects?${q.toString()}`
    );
  },

  // Daily approved vs repaired — 7-day bar chart on VendorHome.
  // Sends the user's JS-style timezone offset so the backend groups
  // each row by the inspector's LOCAL day, not UTC. Without this, EDT
  // users see the rightmost bar a day behind any time UTC and their
  // wall-clock day don't agree (Michael's bug 2026-05-26).
  dailyDefects(vendorWorkshopId, { days = 7, dspId } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    q.set('tz_offset_minutes', String(new Date().getTimezoneOffset()));
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/daily-defects?${q.toString()}`
    );
  },
  // Open defects donut — grouped by source.
  openDefectsBreakdown(vendorWorkshopId, { dspId } = {}) {
    const q = new URLSearchParams();
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    const qs = q.toString();
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/open-defects-breakdown${qs ? '?' + qs : ''}`
    );
  },
  // DSP Home (RealDVIC) charts — mirror of vendor-home but scoped
  // to one DSP. The current DSP user is auto-scoped server-side.
  dspDailyDefects(dspId, { days = 7 } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    q.set('tz_offset_minutes', String(new Date().getTimezoneOffset()));
    return apiFetch(
      `/dashboards/dsp/${encodeURIComponent(dspId)}/daily-defects?${q.toString()}`
    );
  },
  dspOpenDefectsBreakdown(dspId) {
    return apiFetch(
      `/dashboards/dsp/${encodeURIComponent(dspId)}/open-defects-breakdown`
    );
  },

  // Inspector Performance list (admin / DSP-side).
  inspectorPerformance({ days = 30, dspId } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    return apiFetch(`/dashboards/inspector-performance?${q.toString()}`);
  },

  // Upcoming DVIC — per-DSP "ready for tonight" confirmation chips.
  upcomingDvic(vendorWorkshopId) {
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/upcoming-dvic`
    );
  },
  confirmUpcomingDvic(vendorWorkshopId, dspId) {
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/upcoming-dvic/${encodeURIComponent(dspId)}/confirm`,
      { method: 'POST' },
    );
  },

  // QC DVIC schedules — replaces the chip flow. Vendor admin schedules
  // a real appointment (date + time + DSP); DSP customer home polls
  // /dsp/{id}/next-qc-dvic and shows the readiness banner when an
  // appointment is within the 12-hour window.
  listDvicSchedules(vendorWorkshopId, { includePast = false } = {}) {
    const q = new URLSearchParams();
    if (includePast) q.set('include_past', 'true');
    const qs = q.toString();
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/dvic-schedules${qs ? '?' + qs : ''}`
    );
  },
  createDvicSchedule(vendorWorkshopId, { dspId, scheduledAt, notes }) {
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/dvic-schedules`,
      {
        method: 'POST',
        body: JSON.stringify({
          dsp_id: dspId,
          scheduled_at: scheduledAt,
          notes: notes || null,
        }),
      },
    );
  },
  cancelDvicSchedule(vendorWorkshopId, scheduleId, { reason } = {}) {
    return apiFetch(
      `/dashboards/vendor-home/${encodeURIComponent(vendorWorkshopId)}/dvic-schedules/${encodeURIComponent(scheduleId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      },
    );
  },
  // DSP-side: nearest upcoming QC DVIC within the readiness banner
  // window (12 hours). Returns null when there's nothing scheduled
  // soon — frontend then hides the banner.
  dspNextQcDvic(dspId) {
    return apiFetch(
      `/dashboards/dsp/${encodeURIComponent(dspId)}/next-qc-dvic`
    );
  },

  /**
   * GET /dashboards/dsp/{dspId}/counters — DSP-scoped.
   * Returns: { vansInService, approveCost, approveDefects, confirmPickup,
   *            inProgress }
   * Tenancy: any DSP role (owner/manager/inspector/viewer) for own DSP;
   * site_admin can hit any.
   */
  dspCounters(dspId) {
    const id = encodeURIComponent(dspId);
    return apiFetch(`/dashboards/dsp/${id}/counters`);
  },
};

// ─────────────────────────────────────────────────────
// Uploads module — presigned URL flow
// ─────────────────────────────────────────────────────
export const uploads = {
  /**
   * POST /uploads/presigned — mint a PUT URL for a new photo.
   * { kind: 'defect'|'inspection'|'work_order', parentId, filename, contentType }
   */
  presigned({ kind, parentId, filename, contentType }) {
    return apiFetch('/uploads/presigned', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        parent_id: parentId,
        filename,
        content_type: contentType,
      }),
    });
  },

  /**
   * Upload a file to a presigned URL. Raw PUT, no auth header (the URL's
   * signature IS the auth). Returns when the upload completes.
   */
  async putToPresigned(uploadUrl, blob, contentType) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': contentType },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload failed (${res.status}): ${text.slice(0, 200)}`);
    }
  },
};

// ─────────────────────────────────────────────────────
// camelCase → snake_case (for request bodies)
// ─────────────────────────────────────────────────────
const camelToSnakeStr = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

// Mirror of OPAQUE_JSON_KEYS in keysToCamel — these field VALUES are opaque
// JSON payloads (user details dict, JSON schema, threshold dict). Their inner
// keys must NOT be transformed in either direction; they round-trip verbatim.
const OPAQUE_JSON_KEYS_OUT = new Set([
  'details', 'detailsSchema', 'details_schema',
  'threshold',
]);

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj !== null && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const snakeKey = camelToSnakeStr(k);
        if (OPAQUE_JSON_KEYS_OUT.has(k) || OPAQUE_JSON_KEYS_OUT.has(snakeKey)) {
          return [snakeKey, v];
        }
        return [snakeKey, camelToSnake(v)];
      })
    );
  }
  return obj;
}

// ─────────────────────────────────────────────────────
// Rewards program — vendor loyalty config (mockup p.11)
// ─────────────────────────────────────────────────────
export const rewards = {
  /** GET /rewards/programs/{workshopId} — settings + tiers in one shot */
  getProgram(workshopId) {
    return apiFetch(`/rewards/programs/${encodeURIComponent(workshopId)}`);
  },
  /** PUT /rewards/programs/{workshopId} — body: { vendorBucksPct, vendorBucksDurationMonths } */
  upsertProgram(workshopId, body) {
    return apiFetch(`/rewards/programs/${encodeURIComponent(workshopId)}`, {
      method: 'PUT',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
  /** POST /rewards/programs/{workshopId}/tiers — body: { tierOrder, metricLabel, metricTarget, rewardLabel } */
  addTier(workshopId, body) {
    return apiFetch(`/rewards/programs/${encodeURIComponent(workshopId)}/tiers`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
  /** PATCH /rewards/tiers/{tierId} */
  patchTier(tierId, body) {
    return apiFetch(`/rewards/tiers/${encodeURIComponent(tierId)}`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },
  /** DELETE /rewards/tiers/{tierId} */
  deleteTier(tierId) {
    return apiFetch(`/rewards/tiers/${encodeURIComponent(tierId)}`, {
      method: 'DELETE',
    });
  },
};

// ─────────────────────────────────────────────────────
// Vendor bucks ledger / balance (iter-2 accrual engine)
// ─────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────
// Vendor Scorecard — feedback collection + aggregated metrics.
// ─────────────────────────────────────────────────────
export const vendorScorecard = {
  /**
   * GET /vendor-scorecard/pending-feedback?dspId=&days=
   * DSP-side: list of completed WOs they haven't reviewed yet.
   * Default: NO days filter — every unrated completed WO regardless
   * of age, so the home-tile counter and the modal queue match the
   * customer's mental model of "anything I owe a rating for". Pass
   * `days` only when you actually want a recent window.
   */
  pending({ dspId, days } = {}) {
    const q = new URLSearchParams();
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    if (days != null) q.set('days', String(days));
    return apiFetch(`/vendor-scorecard/pending-feedback?${q.toString()}`);
  },

  /**
   * POST /vendor-scorecard/feedback
   * body: { workOrderId, vote: 'up'|'down', reason?, escalate?,
   *         impressiveAttribute?, negativeAttribute? }
   */
  submit(body) {
    return apiFetch('/vendor-scorecard/feedback', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * GET /vendor-scorecard/{workshopId}?days=90
   * Aggregated scorecard for a single workshop.
   */
  get(workshopId, { days = 90 } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    return apiFetch(
      `/vendor-scorecard/${encodeURIComponent(workshopId)}?${q.toString()}`
    );
  },

  /**
   * GET /vendor-scorecard/{workshopId}/benchmarks
   * Cross-vendor benchmarks for the comparison chart.
   */
  benchmarks(workshopId, { days = 90, dspId } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    return apiFetch(
      `/vendor-scorecard/${encodeURIComponent(workshopId)}/benchmarks?${q.toString()}`
    );
  },
};

export const vendorBucks = {
  /**
   * GET /vendor-bucks/{workshopId}/balance?dsp_id=
   * Returns: [{ vendorWorkshopId, dspId, dspName, balance }]
   * — one row per DSP this workshop has accrued bucks for.
   */
  balance(workshopId, { dspId } = {}) {
    const q = new URLSearchParams();
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    const qs = q.toString();
    return apiFetch(
      `/vendor-bucks/${encodeURIComponent(workshopId)}/balance${qs ? '?' + qs : ''}`,
    );
  },
  /**
   * GET /vendor-bucks/{workshopId}/ledger?dsp_id=&limit=
   * Returns newest-first ledger entries (accrual / redemption / etc).
   */
  ledger(workshopId, { dspId, limit = 100 } = {}) {
    const q = new URLSearchParams();
    if (dspId != null && dspId !== '') q.set('dsp_id', String(dspId));
    if (limit) q.set('limit', String(limit));
    return apiFetch(
      `/vendor-bucks/${encodeURIComponent(workshopId)}/ledger?${q.toString()}`,
    );
  },
};

export { APIError };
