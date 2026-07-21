// Single place that talks to the API.
//
// Two things this exists to solve:
//   1. Components used to read localStorage directly and never handled a 401, so an
//      expired access token surfaced as a generic error toast.
//   2. POST /auth/refresh *rotates* the refresh token. Two concurrent refreshes with
//      the same token means the second one gets 401 and logs the user out, so refresh
//      is single-flighted here and every caller awaits the same in-flight promise.

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

export const persistSession = (accessToken, refreshToken) => {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
};

export const clearStoredSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

// AuthContext registers here so it can drop React state when the session dies.
let sessionExpiredHandler = null;
export const onSessionExpired = (handler) => {
  sessionExpiredHandler = handler;
};

// Fired when the API answers 402, i.e. the trial or paid period has lapsed and the
// request was a write. Reads and CSV export are never gated, so this only surfaces
// on an action the user explicitly took.
let paymentRequiredHandler = null;
export const onPaymentRequired = (handler) => {
  paymentRequiredHandler = handler;
};

let inFlightRefresh = null;

export const refreshAccessToken = async () => {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearStoredSession();
      sessionExpiredHandler?.();
      return null;
    }

    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      clearStoredSession();
      sessionExpiredHandler?.();
      return null;
    }

    const data = await res.json();
    persistSession(data.access_token, data.refresh_token);
    return data;
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
};

/**
 * fetch() with the bearer token attached, retrying once through a token refresh
 * when the API answers 401. Returns the raw Response so callers keep control of
 * status handling and body parsing.
 */
export const apiFetch = async (path, options = {}) => {
  const buildInit = (token) => {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    // Let the browser set the boundary for multipart bodies.
    if (options.body !== undefined && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return { ...options, headers };
  };

  let response = await fetch(path, buildInit(getToken()));

  if (response.status === 402) {
    paymentRequiredHandler?.();
    return response;
  }

  if (response.status !== 401) return response;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return response;

  response = await fetch(path, buildInit(getToken()));
  return response;
};

/** apiFetch + JSON parsing, throwing the API's `detail` message on failure. */
export const apiJson = async (path, options = {}) => {
  const res = await apiFetch(path, options);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.detail || `Request failed with status ${res.status}`);
  }
  return payload;
};
