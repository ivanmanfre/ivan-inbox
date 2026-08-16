import { chromium } from 'playwright-core';
import fs from 'node:fs';
const sessionRaw = fs.readFileSync('.session.json', 'utf8');
const BASE = 'http://localhost:5431';
const OUTDIR = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' });
  await context.addInitScript((s) => { window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s); }, sessionRaw);
  const page = await context.newPage();
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const data = await page.evaluate(() => {
    const vh = window.innerHeight;
    const fb = document.querySelector('.ct-filters');
    const fbRect = fb ? fb.getBoundingClientRect() : null;
    const scroller = document.querySelector('.rows.ct-rows');
    const sr = scroller.getBoundingClientRect();
    // distance from scroller top to first actionable card (any .ct-card)
    const firstCard = document.querySelector('.ct-card');
    const firstCardRect = firstCard ? firstCard.getBoundingClientRect() : null;
    const firstSech = document.querySelector('.wb-sech');
    // preamble = everything in ct-rows before the first .wb-sech, measured in scroll-content coords
    // scrollTop is 0 here so viewport top-relative coords ARE content-relative (offset by scroller's own top)
    const preambleHeight = firstSech ? (firstSech.getBoundingClientRect().top - sr.top) : null;
    // PipelineBar segments (tappable jump targets)
    const pipelineBars = [...document.querySelectorAll('.ct-pipe-seg, .ct-pipeline-seg, [class*="pipe"]')].slice(0, 10).map(el => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      vh,
      filterBar: fbRect ? { top: fbRect.top, bottom: fbRect.bottom, height: fbRect.height, pctOfViewport: (fbRect.height / vh * 100).toFixed(1) } : 'NOT FOUND (.ct-filters)',
      scrollerTop: sr.top, scrollerHeight: sr.height,
      preambleHeightToFirstSection: preambleHeight,
      preamblePctOfScrollerViewport: preambleHeight ? (preambleHeight / sr.height * 100).toFixed(0) : null,
      firstCardTopRelToScroller: firstCardRect ? (firstCardRect.top - sr.top) : null,
      pipelineBarsFound: pipelineBars,
    };
  });
  console.log(JSON.stringify(data, null, 2));

  // Try tapping the PipelineBar to test the jump-to-section shortcut
  const pipeSel = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('[class*="pipe" i], [class*="Pipeline" i]')];
    return candidates.length;
  });
  console.log('pipeline-like elements count:', pipeSel);

  await browser.close();
})();
