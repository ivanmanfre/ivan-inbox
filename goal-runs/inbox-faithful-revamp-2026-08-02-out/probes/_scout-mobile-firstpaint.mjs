import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();

  // cold load, capture ASAP
  const t0 = Date.now();
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  // fire a screenshot loop every ~50ms up to 500ms to catch the earliest paint
  const shots = [];
  for (let i = 0; i < 8; i++) {
    const elapsed = Date.now() - t0;
    const info = await page.evaluate(() => {
      const rootDiv = document.querySelector('.app');
      return {
        hasApp: !!rootDiv,
        classes: rootDiv ? rootDiv.className : null,
        bg: rootDiv ? getComputedStyle(rootDiv).backgroundColor : null,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        text: document.body.innerText.slice(0, 100),
      };
    }).catch(() => null);
    await page.screenshot({ path: `${OUT}/mobile-firstpaint-t${elapsed}.png` }).catch(()=>{});
    shots.push({ elapsed, info });
    await page.waitForTimeout(60);
  }
  console.log(JSON.stringify(shots, null, 2));
  await browser.close();
})();
