import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
const OUTDIR = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const scrollerInfo = await page.evaluate(() => {
    const el = document.querySelector('.rows.ct-rows');
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log('scroller', JSON.stringify(scrollerInfo));

  // sweep in fine steps near the very first section boundary to catch a collision
  for (const y of [0, 150, 250, 350, 450, 550]) {
    await page.evaluate((y) => { document.querySelector('.rows.ct-rows').scrollTop = y; }, y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUTDIR}/sticky2-${y}.png` });
    const rects = await page.evaluate(() => {
      const el = document.querySelector('.rows.ct-rows');
      const headers = [...document.querySelectorAll('.grouphdr, .wb-sech, .td-zh, .ops-sechdr')].slice(0,4).map(h => {
        const r = h.getBoundingClientRect();
        return { text: h.textContent.trim().slice(0,30), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      const cardsBefore = [...document.querySelectorAll('.ct-card')].slice(0,2).map(c => {
        const r = c.getBoundingClientRect();
        return { text: c.textContent.trim().slice(0,30), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      return { scrollTop: el.scrollTop, headers, cardsBefore };
    });
    console.log(`y=${y}`, JSON.stringify(rects));
  }
  await browser.close();
})();
