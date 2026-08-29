import { config, setClientId } from './config.js';

let tokenInfo = null; // { access_token, expires_at } — memory only, never localStorage
let profileCache = null;

const SS = {
  state:    'veltrix.oauthState',
  clientId: 'veltrix.pendingClientId',
};

const b64u = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const rand = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));

export function token() { return tokenInfo?.access_token || null; }
export function isAuthed() { return !!(tokenInfo && tokenInfo.expires_at > Date.now() + 5000); }
export function msUntilExpiry() { return tokenInfo ? Math.max(0, tokenInfo.expires_at - Date.now()) : 0; }

// location.origin is always protocol+host with no trailing slash.
// Register this EXACT string in Google Cloud Console → Authorized Redirect URIs.
function redirectUri() {
  return location.origin;
}

/**
 * Start the Implicit Grant flow.
 * Google returns the access token directly in the URL hash — no backend, no client_secret needed.
 */
export async function connect(clientId) {
  const state = rand(16);
  sessionStorage.setItem(SS.state, state);
  sessionStorage.setItem(SS.clientId, clientId);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'token');   // Implicit flow — token returned in hash
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  location.assign(url.toString());
}

function clearPending() {
  Object.values(SS).forEach(k => sessionStorage.removeItem(k));
}

/**
 * Handle Google's implicit flow redirect.
 * The access token arrives in location.hash, NOT location.search.
 */
export async function handleRedirect() {
  // Check URL hash first (implicit flow returns #access_token=...&expires_in=...)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const expiresIn   = hash.get('expires_in');
  const hashError   = hash.get('error');

  // Also check query string for error codes (redirect_uri_mismatch etc.)
  const query = new URLSearchParams(location.search);
  const queryError = query.get('error');
  const hasActivity = accessToken || hashError || queryError;

  if (!hasActivity) return false;

  // Clean URL immediately
  history.replaceState({}, '', location.pathname);

  const err = hashError || queryError;
  if (err) {
    clearPending();
    throw new Error(err === 'access_denied'
      ? 'Access was declined at the Google consent screen.'
      : `Google returned: ${err}`);
  }

  const expected = sessionStorage.getItem(SS.state);
  const returnedState = hash.get('state');
  const clientId = sessionStorage.getItem(SS.clientId) || config.clientId;
  clearPending();

  if (!expected || returnedState !== expected) {
    throw new Error('OAuth state mismatch — please try connecting again.');
  }
  if (!accessToken) {
    throw new Error('Google did not return an access token. Please try again.');
  }
  if (clientId !== config.clientId) setClientId(clientId);

  tokenInfo = {
    access_token: accessToken,
    expires_at:   Date.now() + (parseInt(expiresIn, 10) || 3600) * 1000,
  };
  profileCache = null;

  // Immediately validate with Gmail API
  try {
    const check = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!check.ok) {
      tokenInfo = null;
      const errBody = await check.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message ||
        `Gmail API returned HTTP ${check.status}. Make sure the Gmail API is enabled in Google Cloud Console.`
      );
    }
    profileCache = await check.json();
  } catch (gmailErr) {
    if (tokenInfo === null) throw gmailErr; // already cleared
    throw new Error('Could not verify Gmail access: ' + gmailErr.message);
  }

  return true;
}

export async function ensureToken() {
  if (isAuthed()) return tokenInfo.access_token;
  tokenInfo = null;
  throw new Error('SESSION_EXPIRED');
}

// Restart the OAuth dance with the client ID already on file.
export async function reconnect() {
  const id = config.clientId || sessionStorage.getItem(SS.clientId);
  if (!id) throw new Error('NO_CLIENT_ID');
  return connect(id);
}

export function disconnect() {
  const t = tokenInfo?.access_token;
  tokenInfo = null;
  profileCache = null;
  clearPending();
  if (t) {
    // Best-effort revoke
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      keepalive: true,
    }).catch(() => {});
  }
}

export async function fetchProfile() {
  if (profileCache) return profileCache;
  const t = await ensureToken();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'SESSION_EXPIRED' : 'Gmail profile unavailable');
  profileCache = await res.json();
  return profileCache;
}
