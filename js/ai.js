// AI Engine — Gemini API integration with on-device fallback.
// When a Gemini API key is configured, uses Google's Gemini 2.0 Flash model
// for high-quality, contextual analysis. Falls back to the local extractive
// engine when no key is set or when the API call fails.

import { config } from './config.js';

// ─── Gemini API ────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(prompt, maxTokens = 1024) {
  if (!config.geminiApiKey) throw new Error('NO_KEY');

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(config.geminiApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `Gemini API error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

/** Try to parse a JSON block from Gemini's response (it often wraps in ```json). */
function parseJsonResponse(raw) {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── Gemini-powered AI functions ───────────────────────────────────────────────

export async function aiSummarize(text) {
  const prompt = `You are an expert email analyst. Analyze the following email and return a JSON object with exactly these keys:
- "summary": A clear, concise 2-3 sentence summary of what the email is about.
- "keyPoints": An array of 2-4 key points or important details (each a short string).
- "actionRequired": A string — if the sender asks for a response or action, describe it clearly. If not, say "No action required."
- "deadline": A string with any deadline or date mentioned, or null if none.

Be specific and contextual. Don't be generic.

Email text:
"""
${text.slice(0, 6000)}
"""

Respond with ONLY valid JSON, no markdown formatting.`;

  const raw = await callGemini(prompt, 600);
  const parsed = parseJsonResponse(raw);
  return {
    summary: parsed.summary || 'No summary generated.',
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    actionRequired: parsed.actionRequired || 'No action required.',
    deadline: parsed.deadline || null,
    engine: 'gemini',
  };
}

export async function aiExplain(text, from, subject) {
  const prompt = `You are a helpful email assistant. A user received an email from "${from}" with subject "${subject}". 
Explain this email in plain language. Return a JSON array of [question, answer] pairs covering:
1. "What is this about?" — summarize in 1-2 clear sentences
2. "What does the sender want?" — describe any requests or expectations
3. "Important dates" — any dates, deadlines, or time-sensitive info
4. "Potential risks" — any red flags, urgency language, or things to verify
5. "Suggested next action" — what should the user do next?

Be specific to THIS email's content. Don't be vague.

Email text:
"""
${text.slice(0, 6000)}
"""

Respond with ONLY a valid JSON array of [question, answer] pairs, no markdown.`;

  const raw = await callGemini(prompt, 700);
  const parsed = parseJsonResponse(raw);
  return { items: parsed, engine: 'gemini' };
}

export async function aiExtractActions(text) {
  const prompt = `You are an expert at extracting action items from emails. Analyze the following email and extract all tasks, to-dos, requests, and commitments.

Return a JSON array of objects, each with:
- "task": A clear, actionable description of the task
- "due": The deadline or timing if mentioned, or "No explicit deadline"

If there are no action items, return an empty array [].

Email text:
"""
${text.slice(0, 6000)}
"""

Respond with ONLY valid JSON array, no markdown.`;

  const raw = await callGemini(prompt, 500);
  const parsed = parseJsonResponse(raw);
  return {
    items: Array.isArray(parsed) ? parsed.slice(0, 8) : [],
    engine: 'gemini',
  };
}

export async function aiDraftReply(text, fromName, tone, instruction) {
  const toneDesc = {
    Professional: 'professional and polished, business-appropriate',
    Friendly: 'warm, friendly, and casual but not unprofessional',
    Formal: 'very formal and respectful, using proper salutations',
    Concise: 'extremely brief and to-the-point, minimal words',
  };

  const toneGuide = toneDesc[tone] || toneDesc.Professional;
  const instrPart = instruction
    ? `The user wants to specifically: ${instruction}`
    : 'Compose a relevant reply addressing the main points of the email.';

  const prompt = `You are an expert email writer. Draft a reply to the following email.

Tone: ${toneGuide}
Sender name: ${fromName}
${instrPart}

Original email:
"""
${text.slice(0, 4000)}
"""

Write ONLY the reply text (no subject line, no explanations). Include a greeting and sign-off appropriate to the tone. The reply should feel natural and specific to the email's content.`;

  const raw = await callGemini(prompt, 500);
  return { text: raw.trim(), engine: 'gemini' };
}

export async function aiPolish(text, mode) {
  const modeDesc = {
    improve: 'Improve the writing quality — fix grammar, improve clarity, make it flow better. Keep the same tone and length.',
    concise: 'Make this much more concise — cut unnecessary words, keep only essential information. Roughly halve the length.',
    professional: 'Rewrite in a professional, business-appropriate tone. Add a proper greeting and sign-off if missing.',
    friendly: 'Rewrite in a warm, friendly, casual tone. Make it feel personable and approachable.',
  };

  const prompt = `${modeDesc[mode] || modeDesc.improve}

Original text:
"""
${text.slice(0, 4000)}
"""

Write ONLY the rewritten text, nothing else.`;

  const raw = await callGemini(prompt, 600);
  return { text: raw.trim(), engine: 'gemini' };
}

// ─── Local / on-device fallback engine ─────────────────────────────────────────
// Extractive, deterministic, derived from real email content.
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
    engine: 'local',
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
