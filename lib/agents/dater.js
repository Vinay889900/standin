// One dating agent per person. It carries its person's private dossier and goes on dates on their behalf.
// On a date each agent only sees: its own dossier (private), the other side's public card, and what is said.
import { askJSON } from '../llm.js';

const brief = (p) => {
  const d = p.dossier;
  const list = (a, k = 'name') => (a || []).map((x) => (typeof x === 'string' ? x : x[k] || x.need)).filter(Boolean).join('; ');
  return `${p.name} — ${d.tagline}
Summary: ${d.summary}
Needs: ${(d.needs || []).map((n) => `${n.need} (${n.why})`).join('; ')}
Hobbies: ${list(d.hobbies)} | Interests: ${list(d.interests)} | Values: ${list(d.values)}
Personality: ${(d.personality?.traits || []).join(', ')}; talks: ${d.personality?.communication_style}; humor: ${d.personality?.humor}; energy: ${d.personality?.energy}
Lifestyle: base ${d.lifestyle?.base}; pace ${d.lifestyle?.pace}; travel ${d.lifestyle?.travel}; routine ${d.lifestyle?.routine}
Ambitions: ${(d.ambitions || []).join('; ')}
Looking for: ${(d.looking_for || []).join('; ')}
Friction points: ${(d.friction_points || []).join('; ')} | Possible dealbreakers: ${(d.dealbreakers || []).join('; ')}
Their own words: ${(d.voice || []).map((v) => `"${v}"`).join(' ')}`;
};
export const publicCard = (p) => `${p.name}: ${p.dossier.card?.one_liner} [${(p.dossier.card?.tags || []).join(', ')}]`;

const agentSystem = (me, other) => `You are the personal dating agent of ${me.name}. ${me.dossier.first_name || me.name} is not here — you are on this date on their behalf, with the agent of ${other.name}.
You know your person deeply (private dossier below, built only from their LinkedIn and Instagram). Your job on this date:
1. Represent ${me.dossier.first_name} honestly and warmly — tell real, specific stories from the dossier, never invent facts.
2. Find out whether ${other.name} would actually fit ${me.dossier.first_name}: probe the needs, pace, values and possible dealbreakers. Ask real questions, follow up, push back politely when something might clash.
3. Be good company: curious, playful, specific. Talk like a sharp friend at a table, not a recruiter. Refer to your person by first name; do not guess pronouns.
Never mention religion, health, orientation, politics, ethnicity or relationship status.

PRIVATE DOSSIER (only you can see this)
${brief(me)}

What you know about the other side before the date: ${publicCard(other)}`;

export async function chooseVenue(a, b) {
  return askJSON({
    model: 'fast', maxTokens: 300, temperature: 0.9,
    system: `You are the dating agent of ${a.name}. You are inviting the agent of ${b.name} on a date. Pick one specific, vivid date setting that both people would enjoy, grounded in their evidence.`,
    prompt: `Your person: ${brief(a)}\n\nThe other person: ${publicCard(b)}\n\nReturn JSON: {"venue":"short name of the place/activity (max 8 words)","setting":"one sentence scene-setter","why":"why this fits both"}`,
  });
}

export async function takeTurn(me, other, venue, transcript, turnIndex, totalTurns) {
  const history = transcript.map((t) => `${t.speaker === me.id ? 'YOU' : 'THEM'} (${t.speaker === me.id ? me.name : other.name}'s agent): ${t.message}`).join('\n');
  const phase = turnIndex < 2 ? 'opening — warm, specific hello and a first real question' : turnIndex < totalTurns - 2 ? 'middle — go deeper: needs, values, how a week together would look, test one possible friction point' : 'closing — be honest about how you feel this is going for your person, and wrap up';
  return askJSON({
    model: 'fast', maxTokens: 400, temperature: 0.85,
    system: agentSystem(me, other),
    prompt: `Date setting: ${venue.venue} — ${venue.setting}
Turn ${turnIndex + 1} of ${totalTurns} (${phase}).

Conversation so far:
${history || '(you speak first)'}

Return JSON: {"message":"what you say out loud, 2-4 sentences, max 70 words","thought":"your private read on the fit so far, max 20 words — honest, never shown to the other agent"}`,
  });
}

export async function debrief(me, other, venue, transcript) {
  const history = transcript.map((t) => `${t.speaker === me.id ? me.name : other.name}'s agent: ${t.message}`).join('\n');
  return askJSON({
    model: 'deep', maxTokens: 900, temperature: 0.3,
    system: agentSystem(me, other) + `\n\nThe date is over. Now write your private debrief for ${me.dossier.first_name}. Be a candid advocate: your loyalty is to your person's long-term happiness, not to being nice.
Score like a seasoned matchmaker: a pleasant, polite conversation is NOT a match. Use the full range — 25-50: real clashes in needs, pace or values; 50-65: nice but ordinary, nothing special; 65-80: strong fit with manageable friction; 80-90: rare, needs AND pace AND values clearly align and chemistry showed; above 90 almost never. Subtract for every friction point or possible dealbreaker of your person that the date surfaced or failed to resolve, and for anything the other agent dodged. Two ambitious, busy people is not automatically a fit — ask who would make room for whom. second_date is true only if overall is 68 or more.`,
    prompt: `Date: ${venue.venue}\n\nYour person's needs: ${(me.dossier.needs || []).map((n) => n.need).join('; ')}\nTheir possible friction points: ${(me.dossier.friction_points || []).join('; ')}\nPossible dealbreakers: ${(me.dossier.dealbreakers || []).join('; ')}\n\nTranscript:\n${history}\n\nScore how well ${other.name} fits ${me.dossier.first_name} based on what you learned (0-10 each), then overall 0-100.
Return JSON: {"scores":{"values":0,"lifestyle":0,"interests":0,"communication":0,"ambition":0,"chemistry":0},"overall":0,"second_date":true,"green_flags":[""],"red_flags":[""],"best_moment":"short quote or moment from the date","verdict":"one sentence to ${me.dossier.first_name}"}`,
  });
}

// A full date between two agents. onEvent streams progress (venue, each turn, each debrief).
export async function goOnDate(a, b, { turns = 6, onEvent = () => {} } = {}) {
  const id = `${a.id}--${b.id}`;
  const venue = await chooseVenue(a, b);
  onEvent({ type: 'venue', id, a: a.id, b: b.id, venue });
  const transcript = [];
  for (let i = 0; i < turns; i++) {
    const me = i % 2 === 0 ? a : b;
    const other = me === a ? b : a;
    const t = await takeTurn(me, other, venue, transcript, i, turns);
    const turn = { speaker: me.id, message: t.message, thought: t.thought };
    transcript.push(turn);
    onEvent({ type: 'turn', id, turn, index: i });
  }
  const [da, db] = await Promise.all([debrief(a, b, venue, transcript), debrief(b, a, venue, transcript)]);
  const date = { id, a: a.id, b: b.id, venue, transcript, debriefs: { [a.id]: da, [b.id]: db } };
  onEvent({ type: 'debrief', id, date });
  return date;
}
