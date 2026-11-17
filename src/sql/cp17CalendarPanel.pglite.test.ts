import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('db/20261117r_cp17_calendar_panel.sql', 'utf8')

// In-process database with stub tables and invented rows only.
async function db() {
  const d = new PGlite()
  await d.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.outreach_agent_accounts(client_id text, operator_ids uuid[]);
    CREATE TABLE public.carousel_drafts(id uuid primary key, taxonomy jsonb);
    CREATE TABLE public.content_plan_slots(id uuid primary key, account text, week_start date, status text, belief smallint, vehicle text, placed_draft_id uuid);
    CREATE TABLE public.content_plan_quotas(id serial, account text, slot_kind text, belief smallint, vehicle text, per_week numeric, every_n_weeks int, note text);
    CREATE TABLE public.integration_config(key text, value text);
    CREATE TABLE public.cp17_post_profile_views_ivan(posted_at timestamptz, first_line text, kind text, deleted boolean, contacted_viewers_48h int, contacted_fit_viewers_48h int, contacted_fit_known_48h int, baseline_per_48h numeric, window_open boolean);
    CREATE TABLE public.cp17_top_of_feed_cohorts_ivan(filter_key text, campaign_name text, period_from date, period_to date, top_post_kind text, top_belief smallint, top_vehicle text, invites int, accept_base int, accepts int, reply_base int, replies int, booking_base int, bookings int, accept_rate numeric, reply_rate numeric, booking_rate numeric, small_n boolean, comparable boolean);
    CREATE TABLE public.cp17_booking_reasons(call_date timestamptz, reason_class text, quote text);
    CREATE FUNCTION public.cp17_profile_first_ivan() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"score":"0 of 3"}'::jsonb $$;
  `)
  await d.exec(migration)
  return d
}

type Panel = { slots: { slot_id: string }[]; week_fill: { slots: number }[]; cohorts: { rows: { comparable: boolean | null; accept_rate: number | null }[] } }

describe('db/20261117r calendar panel', { timeout: 30_000 }, () => {
  it('counts only active slots toward the week: planned 1, superseded and dropped 0', async () => {
    const d = await db()
    const monday = (await d.query<{ m: string }>(`SELECT date_trunc('week', now() at time zone 'Europe/Warsaw')::date::text m`)).rows[0].m
    await d.exec(`INSERT INTO public.content_plan_slots(id, account, week_start, status) VALUES
      ('00000000-0000-4000-8000-0000000000d1','ivan','${monday}','planned'),
      ('00000000-0000-4000-8000-0000000000d2','ivan','${monday}','superseded'),
      ('00000000-0000-4000-8000-0000000000d3','ivan','${monday}','dropped')`)
    const r = (await d.query<{ j: Panel }>(`SELECT public.cp17_calendar_panel_ivan() j`)).rows[0].j
    expect(r.slots.map(s => s.slot_id)).toEqual(['00000000-0000-4000-8000-0000000000d1'])
    expect(r.week_fill[0].slots).toBe(1)
  })

  it('passes the comparable flag and null rates through', async () => {
    const d = await db()
    await d.exec(`INSERT INTO public.cp17_top_of_feed_cohorts_ivan(filter_key, period_from, invites, accept_base, accepts, accept_rate, comparable)
      VALUES ('k|unstamped|x','2026-11-02',7,7,1,NULL,false)`)
    const r = (await d.query<{ j: Panel }>(`SELECT public.cp17_calendar_panel_ivan() j`)).rows[0].j
    expect(r.cohorts.rows[0].comparable).toBe(false)
    expect(r.cohorts.rows[0].accept_rate).toBeNull()
  })
})
