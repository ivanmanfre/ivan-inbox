import { chromium } from 'playwright';
import fs from 'node:fs';

const WORKTREE = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful';
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots';
const sessionRaw = fs.readFileSync(`${WORKTREE}/.session.json`, 'utf8');

const BASE = 'http://localhost:5431';

async function settle(page, label) {
  // poll until no skeleton, no literal Loading, and stable innerText length
  let lastLen = -1;
  let stableCount = 0;
  for (let i = 0; i < 60; i++) {
    const info = await page.evaluate(() => {
      const skeletons = document.querySelectorAll('.sk, [class*="skeleton" i], [class*="Skeleton" i]');
      const text = document.body.innerText || '';
      return { skeletons: skeletons.length, len: text.length, hasLoading: /Loading/.test(text) };
    });
    if (info.skeletons === 0 && !info.hasLoading) {
      if (info.len === lastLen) {
        stableCount++;
        if (stableCount >= 2) {
          console.log(`[settle:${label}] stable at len=${info.len} after ${i} polls`);
          return true;
        }
      } else {
        stableCount = 0;
      }
      lastLen = info.len;
    } else {
      stableCount = 0;
      lastLen = info.len;
    }
    await page.waitForTimeout(500);
  }
  console.log(`[settle:${label}] TIMEOUT — proceeding anyway, lastLen=${lastLen}`);
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Inject BEFORE any page script runs, on every future navigation in this
  // context — a post-mount evaluate() is too late because the Supabase client
  // reads its session from storage at construction time, and a hash-only goto
  // does not reload the document (job change comes from the hashchange
  // listener, but auth state does not retroactively re-init).
  await page.addInitScript((raw) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', raw);
  }, sessionRaw);

  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await settle(page, 'content-ivan-initial');

  // Verify not zero-row / not anon
  const bodyLen1 = await page.evaluate(() => document.body.innerText.length);
  console.log('bodyLen after content load:', bodyLen1);
  if (bodyLen1 < 200) {
    console.log('WARNING: page body suspiciously small — possible RLS zero-row or auth failure');
  }

  await page.screenshot({ path: `${OUT}/facets-00-content-ivan-full.png`, fullPage: true });

  // Scroll the rows scroller a bit to make sure filter bar for Ivan is visible; capture top viewport
  await page.screenshot({ path: `${OUT}/facets-01-content-ivan-viewport.png` });

  // Measure the filter wall height + rows top position for Ivan lane
  const ivanMeasure = await page.evaluate(() => {
    const filters = document.querySelector('.ct-filters');
    const rows = document.querySelector('.rows.ct-rows');
    const rowsRect = rows ? rows.getBoundingClientRect() : null;
    const filterBlocks = Array.from(document.querySelectorAll('.ct-filters'));
    const totalFilterHeight = filterBlocks.reduce((s, el) => s + el.getBoundingClientRect().height, 0);
    const firstFilterRect = filterBlocks[0] ? filterBlocks[0].getBoundingClientRect() : null;
    // chip counts
    const groups = Array.from(document.querySelectorAll('.ct-fg')).map(g => {
      const label = g.querySelector('.ct-fgl')?.innerText?.trim();
      const chips = Array.from(g.querySelectorAll('.ct-f')).map(c => c.innerText.trim());
      return { label, chipCount: chips.length, chips: chips.slice(0, 6) };
    });
    const totalChips = groups.reduce((s, g) => s + g.chipCount, 0);
    return {
      filterBlockCount: filterBlocks.length,
      totalFilterHeight,
      firstFilterRect: firstFilterRect ? { top: firstFilterRect.top, bottom: firstFilterRect.bottom, height: firstFilterRect.height } : null,
      rowsRect: rowsRect ? { top: rowsRect.top, height: rowsRect.height } : null,
      groups,
      totalChips,
    };
  });
  fs.writeFileSync(`${OUT}/../phase0-ivan-measure.json`, JSON.stringify(ivanMeasure, null, 2));
  console.log('IVAN MEASURE:', JSON.stringify(ivanMeasure, null, 2));

  // Count how many rows (.ct-card) are visible within first 900px viewport
  const viewportRowCount = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ct-card'));
    return cards.filter(c => {
      const r = c.getBoundingClientRect();
      return r.top >= 0 && r.top < 900;
    }).length;
  });
  console.log('Ivan lane: cards visible in first 900px viewport:', viewportRowCount);

  // Now check localStorage keys after interacting
  const lsKeysBefore = await page.evaluate(() => Object.keys(localStorage));
  console.log('localStorage keys before filter click:', lsKeysBefore);

  // Click a filter chip (Stage's first option) to test interaction + check reload persistence
  const clicked = await page.evaluate(() => {
    const firstChip = document.querySelector('.ct-fg .ct-f');
    if (!firstChip) return null;
    const label = firstChip.closest('.ct-fg')?.querySelector('.ct-fgl')?.innerText;
    firstChip.click();
    return { group: label, chipText: firstChip.innerText };
  });
  console.log('Clicked chip:', clicked);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/facets-02-content-ivan-after-click.png` });

  // Try clicking a SECOND facet's chip to test multi-facet AND behavior (single-select per facet, multi-facet AND)
  const clicked2 = await page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('.ct-fg'));
    if (groups.length < 2) return null;
    const secondGroupChip = groups[1].querySelector('.ct-f');
    if (!secondGroupChip) return null;
    secondGroupChip.click();
    return { group: groups[1].querySelector('.ct-fgl')?.innerText, chipText: secondGroupChip.innerText };
  });
  console.log('Clicked second chip:', clicked2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/facets-03-content-ivan-two-filters.png` });

  const lsKeysAfter = await page.evaluate(() => Object.keys(localStorage));
  console.log('localStorage keys after filter clicks:', lsKeysAfter);

  // Reload to test persistence (full document reload — addInitScript re-fires,
  // auth survives; only FILTER state is under test here)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page, 'content-ivan-after-reload');
  const filtersAfterReload = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ct-f.on')).map(c => c.innerText);
  });
  console.log('Active filter chips after reload (should be empty if not persisted):', filtersAfterReload);
  await page.screenshot({ path: `${OUT}/facets-04-content-ivan-after-reload.png` });

  // Test search field existence
  const hasSearch = await page.evaluate(() => !!document.querySelector('input[type="search"], input[placeholder*="earch" i]'));
  console.log('Has search field on Content route:', hasSearch);

  // ---- switch to Mattan lane ----
  const laneSwitched = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.chips .chip'));
    const target = chips.find(c => /rise|mattan|danino/i.test(c.textContent || ''));
    if (target) { target.click(); return target.textContent; }
    return null;
  });
  console.log('Lane switch clicked:', laneSwitched);
  await page.waitForTimeout(600);
  await settle(page, 'content-mattan');
  await page.screenshot({ path: `${OUT}/facets-05-content-mattan-full.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/facets-06-content-mattan-viewport.png` });

  const mattanMeasure = await page.evaluate(() => {
    const filterBlocks = Array.from(document.querySelectorAll('.ct-filters'));
    const totalFilterHeight = filterBlocks.reduce((s, el) => s + el.getBoundingClientRect().height, 0);
    const groups = Array.from(document.querySelectorAll('.ct-fg')).map(g => {
      const label = g.querySelector('.ct-fgl')?.innerText?.trim();
      const chips = Array.from(g.querySelectorAll('.ct-f')).map(c => c.innerText.trim());
      return { label, chipCount: chips.length, chips: chips.slice(0, 6) };
    });
    const totalChips = groups.reduce((s, g) => s + g.chipCount, 0);
    return { filterBlockCount: filterBlocks.length, totalFilterHeight, groups, totalChips };
  });
  fs.writeFileSync(`${OUT}/../phase0-mattan-measure.json`, JSON.stringify(mattanMeasure, null, 2));
  console.log('MATTAN MEASURE:', JSON.stringify(mattanMeasure, null, 2));

  // ---- other routes' filter chrome ----
  const routes = ['inbox', 'drafts', 'sends', 'ops', 'today'];
  for (const r of routes) {
    await page.goto(`${BASE}/#exp/v2/${r}`, { waitUntil: 'domcontentloaded' });
    await settle(page, r);
    await page.screenshot({ path: `${OUT}/facets-10-route-${r}.png` });
    const info = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.chips .chip')).map(c => c.textContent.trim());
      const fpill = document.querySelector('.wb-fpill')?.textContent?.trim() || null;
      const ctFilters = !!document.querySelector('.ct-filters');
      return { chips, fpill, ctFilters };
    });
    console.log(`ROUTE ${r}:`, JSON.stringify(info));
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
