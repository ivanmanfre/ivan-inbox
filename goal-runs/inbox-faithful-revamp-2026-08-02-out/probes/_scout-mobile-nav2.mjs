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
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await page.locator('.tb', { hasText: 'Claude' }).tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/mobile-nav-01-claude-open.png` });

  const backInfo = await page.evaluate(() => {
    const back = document.querySelector('.back');
    if (!back) return null;
    const r = back.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), text: back.textContent };
  });
  console.log('back button size', JSON.stringify(backInfo));

  await page.locator('.back').first().tap();
  await page.waitForTimeout(500);
  let state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasTabbar: !!document.querySelector('.tabbar'),
    text: document.body.innerText.slice(0, 100),
  }));
  console.log('AFTER BACK TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-02-after-back.png` });

  // Open a thread from Inbox (tap first row)
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('.rows .r').first().tap();
  await page.waitForTimeout(700);
  state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasTabbar: !!document.querySelector('.tabbar'),
    text: document.body.innerText.slice(0, 200),
  }));
  console.log('AFTER THREAD TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-03-thread-open.png` });

  const backInfo2 = await page.evaluate(() => {
    const back = document.querySelector('.back');
    if (!back) return 'NO BACK FOUND';
    const r = back.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('thread back button', JSON.stringify(backInfo2));
  if (backInfo2 !== 'NO BACK FOUND') {
    await page.locator('.back').first().tap();
    await page.waitForTimeout(500);
    state = await page.evaluate(() => ({ appClass: document.querySelector('.app')?.className, hasTabbar: !!document.querySelector('.tabbar') }));
    console.log('AFTER THREAD BACK', JSON.stringify(state));
    await page.screenshot({ path: `${OUT}/mobile-nav-04-thread-closed.png` });
  }

  // Open a draft from Content -> DraftPane sheet
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const cardCount = await page.locator('.ct-card').count();
  console.log('ct-card count', cardCount);
  await page.locator('.ct-card').first().tap();
  await page.waitForTimeout(700);
  state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasTabbar: !!document.querySelector('.tabbar'),
    text: document.body.innerText.slice(0, 200),
  }));
  console.log('AFTER DRAFT TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-05-draft-open.png` });

  await browser.close();
})();
