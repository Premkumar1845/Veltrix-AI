import { ensureToken } from './oauth.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const api = async (path, opts = {}) => {
  const t = await ensureToken();
  const headers = { Authorization: `Bearer ${t}` };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) {
    // 401 means the token was rejected — report it as an expiry so the UI can
    // offer the reconnect path instead of a generic "try again".
    throw new Error(res.status === 401 ? 'SESSION_EXPIRED' : `GMAIL_${res.status}`);
  }
  return res.json();
};

/* ============ base64url <-> text ============ */

export function b64uDecode(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export function b64uEncode(str) {
  let bin = '';
  new TextEncoder().encode(str).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ============ MIME parsing ============ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', mdash: '—',
  ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  apos: "'", middot: '·',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

// HTML-only emails are common. Render them as readable plain text instead of
// dumping markup into the reader (and into the on-device AI).
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const partText = p => (p?.body?.data ? b64uDecode(p.body.data) : '');

// Depth-first walk collecting the best text candidate: text/plain wins,
// text/html is the fallback and gets converted.
export function extractBody(payload) {
  let plain = '';
  let html = '';

  (function walk(p) {
    if (!p) return;
    const mime = (p.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && !p.filename) plain = plain || partText(p);
    else if (mime === 'text/html' && !p.filename) html = html || partText(p);
    (p.parts || []).forEach(walk);
  })(payload);

  const text = plain || (html ? htmlToText(html) : '');
  // Drop the quoted tail so summaries describe the new message, not the whole thread.
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n?On .{10,80} wrote:[\s\S]*$/, '')
    .replace(/\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i, '')
    .trim();
}

export function extractAttachments(payload) {
  const out = [];
  (function walk(p) {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({
        filename: p.filename,
        mimeType: p.mimeType || 'application/octet-stream',
        size: p.body.size || 0,
        attachmentId: p.body.attachmentId,
      });
    }
    (p.parts || []).forEach(walk);
  })(payload);
  return out;
}

// Normalize a raw Gmail message resource into the shape the views consume.
export function flattenMessage(m) {
  const h = n => m.payload?.headers?.find(x => x.name.toLowerCase() === n.toLowerCase())?.value || '';
  const labels = m.labelIds || [];
  return {
    id: m.id,
    threadId: m.threadId,
    from: h('From'),
    to: h('To'),
    cc: h('Cc'),
    subject: h('Subject'),
    messageId: h('Message-ID'),
    references: h('References'),
    snippet: decodeEntities(m.snippet || ''),
    body: extractBody(m.payload),
    attachments: extractAttachments(m.payload),
    date: +m.internalDate || Date.parse(h('Date')) || Date.now(),
    labels,
    unread: labels.includes('UNREAD'),
  };
}

/* ============ Reads ============ */

export const listThreads = (label, q, max = 25) => {
  const params = new URLSearchParams({ maxResults: String(max) });
  if (label) params.set('labelIds', label);
  if (q) params.set('q', q);
  return api('/threads?' + params);
};

export const getThread = id => api(`/threads/${id}?format=full`);

// Full thread, oldest first, ready to render.
export async function loadThread(id) {
  const th = await getThread(id);
  return (th.messages || []).map(flattenMessage).sort((a, b) => a.date - b.date);
}

export const getMessage = async id => flattenMessage(await api(`/messages/${id}?format=full`));

export const getMessages = async (q, max = 25) => {
  const r = await api('/messages?' + new URLSearchParams({ maxResults: String(max), ...(q ? { q } : {}) }));
  const msgs = await Promise.all(
    (r.messages || []).slice(0, 15).map(m =>
      api(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    )
  );
  // metadata format carries no body — the reader fetches the full message on open.
  return msgs.map(m => ({ ...flattenMessage(m), body: '' }));
};

export const getLabel = id => api(`/labels/${id}`);

// Sidebar counts: unread where that is the meaningful number, total otherwise.
export async function loadCounts() {
  const wanted = [
    ['INBOX', 'messagesUnread'],
    ['STARRED', 'messagesTotal'],
    ['TRASH', 'messagesTotal'],
  ];
  const out = {};
  await Promise.all(wanted.map(async ([id, field]) => {
    try {
      const n = (await getLabel(id))[field] || 0;
      if (n) out[id] = n > 999 ? '999+' : String(n);
    } catch { /* a label we cannot read just gets no badge */ }
  }));
  return out;
}

export async function downloadAttachment(messageId, att) {
  const r = await api(`/messages/${messageId}/attachments/${att.attachmentId}`);
  const bin = atob(String(r.data || '').replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: att.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = att.filename || 'attachment';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============ Writes ============ */

export const modify = (id, body) =>
  api(`/messages/${id}/modify`, { method: 'POST', body: JSON.stringify(body) });

export const trash = id => api(`/messages/${id}/trash`, { method: 'POST' });
export const untrash = id => api(`/messages/${id}/untrash`, { method: 'POST' });

export const star = (id, on) =>
  modify(id, on ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] });

export const setRead = (id, read) =>
  modify(id, read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] });

export const archive = id => modify(id, { removeLabelIds: ['INBOX'] });

export const send = payload =>
  api('/messages/send', { method: 'POST', body: JSON.stringify(payload) });

// RFC 2047 encoding — non-ASCII header values must not go out raw.
const encHeader = v =>
  /^[\x20-\x7E]*$/.test(String(v)) ? String(v) : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(v)))}?=`;

export function buildRaw({ to, cc, subject, body, threadId, inReplyTo, references }) {
  const lines = [`To: ${encHeader(to)}`];
  if (cc) lines.push(`Cc: ${encHeader(cc)}`);
  lines.push(`Subject: ${encHeader(subject || '')}`);
  // In-Reply-To / References are what make a reply land inside the original thread.
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (inReplyTo || references) {
    lines.push(`References: ${[references, inReplyTo].filter(Boolean).join(' ').trim()}`);
  }
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', body);
  return { raw: b64uEncode(lines.join('\r\n')), ...(threadId ? { threadId } : {}) };
}
