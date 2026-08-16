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
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const titleInfo = await page.evaluate(() => {
    const t = document.querySelector('.ct-title');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { top: r.top, left: r.left, w: r.width, h: r.height, text: t.textContent, parentCls: t.closest('.ct-card')?.className };
  });
  console.log('title info', JSON.stringify(titleInfo));

  await page.locator('.ct-title').first().tap();
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasTabbar: !!document.querySelector('.tabbar'),
    text: document.body.innerText.slice(0, 250),
  }));
  console.log('AFTER TITLE TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-05b-draft-open.png` });
  await browser.close();
})();
