// verify-content.mjs — live verification of the lane-separated content section.
//
// Not a screenshot sweep with assertions bolted on: each row below is a CLAIM
// the build makes, checked against the real database through the real UI. The
// two that matter most are the ones a static read cannot make —
//   * the full 37-entry register on the proof row, each entry attributed;
//   * a Mattan draft whose source_detail is a jsonb OBJECT opening without the
//     "Objects are not valid as a React child" crash that blanks the pane.
//
// Usage: node scripts/verify-content.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:4173/'
mkdirSync(outDir, { recursive: true })

const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null
if (!session) throw new Error('no .session.json — run scripts/dev-login.mjs first')

const M = { w: 390, h: 852, tag: 'mobile' }
const D = { w: 1440, h: 900, tag: 'desktop' }

// The proof row named in phase0-scope §6: 37 agent_log entries, Ivan lane,
// published.
const PROOF_TITLE = 'No company has ever scaled LinkedIn. Founders do.'
// A Mattan row whose source_detail is a jsonb OBJECT
// ({kind,label,metric,slug,source_url}) — the exact shape that reached an
// unguarded JSX child and blanked the pane.
const OBJECT_SOURCE_TITLE = 'Case Study: Don Pablo'

const OVERFLOW = function () {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const d = document.documentElement
  const regions = [...document.querySelectorAll('.wb-work, .wb-peer, .wb-take')]
    .map((el) => ({
      region: el.className.split(' ')[0],
      overflow: el.scrollWidth > el.clientWidth,
      height: el.scrollHeight,
    }))
  const clipped = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .filter((el) => {
      const s = getComputedStyle(el)
      return s.textOverflow === 'clip' && s.overflowX !== 'auto' && s.overflowX !== 'scroll'
    })
    .map((el) => `${el.className || el.tagName}: ${(el.textContent ?? '').trim().slice(0, 40)}`)
  return {
    docOverflow: d.scrollWidth > d.clientWidth,
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    clipped: clipped.slice(0, 6),
    loginVisible: !!document.body.textContent?.includes('Send me a code'),
    regions,
    // Every visible "Rise" string in a LABEL — chips, section heads, lane
    // notes, pane subtitles. Deliberately not every leaf: an agent_log body or
    // a QA feedback blob may legitimately say "RISE DTC content", and that is
    // the machine's own prose about the client, not this app naming a lane.
    riseStrings: [...document.querySelectorAll(
      '.chip, .ct-chip, .ct-lane, .wb-lanenote, .wb-sech-t, .wb-pane-s, .res-hdr, .wb-empty-l, .ct-fgl, .ct-f')]
      .filter((el) => vis(el))
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => /\bRise(?:’s)?\b/.test(t))
      .slice(0, 5),
  }
}

const browser = await chromium.launch()
const report = []

async function run(name, vp, body) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`))
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  // #exp/ is read at MOUNT only, so every surface below is a fresh load rather
  // than a click path from the default tab.
  await page.goto(`${baseUrl}#exp/v2/content`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2600)
  const claims = await body(page)
  const m = await page.evaluate(OVERFLOW)
  const file = `${outDir}/${name}-${vp.tag}.png`
  await page.screenshot({ path: file, fullPage: false })
  report.push({ name, tag: vp.tag, file, ...m, errors, claims })
  console.log(
    `${name}/${vp.tag} overflow=${m.docOverflow} clipped=${m.clipped.length} ` +
    `rise=${m.riseStrings.length} err=${errors.length} :: ${JSON.stringify(claims)}`,
  )
  await ctx.close()
}

const laneChip = (page, label) => page.locator('.chips .chip', { hasText: label }).first()

// ---- 1. Ivan's lane, as it opens ----
for (const vp of [M, D]) {
  await run('ivan-lane', vp, async (page) => ({
    lanes: await page.locator('.chips .chip').allInnerTexts(),
    sections: (await page.locator('.wb-sech-t').allInnerTexts()).slice(0, 14),
    facets: await page.locator('.ct-fgl').count(),
    draftCards: await page.locator('.ct-card:not(.ct-idea)').count(),
    ideaCards: await page.locator('.ct-card.ct-idea').count(),
  }))
}

// ---- 2. Mattan's lane: promotion groups, not the pipeline ----
for (const vp of [M, D]) {
  await run('mattan-lane', vp, async (page) => {
    await laneChip(page, 'Mattan Danino').click()
    await page.waitForTimeout(2600)
    return {
      groups: (await page.locator('.wb-sech-t').allInnerTexts()).slice(0, 6),
      note: (await page.locator('.wb-lanenote').innerText().catch(() => '')).slice(0, 60),
      draftCards: await page.locator('.ct-card:not(.ct-idea)').count(),
      ideaCards: await page.locator('.ct-card.ct-idea').count(),
    }
  })
}

// ---- 3. A filter, applied to a known row ----
await run('ivan-filtered', D, async (page) => {
  const before = await page.locator('.ct-card:not(.ct-idea)').count()
  // Pick a real facet option out of the bar rather than a hardcoded value: the
  // facets are derived from the loaded rows, so the test has to be too.
  const opt = page.locator('.ct-f').nth(1)
  const label = await opt.innerText()
  await opt.click()
  await page.waitForTimeout(500)
  const after = await page.locator('.ct-card:not(.ct-idea)').count()
  return { facet: label.replace(/\s+/g, ' '), before, after, note: await page.locator('.ct-fnote').first().innerText() }
})

// ---- 4. The proof row: 37 entries, each attributed, nothing collapsed ----
await run('draft-register', D, async (page) => {
  // Published is collapsed by default; open it, then find the row by its title.
  await page.locator('.wb-sech', { hasText: 'Published' }).first().click()
  await page.waitForTimeout(400)
  const card = page.locator('.ct-card', { hasText: PROOF_TITLE }).first()
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await page.waitForTimeout(2200)
  const entries = await page.locator('.wb-peer .dd-log-h').count()
  const agents = await page.locator('.wb-peer .dd-log-agent').allInnerTexts()
  return {
    entries,
    distinctAgents: [...new Set(agents)].length,
    unattributed: agents.filter((a) => a === 'Unattributed').length,
    // No clamp, no "Show more" anywhere in the register.
    showMore: await page.locator('.wb-peer .dd-more').count(),
    clamped: await page.locator('.wb-peer .dd-clamp').count(),
    blocks: (await page.locator('.wb-peer .res-hdr').allInnerTexts()).slice(0, 14),
  }
})

// ---- 5. A Mattan draft whose source_detail is an OBJECT (the crash class) ----
for (const vp of [M, D]) {
  await run('mattan-draft', vp, async (page) => {
    await laneChip(page, 'Mattan Danino').click()
    await page.waitForTimeout(2600)
    const card = page.locator('.ct-card', { hasText: OBJECT_SOURCE_TITLE }).first()
    await card.scrollIntoViewIfNeeded()
    await card.click()
    // Wait for the pane to LAND, not for a fixed guess: fetchDraftDetail is a
    // select('*') over a row carrying a whole agent_log, and a screenshot of the
    // skeleton would verify the loading state instead of the register.
    const scope = vp.tag === 'mobile' ? '.wb-take' : '.wb-peer'
    await page.locator(`${scope} .dd-title`).first().waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(600)
    return {
      paneRendered: await page.locator(`${scope} .dd-title`).count(),
      sourceBlock: await page.locator(`${scope} .ct-src-m, ${scope} .ct-quote`).count(),
      registerEntries: await page.locator(`${scope} .dd-log-h`).count(),
    }
  })
}

await browser.close()
writeFileSync(`${outDir}/verify.json`, JSON.stringify(report, null, 2))

const bad = report.filter((r) =>
  r.docOverflow || r.loginVisible || r.errors.length || r.clipped.length ||
  r.riseStrings.length || r.regions.some((g) => g.overflow))
console.log(`\n${report.length} runs → ${outDir}/verify.json`)
if (bad.length) {
  for (const r of bad) {
    const why = []
    if (r.docOverflow) why.push('doc-overflow')
    if (r.loginVisible) why.push('login-leak')
    if (r.errors.length) why.push(`console:${r.errors.length}`)
    if (r.clipped.length) why.push(`clipped:${r.clipped.length}`)
    if (r.riseStrings.length) why.push(`rise-label:${r.riseStrings.join(' | ')}`)
    for (const g of r.regions) if (g.overflow) why.push(`${g.region}-overflow`)
    console.log(`PROBLEM ${r.name}/${r.tag} -> ${why.join(', ')}`)
    if (r.errors.length) console.log(`   ${r.errors.slice(0, 3).join('\n   ')}`)
  }
} else {
  console.log('clean: no horizontal overflow, no console errors, no clipped text, no "Rise" label')
}
