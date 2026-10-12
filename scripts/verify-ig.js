// Light existence/name check of Instagram handles via Open Graph meta. Usage: node scripts/verify-ig.js h1 h2 …
for (const h of process.argv.slice(2)) {
  try {
    const r = await fetch(`https://www.instagram.com/${h}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
    const html = await r.text();
    const t = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
    const d = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
    console.log(t ? `OK  ${h} | ${t.replace(/&#064;/g, '@').replace(/ &#x2022;.*/, '')} | ${(d || '').split(' - ')[0]}` : `ERR ${h} | HTTP ${r.status} no og:title`);
  } catch (e) { console.log(`ERR ${h} | ${e.message}`); }
  await new Promise((r) => setTimeout(r, 2500));
}
