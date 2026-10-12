"""Records the Standin demo video: Playwright drives the real site scene by scene, each scene timed to its
voiceover (edge-tts); ffmpeg trims/fits every clip to its narration and muxes the final 1920x1080 MP4.
Usage: python video/record.py http://localhost:3000   (reads video/script.json)
"""
import asyncio, json, os, re, subprocess, sys, time
from pathlib import Path
import imageio_ffmpeg
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
HERE = Path(__file__).parent
WORK = HERE / 'work'
WORK.mkdir(exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = 'en-US-AndrewMultilingualNeural'
W, H = 1536, 864
script = json.loads((HERE / 'script.json').read_text(encoding='utf8'))


def duration(path):
    out = subprocess.run([FF, '-i', str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def tts(i, text):
    mp3 = WORK / f'vo{i:02d}.mp3'
    if not mp3.exists() or (WORK / f'vo{i:02d}.txt').read_text(encoding='utf8') != text if (WORK / f'vo{i:02d}.txt').exists() else True:
        subprocess.run(['edge-tts', '--voice', VOICE, '--rate=+6%', '--text', text, '--write-media', str(mp3)], check=True)
        (WORK / f'vo{i:02d}.txt').write_text(text, encoding='utf8')
    return mp3, duration(mp3)


LABEL_JS = """(t) => { let el = document.getElementById('__lbl'); if (!el) { el = document.createElement('div'); el.id='__lbl';
 el.style.cssText='position:fixed;left:24px;bottom:22px;z-index:99;background:#1b1916;color:#f3eee4;font:500 15px/1 IBM Plex Mono,monospace;letter-spacing:.06em;padding:11px 14px;text-transform:uppercase';
 document.body.appendChild(el);} el.textContent=t; }"""

SCROLL_JS = """async ([y, ms]) => { const s = window.scrollY, d = y - s, t0 = performance.now();
 await new Promise(r => { const f = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
 window.scrollTo(0, s + d * e); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); }"""


async def y_of(page, sel, offset=-90):
    return await page.evaluate("([s,o]) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + window.scrollY + o : 0 }", [sel, offset])


async def run_scene(browser, i, sc, dur):
    ctx = await browser.new_context(viewport={'width': W, 'height': H}, record_video_dir=str(WORK / f'raw{i:02d}'), record_video_size={'width': W, 'height': H})
    page = await ctx.new_page()
    t_ctx = time.time()
    await page.goto(BASE + sc['url'], wait_until='networkidle')
    await page.wait_for_timeout(600)
    if sc.get('label'):
        await page.evaluate(LABEL_JS, sc['label'])
    t_start = time.time()
    for step in sc.get('steps', []):
        kind = step[0]
        if kind == 'wait':
            await page.wait_for_timeout(int(step[1] * 1000))
        elif kind == 'scroll':  # ('scroll', selector_or_px, seconds)
            target = step[1] if isinstance(step[1], (int, float)) else await y_of(page, step[1])
            await page.evaluate(SCROLL_JS, [target, int(step[2] * 1000)])
        elif kind == 'type':
            await page.click(step[1]); await page.type(step[1], step[2], delay=28)
        elif kind == 'click':
            await page.click(step[1])
        elif kind == 'label':
            await page.evaluate(LABEL_JS, step[1])
        elif kind == 'until':  # ('until', js_condition, timeout_s, follow_selector)
            t_end = time.time() + step[2]
            while time.time() < t_end:
                if await page.evaluate(step[1]):
                    break
                if len(step) > 3:
                    await page.evaluate("(s) => { const e = [...document.querySelectorAll(s)].pop(); if (e) e.scrollIntoView({behavior:'smooth', block:'center'}) }", step[3])
                await page.wait_for_timeout(1500)
    t_end = time.time()
    await page.wait_for_timeout(300)
    await ctx.close()
    webm = next((WORK / f'raw{i:02d}').glob('*.webm'))
    return webm, t_start - t_ctx, t_end - t_ctx


async def main():
    only = set(int(x) for x in os.environ.get('ONLY', '').split(',') if x)
    clips = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        for i, sc in enumerate(script):
            mp3, d = tts(i, sc['vo'])
            seg = WORK / f'seg{i:02d}.mp4'
            if not only or i in only or not seg.exists():
                for old in (WORK / f'raw{i:02d}').glob('*.webm') if (WORK / f'raw{i:02d}').exists() else []:
                    old.unlink()
                webm, a, b = await run_scene(browser, i, sc, d)
                span = max(0.5, b - a)
                target = d + 0.6
                speed = span / target  # >1 = speed up
                print(f'scene {i}: recorded {span:.1f}s → {target:.1f}s (x{speed:.2f})')
                vf = f"trim=start={a:.2f}:end={b:.2f},setpts=(PTS-STARTPTS)/{speed:.4f},fps=30,scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,trim=duration={target:.2f}"
                subprocess.run([FF, '-y', '-loglevel', 'error', '-i', str(webm), '-i', str(mp3), '-filter_complex',
                                f"[0:v]{vf}[v];[1:a]apad=whole_dur={target:.2f},aresample=48000[a]", '-map', '[v]', '-map', '[a]',
                                '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', str(seg)], check=True)
            clips.append(seg)
        await browser.close()
    lst = WORK / 'list.txt'
    lst.write_text(''.join(f"file '{c.as_posix()}'\n" for c in clips))
    out = HERE / 'standin-demo.mp4'
    subprocess.run([FF, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', '-movflags', '+faststart', str(out)], check=True)
    print('wrote', out, f'{duration(out):.1f}s')


asyncio.run(main())
