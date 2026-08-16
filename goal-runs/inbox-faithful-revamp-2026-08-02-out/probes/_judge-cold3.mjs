import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5431';
const SESSION_PATH = new URL('../.session.json', import.meta.url);
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase6-blind';
const session = fs.readFileSync(SESSION_PATH, 'utf8');
const log = {};
const shot = async (page, name) => { const p = `${OUT}/cold-${name}.png`; await page.screenshot({ path: p }); return p; };

async function settle(page) {
  let prev = null, stable = 0;
  for (let i = 0; i < 60; i++) {
    const text = await page.evaluate(() => document.body.innerText);
    const ok = text.length > 400 && !/\bLoading\b/.test(text);
    if (ok && text === prev) { stable++; if (stable >= 2) return true; }
    else stable = 0;
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

  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);

  // Open a real draft: click on the first NEEDS REVIEW row title.
  try {
    const el = await page.getByText('Anthropic says its own AI models hacked 3').first();
    await el.click();
    await page.waitForTimeout(700);
    await shot(page, 'content-draft-detail-open');
    log.draftOpened = true;
    log.bodyAfterDraftClick = (await page.evaluate(() => document.body.innerText)).slice(0, 1500);
  } catch (e) { log.draftOpenErr = String(e); }

  // reset
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);

  // Inspect what's at the exact top-right pixel of the Claude header.
  const probe = await page.evaluate(() => {
    const pts = [[1414, 33], [1410, 33], [1418, 33], [1414, 24], [1414, 40]];
    return pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { x, y, found: false };
      const path = [];
      let cur = el;
      for (let i = 0; i < 4 && cur; i++) { path.push(cur.tagName + '.' + (cur.className || '')); cur = cur.parentElement; }
      return { x, y, found: true, path };
    });
  });
  log.probe = probe;

  try {
    await page.mouse.click(1414, 33);
    await page.waitForTimeout(700);
    await shot(page, 'content-after-click-1414-33');
    log.bodyAfterClose = (await page.evaluate(() => document.body.innerText)).slice(0, 400);
  } catch (e) { log.clickErr = String(e); }

  fs.writeFileSync(`${OUT}/cold-log3.json`, JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await browser.close();
})();
