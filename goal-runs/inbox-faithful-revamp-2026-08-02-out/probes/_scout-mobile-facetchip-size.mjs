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
  const d = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.ct-f')];
    const sizes = chips.slice(0, 10).map(c => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: c.textContent.trim() }; });
    const groupCount = document.querySelectorAll('.ct-fg').length;
    const chipCount = chips.length;
    return { sizes, groupCount, chipCount };
  });
  console.log(JSON.stringify(d, null, 2));

  // functional test: tap a facet chip and confirm list filters
  const before = await page.evaluate(() => document.querySelectorAll('.ct-card').length);
  const chipBox = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.ct-f')].find(el => el.textContent.includes('PASS'));
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, text: c.textContent };
  });
  console.log('chipBox', JSON.stringify(chipBox));
  if (chipBox) {
    await page.mouse.click(chipBox.x, chipBox.y);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      cardCount: document.querySelectorAll('.ct-card').length,
      fnote: document.querySelector('.ct-fnote')?.textContent,
    }));
    console.log('before', before, 'after', JSON.stringify(after));
    await page.screenshot({ path: '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/facet-tap-result.png' });
  }
  await browser.close();
})();
