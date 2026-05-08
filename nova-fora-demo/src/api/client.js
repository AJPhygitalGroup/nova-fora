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

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

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
export const workOrders = {
  /**
   * GET /work-orders — list with role scoping + filters.
   * params: {
   *   dspId?, vendorId?, status?, vehicleId?, technicianId?,
   *   rushOnly?, dateFrom?, dateTo?, page?, perPage?
   * }
   */
  list(params = {}) {
    const q = new URLSearchParams();
    const paramMap = {
      dspId: 'dsp_id',
      vendorId: 'vendor_id',
      vehicleId: 'vehicle_id',
      technicianId: 'technician_id',
      rushOnly: 'rush_only',
      dateFrom: 'date_from',
      dateTo: 'date_to',
      perPage: 'per_page',
    };
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(paramMap[k] || k, String(v));
    }
    const qs = q.toString();
    return apiFetch(`/work-orders${qs ? '?' + qs : ''}`);
  },

  /** GET /work-orders/{id} — full detail incl. items + resolved defect labels */
  get(id) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}`);
  },

  /**
   * POST /work-orders — create from N defects.
   * body: {
   *   vendorId, items: [{ defectId, repairNotes?, linePartsCost?, lineLaborCost? }],
   *   flags? ['rush_order'|'stale'|...], scheduledAt?, notes?, fmc?, roNumber?
   * }
   */
  create(body) {
    return apiFetch('/work-orders', {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /**
   * PATCH /work-orders/{id}/status — state-machine validated transition.
   * body: { status, declineReason?, cancelReason?, scheduledAt?, notesAppend? }
   * Required side fields per target:
   *   - 'scheduled' → scheduledAt
   *   - 'declined'  → declineReason
   *   - 'canceled'  → cancelReason
   */
  updateStatus(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** PATCH /work-orders/{id}/assign — vendor assigns/un-assigns a tech.
   * body: { technicianId | null, notesAppend? } */
  assign(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/assign`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** PATCH /work-orders/{id}/quote — vendor sets parts/labor/RO#.
   * body: { partsCost?, laborCost?, roNumber? } */
  updateQuote(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/quote`, {
      method: 'PATCH',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** POST /work-orders/{id}/items — add more defects to existing WO */
  addItems(id, items) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: camelToSnake(items) }),
    });
  },

  /** DELETE /work-orders/{id}/items/{itemId} — un-bundle a defect */
  removeItem(woId, itemId) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(woId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' }
    );
  },

  /** GET /work-orders/{id}/photos */
  listPhotos(id) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/photos`);
  },

  /** POST /work-orders/{id}/photos — commit after presigned PUT succeeds */
  commitPhoto(id, body) {
    return apiFetch(`/work-orders/${encodeURIComponent(id)}/photos`, {
      method: 'POST',
      body: JSON.stringify(camelToSnake(body)),
    });
  },

  /** DELETE /work-orders/{id}/photos/{photoId} — soft delete */
  deletePhoto(woId, photoId) {
    return apiFetch(
      `/work-orders/${encodeURIComponent(woId)}/photos/${encodeURIComponent(photoId)}`,
      { method: 'DELETE' }
    );
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

export { APIError };
