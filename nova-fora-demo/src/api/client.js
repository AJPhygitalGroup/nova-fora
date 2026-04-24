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
  constructor(message, status, detail) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.detail = detail;
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
