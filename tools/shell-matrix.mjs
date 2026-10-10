// SPEC-shell-spacing §5.3: the shell acceptance matrix. READ-ONLY: every
// mutation and every edge function is answered 403 before it leaves the page,
// exactly as tools/thread-open.mjs does. It only navigates (hash) and toggles
// the Claude drawer with ⌘J / Ctrl+J; it never types into any field.
//
// node tools/shell-matrix.mjs <baseUrl> <outDir> [chromium|webkit ...]
//   SHELL_SESSION_PATH  private Supabase session file (required)
//   SHELL_WIDTHS        canvas widths, default 1272,1144,1092,964,936,808,764
//   SHELL_PLACES        default home,dms,content/calendar,content/now,content/ideas,content/brain,content/magnets,lanes,ops,sales,claude,settings
//   SHELL_SKIN          ?skin= value, default brief:shell
//   SHELL_SHOTS         0 = report only
//   SHELL_RAIL          1 = keep the web rail (default hides it, as Daily Brief does, so the
//                       viewport IS the canvas C of the spec's matrix)
// Output: <outDir>/<engine>/<place>-<C>-<closed|open>.png and <outDir>/report.json (must be NEW).
// Exit 1 when any Phase A invariant fails (frame, overlap, header line, overflow, tools).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'

const [base, outDir, ...engineArgs] = process.argv.slice(2)
if (!base || !outDir) { console.error('usage: shell-matrix.mjs <baseUrl> <outDir> [engines]'); process.exit(2) }
const engines = engineArgs.length ? engineArgs : ['chromium', 'webkit']
const widths = (process.env.SHELL_WIDTHS || '1272,1144,1092,964,936,808,764').split(',').map(Number)
const places = (process.env.SHELL_PLACES || 'home,dms,content/calendar,content/now,content/ideas,content/brain,content/magnets,lanes,ops,sales,claude,settings').split(',')
const skin = process.env.SHELL_SKIN ?? 'brief:shell'
const shots = process.env.SHELL_SHOTS !== '0'
const authKey = 'sb-bjbvqvzbzczjbatgmccb-auth-token'
const readRpcs = new Set(['inbox_changed_since', 'inbox_interest_cards', 'inbox_followup_sources', 'warm_signal_cards', 'conversation_agent_cards', 'inbox_reply_source', 'outreach_reply_sources', 'x_review_list'])
let session = readFileSync(process.env.SHELL_SESSION_PATH, 'utf8')
const reportPath = join(outDir, 'report.json')
if (existsSync(reportPath)) { console.error('report.json exists; use a new outDir'); process.exit(2) }
mkdirSync(outDir, { recursive: true })

// Measured in the page. Phase A invariants decide the exit code; the rest are recorded for Phase B.
function measure() {
  const r = e => e?.getBoundingClientRect()
  const app = document.querySelector('.d-app'), main = document.querySelector('.d-main'), aside = document.querySelector('aside.d-claude')
  const band = document.querySelector('.d-main > .d-ans'), head = aside?.querySelector('.dcl-head')
  const fails = [], notes = []
  const out = {
    layout: app?.classList.contains('d-desktop') ? 'desktop' : 'phone',
    skinOn: document.documentElement.dataset.skinOn ?? '',
    claude: app?.dataset.claude ?? null,
    tier: main?.dataset.tier ?? null,
    mainW: Math.round(r(main)?.width ?? 0),
    drawer: aside ? { left: Math.round(r(aside).left), top: Math.round(r(aside).top), w: Math.round(r(aside).width) } : null,
  }
  if (out.layout !== 'desktop') fails.push('frame: not d-desktop')
  if (document.querySelector('.d-ptop, .d-psheet')) fails.push('frame: phone top bar or sheet present')
  if (band) {
    const b = r(band)
    out.bandBottom = Math.round(b.bottom); out.bandH = Math.round(b.height)
    if (Math.abs(b.height - 52) > 1) fails.push(`band height ${b.height}`)
  }
  if (aside && head) {
    const hb = r(head).bottom
    out.headBottom = Math.round(hb)
    if (band && Math.abs(hb - r(band).bottom) > 1 && !document.querySelector('.d-health,.d-offline')) fails.push(`header line: band ${Math.round(r(band).bottom)} vs drawer head ${Math.round(hb)}`)
    for (const sel of ['[data-verb="chats"]', '[data-verb="new-chat"]', '.dcl-head button[aria-label^="Close Claude"]']) {
      const k = head.querySelector(sel); if (!k) continue
      const kr = r(k), top = document.elementFromPoint(kr.left + kr.width / 2, kr.top + kr.height / 2)
      if (!top || !aside.contains(top)) fails.push(`drawer key covered: ${sel} by ${top?.className || top?.tagName}`)
    }
    if (out.claude === 'dock') {
      const m = r(main)
      if (m.right > r(aside).left + 1) fails.push(`main overlaps drawer: ${Math.round(m.right)} > ${Math.round(r(aside).left)}`)
      const bell = document.querySelector('.d-bellp-desktop')
      if (bell && r(bell).right > r(aside).left + 1) fails.push('bell feed over drawer')
    }
  }
  for (const el of [main, document.querySelector('.d-body'), ...document.querySelectorAll('[data-d-scroll]')]) {
    if (el && el.scrollWidth > el.clientWidth + 1) fails.push(`h-overflow ${el.className.split(' ')[0]} ${el.scrollWidth}>${el.clientWidth}`)
  }
  const tools = document.querySelector('.d-main .d-tools')
  if (tools) {
    out.toolsH = Math.round(r(tools).height)
    if (r(tools).height > 33) fails.push(`tools wrap: ${r(tools).height}`)
    const n = document.querySelector('.d-bell-n')
    if (n) for (const t of tools.querySelectorAll('.d-tools-page > *')) {
      const a = r(n), b = r(t)
      if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) fails.push('bell count over a tool')
    }
  }
  // Phase B (recorded only): the one left edge and pane minimums.
  const title = document.querySelector('.d-ans .d-at h1')
  if (title && main) notes.push(`title x ${Math.round(r(title).left - r(main).left)}`)
  out.fails = fails; out.notes = notes
  return out
}

const report = { base, skin, engines, widths, places, cells: [], failures: 0 }
for (const engine of engines) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch()
  try {
    const context = await browser.newContext({ viewport: { width: widths[0], height: 790 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method()
      if (url.hostname === 'bjbvqvzbzczjbatgmccb.supabase.co') {
        if (url.pathname.startsWith('/functions/')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"matrix blocked an edge function"}' })
        if (method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return route.continue()
        if (method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/') && readRpcs.has(url.pathname.split('/').pop())) return route.continue()
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue()
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"matrix blocked a mutation"}' })
    })
    if (process.env.SHELL_RAIL !== '1') await page.addInitScript(() => {
      const st = document.createElement('style'); st.textContent = '.d-app .d-side{display:none!important}'
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st))
    })
    await page.addInitScript(({ session, authKey }) => {
      if (!sessionStorage.getItem('matrix-init')) {
        localStorage.setItem(authKey, session)
        localStorage.setItem('d-claude-open', '0')
        sessionStorage.setItem('matrix-init', '1')
      }
    }, { session, authKey })
    const sep = base.includes('?') ? '&' : '?'
    await page.goto(`${base.replace(/#.*$/, '')}${skin ? `${sep}skin=${encodeURIComponent(skin)}` : ''}#exp/d/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.d-app', { timeout: 30000 })
    await page.waitForTimeout(2500)
    if (engine === engines[0]) mkdirSync(join(outDir, engine), { recursive: true })
    else mkdirSync(join(outDir, engine), { recursive: true })
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 790 })
      for (const p of places) {
        await page.evaluate(h => { location.hash = h }, `#exp/d/${p}`)
        await page.waitForTimeout(1400)
        for (const state of ['closed', 'open']) {
          const open = await page.evaluate(() => !!document.querySelector('aside.d-claude, .d-psheet'))
          if ((state === 'open') !== open) {
            await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur() })
            await page.keyboard.press(engine === 'webkit' ? 'Meta+j' : 'Control+j')
            await page.waitForTimeout(700)
          }
          const m = await page.evaluate(measure)
          const cell = { engine, width: w, place: p, state, ...m }
          report.cells.push(cell)
          report.failures += m.fails.length
          if (shots) await page.screenshot({ path: join(outDir, engine, `${p.replace('/', '-')}-${w}-${state}.png`) })
          if (m.fails.length) console.log(`FAIL ${engine} ${w} ${p} ${state}: ${m.fails.join('; ')}`)
        }
      }
    }
    report[`${engine}PageErrors`] = errors
    const s = await page.evaluate(k => localStorage.getItem(k), authKey)
    if (s) session = s
    await context.close()
  } finally { await browser.close() }
}
if (process.env.SHELL_SESSION_OUT) writeFileSync(process.env.SHELL_SESSION_OUT, session, { flag: 'wx', mode: 0o600 })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ cells: report.cells.length, failures: report.failures }))
process.exit(report.failures ? 1 : 0)
