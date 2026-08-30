import { store } from '../store.js';
import { config, hasGeminiKey } from '../config.js';
import { $, $$, esc, initials, fmtFull, fmtTime, parseAddr, toast } from '../utils.js';
import * as gm from '../gmail.js';
import * as ai from '../ai.js';
import { demoThread, demoStar, demoArchive, demoTrash, demoSetRead } from '../demoData.js';
import { refreshList, patchRow } from './emailList.js';
import { openCompose } from './compose.js';

// Bumped on every render so a slow thread fetch cannot paint over a newer one.
let renderSeq = 0;

const fmtSize = n =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB`
    : n >= 1024 ? `${Math.round(n / 1024)} KB`
      : `${n} B`;

const ICON = {
  reply: '<path d="M9 17H4V7m0 0 8 6 8-6"/><path d="M4 7h9a7 7 0 0 1 7 7v3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  archive: '<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/>',
  unread: '<path d="M3 6h18v12H3zM3 6l9 7 9-7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  back: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  clip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>',
  down: '<path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  retry: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
};

export function renderReader(el, row) {
  const seq = ++renderSeq;

  if (!row) {
    el.innerHTML = `<div class="empty" style="padding-top:120px">
      <div class="empty-icon">
        <svg class="i" viewBox="0 0 24 24" style="width:48px;height:48px;color:var(--ink-3);opacity:.4">${ICON.unread}</svg>
      </div>
      <h3>Select an email</h3>
      <p>Choose a message from the list to read it here.</p>
    </div>`;
    return;
  }

  paintLoading(el, row);

  loadMessages(row)
    .then(msgs => {
      if (seq !== renderSeq) return; // a newer email was opened meanwhile
      paint(el, row, msgs.length ? msgs : [row]);
    })
    .catch(e => {
      if (seq !== renderSeq) return;
      paintError(el, row, e);
    });
}

// Demo mode reads from the in-memory thread; live mode fetches the full thread,
// falling back to a single message when there is no thread id.
async function loadMessages(row) {
  if (config.demoMode) return demoThread(row.threadId);
  if (row.body) return [row]; // already complete
  if (row.threadId) return gm.loadThread(row.threadId);
  return [await gm.getMessage(row.id)];
}

function backBar(row) {
  const { name } = parseAddr(row.from);
  return `<button class="r-back mobile-only" id="rBack" aria-label="Back to list">
    <svg class="i" viewBox="0 0 24 24">${ICON.back}</svg>${esc(name)}
  </button>`;
}

function paintLoading(el, row) {
  el.innerHTML = `<div class="reader-inner">
    ${backBar(row)}
    <h1 class="r-subject">${esc(row.subject || '(no subject)')}</h1>
    <div class="skel" style="height:13px;width:40%;margin-bottom:10px"></div>
    <div class="skel" style="height:13px;width:92%;margin-bottom:8px"></div>
    <div class="skel" style="height:13px;width:78%;margin-bottom:8px"></div>
    <div class="skel" style="height:13px;width:85%"></div>
  </div>`;
  wireBack(el);
}

function paintError(el, row, e) {
  const expired = e.message === 'SESSION_EXPIRED';
  el.innerHTML = `<div class="reader-inner">
    ${backBar(row)}
    <div class="empty">
      <h3>This email couldn't be loaded.</h3>
      <p>${esc(expired ? 'Your session expired. Reconnect Gmail and open it again.' : 'Gmail did not return the message. Check your connection and retry.')}</p>
      <button class="btn-outline" id="rRetry">Try again</button>
    </div>
  </div>`;
  wireBack(el);
  $('#rRetry', el).onclick = () => renderReader(el, row);
}

function wireBack(el) {
  const b = $('#rBack', el);
  if (b) b.onclick = () => closeReader(el);
}

function closeReader(el) {
  store.set({ selectedId: null });
  document.getElementById('content')?.classList.remove('show-reader');
  el.classList.remove('open');
  renderReader(el, null);
}

function paint(el, row, msgs) {
  // The newest message is the one the user acts on and the AI analyzes.
  const target = msgs[msgs.length - 1];
  const { name, email } = parseAddr(target.from);
  const body = target.body || target.snippet || '';
  const starred = (target.labels || []).includes('STARRED');
  const inTrash = (target.labels || []).includes('TRASH');

  const act = (id, label, extra = '') =>
    `<button data-act="${id}" ${extra}><svg class="i" viewBox="0 0 24 24">${ICON[id] || ICON.reply}</svg>${label}</button>`;

  const messagesHtml = msgs.map((m, i) => {
    const p = parseAddr(m.from);
    const last = i === msgs.length - 1;
    const mBody = m.body || m.snippet || '(no content)';
    const atts = (m.attachments || []).map((a, ai_) =>
      `<button class="att" data-att="${i}:${ai_}" title="Download ${esc(a.filename)}">
        <svg class="i" viewBox="0 0 24 24">${ICON.clip}</svg>
        <span class="nm">${esc(a.filename)}</span>
        <span class="sz">${esc(fmtSize(a.size))}</span>
        <svg class="i" viewBox="0 0 24 24">${ICON.down}</svg>
      </button>`).join('');

    return `<div class="r-msg ${last ? '' : 'collapsed'}">
      <div class="r-msg-h">
        <div class="e-av">${esc(initials(p.name))}</div>
        <div class="who">
          <div class="nm">${esc(p.name)}</div>
          <div class="em">${esc(p.email)}</div>
          <div class="prev">${esc(m.snippet || mBody.slice(0, 120))}</div>
        </div>
        <span class="tm">${esc(msgs.length > 1 ? fmtTime(m.date) : fmtFull(m.date))}</span>
        <svg class="i caret" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="m9 6 6 6-6 6"/></svg>
      </div>
      <div class="r-msg-b">${esc(mBody)}</div>
      ${atts ? `<div class="att-row">${atts}</div>` : ''}
    </div>`;
  }).join('');

  // Determine AI engine status
  const geminiActive = hasGeminiKey();
  const engineBadge = geminiActive
    ? '<span class="ai-engine-badge gemini">Gemini AI</span>'
    : '<span class="ai-engine-badge local">On-device</span>';

  el.innerHTML = `
  <div class="reader-inner">
    ${backBar(row)}
    <div class="r-actions">
      ${act('reply', 'Reply')}
      ${act('star', starred ? 'Unstar' : 'Star', starred ? 'class="on"' : '')}
      ${act('archive', 'Archive')}
      ${act('unread', 'Mark unread')}
      ${act('trash', inTrash ? 'Restore' : 'Delete', 'style="color:var(--bad)"')}
    </div>
    <h1 class="r-subject">${esc(target.subject || '(no subject)')}</h1>
    ${msgs.length > 1 ? `<div class="r-count">${msgs.length} messages in this conversation</div>` : ''}
    ${messagesHtml}
    <div class="ai-panel">
      <div class="ai-head">
        <svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px">${ICON.spark}</svg>
        AI Assistant
        ${engineBadge}
      </div>
      <div class="ai-body">
        <div class="ai-tabs" role="tablist">
          <button data-tab="sum" class="on">Summarize</button>
          <button data-tab="exp">Explain</button>
          <button data-tab="act">Action items</button>
          <button data-tab="rep">Generate reply</button>
        </div>
        <div id="aiOut"></div>
      </div>
    </div>
  </div>`;

  wireBack(el);
  wireMessages(el, msgs);
  wireActions(el, row, msgs, target, email);
  wireAi(el, target, body, name, email);
  markThreadRead(row, msgs);
}

function wireMessages(el, msgs) {
  $$('.r-msg', el).forEach(m => {
    const head = $('.r-msg-h', m);
    if (head) head.onclick = () => m.classList.toggle('collapsed');
  });

  $$('[data-att]', el).forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const [mi, ai_] = btn.dataset.att.split(':').map(Number);
      const msg = msgs[mi];
      const att = msg?.attachments?.[ai_];
      if (!att) return;
      if (config.demoMode) return toast('Attachments are not downloadable in demo mode.');
      btn.disabled = true;
      try {
        await gm.downloadAttachment(msg.id, att);
        store.logActivity('MAIL', 'Downloaded: ' + att.filename);
      } catch (err) {
        toast(err.message === 'SESSION_EXPIRED' ? 'Session expired — please reconnect.' : 'Download failed.', 'err');
      } finally {
        btn.disabled = false;
      }
    };
  });
}

// Opening a conversation clears its unread state, the same as Gmail.
async function markThreadRead(row, msgs) {
  const unread = msgs.filter(m => m.unread);
  if (!unread.length) return;
  try {
    if (config.demoMode) unread.forEach(m => demoSetRead(m, true));
    else await Promise.all(unread.map(m => gm.setRead(m.id, true)));
    unread.forEach(m => { m.unread = false; });
    patchRow(row.id, { unread: false });
    refreshCounts();
  } catch { /* a failed read-receipt should not disturb reading */ }
}

function refreshCounts() {
  if (config.demoMode) {
    import('../demoData.js').then(d => store.set({ counts: d.demoCounts() }));
  } else {
    gm.loadCounts().then(counts => store.set({ counts })).catch(() => {});
  }
}

function wireActions(el, row, msgs, target, email) {
  const replyCtx = () => ({
    to: email,
    subject: /^re:/i.test(target.subject || '') ? target.subject : 'Re: ' + (target.subject || ''),
    threadId: target.threadId,
    inReplyTo: target.messageId,
    references: target.references,
  });

  $$('.r-actions button', el).forEach(b => {
    b.onclick = async () => {
      const a = b.dataset.act;
      const subj = target.subject || '(no subject)';
      const inTrash = (target.labels || []).includes('TRASH');

      if (a === 'reply') return openCompose(replyCtx());

      b.disabled = true;
      try {
        if (a === 'star') {
          const on = !(target.labels || []).includes('STARRED');
          if (config.demoMode) demoStar(target, on);
          else await gm.star(target.id, on);
          target.labels = on
            ? [...(target.labels || []), 'STARRED']
            : (target.labels || []).filter(l => l !== 'STARRED');
          patchRow(row.id, { labels: target.labels });
          b.classList.toggle('on', on);
          b.lastChild.textContent = on ? 'Unstar' : 'Star';
          toast(on ? 'Starred' : 'Star removed');
          store.logActivity('MAIL', `${on ? 'Starred' : 'Unstarred'}: ${subj}`);
        }

        if (a === 'archive') {
          // Archiving a conversation means clearing INBOX from every message in it.
          if (config.demoMode) msgs.forEach(demoArchive);
          else await Promise.all(msgs.filter(m => (m.labels || []).includes('INBOX')).map(m => gm.archive(m.id)));
          toast('Conversation archived');
          store.logActivity('MAIL', 'Archived: ' + subj);
          closeReader(el);
          refreshList();
        }

        if (a === 'unread') {
          if (config.demoMode) demoSetRead(target, false);
          else await gm.setRead(target.id, false);
          target.unread = true;
          patchRow(row.id, { unread: true });
          toast('Marked as unread');
          closeReader(el);
        }

        if (a === 'trash') {
          if (config.demoMode) {
            if (inTrash) target.labels = [...(target.labels || []).filter(l => l !== 'TRASH'), 'INBOX'];
            else msgs.forEach(demoTrash);
          } else if (inTrash) {
            await gm.untrash(target.id);
          } else {
            await Promise.all(msgs.map(m => gm.trash(m.id)));
          }
          toast(inTrash ? 'Restored to inbox' : 'Moved to trash');
          store.logActivity('MAIL', `${inTrash ? 'Restored' : 'Deleted'}: ${subj}`);
          closeReader(el);
          refreshList();
        }
        refreshCounts();
      } catch (e) {
        toast(e.message === 'SESSION_EXPIRED'
          ? 'Session expired — please reconnect.'
          : 'Gmail action failed. Try again.', 'err');
      } finally {
        b.disabled = false;
      }
    };
  });
}

function wireAi(el, target, body, name, email) {
  const out = $('#aiOut', el);
  const useGemini = hasGeminiKey();

  const genState = label =>
    (out.innerHTML = `<div class="gen-state"><span class="pulse"></span>${esc(label)}</div>`);

  const showError = (msg, retryFn) =>
    (out.innerHTML = `<div class="ai-out ai-error">
      <p style="color:var(--bad);margin-bottom:8px">${esc(msg)}</p>
      <button class="btn-outline ai-retry-btn" style="font-size:12px;padding:6px 14px">
        <svg class="i" viewBox="0 0 24 24" style="width:13px;height:13px">${ICON.retry}</svg>Retry
      </button>
    </div>`);

  const hasText = body.trim().length > 0;

  $$('.ai-tabs button', el).forEach(t => {
    t.onclick = () => {
      $$('.ai-tabs button', el).forEach(x => x.classList.toggle('on', x === t));
      runTab(t.dataset.tab);
    };
  });

  function engineNote(engine) {
    return engine === 'gemini'
      ? '<div class="disc"><svg class="i" viewBox="0 0 24 24" style="width:12px;height:12px;vertical-align:-2px"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg> Powered by Google Gemini</div>'
      : '<div class="disc">Extracted from the email text itself using on-device analysis. For richer AI results, add a Gemini API key in Settings.</div>';
  }

  async function runTab(tab) {
    if (!hasText && tab !== 'rep') {
      out.innerHTML = '<div class="ai-out"><p>There is no readable text in this message to analyze.</p></div>';
      return;
    }

    if (tab === 'sum') {
      genState('Analyzing email…');
      try {
        let s;
        if (useGemini) {
          s = await ai.aiSummarize(body);
        } else {
          await delay(300);
          s = ai.summarize(body);
        }
        out.innerHTML = `<div class="ai-out">
          <h4>Summary</h4><p>${esc(s.summary)}</p>
          <h4>Key points</h4><ul>${(s.keyPoints || []).map(k => `<li>${esc(k)}</li>`).join('') || '<li>None extracted.</li>'}</ul>
          <h4>Action required</h4><p>${esc(s.actionRequired)}</p>
          ${s.deadline ? `<h4>Deadline</h4><p>${esc(s.deadline)}</p>` : ''}
          ${engineNote(s.engine)}
        </div>`;
        store.logActivity('AI', 'Summary generated: ' + (target.subject || '').slice(0, 40));
      } catch (err) {
        // Fallback to local on Gemini failure
        console.warn('Gemini summarize failed, using local fallback:', err.message);
        const s = ai.summarize(body);
        out.innerHTML = `<div class="ai-out">
          <h4>Summary</h4><p>${esc(s.summary)}</p>
          <h4>Key points</h4><ul>${(s.keyPoints || []).map(k => `<li>${esc(k)}</li>`).join('') || '<li>None extracted.</li>'}</ul>
          <h4>Action required</h4><p>${esc(s.actionRequired)}</p>
          ${s.deadline ? `<h4>Deadline</h4><p>${esc(s.deadline)}</p>` : ''}
          ${engineNote('local')}
        </div>`;
        store.logActivity('AI', 'Summary generated (local fallback)');
      }
    }

    if (tab === 'exp') {
      genState('Explaining email…');
      try {
        let items;
        if (useGemini) {
          const result = await ai.aiExplain(body, name, target.subject);
          items = result.items;
        } else {
          await delay(300);
          items = ai.explain(body, name, target.subject);
        }
        const engine = useGemini ? 'gemini' : 'local';
        out.innerHTML = `<div class="ai-out">${items.map(([q, a]) => `<h4>${esc(q)}</h4><p>${esc(a)}</p>`).join('')}${engineNote(engine)}</div>`;
        store.logActivity('AI', 'Explanation generated');
      } catch (err) {
        console.warn('Gemini explain failed, using local fallback:', err.message);
        const items = ai.explain(body, name, target.subject);
        out.innerHTML = `<div class="ai-out">${items.map(([q, a]) => `<h4>${esc(q)}</h4><p>${esc(a)}</p>`).join('')}${engineNote('local')}</div>`;
      }
    }

    if (tab === 'act') {
      genState('Extracting action items…');
      try {
        let items;
        let engine;
        if (useGemini) {
          const result = await ai.aiExtractActions(body);
          items = result.items;
          engine = 'gemini';
        } else {
          await delay(300);
          items = ai.extractActions(body);
          engine = 'local';
        }
        out.innerHTML = `<div class="ai-out">
          ${items.length
            ? items.map(i => `<div class="action"><span>☐</span><div>${esc(i.task)}<div class="due">${esc(i.due)}</div></div></div>`).join('')
            : '<p>No action items detected in this email.</p>'}
          ${engineNote(engine)}
        </div>`;
        store.logActivity('AI', 'Action items extracted: ' + items.length);
      } catch (err) {
        console.warn('Gemini actions failed, using local fallback:', err.message);
        const items = ai.extractActions(body);
        out.innerHTML = `<div class="ai-out">
          ${items.length
            ? items.map(i => `<div class="action"><span>☐</span><div>${esc(i.task)}<div class="due">${esc(i.due)}</div></div></div>`).join('')
            : '<p>No action items detected in this email.</p>'}
          ${engineNote('local')}
        </div>`;
      }
    }

    if (tab === 'rep') renderReplyTab();
  }

  function renderReplyTab() {
    let curTone = 'Professional';
    const tones = ['Professional', 'Friendly', 'Formal', 'Concise'];

    out.innerHTML = `<div class="ai-out">
      <h4>Generate reply</h4>
      <div class="tone-row">${tones.map(t =>
        `<button data-tone="${t}" class="${t === curTone ? 'on' : ''}">${t}</button>`).join('')}</div>
      <input id="aiInstr" type="text" placeholder="Optional instruction — e.g. 'Confirm Tuesday works'" class="ai-instr">
      <button class="btn-primary ai-gen" id="genBtn">
        <svg class="i" viewBox="0 0 24 24">${ICON.spark}</svg>Generate reply
      </button>
      <div id="aiDraft"></div>
    </div>`;

    $$('[data-tone]', out).forEach(b => {
      b.onclick = () => {
        curTone = b.dataset.tone;
        $$('[data-tone]', out).forEach(x => x.classList.toggle('on', x === b));
      };
    });

    const gen = async () => {
      const instr = $('#aiInstr', out)?.value.trim() || '';
      genState('Generating reply…');

      try {
        let draftText;
        let engine;
        if (useGemini) {
          const result = await ai.aiDraftReply(body, name.split(' ')[0], curTone, instr);
          draftText = result.text;
          engine = 'gemini';
        } else {
          await delay(350);
          draftText = ai.draftReply(body, name.split(' ')[0], curTone, instr);
          engine = 'local';
        }
        paintDraft(draftText, curTone, engine);
      } catch (err) {
        console.warn('Gemini draft failed, using local fallback:', err.message);
        const draftText = ai.draftReply(body, name.split(' ')[0], curTone, instr);
        paintDraft(draftText, curTone, 'local');
      }
    };

    $('#genBtn', out).onclick = gen;
    $('#aiInstr', out).onkeydown = e => { if (e.key === 'Enter') gen(); };

    function paintDraft(text, tone, engine) {
      out.innerHTML = `<div class="ai-out">
        <h4>Generated draft · ${esc(tone)}</h4>
        <textarea class="reply-edit" id="draftTa" aria-label="Editable AI draft">${esc(text)}</textarea>
        <div class="reply-btns">
          <button class="ghost-btn" id="reGen">Regenerate</button>
          <button class="ghost-btn" id="copyDraft">Copy</button>
          <button class="ghost-btn" id="discDraft" style="color:var(--bad)">Discard</button>
          <span class="spacer"></span>
          <button class="btn-primary btn-accent" id="useDraft" style="padding:9px 16px;font-size:13px">Open in composer</button>
        </div>
        ${engineNote(engine)}
      </div>`;

      $('#reGen', out).onclick = () => renderReplyTab();
      $('#discDraft', out).onclick = () => { renderReplyTab(); toast('Draft discarded'); };
      $('#copyDraft', out).onclick = async () => {
        try {
          await navigator.clipboard.writeText($('#draftTa', out).value);
          toast('Draft copied');
        } catch { toast('Clipboard is unavailable in this browser.', 'err'); }
      };
      $('#useDraft', out).onclick = () => {
        openCompose({
          to: email,
          subject: /^re:/i.test(target.subject || '') ? target.subject : 'Re: ' + (target.subject || ''),
          threadId: target.threadId,
          inReplyTo: target.messageId,
          references: target.references,
          body: $('#draftTa', out).value,
        });
        store.logActivity('AI', 'Reply drafted for: ' + (target.subject || '').slice(0, 40));
      };
    }
  }

  runTab('sum'); // summary is the default view on open
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
