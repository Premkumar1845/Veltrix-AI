import { store } from '../store.js';
import { config, setMode, setGeminiApiKey, hasGeminiKey } from '../config.js';
import { $, $$, esc, initials, fmtTime, parseAddr, toast } from '../utils.js';
import * as gm from '../gmail.js';
import { disconnect, reconnect } from '../oauth.js';
import { demoRows, demoCounts, demoStar, demoSetRead } from '../demoData.js';
import { renderReader } from './emailReader.js';

const TITLES = { INBOX: 'Inbox', STARRED: 'Starred', SENT: 'Sent', TRASH: 'Trash' };

let source = [];
let selected = new Set(); // IDs of selected emails for bulk actions
// Assigned when the pane mounts; lets the reader and composer ask for a reload
// without either module reaching into the other's internals.
let refreshImpl = async () => {};
let paintImpl = () => {};

export function refreshList() { return refreshImpl(); }

// Apply a local change to one row (read state, star) without a round trip.
export function patchRow(id, patch) {
  const i = source.findIndex(m => m.id === id);
  if (i === -1) return;
  source[i] = { ...source[i], ...patch };
  paintImpl();
}

export function renderListPane(listPane, reader) {
  paintImpl = () => paintList(listPane, reader);
  refreshImpl = refresh;

  store.subscribe((_s, changed) => {
    // Only a folder or query change warrants refetching. Reacting to every
    // change would re-enter refresh() through its own `loading` write.
    if (changed.includes('view') || changed.includes('query')) {
      selected.clear();
      refresh();
    }
    else if (changed.includes('selectedId') || changed.includes('activity')) paintImpl();
  });

  refresh();

  async function refresh() {
    const view = store.state.view;
    if (view === 'ACTIVITY' || view === 'SETTINGS') {
      store.set({ loading: false, error: null });
      paintImpl();
      return;
    }

    store.set({ loading: true, error: null });
    paintImpl();

    try {
      if (config.demoMode) {
        source = demoRows(view);
        if (store.state.query) {
          const q = store.state.query.toLowerCase();
          source = source.filter(m => (m.subject + m.from + m.snippet).toLowerCase().includes(q));
        }
        store.set({ loading: false, counts: demoCounts() });
        paintImpl();
        return;
      }

      if (store.state.query) {
        source = await gm.getMessages(store.state.query);
        store.set({ loading: false });
        paintImpl();
        loadCounts();
        return;
      }

      const r = await gm.listThreads(TITLES[view] ? view : 'INBOX');
      const ids = (r.threads || []).slice(0, 20);
      const detailed = await Promise.all(ids.map(t => gm.getThread(t.id)));
      source = detailed.map(th => {
        const msgs = (th.messages || []).map(gm.flattenMessage).sort((a, b) => a.date - b.date);
        const last = msgs[msgs.length - 1] || {};
        return {
          ...last,
          threadId: th.id,
          // Any unread message in the thread makes the row unread, as Gmail shows it.
          unread: msgs.some(m => m.unread),
          labels: [...new Set(msgs.flatMap(m => m.labels || []))],
          nMsgs: msgs.length,
        };
      });
      store.set({ loading: false });
      paintImpl();
      loadCounts();
    } catch (e) {
      source = [];
      store.set({ error: e.message, loading: false });
      paintImpl();
    }
  }

  async function loadCounts() {
    try {
      store.set({ counts: await gm.loadCounts() });
    } catch { /* counts are decoration; never block the list on them */ }
  }

  function paintList(pane, reader) {
    const s = store.state;

    if (s.view === 'ACTIVITY') { paintActivity(pane); return; }
    if (s.view === 'SETTINGS') { paintSettings(pane); return; }

    const title = TITLES[s.view] || s.view;

    if (s.loading) {
      pane.innerHTML = `<div class="list-head"><h2>${esc(title)}</h2></div>` +
        Array(6).fill(
          `<div class="skel-row"><div class="skel" style="width:34px;height:34px;border-radius:50%"></div><div style="flex:1"><div class="skel" style="height:11px;width:60%;margin-bottom:7px"></div><div class="skel" style="height:10px;width:90%"></div></div></div>`
        ).join('');
      return;
    }

    if (s.error) {
      const expired = s.error === 'SESSION_EXPIRED';
      pane.innerHTML = `<div class="empty">
        <h3>We couldn't load your ${esc(title.toLowerCase())}.</h3>
        <p>${esc(expired
          ? 'Your session has expired. Reconnect Gmail to continue — nothing was changed in your mailbox.'
          : 'Check your connection and try again.')}</p>
        <button class="btn-outline" id="retryBtn">${expired ? 'Reconnect Gmail' : 'Try again'}</button>
      </div>`;
      $('#retryBtn', pane).onclick = async () => {
        if (expired) {
          try { await reconnect(); return; } catch { toast('Add your OAuth Client ID again to reconnect.', 'err'); }
        }
        store.set({ error: null });
        refresh();
      };
      return;
    }

    const queryBar = s.query
      ? `<div class="bulk-bar">Searching: <b>${esc(s.query)}</b><button id="clearQ" style="margin-left:auto">Clear</button></div>`
      : '';

    // Bulk action bar — shown when emails are selected
    const bulkBar = selected.size > 0
      ? `<div class="bulk-bar bulk-actions">
          <label class="bulk-check-label">
            <input type="checkbox" id="bulkSelectAll" ${selected.size === source.length ? 'checked' : ''}>
            <span>${selected.size} selected</span>
          </label>
          <span class="bulk-spacer"></span>
          <button class="bulk-btn" id="bulkArchive" title="Archive selected">
            <svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/></svg>Archive
          </button>
          <button class="bulk-btn" id="bulkRead" title="Mark as read">
            <svg class="i" viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 6l9 7 9-7"/></svg>Read
          </button>
          <button class="bulk-btn" id="bulkUnread" title="Mark as unread">
            <svg class="i" viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 6l9 7 9-7"/></svg>Unread
          </button>
          <button class="bulk-btn bulk-danger" id="bulkTrash" title="Delete selected">
            <svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete
          </button>
        </div>`
      : '';

    let emptyHtml = '';
    if (source.length === 0) {
      if (s.query) {
        emptyHtml = '<div class="empty"><h3>No emails found.</h3><p>Try changing your search, or use operators like from: and is:unread.</p></div>';
      } else if (s.view === 'INBOX') {
        emptyHtml = `<div class="empty">
          <div class="empty-icon"><svg class="i" viewBox="0 0 24 24" style="width:48px;height:48px;color:var(--accent);opacity:.5"><path d="M20 6 9 17l-5-5"/></svg></div>
          <h3>Your inbox is clear.</h3><p>Nothing needs your attention right now.</p>
        </div>`;
      } else {
        emptyHtml = `<div class="empty"><h3>Nothing in ${esc(title.toLowerCase())}.</h3><p>Items will appear here as they arrive.</p></div>`;
      }
    }

    const rows = source.map((m, idx) => {
      const { name } = parseAddr(m.from);
      const labels = m.labels || [];
      const starred = labels.includes('STARRED');
      const isSelected = selected.has(m.id);
      const nMsgsHtml = m.nMsgs > 1
        ? ` <span style="color:var(--ink-3);font-weight:400">(${m.nMsgs})</span>` : '';
      const chips = [
        labels.includes('IMPORTANT') ? '<span class="chip imp">Important</span>' : '',
        (m.attachments || []).length ? `<span class="chip">${m.attachments.length} attachment${m.attachments.length > 1 ? 's' : ''}</span>` : '',
      ].join('');

      return `<div class="e-row ${m.unread ? 'unread' : ''} ${m.id === s.selectedId ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-id="${esc(m.id)}" tabindex="0" role="button" aria-label="Open email from ${esc(name)}: ${esc(m.subject || 'no subject')}" style="animation-delay:${Math.min(idx * 30, 200)}ms">
        <label class="e-check" onclick="event.stopPropagation()">
          <input type="checkbox" data-check="${esc(m.id)}" ${isSelected ? 'checked' : ''}>
        </label>
        <div class="e-av">${esc(initials(name))}</div>
        <div class="e-main">
          <div class="e-l1"><span class="e-from">${esc(name)}</span><span class="e-time">${esc(fmtTime(m.date))}</span></div>
          <div class="e-sub">${esc(m.subject || '(no subject)')}${nMsgsHtml}</div>
          <div class="e-prev">${esc(m.snippet)}</div>
          <div class="e-meta">
            <button class="star-btn" data-star="${esc(m.id)}" aria-pressed="${starred}" aria-label="${starred ? 'Remove star' : 'Add star'}">
              <svg class="i e-star ${starred ? 'on' : ''}" viewBox="0 0 24 24" style="width:13px;height:13px${starred ? ';fill:currentColor' : ''}"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>
            </button>
            ${chips}
          </div>
        </div>
      </div>`;
    }).join('');

    // Select-all checkbox only when there are emails
    const selectAllBar = source.length > 0 && selected.size === 0
      ? `<div class="select-all-bar">
          <label class="bulk-check-label">
            <input type="checkbox" id="selectAllCheck">
            <span>Select all</span>
          </label>
        </div>`
      : '';

    pane.innerHTML = `
      <div class="list-head">
        <h2>${esc(title)}</h2>
        <span class="n">${source.length} ${source.length === 1 ? 'email' : 'emails'}
          <button class="icon-btn" id="refreshBtn" aria-label="Refresh" style="width:26px;height:26px;vertical-align:-7px">
            <svg class="i" viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>
          </button>
        </span>
      </div>
      ${queryBar}
      ${bulkBar}
      ${!bulkBar && source.length > 0 ? selectAllBar : ''}
      <div class="email-list">${emptyHtml || rows}</div>`;

    $('#refreshBtn', pane).onclick = () => { selected.clear(); refresh(); };

    const cq = $('#clearQ', pane);
    if (cq) {
      cq.onclick = () => {
        store.set({ query: '' });
        const si = document.getElementById('searchInput');
        if (si) si.value = '';
      };
    }

    // Select-all checkbox
    const selectAll = $('#selectAllCheck', pane) || $('#bulkSelectAll', pane);
    if (selectAll) {
      selectAll.onchange = () => {
        if (selectAll.checked) {
          source.forEach(m => selected.add(m.id));
        } else {
          selected.clear();
        }
        paintImpl();
      };
    }

    // Individual checkboxes
    $$('[data-check]', pane).forEach(cb => {
      cb.onchange = () => {
        if (cb.checked) selected.add(cb.dataset.check);
        else selected.delete(cb.dataset.check);
        paintImpl();
      };
    });

    // Bulk action handlers
    wireBulkActions(pane, refresh);

    // Star toggles in place — it must not open the email.
    $$('[data-star]', pane).forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const id = btn.dataset.star;
        const row = source.find(m => m.id === id);
        if (!row) return;
        const on = !(row.labels || []).includes('STARRED');
        try {
          if (config.demoMode) demoStar(row, on);
          else await gm.star(id, on);
          const labels = (row.labels || []).filter(l => l !== 'STARRED');
          patchRow(id, { labels: on ? [...labels, 'STARRED'] : labels });
          store.logActivity('MAIL', `${on ? 'Starred' : 'Unstarred'}: ${row.subject || '(no subject)'}`);
          if (s.view === 'STARRED') refresh();
        } catch (err) {
          toast(err.message === 'SESSION_EXPIRED' ? 'Session expired — please reconnect.' : 'Could not update the star.', 'err');
        }
      };
    });

    $$('.e-row', pane).forEach(row => {
      const open = () => {
        const msg = source.find(m => m.id === row.dataset.id);
        if (!msg) return;
        store.set({ selectedId: msg.id });
        renderReader(reader, msg);
        document.getElementById('content')?.classList.add('show-reader');
        reader.classList.add('open');
      };
      row.onclick = open;
      row.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      };
    });
  }

  function wireBulkActions(pane, refresh) {
    const archiveBtn = $('#bulkArchive', pane);
    const readBtn = $('#bulkRead', pane);
    const unreadBtn = $('#bulkUnread', pane);
    const trashBtn = $('#bulkTrash', pane);

    if (archiveBtn) {
      archiveBtn.onclick = async () => {
        const ids = [...selected];
        try {
          if (config.demoMode) {
            const { demoArchive } = await import('../demoData.js');
            ids.forEach(id => { const m = source.find(r => r.id === id); if (m) demoArchive(m); });
          } else {
            await Promise.all(ids.map(id => gm.archive(id)));
          }
          toast(`${ids.length} email${ids.length > 1 ? 's' : ''} archived`);
          store.logActivity('MAIL', `Archived ${ids.length} emails`);
          selected.clear();
          refresh();
        } catch (err) {
          toast('Archive failed. Try again.', 'err');
        }
      };
    }

    if (readBtn) {
      readBtn.onclick = async () => {
        const ids = [...selected];
        try {
          if (config.demoMode) {
            ids.forEach(id => { const m = source.find(r => r.id === id); if (m) demoSetRead(m, true); });
          } else {
            await Promise.all(ids.map(id => gm.setRead(id, true)));
          }
          ids.forEach(id => patchRow(id, { unread: false }));
          toast(`Marked ${ids.length} as read`);
          selected.clear();
          paintImpl();
        } catch (err) {
          toast('Failed to mark as read.', 'err');
        }
      };
    }

    if (unreadBtn) {
      unreadBtn.onclick = async () => {
        const ids = [...selected];
        try {
          if (config.demoMode) {
            ids.forEach(id => { const m = source.find(r => r.id === id); if (m) demoSetRead(m, false); });
          } else {
            await Promise.all(ids.map(id => gm.setRead(id, false)));
          }
          ids.forEach(id => patchRow(id, { unread: true }));
          toast(`Marked ${ids.length} as unread`);
          selected.clear();
          paintImpl();
        } catch (err) {
          toast('Failed to mark as unread.', 'err');
        }
      };
    }

    if (trashBtn) {
      trashBtn.onclick = async () => {
        const ids = [...selected];
        if (!confirm(`Delete ${ids.length} email${ids.length > 1 ? 's' : ''}?`)) return;
        try {
          if (config.demoMode) {
            const { demoTrash } = await import('../demoData.js');
            ids.forEach(id => { const m = source.find(r => r.id === id); if (m) demoTrash(m); });
          } else {
            await Promise.all(ids.map(id => gm.trash(id)));
          }
          toast(`${ids.length} email${ids.length > 1 ? 's' : ''} deleted`);
          store.logActivity('MAIL', `Deleted ${ids.length} emails`);
          selected.clear();
          refresh();
        } catch (err) {
          toast('Delete failed. Try again.', 'err');
        }
      };
    }
  }

  function paintActivity(pane) {
    const acts = store.state.activity;
    const icons = { AI: '✦', SEND: '↑', MAIL: '•', EXIT: '×' };
    const labels = { AI: 'AI action', SEND: 'Email sent', MAIL: 'Email managed', EXIT: 'Disconnected' };

    pane.innerHTML = `
      <div class="list-head"><h2>Activity</h2><span class="n">${acts.length} ${acts.length === 1 ? 'event' : 'events'}</span></div>
      <div class="email-list">
        ${acts.length === 0
          ? '<div class="empty"><h3>No activity yet.</h3><p>Your email actions and AI interactions will appear here.</p></div>'
          : acts.map(a => `<div class="e-row" style="cursor:default">
              <div class="e-av" style="background:var(--accent-soft);color:var(--accent)">${icons[a.type] || '•'}</div>
              <div class="e-main">
                <div class="e-l1"><span class="e-from">${esc(labels[a.type] || a.type)}</span><span class="e-time">${esc(fmtTime(new Date(a.at).getTime()))}</span></div>
                <div class="e-sub" style="font-weight:400;color:var(--ink-2)">${esc(a.detail)}</div>
              </div>
            </div>`).join('')}
      </div>`;
  }

  function paintSettings(pane) {
    const p = store.state.profile;
    const geminiKey = config.geminiApiKey || '';
    const geminiStatus = hasGeminiKey();

    pane.innerHTML = `
      <div class="list-head"><h2>Settings</h2></div>
      <div class="email-list" style="padding:18px 16px;display:flex;flex-direction:column;gap:20px">
        <div>
          <div class="sb-h" style="padding-left:0">Connected account</div>
          <p style="font-size:13px;color:var(--ink-2);margin-top:6px">
            ${config.demoMode
              ? 'You are in <b>demo mode</b> with isolated sample data. No Gmail account is connected.'
              : `Signed in as <b>${esc(p?.emailAddress || 'your Gmail account')}</b> via OAuth 2.0. Tokens live only in browser memory and are discarded on disconnect or page close.`}
          </p>
          ${!config.demoMode && p?.messagesTotal
            ? `<p style="font-size:12.5px;color:var(--ink-3);margin-top:4px">${Number(p.messagesTotal).toLocaleString()} messages · ${Number(p.threadsTotal || 0).toLocaleString()} threads</p>`
            : ''}
        </div>

        <div class="settings-section">
          <div class="sb-h" style="padding-left:0">
            <svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px;vertical-align:-2px;color:var(--accent)"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>
            AI Configuration
          </div>
          <p style="font-size:13px;color:var(--ink-2);margin:6px 0 12px">
            Connect a Google Gemini API key to enable powerful AI-powered email analysis, summarization, and reply drafting. Without a key, the app uses a basic on-device text analysis engine.
          </p>
          <div class="gemini-key-row">
            <div class="gemini-key-input-wrap">
              <input id="geminiKeyInput" type="password" placeholder="Enter your Gemini API key" value="${esc(geminiKey)}"
                class="gemini-key-input" autocomplete="off" spellcheck="false">
              <button class="ghost-btn" id="toggleKeyVis" style="padding:4px 8px;font-size:11px">Show</button>
            </div>
            <button class="btn-primary" id="saveGeminiKey" style="padding:8px 16px;font-size:13px">Save key</button>
          </div>
          <div class="gemini-status" style="margin-top:8px">
            ${geminiStatus
              ? '<span style="color:var(--ok);font-size:12.5px">✓ Gemini AI is active — your emails will be analyzed by AI.</span>'
              : '<span style="color:var(--ink-3);font-size:12.5px">No API key configured — using on-device analysis.</span>'}
          </div>
          <p style="font-size:12px;color:var(--ink-3);margin-top:8px">
            Get a free API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">Google AI Studio</a>. 
            Your key is stored locally in your browser only.
          </p>
        </div>

        <div>
          <div class="sb-h" style="padding-left:0">Appearance</div>
          <button class="btn-outline" id="setTheme" style="margin-top:8px">Toggle light / dark theme</button>
        </div>
        <div>
          <div class="sb-h" style="padding-left:0">Keyboard shortcuts</div>
          <p style="font-size:13px;color:var(--ink-2);margin:6px 0;line-height:1.9">
            <code class="kbd">/</code> search &nbsp;·&nbsp;
            <code class="kbd">c</code> compose &nbsp;·&nbsp;
            <code class="kbd">r</code> refresh &nbsp;·&nbsp;
            <code class="kbd">Esc</code> close
          </p>
        </div>
        <div style="border-top:1px solid var(--line);padding-top:16px">
          <div class="sb-h" style="padding-left:0">Disconnect</div>
          <p style="font-size:13px;color:var(--ink-2);margin:6px 0 12px">Disconnecting revokes the token and returns you to the landing page. Your Gmail itself is untouched.</p>
          <button class="btn-outline" id="discBtn" style="color:var(--warn);border-color:var(--warn)">${config.demoMode ? 'Leave demo mode' : 'Disconnect Gmail'}</button>
          
          <div class="sb-h" style="padding-left:0;margin-top:16px">Account</div>
          <p style="font-size:13px;color:var(--ink-2);margin:6px 0 12px">Sign out of Veltrix AI completely.</p>
          <button class="btn-outline" id="signOutBtn" style="color:var(--bad);border-color:var(--bad)">Sign Out</button>
        </div>
      </div>`;

    $('#setTheme', pane).onclick = () => document.getElementById('themeBtn')?.click();
    $('#discBtn', pane).onclick = () => {
      if (!config.demoMode) disconnect();
      setMode('none');
      store.logActivity('EXIT', 'Disconnected account');
      location.reload();
    };
    $('#signOutBtn', pane).onclick = async () => {
      try {
        const { signOut } = await import('../supabase.js');
        await signOut();
        location.reload();
      } catch (err) {
        toast('Failed to sign out.', 'err');
      }
    };

    // Gemini API key handlers
    const keyInput = $('#geminiKeyInput', pane);
    const toggleBtn = $('#toggleKeyVis', pane);
    const saveBtn = $('#saveGeminiKey', pane);

    toggleBtn.onclick = () => {
      const isPass = keyInput.type === 'password';
      keyInput.type = isPass ? 'text' : 'password';
      toggleBtn.textContent = isPass ? 'Hide' : 'Show';
    };

    saveBtn.onclick = () => {
      const key = keyInput.value.trim();
      setGeminiApiKey(key);
      if (key) {
        toast('Gemini API key saved! AI features are now active.');
        store.logActivity('AI', 'Gemini API key configured');
      } else {
        toast('API key removed. Using on-device analysis.');
        store.logActivity('AI', 'Gemini API key removed');
      }
      // Re-render settings to update status
      paintSettings(pane);
    };

    keyInput.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    };
  }
}
