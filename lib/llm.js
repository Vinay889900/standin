// LLM wrapper. Gemini (free tier) by default when GEMINI_API_KEY is set; Anthropic if ANTHROPIC_API_KEY is set instead.
// Free-tier Gemini quotas are per model, so calls are spread over a pool of Flash / Flash-Lite models,
// each with its own requests-per-minute pacing; a 429 benches that model for the retry delay Google returns.
import pLimit from 'p-limit';

const limit = pLimit(+process.env.LLM_CONCURRENCY || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  return JSON.parse(t.slice(start, end + 1));
}

// ---------- Gemini ----------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
// preference order; only models this key can actually call are used
const PREFS = {
  deep: (process.env.GEMINI_DEEP || 'gemini-3.5-flash,gemini-3-flash,gemini-flash-latest,gemini-2.5-flash,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite').split(','),
  fast: (process.env.GEMINI_FAST || 'gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite,gemini-3.5-flash,gemini-3-flash,gemini-flash-latest,gemini-2.5-flash').split(','),
};
const RPM = { lite: +process.env.GEMINI_RPM_LITE || 14, flash: +process.env.GEMINI_RPM_FLASH || 9 };
const state = {}; // model -> { next: ts, benchedUntil: ts }
let available;

async function geminiModels() {
  if (available) return available;
  const r = await fetch(`${GEMINI}/models?pageSize=200&key=${process.env.GEMINI_API_KEY}`);
  if (!r.ok) throw new Error(`Gemini key check failed (HTTP ${r.status}) — is GEMINI_API_KEY valid?`);
  const j = await r.json();
  const names = new Set((j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', '')));
  available = { deep: PREFS.deep.filter((m) => names.has(m)), fast: PREFS.fast.filter((m) => names.has(m)) };
  if (!available.deep.length && !available.fast.length) {
    const flash = [...names].filter((n) => /flash/.test(n) && !/image|tts|audio|live|embed/.test(n));
    available = { deep: flash, fast: flash };
  }
  if (!available.deep.length) available.deep = available.fast;
  if (!available.fast.length) available.fast = available.deep;
  return available;
}

// pick the model (in preference order) that can be called soonest
function pickModel(list) {
  const now = Date.now();
  let best = null, bestAt = Infinity;
  for (const m of list) {
    const s = (state[m] ||= { next: 0, benchedUntil: 0 });
    const at = Math.max(s.next, s.benchedUntil, now);
    if (at < bestAt - 50) { best = m; bestAt = at; }
  }
  const s = state[best];
  const gap = 60000 / (/lite/.test(best) ? RPM.lite : RPM.flash);
  s.next = Math.max(bestAt, now) + gap; // reserve the slot
  return { model: best, wait: bestAt - now };
}

async function geminiCall({ system, prompt, model, maxTokens, temperature }) {
  const pool = (await geminiModels())[model === 'deep' ? 'deep' : 'fast'];
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { model: m, wait } = pickModel(pool);
    if (wait > 0) await sleep(wait);
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: Math.max(2048, maxTokens * 2), responseMimeType: 'application/json' },
    };
    if (/2\.5/.test(m)) body.generationConfig.thinkingConfig = { thinkingBudget: /lite/.test(m) ? 0 : 0 };
    else if (/^gemini-3/.test(m)) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    try {
      let r = await fetch(`${GEMINI}/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
      });
      if (r.status === 400 && body.generationConfig.thinkingConfig) { // model doesn't accept that thinking config
        delete body.generationConfig.thinkingConfig;
        r = await fetch(`${GEMINI}/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      }
      if (r.status === 429 || r.status === 503 || r.status === 500) {
        const j = await r.json().catch(() => ({}));
        const retry = JSON.stringify(j).match(/"retryDelay":\s*"(\d+)/);
        const daily = /PerDay|per day|RequestsPerDay/i.test(JSON.stringify(j));
        state[m].benchedUntil = Date.now() + (daily ? 3600_000 : retry ? (+retry[1] + 1) * 1000 : 20000);
        lastErr = new Error(`Gemini ${m} HTTP ${r.status}${daily ? ' (daily quota)' : ''}`);
        continue;
      }
      if (!r.ok) { lastErr = new Error(`Gemini ${m} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); await sleep(1000); continue; }
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!text) { lastErr = new Error(`Gemini ${m} returned no text (${j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'unknown'})`); continue; }
      return extractJson(text);
    } catch (e) { lastErr = e; await sleep(800); }
  }
  throw lastErr;
}

// ---------- Anthropic (optional) ----------
let anthropic;
async function anthropicCall({ system, prompt, model, maxTokens, temperature }) {
  if (!anthropic) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); anthropic = new Anthropic(); }
  const name = model === 'deep' ? process.env.MODEL_DEEP || 'claude-sonnet-5-5' : process.env.MODEL_FAST || 'claude-haiku-5-5';
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await anthropic.messages.create({ model: name, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: prompt }] });
      return extractJson(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    } catch (e) { lastErr = e; await sleep(e.status === 429 || e.status === 529 ? 4000 * (attempt + 1) : 800 * (attempt + 1)); }
  }
  throw lastErr;
}

export function provider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export async function askJSON({ system, prompt, model = 'fast', maxTokens = 1200, temperature = 0.7 }) {
  const p = provider();
  if (!p) throw new Error('No LLM key configured on the server (GEMINI_API_KEY or ANTHROPIC_API_KEY)');
  const sys = system + '\n\nRespond with a single valid JSON value only — no prose, no code fences.';
  return limit(() => (p === 'gemini' ? geminiCall : anthropicCall)({ system: sys, prompt, model, maxTokens, temperature }));
}

export async function llmInfo() {
  const p = provider();
  if (p === 'gemini') return { provider: p, models: await geminiModels().catch((e) => ({ error: e.message })) };
  return { provider: p };
}
