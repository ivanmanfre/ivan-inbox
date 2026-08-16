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

  // 1) Tap Claude tab -> should take over the screen (peer takeover)
  const claudeTab = page.locator('.tb', { hasText: 'Claude' });
  await claudeTab.tap();
  await page.waitForTimeout(600);
  let state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasChatPane: !!document.querySelector('.wb-take-chat, [class*="ChatPane"], .wb-chat'),
    bodyStart: document.body.innerText.slice(0, 150),
    tabbarVisible: !!document.querySelector('.tabbar'),
  }));
  console.log('AFTER CLAUDE TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-01-claude-open.png` });

  // Can we get back? Look for a close/back control
  const closeSel = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('[class*="close" i], [class*="back" i], .wb-gear')];
    return candidates.slice(0, 5).map(el => ({ cls: el.className, text: el.textContent.trim().slice(0,20) }));
  });
  console.log('close candidates', JSON.stringify(closeSel));

  // try tapping something that looks like a close (often an X or chevron near top)
  const closeBtn = page.locator('[class*="close" i]').first();
  const closeCount = await page.locator('[class*="close" i]').count();
  console.log('closeCount', closeCount);
  if (closeCount > 0) {
    await closeBtn.tap();
    await page.waitForTimeout(500);
  } else {
    // fallback: tap a job tab to see if it drops the peer (per Shell.tsx goJob mobile behavior)
    await page.locator('.tb', { hasText: 'Inbox' }).tap();
    await page.waitForTimeout(500);
  }
  state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    tabbarVisible: !!document.querySelector('.tabbar'),
    bodyStart: document.body.innerText.slice(0, 150),
  }));
  console.log('AFTER BACK ATTEMPT', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-02-after-back.png` });

  // 2) Open a thread from Inbox (tap first row)
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const firstRow = page.locator('.rows .r').first();
  await firstRow.tap();
  await page.waitForTimeout(700);
  state = await page.evaluate(() => ({
    appClass: document.querySelector('.app')?.className,
    hasTabbar: !!document.querySelector('.tabbar'),
    text: document.body.innerText.slice(0, 200),
  }));
  console.log('AFTER THREAD TAP', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/mobile-nav-03-thread-open.png` });

  // try to find a close control on the thread peer sheet
  const threadCloseCount = await page.locator('[class*="close" i]').count();
  console.log('threadCloseCount', threadCloseCount);
  if (threadCloseCount > 0) {
    await page.locator('[class*="close" i]').first().tap();
    await page.waitForTimeout(500);
    state = await page.evaluate(() => ({ appClass: document.querySelector('.app')?.className, hasTabbar: !!document.querySelector('.tabbar') }));
    console.log('AFTER THREAD CLOSE', JSON.stringify(state));
    await page.screenshot({ path: `${OUT}/mobile-nav-04-thread-closed.png` });
  }

  await browser.close();
})();
