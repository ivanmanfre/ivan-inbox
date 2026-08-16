import { chromium } from 'playwright-core';
import fs from 'node:fs';

const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark',
  });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Find the .rows.ct-rows scroller and scroll incrementally, checking for a
  // section-header boundary transition, screenshotting each step.
  const info = await page.evaluate(() => {
    const scroller = document.querySelector('.rows.ct-rows') || document.querySelector('.rows');
    return scroller ? { found: true, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, cls: scroller.className } : { found: false };
  });
  console.log('scroller info', JSON.stringify(info));

  for (const y of [700, 900, 1100, 1300, 1500]) {
    await page.evaluate((y) => {
      const scroller = document.querySelector('.rows.ct-rows') || document.querySelector('.rows');
      if (scroller) scroller.scrollTop = y;
    }, y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/sticky-${y}.png` });

    const rects = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('.grouphdr, .wb-sech, .td-zh, .ops-sechdr')].map(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim().slice(0, 40), top: r.top, bottom: r.bottom, bg: cs.backgroundColor, pos: cs.position, z: cs.zIndex };
      });
      const cards = [...document.querySelectorAll('.ct-card')].slice(0, 3).map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim().slice(0, 40), top: r.top, bottom: r.bottom };
      });
      return { headers, cards };
    });
    console.log(`--- scrollTop=${y} ---`);
    console.log(JSON.stringify(rects, null, 2));
  }

  await browser.close();
})();
