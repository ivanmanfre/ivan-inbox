import { PGlite } from '@electric-sql/pglite'
import { readFileSync, existsSync } from 'node:fs'
import { expect, it } from 'vitest'
it('exposes only canonical supply fields to the existing operator, rejecting everyone else', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.outreach_agent_accounts(client_id text, operator_ids uuid[]);
      insert into public.outreach_agent_accounts values ('ivan',array['11111111-1111-4111-8111-111111111111'::uuid]);
      create function public.rise_supply_snapshot() returns jsonb language sql as $$ select '{"as_of":"2026-09-30T08:00:00Z","ready_count":1,"ready_ids":["a","b"],"private_field":"secret"}'::jsonb $$;`)
    const path = 'db/20260930_inbox_rise_ready.sql'
    if (existsSync(path)) await db.exec(readFileSync(path, 'utf8'))
    await expect(db.query('select public.inbox_rise_ready()')).rejects.toThrow('operator_denied')
    await db.exec("set test.uid='22222222-2222-4222-8222-222222222222'")
    await expect(db.query('select public.inbox_rise_ready()')).rejects.toThrow('operator_denied')
    await db.exec("set test.uid='11111111-1111-4111-8111-111111111111'")
    const r = await db.query<{v: unknown}>('select public.inbox_rise_ready() v')
    expect(r.rows[0].v).toEqual({ as_of: '2026-09-30T08:00:00Z', ready_count: 1, ready_ids: ['a','b'] })
    expect((await db.query<{ok:boolean}>("select has_function_privilege('anon','public.inbox_rise_ready()','execute') ok")).rows[0].ok).toBe(false)
  } finally { await db.close() }
}, 30_000)
