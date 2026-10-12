// Re-runs only the post-date debriefs (same transcripts) with the current debrief prompt.
import 'dotenv/config';
import fs from 'node:fs';
import { debrief } from '../lib/agents/dater.js';

const RAW = 'data/raw';
const roster = JSON.parse(fs.readFileSync('data/people.json', 'utf8'));
const people = Object.fromEntries(roster.map((r) => {
  const li = JSON.parse(fs.readFileSync(`${RAW}/li-${r.id}.json`, 'utf8'));
  const ig = JSON.parse(fs.readFileSync(`${RAW}/ig-${r.id}.json`, 'utf8'));
  const { dossier } = JSON.parse(fs.readFileSync(`${RAW}/dossier-${r.id}.json`, 'utf8'));
  return [r.id, { id: r.id, name: li.name || ig.name, dossier }];
}));
const files = fs.readdirSync(RAW).filter((f) => f.startsWith('date-'));
let n = 0;
await Promise.all(files.map(async (f) => {
  const d = JSON.parse(fs.readFileSync(`${RAW}/${f}`, 'utf8'));
  if (d.recalibrated) return;
  const A = people[d.a], B = people[d.b];
  try {
    const [da, db] = await Promise.all([debrief(A, B, d.venue, d.transcript), debrief(B, A, d.venue, d.transcript)]);
    d.debriefs = { [d.a]: da, [d.b]: db };
    d.recalibrated = true;
    fs.writeFileSync(`${RAW}/${f}`, JSON.stringify(d, null, 1));
    console.log(`${++n}/${files.length} ${d.id}: ${da.overall}/${db.overall}`);
  } catch (e) { console.log('ERR', d.id, e.message); }
}));
