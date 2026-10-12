// Shared client code: loads the finished 25-person example + any live runs saved in this browser, renders common pieces.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);

const LIVE_KEY = 'standin.live.v1';
function liveRuns() { try { return JSON.parse(localStorage.getItem(LIVE_KEY) || '[]'); } catch { return []; } }
function saveLiveRun(result) {
  try {
    const all = liveRuns().filter((r) => r.person.id !== result.person.id);
    all.unshift(result);
    localStorage.setItem(LIVE_KEY, JSON.stringify(all.slice(0, 5)));
  } catch {}
}

let _db;
async function db() {
  if (_db) return _db;
  const demo = await fetch('/data/demo.json').then((r) => r.json());
  const live = liveRuns();
  const people = [...demo.people];
  const dates = [...demo.dates];
  const rankings = { ...demo.rankings };
  const letters = { ...demo.letters };
  for (const r of live) {
    people.push(r.person);
    dates.push(...r.dates);
    rankings[r.person.id] = r.ranking;
    letters[r.person.id] = r.letter;
  }
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  _db = { ...demo, people, dates, rankings, letters, byId, live, demoCount: demo.people.length };
  return _db;
}

const photo = (p) => p?.photo || '/img/placeholder.svg';
const first = (p) => p?.dossier?.first_name || (p?.name || '').split(' ')[0];

function masthead(active) {
  const nav = [['/', 'Front page'], ['/dates', 'Dates'], ['/rankings', 'Rankings'], ['/run', 'Send your agent'], ['/how', 'How it works']]
    .map(([h, t]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${t}</a>`).join('');
  return `<div class="wrap"><div class="top"><span class="kicker">Standin · agentic dating · a simulation built from public LinkedIn + Instagram</span><nav>${nav}</nav></div><hr class="double"></div>`;
}
function footer() {
  return `<footer><div class="wrap">Standin is a demonstration. Every person in the example is a public figure with a public LinkedIn and public Instagram; their agent read only those two pages. Agents speak <em>as representatives</em>, never as the person, and never infer religion, health, orientation, politics, ethnicity or relationship status. Nothing here is affiliated with or endorsed by the people shown. Code: <a href="https://github.com/Vinay889900/standin">github.com/Vinay889900/standin</a></div></footer>`;
}
function mount(active) {
  document.body.insertAdjacentHTML('afterbegin', masthead(active));
  document.body.insertAdjacentHTML('beforeend', footer());
}

function evidence(list) {
  return (list || []).slice(0, 2).map((e) => {
    const src = (e.src || (e.id || '').split('-')[0] || '').toUpperCase();
    const label = src === 'IG' ? 'Instagram' : 'LinkedIn';
    const q = esc(e.quote || '');
    return `<span class="ev ${src}"><b>${esc(e.id || label)}</b>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">“${q}”</a>` : `“${q}”`}</span>`;
  }).join('');
}

function rankRows(rows, d, limit = 99) {
  return rows.slice(0, limit).map((r) => {
    const q = d.byId[r.id];
    if (!q) return '';
    const href = r.basis === 'date' ? `/date/${encodeURIComponent(r.dateId)}` : `/p/${encodeURIComponent(r.id)}`;
    const basis = r.basis === 'date' ? `dated${r.mutual ? ' · both said yes' : ''}` : 'not dated · lobby estimate';
    return `<a class="rank ${r.rank <= 3 ? 'top' : ''}" href="${href}">
      <span class="n">${r.rank}</span><img src="${photo(q)}" alt="" loading="lazy">
      <span class="who">${esc(q.name)}<small>${esc(r.reason || '')}</small></span>
      <span class="fitcol"><span class="score"><span>${basis}</span><b>${r.fit}</b></span><span class="bar"><i style="width:${r.fit}%"></i></span></span>
    </a>`;
  }).join('');
}

function dateFit(date) {
  const a = date.debriefs[date.a]?.overall ?? 0, b = date.debriefs[date.b]?.overall ?? 0;
  return Math.round(Math.sqrt(Math.max(1, a) * Math.max(1, b)));
}

function lineHtml(t, d, date, opts = {}) {
  const p = d.byId[t.speaker];
  return `<div class="line"><div class="who"><a href="/p/${encodeURIComponent(t.speaker)}">${esc(first(p))}’s agent</a></div>
    <div><div class="msg">${esc(t.message)}</div><div class="thought">${esc(t.thought || '')}</div></div></div>`;
}

function profileHtml(p, d) {
  const dz = p.dossier || {};
  const ranking = d.rankings[p.id] || [];
  const myDates = d.dates.filter((x) => x.a === p.id || x.b === p.id);
  const letter = d.letters?.[p.id];
  const s = p.sources || {};
  const list = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const trait = (it, title) => `<div class="trait"><h3>${esc(title)}${it.confidence ? `<span class="conf ${esc(it.confidence)}">${esc(it.confidence)}</span>` : ''}</h3>${it.why || it.detail ? `<div class="why">${esc(it.why || it.detail)}</div>` : ''}${evidence(it.evidence)}</div>`;
  return `
  <section class="hero">
    <img src="${photo(p)}" alt="${esc(p.name)}">
    <div>
      <div class="kicker">Profile · read by ${esc(first(p))}’s agent from two sources</div>
      <h1>${esc(p.name)}</h1>
      <p class="tagline">${esc(dz.tagline || '')}</p>
      <div class="srcs mono"><a class="src-li" href="${esc(p.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a><a class="src-ig" href="${esc(p.instagram)}" target="_blank" rel="noopener">Instagram ↗</a>
      <span class="muted">${s.ig?.followers ? Number(s.ig.followers).toLocaleString() + ' IG followers · ' : ''}${(s.ig?.posts || []).length} posts read · ${(s.li?.experience || []).length} roles read</span></div>
    </div>
  </section>
  <hr>
  <section class="section cols">
    <div class="c7"><div class="kicker">The agent’s personals ad</div><p class="ad-copy">${esc(dz.personals_ad || '')}</p>
      <p style="margin-top:18px">${esc(dz.summary || '')}</p></div>
    <div class="c5 vr"><dl class="facts">
      <dt>Base</dt><dd>${esc(dz.lifestyle?.base || '—')}</dd>
      <dt>Pace</dt><dd>${esc(dz.lifestyle?.pace || '—')}</dd>
      <dt>Routine</dt><dd>${esc(dz.lifestyle?.routine || '—')}</dd>
      <dt>Travel</dt><dd>${esc(dz.lifestyle?.travel || '—')}</dd>
      <dt>Talks like</dt><dd>${esc(dz.personality?.communication_style || '—')}</dd>
      <dt>Humour</dt><dd>${esc(dz.personality?.humor || '—')}</dd>
      <dt>Energy</dt><dd>${esc(dz.personality?.energy || '—')}</dd>
      <dt>Traits</dt><dd>${esc((dz.personality?.traits || []).join(', '))}</dd>
      <dt>Ideal date</dt><dd>${esc(dz.ideal_date || '—')}</dd>
    </dl></div>
  </section>
  <section class="section cols" style="padding-top:0">
    <div class="c4"><div class="section-head"><h2>Needs</h2></div>${(dz.needs || []).map((n) => trait(n, n.need)).join('')}</div>
    <div class="c4"><div class="section-head"><h2>Hobbies</h2></div>${(dz.hobbies || []).map((n) => trait(n, n.name)).join('')}</div>
    <div class="c4"><div class="section-head"><h2>Interests</h2></div>${(dz.interests || []).map((n) => trait(n, n.name)).join('')}
      <div class="section-head" style="margin-top:28px"><h2>Values</h2></div>${(dz.values || []).map((n) => trait(n, n.name)).join('')}</div>
  </section>
  <section class="section cols" style="padding-top:0">
    <div class="c3"><div class="kicker">Looking for</div><ul class="list-inline">${list(dz.looking_for)}</ul></div>
    <div class="c3"><div class="kicker">Green flags</div><ul class="list-inline">${list(dz.green_flags)}</ul></div>
    <div class="c3"><div class="kicker">Possible friction</div><ul class="list-inline">${list(dz.friction_points)}</ul></div>
    <div class="c3"><div class="kicker">Ambitions</div><ul class="list-inline">${list(dz.ambitions)}</ul></div>
  </section>
  <section class="section cols" style="padding-top:0">
    <div class="c7">
      <div class="section-head"><h2>${esc(first(p))}’s ranking</h2><span class="kicker">who fits ${esc(first(p))} best · all ${ranking.length}</span></div>
      ${letter ? `<p class="ad-copy" style="font-size:19px;margin-bottom:18px"><span class="kicker" style="display:block">Report from the agent — ${esc(letter.headline || '')}</span>${esc(letter.letter || '')}</p>` : ''}
      ${rankRows(ranking, d)}
    </div>
    <div class="c5 vr">
      <div class="section-head"><h2>Dates</h2><span class="kicker">${myDates.length} dates</span></div>
      <div class="datelist">${myDates.map((x) => { const o = d.byId[x.a === p.id ? x.b : x.a]; const mine = x.debriefs[p.id]; return `<a class="row" style="grid-template-columns:1fr 70px" href="/date/${encodeURIComponent(x.id)}"><span><span class="names" style="font-size:22px">with ${esc(o?.name)}</span><br><span class="venue">${esc(x.venue?.venue)}</span><br><span class="mono ${mine?.second_date ? 'yes' : 'no'}">${mine?.second_date ? 'wants a second date' : 'no second date'}</span></span><span class="fit">${mine?.overall ?? '–'}</span></a>`; }).join('')}</div>
      <div class="section-head" style="margin-top:36px"><h2>What the agent read</h2><span class="kicker">${(p.snippets || []).length} snippets</span></div>
      <div class="reading">${(p.snippets || []).map((sn) => `<div class="snip ${sn.src}"><span class="id">${esc(sn.id)} · ${esc(sn.kind)}</span>${sn.url ? `<a href="${esc(sn.url)}" target="_blank" rel="noopener">${esc(sn.text.slice(0, 320))}</a>` : esc(sn.text.slice(0, 320))}</div>`).join('')}</div>
    </div>
  </section>`;
}
