import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const target = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.ct-f')].find(el => el.textContent.includes('PASS'));
    const r = c.getBoundingClientRect();
    return { top: r.top, left: r.left, w: r.width, h: r.height, cls: c.className };
  });
  console.log('target before', JSON.stringify(target));

  // scroll it into view within the ct-rows scroller, then tap via locator (which auto-scrolls+clicks)
  const loc = page.locator('.ct-f', { hasText: 'PASS' }).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await loc.tap();
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.ct-f')].find(el => el.textContent.includes('PASS'));
    return {
      cls: c ? c.className : 'GONE',
      fnote: document.querySelector('.ct-fnote')?.textContent,
      cardCount: document.querySelectorAll('.ct-card').length,
    };
  });
  console.log('after tap()', JSON.stringify(after));
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/facet-tap-result2.png' });
  await browser.close();
})();
