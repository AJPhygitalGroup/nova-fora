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

export function keysToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (obj !== null && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [snakeToCamel(k), keysToCamel(v)])
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

  /** POST /inspections/{id}/defects — add a defect to a DRAFT, returns FD-xxx */
  addDefect(inspectionId, body) {
    return apiFetch(
      `/inspections/${encodeURIComponent(inspectionId)}/defects`,
      { method: 'POST', body: JSON.stringify(camelToSnake(body)) }
    );
  },

  /** DELETE /inspections/{id}/defects/{defectId} — remove from DRAFT */
  removeDefect(inspectionId, defectId) {
    return apiFetch(
      `/inspections/${encodeURIComponent(inspectionId)}/defects/${encodeURIComponent(defectId)}`,
      { method: 'DELETE' }
    );
  },

  /** POST /inspections/{id}/submit — finalize DRAFT */
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
// Defects module
// ─────────────────────────────────────────────────────
export const defects = {
  /**
   * GET /defects — flat list across all inspections (role-scoped server-side).
   * params: { dspId?, status?, severity?, vehicleId?, dateFrom?, dateTo?, page?, perPage? }
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
    return apiFetch(`/defects${qs ? '?' + qs : ''}`);
  },

  /** PATCH /defects/{id} — update workflow status */
  updateStatus(id, status) {
    return apiFetch(`/defects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
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
};

// ─────────────────────────────────────────────────────
// Defect catalog — fetched once per session and cached in module scope.
// ─────────────────────────────────────────────────────
let _catalogPromise = null;

export const catalog = {
  /**
   * GET /defect-catalog (cached). Returns the response unchanged after
   * camelCase normalization. Use the helpers below to slice it.
   */
  load() {
    if (!_catalogPromise) {
      _catalogPromise = apiFetch('/defect-catalog').catch((err) => {
        _catalogPromise = null;  // allow retry on failure
        throw err;
      });
    }
    return _catalogPromise;
  },

  /** Force refetch (e.g. after admin edit). */
  invalidate() {
    _catalogPromise = null;
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

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj !== null && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [camelToSnakeStr(k), camelToSnake(v)])
    );
  }
  return obj;
}

export { APIError };
