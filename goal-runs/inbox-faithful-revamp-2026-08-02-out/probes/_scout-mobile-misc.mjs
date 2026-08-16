import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const searchInfo = await page.evaluate(() => {
    const wrap = document.querySelector('.search');
    const input = document.querySelector('.search-in');
    const wr = wrap.getBoundingClientRect();
    const ir = input.getBoundingClientRect();
    return { wrap: { w: wr.width, h: wr.height }, input: { w: ir.width, h: ir.height } };
  });
  console.log('search', JSON.stringify(searchInfo));

  // type into search
  await page.locator('.search-in').tap();
  await page.locator('.search-in').fill('kyle');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    rowCount: document.querySelectorAll('.rows .r').length,
    val: document.querySelector('.search-in').value,
  }));
  console.log('search result', JSON.stringify(after));

  await page.goto(`${BASE}/#exp/v2/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const settingsInfo = await page.evaluate(() => {
    const toggle = document.querySelector('input[type="checkbox"], [class*="toggle" i], [class*="switch" i]');
    const themeBtns = [...document.querySelectorAll('button, [class*="seg"], [class*="theme"]')].slice(0,4).map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0,20), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { toggle: toggle ? toggle.getBoundingClientRect() : null, themeBtns };
  });
  console.log('settings', JSON.stringify(settingsInfo));
  await browser.close();
})();
