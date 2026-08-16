// Follow-up: draft detail open, Claude pane close (reclaimed width), targeted checks.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5431';
const SESSION_PATH = new URL('../.session.json', import.meta.url);
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase6-blind';
const session = fs.readFileSync(SESSION_PATH, 'utf8');
const log = {};
const shot = async (page, name) => { const p = `${OUT}/cold-${name}.png`; await page.screenshot({ path: p }); return p; };

async function settle(page) {
  let prev = null, stable = 0;
  for (let i = 0; i < 60; i++) {
    const text = await page.evaluate(() => document.body.innerText);
    const ok = text.length > 400 && !/\bLoading\b/.test(text);
    if (ok && text === prev) { stable++; if (stable >= 2) return true; }
    else stable = 0;
    prev = text;
    await page.waitForTimeout(500);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), session);

  // ---- Draft detail: drafts route, click one of the two rows ----
  await page.goto(`${BASE}/#exp/v2/drafts`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  const rowsInfo = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[class*="row"], [class*="card"]')]
      .filter(e => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().height > 20 && e.closest('.rows,.ct-rows,main,body'));
    return cands.slice(0, 5).map(e => ({ cls: e.className.toString(), text: (e.textContent || '').slice(0, 60) }));
  });
  log.rowsInfo = rowsInfo;
  try {
    // click on the "Ivan" comment_o... row text directly
    const target = await page.getByText('the paid into an unknown brand').first();
    if (await target.count()) {
      await target.click();
      await page.waitForTimeout(700);
      await shot(page, 'drafts-detail-open-2');
      log.draftDetailClicked = true;
    } else {
      log.draftDetailClicked = false;
    }
  } catch (e) { log.draftDetailErr = String(e); }

  // ---- Claude pane close, reclaimed width on Content ----
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'content-before-close-claude');
  try {
    // The X icon sits top-right of the Claude pane header, next to "default" pill and green dot.
    const closeBtn = await page.locator('aside, [class*="claude"], [class*="peer"]').locator('svg, button').last();
    // More robust: find all clickable elements within top-right 60x60 region of the right pane.
    const btns = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button, [role="button"], svg')];
      return all
        .map(e => { const r = e.getBoundingClientRect(); return { r, tag: e.tagName, cls: (e.className && e.className.toString) ? e.className.toString() : '' }; })
        .filter(o => o.r.x > 1380 && o.r.y < 60 && o.r.width > 2)
        .map(o => ({ x: o.r.x + o.r.width / 2, y: o.r.y + o.r.height / 2, tag: o.tag, cls: o.cls }));
    });
    log.topRightClickables = btns;
    if (btns.length) {
      const b = btns[btns.length - 1];
      await page.mouse.click(b.x, b.y);
      await page.waitForTimeout(700);
      await shot(page, 'content-claude-closed-reclaimed-width-2');
      log.closedVia = b;
    }
  } catch (e) { log.closeErr = String(e); }

  log.finalBodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
  fs.writeFileSync(`${OUT}/cold-log2.json`, JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await browser.close();
})();
