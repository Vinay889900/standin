// Runs the whole 25-person example end to end and writes public/data/demo.json.
// Every stage is cached in data/raw so a re-run only does missing work.
import 'dotenv/config';
import fs from 'node:fs';
import { scrapeLinkedIn } from '../lib/scrape/linkedin.js';
import { scrapeInstagram } from '../lib/scrape/instagram.js';
import { readPerson } from '../lib/agents/reader.js';
import { lobby, schedule, runDates, rankFor } from '../lib/agents/matchmaker.js';
import { trimSources, letterFor } from '../lib/pipeline.js';
import pLimit from 'p-limit';

const RAW = 'data/raw';
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync('public/img', { recursive: true });
fs.mkdirSync('public/data', { recursive: true });
const cache = async (file, fn) => {
  const f = `${RAW}/${file}`;
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v, null, 1));
  return v;
};
const only = (process.argv.find((a) => a.startsWith('--stage=')) || '').split('=')[1] || 'all';
const roster = JSON.parse(fs.readFileSync('data/people.json', 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. scrape + read
const people = [];
const lim = pLimit(4);
await Promise.all(roster.map((r) => lim(async () => {
  try {
    const li = await cache(`li-${r.id}.json`, () => scrapeLinkedIn(r.linkedin, (m) => log(r.id, m)));
    const ig = await cache(`ig-${r.id}.json`, () => scrapeInstagram(r.instagram, (m) => log(r.id, m)));
    const photo = `img/${r.id}.jpg`;
    if (!fs.existsSync('public/' + photo) && (ig.photo || li.photo)) {
      const res = await fetch(ig.photo || li.photo);
      if (res.ok) fs.writeFileSync('public/' + photo, Buffer.from(await res.arrayBuffer()));
    }
    if (only === 'scrape') return;
    const read = await cache(`dossier-${r.id}.json`, async () => { log(r.id, 'Reader…'); return readPerson(li, ig); });
    people.push({ id: r.id, name: li.name || ig.name, linkedin: r.linkedin, instagram: r.instagram, photo: fs.existsSync('public/' + photo) ? '/' + photo : null, dossier: read.dossier, snippets: read.snippets, sources: trimSources(li, ig) });
    log(r.id, 'ready');
  } catch (e) { log(r.id, 'FAILED', e.message); }
})));
if (only === 'scrape' || only === 'read') process.exit(0);
people.sort((a, b) => roster.findIndex((r) => r.id === a.id) - roster.findIndex((r) => r.id === b.id));
log(`${people.length} people read`);

// 2. lobby
const lobbies = {};
await Promise.all(people.map(async (p) => {
  lobbies[p.id] = await cache(`lobby-${p.id}.json`, () => { log(p.id, 'lobby…'); return lobby(p, people.filter((q) => q.id !== p.id), 5); });
}));

// 3. dates
const pairs = await cache('schedule.json', async () => schedule(people, lobbies, { minDates: 3, maxDates: 5 }));
log(`${pairs.length} dates scheduled`);
const dates = [];
const todo = [];
for (const pr of pairs) {
  const f = `${RAW}/date-${pr.a}--${pr.b}.json`;
  if (fs.existsSync(f)) dates.push(JSON.parse(fs.readFileSync(f, 'utf8'))); else todo.push(pr);
}
let doneN = 0;
const fresh = await runDates(people, todo, {
  turns: 6,
  onEvent: (e) => {
    if (e.type === 'debrief') { fs.writeFileSync(`${RAW}/date-${e.id}.json`, JSON.stringify(e.date, null, 1)); log(`date ${++doneN}/${todo.length} done: ${e.id} @ ${e.date.venue.venue}`); }
    if (e.type === 'error') log('date error', e.id, e.message);
  },
});
fresh.forEach((d) => { d.why ||= 'scheduled'; dates.push(d); });
for (const d of dates) d.why ||= pairs.find((p) => `${p.a}--${p.b}` === d.id)?.why;

// 4. rankings + letters
const byId = Object.fromEntries(people.map((p) => [p.id, p]));
const rankings = {};
for (const p of people) rankings[p.id] = rankFor(p.id, people, lobbies, dates);
const letters = {};
await Promise.all(people.map(async (p) => {
  letters[p.id] = await cache(`letter-${p.id}.json`, () => letterFor(p, rankings[p.id], dates, byId)).catch(() => null);
}));

const demo = { generatedAt: new Date().toISOString(), people, lobbies, dates, rankings, letters };
fs.writeFileSync('public/data/demo.json', JSON.stringify(demo));
log(`wrote public/data/demo.json — ${people.length} people, ${dates.length} dates, ${(fs.statSync('public/data/demo.json').size / 1e6).toFixed(1)} MB`);
