import { chromium } from 'playwright-core';
import fs from 'node:fs';

const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark',
  });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('response', async (res) => {
    if (res.url().includes('supabase') || res.url().includes('inbox_messages')) {
      console.log('[net]', res.status(), res.url().slice(0, 150));
    }
  });
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const html = await page.evaluate(() => document.querySelector('.wb-work')?.outerHTML?.slice(0, 3000) || 'NO .wb-work');
  console.log('---WB-WORK---');
  console.log(html);
  await page.screenshot({ path: '/tmp/debug-inbox.png' });
  await browser.close();
})();
