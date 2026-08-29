import { $, esc, LOGO } from '../utils.js';
import { gate } from './gate.js';
import { getSession, signOut } from '../supabase.js';
import { initials } from '../utils.js';

export async function renderLanding(root) {
  // Fetch Supabase session to display username
  let username = '';
  let avatarText = '?';
  try {
    const session = await getSession();
    if (session) {
      username = session.user?.user_metadata?.username
        || session.user?.email?.split('@')[0]
        || '';
      avatarText = initials(username.replace(/[._\-+]/g, ' ')) || '?';
    }
  } catch (_) {}

  root.innerHTML = `
  <div id="landing">
    <nav class="lnav">
      <div class="wordmark">${LOGO}Veltrix AI</div>
      <div style="display:flex;align-items:center;gap:12px">
        ${username ? `
          <span style="font-size:14px;font-weight:600;color:var(--ink)">Hi, ${esc(username)}</span>
          <div class="avatar" style="width:32px;height:32px;font-size:13px" title="${esc(username)}">${esc(avatarText)}</div>
          <button class="ghost-btn" id="landingLogoutBtn" style="color:var(--bad);border-color:var(--bad)">Logout</button>
        ` : ''}
        <button class="ghost-btn" id="navConnect">Connect Gmail</button>
      </div>
    </nav>
    <section class="hero">
      <div>
        <div class="kicker">Intelligent email assistant</div>
        <h1 class="big">Your inbox,<br>intelligently <em>simplified.</em></h1>
        <p class="lead">Read less. Understand faster. Respond better. Veltrix reads with you — summarizing, explaining, and drafting replies in your own tone.</p>
        <div class="cta-row">
          <button class="btn-primary btn-accent" id="ctaConnect">
            <svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
            Connect Gmail
          </button>
          <span style="font-size:13px;color:var(--ink-3)">Google OAuth · no passwords stored</span>
        </div>
        <div class="trust">
          <span><svg class="i" viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6z"/></svg>OAuth 2.0</span>
          <span><svg class="i" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Tokens stay in memory</span>
          <span><svg class="i" viewBox="0 0 24 24"><path d="M12 20V10M6 20v-6M18 20V4"/></svg>On-device analysis</span>
        </div>
      </div>
      <div class="mock" aria-hidden="true">
        <div class="mock-bar"><i></i><i></i><i></i><b>Veltrix — Inbox</b></div>
        <div class="mock-body">
          <div class="mock-side"><b>Inbox</b><span>Starred</span><span>Sent</span><span>Archive</span></div>
          <div>
            <div class="mock-row unread"><div class="l1"><span>Sarah Chen</span><span>9:41 AM</span></div><div class="l2">Proposal revision — deadline Friday</div></div>
            <div class="mock-row"><div class="l1"><span>Marcus Webb</span><span>8:02 AM</span></div><div class="l2">Contract review: MSA…</div></div>
            <div class="mock-ai"><b>AI Summary</b><br>Two revisions requested; revised proposal due Friday before the Monday steering meeting.</div>
          </div>
        </div>
      </div>
    </section>
    <section class="features">
      <div class="sec-label">What Veltrix does</div>
      <div class="feat-grid">
        <div class="feat"><span class="n">01</span><h3>Understand instantly</h3><p>Every email condensed to a summary, key points, and a clear action verdict.</p></div>
        <div class="feat"><span class="n">02</span><h3>Reply in your tone</h3><p>Drafts in professional, friendly, formal, or concise voice — always editable, never auto-sent.</p></div>
        <div class="feat"><span class="n">03</span><h3>Find anything</h3><p>Real Gmail search with operator support: <code style="font-family:var(--mono);font-size:11px">from:</code>, <code style="font-family:var(--mono);font-size:11px">has:attachment</code>, and more.</p></div>
        <div class="feat"><span class="n">04</span><h3>Catch every action</h3><p>Tasks, deadlines, and commitments extracted into a structured checklist.</p></div>
        <div class="feat"><span class="n">05</span><h3>Explain unclear mail</h3><p>Jargon-heavy or ambiguous emails broken into plain, next-step language.</p></div>
      </div>
    </section>
    <footer class="landing-foot">
      <span>&copy; ${new Date().getFullYear()} Veltrix AI</span>
      <span>Privacy-conscious · Gmail stays the source of truth</span>
    </footer>
  </div>`;

  $('#navConnect').onclick = $('#ctaConnect').onclick = () => gate(root);

  const logoutBtn = $('#landingLogoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await signOut();
        location.reload();
      } catch (e) {
        console.error('Logout failed', e);
      }
    };
  }
}
