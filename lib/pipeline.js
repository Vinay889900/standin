// Shared pipeline pieces used by both the demo builder and the live "send your agent" endpoint.
import { scrapeLinkedIn, normalizeLinkedIn } from './scrape/linkedin.js';
import { scrapeInstagram, normalizeInstagram } from './scrape/instagram.js';
import { readPerson } from './agents/reader.js';
import { lobby, rankFor, runDates } from './agents/matchmaker.js';
import { askJSON } from './llm.js';

export const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Keep only what the UI needs from the raw scrape (and nothing beyond the two public profiles).
export function trimSources(li, ig) {
  return {
    li: li && { url: li.url, via: li.via, name: li.name, headline: li.headline, location: li.location, about: li.about, experience: li.experience, education: li.education, posts: li.posts, articles: li.articles, fetchedAt: li.fetchedAt },
    ig: ig && { url: ig.url, via: ig.via, handle: ig.handle, name: ig.name, bio: ig.bio, category: ig.category, followers: ig.followers, postsCount: ig.postsCount, posts: (ig.posts || []).map(({ image, ...p }) => p), fetchedAt: ig.fetchedAt, thin: !!ig.thin },
  };
}

export async function letterFor(person, ranking, dates, byId) {
  const top = ranking.slice(0, 3).map((r) => {
    const d = dates.find((x) => x.id === r.dateId);
    return `${byId[r.id].name} (fit ${r.fit}, ${r.basis === 'date' ? `dated at ${d?.venue?.venue}; my verdict: ${r.reason}; their agent's verdict: ${d?.debriefs[r.id]?.verdict}` : `not dated; lobby read: ${r.reason}`})`;
  }).join('\n');
  return askJSON({
    model: 'deep', maxTokens: 500, temperature: 0.6,
    system: `You are the dating agent of ${person.name}. Write your short report back to ${person.dossier.first_name} after a week of dates on their behalf. Warm, candid, specific; no pronoun guessing.`,
    prompt: `Their needs: ${(person.dossier.needs || []).map((n) => n.need).join('; ')}\nTop of the ranking:\n${top}\n\nReturn JSON: {"headline":"max 10 words","letter":"70-110 words: who you'd pick first and why, what surprised you, one honest caution"}`,
  });
}

// Live run for one new person against an existing pool. emit(event) streams progress to the browser.
export async function runLive({ linkedin, instagram, pool, dates: poolDates = [], lobbies: poolLobbies = {}, emit, numDates = 4, turns = 6 }) {
  const nl = normalizeLinkedIn(linkedin), ni = normalizeInstagram(instagram);
  if (!nl) throw new Error('Please paste a LinkedIn profile link like https://www.linkedin.com/in/your-name');
  if (!ni) throw new Error('Please paste an Instagram profile link like https://www.instagram.com/yourhandle');
  const log = (msg) => emit({ type: 'log', msg });

  emit({ type: 'stage', stage: 'scrape' });
  const [liR, igR] = await Promise.allSettled([scrapeLinkedIn(nl.url, log), scrapeInstagram(ni.url, log)]);
  if (liR.status === 'rejected') throw new Error(liR.reason.message);
  if (igR.status === 'rejected') throw new Error(igR.reason.message);
  const li = liR.value, ig = igR.value;
  const id = 'live-' + slugId(nl.slug);
  emit({ type: 'sources', id, sources: trimSources(li, ig), photo: ig.photo || li.photo || null });

  emit({ type: 'stage', stage: 'read' });
  log(`Reader: analysing ${li.name} — ${(li.experience || []).length} LinkedIn roles, ${(ig.posts || []).length} Instagram posts…`);
  const { dossier, snippets } = await readPerson(li, ig);
  const me = { id, name: li.name || ig.name, linkedin: nl.url, instagram: ni.url, photo: ig.photo || li.photo || null, dossier, snippets, sources: trimSources(li, ig), live: true };
  emit({ type: 'dossier', person: me });

  emit({ type: 'stage', stage: 'lobby' });
  log(`${dossier.first_name}'s agent walks into the lobby and reads ${pool.length} cards…`);
  const myLobby = await lobby(me, pool, numDates);
  emit({ type: 'lobby', lobby: myLobby });

  emit({ type: 'stage', stage: 'dates' });
  const pairs = myLobby.ask_out.slice(0, numDates).map((q) => ({ a: id, b: q, why: 'asked out' }));
  log(`Booking ${pairs.length} dates in parallel: ${pairs.map((p) => pool.find((x) => x.id === p.b)?.name).join(', ')}`);
  const dates = await runDates([me, ...pool], pairs, { turns, onEvent: emit });

  emit({ type: 'stage', stage: 'rank' });
  const lobbies = { ...poolLobbies, [id]: myLobby };
  const people = [me, ...pool];
  const ranking = rankFor(id, people, lobbies, dates);
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  let letter = null;
  try { letter = await letterFor(me, ranking, dates, byId); } catch {}
  const result = { person: me, lobby: myLobby, dates, ranking, letter, finishedAt: new Date().toISOString() };
  emit({ type: 'done', result });
  return result;
}
