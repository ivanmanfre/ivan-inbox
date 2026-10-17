import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const approvalSql = readFileSync('db/291_rise_carousel_approval.sql', 'utf8').split('-- Expose the planned value')[0]
const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.client_ideas(id uuid PRIMARY KEY, client_id text, status text, format text, planned_format text, eligible_at timestamptz, approved_at timestamptz);
    INSERT INTO public.client_ideas VALUES
      ('${id(1)}','risedtc','staged','post',null,null,null),
      ('${id(2)}','arch','staged','post',null,null,null),
      ('${id(3)}','risedtc','approved','post',null,null,null),
      ('${id(4)}','risedtc','staged','post',null,now() + interval '1 day',null);
    CREATE FUNCTION public.operator_gate_ok(p_gate text) RETURNS boolean LANGUAGE sql AS $$ SELECT p_gate = 'valid' $$;
    CREATE FUNCTION public.operator_approve_idea(p_gate text, p_idea_id uuid, p_decision text)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE r public.client_ideas%rowtype;
      BEGIN
        IF NOT public.operator_gate_ok(p_gate) THEN RETURN jsonb_build_object('ok',false,'error','bad_gate'); END IF;
        IF p_decision = 'approved' AND EXISTS(SELECT 1 FROM public.client_ideas WHERE id=p_idea_id AND eligible_at>now()) THEN
          RETURN jsonb_build_object('ok',false,'error','not_eligible_yet');
        END IF;
        UPDATE public.client_ideas SET status=p_decision, approved_at=CASE WHEN p_decision='approved' THEN now() ELSE approved_at END
          WHERE id=p_idea_id AND status='staged' RETURNING * INTO r;
        IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found_or_not_staged'); END IF;
        RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.status);
      END $$;
  `)
  await db.exec(approvalSql)
  return db
}

async function decide(db: PGlite, n: number, gate: string, decision: string, format: string) {
  const r = await db.query<{ result: { ok: boolean; error?: string } }>(
    `SELECT public.operator_approve_rise_idea_format($1,$2::uuid,$3,$4) result`, [gate, id(n), decision, format])
  return r.rows[0].result
}

describe('RISE format approval SQL', { timeout: 30_000 }, () => {
  it('rejects bad gate, decision, format, client, stage, and eligibility without changing rows', async () => {
    const db = await fixture()
    expect(await decide(db, 1, 'wrong', 'approved', 'carousel')).toMatchObject({ ok: false, error: 'bad_gate' })
    expect(await decide(db, 1, 'valid', 'maybe', 'carousel')).toMatchObject({ ok: false, error: 'bad_decision' })
    expect(await decide(db, 1, 'valid', 'approved', 'video')).toMatchObject({ ok: false, error: 'bad_format' })
    expect(await decide(db, 2, 'valid', 'approved', 'carousel')).toMatchObject({ ok: false, error: 'not_found_or_not_staged' })
    expect(await decide(db, 3, 'valid', 'approved', 'carousel')).toMatchObject({ ok: false, error: 'not_found_or_not_staged' })
    expect(await decide(db, 4, 'valid', 'approved', 'carousel')).toMatchObject({ ok: false, error: 'not_eligible_yet' })
    const rows = await db.query<{ status: string; format: string; planned_format: string | null }>(`SELECT status,format,planned_format FROM public.client_ideas ORDER BY id`)
    expect(rows.rows).toEqual([
      { status: 'staged', format: 'post', planned_format: null },
      { status: 'staged', format: 'post', planned_format: null },
      { status: 'approved', format: 'post', planned_format: null },
      { status: 'staged', format: 'post', planned_format: null },
    ])
    await db.close()
  })

  it('stores the selected format in both columns only on a successful RISE approval', async () => {
    const db = await fixture()
    expect(await decide(db, 1, 'valid', 'approved', 'carousel')).toMatchObject({ ok: true, status: 'approved' })
    const row = await db.query<{ status: string; format: string; planned_format: string; approved_at: string }>(`SELECT status,format,planned_format,approved_at FROM public.client_ideas WHERE id='${id(1)}'`)
    expect(row.rows[0]).toMatchObject({ status: 'approved', format: 'carousel', planned_format: 'carousel' })
    expect(row.rows[0].approved_at).toBeTruthy()
    await db.close()
  })

  it('rejects a RISE idea through the existing decision without changing its format', async () => {
    const db = await fixture()
    expect(await decide(db, 1, 'valid', 'rejected', 'carousel')).toMatchObject({ ok: true, status: 'rejected' })
    const row = await db.query<{ status: string; format: string; planned_format: string | null }>(`SELECT status,format,planned_format FROM public.client_ideas WHERE id='${id(1)}'`)
    expect(row.rows[0]).toEqual({ status: 'rejected', format: 'post', planned_format: null })
    await db.close()
  })
})
