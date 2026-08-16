// READ-ONLY scout script. Does not touch src/. Untracked temp file.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots';
fs.mkdirSync(OUT, { recursive: true });

const sessionRaw = fs.readFileSync('/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful/.session.json', 'utf8');

const BASE = 'http://localhost:5431';

const findings = [];
function note(route, kind, detail, shot) {
  findings.push({ route, kind, detail, shot: shot || null, ts: Date.now() });
  console.log(`[${route}] ${kind}: ${detail}${shot ? ' -> ' + shot : ''}`);
}

async function settle(page, label) {
  // Wait until no skeletons, no literal "Loading", and innerText stable across two 500ms checks.
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const state = await page.evaluate(() => {
      const skel = document.querySelectorAll('.sk, .sk-r, .sk-ops, .sk-sc, [aria-hidden="true"]').length;
      const bodyText = document.body.innerText;
      const hasLoadingWord = /\bLoading\b/.test(bodyText);
      return { skel, len: bodyText.length, hasLoadingWord, text: bodyText.slice(0, 8000) };
    });
    const stable = prev && prev.text === state.text && state.skel === 0 && !state.hasLoadingWord;
    if (stable && state.len > 60) return true;
    prev = state;
    await page.waitForTimeout(500);
  }
  console.log(`[settle:${label}] TIMEOUT waiting for settle (last len=${prev?.len})`);
  return false;
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  return p;
}

async function measureOverflow(page, route) {
  const data = await page.evaluate(() => {
    const vw = window.innerWidth;
    const se = document.scrollingElement;
    const docOverflow = se.scrollWidth > vw + 1;
    // find worst offending elements
    const all = document.querySelectorAll('body *');
    const offenders = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 2 && r.width < 100000) {
        offenders.push({
          sel: el.className && typeof el.className === 'string' ? `${el.tagName.toLowerCase()}.${el.className.split(' ').filter(Boolean).join('.')}` : el.tagName.toLowerCase(),
          width: Math.round(r.width),
          left: Math.round(r.left),
        });
      }
    }
    offenders.sort((a, b) => b.width - a.width);
    return { vw, docScrollWidth: se.scrollWidth, docOverflow, offenders: offenders.slice(0, 15) };
  });
  if (data.docOverflow) {
    note(route, 'H-OVERFLOW', `document.scrollWidth=${data.docScrollWidth} > innerWidth=${data.vw}; top offenders: ${JSON.stringify(data.offenders)}`);
  }
  return data;
}

async function measureTouchTargets(page, route) {
  const data = await page.evaluate(() => {
    const interactive = document.querySelectorAll('button, a, [role="button"], [onclick], .tb, .wb-rj, .chip, .wb-ws, .wb-gear, input, select, textarea, [class*="tab"], [class*="btn"]');
    const small = [];
    const seen = new Set();
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 44 || r.height < 44) {
        const cls = el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        const key = `${el.tagName.toLowerCase()}.${cls}:${Math.round(r.width)}x${Math.round(r.height)}:${Math.round(r.top)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        small.push({
          sel: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
          w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top), left: Math.round(r.left),
          text: (el.textContent || '').trim().slice(0, 30),
        });
      }
    }
    return small;
  });
  if (data.length) {
    note(route, 'TOUCH-TARGET', `${data.length} interactive elements under 44x44: ${JSON.stringify(data.slice(0, 20))}`);
  }
  return data;
}

async function measureRows(page, route) {
  const data = await page.evaluate(() => {
    const scrollers = document.querySelectorAll('.rows');
    const out = [];
    for (const sc of scrollers) {
      const rows = sc.querySelectorAll(':scope > *');
      const heights = [];
      for (const r of rows) {
        const h = r.getBoundingClientRect().height;
        if (h > 0) heights.push(Math.round(h));
      }
      out.push({ cls: sc.className, count: heights.length, max: Math.max(0, ...heights), min: Math.min(...(heights.length ? heights : [0])), over72: heights.filter(h => h > 72).length, heights: heights.slice(0, 30) });
    }
    return out;
  });
  for (const sc of data) {
    if (sc.over72 > 0) {
      note(route, 'ROW-DENSITY', `scroller "${sc.cls}": ${sc.over72}/${sc.count} rows exceed 72px (max=${sc.max}); sample heights=${JSON.stringify(sc.heights)}`);
    }
  }
  return data;
}

async function measureTextSize(page, route) {
  const data = await page.evaluate(() => {
    const all = document.querySelectorAll('body *');
    const small = [];
    for (const el of all) {
      if (el.children.length > 0) continue; // leaf-ish only, avoid containers
      const text = el.textContent && el.textContent.trim();
      if (!text || text.length < 1) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (fs > 0 && fs < 11) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cls = el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        small.push({ sel: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, fontSize: fs, text: text.slice(0, 40), top: Math.round(r.top) });
      }
    }
    // dedupe by sel+fontSize
    const seen = new Set();
    const out = [];
    for (const s of small) {
      const k = `${s.sel}:${s.fontSize}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  });
  if (data.length) {
    note(route, 'TEXT-SIZE', `${data.length} distinct leaf elements under 11px: ${JSON.stringify(data.slice(0, 20))}`);
  }
  return data;
}

async function measureClipped(page, route) {
  const data = await page.evaluate(() => {
    const all = document.querySelectorAll('body *');
    const clipped = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      const isEllipsis = cs.textOverflow === 'ellipsis' || (cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap');
      if (isEllipsis && el.scrollWidth > el.clientWidth + 2) {
        const cls = el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        clipped.push({ sel: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, text: (el.textContent || '').trim().slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    const seen = new Set();
    const out = [];
    for (const c of clipped) {
      const k = c.sel + c.text;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  });
  if (data.length) {
    note(route, 'CLIPPED-TEXT', `${data.length} truncated labels: ${JSON.stringify(data.slice(0, 15))}`);
  }
  return data;
}

async function measureFixedCollisions(page, route) {
  const data = await page.evaluate(() => {
    const all = document.querySelectorAll('body *');
    const fixedEls = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cls = el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        fixedEls.push({ sel: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, pos: cs.position, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), z: cs.zIndex });
      }
    }
    return fixedEls;
  });
  // check overlaps among fixed/sticky elements
  const overlaps = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i], b = data[j];
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (overlapX > 5 && overlapY > 5) overlaps.push({ a: a.sel, b: b.sel, overlapX, overlapY });
    }
  }
  if (overlaps.length) {
    note(route, 'FIXED-COLLISION', `${overlaps.length} overlapping fixed/sticky pairs: ${JSON.stringify(overlaps)}`);
  }
  return { fixedEls: data, overlaps };
}

async function fullSweep(page, route, tag) {
  await measureOverflow(page, route);
  await measureTouchTargets(page, route);
  await measureRows(page, route);
  await measureTextSize(page, route);
  await measureClipped(page, route);
  await measureFixedCollisions(page, route);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    colorScheme: 'dark',
  });

  // Inject auth BEFORE any page script runs.
  await context.addInitScript((sessionRaw) => {
    try {
      window.localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', sessionRaw);
    } catch (e) {}
  }, sessionRaw);

  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  // ---- Load the workbench on the Inbox route first ----
  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' });
  await settle(page, 'inbox-boot');

  // Verify auth actually took (not anonymous / zero rows silently)
  const authCheck = await page.evaluate(() => {
    const raw = window.localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token');
    return { hasToken: !!raw, bodyLen: document.body.innerText.length, bodySample: document.body.innerText.slice(0, 300) };
  });
  console.log('AUTH CHECK:', JSON.stringify(authCheck));

  const routes = ['today', 'inbox', 'drafts', 'content', 'sends', 'ops'];
  const scrollerSelForRoute = {
    today: '.rows.td-rows',
    inbox: '.rows',
    drafts: '.rows',
    content: '.rows.ct-rows, .ct-rows',
    sends: '.rows.sc-rows',
    ops: '.rows.ops-rows',
  };

  for (const r of routes) {
    await page.goto(`${BASE}/#exp/v2/${r}`, { waitUntil: 'domcontentloaded' });
    await settle(page, r);
    await page.waitForTimeout(300);
    await shot(page, `mobile-${r}-01-top`);
    await fullSweep(page, r);

    // scroll bands
    const sel = scrollerSelForRoute[r];
    const scrollInfo = await page.evaluate((sel) => {
      const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
      let el = null;
      for (const p of parts) { el = document.querySelector(p); if (el) break; }
      if (!el) return null;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    }, sel);

    if (scrollInfo && scrollInfo.scrollHeight > scrollInfo.clientHeight + 50) {
      const bands = [0.33, 0.66, 1.0];
      for (let bi = 0; bi < bands.length; bi++) {
        const frac = bands[bi];
        await page.evaluate(({ sel, frac }) => {
          const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
          let el = null;
          for (const p of parts) { el = document.querySelector(p); if (el) break; }
          if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
        }, { sel, frac });
        await page.waitForTimeout(400);
        await settle(page, `${r}-scroll-${bi}`);
        await shot(page, `mobile-${r}-0${bi + 2}-scroll${Math.round(frac * 100)}`);
      }
    } else {
      note(r, 'INFO', `no scroll needed or scroller not found (sel=${sel}), scrollInfo=${JSON.stringify(scrollInfo)}`);
    }
  }

  // ---- Settings (reached via gear icon, not a tab) ----
  await page.goto(`${BASE}/#exp/v2/settings`, { waitUntil: 'domcontentloaded' });
  await settle(page, 'settings');
  await shot(page, 'mobile-settings-01-top');
  await fullSweep(page, 'settings');

  fs.writeFileSync(path.join(OUT, '..', 'phase0-mobile-findings-pass1.json'), JSON.stringify(findings, null, 2));
  console.log('DONE PASS 1');
  await browser.close();
})();
