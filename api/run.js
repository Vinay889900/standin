// POST /api/run  {linkedin, instagram}  → streams newline-delimited JSON events while the agent reads, dates and ranks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLive } from '../lib/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let demo;
function loadDemo() {
  if (!demo) demo = JSON.parse(fs.readFileSync(path.join(here, '..', 'public', 'data', 'demo.json'), 'utf8'));
  return demo;
}

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let body = req.body;
  if (!body || typeof body !== 'object') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; }
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const emit = (e) => { try { res.write(JSON.stringify(e) + '\n'); } catch {} };
  const ping = setInterval(() => emit({ type: 'ping' }), 10000);
  try {
    const d = loadDemo();
    await runLive({ linkedin: body.linkedin, instagram: body.instagram, pool: d.people, lobbies: d.lobbies, emit, numDates: Math.min(5, Math.max(2, +body.dates || 4)) });
  } catch (e) {
    emit({ type: 'error', message: e.message || String(e) });
  } finally {
    clearInterval(ping);
    res.end();
  }
}
