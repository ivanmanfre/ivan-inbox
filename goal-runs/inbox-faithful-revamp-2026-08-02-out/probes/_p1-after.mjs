import { chromium } from 'playwright';
import fs from 'node:fs';

const WORKTREE = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful';
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase1-shots';
fs.mkdirSync(OUT, { recursive: true });
const sessionRaw = fs.readFileSync(`${WORKTREE}/.session.json`, 'utf8');
const BASE = 'http://localhost:5431';

async function settle(page, label) {
  let lastLen = -1, stable = 0;
  for (let i = 0; i < 60; i++) {
    const info = await page.evaluate(() => ({
      sk: document.querySelectorAll('.sk, [class*="skeleton" i]').length,
      len: (document.body.innerText || '').length,
      loading: /Loading/.test(document.body.innerText || ''),
    }));
    if (info.sk === 0 && !info.loading) {
      if (info.len === lastLen) { stable++; if (stable >= 2) { console.log(`[settle:${label}] len=${info.len} polls=${i}`); return info.len; } }
      else stable = 0;
      lastLen = info.len;
    } else { stable = 0; lastLen = info.len; }
    await page.waitForTimeout(500);
  }
  console.log(`[settle:${label}] TIMEOUT len=${lastLen}`);
  return lastLen;
}

const measure = () => {
  const blocks = Array.from(document.querySelectorAll('.ct-filters'));
  const first = blocks[0]?.getBoundingClientRect() ?? null;
  const cards = Array.from(document.querySelectorAll('.ct-card'));
  const firstCard = cards[0]?.getBoundingClientRect() ?? null;
  const rows = document.querySelector('.rows.ct-rows')?.getBoundingClientRect() ?? null;
  const pills = Array.from(document.querySelectorAll('.ct-fpill')).map(p => ({
    t: p.innerText.replace(/\s+/g, ' ').trim(), h: Math.round(p.getBoundingClientRect().height),
  }));
  const oldChips = document.querySelectorAll('.ct-filters .ct-f').length;
  const oldGroups = document.querySelectorAll('.ct-filters .ct-fg').length;
  return {
    filterBlocks: blocks.length,
    blockHeights: blocks.map(b => Math.round(b.getBoundingClientRect().height)),
    totalFilterHeight: Math.round(blocks.reduce((s, b) => s + b.getBoundingClientRect().height, 0)),
    firstFilterTop: first ? Math.round(first.top) : null,
    firstCardY: firstCard ? Math.round(firstCard.top) : null,
    cardsInFirstViewport: cards.filter(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; }).length,
    rowsTop: rows ? Math.round(rows.top) : null,
    pills, pillCount: pills.length,
    legacyChipsInFilterRow: oldChips, legacyGroupsInFilterRow: oldGroups,
    searchFields: document.querySelectorAll('.ct-fsearch-in').length,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pillsScroller: (() => {
      const el = document.querySelector('.ct-fpills');
      if (!el) return null;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollable: el.scrollWidth > el.clientWidth + 1 };
    })(),
  };
};

(async () => {
  const browser = await chromium.launch();
  const out = {};

  // ---------- 1440 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.addInitScript(raw => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', raw), sessionRaw);
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  const len = await settle(page, '1440');
  out.bodyLen1440 = len;
  if (len < 2000) console.log('WARNING: suspicious body length — possible silent RLS zero-row');
  out.at1440 = await page.evaluate(measure);
  await page.screenshot({ path: `${OUT}/after-1440.png` });
  await page.screenshot({ path: `${OUT}/after-1440-full.png`, fullPage: true });

  // panel open
  await page.evaluate(() => document.querySelectorAll('.ct-fpill')[3]?.click());
  await page.waitForTimeout(250);
  out.panelOpen = await page.evaluate(() => {
    const m = document.querySelector('.ct-fmenu');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const opts = Array.from(m.querySelectorAll('.wb-fopt')).map(o => o.innerText.replace(/\s+/g, ' ').trim());
    return { h: Math.round(r.height), w: Math.round(r.width), optCount: opts.length, opts: opts.slice(0, 8) };
  });
  await page.screenshot({ path: `${OUT}/panel-open-1440.png` });

  // pick an option and verify the rows narrow
  const before = await page.evaluate(() => document.querySelectorAll('.ct-card').length);
  await page.evaluate(() => { document.querySelectorAll('.ct-fmenu .wb-fopt')[1]?.click(); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('.ct-card').length,
    note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g, ' ').trim(),
    pills: Array.from(document.querySelectorAll('.ct-fpill')).map(p => p.innerText.replace(/\s+/g, ' ').trim()),
    ls: Object.keys(localStorage).filter(k => k.startsWith('wb-section')),
    lsVal: localStorage.getItem('wb-section:content.posts.ivan'),
  }));
  out.filterApplied = { cardsBefore: before, ...after };

  // AND a second facet
  await page.evaluate(() => document.querySelectorAll('.ct-fpill')[1]?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelectorAll('.ct-fmenu .wb-fopt')[1]?.click(); });
  await page.waitForTimeout(400);
  out.twoFacets = await page.evaluate(() => ({
    cards: document.querySelectorAll('.ct-card').length,
    note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g, ' ').trim(),
    lsVal: localStorage.getItem('wb-section:content.posts.ivan'),
  }));

  // search
  await page.fill('.ct-fsearch-in', 'a');
  await page.waitForTimeout(400);
  out.searched = await page.evaluate(() => ({
    cards: document.querySelectorAll('.ct-card').length,
    note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g, ' ').trim(),
    lsVal: localStorage.getItem('wb-section:content.posts.ivan'),
  }));

  // reload → does it survive?
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page, 'reload');
  out.afterReload = await page.evaluate(() => ({
    pills: Array.from(document.querySelectorAll('.ct-fpill')).map(p => p.innerText.replace(/\s+/g, ' ').trim()),
    q: document.querySelector('.ct-fsearch-in')?.value,
    note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g, ' ').trim(),
  }));

  // lane switch away and back
  await page.evaluate(() => { Array.from(document.querySelectorAll('.chips .chip')).find(c => /Mattan/i.test(c.innerText))?.click(); });
  await settle(page, 'mattan');
  out.mattan = await page.evaluate(() => ({
    pills: Array.from(document.querySelectorAll('.ct-fpill')).map(p => p.innerText.replace(/\s+/g, ' ').trim()),
    q: document.querySelector('.ct-fsearch-in')?.value,
    filterHeights: Array.from(document.querySelectorAll('.ct-filters')).map(b => Math.round(b.getBoundingClientRect().height)),
    firstCardY: Math.round(document.querySelector('.ct-card')?.getBoundingClientRect().top ?? -1),
  }));
  await page.evaluate(() => { Array.from(document.querySelectorAll('.chips .chip')).find(c => /Ivan/i.test(c.innerText))?.click(); });
  await settle(page, 'back-to-ivan');
  out.backToIvan = await page.evaluate(() => ({
    pills: Array.from(document.querySelectorAll('.ct-fpill')).map(p => p.innerText.replace(/\s+/g, ' ').trim()),
    q: document.querySelector('.ct-fsearch-in')?.value,
  }));

  // clear all, back to clean, re-measure
  await page.evaluate(() => document.querySelector('.ct-fclear-all')?.click());
  await page.waitForTimeout(400);
  out.cleared = await page.evaluate(() => ({
    ls: localStorage.getItem('wb-section:content.posts.ivan'),
    note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g, ' ').trim(),
  }));
  out.at1440clean = await page.evaluate(measure);
  await page.screenshot({ path: `${OUT}/after-1440.png` });

  // accent census + type census on this screen
  out.census = await page.evaluate(() => {
    const wb = document.querySelector('.wb');
    const all = Array.from(wb.querySelectorAll('*'));
    const isAcc = s => /rgb\(16,\s*163,\s*127\)/.test(s);
    let accent = 0;
    const sizes = new Set(); let heavy = 0; const heavyEls = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (isAcc(cs.color) || isAcc(cs.backgroundColor) || isAcc(cs.borderTopColor) || isAcc(cs.borderLeftColor) || isAcc(cs.boxShadow) || isAcc(cs.outlineColor)) accent++;
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasText) { sizes.add(cs.fontSize); if (parseInt(cs.fontWeight, 10) >= 700) { heavy++; heavyEls.push([el.className, cs.fontSize]); } }
    }
    const pillRadii = Array.from(wb.querySelectorAll('*')).filter(el => {
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return r >= 100;
    }).map(el => (typeof el.className === 'string' ? el.className : '')).filter(c => /ct-f|wb-fopt|fsheet|ct-fn/.test(c));
    return { accent, sizes: [...sizes].sort(), sizeCount: sizes.size, heavy, heavyEls: heavyEls.slice(0, 4), unlicensedPillsInNewChrome: pillRadii };
  });
  out.consoleErrors1440 = errs.slice(0, 10);
  await ctx.close();

  // ---------- 390 ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  const merrs = [];
  mp.on('console', x => { if (x.type() === 'error') merrs.push(x.text().slice(0, 200)); });
  await mp.addInitScript(raw => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', raw), sessionRaw);
  await mp.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  const mlen = await settle(mp, '390');
  out.bodyLen390 = mlen;
  out.at390 = await mp.evaluate(measure);
  await mp.screenshot({ path: `${OUT}/after-390.png` });

  // scroll the pills row to prove it actually scrolls
  out.pillScrollProof = await mp.evaluate(() => {
    const el = document.querySelector('.ct-fpills');
    if (!el) return null;
    const start = el.scrollLeft;
    el.scrollLeft = 400;
    return { start, after: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  await mp.evaluate(() => { const el = document.querySelector('.ct-fpills'); if (el) el.scrollLeft = 0; });

  // open a sheet
  await mp.evaluate(() => document.querySelectorAll('.ct-fpill')[0]?.click());
  await mp.waitForTimeout(400);
  out.sheet = await mp.evaluate(() => {
    const s = document.querySelector('.ct-fsheet');
    if (!s) return null;
    const rows = Array.from(s.querySelectorAll('.wb-fopt')).map(o => Math.round(o.getBoundingClientRect().height));
    return {
      h: Math.round(s.getBoundingClientRect().height),
      rowCount: rows.length, minRowH: Math.min(...rows),
      grab: Math.round(document.querySelector('.ct-fsheet-grab')?.getBoundingClientRect().height ?? 0),
      title: document.querySelector('.ct-fsheet-h')?.innerText,
    };
  });
  await mp.screenshot({ path: `${OUT}/sheet-390.png` });
  // tap-out closes
  await mp.evaluate(() => document.querySelector('.ct-fsheet-scrim')?.click());
  await mp.waitForTimeout(300);
  out.sheetClosed = await mp.evaluate(() => document.querySelectorAll('.ct-fsheet').length === 0);
  out.consoleErrors390 = merrs.slice(0, 10);
  await mp.screenshot({ path: `${OUT}/after-390.png` });
  await m.close();

  await browser.close();
  fs.writeFileSync(`${OUT}/../phase1-measure.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
