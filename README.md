# Standin — agents date for you

**Paste a LinkedIn and a public Instagram. An AI agent reads the person, goes on real multi-turn dates with other people's agents on their behalf, and ranks who fits them best.**

- **Demo (finished 25-person run):** `/` → the column, `/dates`, `/rankings`, `/p/<id>`
- **Try it live:** `/run` — paste your own two links and watch your agent read, date and rank

```
LinkedIn (public)  +  Instagram (public)
            │
            ▼
   Scrapers ── LinkedIn: public profile HTML → cheerio + JSON-LD  (fallbacks: r.jina.ai reader, Apify no-cookie actor)
            └─ Instagram: Apify instagram-profile-scraper          (fallbacks: web_profile_info, Open Graph meta)
            │
            ▼
   The Reader ─ numbered source snippets (LI-3, IG-9 …) → dossier: needs · hobbies · interests · values ·
            │   personality · lifestyle · looking for · friction · ideal date · personals ad
            │   every claim = snippet id + verbatim quote + confidence
            ▼
   Profile page
            │
            ▼
   Lobby ─ each agent sees only public cards, scores all others 0–100, asks out its top 5
            │
            ▼
   Scheduling ─ mutual asks first, then one-sided, then top-ups (3–5 dates per person)
            │
            ▼
   Dates ─ two independent agents, 6 turns; each sees ONLY its own person's dossier + the transcript
            │   every turn: what it says + a private thought (the "inner monologue")
            ▼
   Debriefs ─ each agent scores the other person for its own human (values, lifestyle, interests,
            │   communication, ambition, chemistry), overall 0–100, second date yes/no, verdict
            ▼
   Ranking ─ for every person, all others: dated = √(myScore·theirScore) ± 6 for mutual yes/no;
             not dated = mean lobby read × 0.9 (labelled estimate) → plus a short report from the agent
```

## How the agents date

Each person gets their own agent. An agent is a model call whose system prompt is that person's **private** dossier (built only from their LinkedIn + Instagram) and a job: represent them honestly, find out whether the other person fits, and be good company. On a date the two agents never see each other's dossier — only the other's public one-liner and what is said at the table — so they have to ask, follow up and probe needs, pace and dealbreakers like people on a real date. They speak *as representatives* ("Ankur would…"), never impersonating the person. After the date each agent writes a candid debrief whose loyalty is to its own person.

## The 25 people

Public figures who keep public professional personas on both platforms (founders, authors, creators, investors — India and global, women and men). Each was verified by scraping both links; profiles that hide details from logged-out LinkedIn visitors, or whose Instagram handle could not be confirmed, were dropped. List: [`data/people.json`](data/people.json).

**Guardrails:** only the two sources are used; no outside knowledge; no inference of religion, health, orientation, politics, ethnicity/caste or relationship status; every page is labelled a simulation; nothing here is affiliated with or endorsed by the people shown.

## Tech stack

| Part | Tech |
|---|---|
| LinkedIn scraping | Node `fetch` of the public guest profile + `cheerio` (top card, About, experience, education, activity, JSON-LD articles); fallbacks `r.jina.ai` reader → Apify no-cookie LinkedIn actor |
| Instagram scraping | Apify `apify/instagram-profile-scraper` via run-sync API (bio, category, counts, latest posts: captions, hashtags, locations, Instagram alt-text); fallbacks IG `web_profile_info` → Open Graph meta; private accounts refused |
| Agents | Google Gemini (free tier) — Flash for Reader/lobby/debriefs/reports, Flash-Lite for date turns, pooled across models with per-model pacing; Anthropic Claude supported as a drop-in (`ANTHROPIC_API_KEY`) |
| Site | Vanilla HTML/CSS/JS, Express locally, Vercel functions in production; live runs stream newline-delimited JSON |

## Run it

```bash
npm install
cp .env.example .env         # GEMINI_API_KEY=…  APIFY_TOKEN=…
npm run build-demo           # scrape → read → lobby → dates → rankings → public/data/demo.json (cached in data/raw)
npm start                    # http://localhost:3000
```

Deploy: `npx vercel --prod` (set `GEMINI_API_KEY` and `APIFY_TOKEN` as environment variables).

## Files

- `lib/scrape/linkedin.js`, `lib/scrape/instagram.js` — the two scrapers with fallbacks
- `lib/agents/reader.js` — source snippets → evidence-cited dossier
- `lib/agents/dater.js` — the per-person agent: venue, turns, debrief
- `lib/agents/matchmaker.js` — lobby, scheduling, ranking
- `lib/pipeline.js` — live run for a new person against the 25-person pool
- `scripts/build-demo.js` — the full 25-person run
- `api/run.js` — streaming endpoint used by `/run`
