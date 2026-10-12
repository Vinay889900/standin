// The matchmaker: lobby (every agent screens every other card) → date scheduling → dates → rankings.
import { askJSON } from '../llm.js';
import { publicCard, goOnDate } from './dater.js';

// Each agent scores every other card and says who it wants to ask out.
export async function lobby(me, others, picks = 5) {
  const res = await askJSON({
    model: 'deep', maxTokens: 2600, temperature: 0.3,
    system: `You are the dating agent of ${me.name}. You know them from their LinkedIn and Instagram. In the lobby you see the public cards of other agents' people. Score each for likely fit with your person (0-100) — values, needs, pace, lifestyle, shared interests, complementary strengths. Be discerning: spread your scores, most should not be above 75. Never use religion, health, orientation, politics, ethnicity or relationship status.`,
    prompt: `Your person: ${me.name} — ${me.dossier.tagline}. ${me.dossier.summary}
Needs: ${(me.dossier.needs || []).map((n) => n.need).join('; ')}
Looking for: ${(me.dossier.looking_for || []).join('; ')}

Cards:
${others.map((o) => `[${o.id}] ${publicCard(o)}`).join('\n')}

Return JSON: {"scores":[{"id":"","score":0,"reason":"max 14 words"}],"ask_out":["the ${picks} ids you most want a date with, best first"]}`,
  });
  const valid = new Set(others.map((o) => o.id));
  res.scores = (res.scores || []).filter((s) => valid.has(s.id));
  res.ask_out = (res.ask_out || []).filter((id) => valid.has(id)).slice(0, picks);
  return res;
}

// Mutual interest first, then one-sided asks, until everyone has at least minDates (cap maxDates).
export function schedule(people, lobbies, { minDates = 4, maxDates = 6 } = {}) {
  const count = Object.fromEntries(people.map((p) => [p.id, 0]));
  const pairs = new Map();
  const key = (x, y) => [x, y].sort().join('|');
  const score = (x, y) => (lobbies[x]?.scores.find((s) => s.id === y)?.score ?? 0) + (lobbies[y]?.scores.find((s) => s.id === x)?.score ?? 0);
  const add = (x, y, why) => {
    const k = key(x, y);
    if (x === y || pairs.has(k) || count[x] >= maxDates || count[y] >= maxDates) return false;
    pairs.set(k, { a: x, b: y, why }); count[x]++; count[y]++; return true;
  };
  const cands = [];
  for (const p of people) for (const q of lobbies[p.id]?.ask_out || []) {
    const mutual = (lobbies[q]?.ask_out || []).includes(p.id);
    cands.push({ x: p.id, y: q, mutual, s: score(p.id, q) });
  }
  cands.sort((u, v) => (v.mutual - u.mutual) || (v.s - u.s));
  for (const c of cands) add(c.x, c.y, c.mutual ? 'mutual ask' : 'asked out');
  // top up anyone below minDates with their best-scored remaining option
  for (const p of people) {
    const ranked = (lobbies[p.id]?.scores || []).slice().sort((u, v) => score(p.id, v.id) - score(p.id, u.id));
    for (const s of ranked) { if (count[p.id] >= minDates) break; add(p.id, s.id, 'matchmaker top-up'); }
  }
  return [...pairs.values()];
}

// Fit of q for p: dated → both debriefs (geometric mean + mutual bonus); not dated → lobby estimate (discounted).
export function rankFor(pId, people, lobbies, dates) {
  const rows = [];
  for (const q of people) {
    if (q.id === pId) continue;
    const date = dates.find((d) => (d.a === pId && d.b === q.id) || (d.b === pId && d.a === q.id));
    if (date) {
      const mine = date.debriefs[pId], theirs = date.debriefs[q.id];
      let fit = Math.sqrt(Math.max(1, mine.overall) * Math.max(1, theirs.overall));
      if (mine.second_date && theirs.second_date) fit += 6; else if (!mine.second_date && !theirs.second_date) fit -= 6;
      rows.push({ id: q.id, fit: Math.round(Math.min(100, fit)), basis: 'date', dateId: date.id, mine: mine.overall, theirs: theirs.overall, mutual: !!(mine.second_date && theirs.second_date), reason: mine.verdict });
    } else {
      const a = lobbies[pId]?.scores.find((s) => s.id === q.id);
      const b = lobbies[q.id]?.scores.find((s) => s.id === pId);
      const vals = [a?.score, b?.score].filter((v) => typeof v === 'number');
      const est = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
      rows.push({ id: q.id, fit: Math.round(est * 0.9), basis: 'lobby', reason: a?.reason || b?.reason || '' });
    }
  }
  rows.sort((u, v) => v.fit - u.fit);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export async function runDates(people, pairs, { turns = 8, onEvent } = {}) {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  return Promise.all(pairs.map(async (pr) => {
    try { const d = await goOnDate(byId[pr.a], byId[pr.b], { turns, onEvent }); d.why = pr.why; return d; }
    catch (e) { onEvent?.({ type: 'error', id: `${pr.a}--${pr.b}`, message: e.message }); return null; }
  })).then((ds) => ds.filter(Boolean));
}
