import { getSession, signOut } from '../supabase.js';
import { store } from '../store.js';
import { config } from '../config.js';
import { $, $$, initials, debounce, toast, LOGO } from '../utils.js';
import { fetchProfile } from '../oauth.js';
import { renderListPane, refreshList } from './emailList.js';
import { renderReader } from './emailReader.js';
import { openCompose } from './compose.js';

const NAV = [
  { id: 'INBOX',   label: 'Inbox',   icon: 'M3 6h18v12H3zM3 6l9 7 9-7' },
  { id: 'STARRED', label: 'Starred', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  { id: 'SENT',    label: 'Sent',    icon: 'M22 2 11 13M22 2l-7 20-4-9-9-4z' },
  { id: 'TRASH',   label: 'Trash',   icon: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14' },
];

const isMobile = () => innerWidth <= 760;

export function renderShell(root) {
  const modeClass = config.demoMode ? 'demo' : 'live';
  const modeLabel = config.demoMode ? 'Demo mode' : 'Live · Gmail';

  const navItems = NAV.map(n =>
    `<button class="sb-item" data-nav="${n.id}">
      <svg class="i" viewBox="0 0 24 24"><path d="${n.icon}"/></svg>
      ${n.label}<span class="count" data-count="${n.id}"></span>
    </button>`
  ).join('');

  root.innerHTML = `
  <div id="app" style="display:flex">
    <header class="topbar">
      <button class="icon-btn" id="menuBtn" aria-label="Toggle sidebar" aria-expanded="false">
        <svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <div class="wordmark" style="font-size:16px">${LOGO}Veltrix</div>
      <span class="badge ${modeClass}">${modeLabel}</span>
      <div class="searchwrap" id="searchWrap">
        <svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="searchInput" type="search" placeholder="Search — try from:name, is:unread, has:attachment" aria-label="Search email">
      </div>
      <div style="flex:1"></div>
      <button class="icon-btn mobile-only" id="searchBtn" aria-label="Search">
        <svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
      <button class="icon-btn" id="themeBtn" aria-label="Toggle theme">
        <svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <div class="topbar-user" style="display:flex;align-items:center;gap:12px">
        <span class="username-display" id="userNameDisp" style="font-weight:600;font-size:14px;color:var(--ink)"></span>
        <div class="avatar" id="userAv" title="Account">?</div>
      </div>
      <button class="btn-outline desktop-only" id="topLogoutBtn" style="padding:6px 12px;font-size:12px;margin-left:12px">Logout</button>
      <button class="btn-primary desktop-only" id="composeBtn" style="padding:8px 16px;font-size:13px;margin-left:12px">Compose</button>
    </header>
    <div class="main">
      <nav class="sidebar" id="sidebar" aria-label="Folders">
        ${navItems}
        <div class="sb-h">Assistant</div>
        <button class="sb-item" data-nav="ACTIVITY">
          <svg class="i" viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>Activity
        </button>
        <div class="sb-foot">
          <button class="sb-item" data-nav="SETTINGS">
            <svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z"/></svg>Settings
          </button>
        </div>
      </nav>
      <div class="content" id="content">
        <div class="list-pane" id="listPane"></div>
        <div class="reader" id="reader"></div>
      </div>
    </div>
    <button class="fab mobile-only" id="fabCompose" aria-label="Compose">
      <svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  </div>`;

  const sidebar = $('#sidebar');
  const menuBtn = $('#menuBtn');
  // The sidebar is an overlay on small screens, so it starts closed there only.
  sidebar.classList.toggle('hidden', isMobile());
  menuBtn.setAttribute('aria-expanded', String(!isMobile()));

  /* ---- theme ---- */
  document.documentElement.dataset.theme =
    localStorage.getItem('veltrix.theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('veltrix.theme', next);
  };

  /* ---- sidebar ---- */
  menuBtn.onclick = () => {
    const open = !sidebar.classList.toggle('hidden');
    menuBtn.setAttribute('aria-expanded', String(open));
  };

  sidebar.addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    store.set({ view: b.dataset.nav, selectedId: null, query: '' });
    const si = $('#searchInput');
    if (si) si.value = '';
    closeReader();
    if (isMobile()) sidebar.classList.add('hidden');
  });

  /* ---- compose ---- */
  const compose = () => openCompose();
  $('#composeBtn').onclick = compose;
  $('#fabCompose').onclick = compose;

  /* ---- search ---- */
  const wrap = $('#searchWrap');
  const si = $('#searchInput');

  $('#searchBtn').onclick = () => {
    wrap.classList.toggle('open');
    if (wrap.classList.contains('open')) si.focus();
  };

  // Typing searches after a pause; Enter searches immediately.
  const runSearch = () => {
    const q = si.value.trim();
    if (q === store.state.query) return;
    // Searching from Activity/Settings has to land somewhere that lists mail.
    const listy = !['ACTIVITY', 'SETTINGS'].includes(store.state.view);
    store.set({ query: q, selectedId: null, view: q && listy ? store.state.view : 'INBOX' });
    closeReader();
  };
  const debouncedSearch = debounce(runSearch, 450);

  si.addEventListener('input', debouncedSearch);
  si.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    if (e.key === 'Escape') { si.value = ''; runSearch(); si.blur(); wrap.classList.remove('open'); }
  });

  /* ---- keyboard shortcuts ---- */
  document.addEventListener('keydown', e => {
    const t = e.target;
    const typing = t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.compose')) return; // the composer owns Escape

    if (e.key === '/') { e.preventDefault(); wrap.classList.add('open'); si.focus(); }
    else if (e.key === 'c') { e.preventDefault(); compose(); }
    else if (e.key === 'r') { e.preventDefault(); refreshList(); toast('Refreshed'); }
    else if (e.key === 'Escape') {
      if (store.state.selectedId) closeReader();
      else if (isMobile() && !sidebar.classList.contains('hidden')) sidebar.classList.add('hidden');
    }
  });

  function closeReader() {
    if (!store.state.selectedId) return;
    store.set({ selectedId: null });
    $('#content')?.classList.remove('show-reader');
    const r = $('#reader');
    r.classList.remove('open');
    renderReader(r, null);
  }

  /* ---- account ---- */
  const userAv = $('#userAv');
  const userNameDisp = $('#userNameDisp');
  const topLogoutBtn = $('#topLogoutBtn');

  // Pull username from Supabase session metadata
  getSession().then(session => {
    if (session) {
      const username = session.user?.user_metadata?.username 
        || session.user?.email?.split('@')[0] 
        || 'User';
      userNameDisp.textContent = username;
      userAv.title = session.user?.email || 'Account';
      userAv.textContent = initials(username.replace(/[._\-+]/g, ' '));
    }
  }).catch(() => {});

  if (config.demoMode) {
    userAv.textContent = 'DM';
    userAv.title = 'Demo mode';
    userNameDisp.textContent = 'Demo';
  } else {
    fetchProfile()
      .then(p => {
        store.set({ profile: p });
        // Only overwrite avatar if Supabase username didn't set it
        if (!userAv.textContent || userAv.textContent === '?') {
          const local = (p.emailAddress || '?').split('@')[0];
          userAv.textContent = initials(local.replace(/[._\-+]/g, ' '));
          userAv.title = p.emailAddress || 'Account';
        }
      })
      .catch(() => { if (!userAv.textContent) userAv.textContent = '?'; });
  }

  // Logout button
  topLogoutBtn.onclick = async () => {
    try {
      await signOut();
      location.reload();
    } catch (e) {
      toast('Failed to sign out.', 'err');
    }
  };

  store.subscribe(() => paintNav());
  paintNav();

  renderListPane($('#listPane'), $('#reader'));
  renderReader($('#reader'), null);
}

function paintNav() {
  $$('.sb-item[data-nav]').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === store.state.view)
  );
  const c = store.state.counts;
  $$('[data-count]').forEach(el => {
    el.textContent = c[el.dataset.count] || '';
  });
}
