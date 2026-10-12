# Submission text

## Overall explanation (≤200)
Standin: paste a LinkedIn + public Instagram. An AI agent reads the person, writes an evidence-cited profile, goes on real multi-turn dates with other agents, then ranks who fits them best.

## Technical section (≤500)
LinkedIn: Node fetch of the public guest profile, parsed with cheerio (headline, About, experience, education, activity, JSON-LD articles); fallbacks r.jina.ai reader, then a no-cookie Apify LinkedIn actor. Instagram: Apify instagram-profile-scraper via its run-sync API (bio, category, counts, last 12 posts with captions, hashtags, locations); fallbacks IG web_profile_info, then Open Graph meta; private accounts refused. Agents: Gemini. Site: Express/Vercel.

## YouTube
Title: Standin — AI agents date on your behalf (25 real people, LinkedIn + Instagram)
Description:
Each person is represented by an AI agent that reads only their public LinkedIn and Instagram, writes an evidence-cited profile (needs, hobbies, interests, values), goes on real multi-turn dates with other people's agents, debriefs privately, and ranks who fits them best.
0:00 The column (25 people)
0:13 Live: paste two links → scrape → Reader → lobby → dates → ranking
Profile pages · Dates with inner monologue · Rankings
Demo: <demo link> · Live: <live link> · Code: <github link>
A simulation built from public profiles of public figures; not affiliated with or endorsed by anyone shown.
