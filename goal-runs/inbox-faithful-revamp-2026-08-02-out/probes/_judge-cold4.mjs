import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:5431';
const SESSION_PATH = new URL('file:///private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful/.session.json');
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase6-blind';
const session = fs.readFileSync(SESSION_PATH, 'utf8');
async function settle(page) {
  let prev = null, stable = 0;
  for (let i = 0; i < 60; i++) {
    const text = await page.evaluate(() => document.body.innerText);
    const ok = text.length > 400 && !/\bLoading\b/.test(text);
    if (ok && text === prev) { stable++; if (stable >= 2) return true; } else stable = 0;
    prev = text;
    await page.waitForTimeout(500);
  }
  return false;
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), session);
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  const info = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('div,ul,main')].filter(e => e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 200);
    return cands.slice(0,5).map(e => ({ cls: e.className.toString().slice(0,60), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }));
  });
  console.log(JSON.stringify(info, null, 2));
  // try scrolling the biggest candidate
  const scrolled = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('div,ul,main')].filter(e => e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 200);
    if (!cands.length) return false;
    cands.sort((a,b) => (b.scrollHeight-b.clientHeight) - (a.scrollHeight-a.clientHeight));
    cands[0].scrollTop += cands[0].clientHeight;
    return true;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/cold-inbox-2-scroll.png` });
  console.log('scrolled:', scrolled);
  await browser.close();
})();
