// THE GATE, not a grep. Walks every surface named in the phase-1 inventory
// (goal-runs/workbench-polish-2026-08-22-out/evidence/inventory.md §1-§7),
// authed, against a real build, and scans rendered innerText — never the
// bundle — for the patterns the owner's complaint named: a raw urn, a raw
// SCREAMING_SNAKE verdict/enum, a bare uuid, and a database column name used
// as a tooltip prefix.
//
// Usage: node no-internals.mjs [baseUrl]   (defaults to http://localhost:4180/)
//
// Auth: injects the repo's .session.json into localStorage, same pattern as
// goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs. Read-only:
// installs the same write-interceptor so nothing this script does can mutate
// a live row.
//
// Known, accepted exceptions (not bugs — documented in phase2-labels.md):
//   - AI_TELLS and the other rubric dimension keys (VOICE, SUBSTANCE, HOOK,
//     …) — the judge's own scoring vocabulary, rubric.ts's own documented
//     contract ("verbatim and uppercase... never invented").
//   - a `title` attribute that IS the raw urn itself (source_post_id) — the
//     spec explicitly wants the raw id reachable on hover/copy for support;
//     the violation is printing it as READ text, not keeping it as a hook.
//   - the app's own placeholder glyph '—' for an absent value, and the '·'
//     separator glyph between chip fields — neither is an identifier.

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..') // .../ivan-inbox-wt-lab
const SESSION_PATH = path.join(REPO, '.session.json')
const BASE = process.argv[2] || 'http://localhost:4180/'

if (!existsSync(SESSION_PATH)) {
  console.error(`No .session.json at ${SESSION_PATH} — copy it from the main repo checkout first.`)
  process.exit(2)
}
const session = readFileSync(SESSION_PATH, 'utf8')

// ---- the patterns -----------------------------------------------------

const RUBRIC_KEY_ALLOW = new Set(['AI_TELLS'])

/** @param {string} text @param {string} surface */
function scanText(text, surface) {
  const hits = []

  // 1. A raw LinkedIn urn, printed as text (not just held in a title/href).
  for (const m of text.matchAll(/urn:li:[a-z]+:\S+/gi)) {
    hits.push({ surface, kind: 'raw-urn', match: m[0] })
  }

  // 2. A bare uuid.
  for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
    hits.push({ surface, kind: 'bare-uuid', match: m[0] })
  }

  // 3. SCREAMING_SNAKE with at least one underscore — a raw enum/verdict code
  //    (REWRITE_OK, NEEDS_REGENERATE, QA_BLOCKED, LINT_FAIL, …), minus the
  //    judge's own documented rubric-key exception.
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
    if (RUBRIC_KEY_ALLOW.has(m[0])) continue
    hits.push({ surface, kind: 'screaming-snake', match: m[0] })
  }

  // 4. The named defect, verbatim, in case a regression brings the words back
  //    without the underscore/caps shape the other patterns catch.
  if (/backend depth/i.test(text)) {
    hits.push({ surface, kind: 'named-defect', match: 'Backend depth' })
  }

  return hits
}

/** A `title` attribute that leads with a raw snake_case column name, e.g.
 * "scheduled_at 2026-08-20…" or "stage: dm_sent" — the tooltip-prefix defect.
 * The one legitimate raw-token tooltip (the source urn on hover) starts with
 * "urn:" and is explicitly excluded. */
function scanTitles(titles, surface) {
  const hits = []
  for (const t of titles) {
    if (!t) continue
    if (/^urn:li:/i.test(t)) continue
    if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*[:\s]/.test(t)) {
      hits.push({ surface, kind: 'raw-column-tooltip', match: t.slice(0, 80) })
    }
  }
  return hits
}

// ---- the walk -----------------------------------------------------------

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
// Write interceptor — same lines as chip-probe.mjs:13-19. This script only
// ever reads.
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})

const allHits = []

async function scanCurrentPage(surface) {
  const { text, titles } = await page.evaluate(() => ({
    text: document.body.innerText,
    titles: [...document.querySelectorAll('[title]')].map(el => el.getAttribute('title')),
  }))
  allHits.push(...scanText(text, surface), ...scanTitles(titles, surface))
}

async function clickTabByText(selector, textRe) {
  return page.evaluate(({ selector, source }) => {
    const re = new RegExp(source, 'i')
    const el = [...document.querySelectorAll(selector)].find(e => re.test(e.textContent || ''))
    if (el) { el.click(); return true }
    return false
  }, { selector, source: textRe.source })
}

async function openFirstRow(rowSelector = '.ct-card.ct-tap') {
  const opened = await page.evaluate(sel => {
    const row = document.querySelector(sel)
    if (!row) return false
    row.click()
    return true
  }, rowSelector)
  if (opened) await page.waitForTimeout(1200)
  return opened
}

async function walkQueueAndScan(surface, tabPicker) {
  // j walks the takeover window's queue rail — scan up to N rows so the QA
  // clash sentence (only present when the row's stored verdict disagrees
  // with its own judge body) gets covered at least once.
  for (let i = 0; i < 10; i++) {
    if (tabPicker) await tabPicker()
    await page.waitForTimeout(300)
    await scanCurrentPage(`${surface} (row ${i + 1})`)
    await page.keyboard.press('j')
    await page.waitForTimeout(350)
  }
}

// 1 — Today
await page.goto(BASE + '#exp/v2/today', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await scanCurrentPage('Today')

// 2 — DMs list + Thread peer
await page.goto(BASE + '#exp/v2/dms', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await scanCurrentPage('DMs list')
if (await openFirstRow('[data-wbrow]')) await scanCurrentPage('Thread peer')

// 3 — Content: Flow tabs (Needs review is the boot tab; walk the others too)
await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await scanCurrentPage('Content · Needs review tab')
for (const tabName of ['Published', 'Scheduled', 'Errors', 'Ideas']) {
  const clicked = await clickTabByText('[role=tab]', new RegExp(tabName))
  if (!clicked) continue
  await page.waitForTimeout(1200)
  await scanCurrentPage(`Content · ${tabName} tab`)
}

// 4 — Draft window: QA / Source / Log / Fields tabs, walked across rows so a
// row that actually carries a verdict-clash / source urn / rubric gets hit.
await clickTabByText('[role=tab]', /published/i)
await page.waitForTimeout(1200)
if (await openFirstRow()) {
  await walkQueueAndScan('Draft window', async () => {
    for (const tab of ['QA', 'Source', 'Log', 'Fields']) {
      await page.evaluate(t => {
        const btn = [...document.querySelectorAll('.dw-jump')].find(b => b.textContent.trim().toLowerCase() === t.toLowerCase())
        btn?.click()
      }, tab)
      await page.waitForTimeout(150)
      // Deliberately does NOT force open the "Raw judge output" / "payload" /
      // "The applied rewrite" folds. Those are announced, explicitly-raw audit
      // trails by long-standing design (Register.tsx: "nothing is dropped...
      // the raw string is always kept and always reachable" — the judge's own
      // verdict word and an agent's own recorded prose, verbatim, under a
      // label that says how long it is). That is not the defect the owner
      // named: a HEADLINE field or header silently speaking in backend
      // vocabulary. This gate checks what a reader sees walking the surface,
      // not what a raw-dump fold holds once someone deliberately opens it for
      // support.
    }
  })
  await page.keyboard.press('Escape')
}

// 5 — Content Calendar
await clickTabByText('.ct-cmd-views button, [role=tab]', /^calendar$/i)
await page.waitForTimeout(1200)
await scanCurrentPage('Content · Calendar view')

// 6 — Magnets list + Magnet window
await page.goto(BASE + '#exp/v2/magnets', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await scanCurrentPage('Magnets list')
if (await openFirstRow()) {
  await walkQueueAndScan('Magnet window')
  await page.keyboard.press('Escape')
}

// 7 — Styles / Strategy / Sends / Ops / Settings
for (const [job, label] of [['styles', 'Styles'], ['strategy', 'Strategy'], ['sends', 'Sends'], ['ops', 'Ops'], ['settings', 'Settings']]) {
  await page.goto(BASE + `#exp/v2/${job}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await scanCurrentPage(label)
}

await browser.close()

// ---- report ---------------------------------------------------------------

const bySurfaceKind = new Map()
for (const h of allHits) {
  const k = `${h.kind}\t${h.match}`
  if (!bySurfaceKind.has(k)) bySurfaceKind.set(k, new Set())
  bySurfaceKind.get(k).add(h.surface)
}

if (allHits.length === 0) {
  console.log('no-internals: PASS — 0 hits across every surface walked.')
  process.exit(0)
}

console.log(`no-internals: FAIL — ${allHits.length} hit(s), ${bySurfaceKind.size} distinct.`)
for (const [k, surfaces] of bySurfaceKind) {
  const [kind, match] = k.split('\t')
  console.log(`  [${kind}] "${match}" — seen on: ${[...surfaces].join(', ')}`)
}
process.exit(1)
