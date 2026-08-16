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
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.rows.ct-rows');
      return el ? { t: Date.now(), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, textLen: document.body.innerText.length } : null;
    });
    console.log(i*0.5+'s', JSON.stringify(info));
  }
  await browser.close();
})();
