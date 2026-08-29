import { config, setClientId } from './config.js';

let tokenInfo = null; // { access_token, expires_at } — memory only, never localStorage
let profileCache = null;

const SS = {
  verifier: 'veltrix.codeVerifier',
  state:    'veltrix.oauthState',
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

// Explicit, stable redirect URI — avoids mismatch when running behind Vercel rewrites
// or when location.pathname is anything other than '/'.
function redirectUri() {
  const { hostname } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${location.protocol}//${location.host}`;
  }
  // Production — always use the canonical Vercel origin, no trailing slash.
  return 'https://veltrix-ai-nxtwave.vercel.app';
}

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
  const err  = p.get('error');

  if (!code && !err) return false;

  // Clean up the URL immediately so a reload doesn't re-trigger this.
  history.replaceState({}, '', location.pathname);

  if (err) {
    clearPending();
    const msg = err === 'access_denied'
      ? 'Access was declined at the Google consent screen.'
      : `Google returned an error: ${err}`;
    throw new Error(msg);
  }

  const expected = sessionStorage.getItem(SS.state);
  const verifier = sessionStorage.getItem(SS.verifier);
  const clientId = sessionStorage.getItem(SS.clientId) || config.clientId;
  clearPending();

  if (!expected || p.get('state') !== expected) {
    throw new Error('OAuth state mismatch — this sign-in did not originate from this tab. Please try again.');
  }
  if (!verifier) {
    throw new Error('Sign-in session was lost. Please click "Connect Gmail" again.');
  }
  if (!clientId) {
    throw new Error('Missing Google OAuth Client ID. Check js/config.js.');
  }
  if (clientId !== config.clientId) setClientId(clientId);

  // Exchange authorization code for an access token.
  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
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
  } catch (networkErr) {
    throw new Error('Network error during token exchange. Check your internet connection.');
  }

  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch (_) {}
    const msg = detail.error_description || detail.error || `Token exchange failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const tok = await res.json();
  if (!tok.access_token) throw new Error('Google did not return an access token. Please try again.');

  tokenInfo = {
    access_token: tok.access_token,
    expires_at:   Date.now() + (tok.expires_in || 3600) * 1000,
  };
  profileCache = null;

  // Validate the token with Gmail immediately — surfaces invalid_grant and
  // scope errors before the user reaches the inbox.
  try {
    const check = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!check.ok) {
      tokenInfo = null;
      const errBody = await check.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Gmail API returned ${check.status}. Make sure the Gmail API is enabled in Google Cloud Console.`);
    }
    profileCache = await check.json();
  } catch (gmailErr) {
    if (gmailErr.message.startsWith('Gmail API')) throw gmailErr;
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
