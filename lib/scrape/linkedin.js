// LinkedIn public profile reader.
// 1) Direct GET of the public profile (guest view) → cheerio over the server-rendered sections + JSON-LD.
// 2) Fallback: r.jina.ai reader (markdown of the same public page).
// 3) Fallback: Apify no-cookie LinkedIn actor (if APIFY_TOKEN is set).
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function parseLinkedInHtml(html, url) {
  const $ = cheerio.load(html);
  const out = { source: 'linkedin', url, via: 'public-profile-html' };
  out.name = clean($('h1.top-card-layout__title').first().text()) || clean($('h1').first().text());
  out.headline = clean($('.top-card-layout__headline').first().text());
  out.location = clean($('.top-card__subline-item').first().text()) || clean($('.profile-info-subheader .not-first-middot span').first().text());
  out.followers = clean($('.top-card__subline-item').filter((i, el) => /follower/i.test($(el).text())).first().text());
  out.photo = $('img.top-card__profile-image').attr('data-delayed-url') || $('meta[property="og:image"]').attr('content') || null;
  out.about = clean($('section[data-section="summary"] .core-section-container__content').text());

  const items = (sel) => $(sel).map((i, el) => clean($(el).text())).get().filter(Boolean);
  out.experience = $('section[data-section="experience"] li.experience-item, section.experience li.profile-section-card')
    .map((i, el) => {
      const t = clean($(el).find('h3').first().text());
      const co = clean($(el).find('h4').first().text());
      const when = clean($(el).find('.date-range').first().text());
      const desc = clean($(el).find('.show-more-less-text__text--less, .experience-item__description').first().text());
      return [t, co && `@ ${co}`, when && `(${when})`, desc && `— ${desc}`].filter(Boolean).join(' ');
    }).get().filter(Boolean).slice(0, 12);
  out.education = $('section[data-section="educationsDetails"] li, section.education li')
    .map((i, el) => clean([$(el).find('h3').text(), $(el).find('h4').text(), $(el).find('.date-range').text()].join(' · '))).get()
    .filter((s) => s.replace(/[·\s]/g, '')).slice(0, 6);
  out.posts = $('section[data-section="posts"] li, section.activities li')
    .map((i, el) => clean($(el).find('.base-main-card__title, h3').first().text()) || clean($(el).text()).slice(0, 280)).get()
    .filter(Boolean).slice(0, 10);
  out.publications = items('section[data-section="publications"] li h3').slice(0, 8);
  out.awards = items('section[data-section="honors-and-awards"] li h3').slice(0, 8);
  out.volunteering = items('section[data-section="volunteering"] li h3, section.volunteering li h3').slice(0, 6);
  out.languages = items('section[data-section="languages"] li h3, section.languages li h3').slice(0, 6);
  out.courses = items('section[data-section="courses"] li h3').slice(0, 6);
  out.projects = items('section[data-section="projects"] li h3').slice(0, 6);

  // JSON-LD: articles (titles show what they write about) + Person node when present
  out.articles = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const d = JSON.parse($(el).text());
      const graph = d['@graph'] || [d];
      for (const n of graph) {
        if (n['@type'] === 'Article' && n.headline) out.articles.push(n.headline);
        if (n['@type'] === 'Person') {
          out.name ||= n.name;
          out.about ||= clean(n.description);
          out.headline ||= clean(n.jobTitle?.join ? n.jobTitle.join(', ') : n.jobTitle);
          if (n.address?.addressLocality && !out.location) out.location = n.address.addressLocality;
        }
      }
    } catch {}
  });
  out.articles = [...new Set(out.articles)].slice(0, 10);
  out.title = clean($('title').text());
  return out;
}

async function fetchDirect(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`LinkedIn returned HTTP ${r.status}`);
  const html = await r.text();
  if (/authwall|uas\/login|checkpoint\/challenge/i.test(r.url) || !/top-card-layout/.test(html)) throw new Error('LinkedIn served a login wall');
  return parseLinkedInHtml(html, url);
}

async function fetchJina(url) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { 'X-Return-Format': 'markdown' }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`Reader proxy returned HTTP ${r.status}`);
  const md = await r.text();
  if (/authwall|Sign in to view|Join LinkedIn/i.test(md.slice(0, 1500)) && md.length < 4000) throw new Error('LinkedIn served a login wall');
  const title = (md.match(/^Title: (.*)$/m) || [])[1] || '';
  if (/^Sign Up|^LinkedIn$|Page not found/i.test(title.trim())) throw new Error('profile not found (LinkedIn sign-up page)');
  const [name, headline] = title.replace(/ \| LinkedIn$/, '').split(' - ');
  // keep the readable body, drop nav link lists
  const body = md.split('\n').filter((l) => !/^\s*\*\s*\[|^\[Skip|^!\[|^\s*$/.test(l)).join('\n');
  return { source: 'linkedin', url, via: 'r.jina.ai', name: clean(name), headline: clean(headline), text: body.slice(0, 9000) };
}

async function fetchApify(url) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('no APIFY_TOKEN');
  const actor = process.env.APIFY_LINKEDIN_ACTOR || 'supreme_coder~linkedin-profile-scraper';
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=120`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [{ url }], profileUrls: [url] }),
    signal: AbortSignal.timeout(130000),
  });
  if (!r.ok) throw new Error(`Apify LinkedIn actor HTTP ${r.status}`);
  const [p] = await r.json();
  if (!p || p.error) throw new Error(p?.error || 'Apify returned no LinkedIn profile');
  return { source: 'linkedin', url, via: 'apify:' + actor, name: (p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ')).trim(), headline: p.headline, location: p.geoLocationName || p.location, about: p.summary || p.about, raw: JSON.stringify(p).slice(0, 9000) };
}

export function normalizeLinkedIn(input) {
  const m = String(input || '').trim().match(/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]).toLowerCase(), url: `https://www.linkedin.com/in/${m[1]}` };
}

export async function scrapeLinkedIn(input, log = () => {}) {
  const n = normalizeLinkedIn(input);
  if (!n) throw new Error('That is not a LinkedIn profile link (expected linkedin.com/in/…)');
  const errors = [];
  for (const [label, fn] of [['public profile', fetchDirect], ['reader proxy', fetchJina], ['Apify', fetchApify]]) {
    try {
      log(`LinkedIn: trying ${label}…`);
      const d = await fn(n.url);
      if (!d.name || !d.name.trim() || /^sign up$/i.test(d.name)) throw new Error('page had no profile name');
      d.slug = n.slug;
      d.fetchedAt = new Date().toISOString();
      log(`LinkedIn: read via ${label}`);
      return d;
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  }
  throw new Error('Could not read the LinkedIn profile — ' + errors.join('; '));
}
