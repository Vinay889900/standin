// The Reader: turns the two raw sources (LinkedIn + Instagram) into a dossier the person's agent will carry.
// Every claim must point at evidence (a source id + verbatim snippet) from those two sources only.
import { askJSON } from '../llm.js';

const cut = (s, n) => (s || '').slice(0, n);

// Flatten both sources into numbered snippets the model can cite (LI-1, IG-3 …).
export function buildSourcePack(li, ig) {
  const snips = [];
  const add = (src, kind, text, extra = {}) => { if (text && text.trim()) snips.push({ id: `${src}-${snips.filter((s) => s.src === src).length + 1}`, src, kind, text: cut(text.trim(), 700), ...extra }); };
  if (li) {
    add('LI', 'headline', li.headline);
    add('LI', 'location', li.location);
    add('LI', 'about', li.about);
    (li.experience || []).forEach((e) => add('LI', 'experience', e));
    (li.education || []).forEach((e) => add('LI', 'education', e));
    (li.posts || []).forEach((e) => add('LI', 'post/activity', e));
    (li.articles || []).forEach((e) => add('LI', 'article', e));
    (li.publications || []).forEach((e) => add('LI', 'publication', e));
    (li.awards || []).forEach((e) => add('LI', 'award', e));
    (li.volunteering || []).forEach((e) => add('LI', 'volunteering', e));
    (li.languages || []).forEach((e) => add('LI', 'language', e));
    (li.projects || []).forEach((e) => add('LI', 'project', e));
    if (li.text) add('LI', 'page text', cut(li.text, 4000));
    if (li.raw) add('LI', 'profile data', cut(li.raw, 4000));
  }
  if (ig) {
    add('IG', 'bio', ig.bio);
    add('IG', 'category', ig.category);
    if (ig.summary) add('IG', 'profile summary', ig.summary);
    (ig.posts || []).forEach((p) => add('IG', 'post', [p.caption && `caption: ${p.caption}`, p.alt && `photo shows: ${p.alt}`, p.location && `location: ${p.location}`, p.hashtags?.length && `tags: #${p.hashtags.slice(0, 8).join(' #')}`, p.date && `date: ${p.date}`].filter(Boolean).join(' | '), { url: p.url }));
  }
  return snips;
}

const SYSTEM = `You are "the Reader", the first stage of an agentic dating service. A person is represented by an AI agent that will go on dates on their behalf. Your job: read the person's two public sources — their LinkedIn and their Instagram — and write the dossier that agent will carry.

Rules:
- Use ONLY the numbered source snippets provided. No outside knowledge about this person, even if they are famous.
- Every item must cite evidence: the snippet id(s) and a short verbatim quote (max 18 words) copied from that snippet.
- Read between the lines like a perceptive friend: what do their captions, photo descriptions, locations, career moves and writing reveal about needs, routines, energy and values? Prefer specific over generic ("5 a.m. runs, posts about discipline" beats "likes fitness").
- Calibrate: give a confidence (high / medium / low) for every inference. If a source is thin, say so instead of inventing.
- NEVER infer or mention religion, health conditions, sexual orientation, politics, ethnicity/caste, or current relationship status. Do not guess gender or pronouns; refer to the person by first name.
- "needs" = what this person would need from a partner to thrive (time, pace, ambition, space, curiosity…), inferred from evidence.`;

export async function readPerson(li, ig) {
  const snips = buildSourcePack(li, ig);
  const name = li?.name || ig?.name || 'This person';
  const prompt = `Person: ${name}
LinkedIn: ${li?.url || 'n/a'} (read via ${li?.via || 'n/a'})
Instagram: ${ig?.url || 'n/a'} (read via ${ig?.via || 'n/a'}; ${ig?.followers ?? '?'} followers, ${ig?.postsCount ?? '?'} posts)

SOURCE SNIPPETS
${snips.map((s) => `[${s.id}] (${s.kind}) ${s.text}`).join('\n')}

Return JSON:
{
 "first_name": "",
 "tagline": "one line, max 12 words, like a newspaper personals headline",
 "personals_ad": "a 45-60 word personals-column ad written by their agent, warm and specific, third person, first name only",
 "summary": "3 sentences: who they are, what drives them, how they spend their time",
 "needs": [{"need":"", "why":"", "evidence":[{"id":"LI-3","quote":""}], "confidence":"high|medium|low"}],   // 4-6
 "hobbies": [{"name":"", "detail":"", "evidence":[{"id":"","quote":""}], "confidence":""}],                 // 3-6, real activities they do
 "interests": [{"name":"", "evidence":[{"id":"","quote":""}]}],                                          // 4-8, topics they care about
 "values": [{"name":"", "evidence":[{"id":"","quote":""}]}],                                             // 3-5
 "personality": {"traits":["",""], "communication_style":"", "humor":"", "energy":""},
 "lifestyle": {"base":"city/region if stated", "pace":"", "travel":"", "routine":""},
 "ambitions": [""],
 "looking_for": ["partner qualities that would fit them"],
 "green_flags": [""],
 "friction_points": ["what could clash in a relationship, honestly"],
 "dealbreakers": ["hypothesised, with low confidence wording"],
 "ideal_date": "one specific date idea grounded in their evidence",
 "openers": ["3 conversation openers their agent could use"],
 "voice": ["2-3 short phrases in their own words, copied from captions/about"],
 "card": {"one_liner":"max 20 words for other agents to see", "tags":["5 short tags"]},
 "data_quality": {"linkedin":"rich|ok|thin", "instagram":"rich|ok|thin", "note":""}
}`;
  const dossier = await askJSON({ system: SYSTEM, prompt, model: 'deep', maxTokens: 4000, temperature: 0.4 });
  // attach resolvable evidence (so the UI can show the exact snippet / link the agent read)
  const byId = Object.fromEntries(snips.map((s) => [s.id, s]));
  const resolve = (arr) => (arr || []).map((e) => ({ ...e, src: byId[e.id]?.src || (e.id || '').split('-')[0], url: byId[e.id]?.url || null, kind: byId[e.id]?.kind || null }));
  for (const k of ['needs', 'hobbies', 'interests', 'values']) (dossier[k] || []).forEach((it) => { it.evidence = resolve(it.evidence); });
  return { dossier, snippets: snips };
}
