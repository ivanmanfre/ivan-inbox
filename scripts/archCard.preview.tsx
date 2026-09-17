/* ==========================================================================
   scripts/archCard.preview.tsx — four static pictures of the ARCH comment card,
   one per outcome, drawn from fixture rows and NOTHING else.

   Run:  npx vitest run -c scripts/arch-card-preview.config.ts
   Out:  $ARCH_PREVIEW_DIR (default: the goal-run's card-preview folder)

   Why this shape. The app cannot be driven to an ARCH comment card without a
   live session and a real ops_drafts row, and the existing browser proof
   (scripts/verify-comment-draft.mjs) needs both plus the production edge
   function. So the card is rendered here the way the tests render it — the real
   component, real fixture rows — wrapped in the app's own stylesheets, written
   to disk as HTML, and photographed with the Playwright that is already a
   devDependency. No network, no session, no database.
   ========================================================================== */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PendingCard } from '../src/wb/ops/PendingCard'
import type { OpsDraft } from '../src/lib/ops'

const OUT = process.env.ARCH_PREVIEW_DIR
  ?? '/Users/ivanmanfredi/Desktop/Ivan - Content System/goal-runs/arch-comment-lane-davor-2026-09-17-out/card-preview'

const NOW = '2026-09-17T11:00:00Z'

const css = ['src/ds/tokens.css', 'src/ds/ds.css', 'src/wb/wb.css', 'src/wb/ops/ops.css']
  .map(p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))
  // ds.css pulls tokens.css itself; both are concatenated here in that order.
  .join('\n').replace(/@import[^;]+;/g, '')

const card: OpsDraft = {
  id: 'preview', client_id: 'arch', kind: 'comment_reply', slack_channel: '',
  body: '', context: {}, created_at: '2026-09-17T09:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000'

// Real rows from the ARCH lane's first pass over Davorin's posts.
const CARDS: Array<{ name: string; draft: OpsDraft }> = [
  {
    name: '1-draft',
    draft: {
      ...card,
      body: 'Thanks! The math has to work before the booking does.',
      context: {
        comment_id: 'c1', author_name: 'Jarne M.', author_headline: 'Founder, hospitality tech',
        comment_text: 'Fair point!', post_url: POST_URL, category: 'AGREEMENT',
        arch_outcome: 'DRAFT',
        arch_reason: 'He has already made this point in public, so the reply is his own line handed back.',
        arch_basis: 'Post body: "But if the numbers only support €900, we\'re still overpaying."',
        arch_sources: [
          { id: 's1', source_type: 'post', title: 'The €900 repeat-booking post', public: true },
          { id: 's2', source_type: 'call_note', title: 'Kickoff call, 2026-08-14', public: false },
        ],
        drafted_at: NOW, draft_version: 1, draft_rounds: 1,
      },
    },
  },
  {
    name: '2-needs-davor',
    draft: {
      ...card,
      context: {
        comment_id: 'c2', author_name: 'Anna Trifonoff', author_headline: 'Growth, DTC',
        comment_text: "Love this breakdown. One thing I'd be curious about: have you benchmarked freebies vs. discounts as the incentive behind the code?",
        post_url: POST_URL, category: 'QUESTION', arch_outcome: 'NEEDS_DAVOR',
        arch_reason: 'She asks for a benchmark of freebies against discounts; he has published no such result.',
        arch_sources: [
          { id: 's1', source_type: 'post', title: 'The €900 repeat-booking post', public: true },
          { id: 's3', source_type: 'strategy_doc', title: 'ARCH incentive notes', public: false },
        ],
        drafted_at: NOW,
      },
    },
  },
  {
    name: '3-escalate',
    draft: {
      ...card,
      context: {
        comment_id: 'c3', author_name: 'Kamran Arshad', author_headline: 'Performance marketing',
        comment_text: 'Repeat bookings are not the check in this market — acquisition cost is.',
        post_url: POST_URL, category: 'CHALLENGE', arch_outcome: 'ESCALATE',
        arch_reason: "A peer pushes back on the repeat-booking check with his own market read; that deserves Davorin's own answer.",
        arch_sources: [{ id: 's1', source_type: 'post', title: 'The €900 repeat-booking post', public: true }],
        drafted_at: NOW,
      },
    },
  },
  {
    name: '4-handled',
    draft: {
      ...card,
      context: {
        comment_id: 'c4', author_name: 'Jack Gonzalez Hart', author_headline: 'Founder',
        comment_text: 'Conor', post_url: POST_URL, category: 'TAG', arch_outcome: 'HANDLED',
        arch_reason: 'A bare name tag of a third person; nothing to reply to.',
        arch_sources: [], drafted_at: NOW,
      },
    },
  },
]

function page(draft: OpsDraft): string {
  const body = renderToStaticMarkup(<PendingCard draft={draft} refresh={() => {}} />)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ARCH comment card</title>
<style>${css}</style>
<style>
  html,body{ background:var(--ds-bg); margin:0 }
  .preview{ padding:16px; max-width:720px; margin-inline:auto }
</style>
</head><body><div class="preview">${body}</div></body></html>`
}

beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})
afterAll(() => { vi.useRealTimers() })

describe('ARCH comment card preview', () => {
  it('writes one HTML page and one screenshot per outcome', async () => {
    const files = CARDS.map(({ name, draft }) => {
      const file = join(OUT, `arch-card-${name}.html`)
      writeFileSync(file, page(draft))
      return { name, file }
    })
    // Real timers for the browser: the fake clock above is only there so the
    // card's "2h" freshness stamp is the same in every shot.
    vi.useRealTimers()
    const browser = await chromium.launch()
    // The phone, because that is where Ops is read and where the decision bar
    // becomes a stack. Same viewport as scripts/verify-comment-draft.mjs.
    const p = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
    for (const { name, file } of files) {
      await p.goto(`file://${file}`)
      await p.screenshot({ path: join(OUT, `arch-card-${name}.png`), fullPage: true })
    }
    await browser.close()
    expect(files).toHaveLength(4)
    console.log(`wrote ${files.length} pages + screenshots to ${OUT}`)
  })
})
