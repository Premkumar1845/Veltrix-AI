import { config, setClientId } from './config.js';

let tokenInfo = null; // { access_token, expires_at } — memory only, never localStorage
let profileCache = null;

const SS = {
  verifier: 'veltrix.codeVerifier',
  state: 'veltrix.oauthState',
  clientId: 'veltrix.pendingClientId',
};

const b64u = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));

async function pkcePair() {
  const verifier = rand(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64u(digest) };
}

export function token() { return tokenInfo?.access_token || null; }
export function isAuthed() { return !!(tokenInfo && tokenInfo.expires_at > Date.now() + 5000); }
export function msUntilExpiry() { return tokenInfo ? Math.max(0, tokenInfo.expires_at - Date.now()) : 0; }

const redirectUri = () => location.origin + location.pathname;

export async function connect(clientId) {
  const { verifier, challenge } = await pkcePair();
  const state = rand(16);
  sessionStorage.setItem(SS.verifier, verifier);
  sessionStorage.setItem(SS.state, state);
  sessionStorage.setItem(SS.clientId, clientId);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // No refresh token: a browser-only client cannot store one safely, so the
  // session lasts as long as the access token and then asks to reconnect.
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  location.assign(url.toString());
}

function clearPending() {
  Object.values(SS).forEach(k => sessionStorage.removeItem(k));
}

export async function handleRedirect() {
  const p = new URLSearchParams(location.search);
  const code = p.get('code');
  const err = p.get('error');

  if (!code && !err) return false;
  history.replaceState({}, '', location.pathname);

  if (err) {
    clearPending();
    throw new Error(err === 'access_denied'
      ? 'Access was declined at the Google consent screen.'
      : `Google returned an error: ${err}`);
  }

  const expected = sessionStorage.getItem(SS.state);
  const verifier = sessionStorage.getItem(SS.verifier);
  const clientId = sessionStorage.getItem(SS.clientId) || config.clientId;
  clearPending();

  // A mismatched or missing state means this redirect did not originate here.
  if (!expected || p.get('state') !== expected) throw new Error('OAuth state mismatch — sign-in was not completed here.');
  if (!verifier) throw new Error('Sign-in session was lost. Please try connecting again.');
  if (!clientId) throw new Error('Missing OAuth Client ID.');
  if (clientId !== config.clientId) setClientId(clientId);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error_description || 'Token exchange failed');
  }

  const tok = await res.json();
  if (!tok.access_token) throw new Error('Google did not return an access token.');
  tokenInfo = {
    access_token: tok.access_token,
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
  };
  profileCache = null;
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
    // Best-effort revoke so the grant does not linger after the user signs out.
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
