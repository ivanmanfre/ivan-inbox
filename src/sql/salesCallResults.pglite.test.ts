import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync('db/20261119c_sales_call_results.sql', 'utf8')

it('lists past Ivan bookings with their own outcomes and restricts reads to the owner', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION public.content_owner_ok_ivan() RETURNS boolean LANGUAGE sql
        AS $$ SELECT current_setting('test.ivan_owner', true) = 'yes' $$;
      CREATE TABLE public.booking_attributions (
        meeting_id text, client_id text, meeting_start timestamptz, meeting_title text,
        booker_name text, meeting_outcome text, prospect_id uuid
      );
      CREATE TABLE public.post_call_followups (meeting_id text, client_id text, status text);
      INSERT INTO public.booking_attributions VALUES
        ('old', 'ivan', now() - interval '2 days', 'Sales meeting', 'Prospect A', 'HELD', null),
        ('missed', 'ivan', now() - interval '1 day', 'Sales meeting', 'Prospect B', 'NO_SHOW', null),
        ('unknown', 'ivan', now() - interval '1 hour', 'Another meeting', ' ', null, null),
        ('next', 'ivan', now() + interval '1 day', 'Sales meeting', 'Prospect C', null, null),
        ('other', 'arch', now() - interval '1 hour', 'Sales meeting', 'Other lane', 'HELD', null);
      INSERT INTO public.post_call_followups VALUES ('old', 'ivan', 'won'), ('missed', 'arch', 'lost');
    `)
    await db.exec(migration)
    await db.exec('SET ROLE anon')
    await expect(db.query('SELECT public.inbox_sales_call_results()')).rejects.toMatchObject({ code: '42501' })
    await db.exec('SET ROLE authenticated')
    await expect(db.query('SELECT public.inbox_sales_call_results()')).rejects.toMatchObject({ code: '42501' })

    await db.exec("SET test.ivan_owner = 'yes'")
    const { rows } = await db.query<{ results: unknown[] }>('SELECT public.inbox_sales_call_results() results')
    expect(rows[0].results).toEqual([
      expect.objectContaining({ meeting_id: 'unknown', name: 'Another meeting', deal_status: null, outcome: null }),
      expect.objectContaining({ meeting_id: 'missed', deal_status: null, outcome: 'NO_SHOW' }),
      expect.objectContaining({ meeting_id: 'old', deal_status: 'won', outcome: 'HELD' }),
    ])
  } finally {
    await db.close()
  }
}, 30_000)
