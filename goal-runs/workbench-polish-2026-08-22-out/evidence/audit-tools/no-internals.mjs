// THE GATE. Rewritten 2026-08-22 after the completeness critic found that the
// previous version could pass by failing.
//
// What it does: opens the surfaces named in the phase-1 inventory
// (goal-runs/workbench-polish-2026-08-22-out/evidence/inventory.md §1-§7),
// authed, against a real build, at TWO viewports and BOTH themes, and scans the
// rendered innerText (never the bundle) for a raw urn, a raw SCREAMING_SNAKE
// verdict/enum, a bare uuid, and a database column name used as a tooltip
// prefix.
//
// What changed, and why each change exists:
//
//  1. IT COUNTS. Every surface in the catalog below is either WALKED, or it is
//     a named failure. The old script did `continue` on a missed tab and
//     `btn?.click()` on a missing button, so a surface that never opened
//     contributed zero hits and was indistinguishable from a clean one. If all
//     of them had failed it would still have printed PASS and exited 0.
//  2. IT ASSERTS THE SURFACE RENDERED. Each surface declares a landmark
//     selector and a minimum text length. A blank pane is a FAIL, not a clean
//     scan.
//  3. TWO VIEWPORTS, BOTH THEMES. 1440x900 and 390x844, dark and light. The old
//     one ran 1440 dark only, and the theme attribute is set on
//     document.documentElement before either shell mounts (inventory §8).
//  4. THE ALLOWLIST IS STATIC AND IN THIS FILE. The old one rebuilt its
//     SCREAMING_SNAKE allowlist per page from the `.qa-dim-k` badges ON THE
//     PAGE UNDER TEST, so the thing being scanned defined what counted as
//     acceptable. The judge's dimension vocabulary genuinely is open and
//     row-specific (rubric.ts:30 "the judge's own key, verbatim and
//     uppercase"), so it cannot be a value list — it is excluded STRUCTURALLY
//     instead, by removing `.qa-dim-k` nodes from the text before scanning, and
//     the count of what that removed is reported. Everything else is the fixed,
//     reviewed ALLOW list below.
//  5. IT EXITS NON-ZERO ON FAIL, and its final line reports walked, intended,
//     hits and the verdict, so it can be used as a gate by something other than
//     a human reading its prose.
//
// CONDITIONAL surfaces. Some inventoried surfaces render only when the live
// data has a given shape (a discarded draft exists, a seat is unhealthy, a
// reaction is pending). Those are declared `when:` with the condition written
// out. A conditional surface that is absent is REPORTED BY NAME with its
// condition and is not counted as walked; it is not a silent skip and it is not
// a pass. A REQUIRED surface that cannot be reached is a hard FAIL naming it.
//
// Usage: node no-internals.mjs [baseUrl]   (defaults to http://localhost:4187/)
//
// Auth: injects the repo's .session.json into localStorage. Read-only: a write
// interceptor is installed on **/rest/v1/** and **/rest/v1/rpc/** before any
// navigation, and the attempted-write count is printed. Some RPCs are reads
// called by POST (inbox_governor is one); those are counted separately and are
// not writes.
//
// Known, accepted exceptions (documented in phase2-labels.md):
//   - a `title` attribute that IS the raw urn itself (source_post_id): the spec
//     wants the raw id reachable on hover/copy for support; the violation is
//     printing it as READ text, not keeping it as a hook.
//   - the app's em-dash placeholder glyph for an absent value and the '·'
//     separator glyph. Neither is an identifier.
//   - the raw-dump folds ("Raw judge output", "payload", "The applied rewrite")
//     are announced, explicitly-raw audit trails by long-standing design and
//     are not force-opened. This gate checks what a reader sees walking the
//     surface.

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const SESSION_PATH = path.join(REPO, '.session.json')
const BASE = process.argv[2] || 'http://localhost:4187/'

if (!existsSync(SESSION_PATH)) {
  console.error(`No .session.json at ${SESSION_PATH}. Copy it from the main repo checkout first.`)
  process.exit(2)
}
const session = readFileSync(SESSION_PATH, 'utf8')

// ---- the STATIC allowlist ------------------------------------------------
//
// Reviewed by hand, frozen here, and never read off the page. A SCREAMING_SNAKE
// token that is not on this list and is not inside a `.qa-dim-k` badge is a hit.
// Adding to this list is a deliberate edit to the gate, which is the point.
const ALLOW_SCREAMING_SNAKE = new Set([
  // The scheduled_ops_status states the Ops board prints verbatim because they
  // are the view's own vocabulary and the board's copy explains each one.
  // Listed so a NEW state cannot arrive unreviewed.
  'NOT_SCHEDULED',
])

// Structural exclusion, not a value list: the judge's dimension keys are open
// by contract, so they are removed by SELECTOR before the text is read.
const JUDGE_VOCAB_SELECTOR = '.qa-dim-k'

// ---- the patterns --------------------------------------------------------

const RE_URN = /urn:li:[a-z]+:\S+/gi
const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const RE_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g

function scanText(text, surface) {
  const hits = []
  for (const m of text.matchAll(RE_URN)) hits.push({ surface, kind: 'raw-urn', match: m[0] })
  for (const m of text.matchAll(RE_UUID)) hits.push({ surface, kind: 'bare-uuid', match: m[0] })
  for (const m of text.matchAll(RE_SNAKE)) {
    if (ALLOW_SCREAMING_SNAKE.has(m[0])) continue
    hits.push({ surface, kind: 'screaming-snake', match: m[0] })
  }
  if (/backend depth/i.test(text)) hits.push({ surface, kind: 'named-defect', match: 'Backend depth' })
  return hits
}

// A `title` attribute that leads with a raw snake_case column name, e.g.
// "scheduled_at 2026-08-20..." or "stage: dm_sent". The one legitimate raw-token
// tooltip (the source urn on hover) starts with "urn:" and is excluded.
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

// ---- the catalog ---------------------------------------------------------
//
// One entry per inventoried surface. `open` returns true when it believes it
// reached the surface; the harness then INDEPENDENTLY verifies the landmark and
// the text length, so an `open` that lies still fails.
//
//   id       inventory name
//   ref      which inventory section it comes from
//   landmark a selector that must exist once the surface is open
//   minText  the shortest plausible rendered text, in characters
//   when     present => CONDITIONAL, and this string names the condition
//   only     viewport widths this surface applies to (default: all)

const S = (id, ref, landmark, open, extra = {}) => ({ id, ref, landmark, open, minText: 200, ...extra })

const JOB_SURFACES = [
  ['today', '§1', '.td-mast, .td-zones'],
  ['dms', '§1', '.rows'],
  ['content', '§1', '.ct-tabs'],
  ['magnets', '§1', '.ct-rows'],
  ['styles', '§1', '.ct-rows'],
  ['strategy', '§1', '.wb-strat'],
  ['sends', '§1', '.ov-hero, .ov-sec'],
  ['ops', '§1', '.wb-ocols, .ops-rows'],
  ['settings', '§1', '.wb-work'],
]

// Content stage tabs. Ivan's lane, TAB_ORDER (ContentList.tsx:540-543). A tab
// with a zero count still renders its own empty state, which is a surface.
const CONTENT_TABS = ['Ideas', 'Needs review', 'Generating', 'Approved', 'Scheduled', 'Published', 'Errors', 'Archived', 'Other']

// ---- harness -------------------------------------------------------------

const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const THEMES = ['dark', 'light']

let attemptedWrites = 0
let rpcReads = 0
const allHits = []
const walked = []          // {pass, id}
const unreachable = []     // {pass, id, why}
const conditionalAbsent = []
let judgeVocabRemoved = 0

async function textOf(page) {
  return page.evaluate(sel => {
    const clone = document.body.cloneNode(true)
    const killed = clone.querySelectorAll(sel)
    killed.forEach(n => n.remove())
    return { text: clone.innerText || '', removed: killed.length }
  }, JUDGE_VOCAB_SELECTOR)
}

async function scanSurface(page, surfaceLabel) {
  const { text, removed } = await textOf(page)
  judgeVocabRemoved += removed
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('[title]')].map(el => el.getAttribute('title')))
  allHits.push(...scanText(text, surfaceLabel), ...scanTitles(titles, surfaceLabel))
  return text.trim().length
}

const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel)

const clickText = (page, sel, re) => page.evaluate(({ sel, source }) => {
  const rx = new RegExp(source, 'i')
  const el = [...document.querySelectorAll(sel)].find(e => rx.test(e.textContent || ''))
  if (!el) return false
  el.click()
  return true
}, { sel, source: re.source })

const clickFirst = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return false
  el.click()
  return true
}, sel)

// A hard document load. Hash-only navigation is SAME-DOCUMENT navigation in this
// app, so an overlay left open by the previous surface survives it and the next
// surface silently inherits state it did not open. A changing query string makes
// every one of these a real document load, which is the only way each surface
// starts from the same place. The parameter itself is inert: the app reads
// `?cat=` and nothing else.
let loadSeq = 0
async function hardLoad(page, hash) {
  await page.goto(`${BASE}?nis=${++loadSeq}${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1300)
}

async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150) }
}

// Runs one surface: open it, verify the landmark and the text, scan it.
async function run(page, pass, s) {
  const label = `${s.id} @ ${pass}`
  let opened = false
  try { opened = await s.open(page) } catch (e) { opened = false; s._err = e.message }
  let present = 0
  if (opened) {
    await page.waitForTimeout(s.settle ?? 500)
    present = await count(page, s.landmark)
  }
  if (!opened || present === 0) {
    const why = !opened ? (s._err ? `open threw: ${s._err.slice(0, 60)}` : 'the navigation step returned false')
      : `landmark ${s.landmark} not present after opening`
    if (s.when) conditionalAbsent.push({ pass, id: s.id, ref: s.ref, why, when: s.when })
    else unreachable.push({ pass, id: s.id, ref: s.ref, why })
    return
  }
  const len = await scanSurface(page, label)
  if (len < s.minText) {
    unreachable.push({ pass, id: s.id, ref: s.ref, why: `rendered ${len} chars, below the ${s.minText} floor: this surface is blank, not clean` })
    return
  }
  walked.push({ pass, id: s.id })
}

// ---- the surfaces, in groups ---------------------------------------------

function catalog() {
  const out = []

  // §1 - the nine jobs.
  for (const [job, ref, landmark] of JOB_SURFACES) {
    out.push(S(`job:${job}`, ref, landmark, async page => {
      await hardLoad(page, `#exp/v2/${job}`)
      return true
    }, { minText: job === 'settings' ? 120 : 200 }))
  }

  // §2 - content internals: the stage tabs, the calendar, the filter disclosure.
  for (const tab of CONTENT_TABS) {
    out.push(S(`content-tab:${tab}`, '§2', '.ct-rows, .wb-empty', async page => {
      await hardLoad(page, '#exp/v2/content')
      return clickText(page, '[role=tab]', new RegExp(`^${tab}`))
    }, { settle: 1400, minText: 150 }))
  }
  out.push(S('content:calendar', '§2', '.cal-grid', async page => {
    await hardLoad(page, '#exp/v2/content')
    return clickText(page, '.ct-cmd-views button', /^calendar$/i)
  }, { settle: 1600 }))
  out.push(S('content:filter-disclosure', '§2', '.wb-fmenu', async page => {
    await hardLoad(page, '#exp/v2/content')
    // FilterRow carries its OWN mobile breakpoint (767px, inventory §2/§9),
    // independent of the shell's canvas model, and below it the pills sit
    // behind a Filters button. Two steps, and the first one is allowed to be
    // absent because at 1440 there is no button to press.
    await clickText(page, '.ct-cmd-f button, button', /^filters/i)
    await page.waitForTimeout(700)
    return clickFirst(page, '.ct-fpill, .wb-fpill')
  }, { settle: 900, minText: 150 }))
  out.push(S('content:lane-mattan', '§2', '.ct-rows, .wb-empty', async page => {
    await hardLoad(page, '#exp/v2/content')
    return clickText(page, '.ct-cmd-lane', /mattan|rise/i)
  }, { settle: 1500, minText: 150 }))

  // §2 - ops internals.
  out.push(S('ops:pipeline-notes', '§2', '.ops-pipe', async page => {
    await hardLoad(page, '#exp/v2/ops')
    return true
  }))
  out.push(S('ops:reaction-desk', '§2', '.rx-desk', async page => {
    await hardLoad(page, '#exp/v2/ops')
    return true
  }, { when: 'a reaction is pending in the desk queue' }))

  // §3 - the two takeover windows and everything inside them.
  // The lane pill is PERSISTED, and `content:lane-mattan` above flips it, so
  // every later content surface booted on a lane whose tab set is composite
  // group x stage and has no tab called "Published". That is exactly the class
  // of silent miss this rewrite exists to catch: the old script would have
  // scanned nothing here and still printed PASS.
  const openDraftWindow = async page => {
    await hardLoad(page, '#exp/v2/content')
    await clickText(page, '.ct-cmd-lane', /^ivan/i)
    await page.waitForTimeout(1200)
    if (!await clickText(page, '[role=tab]', /^Published/)) return false
    await page.waitForTimeout(1500)
    return clickFirst(page, '.ct-card.ct-tap')
  }
  out.push(S('draft-window', '§3', '.dw-cols', async page => {
    if (!await openDraftWindow(page)) return false
    await page.waitForTimeout(1800)
    return true
  }, { settle: 800, minText: 400 }))
  for (const tab of ['QA', 'Source', 'Log', 'Fields']) {
    out.push(S(`draft-window:${tab}`, '§3', '.dw-insp', async page => {
      if (!await openDraftWindow(page)) return false
      await page.waitForTimeout(1800)
      return clickText(page, '.dw-jump', new RegExp(`^${tab}$`))
    }, { settle: 700, minText: 400 }))
  }
  out.push(S('draft-window:queue-rail', '§3', '.dw-queue', async page => {
    if (!await openDraftWindow(page)) return false
    await page.waitForTimeout(1800)
    return true
  }, { when: 'the open window has a queue of two or more rows', settle: 700, minText: 400 }))
  out.push(S('draft-window:swap-image', '§7', '.dw-swap', async page => {
    await hardLoad(page, '#exp/v2/content')
    await clickText(page, '.ct-cmd-lane', /^ivan/i)
    await page.waitForTimeout(1200)
    if (!await clickText(page, '[role=tab]', /^Needs review/)) return false
    await page.waitForTimeout(1500)
    if (!await clickFirst(page, '.ct-card.ct-tap')) return false
    await page.waitForTimeout(2000)
    await clickText(page, '.dw button', /fix or remove/i)
    await page.waitForTimeout(700)
    return clickText(page, '.dw button', /swap image|add image/i)
  }, { when: 'a review-stage draft exists on the lane', settle: 900, minText: 400 }))
  out.push(S('confirm-sheet', '§7', '.sheet-card', async page => {
    await hardLoad(page, '#exp/v2/content')
    await clickText(page, '.ct-cmd-lane', /^ivan/i)
    await page.waitForTimeout(1200)
    if (!await clickText(page, '[role=tab]', /^Needs review/)) return false
    await page.waitForTimeout(1500)
    if (!await clickFirst(page, '.ct-card.ct-tap')) return false
    await page.waitForTimeout(2000)
    await clickText(page, '.dw button', /fix or remove/i)
    await page.waitForTimeout(700)
    // Opens the sheet; the confirm button is NEVER clicked, and the write
    // interceptor is installed regardless.
    return clickText(page, '.dw button', /^delete draft/i)
  }, { when: 'a review-stage draft exists on the lane', settle: 900, minText: 30 }))
  out.push(S('magnet-window', '§3', '.dw-cols', async page => {
    await hardLoad(page, '#exp/v2/magnets')
    return clickFirst(page, '.ct-res-row.ct-tap')
  }, { settle: 2000, minText: 300 }))

  // §4 - the context peers.
  out.push(S('thread-peer', '§4', '.wb-peer-thread, .wb-peer, .msgs', async page => {
    await hardLoad(page, '#exp/v2/dms')
    return clickFirst(page, '[data-wbrow]')
  }, { settle: 1800, minText: 200 }))
  out.push(S('context-sheet', '§7', '.ctx-head', async page => {
    await hardLoad(page, '#exp/v2/dms')
    if (!await clickFirst(page, '[data-wbrow]')) return false
    await page.waitForTimeout(1800)
    return clickFirst(page, '.who.tap')
  }, { settle: 900, minText: 100 }))
  out.push(S('chat-peer', '§4/§6', '.cfield', async page => {
    await hardLoad(page, '#exp/v2/dms/chat')
    return true
  }, { settle: 1200, minText: 60 }))
  out.push(S('voice-control', '§6', '.cmic', async page => {
    await hardLoad(page, '#exp/v2/dms/chat')
    return true
  }, { settle: 1000, minText: 60 }))
  out.push(S('hands-free-sheet', '§6', '.wb-hf-card', async page => {
    await hardLoad(page, '#exp/v2/dms/chat')
    try { await page.click('.cmic', { button: 'right', timeout: 2500 }) } catch { return false }
    return true
  }, { when: 'the mic long-press/right-click opens the sheet in a headless context', settle: 900, minText: 30 }))
  out.push(S('voice-strip', '§6', '.wb-vs-dot', async page => {
    await hardLoad(page, '#exp/v2/dms/chat')
    return true
  }, { when: 'the voice state is not IDLE, which needs a live microphone' }))
  out.push(S('voice-dock', '§6', '.vd', async page => {
    await hardLoad(page, '#exp/v2/dms/chat')
    return true
  }, { when: 'a live conversation is running, which needs a live microphone' }))
  out.push(S('push-later-sheet', '§7', '.push-presets', async page => {
    await hardLoad(page, '#exp/v2/dms')
    return clickText(page, '.btn.s, button', /^later$/i)
  }, { when: 'a thread on the DMs list is showing a draft card with a Later control', settle: 900, minText: 30 }))

  // §5 - the command layer.
  out.push(S('command-palette', '§5', '.wb-cmdk', async page => {
    await hardLoad(page, '#exp/v2/dms')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    return true
  }, { settle: 900, minText: 60 }))
  out.push(S('shortcut-sheet', '§5', '.wb-keys', async page => {
    await hardLoad(page, '#exp/v2/dms')
    await page.keyboard.press('?')
    return true
  }, { settle: 900, minText: 60 }))
  out.push(S('bulk-bar', '§5', '.wb-bulk', async page => {
    await hardLoad(page, '#exp/v2/dms')
    await page.keyboard.press('j')
    await page.waitForTimeout(400)
    await page.keyboard.press('x')
    return true
  }, { settle: 800, minText: 30 }))

  // §7 - the strips. All four are data-conditional by construction.
  out.push(S('restore-strip', '§7', '.wb-disc', async page => {
    await hardLoad(page, '#exp/v2/dms')
    if (!await clickFirst(page, '[data-wbrow]')) return false
    await page.waitForTimeout(1800)
    return true
  }, { when: 'the open thread has a discarded draft to restore' }))
  out.push(S('stale-bar', '§7', '.stalebar, .pushbar', async page => {
    await hardLoad(page, '#exp/v2/dms')
    return true
  }, { when: 'stale or pushed drafts exist on the DMs lane' }))
  out.push(S('seat-health-banner', '§7', '.seatbanner', async page => {
    await hardLoad(page, '#exp/v2/dms')
    return true
  }, { when: 'a LinkedIn seat is reporting unhealthy' }))
  out.push(S('system-alert-strip', '§7', '.sa', async page => {
    await hardLoad(page, '#exp/v2/today')
    return true
  }, { when: 'a system alert is open on Today' }))

  // §1 - the escape hatch. 11 shared components render here and the theme is
  // process-wide, so a light-mode fix verified only in #exp/v2 is not verified.
  out.push(S('stock:inbox', '§1', '.rows, .r', async page => {
    await hardLoad(page, '#exp/stock')
    return true
  }, { settle: 1200, minText: 120 }))

  return out
}

// ---- go ------------------------------------------------------------------

// `--only=id,id` runs a subset through the identical harness. The reported
// `intended` follows the subset, so the walked/intended pair stays honest.
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)
  .split(',').map(s => s.trim()).filter(Boolean)

const browser = await chromium.launch()
const CATALOG = ONLY.length ? catalog().filter(s => ONLY.includes(s.id)) : catalog()
if (ONLY.length && CATALOG.length !== ONLY.length) {
  console.error(`--only named ${ONLY.length} surfaces, matched ${CATALOG.length}. Check the ids.`)
  process.exit(2)
}
const intendedPerPass = CATALOG.length

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const pass = `${vp.w}x${vp.h}/${theme}`
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
    await ctx.addInitScript(([s, t]) => {
      localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
      // inventory §8: the attribute is read at boot in main.tsx before React
      // mounts, so it has to be in place before the first document load.
      if (t === 'light') localStorage.setItem('inbox-theme', 'light')
      else localStorage.removeItem('inbox-theme')
    }, [session, theme])
    const page = await ctx.newPage()
    const route = async r => {
      const q = r.request(), m = q.method()
      const isRpc = q.url().includes('/rpc/')
      if (m === 'POST' && isRpc) { rpcReads += 1; return r.continue() }
      if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
        attemptedWrites += 1
        console.error(`  ATTEMPTED WRITE BLOCKED: ${m} ${q.url()}`)
        return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return r.continue()
    }
    await page.route('**/rest/v1/**', route)
    await page.route('**/rest/v1/rpc/**', route)

    for (const s of CATALOG) {
      await run(page, pass, s)
      await closeOverlays(page)
    }
    await ctx.close()
  }
}
await browser.close()

// ---- report --------------------------------------------------------------

const intended = intendedPerPass * VIEWPORTS.length * THEMES.length
const bySurfaceKind = new Map()
for (const h of allHits) {
  const k = `${h.kind}\t${h.match}`
  if (!bySurfaceKind.has(k)) bySurfaceKind.set(k, new Set())
  bySurfaceKind.get(k).add(h.surface)
}

console.log('')
console.log(`Surfaces in the catalog: ${intendedPerPass}. Passes: ${VIEWPORTS.length * THEMES.length} (${VIEWPORTS.map(v => v.w).join(', ')} x ${THEMES.join(', ')}).`)
console.log(`Judge-vocabulary nodes removed structurally before scanning: ${judgeVocabRemoved}.`)
console.log(`Attempted writes (blocked): ${attemptedWrites}. RPC reads called by POST (not writes): ${rpcReads}.`)

if (conditionalAbsent.length) {
  const byId = new Map()
  for (const c of conditionalAbsent) {
    if (!byId.has(c.id)) byId.set(c.id, { ...c, passes: [] })
    byId.get(c.id).passes.push(c.pass)
  }
  console.log('')
  console.log(`CONDITIONAL, ABSENT (${conditionalAbsent.length} across all passes, ${byId.size} distinct). Named, not skipped:`)
  for (const c of byId.values()) {
    console.log(`  ${c.id} (${c.ref}) — renders only when ${c.when}. Absent on: ${c.passes.join(', ')}`)
  }
}

if (unreachable.length) {
  const byId = new Map()
  for (const u of unreachable) {
    if (!byId.has(u.id)) byId.set(u.id, { ...u, passes: [] })
    byId.get(u.id).passes.push(u.pass)
  }
  console.log('')
  console.log(`UNREACHABLE REQUIRED SURFACES (${unreachable.length} across all passes, ${byId.size} distinct):`)
  for (const u of byId.values()) {
    console.log(`  ${u.id} (${u.ref}) — ${u.why}. On: ${u.passes.join(', ')}`)
  }
}

if (allHits.length) {
  console.log('')
  console.log(`HITS (${allHits.length} raw, ${bySurfaceKind.size} distinct):`)
  for (const [k, surfaces] of bySurfaceKind) {
    const [kind, match] = k.split('\t')
    const list = [...surfaces]
    console.log(`  [${kind}] "${match}" — ${list.length} surface-pass(es), e.g. ${list.slice(0, 4).join(' | ')}`)
  }
}

const fail = unreachable.length > 0 || allHits.length > 0
console.log('')
console.log(`no-internals: walked ${walked.length} / intended ${intended} · conditional-absent ${conditionalAbsent.length} · unreachable ${unreachable.length} · hits ${allHits.length} · ${fail ? 'FAIL' : 'PASS'}`)
process.exit(fail ? 1 : 0)
