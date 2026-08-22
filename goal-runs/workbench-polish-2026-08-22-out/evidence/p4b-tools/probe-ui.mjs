// p4b, the authed UI proof. Real session, real rows, ZERO writes.
//
// 🔴 THE INTERCEPTOR IS WIDER THAN THE STANDARD ONE. chip-probe.mjs lets a POST
// to /rest/v1/rpc/ THROUGH (`m === 'POST' && !url.includes('/rpc/')`), which is
// fine for a read-only probe and useless for this one: both features built here
// write through RPCs. Promote is operator_set_board_visible, an RPC POST, and it
// would have landed on a paying client's live board. So every mutating call is
// caught, its payload recorded, and a refusal returned in its place. The count
// this prints must be 0.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4182/'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-b/goal-runs/workbench-polish-2026-08-22-out/after'
mkdirSync(OUT, { recursive: true })

// Anything that reaches these is an attempted write, whatever it looks like.
const WRITE_RPC = /^(operator_|append_agent_log|dashboard_action)/
const attempted = []
const unauthorised = []

async function dismiss(page) {
  // The sheet is modal and Escape does not close it; a probe that assumes it
  // does spends the rest of the run clicking a scrim and reporting zeroes.
  await page.getByRole('button', { name: /^Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function guard(ctx) {
  await ctx.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method(), url = q.url()
    const isRpc = url.includes('/rest/v1/rpc/')
    const fn = isRpc ? decodeURIComponent(url.split('/rpc/')[1].split('?')[0]) : null
    const mutating = m === 'PATCH' || m === 'PUT' || m === 'DELETE'
      || (m === 'POST' && !isRpc)
      || (m === 'POST' && isRpc && WRITE_RPC.test(fn))
    if (mutating) {
      attempted.push({ method: m, fn, url: url.split('/rest/v1/')[1].slice(0, 120), body: q.postData()?.slice(0, 300) ?? null })
      return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'blocked_by_probe' }) })
    }
    return r.continue()
  })
  // Anything leaving for a non-Supabase host is a webhook fire; regenerateDraft
  // has one, and it must not go out either.
  await ctx.route('**/*', async r => {
    const u = r.request().url()
    if (/webhook|n8n\./i.test(u)) { unauthorised.push(u.slice(0, 120)); return r.abort() }
    return r.continue()
  })
}

const browser = await chromium.launch()
const results = {}

for (const [name, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  await guard(ctx)
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') console.log(`  [console ${name}] ${m.text().slice(0, 160)}`) })

  // ---- IVAN LANE, THE ERROR PILE ----------------------------------------
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const status = await page.evaluate(() => document.body.innerText.slice(0, 200))
  if (/sign in|log in|unauthor/i.test(status)) { console.log('AUTH FAILED:', status); process.exit(1) }

  // The stage tab's accessible name carries its count ("Errors 48"), so an
  // exact match finds nothing and the probe silently reads the review tab.
  await page.locator('button', { hasText: /^Errors\s*\d*$/ }).first().click().catch(() => {})
  await page.waitForTimeout(2000)

  const errs = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ct-reason')]
    return {
      n: rows.length,
      kinds: rows.reduce((a, e) => (a[e.dataset.kind || 'none'] = (a[e.dataset.kind || 'none'] || 0) + 1, a), {}),
      stillStuck: rows.filter(e => /Generation stuck/i.test(e.textContent || '')).length,
      sample: rows.slice(0, 6).map(e => ({ kind: e.dataset.kind, text: (e.textContent || '').trim().slice(0, 110) })),
      // The three-class trap: a rule written with fewer classes silently renders
      // at body size. Read the real element, never the stylesheet.
      fs: rows[0] ? getComputedStyle(rows[0]).fontSize : null,
      bodyFs: getComputedStyle(document.querySelector('.wb') || document.body).fontSize,
      retryButtons: document.querySelectorAll('.ct-retry').length,
      retryFs: document.querySelector('.ct-retry') ? getComputedStyle(document.querySelector('.ct-retry')).fontSize : null,
      // The reason must still be ONE line: no ct-reason may exceed its own line height by much.
      reasonHeights: [...new Set(rows.map(e => Math.round(e.getBoundingClientRect().height)))],
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  results[`ivan_errors_${name}`] = errs
  await page.screenshot({ path: `${OUT}/p4b-errors-${name}.jpg`, type: 'jpeg', quality: 82, fullPage: false })

  // The retry confirm, opened and CANCELLED. Reading it is the proof; firing it
  // is a model bill.
  if (errs.retryButtons > 0) {
    await page.locator('.ct-retry').first().click()
    await page.waitForTimeout(700)
    results[`retry_confirm_${name}`] = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet, [class*=sheet]')
      return sheet ? sheet.innerText.replace(/\s+/g, ' ').slice(0, 400) : null
    })
    await dismiss(page)
  }

  // ---- CLIENT LANE, THE 93-ROW PILE -------------------------------------
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /Mattan/i }).first().click().catch(() => {})
  await page.waitForTimeout(2000)
  await page.locator('button', { hasText: /^(Needs review|Review|Not on his board)\s*\d*$/i }).first()
    .click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const client = await page.evaluate(() => ({
    promoteButtons: document.querySelectorAll('.ct-promote').length,
    promoteFs: document.querySelector('.ct-promote') ? getComputedStyle(document.querySelector('.ct-promote')).fontSize : null,
    promoteLabel: document.querySelector('.ct-promote')?.textContent?.trim() ?? null,
    rows: document.querySelectorAll('[data-wbrow]').length,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))
  results[`client_rows_${name}`] = client
  await page.screenshot({ path: `${OUT}/p4b-client-${name}.jpg`, type: 'jpeg', quality: 82, fullPage: false })

  // The client promote confirm, opened and CANCELLED.
  if (client.promoteButtons > 0) {
    await page.locator('.ct-promote').first().click()
    await page.waitForTimeout(700)
    results[`promote_confirm_${name}`] = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet, [class*=sheet]')
      return sheet ? sheet.innerText.replace(/\s+/g, ' ').slice(0, 500) : null
    })
    await dismiss(page)
  }

  // ---- THE BULK BAR: select rows, read the buttons, fire NOTHING ---------
  if (name === '1440') {
    // The mark is `.wb-selmark`, a role=checkbox inside the row's anchor, and it
    // is painted on hover, so it has to be clicked with force rather than waited
    // for as a visible element.
    const marks = page.locator('.wb-selmark')
    const take = Math.min(5, await marks.count())
    for (let i = 0; i < take; i++) await marks.nth(i).click({ force: true })
    await page.waitForTimeout(900)
    results.bulk = await page.evaluate(() => {
      const bar = document.querySelector('.wb-bulk')
      const btns = [...document.querySelectorAll('.wb-bulk-acts .wb-bulk-b')]
      return {
        present: !!bar,
        count: bar?.querySelector('.wb-bulk-n')?.textContent?.trim() ?? null,
        // ORDER AND X POSITION. Delete must be where it always was.
        buttons: btns.map(b => ({ text: b.textContent.trim(), x: Math.round(b.getBoundingClientRect().left), cls: b.className })),
        clientRow: (() => {
          const b = document.querySelector('.wb-bulk-client .wb-bulk-b')
          const r = b?.getBoundingClientRect()
          return b ? { text: b.textContent.trim(), x: Math.round(r.left), y: Math.round(r.top), disabled: b.disabled } : null
        })(),
        note: bar?.querySelector('.wb-bulk-note')?.textContent?.trim() ?? null,
      }
    })
    await page.screenshot({ path: `${OUT}/p4b-bulk-1440.jpg`, type: 'jpeg', quality: 82 })

    // 🔴 THE MUSCLE-MEMORY CHECK, MEASURED RATHER THAN ASSUMED.
    // `.wb-bulk` is `left:50%; transform:translateX(-50%)`, so it is CENTERED
    // and its width depends on how many buttons it holds. Adding promote
    // therefore widens the bar and slides Delete left, whatever the render
    // order says. The question is not "did Delete move" (it did) but "does a
    // click aimed at where Delete used to be still land on Delete".
    // Removing the promote button from layout reproduces the pre-p4b bar
    // exactly, which is what makes this a real before/after and not an estimate.
    results.deleteHitbox = await page.evaluate(() => {
      const del = [...document.querySelectorAll('.wb-bulk-acts .wb-bulk-b')].find(b => /Delete/.test(b.textContent))
      const promo = document.querySelector('.wb-bulk-client')
      if (!del || !promo) return null
      const after = del.getBoundingClientRect()
      // Hiding the client row reproduces the bar EXACTLY as it was before p4b.
      promo.style.display = 'none'
      const before = del.getBoundingClientRect()
      const promoBefore = promo.getBoundingClientRect()
      promo.style.display = ''
      const px = n => Math.round(n * 10) / 10
      // The old click point: the centre of Delete when Delete was the only button.
      const oldCentre = px(before.left + before.width / 2)
      return {
        deleteBefore: { left: px(before.left), right: px(before.right) },
        deleteAfter: { left: px(after.left), right: px(after.right) },
        shift: px(after.left - before.left),
        oldClickPoint: oldCentre,
        // If this is true, every click a hand has learned still hits Delete.
        oldPointStillHitsDelete: oldCentre >= after.left && oldCentre <= after.right,
        // And it must NOT have landed on the new button instead.
        // The new button must not occupy the coordinate Delete vacated.
        oldPointLandsOnPromote: (() => {
          const b = promo.querySelector('.wb-bulk-b')?.getBoundingClientRect()
          if (!b) return false
          const c = { x: oldCentre, y: px(before.top + before.height / 2) }
          return c.x >= b.left && c.x <= b.right && c.y >= b.top && c.y <= b.bottom
        })(),
        promoteHiddenWidth: px(promoBefore.width),
      }
    })

    // Open the bulk promote confirm and CANCEL it, so the wording is proven
    // without a single row reaching Mattan's board.
    const promoteBtn = page.locator('.wb-bulk-client .wb-bulk-b.client')
    if (await promoteBtn.count() > 0) {
      await promoteBtn.first().click()
      await page.waitForTimeout(700)
      results.bulk_confirm = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet, [class*=sheet]')
        return sheet ? sheet.innerText.replace(/\s+/g, ' ').slice(0, 600) : null
      })
      await dismiss(page)
    }
  }

  await ctx.close()
}

await browser.close()
results.ATTEMPTED_WRITES = attempted.length
results.attempted_detail = attempted
results.blocked_webhooks = unauthorised
console.log(JSON.stringify(results, null, 2))
