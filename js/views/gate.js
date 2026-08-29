import { connect } from '../oauth.js';
import { config, setMode } from '../config.js';
import { $, esc } from '../utils.js';

export function gate(root, message = '') {
  root.innerHTML = `
  <div class="gate-page">
    <form class="gate" id="gateForm">
      <h2>Connect your Gmail</h2>
      <p>Sign in with Google using OAuth 2.0. Your password is never requested, and access tokens remain in browser memory only.</p>
      
      ${message ? `
      <div style="background:var(--bad-soft);border:1px solid var(--bad);border-radius:10px;padding:14px 16px;margin-bottom:16px">
        <strong style="color:var(--bad);font-size:13px;display:block;margin-bottom:4px">⚠ Connection Error</strong>
        <span style="font-size:13px;color:var(--ink)">${esc(message)}</span>
      </div>` : ''}
      
      <div class="scopes">
        Requested scopes (minimum needed):<br>
        <code>gmail.modify</code> read + manage mail &nbsp;·&nbsp;
        <code>gmail.send</code> send replies &nbsp;·&nbsp;
        <code>userinfo.profile</code> show your name
      </div>
      <p class="err-text" id="gateErr"></p>
      <button type="submit" class="btn-primary btn-accent">Continue with Google</button>
      <div class="divider">or</div>
      <button type="button" class="btn-outline wide" id="demoBtn">Explore demo mode</button>
      <p class="hint" style="text-align:center;margin-top:12px">
        <button type="button" class="link-btn" id="backHome">← Back to overview</button>
      </p>
    </form>
  </div>`;

  const fail = msg => {
    const err = $('#gateErr');
    err.textContent = msg;
    err.classList.add('show');
  };

  $('#gateForm').onsubmit = async e => {
    e.preventDefault();
    const id = config.clientId;
    if (!id || id === 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com' || !id.endsWith('apps.googleusercontent.com')) {
      fail("The developer hasn't configured a valid Google OAuth Client ID for this application.");
      return;
    }
    
    const btn = $('#gateForm button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Redirecting to Google…';
    try {
      await connect(id);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Continue with Google';
      fail('Could not start the OAuth flow. Check that your browser allows redirects.');
    }
  };

  $('#demoBtn').onclick = async () => {
    setMode('demo');
    const { enterApp } = await import('../main.js');
    enterApp();
  };

  $('#backHome').onclick = async () => {
    const { renderLanding } = await import('./landing.js');
    renderLanding(root);
  };
}
