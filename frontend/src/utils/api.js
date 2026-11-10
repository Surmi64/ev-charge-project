// Single place that talks to the API.
//
// Two things this exists to solve:
//   1. Components used to read localStorage directly and never handled a 401, so an
//      expired access token surfaced as a generic error toast.
//   2. POST /auth/refresh *rotates* the refresh token. Two concurrent refreshes with
//      the same token means the second one gets 401 and logs the user out, so refresh
//      is single-flighted here and every caller awaits the same in-flight promise.

// The access token lives in this module's memory only, and the refresh token in an
// httpOnly cookie the server sets — page scripts never see it, so an XSS bug cannot
// carry a 30 day session away. A reload therefore starts with no access token and
// gets one from the cookie (AuthContext's restore).
//
// Before the cookie, both tokens sat in localStorage. LEGACY_* are read once so that
// people signed in then are not thrown out: the old refresh token is traded for a
// cookie on the first refresh and both keys are removed.
const LEGACY_TOKEN_KEY = 'token';
const LEGACY_REFRESH_KEY = 'refreshToken';
// Not a secret: only whether this browser was signed in, so a visitor who never was
// does not send a refresh that can only fail on every page load.
const SIGNED_IN_KEY = 'signedIn';
// The fleet whose records this tab works on: the owner's account id, or nothing for
// the person's own account. Sent on every request; the server checks membership each
// time, so a stale value costs one refused request, never someone else's data.
const WORKSPACE_KEY = 'workspace';
const WORKSPACE_HEADER = 'X-Mileage-Workspace';
// Every tab of the browser shares the one refresh cookie, and the server rotates it on
// each use; the lock makes tabs take turns so each presents the cookie the last left.
const REFRESH_LOCK = 'mileage-auth-refresh';

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode, site data off): the session still works for this
    // page; it just is not remembered as signed in across a reload.
  }
};

export const getWorkspace = () => readStorage(WORKSPACE_KEY);

export const setWorkspace = (ownerId) => {
  writeStorage(WORKSPACE_KEY, ownerId === null || ownerId === undefined ? null : String(ownerId));
};

let accessToken = null;

export const getToken = () => accessToken;

/** Whether a reload should try to restore a session from the cookie. */
export const mayHaveSession = () => Boolean(readStorage(SIGNED_IN_KEY) || readStorage(LEGACY_REFRESH_KEY));

export const persistSession = (nextAccessToken) => {
  accessToken = nextAccessToken;
  writeStorage(SIGNED_IN_KEY, '1');
  writeStorage(LEGACY_TOKEN_KEY, null);
  writeStorage(LEGACY_REFRESH_KEY, null);
};

export const clearStoredSession = () => {
  accessToken = null;
  writeStorage(SIGNED_IN_KEY, null);
  writeStorage(LEGACY_TOKEN_KEY, null);
  writeStorage(LEGACY_REFRESH_KEY, null);
  setWorkspace(null);
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

// Fired when the server says the workspace header names a fleet the person is no
// longer in. The header is already cleared by then; the handler re-reads the context.
let workspaceInvalidHandler = null;
export const onWorkspaceInvalid = (handler) => {
  workspaceInvalidHandler = handler;
};

let inFlightRefresh = null;

const requestRefresh = async () => {
  const legacy = readStorage(LEGACY_REFRESH_KEY);
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(legacy ? { refresh_token: legacy } : {}),
  });
  if (!res.ok) return null;
  return res.json();
};

export const refreshAccessToken = async () => {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    // Older browsers without Web Locks refresh unserialised; the server honours the
    // token a rotation just replaced for a short while, which covers two tabs racing.
    const data = navigator.locks?.request
      ? await navigator.locks.request(REFRESH_LOCK, requestRefresh)
      : await requestRefresh();

    if (!data) {
      clearStoredSession();
      sessionExpiredHandler?.();
      return null;
    }

    persistSession(data.access_token);
    return data;
  })();

  try {
    return await inFlightRefresh;
  } catch {
    // Network failure: the session may well be fine, so nothing is cleared.
    return null;
  } finally {
    inFlightRefresh = null;
  }
};

/** Revoke this browser's session on the server and forget it here. */
export const endSession = async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Best effort; the local session is cleared either way.
  }
  clearStoredSession();
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
    const workspace = getWorkspace();
    if (workspace && !headers[WORKSPACE_HEADER]) headers[WORKSPACE_HEADER] = workspace;
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

  if (response.status === 403 && response.headers.get('X-Mileage-Workspace-Invalid')) {
    setWorkspace(null);
    workspaceInvalidHandler?.();
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
