// PHASE 2 PROBE — what does the morning brief actually contain, and how old is
// every row in it? Runs through vitest so it uses the shipped parser (asBrief)
// and the shipped derivations (countsFromBrief, todayLoad).
import fs from 'fs'
import { it } from 'vitest'
import { asBrief, countsFromBrief, todayLoad, partitionUrgencies, inScope } from '../../src/lib/today'

const DIR = 'goal-runs/inbox-density-and-ia-2026-08-03-out'
const AGE_D = (iso?: string | null) =>
  iso ? +(((Date.now() - new Date(iso).getTime()) / 86400000).toFixed(2)) : null

it('brief', async () => {
  const db = await import('./_db.mjs') as { URL_: string }
  const fsx = await import('fs')
  const env = Object.fromEntries(fsx.readFileSync('.env.local', 'utf8').trim().split('\n')
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  const sess = JSON.parse(fsx.readFileSync('.session.json', 'utf8'))
  const res = await fetch(`${db.URL_}/functions/v1/get-morning-brief`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${sess.access_token}` },
  })
  const raw = await res.json()
  const b = asBrief(raw)
  if (!b) throw new Error('not a full brief: ' + JSON.stringify(raw).slice(0, 400))
  const { visible, autoreplies } = partitionUrgencies(b.urgencies)
  const out = {
    status: res.status,
    top_level_keys: Object.keys(raw as object),
    generated_at: b.generated_at,
    scalars: { autoreplies_count: b.autoreplies_count, aging_count: b.aging_count },
    load: todayLoad(countsFromBrief(b, 'all')),
    urgencies: {
      n: b.urgencies.length, visible: visible.length, autoreplies: autoreplies.length,
      // THE question: are the "aging out" rows in the array at all, or only a scalar?
      ages_days: visible.map(u => AGE_D(u.waiting_since)).sort((a, c) => (c ?? 0) - (a ?? 0)),
      rows: b.urgencies.map(u => ({
        name: u.name, kind: u.kind, age_d: AGE_D(u.waiting_since),
        auto: u.is_autoreply ?? null, client: u.client_id ?? 'ivan',
      })),
    },
    dm_drafts: b.needs_you.dm_drafts.map(d => ({ name: d.prospect_name, age_d: AGE_D(d.created_at), is_aging: d.is_aging ?? null, client: d.client_id ?? 'ivan' })),
    comment_drafts: b.needs_you.comment_drafts.map(d => ({ who: d.post_author_name, age_d: AGE_D(d.drafted_at), is_aging: d.is_aging ?? null, client: d.client_id ?? 'ivan' })),
    feed_drafts: b.needs_you.feed_drafts.map(d => ({ who: d.target_name, age_d: AGE_D(d.created_at), status: d.status, client: d.client_id ?? 'ivan' })),
    posts_today: b.today_content.scheduled_posts.map(p => ({ at: p.scheduled_at, status: p.status, kind: p.kind })),
    calendar_next: (b.content_calendar?.entries ?? []).filter(p => p.scheduled_at && new Date(p.scheduled_at) > new Date())
      .sort((a, c) => (a.scheduled_at ?? '').localeCompare(c.scheduled_at ?? '')).slice(0, 4)
      .map(p => ({ at: p.scheduled_at, status: p.status })),
    scoped_ivan: todayLoad(countsFromBrief(b, 'ivan')),
    scoped_rise: todayLoad(countsFromBrief(b, 'risedtc')),
    inScopeCheck: inScope({ client_id: null }, 'ivan'),
  }
  fs.writeFileSync(`${DIR}/phase2-brief.json`, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2).slice(0, 6000))
}, 120000)
