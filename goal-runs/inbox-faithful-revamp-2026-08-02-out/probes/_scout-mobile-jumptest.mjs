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

  const before = await page.evaluate(() => document.querySelector('.rows.ct-rows').scrollTop);
  const capInfo = await page.evaluate(() => {
    const caps = [...document.querySelectorAll('.wb-cap')];
    const target = caps.find(c => c.title?.includes('Published')) || caps[caps.length-1];
    const r = target.getBoundingClientRect();
    return { title: target.title, w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('cap to tap', JSON.stringify(capInfo), 'scrollTop before', before);

  await page.locator('.wb-cap', { hasText: /\d+/ }).last().tap();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.querySelector('.rows.ct-rows').scrollTop);
  console.log('scrollTop after', after);
  await browser.close();
})();
