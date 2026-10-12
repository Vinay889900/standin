// Checks candidate LinkedIn slugs resolve to the expected person (public guest view). Usage: node scripts/verify-li.js slug1 slug2 …
import { scrapeLinkedIn } from '../lib/scrape/linkedin.js';
import fs from 'node:fs';
fs.mkdirSync('data/raw', { recursive: true });
for (const slug of process.argv.slice(2)) {
  try {
    const d = await scrapeLinkedIn(`https://www.linkedin.com/in/${slug}`);
    fs.writeFileSync(`data/raw/li-${slug.toLowerCase()}.json`, JSON.stringify(d, null, 1));
    console.log(`OK  ${slug} | ${d.name} | ${(d.headline || '').slice(0, 70)} | about:${(d.about || d.text || '').length} exp:${d.experience?.length ?? '-'} posts:${d.posts?.length ?? '-'} via ${d.via}`);
  } catch (e) { console.log(`ERR ${slug} | ${e.message.slice(0, 160)}`); }
  await new Promise((r) => setTimeout(r, +process.env.DELAY || 1200));
}
