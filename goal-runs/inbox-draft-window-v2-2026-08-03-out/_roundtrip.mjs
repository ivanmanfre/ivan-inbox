// EDIT ROUND-TRIP against the live database, driven through the shipped UI.
//
// Two claims are tested, both end-to-end:
//   1. an edit typed into the LinkedIn card and saved LANDS in carousel_drafts;
//   2. when the stored body moves underneath an open editor, the save STOPS,
//      shows both texts, and writes NOTHING.
//
// Fully reversible: post_body AND taxonomy are snapshotted first and PATCHed
// back at the end, so the row is byte-identical to how it was found. taxonomy
// matters because a save stamps human_edited=true, which arms db/025 and would
// otherwise leave a row an engine can no longer rewrite.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const ORIGIN = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.argv[3] ?? './roundtrip'
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(`${ROOT}/.env.local`, 'utf8').trim().split('\n')
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
let sess = JSON.parse(readFileSync(`${ROOT}/.session.json`, 'utf8'))

async function refresh() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  })
  if (!r.ok) throw new Error('refresh failed ' + r.status)
  sess = await r.json()
  writeFileSync(`${ROOT}/.session.json`, JSON.stringify(sess, null, 2))
}
async function db(path, init = {}, retried = false) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${sess.access_token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  if (r.status === 401 && !retried) { await refresh(); return db(path, init, true) }
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}

const log = {}
const MARK = `\n\n[draft-window-v2 round-trip ${Date.now()}]`

// --- pick a target: the newest Ivan-lane review row with a body ------------
const [row] = await db('carousel_drafts?client_id=is.null&status=eq.review&post_body=not.is.null'
  + '&select=id,title,post_body,taxonomy,updated_at&order=updated_at.desc&limit=1')
if (!row) throw new Error('no reviewable Ivan-lane row to test against')
const snap = { id: row.id, post_body: row.post_body, taxonomy: row.taxonomy }
log.target = { id: row.id, title: row.title, bodyLen: row.post_body.length, taxonomyWasEdited: (row.taxonomy || {}).human_edited ?? null }
console.error('target', row.id, row.title)

const session = readFileSync(`${ROOT}/.session.json`, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
}, [session])

async function openTarget() {
  await page.goto(`${ORIGIN}/#exp/v2/content`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(5500)
  // Walk with j until the window shows the target. Opening the first card gives
  // us the queue; j moves inside it.
  await page.click('.ct-card')
  await page.waitForTimeout(2500)
  for (let i = 0; i < 40; i++) {
    const shown = await page.evaluate(() => document.querySelector('.dw-qrow.on .dw-qrow-t')?.textContent)
    if (shown && shown.trim().startsWith((row.title || '').slice(0, 30).trim())) return true
    await page.keyboard.press('j')
    await page.waitForTimeout(1400)
  }
  return false
}

try {
  // ======================= 1 · the happy round trip =======================
  if (!await openTarget()) throw new Error('could not reach the target row in the queue')
  await page.keyboard.press('e')
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const t = document.querySelector('textarea.li-ta')
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  })
  await page.keyboard.type(MARK)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/1-editing.png` })
  await page.click('.li-btn.p')            // Save
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/2-saved.png` })

  const [after] = await db(`carousel_drafts?id=eq.${row.id}&select=post_body,taxonomy,updated_at`)
  log.save = {
    landedInDb: after.post_body === snap.post_body + MARK,
    dbBodyEndsWith: after.post_body.slice(-70),
    humanEditedStamped: String((after.taxonomy || {}).human_edited ?? '') === 'true',
    savedFlashShown: await page.evaluate(() => !!document.querySelector('.li-saved')),
  }
  console.error('save landed:', log.save.landedInDb)

  // ======================= 2 · the conflict path ==========================
  // The window is open and re-seated on the saved body. Now an "engine" writes
  // a different body from OUTSIDE, exactly as the four live regen engines do.
  const ENGINE = snap.post_body + '\n\n[an engine wrote this while the window was open]'
  await db(`carousel_drafts?id=eq.${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ post_body: ENGINE }),
  })
  // Type into the still-open window WITHOUT reloading it, then save.
  await page.keyboard.press('e')
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const t = document.querySelector('textarea.li-ta')
    t.focus(); t.setSelectionRange(t.value.length, t.value.length)
  })
  await page.keyboard.type(' MY-EDIT')
  await page.click('.li-btn.p')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/3-conflict.png` })

  const [afterConflict] = await db(`carousel_drafts?id=eq.${row.id}&select=post_body`)
  log.conflict = {
    boxShown: await page.evaluate(() => !!document.querySelector('.dw-conf')),
    headline: await page.evaluate(() => document.querySelector('.dw-conf-h')?.textContent ?? null),
    showsTheirText: await page.evaluate(() => (document.querySelector('.dw-conf-t')?.textContent ?? '').includes('an engine wrote this')),
    myTextStillInEditor: await page.evaluate(() => (document.querySelector('textarea.li-ta')?.value ?? '').includes('MY-EDIT')),
    offersBothChoices: await page.evaluate(() =>
      [...document.querySelectorAll('.dw-conf .btn')].map(b => b.textContent.trim())),
    // THE claim: the engine's words are untouched.
    dbUnchangedByTheRefusedSave: afterConflict.post_body === ENGINE,
  }
  console.error('conflict surfaced:', log.conflict.boxShown, 'db untouched:', log.conflict.dbUnchangedByTheRefusedSave)
} finally {
  // ======================= restore, exactly ================================
  await db(`carousel_drafts?id=eq.${snap.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ post_body: snap.post_body, taxonomy: snap.taxonomy }),
  })
  const [back] = await db(`carousel_drafts?id=eq.${snap.id}&select=post_body,taxonomy`)
  log.restored = {
    bodyIdentical: back.post_body === snap.post_body,
    taxonomyIdentical: JSON.stringify(back.taxonomy) === JSON.stringify(snap.taxonomy),
  }
  log.consoleErrors = errors
  writeFileSync(`${OUT}/roundtrip.json`, JSON.stringify(log, null, 2))
  console.log(JSON.stringify(log, null, 2))
  await browser.close()
}
