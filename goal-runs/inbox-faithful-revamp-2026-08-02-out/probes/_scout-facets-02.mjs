import { chromium } from 'playwright';
import fs from 'node:fs';

const WORKTREE = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful';
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots';
const sessionRaw = fs.readFileSync(`${WORKTREE}/.session.json`, 'utf8');
const BASE = 'http://localhost:5431';

async function settle(page, label) {
  let lastLen = -1, stableCount = 0;
  for (let i = 0; i < 60; i++) {
    const info = await page.evaluate(() => {
      const skeletons = document.querySelectorAll('.sk, [class*="skeleton" i]');
      const text = document.body.innerText || '';
      return { skeletons: skeletons.length, len: text.length, hasLoading: /Loading/.test(text) };
    });
    if (info.skeletons === 0 && !info.hasLoading) {
      if (info.len === lastLen) { stableCount++; if (stableCount >= 2) { console.log(`[settle:${label}] stable len=${info.len} poll=${i}`); return true; } }
      else stableCount = 0;
      lastLen = info.len;
    } else { stableCount = 0; lastLen = info.len; }
    await page.waitForTimeout(500);
  }
  console.log(`[settle:${label}] TIMEOUT lastLen=${lastLen}`);
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript((raw) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', raw); }, sessionRaw);

  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await settle(page, 'content-ivan-chatdefault');

  const colWidthWithChat = await page.evaluate(() => {
    const w = document.querySelector('.wb-work');
    return w ? w.getBoundingClientRect().width : null;
  });
  console.log('content column width WITH chat peer docked:', colWidthWithChat);

  // close chat peer (X button top-right of chat pane)
  const closed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], span'));
    // ChatPane onClose renders an X icon; find it near the chat header
    const chatHeader = document.querySelector('.wb-peer-chat');
    if (!chatHeader) return false;
    const closeEl = chatHeader.querySelector('svg, .wb-peer-close, [aria-label*="close" i]');
    return !!closeEl;
  });
  console.log('found close el probe:', closed);

  // Simplest: click the visible X near "Claude" header (top right of the peer)
  await page.mouse.click(1416, 33).catch(() => {});
  await page.waitForTimeout(500);
  await settle(page, 'content-ivan-chatclosed-attempt');

  const colWidthNoChat = await page.evaluate(() => {
    const w = document.querySelector('.wb-work');
    return w ? w.getBoundingClientRect().width : null;
  });
  console.log('content column width AFTER close attempt:', colWidthNoChat);

  await page.screenshot({ path: `${OUT}/facets-07-content-ivan-solo-full.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/facets-08-content-ivan-solo-viewport.png` });

  const measure = await page.evaluate(() => {
    const filterBlocks = Array.from(document.querySelectorAll('.ct-filters'));
    const heights = filterBlocks.map(el => el.getBoundingClientRect().height);
    const rows = document.querySelector('.rows.ct-rows');
    const firstCard = document.querySelector('.ct-card');
    return {
      filterBlockHeights: heights,
      totalFilterHeight: heights.reduce((a, b) => a + b, 0),
      rowsTop: rows ? rows.getBoundingClientRect().top : null,
      firstCardTop: firstCard ? firstCard.getBoundingClientRect().top : null,
      colWidth: document.querySelector('.wb-work')?.getBoundingClientRect().width,
    };
  });
  console.log('SOLO MEASURE:', JSON.stringify(measure, null, 2));
  fs.writeFileSync(`${OUT}/../phase0-ivan-solo-measure.json`, JSON.stringify(measure, null, 2));

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e); process.exit(1); });
