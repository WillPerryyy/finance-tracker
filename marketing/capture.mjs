// Captures README screenshots and a promo video from the running app.
//
//   APP_URL=http://127.0.0.1:8230 ONBOARD_URL=http://127.0.0.1:8231 node capture.mjs
//
// APP_URL must serve the fictional demo profile (make_demo_data.py); ONBOARD_URL an empty profile.
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8230';
const ONBOARD = process.env.ONBOARD_URL ?? 'http://127.0.0.1:8231';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('screenshots');
const RAW = path.resolve('raw');
const W = 1440, H = 900;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const wait = ms => new Promise(r => setTimeout(r, ms));
const today = new Date();
const reminderDue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

// Keeps the reminder banner out of the shots and gives the page a visible cursor and caption bar.
const PAGE_SETUP = `
  try { localStorage.setItem('reminder-dismissed:${reminderDue}', '1'); localStorage.setItem('reminder-notified:${reminderDue}', '1'); } catch {}
  window.__installOverlay = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L8.5 21z" fill="#141B24" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', transition: 'transform 60ms linear' });
    document.body.appendChild(c);
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { c.style.transform = 'translate(-3px,-2px) scale(0.85)'; }, true);
    document.addEventListener('mouseup', () => { c.style.transform = 'translate(-3px,-2px)'; }, true);
    const cap = document.createElement('div');
    cap.id = '__caption';
    Object.assign(cap.style, {
      position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%) translateY(8px)', zIndex: 2147483646,
      background: 'rgba(20,27,36,0.92)', color: '#fff', font: '600 20px "Public Sans Variable", "Segoe UI", sans-serif',
      padding: '14px 24px', borderRadius: '10px', opacity: '0', transition: 'opacity 300ms, transform 300ms',
      pointerEvents: 'none', maxWidth: '980px', textAlign: 'center', letterSpacing: '-0.005em',
    });
    document.body.appendChild(cap);
    const card = document.createElement('div');
    card.id = '__card';
    Object.assign(card.style, {
      position: 'fixed', inset: '0', zIndex: 2147483645, background: '#1E2A3A', color: '#fff', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '22px', opacity: '0',
      transition: 'opacity 500ms', pointerEvents: 'none', fontFamily: '"Public Sans Variable", "Segoe UI", sans-serif',
    });
    document.body.appendChild(card);
  };
  window.__caption = (text) => {
    const cap = document.getElementById('__caption');
    if (!cap) return;
    if (!text) { cap.style.opacity = '0'; cap.style.transform = 'translateX(-50%) translateY(8px)'; return; }
    cap.textContent = text; cap.style.opacity = '1'; cap.style.transform = 'translateX(-50%) translateY(0)';
  };
  window.__card = (html) => {
    const card = document.getElementById('__card');
    if (!card) return;
    if (!html) { card.style.opacity = '0'; return; }
    card.innerHTML = html; card.style.opacity = '1';
  };
`;

const LOGO = '<div style="width:84px;height:84px;border-radius:18px;background:#2457C5;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:36px">FT</div>';

async function shot(page, name, opts = {}) {
  await wait(opts.settle ?? 700);
  await page.screenshot({ path: path.join(OUT, name), ...opts.clip ? { clip: opts.clip } : {} });
  console.log('  saved', name);
}

async function scrollToText(page, text, offset = 90) {
  await page.evaluate(([t, off]) => {
    const el = [...document.querySelectorAll('h2, h1')].find(h => h.textContent.trim().startsWith(t));
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'instant' });
  }, [text, offset]);
}

/* ─── Screenshots ─────────────────────────────────────────────────────── */

async function screenshots(browser) {
  console.log('Screenshots');
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await ctx.addInitScript(PAGE_SETUP);
  const page = await ctx.newPage();

  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await shot(page, '01-dashboard.png', { settle: 1200 });

  await page.goto(APP + '/accounts', { waitUntil: 'networkidle' });
  await shot(page, '02-accounts.png');

  await page.getByRole('button', { name: 'Edit Fidelity 401(k)' }).click();
  await wait(400);
  await page.evaluate(() => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 560));
  await shot(page, '03-employer-match.png');
  await page.keyboard.press('Escape');

  const row = page.locator('tbody tr', { hasText: 'Vanguard Brokerage' });
  await row.getByRole('button', { name: 'Update' }).click();
  await page.getByRole('button', { name: 'Add an amount' }).click();
  await page.locator('#bal-amount').fill('1250');
  await shot(page, '04-update-balance.png');
  await page.keyboard.press('Escape');

  await page.goto(APP + '/projections', { waitUntil: 'networkidle' });
  await scrollToText(page, 'Projected balance', 76);
  await shot(page, '05-forecast.png', { settle: 1000 });
  await page.getByRole('button', { name: '10 years' }).click();
  await shot(page, '06-forecast-zoomed.png');
  await scrollToText(page, 'Life events', 76);
  await shot(page, '07-life-events.png');

  await page.goto(APP + '/retirement', { waitUntil: 'networkidle' });
  await shot(page, '08-retirement.png', { settle: 1000 });

  const ob = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const op = await ob.newPage();
  await op.goto(ONBOARD + '/', { waitUntil: 'networkidle' });
  await op.waitForURL('**/welcome');
  await op.locator('#ob-name').fill('Alex');
  await op.locator('#ob-birth').fill('1992');
  await shot(op, '09-onboarding.png');
  await ob.close();
  await ctx.close();
}

/* ─── Promo video ─────────────────────────────────────────────────────── */

async function video(browser) {
  console.log('Video');
  const frameDir = path.join(RAW, 'frames');
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(PAGE_SETUP);
  const page = await ctx.newPage();
  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__installOverlay());
  await page.evaluate(html => window.__card(html), `${LOGO}<div style="font-size:46px;font-weight:650;letter-spacing:-0.02em">Finance Tracker</div><div style="font-size:22px;opacity:.8">See your whole financial picture, and where it’s heading.</div>`);
  await wait(300);

  // Record with the DevTools screencast so text stays sharp; each frame keeps its own timestamp.
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const file = path.join(frameDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // A gently moving cursor keeps frames flowing during pauses.
  const hold = async (ms, x = 720, y = 450) => {
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end) { await page.mouse.move(x + Math.sin(i / 6) * 3, y + Math.cos(i / 6) * 2); i++; await wait(80); }
  };
  const move = (x, y, steps = 25) => page.mouse.move(x, y, { steps });
  const caption = t => page.evaluate(text => window.__caption(text), t);
  const smoothScroll = async (to, ms = 1100) => {
    const from = await page.evaluate(() => window.scrollY);
    const n = Math.round(ms / 33);
    for (let i = 1; i <= n; i++) {
      const p = i / n, e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      await page.evaluate(y => window.scrollTo(0, y), from + (to - from) * e);
      await wait(33);
    }
  };
  const topOf = async (text, off = 76) => page.evaluate(([t, o]) => {
    const el = [...document.querySelectorAll('h2, h1')].find(h => h.textContent.trim().startsWith(t));
    return el ? el.getBoundingClientRect().top + window.scrollY - o : 0;
  }, [text, off]);
  const centerOf = async locator => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const clickOn = async locator => { const [x, y] = await centerOf(locator); await move(x, y, 22); await wait(150); await page.mouse.down(); await wait(90); await page.mouse.up(); };

  // 1. Title
  await hold(2600);
  await page.evaluate(() => window.__card(''));
  await hold(700);

  // 2. Dashboard
  await caption('Your net worth after debts, across every account and currency');
  await move(420, 210); await hold(2600, 420, 210);
  await caption('It builds a history every time you update a balance');
  await smoothScroll(await topOf('Net worth over time', 80));
  await move(1100, 330); await move(820, 360, 30); await hold(2400, 820, 360);
  await caption(null);

  // 3. Accounts
  await clickOn(page.getByRole('link', { name: 'Accounts' }));
  await wait(700);
  await caption('401(k), Roth IRA, HSA, brokerage, savings and debts in one table');
  await move(700, 470); await hold(2600, 700, 470);
  await caption('Updating a balance takes seconds');
  await clickOn(page.locator('tbody tr', { hasText: 'Vanguard Brokerage' }).getByRole('button', { name: 'Update' }));
  await wait(400);
  await clickOn(page.getByRole('button', { name: 'Add an amount' }));
  const amt = page.locator('#bal-amount');
  await clickOn(amt);
  await page.keyboard.type('1250', { delay: 140 });
  await hold(1400, 760, 500);
  await clickOn(page.getByRole('button', { name: 'Save balance' }));
  await hold(1500, 760, 500);
  await caption(null);

  // 4. Forecast
  await clickOn(page.getByRole('link', { name: 'Forecast' }));
  await wait(900);
  await caption('Every account projected to retirement, in today’s dollars');
  await smoothScroll(await topOf('Projected balance'), 1300);
  await move(980, 420, 30); await hold(800, 980, 420); await move(700, 470, 30); await hold(2000, 700, 470);
  await caption('Zoom into any stretch of years');
  await clickOn(page.getByRole('button', { name: '10 years' }));
  await hold(1500, 600, 300);
  const handle = page.getByRole('slider', { name: /Visible years/ });
  const [hx, hy] = await centerOf(handle);
  await move(hx, hy, 20); await page.mouse.down(); await move(hx + 260, hy, 45); await page.mouse.up();
  await hold(1600, hx + 260, hy);
  await clickOn(page.getByRole('button', { name: 'All', exact: true }));
  await hold(900, 700, 300);
  await caption('Plan for a home, a promotion or a family, and see the effect');
  await smoothScroll(await topOf('Life events'), 1200);
  await hold(2600, 760, 420);
  await caption(null);

  // 5. Retirement
  await clickOn(page.getByRole('link', { name: 'Retirement' }));
  await wait(900);
  await caption('What your savings could pay you each month, after tax');
  await move(900, 330, 30); await hold(2400, 900, 330);
  await caption('Compare withdrawal rates and see how long the money lasts');
  await smoothScroll(await topOf('Compare withdrawal rates'), 1100);
  await clickOn(page.locator('tbody tr', { hasText: '3.5%' }).first());
  await hold(1300, 900, 400);
  await clickOn(page.locator('tbody tr', { hasText: '4%' }).first());
  await hold(1400, 900, 400);
  await caption(null);

  // 6. End card
  await page.evaluate(html => window.__card(html), `${LOGO}<div style="font-size:42px;font-weight:650;letter-spacing:-0.02em">Finance Tracker</div><div style="font-size:22px;opacity:.85">Free for Windows. Your data never leaves your computer.</div><div style="margin-top:8px;font-size:18px;opacity:.6">Download it from GitHub</div>`);
  await hold(3400);

  await cdp.send('Page.stopScreencast');
  await ctx.close();

  // Encode: each frame shown until the next one arrived.
  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 1.5;
    return `file '${f.file.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
  }).join('\n') + `\nfile '${frames[frames.length - 1].file.replace(/\\/g, '/')}'\n`;
  const listFile = path.join(RAW, 'frames.txt');
  fs.writeFileSync(listFile, list);
  const mp4 = path.resolve('finance-tracker-promo.mp4');
  execFileSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'fps=30,scale=1440:900:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log('  saved', mp4, `(${frames.length} frames)`);

}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  if (!process.argv.includes('--video-only')) await screenshots(browser);
  if (!process.argv.includes('--shots-only')) await video(browser);
} finally {
  await browser.close();
}
