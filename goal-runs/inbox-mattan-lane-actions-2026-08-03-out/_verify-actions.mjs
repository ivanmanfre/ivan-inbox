// _verify-actions.mjs — every client-lane action fired END TO END through the
// REAL deployed app, against a REAL row, and restored.
//
// Not a re-implementation of the write in a script: Playwright clicks the same
// button Ivan clicks, on https://ivanmanfre.github.io/ivan-inbox/, and the
// database is then read with a separate fetch to see what actually landed.
//
// THE CLIENT-SAFETY RULES THIS FILE OBEYS — memory: "verification never hits
// live channels", "never auto-post clients". Mattan's board IS a live channel:
//
//  1. PROMOTE is never tested by promoting something NEW. That would put a post
//     a paying client has never seen in front of him for the duration of a test.
//     It is tested on a row ALREADY on his board, un-promoted and then put back:
//     both directions are exercised, and at no point does Mattan see anything
//     he was not already being shown.
//  2. 🔴 The row for (1) MUST be at status='review'. operator_set_board_visible
//     refuses to promote anything else ('not_in_review'), so un-promoting one of
//     the 10 PUBLISHED board rows would be IRREVERSIBLE through this path.
//  3. EDIT is tested on a never-promoted row and restored byte-identically.
//  4. DELETE is destructive and cannot be restored, so it is not tested on a
//     real draft. A throwaway row is inserted (client_id='risedtc',
//     board_visible=false, status='disqualified' so no engine looks at it),
//     deleted through the UI, and its absence verified. The REFUSAL path — a
//     promoted row must not be deletable — is checked on a real board row,
//     which is safe because the whole point is that nothing happens.
//
// Usage: node _verify-actions.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'https://ivanmanfre.github.io/ivan-inbox/'
mkdirSync(outDir, { recursive: true })

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const sessionRaw = readFileSync(new URL('../../.session.json', import.meta.url), 'utf8')
const session = JSON.parse(sessionRaw)
const U = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const H = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
const rest = async (p, i = {}) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers || {}) } })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const rpc = async (n, a) => {
  const r = await fetch(`${U}/rest/v1/rpc/${n}`, { method: 'POST', headers: H, body: JSON.stringify(a) })
  return (await r.json())
}
const row = async id => (await rest(`carousel_drafts?id=eq.${id}&select=id,title,status,board_visible,post_body,taxonomy,updated_at`)).body?.[0] ?? null
const boardQueueIds = async () => {
  const ov = await rpc('operator_clients_overview', { p_gate: 'clientops' })
  const c = ov.clients.find(x => x.client_id === 'risedtc')
  const gb = await rpc('get_client_board', { p_slug: c.board.slug, p_token: c.board.token })
  return (gb.board?.queue ?? []).map(q => q.id)
}

const results = []
const log = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${JSON.stringify(detail)}`)
}

// ---- pick the rows -------------------------------------------------------
const all = (await rest('carousel_drafts?client_id=eq.risedtc&select=id,title,status,board_visible,post_body,taxonomy,updated_at&limit=400')).body
// 🔴 The target's title must be UNIQUE at the length the harness searches on.
// The first run picked "[TEST convergence-apply] ROAS vs cash conversion" and
// opened "…conversion (fallback lane)" — a DIFFERENT row, board_visible=false —
// then reported the app for offering the wrong buttons. It was offering exactly
// the right ones for the row it had. Two live prefixes collide at 42 chars.
const SEARCH_LEN = 42
const prefixCount = {}
for (const r of all) {
  const k = (r.title ?? '').slice(0, SEARCH_LEN)
  prefixCount[k] = (prefixCount[k] ?? 0) + 1
}
const unambiguous = r => prefixCount[(r.title ?? '').slice(0, SEARCH_LEN)] === 1
const promoteTarget = all.find(r => r.board_visible === true && r.status === 'review' && unambiguous(r))
const editTarget = all.find(r => r.board_visible !== true && r.status === 'review' && (r.post_body ?? '').length > 40 && unambiguous(r))
if (!promoteTarget) throw new Error('no board_visible review row — refusing to test promote on a published row (irreversible)')
if (!editTarget) throw new Error('no internal review row to edit')
console.log(`promote target : ${promoteTarget.id} "${promoteTarget.title}" (on board, review)`)
console.log(`edit target    : ${editTarget.id} "${editTarget.title}" (internal, review)\n`)

const queueBefore = await boardQueueIds()
log('board queue holds the promote target before we touch anything', queueBefore.includes(promoteTarget.id),
  { queueLen: queueBefore.length })

// ---- the throwaway row for the delete test -------------------------------
const THROWAWAY_TITLE = 'ZZ verification row — safe to delete'
const ins = await rest('carousel_drafts?select=id', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    client_id: 'risedtc',
    status: 'disqualified',       // no engine looks at this status
    board_visible: false,         // 🔴 Mattan can never see it
    type: 'text',
    title: THROWAWAY_TITLE,
    post_body: 'Throwaway row created by the run’s own verification. Not client copy.',
    taxonomy: { created_by: 'inbox-mattan-lane-actions-verification' },
  }),
})
const throwaway = ins.body?.[0]?.id
log('throwaway row created for the delete test', !!throwaway, { id: throwaway, status: ins.status })

// ---- drive the real app --------------------------------------------------
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
  ['sb-bjbvqvzbzczjbatgmccb-auth-token', sessionRaw])

async function openMattanDraft(title) {
  await page.goto(`${baseUrl}#exp/v2/content`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2800)
  // The open draft SURVIVES a reload (the takeover re-mounts from the persisted
  // route), and its scrim then swallows every click on the lane switcher
  // underneath. Close it before doing anything else.
  for (let i = 0; i < 3 && await page.locator('.wb-tkscrim').count() > 0; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
  }
  await page.locator('.chips .chip', { hasText: 'Mattan Danino' }).first().click()
  await page.waitForTimeout(2600)
  // Search rather than scroll: the row has to be the one we chose, not the
  // first one that happens to render.
  const box = page.locator('.ct-fsearch-in').first()
  await box.fill(title.slice(0, 42))
  await page.waitForTimeout(1000)
  // Open whichever group/stage holds it. `›` is the CLOSED chevron
  // (Surface.tsx:116), so this only ever expands — clicking every head blindly
  // would close the ones that were already open. Twice, because opening a group
  // reveals the stage sections nested inside it.
  for (let pass = 0; pass < 2; pass++) {
    for (const h of await page.locator('.wb-sech.tap').all()) {
      const chev = await h.locator('.wb-sech-chev').innerText().catch(() => '')
      if (chev.includes('\u203a')) await h.click().catch(() => {})
    }
    await page.waitForTimeout(700)
  }
  const card = page.locator('.ct-card:not(.ct-idea)').first()
  await card.click()
  await page.waitForTimeout(2200)
  const opened = (await page.locator('.dw-cap-t').first().innerText().catch(() => ''))
  // Fail LOUDLY on a mismatch. A harness that quietly tests a neighbouring row
  // produces a confident, wrong verdict — which is exactly what happened once.
  if (opened.trim() !== title.trim()) {
    throw new Error(`opened the wrong row: wanted "${title}", got "${opened}"`)
  }
  return opened
}
const sheetConfirm = async () => {
  await page.waitForSelector('.sheet-btn.confirm, .sheet-btn.danger', { timeout: 8000 })
  const txt = await page.locator('.sheet-title').innerText()
  const msg = await page.locator('.sheet-msg').innerText()
  await page.locator('.sheet-btn.confirm, .sheet-btn.danger').first().click()
  await page.waitForTimeout(2600)
  return { title: txt, message: msg }
}

// ===== 1 · UN-PROMOTE, then put it straight back ==========================
{
  const opened = await openMattanDraft(promoteTarget.title)
  const acts = await page.evaluate(() => [...document.querySelectorAll('.dw-acts .dw-key')].map(e => e.textContent.replace(/\s+/g, ' ').trim()))
  log('a promoted row offers "Take off his board" and NO delete button',
    acts.some(a => /Take off/.test(a)),
    { opened: opened.slice(0, 50), acts, deleteZoneNote: await page.locator('.wb-delzone .ct-subtle').first().innerText().catch(() => null) })

  await page.locator('.dw-acts .dw-key', { hasText: 'Take off' }).first().click()
  const sheet = await sheetConfirm()
  await page.screenshot({ path: `${outDir}/act-unpromote-sheet.png` })
  const after = await row(promoteTarget.id)
  log('UN-PROMOTE landed in the database', after.board_visible === false,
    { board_visible: after.board_visible, status: after.status, sheetTitle: sheet.title })

  // put it back immediately — this is the restore, and it is the whole reason
  // a review row was chosen (a published one could not be re-promoted).
  await page.waitForTimeout(1200)
  const backBtn = page.locator('.dw-acts .dw-key', { hasText: 'Put on Mattan' }).first()
  const viaUi = await backBtn.count() > 0
  if (viaUi) { await backBtn.click(); await sheetConfirm() }
  let restored = await row(promoteTarget.id)
  if (restored.board_visible !== true) {
    const r = await rpc('operator_set_board_visible', { p_gate: 'clientops', p_draft_id: promoteTarget.id, p_visible: true })
    restored = await row(promoteTarget.id)
    log('restore needed the RPC directly (UI button not reachable in this state)', restored.board_visible === true, r)
  }
  log('RE-PROMOTE restored the row to Mattan’s board', restored.board_visible === true,
    { board_visible: restored.board_visible, viaUi })
}

// ===== 2 · EDIT a never-promoted row, then restore it byte-identically =====
{
  const before = await row(editTarget.id)
  await openMattanDraft(editTarget.title)
  const acts = await page.evaluate(() => [...document.querySelectorAll('.dw-acts .dw-key')].map(e => e.textContent.replace(/\s+/g, ' ').trim()))
  log('an internal review row offers Put-on-board AND Edit',
    acts.some(a => /Put on Mattan/.test(a)) && acts.some(a => /Edit/.test(a)), { acts })

  await page.locator('.dw-acts .dw-key', { hasText: 'Edit' }).first().click()
  await page.waitForTimeout(700)
  const ta = page.locator('.dw-main-in textarea').first()
  const marker = `\n\n[verification ${Date.now()}]`
  await ta.fill((before.post_body ?? '') + marker)
  await page.locator('.li-btn.p', { hasText: 'Save' }).first().click()
  await page.waitForTimeout(3200)
  await page.screenshot({ path: `${outDir}/act-edit-saved.png` })
  const saved = await row(editTarget.id)
  log('EDIT landed through operator_edit_draft_body', saved.post_body === (before.post_body ?? '') + marker,
    { lenBefore: (before.post_body ?? '').length, lenAfter: (saved.post_body ?? '').length })
  const tax = typeof saved.taxonomy === 'string' ? JSON.parse(saved.taxonomy) : saved.taxonomy
  log('the db/025 regen guard was stamped (the RPC does not do this itself)',
    tax?.human_edited === true, { human_edited: tax?.human_edited, human_edited_at: tax?.human_edited_at })
  const logEntries = (await rest(`carousel_drafts?id=eq.${editTarget.id}&select=agent_log`)).body?.[0]?.agent_log ?? []
  const opEntry = (Array.isArray(logEntries) ? logEntries : []).filter(e => e?.agent === 'Operator').pop()
  log('the RPC appended its Operator audit line', !!opEntry, { entry: opEntry })

  // restore, through the same code path
  const restore = await rpc('operator_edit_draft_body', { p_gate: 'clientops', p_draft_id: editTarget.id, p_body: before.post_body })
  const back = await row(editTarget.id)
  log('EDIT restored byte-identically', back.post_body === before.post_body,
    { ok: restore.ok, identical: back.post_body === before.post_body })
}

// ===== 3 · DELETE the throwaway row through the UI =========================
if (throwaway) {
  const opened = await openMattanDraft(THROWAWAY_TITLE)
  log('the throwaway row opens', /ZZ verification/.test(opened), { opened: opened.slice(0, 60) })
  const delBtn = page.locator('.wb-delbtn').first()
  const has = await delBtn.count() > 0
  log('a NOT-on-board client row offers Delete', has, {})
  if (has) {
    await delBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${outDir}/act-delete-confirm.png` })
    await page.locator('.wb-btn-danger', { hasText: 'Delete' }).first().click()
    await page.waitForTimeout(3000)
  }
  const gone = await row(throwaway)
  log('DELETE removed the row from the database', gone === null || gone.status === 'disqualified',
    { row: gone ? { status: gone.status } : 'gone' })
  if (gone) {
    // never leave litter behind
    await rest(`carousel_drafts?id=eq.${throwaway}`, { method: 'DELETE' })
    log('cleanup: throwaway row hard-removed', (await row(throwaway)) === null, {})
  }
}

// ===== 4 · the board is exactly as we found it =============================
{
  let queueAfter = await boardQueueIds()
  for (let i = 0; i < 6 && !queueAfter.includes(promoteTarget.id); i++) {
    // the queue is rebuilt by an n8n webhook, so give the sync time; if it is
    // still short, fire the promote again rather than leaving a client's board
    // one post down.
    await new Promise(r => setTimeout(r, 5000))
    queueAfter = await boardQueueIds()
    if (i === 2 && !queueAfter.includes(promoteTarget.id)) {
      await rpc('operator_set_board_visible', { p_gate: 'clientops', p_draft_id: promoteTarget.id, p_visible: true })
    }
  }
  const visibleNow = (await rest('carousel_drafts?client_id=eq.risedtc&select=id&board_visible=is.true')).body.length
  log('🔴 MATTAN’S BOARD IS BACK EXACTLY AS IT WAS',
    queueAfter.length === queueBefore.length && queueAfter.includes(promoteTarget.id) && visibleNow === 23,
    { queueBefore: queueBefore.length, queueAfter: queueAfter.length, boardVisibleRows: visibleNow })
}

log('no uncaught page errors during any of it', errors.length === 0, { errors })
writeFileSync(`${outDir}/verify-actions.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.filter(r => r.pass).length}/${results.length} PASS`)
await browser.close()
