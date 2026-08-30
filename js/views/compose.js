import { config } from '../config.js';
import { $, $$, esc, toast } from '../utils.js';
import * as gm from '../gmail.js';
import * as ai from '../ai.js';
import { store } from '../store.js';
import { demoSend } from '../demoData.js';
import { refreshList } from './emailList.js';

const AI_MODES = [
  ['improve', 'Improve writing'],
  ['concise', 'Make concise'],
  ['professional', 'Make professional'],
  ['friendly', 'Make friendly'],
];

export function openCompose({
  to = '', cc = '', subject = '', body = '', threadId = null,
  inReplyTo = null, references = null,
} = {}) {
  document.querySelector('.compose')?.remove();

  const el = document.createElement('div');
  el.className = 'compose';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-label', threadId ? 'Reply to email' : 'Compose email');

  el.innerHTML = `
    <div class="c-head">
      <span>${threadId ? 'Reply' : 'New message'}</span>
      <button class="icon-btn" id="cClose" aria-label="Close composer">
        <svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="c-fields">
      <div class="row">
        <label for="cTo">To</label>
        <input id="cTo" type="email" value="${esc(to)}" placeholder="recipient@example.com" autocomplete="off">
        <button class="link-btn" id="cCcToggle" aria-expanded="${cc ? 'true' : 'false'}">Cc</button>
      </div>
      <div class="row ${cc ? '' : 'is-hidden'}" id="cCcRow">
        <label for="cCc">Cc</label>
        <input id="cCc" type="text" value="${esc(cc)}" placeholder="another@example.com" autocomplete="off">
      </div>
      <div class="row"><label for="cSubj">Subject</label><input id="cSubj" type="text" value="${esc(subject)}"></div>
    </div>
    <div class="c-body">
      <textarea id="cBody" placeholder="Write your message…">${esc(body)}</textarea>
    </div>
    <div class="c-ai is-hidden" id="cAiBar">
      <div class="c-ai-modes">
        ${AI_MODES.map(([m, label]) => `<button data-mode="${m}">${label}</button>`).join('')}
      </div>
      <div class="c-ai-gen">
        <input id="cAiInstr" type="text" placeholder="Or describe the email you want — e.g. 'ask for a 1-week extension'">
        <button class="ghost-btn" id="cAiWrite">Write it</button>
      </div>
      <span class="c-ai-note">Runs on-device · your text never leaves the browser</span>
    </div>
    <div class="c-err" id="cErr"></div>
    <div class="c-foot">
      <button class="link-btn" id="cAI" aria-expanded="false">
        <svg class="i" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg> AI Assist
      </button>
      <span class="spacer"></span>
      <button class="link-btn" id="cDiscard">Discard</button>
      <button class="btn-primary btn-accent" id="cSend" style="padding:9px 20px;font-size:13px">Send</button>
    </div>`;

  document.body.appendChild(el);

  const err = $('#cErr', el);
  const bodyEl = $('#cBody', el);
  const showErr = m => { err.textContent = m; err.style.display = 'block'; };
  const clearErr = () => { err.style.display = 'none'; };

  /* ---- close / discard ---- */

  const isDirty = () => bodyEl.value.trim() !== body.trim();
  const close = (force = false) => {
    if (!force && isDirty() && !confirm('Discard this draft? Your message will be lost.')) return;
    el.remove();
    document.removeEventListener('keydown', onKey);
  };

  function onKey(e) {
    if (e.key === 'Escape') close();
    // Ctrl/Cmd+Enter is the conventional send shortcut.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#cSend', el).click(); }
  }
  document.addEventListener('keydown', onKey);

  $('#cClose', el).onclick = () => close();
  $('#cDiscard', el).onclick = () => { close(true); toast('Draft discarded'); };

  /* ---- Cc ---- */

  $('#cCcToggle', el).onclick = () => {
    const row = $('#cCcRow', el);
    const hidden = row.classList.toggle('is-hidden');
    $('#cCcToggle', el).setAttribute('aria-expanded', String(!hidden));
    if (!hidden) $('#cCc', el).focus();
  };

  /* ---- AI assist (inline, no browser prompts) ---- */

  const aiBar = $('#cAiBar', el);
  $('#cAI', el).onclick = () => {
    const hidden = aiBar.classList.toggle('is-hidden');
    $('#cAI', el).setAttribute('aria-expanded', String(!hidden));
  };

  const applyAi = (text, note) => {
    bodyEl.value = text;
    bodyEl.focus();
    toast(note);
    store.logActivity('AI', note);
  };

  const useGemini = () => !!(config.geminiApiKey && config.geminiApiKey.length > 10);

  $$('[data-mode]', el).forEach(b => {
    b.onclick = async () => {
      const cur = bodyEl.value.trim();
      if (!cur) return showErr('Write something first, then let AI refine it.');
      clearErr();
      const originalText = b.textContent;
      b.disabled = true;
      b.textContent = 'Refining…';
      try {
        let resultText;
        if (useGemini()) {
          const res = await ai.aiPolish(cur, b.dataset.mode);
          resultText = res.text;
        } else {
          resultText = ai.polish(cur, b.dataset.mode);
        }
        applyAi(resultText, `Rewrote draft: ${originalText.toLowerCase()}`);
      } catch (err) {
        console.warn('Gemini polish failed, falling back to local:', err);
        const resultText = ai.polish(cur, b.dataset.mode);
        applyAi(resultText, `Rewrote draft (fallback): ${originalText.toLowerCase()}`);
      } finally {
        b.disabled = false;
        b.textContent = originalText;
      }
    };
  });

  const write = async () => {
    const instr = $('#cAiInstr', el).value.trim();
    if (!instr) return showErr('Describe what the email should say.');
    if (bodyEl.value.trim() && !confirm('Replace your current message with the generated one?')) return;
    clearErr();
    const toName = ($('#cTo', el).value.split('@')[0] || 'there').split(/[.\-_+]/)[0];
    
    const writeBtn = $('#cAiWrite', el);
    const originalText = writeBtn.textContent;
    writeBtn.disabled = true;
    writeBtn.textContent = 'Writing…';

    try {
      let resultText;
      if (useGemini()) {
        const res = await ai.aiDraftReply('', toName, 'Professional', instr);
        resultText = res.text;
      } else {
        resultText = ai.draftReply('', toName, 'Professional', instr);
      }
      applyAi(resultText, 'Composed with AI assist');
    } catch (err) {
      console.warn('Gemini compose failed, falling back to local:', err);
      const resultText = ai.draftReply('', toName, 'Professional', instr);
      applyAi(resultText, 'Composed with AI assist (fallback)');
    } finally {
      writeBtn.disabled = false;
      writeBtn.textContent = originalText;
    }
  };
  $('#cAiWrite', el).onclick = write;
  $('#cAiInstr', el).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); write(); } };

  /* ---- send ---- */

  $('#cSend', el).onclick = async () => {
    const toV = $('#cTo', el).value.trim();
    const ccV = $('#cCc', el).value.trim();
    const subj = $('#cSubj', el).value.trim();
    const bodyV = bodyEl.value.trim();
    clearErr();

    const valid = a => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.replace(/^.*</, '').replace(/>.*$/, '').trim());
    if (!toV || !toV.split(',').every(valid)) {
      showErr('Please enter a valid recipient email address.');
      return $('#cTo', el).focus();
    }
    if (ccV && !ccV.split(',').every(valid)) {
      showErr('One of the Cc addresses is not valid.');
      return $('#cCc', el).focus();
    }
    if (!bodyV) {
      showErr('Message body cannot be empty.');
      return bodyEl.focus();
    }
    if (!subj && !confirm('Send without a subject?')) return;

    const btn = $('#cSend', el);
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      if (config.demoMode) {
        await new Promise(r => setTimeout(r, 600));
        demoSend({ to: toV, subject: subj, body: bodyV, threadId });
        toast('Email sent successfully (demo mode)');
      } else {
        await gm.send(gm.buildRaw({
          to: toV, cc: ccV, subject: subj, body: bodyV, threadId, inReplyTo, references,
        }));
        toast('Email sent successfully');
      }
      store.logActivity('SEND', `To ${toV} · ${subj.slice(0, 40) || '(no subject)'}`);
      close(true);
      refreshList();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Send';
      showErr(e.message === 'SESSION_EXPIRED'
        ? 'Session expired — please reconnect Gmail.'
        : 'Sending failed. Check your connection and try again.');
    }
  };

  // Replies open with the cursor in the body; new mail starts at the recipient.
  setTimeout(() => (body || to ? bodyEl : $('#cTo', el)).focus(), 60);
}
