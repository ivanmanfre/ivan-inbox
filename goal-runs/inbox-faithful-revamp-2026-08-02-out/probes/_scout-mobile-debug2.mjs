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
    const el = document.querySelector('.wb-sech');
    const r = el.getBoundingClientRect();
    const scroller = document.querySelector('.rows.ct-rows');
    const sr = scroller.getBoundingClientRect();
    return {
      innerHeight: window.innerHeight, innerWidth: window.innerWidth,
      docClientHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      headerRect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
      scrollerRect: { top: sr.top, bottom: sr.bottom, height: sr.height },
      allSechCount: document.querySelectorAll('.wb-sech').length,
      allCtRowsCount: document.querySelectorAll('.rows.ct-rows').length,
      bodyScrollTop: document.scrollingElement.scrollTop,
      bodyScrollHeight: document.scrollingElement.scrollHeight,
    };
  });
  console.log(JSON.stringify(d, null, 2));
  await browser.close();
})();
