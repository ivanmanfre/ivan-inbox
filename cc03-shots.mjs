import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = '/Users/ivanmanfredi/Desktop/Ivan - Content System/goal-runs/campaign-control-03-operator-view-2026-09-13-out/evidence/render'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox-cc03/.session.json', 'utf8')
const BASE = 'http://localhost:5173/'
const VIEWPORTS = [{ w: 390, h: 844, tag: '390' }, { w: 1440, h: 900, tag: '1440' }]

const CASES = [
  { id: 'real-all-7d',      q: '',                     hash: '#exp/brain-b/sends' },
  { id: 'real-ivan-7d',     q: '',                     hash: '#exp/brain-b/sends', client: 'Ivan' },
  { id: 'real-rise-30d',    q: '',                     hash: '#exp/brain-b/sends', client: 'Rise', range: '30d' },
  { id: 'real-arch-90d',    q: '',                     hash: '#exp/brain-b/sends', client: 'Arch', range: '90d' },
  { id: 'real-all-90d',     q: '',                     hash: '#exp/brain-b/sends', range: '90d' },
  { id: 'real-all-custom',  q: '',                     hash: '#exp/brain-b/sends', range: 'Custom' },
  // Each scenario is captured on the chip that CARRIES the mutated state (from
  // the fixture's own `_scenario.mutations`), so the reviewer sees the card the
  // scenario exists to show, plus an `all` capture for every one of them.
  { id: 'cc-healthy',       q: '?wbmock=cc:healthy',   hash: '#exp/brain-b/sends', client: 'Ivan' },
  { id: 'cc-healthy-all',   q: '?wbmock=cc:healthy',   hash: '#exp/brain-b/sends', allClients: true },
  { id: 'cc-outside_window',q: '?wbmock=cc:outside_window', hash: '#exp/brain-b/sends', client: 'Rise' },
  { id: 'cc-outside_window-all', q: '?wbmock=cc:outside_window', hash: '#exp/brain-b/sends', allClients: true },
  { id: 'cc-capacity_reached', q: '?wbmock=cc:capacity_reached', hash: '#exp/brain-b/sends', client: 'Ivan' },
  { id: 'cc-capacity_reached-all', q: '?wbmock=cc:capacity_reached', hash: '#exp/brain-b/sends', allClients: true },
  { id: 'cc-incident',      q: '?wbmock=cc:incident',  hash: '#exp/brain-b/sends', client: 'Arch' },
  { id: 'cc-incident-all',  q: '?wbmock=cc:incident',  hash: '#exp/brain-b/sends', allClients: true },
  { id: 'cc-unknown',       q: '?wbmock=cc:unknown',   hash: '#exp/brain-b/sends', client: 'Rise' },
  { id: 'cc-unknown-all',   q: '?wbmock=cc:unknown',   hash: '#exp/brain-b/sends', allClients: true },
  { id: 'cc-empty',         q: '?wbmock=cc:empty',     hash: '#exp/brain-b/sends' },
  { id: 'cc-partial',       q: '?wbmock=cc:partial',   hash: '#exp/brain-b/sends' },
  { id: 'fetch-error',      q: '?wbmock=fetch-error',  hash: '#exp/brain-b/sends' },
  { id: 'lanes',            q: '',                     hash: '#exp/brain-b/sends', view: 'Lanes' },
  { id: 'log',              q: '',                     hash: '#exp/brain-b/sends', view: 'Log' },
]

const browser = await chromium.launch()
const results = []

for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
    await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
    await page.goto(`${BASE}${c.q}${c.hash}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4500)
    if (c.view) { await page.getByRole('button', { name: c.view, exact: true }).click().catch(() => {}); await page.waitForTimeout(1200) }
    if (c.allClients) {
      // Deselect whatever chip the app remembered: `all` is the state with no
      // chip selected, reached by clicking the selected one off.
      const on = page.locator('.a-sends-filters [data-selected], .a-sends-filters [aria-pressed="true"]').first()
      if (await on.count()) { await on.click().catch(() => {}); await page.waitForTimeout(2000) }
    }
    if (c.client) { await page.locator('.a-sends-filters').getByText(c.client, { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(2500) }
    if (c.range) {
      await page.locator('.a-sends-pop button').first().click().catch(() => {})
      await page.waitForTimeout(400)
      await page.getByRole('menuitem', { name: c.range, exact: true }).click().catch(async () => {
        await page.locator('.a-sends-menu').getByText(c.range, { exact: true }).click().catch(() => {})
      })
      await page.waitForTimeout(2500)
    }
    const facts = await page.evaluate(() => {
      const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null)
      const sec = [...document.querySelectorAll('.a-sends-sec')].map(s => t(s.querySelector('.a-eyebrow')))
      const ctrl = [...document.querySelectorAll('.a-sends-sec')].find(s => t(s.querySelector('.a-eyebrow')) === 'Control')
      const rows = ctrl ? [...ctrl.querySelectorAll('.a-rows > .a-row')].map(r => ({
        title: t(r.querySelector('.a-row-title')),
        sub: t(r.querySelector('.a-row-sub')),
        tail: t(r.querySelector('.a-row-tail')),
      })) : []
      // Two independent measures, because `scrollWidth` on the document cannot
      // see a span clipped inside an `overflow:hidden` ancestor — which is
      // exactly the G06 MUSTNOT ("hidden overflowing evidence").
      //
      // (a) text nodes whose right edge passes the viewport, counting only text
      //     that is actually ON screen: an off-canvas drawer sitting at
      //     left:-320 is not clipped evidence, it is a closed drawer.
      const clipped = []
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walk.nextNode())) {
        const s = (node.textContent || '').trim()
        if (!s) continue
        const el = node.parentElement
        if (!el || (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue
        if (el.closest('[aria-hidden="true"]')) continue
        const host = el.getBoundingClientRect()
        // Fully off screen in either direction: not on this plate at all.
        if (host.right <= 0 || host.left >= window.innerWidth) continue
        const r = document.createRange(); r.selectNodeContents(node)
        const b = r.getBoundingClientRect()
        if (b.width === 0 && b.height === 0) continue
        if (b.right > window.innerWidth + 0.5 || b.left < -0.5) {
          clipped.push({ text: s.slice(0, 70), right: Math.round(b.right), left: Math.round(b.left) })
        }
      }
      // (b) elements whose content is wider than their box and which do NOT
      //     offer a scrollbar for it.
      const hiddenOverflow = []
      for (const el of document.querySelectorAll('.a-root *')) {
        if (el.scrollWidth <= el.clientWidth + 1) continue
        const ox = getComputedStyle(el).overflowX
        if (ox === 'auto' || ox === 'scroll') continue
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
        const b = el.getBoundingClientRect()
        if (b.right <= 0 || b.left >= window.innerWidth || b.width === 0) continue
        hiddenOverflow.push({
          cls: el.className && el.className.toString().slice(0, 60),
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        })
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        clippedTextNodes: clipped.slice(0, 12),
        clippedCount: clipped.length,
        hiddenOverflowElements: hiddenOverflow.slice(0, 12),
        hiddenOverflowCount: hiddenOverflow.length,
        sections: sec,
        controlHead: t(ctrl?.querySelector('.a-sends-h-s')),
        controlRows: rows,
        unverifiedBadges: document.querySelectorAll('.a-cc-unverified').length,
        statusWords: [...document.querySelectorAll('.a-cc-status')].map(e => `${e.textContent}|${e.dataset.tone}`),
        loginGate: /Send code|Email me a link/i.test(document.body.textContent || ''),
        bodyHead: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 420),
      }
    })
    const path = `${OUT}/${vp.tag}-${c.id}.png`
    await page.screenshot({ path, fullPage: vp.tag === '1440' })
    results.push({ case: c.id, viewport: vp.tag, png: path, facts, errors: errors.slice(0, 6) })
    console.log(vp.tag, c.id, 'overflow=' + facts.overflow, 'clipped=' + facts.clippedCount, 'hidOvf=' + facts.hiddenOverflowCount, 'errors=' + errors.length, (facts.controlRows[0]?.title || '').slice(0, 46))
    await ctx.close()
  }
}

// Expired auth: no session at all → the login gate, no data.
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${BASE}#exp/brain-b/sends`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const facts = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    controlPresent: [...document.querySelectorAll('.a-eyebrow')].some(e => e.textContent.trim() === 'Control'),
    loginGate: /Send code|Email me a link/i.test(document.body.textContent || ''),
    bodyHead: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
  }))
  const path = `${OUT}/${vp.tag}-expired-auth.png`
  await page.screenshot({ path })
  results.push({ case: 'expired-auth', viewport: vp.tag, png: path, facts, errors })
  console.log(vp.tag, 'expired-auth', 'gate=' + facts.loginGate, 'control=' + facts.controlPresent)
  await ctx.close()
}

writeFileSync(`${OUT}/measured-facts.json`, JSON.stringify({
  taken_at: new Date().toISOString(),
  base: BASE,
  payload_source: 'local private service http://127.0.0.1:8791/payload (builder A campaign_view serve, examples/)',
  results,
}, null, 1))
await browser.close()
console.log('DONE', results.length, 'shots')
