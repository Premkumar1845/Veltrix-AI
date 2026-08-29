// ISOLATED DEMO DATA — never mixed with real Gmail state.
// Mutable on purpose: demo actions (star, archive, trash, send) change these
// objects so the UI behaves like the live client instead of only toasting.
const day = 86400000;
const now = Date.now();

const mk = (id, threadId, from, email, subject, body, ts, labels = [], unread = true) => ({
  id,
  threadId,
  from: from === 'Me' ? `Me <me@example.com>` : `${from} <${email}>`,
  to: from === 'Me' ? 'recipient@example.com' : 'me@example.com',
  subject,
  body,
  date: ts,
  labels,
  unread,
  attachments: [],
  snippet: body.replace(/\s+/g, ' ').slice(0, 110),
});

// Every demo message, across all threads.
export const demoMessages = [
  mk('1', 't1', 'Sarah Chen', 'sarah.chen@northwind.co', 'Proposal revision — deadline Friday',
    'Hi,\n\nThanks for sending the draft proposal. The team reviewed it this morning and it looks strong overall. Two changes needed: the pricing table on page 4 should reflect the new tiered model we discussed, and the timeline needs to push delivery to Q3.\n\nCould you please send the revised proposal by Friday, 14 June? We have a steering committee meeting Monday and I want to circulate it before then.\n\nThanks!\nSarah',
    now - day * 0.2, ['INBOX', 'UNREAD']),

  mk('2', 't2', 'Marcus Webb', 'marcus@webblaw.com', 'Contract review: Master Services Agreement',
    'Hello,\n\nAttached is the executed MSA for your records. Section 8.2 contains a 60-day termination notice period — please review carefully and let me know if you would like any amendments before the effective date on July 1.\n\nRegards,\nMarcus Webb\nWebb & Associates',
    now - day * 0.6, ['INBOX', 'UNREAD']),

  // A two-message thread, so the reader's collapse/expand behaviour is visible.
  mk('3a', 't3', 'Priya Nair', 'priya.nair@lumen.io', 'Quarterly planning sync',
    'Hi,\n\nSetting up our quarterly planning sync. I am looking at Wednesday or Thursday afternoon — let me know which works better for you.\n\nPriya',
    now - day * 1.4, ['INBOX'], false),

  mk('3', 't3', 'Priya Nair', 'priya.nair@lumen.io', 'Re: Quarterly planning sync',
    'Moving our planning sync to Thursday 2pm — the room is booked under "Lumen Strategy". Please confirm this works, or suggest an alternative before tomorrow EOD.\n\nAgenda:\n1. Q3 roadmap\n2. Hiring plan\n3. Budget review',
    now - day * 1.1, ['INBOX', 'UNREAD']),

  mk('4', 't4', 'Devon Ellis', 'devellis@gmail.com', 'Dinner Saturday?',
    'Hey! A few of us are planning dinner Saturday around 7pm at that new place on 5th. Are you in? Let me know by Thursday so I can book.\n\n— Dev',
    now - day * 2, ['INBOX'], false),

  mk('5', 't5', 'Billing', 'billing@cloudhost.net', 'Invoice #INV-20934 for June',
    'Your invoice for June services is now available. Amount due: $248.00. Payment is due by June 30. You can manage payment methods in your account portal.',
    now - day * 2.5, ['INBOX', 'STARRED'], false),

  mk('6', 't6', 'Sarah Chen', 'sarah.chen@northwind.co', 'Re: Kickoff notes',
    'Great meeting today. Notes are in the shared doc. Next step: I will share the design brief by next week.',
    now - day * 4, [], false),

  mk('s1', 't3', 'Me', 'me@example.com', 'Re: Quarterly planning sync',
    'Thursday 2pm works for me. See you there.',
    now - day * 1.05, ['SENT'], false),
];

// All messages of one thread, oldest first.
export const demoThread = threadId =>
  demoMessages.filter(m => m.threadId === threadId).sort((a, b) => a.date - b.date);

// One row per thread: the newest non-sent message, or the newest overall.
export function demoRows(view) {
  const inView = m => {
    if (view === 'STARRED') return m.labels.includes('STARRED') && !m.labels.includes('TRASH');
    if (view === 'TRASH') return m.labels.includes('TRASH');
    if (view === 'SENT') return m.labels.includes('SENT') && !m.labels.includes('TRASH');
    return m.labels.includes('INBOX') && !m.labels.includes('TRASH');
  };

  const byThread = new Map();
  demoMessages.filter(inView).forEach(m => {
    const cur = byThread.get(m.threadId);
    if (!cur || m.date > cur.date) byThread.set(m.threadId, m);
  });

  return [...byThread.values()]
    .map(m => ({ ...m, nMsgs: demoThread(m.threadId).length }))
    .sort((a, b) => b.date - a.date);
}

export function demoCounts() {
  const n = f => demoMessages.filter(f).length;
  const live = m => !m.labels.includes('TRASH');
  const out = {};
  const unread = n(m => live(m) && m.labels.includes('INBOX') && m.unread);
  const starred = n(m => live(m) && m.labels.includes('STARRED'));
  const trashed = n(m => m.labels.includes('TRASH'));
  if (unread) out.INBOX = String(unread);
  if (starred) out.STARRED = String(starred);
  if (trashed) out.TRASH = String(trashed);
  return out;
}

/* ============ Demo mutations ============ */

const setLabel = (m, label, on) => {
  const has = m.labels.includes(label);
  if (on && !has) m.labels.push(label);
  if (!on && has) m.labels = m.labels.filter(l => l !== label);
};

export const demoStar = (m, on) => setLabel(m, 'STARRED', on);
export const demoArchive = m => setLabel(m, 'INBOX', false);

export function demoTrash(m) {
  setLabel(m, 'TRASH', true);
  setLabel(m, 'INBOX', false);
}

export function demoSetRead(m, read) {
  m.unread = !read;
  setLabel(m, 'UNREAD', !read);
}

export function demoSend({ to, subject, body, threadId }) {
  const msg = mk(
    's' + (Date.now() % 1e7),
    threadId || 't' + (Date.now() % 1e7),
    'Me', 'me@example.com',
    subject || '(no subject)',
    body, Date.now(), ['SENT'], false
  );
  msg.to = to;
  demoMessages.push(msg);
  return msg;
}
