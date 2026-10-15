import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('db/286_swishdm_plan_reads.sql', 'utf8')
const rollback = readFileSync('db/286_swishdm_plan_reads_rollback.sql', 'utf8')

async function dbWithPrerequisites() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.client_registry(client_id text primary key, is_active boolean);
    INSERT INTO public.client_registry VALUES ('swishdm',true),('ivan',true),('arch',true),('risedtc',true);
    CREATE FUNCTION public.lane_allowed(p_client text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM public.client_registry WHERE client_id=p_client AND is_active) $$;
    CREATE FUNCTION public.cb39_lane_ok(p_client text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT p_client='ivan' AND current_setting('request.jwt.claims',true)='{"operator":"ivan"}' $$;
    CREATE TABLE public.carousel_drafts(
      id uuid primary key, client_id text, title text, post_body text, status text,
      board_visible boolean, scheduled_at timestamptz, published_at timestamptz, created_at timestamptz);
    CREATE TABLE public.editorial_decisions(
      client_id text, action text, reason text, created_at timestamptz, target_kind text, target_id text);
    CREATE TABLE public.cb39_draft_verdicts(
      client_id text, draft_id uuid, verdict text, reasons text[], note text, source text,
      decided_at timestamptz, labels jsonb);
    CREATE TABLE public.content_plan_config(account text);
    CREATE TABLE public.content_plan_slots(account text);
    CREATE TABLE public.content_autopilot_config(account text, mode text);
    INSERT INTO public.content_autopilot_config VALUES ('swishdm','off');
    INSERT INTO public.carousel_drafts VALUES
      ('00000000-0000-0000-0000-000000000001','swishdm','Held one','body','review',false,null,null,now()),
      ('00000000-0000-0000-0000-000000000002','swishdm','Hidden?','body','review',true,null,null,now()),
      ('00000000-0000-0000-0000-000000000003','arch','Other client','body','review',false,null,null,now());
    INSERT INTO public.editorial_decisions VALUES
      ('swishdm','defer','Needs client answer',now(),'brief','b1'),
      ('arch','reject','Other client reason',now(),'brief','b2');
    INSERT INTO public.cb39_draft_verdicts VALUES
      ('swishdm','00000000-0000-0000-0000-000000000001','keep',ARRAY['useful'],'Strong source','app',now(),'{"title":"Held one"}'),
      ('arch','00000000-0000-0000-0000-000000000003','drop',ARRAY['generic'],'Other client note','app',now(),'{"title":"Other client"}');
  `)
  return db
}

describe('db/286 SwishDM read-only onboarding', { timeout: 30_000 }, () => {
  it('requires the shared operator entitlement and keeps other seats and anonymous callers out', async () => {
    const db = await dbWithPrerequisites()
    await db.exec(migration)
    const acl = await db.query<{ anon: boolean; authenticated: boolean }>(`
      SELECT has_function_privilege('anon','public.content_plan_week_onboarding(text,timestamptz)','EXECUTE') anon,
             has_function_privilege('authenticated','public.content_plan_week_onboarding(text,timestamptz)','EXECUTE') authenticated`)
    expect(acl.rows[0]).toEqual({ anon: false, authenticated: true })
    await db.exec(`SELECT set_config('request.jwt.claims','{}',false)`)
    await expect(db.query(`SELECT public.content_plan_week_onboarding('swishdm')`)).rejects.toThrow(/unauthorized/)
    await db.exec(`SELECT set_config('request.jwt.claims','{"operator":"ivan"}',false)`)
    await expect(db.query(`SELECT public.content_plan_week_onboarding('arch')`)).rejects.toThrow(/unknown seat/)
    await expect(db.query(`SELECT public.cb51_decision_history_onboarding('ivan')`)).rejects.toThrow(/unknown client/)
    await db.close()
  })

  it('returns only held unscheduled SwishDM drafts and real scoped decisions without writing plan state', async () => {
    const db = await dbWithPrerequisites()
    await db.exec(migration)
    await db.exec(`SELECT set_config('request.jwt.claims','{"operator":"ivan"}',false)`)
    const plan = await db.query<{ data: { state: string; target: number; target_week: null; auto_generate: boolean; weeks: { posts: unknown[]; planned: unknown[] }[]; held_drafts: { title: string }[] } }>(
      `SELECT public.content_plan_week_onboarding('swishdm','2026-10-15 12:00:00+00'::timestamptz) data`)
    expect(plan.rows[0].data).toMatchObject({ state: 'awaiting_cadence', target: 0, target_week: null, auto_generate: false })
    expect(plan.rows[0].data.weeks).toHaveLength(3)
    expect(plan.rows[0].data.weeks.every(w => w.posts.length === 0 && w.planned.length === 0)).toBe(true)
    expect(plan.rows[0].data.held_drafts.map(d => d.title)).toEqual(['Held one'])
    const history = await db.query<{ data: { rulings: { reason: string }[]; links: unknown[] } }>(
      `SELECT public.cb51_decision_history_onboarding('swishdm') data`)
    expect(history.rows[0].data.rulings.map(r => r.reason)).toEqual(['Needs client answer'])
    expect(history.rows[0].data.links).toHaveLength(1)
    expect(history.rows[0].data.links[0]).toMatchObject({ note: 'Strong source', verdict: 'keep', title: 'Held one' })
    const state = await db.query<{ config: number; slots: number; mode: string; dated: number }>(`
      SELECT (SELECT count(*)::int FROM public.content_plan_config) config,
             (SELECT count(*)::int FROM public.content_plan_slots) slots,
             (SELECT mode FROM public.content_autopilot_config WHERE account='swishdm') mode,
             (SELECT count(*)::int FROM public.carousel_drafts WHERE scheduled_at IS NOT NULL OR published_at IS NOT NULL) dated`)
    expect(state.rows[0]).toEqual({ config: 0, slots: 0, mode: 'off', dated: 0 })
    await db.exec(rollback)
    const left = await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname IN ('content_plan_week_onboarding','cb51_decision_history_onboarding')`)
    expect(left.rows[0].n).toBe(0)
    await db.close()
  })
})
