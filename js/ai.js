// Fully on-device intelligence. Extractive, deterministic, derived from real email content.
// No API keys needed — nothing leaves the browser.

const STOP = new Set(
  'the a an and or but to of in on for with is are was were be been being it its this that these those i you he she we they me my your our their at as by from not no if then than so do does did have has had will would can could should about into over under after before between please thanks thank hi hello dear regard regards best'.split(' ')
);

const words = t =>
  (t.toLowerCase().match(/[a-z][a-z''-]+/g) || []).filter(w => w.length > 2 && !STOP.has(w));

const sentences = t =>
  (t.replace(/\s+/g, ' ').match(/[^.!?]{20,280}[.!?]/g) || [t]).map(s => s.trim());

export function summarize(text) {
  const sents = sentences(text);
  const freq = {};
  words(text).forEach(w => freq[w] = (freq[w] || 0) + 1);

  const scored = sents.map((s, i) => ({
    s, i,
    score: words(s).reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(s.split(' ').length),
  }));

  const top = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, sents.length))
    .sort((a, b) => a.i - b.i);

  const keyPoints = [
    ...new Set(
      text.match(/\b(?:deadline|due|by|meeting|invoice|proposal|confirm|attach|review|schedule|payment|update|required|urgent)\b[^.!?]*[.!?]/gi) || []
    ),
  ].slice(0, 3);

  const dates = extractDates(text);
  const asks = /\b(please|could you|can you|need you|request(ing)?|action required|let me know)\b/i.test(text);

  return {
    summary: top.map(x => x.s).join(' ') || 'No readable content found.',
    keyPoints: keyPoints.length ? keyPoints : top.slice(1).map(x => x.s),
    actionRequired: asks
      ? 'Yes — the sender appears to request a response or action.'
      : 'No explicit request detected.',
    deadline: dates[0] || null,
  };
}

export function extractDates(text) {
  const out = new Set();
  (text.match(/\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/gi) || []).forEach(d => out.add(d));
  (text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi) || []).forEach(d => out.add(d));
  (text.match(/\b(?:today|tomorrow|next week|end of (?:day|week|month)|eod|eow)\b/gi) || []).forEach(d => out.add(d));
  (text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).forEach(d => out.add(d));
  return [...out];
}

export function extractActions(text) {
  const acts = [];
  const patterns = [
    /\b(?:please\s+)?(?:send|share|provide|forward|submit)\b[^.!?]*[.!?]/gi,
    /\b(?:confirm|verify|review|approve|sign)\b[^.!?]*[.!?]/gi,
    /\b(?:let me know|get back to|follow up)\b[^.!?]*[.!?]/gi,
    /\b(?:schedule|reschedule|book|set up)\b[^.!?]*(?:meeting|call|sync)[^.!?]*[.!?]/gi,
  ];
  patterns.forEach(p => (text.match(p) || []).forEach(m => acts.push(m.trim())));
  const dates = extractDates(text);
  return [...new Set(acts)].slice(0, 5).map((task, i) => ({
    task: task.charAt(0).toUpperCase() + task.slice(1),
    due: dates[i] ? `Possibly related: ${dates[i]}` : 'No explicit deadline detected',
  }));
}

export function explain(text, from, subject) {
  const s = summarize(text);
  return [
    ['What is this about?', s.summary.slice(0, 220)],
    ['What does the sender want?', s.actionRequired],
    ['Important dates', s.deadline ? s.deadline : 'None detected in this email.'],
    ['Potential risks', /invoice|payment|password|urgent|verify|account|click|link/i.test(text)
      ? 'Contains urgency or account/payment language — verify the sender is legitimate before acting, especially before clicking links.'
      : 'Nothing obviously risky detected. Always verify unexpected attachments.'],
    ['Suggested next action', s.actionRequired.startsWith('Yes')
      ? 'Reply to the sender confirming receipt and your intended timeline.'
      : 'No immediate response seems required. Archive if no follow-up is needed.'],
  ];
}

export function draftReply(text, fromName, tone, instruction) {
  const s = summarize(text);
  const openings = {
    Professional: `Hi ${fromName},`,
    Friendly: `Hey ${fromName}!`,
    Formal: `Dear ${fromName},`,
    Concise: `Hi ${fromName},`,
  };
  const open = openings[tone] || `Hi ${fromName},`;

  let body;
  if (instruction) {
    body = instruction;
  } else if (s.actionRequired.startsWith('Yes')) {
    body = s.deadline
      ? `Thank you for your email. I've reviewed your message, including the timeline around ${s.deadline}. I'll follow up shortly on the points raised.`
      : `Thank you for your email. I've reviewed the details and will get back to you on the requested items.`;
  } else {
    body = `Thank you for your email. I've noted the update and appreciate you keeping me in the loop.`;
  }

  const closings = {
    Professional: 'Best regards,',
    Friendly: 'Cheers,',
    Formal: 'Yours sincerely,',
    Concise: 'Best,',
  };
  const close = closings[tone] || 'Best regards,';

  return `${open}\n\n${body}\n\n${close}\n`;
}

export function polish(text, mode) {
  const sents = sentences(text);
  const clean = sents.map(s => s.replace(/\s+/g, ' ').replace(/\bi\b/g, 'I').trim());
  if (mode === 'concise') return clean.slice(0, Math.max(2, Math.ceil(clean.length / 2))).join(' ');
  if (mode === 'professional') return 'Dear recipient,\n\n' + clean.join(' ').replace(/!+/g, '.').replace(/gonna/g, 'going to').replace(/wanna/g, 'want to') + '\n\nBest regards,';
  if (mode === 'friendly') return 'Hi there!\n\n' + clean.join(' ') + '\n\nCheers,';
  // improve: capitalize sentence starts, ensure terminal punctuation
  return clean.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
