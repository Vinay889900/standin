// Instagram public profile reader.
// 1) Apify `apify/instagram-profile-scraper` (bio, category, link, last ~12 posts with captions,
//    hashtags, locations and Instagram's own image alt-text).
// 2) Fallback: Instagram's public web_profile_info endpoint (works from some residential IPs).
// 3) Fallback: Open Graph meta (name, counts, photo only) — flagged as "thin" so the Reader knows.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function normalizeInstagram(input) {
  const s = String(input || '').trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i) || s.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (!m || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(m[1].toLowerCase())) return null;
  const handle = m[1].toLowerCase();
  return { handle, url: `https://www.instagram.com/${handle}/` };
}

function shapePosts(posts = []) {
  return posts.slice(0, 12).map((p) => ({
    caption: clean(p.caption).slice(0, 600),
    hashtags: p.hashtags || [],
    type: p.type || p.productType || null,
    location: p.locationName || null,
    alt: clean(p.alt || p.accessibility_caption || ''),
    date: p.timestamp ? String(p.timestamp).slice(0, 10) : null,
    likes: p.likesCount ?? null,
    url: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
    image: p.displayUrl || null,
  }));
}

async function fetchApify(handle) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('no APIFY_TOKEN configured');
  const r = await fetch(`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${token}&timeout=150`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [handle], resultsLimit: 12 }),
    signal: AbortSignal.timeout(160000),
  });
  if (!r.ok) throw new Error(`Apify HTTP ${r.status}`);
  const [p] = await r.json();
  if (!p || p.error) throw new Error(p?.errorDescription || p?.error || 'profile not found');
  if (p.private) { const e = new Error('This Instagram account is private — only public profiles can be read'); e.fatal = true; throw e; }
  return {
    source: 'instagram', via: 'apify:instagram-profile-scraper', handle,
    name: p.fullName, bio: clean(p.biography), category: p.businessCategoryName || null,
    externalUrl: p.externalUrl || null, followers: p.followersCount, following: p.followsCount, postsCount: p.postsCount,
    verified: !!p.verified, photo: p.profilePicUrlHD || p.profilePicUrl, posts: shapePosts(p.latestPosts),
  };
}

async function fetchWebProfileInfo(handle) {
  const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}`, {
    headers: { 'User-Agent': UA, 'x-ig-app-id': '936619743392459' }, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Instagram HTTP ${r.status}`);
  const u = (await r.json())?.data?.user;
  if (!u) throw new Error('profile not found');
  if (u.is_private) { const e = new Error('This Instagram account is private — only public profiles can be read'); e.fatal = true; throw e; }
  const edges = u.edge_owner_to_timeline_media?.edges || [];
  return {
    source: 'instagram', via: 'instagram-web_profile_info', handle,
    name: u.full_name, bio: clean(u.biography), category: u.category_name || null, externalUrl: u.external_url,
    followers: u.edge_followed_by?.count, following: u.edge_follow?.count, postsCount: u.edge_owner_to_timeline_media?.count,
    verified: !!u.is_verified, photo: u.profile_pic_url_hd,
    posts: shapePosts(edges.map(({ node: n }) => ({
      caption: n.edge_media_to_caption?.edges?.[0]?.node?.text, alt: n.accessibility_caption, type: n.__typename,
      location: n.location?.name, timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
      likesCount: n.edge_liked_by?.count, shortCode: n.shortcode, displayUrl: n.display_url,
    }))),
  };
}

async function fetchOgMeta(handle) {
  const r = await fetch(`https://www.instagram.com/${handle}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Instagram HTTP ${r.status}`);
  const html = await r.text();
  const meta = (p) => (html.match(new RegExp(`<meta property="${p}" content="([^"]*)"`)) || [])[1];
  const dec = (s) => (s || '').replace(/&#064;/g, '@').replace(/&#x2022;/g, '•').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const title = dec(meta('og:title'));
  if (!title) throw new Error('profile not found');
  const desc = dec(meta('og:description'));
  return {
    source: 'instagram', via: 'og-meta (thin)', thin: true, handle,
    name: title.replace(/ \(@.*$/, ''), bio: '', summary: desc, photo: dec(meta('og:image')), posts: [],
  };
}

export async function scrapeInstagram(input, log = () => {}) {
  const n = normalizeInstagram(input);
  if (!n) throw new Error('That is not an Instagram profile link (expected instagram.com/<handle>)');
  const errors = [];
  for (const [label, fn] of [['Apify scraper', fetchApify], ['public web API', fetchWebProfileInfo], ['Open Graph meta', fetchOgMeta]]) {
    try {
      log(`Instagram: trying ${label}…`);
      const d = await fn(n.handle);
      d.url = n.url;
      d.fetchedAt = new Date().toISOString();
      log(`Instagram: read via ${label}${d.posts?.length ? ` (${d.posts.length} posts)` : ''}`);
      return d;
    } catch (e) {
      if (e.fatal) throw e;
      errors.push(`${label}: ${e.message}`);
    }
  }
  throw new Error('Could not read the Instagram profile — ' + errors.join('; '));
}
