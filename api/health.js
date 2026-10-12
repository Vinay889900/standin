export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, llm: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY), apify: !!process.env.APIFY_TOKEN }));
}
