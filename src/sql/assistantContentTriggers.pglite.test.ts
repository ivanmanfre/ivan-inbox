import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const sql = (name: string) => readFileSync('db/' + name, 'utf8')
const section = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)))
const owner = '00000000-0000-4000-8000-000000000001'

it('writes each new content nudge once, keeping its owner, artifact, mute and T3 boundaries', async () => {
  const db = new PGlite()
  try {
    const source = sql('20261118m_content_desk_r3.sql')
    const desk = sql('20261118m_content_desk_core.sql')
    const inbox = sql('049_inbox_turns_notifications.sql')
    const bot = sql('060_bot_thread.sql')
    await db.exec('create role anon; create role authenticated; create role service_role;')
    await db.exec(section(desk, 'create table if not exists public.desk_messages', '-- Every action'))
    await db.exec(section(desk, 'create table if not exists public.desk_triggers', 'create table if not exists public.desk_config'))
    await db.exec(section(inbox, 'create table if not exists public.inbox_threads', 'create index if not exists inbox_turns_thread'))
    await db.exec(section(bot, 'alter table public.inbox_threads add column', '-- the browser'))
    await db.exec(sql('065_bot_push.sql').match(/alter table public.inbox_threads add column[^;]*;/)![0])
    await db.exec(source.slice(source.indexOf('create or replace function public.desk_fire_trigger')))
    await db.exec(sql('20261125_assistant_content_triggers.sql'))
    const claim = async (key: string, kind = 'week_plan', test = false) => {
      const meta = { trigger: kind, artifact: { kind: 'week', ref: '2026-11-23' }, ...(test ? { test } : {}) }
      const { rows } = await db.query<{ result: Record<string, unknown> }>(`select desk_fire_assistant_trigger(
        $1,$2,'{}',12,$3,'Your weekly plan',$4) as result`, [kind, key, owner, JSON.stringify(meta)])
      return rows[0].result
    }
    const first = await claim('week_plan:2026-11-23')
    expect(first.main_push_muted).toBe(false)
    expect((await claim('week_plan:2026-11-23')).fired).toBe(false)
    const rows = await db.query(`select t.id, t.thread_id, t.origin, t.user_id, t.prompt, t.answer,
      t.sources->0->>'path' as source, m.meta->'artifact'->>'ref' as week,
      m.meta->>'mirrored_main_thread' as mirror from inbox_turns t join desk_messages m on m.id=t.id`)
    expect(rows.rows).toEqual([{ id: first.message_id, thread_id: first.main_thread_id, origin: 'bot', user_id: owner,
      prompt: '', answer: 'Your weekly plan', source: first.message_id, week: '2026-11-23', mirror: first.main_thread_id }])
    await db.query('update inbox_threads set bot_push_muted=true where id=$1', [first.main_thread_id])
    expect((await claim('empty_slot:2026-11-23', 'empty_slot')).main_push_muted).toBe(true)
    expect((await claim('t3:example', 't3_done')).main_thread_id).toBeUndefined()
    expect((await claim('week_plan:eval', 'week_plan', true)).main_thread_id).toBeUndefined()
    expect((await db.query('select count(*)::int as n from inbox_turns')).rows).toEqual([{ n: 2 }])
    expect((await db.query(`select has_function_privilege('authenticated',
      'desk_fire_assistant_trigger(text,text,jsonb,integer,uuid,text,jsonb)', 'execute') as allowed`)).rows).toEqual([{ allowed: false }])
  } finally { await db.close() }
}, 30000)
