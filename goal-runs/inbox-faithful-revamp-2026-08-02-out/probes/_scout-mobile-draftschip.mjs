import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/drafts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const d = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.rows > *')].slice(0, 3);
    return rows.map(r => {
      const chip = r.querySelector('[class*="chip"], [class*="log-"], span');
      const allSpans = [...r.querySelectorAll('span, div')].slice(0, 8).map(el => {
        const rect = el.getBoundingClientRect();
        return { cls: el.className, text: el.textContent.trim().slice(0, 30), left: Math.round(rect.left), width: Math.round(rect.width) };
      });
      return { rowHTML: r.outerHTML.slice(0, 500), spans: allSpans };
    });
  });
  console.log(JSON.stringify(d, null, 2));
  await browser.close();
})();
