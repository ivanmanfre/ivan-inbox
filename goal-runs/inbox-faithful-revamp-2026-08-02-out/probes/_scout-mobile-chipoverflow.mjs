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
  await page.goto(`${BASE}/#exp/v2/drafts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const d = await page.evaluate(() => {
    const chip = document.querySelector('.log-r .log-chip') || document.querySelector('.log-chip');
    if (!chip) return { error: 'no .log-chip found', bodyText: document.body.innerText.slice(0,300) };
    const box = chip.getBoundingClientRect();
    // measure the actual text run width using a Range
    const range = document.createRange();
    range.selectNodeContents(chip);
    const textRect = range.getBoundingClientRect();
    const cs = getComputedStyle(chip);
    return {
      boxLeft: box.left, boxWidth: box.width, boxRight: box.right,
      textLeft: textRect.left, textWidth: textRect.width, textRight: textRect.right,
      overflowsLeftBy: box.left - textRect.left,
      overflowsRightBy: textRect.right - box.right,
      overflowHidden: cs.overflow,
      fontSize: cs.fontSize,
    };
  });
  console.log(JSON.stringify(d, null, 2));
  await page.screenshot({ path: `${OUT}/mobile-drafts-chip-overflow-evidence.png`, clip: { x: 0, y: 590, width: 390, height: 260 } });
  await browser.close();
})();
