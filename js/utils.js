// DOM helpers and utilities
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const initials = n =>
  (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function fmtFull(ts) {
  return new Date(ts).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  const icon = type === 'err'
    ? '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    : '<path d="M20 6 9 17l-5-5"/>';
  el.innerHTML = `<svg class="i" viewBox="0 0 24 24">${icon}</svg>${esc(msg)}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function parseAddr(v = '') {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return { name: (m ? m[1] : v).trim() || v, email: (m ? m[2] : v).trim() };
}

export const LOGO = `
<svg class="logo-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="square" stroke-linejoin="miter">
  <path d="M 20,40 L 62,40" />
  <path d="M 80,58 L 80,80 L 20,80 L 20,40" />
  <path d="M 20,80 L 35,65" />
  <path d="M 80,80 L 65,65" />
  <path d="M 20,40 L 50,70 L 86,34" />
  <polygon points="90,30 75,30 90,45" fill="currentColor" stroke="none" />
</svg>
`;
