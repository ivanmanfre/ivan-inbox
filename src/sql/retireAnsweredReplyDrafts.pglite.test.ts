import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// db/240: a pending reply draft retires itself once a send answers the thread (Zahira Odimayo,
// 2026-10-08), and nothing else does.
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const at = (min: number) => `timestamptz '2026-10-08 15:00:00+00' + interval '${min} minutes'`

it('retires only answered reply drafts, on the send that answers them', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated;
      create table outreach_messages(id text primary key, prospect_id uuid, direction text, message_type text, channel text,
        ai_model text, created_at timestamptz, sent_at timestamptz, approved_at timestamptz, send_blocked_at timestamptz,
        send_blocked_reason text, discard_mode text, is_reaction boolean);`)
    await db.exec(readFileSync('db/240_retire_answered_reply_drafts.sql', 'utf8'))
    const row = (id: string, dir: string, type: string, model: string | null, created: number, sent: number | null, extra = '') =>
      db.exec(`insert into outreach_messages(id,prospect_id,direction,message_type,channel,ai_model,created_at,sent_at${extra ? ',' + extra.split('=')[0] : ''})
        values('${id}','${P}','${dir}','${type}',${type === 'email' ? "'email'" : "'linkedin'"},${model ? `'${model}'` : 'null'},${at(created)},${sent === null ? 'null' : at(sent)}${extra ? ',' + extra.split('=')[1] : ''})`)
    const state = async (id: string) => (await db.query<{ r: string | null; m: string | null }>(`select send_blocked_reason r, discard_mode m from outreach_messages where id='${id}'`)).rows[0]

    await row('in1', 'inbound', 'dm', null, 22, 22)
    // Zahira: two reply drafters answered the same message a minute apart.
    await row('ondemand', 'outbound', 'dm', 'inbox_on_demand_reply', 30, null)
    await row('rise', 'outbound', 'dm', 'rise_reply_draft_v1', 31, null)
    // Left alone: a follow-up, a scan delivery, an email leg, a hand-written draft.
    await row('bump', 'outbound', 'dm', 'stall_bump_v2', 30, null)
    await row('scan', 'outbound', 'dm', 'rise_dm2_scan_delivery_v1', 30, null)
    await row('mail', 'outbound', 'email', 'rise_reply_email_v1', 30, null)
    await row('hand', 'outbound', 'dm', 'rise_reply_manual_ivan', 30, null)

    // A reaction is not an answer.
    await row('react', 'outbound', 'dm', null, 33, 33, 'is_reaction=true')
    expect((await state('ondemand')).r).toBeNull()

    // The Rise draft is approved and sent at 36: that send answers the 22 message.
    await db.exec(`update outreach_messages set approved_at=${at(34)}, sent_at=${at(36)} where id='rise'`)
    expect(await state('ondemand')).toEqual({ r: 'discarded_in_inbox', m: 'answered_by_send' })
    expect((await state('rise')).r).toBeNull()
    for (const id of ['bump', 'scan', 'mail', 'hand']) expect((await state(id)).r, id).toBeNull()

    // A draft written after the send is not retired by it.
    await row('late', 'outbound', 'dm', 'arch_reply_draft_v2', 40, null)
    expect((await state('late')).r).toBeNull()

    // A newer inbound arrives; a send that predates it (a late mirror of an older message) retires nothing.
    await row('in2', 'inbound', 'dm', null, 50, 50)
    await row('draft2', 'outbound', 'dm', 'rise_reply_draft_v1', 51, null)
    await row('oldmirror', 'outbound', 'manual_reply', 'manual_mirror', 52, 45)
    expect((await state('draft2')).r).toBeNull()

    // A reply typed by hand on LinkedIn and mirrored in (inserted already sent) does answer it.
    await row('typed', 'outbound', 'manual_reply', 'manual_mirror', 55, 55)
    expect(await state('draft2')).toEqual({ r: 'discarded_in_inbox', m: 'answered_by_send' })
    expect((await state('late')).r).toBe('discarded_in_inbox')

    // No inbound before it: an opener draft is never a reply, whatever its model says.
    const Q = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await db.exec(`insert into outreach_messages(id,prospect_id,direction,message_type,channel,ai_model,created_at,sent_at) values
      ('cold','${Q}','outbound','dm','linkedin','pre_dm1_answer_v1',${at(10)},null),
      ('cold-sent','${Q}','outbound','dm','linkedin','dm1_v3',${at(5)},${at(12)})`)
    expect((await state('cold')).r).toBeNull()

    expect((await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','public.retire_answered_reply_drafts()','execute') ok")).rows[0].ok).toBe(false)
  } finally { await db.close() }
}, 30_000)
