-- db/298g (2026-10-30): profile-view warm signals, the three open items after 298f.
--   1. Their reply retires every unsent view draft for that person at once: on the inbound insert, and on the prospect's
--      reply / booked stamps (last_reply_at, reply_count, call_booked_at, a replied stage). Before this, an approved view
--      draft was only retired when another draft became sendable (pv_view_draft_arbiter).
--   2. Senders refuse a view draft written before their reply: Send Messages calls pv_draft_send_check() right after its
--      claim (it releases the claim and retires the row); swishdm_claim_send() (SwishDM DM + InMail senders) refuses and
--      retires it at the claim.
--   3. The arbiter refuses to approve a view draft they already answered.
--   4. ARCH profile-view rows staged from a view older than the 7-day window (the lane's LOOKBACK_DAYS and the drafter's
--      route window), with nothing approved, sent or written, are retired: stage skipped, skip_reason pv_stale_view,
--      enrichment_data.pv_retired records why. The lane's ARCH staging only stages views inside the window from now on.

-- a reply (any inbound row, reactions included) or a reply / booked stamp later than the draft
create or replace function public.pv_reply_after_draft(p_prospect uuid, p_draft_created timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from outreach_messages i
                  where i.prospect_id = p_prospect and i.direction = 'inbound'
                    and (i.created_at > p_draft_created or i.sent_at > p_draft_created))
      or exists (select 1 from outreach_prospects p
                  where p.id = p_prospect
                    and (p.last_reply_at > p_draft_created or p.call_booked_at > p_draft_created));
$$;

-- retire every unsent view draft for the person written up to p_before (approved or still held for review)
create or replace function public.pv_retire_view_drafts(p_prospect uuid, p_before timestamptz, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update outreach_messages d
     set approved_at = null, send_blocked_reason = p_reason, send_blocked_at = now()
   where d.prospect_id = p_prospect and d.direction = 'outbound'
     and d.ai_model in ('pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
     and d.sent_at is null and d.unipile_message_id is null
     and d.created_at <= p_before
     and (d.send_blocked_reason is null or d.send_blocked_reason = 'awaiting_client_review'
          or d.send_blocked_reason like 'lint\_%' escape '\' or d.send_blocked_reason like 'post\_approval\_race:%' escape '\');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.pv_retire_on_reply_msg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.prospect_id is not null then
    perform pv_retire_view_drafts(NEW.prospect_id, now(), 'pv_superseded_by_reply');
  end if;
  return NEW;
end $$;

drop trigger if exists pv_retire_on_reply_ins on public.outreach_messages;
create trigger pv_retire_on_reply_ins after insert on public.outreach_messages
for each row when (NEW.direction = 'inbound') execute function public.pv_retire_on_reply_msg();

create or replace function public.pv_retire_on_reply_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pv_retire_view_drafts(NEW.id, now(), 'pv_superseded_by_reply');
  return NEW;
end $$;

drop trigger if exists pv_retire_on_reply_stamp on public.outreach_prospects;
create trigger pv_retire_on_reply_stamp after update of last_reply_at, reply_count, call_booked_at, stage on public.outreach_prospects
for each row when (
  (NEW.last_reply_at is not null and NEW.last_reply_at is distinct from OLD.last_reply_at)
  or coalesce(NEW.reply_count, 0) > coalesce(OLD.reply_count, 0)
  or (NEW.call_booked_at is not null and OLD.call_booked_at is null)
  or (NEW.stage is distinct from OLD.stage
      and NEW.stage in ('replied', 'positive_reply', 'booked', 'call_booked', 'swishdm_replied', 'inbound_request_dm'))
) execute function public.pv_retire_on_reply_stamp();

-- Send Messages, right after its claim (sent_at = p_claimed_at). ok=false means: do not send. A refused claim is released
-- here (sent_at back to null) unless the row is no longer ours; a row they answered is retired.
create or replace function public.pv_draft_send_check(p_message_id uuid, p_claimed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m outreach_messages%rowtype; pid uuid;
begin
  -- prospect first, then the message: the same lock order as the reply-stamp trigger and swishdm_claim_send
  select prospect_id into pid from outreach_messages where id = p_message_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from outreach_prospects where id = pid for no key update;
  select * into m from outreach_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if m.ai_model is null or m.ai_model not in ('pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1') then
    return jsonb_build_object('ok', true);
  end if;
  if m.unipile_message_id is not null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;
  if p_claimed_at is null or m.sent_at is distinct from p_claimed_at then
    return jsonb_build_object('ok', false, 'reason', 'claim_mismatch');
  end if;
  if m.approved_at is null or m.send_blocked_reason is not null or m.send_blocked_at is not null then
    update outreach_messages set sent_at = null where id = m.id;
    -- the claim's backstop stamp (outreach_dm_dupe_guard) is undone: nothing went out
    update outreach_prospects set last_dm_sent_at = null where id = m.prospect_id and last_dm_sent_at = p_claimed_at;
    return jsonb_build_object('ok', false, 'reason', 'pv_not_sendable');
  end if;
  if pv_reply_after_draft(m.prospect_id, m.created_at) then
    update outreach_messages
       set sent_at = null, approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now()
     where id = m.id;
    update outreach_prospects set last_dm_sent_at = null where id = m.prospect_id and last_dm_sent_at = p_claimed_at;
    return jsonb_build_object('ok', false, 'reason', 'pv_superseded_by_reply');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 298f arbiter + the view-draft branch also refuses an approval after their reply
create or replace function public.pv_view_draft_arbiter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pv_models constant text[] := array['pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1'];
  v_pv outreach_messages%rowtype;
  -- scripted sequence steps and automated first touches (measured 30-day outbound models, 2026-10-30); anything else
  -- (replies, manual, hand, operator, null) is a person answering a person
  scripted constant text := '^(content_system_|rise_dm[0-9]|arch_dm[0-9]|arch_nudge|ivan_eh_sequence|recycle_|template/|swishdm_search_|swishdm_auto_|swishdm_inmail|swishdm_first_list|swishdm_reply_followup_v1|pre_dm1_|lm_gate_|stall_bump|[a-z]+_stall_bump|[a-z]+_cameback_followup)';
begin
  if NEW.direction is distinct from 'outbound' or NEW.message_type not in ('dm', 'inmail') or NEW.prospect_id is null
     or NEW.sent_at is not null or NEW.approved_at is null or NEW.send_blocked_at is not null or NEW.send_blocked_reason is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.approved_at is not null and OLD.send_blocked_at is null and OLD.send_blocked_reason is null then
    return NEW;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pv_view_draft_arbiter:' || NEW.prospect_id::text, 0));
  if NEW.ai_model = any(pv_models) then
    if exists (select 1 from outreach_messages o
               where o.prospect_id = NEW.prospect_id and o.id <> NEW.id and o.direction = 'outbound'
                 and o.message_type in ('dm', 'inmail')
                 and (o.created_at > NEW.created_at or o.sent_at > NEW.created_at
                      or (o.sent_at is null and o.approved_at is not null and o.send_blocked_at is null and o.send_blocked_reason is null))) then
      raise exception 'The sequence wrote to them after this draft. Refresh: the draft will be retired.' using errcode = 'P0001';
    end if;
    -- 298g: they wrote back (or booked) after this draft was written
    if pv_reply_after_draft(NEW.prospect_id, NEW.created_at) then
      raise exception 'They wrote back after this draft. Refresh: the draft is retired.' using errcode = 'P0001';
    end if;
    return NEW;
  end if;
  -- the latest view draft that is either waiting approved, or a sent came-back touch inside 45 days
  select o.* into v_pv from outreach_messages o
   where o.prospect_id = NEW.prospect_id and o.id <> NEW.id and o.direction = 'outbound' and o.ai_model = any(pv_models)
     and ((o.sent_at is null and o.approved_at is not null and o.send_blocked_at is null and o.send_blocked_reason is null)
          or (o.ai_model = 'pv_cameback_followup_v1' and o.sent_at > now() - interval '45 days')
          -- Sol r5: a view draft retired by their reply keeps guarding, so every later stale step still meets the
          -- inbound check (a second stale writer, or a reply approved first)
          or (o.sent_at is null and o.send_blocked_reason = 'pv_superseded_by_reply' and o.created_at > now() - interval '45 days'))
   order by o.created_at desc limit 1;
  if v_pv.id is null then return NEW; end if;
  if exists (select 1 from outreach_messages i
             where i.prospect_id = NEW.prospect_id and i.direction = 'inbound'
               and coalesce(i.sent_at, i.created_at) > coalesce(v_pv.sent_at, v_pv.created_at)) then
    -- Sol r4: they wrote after the view draft (or after the view touch went out). The unsent view draft is retired; a
    -- reply goes through; a scripted step drafted from an earlier read is held (the reply owns the thread now).
    if v_pv.sent_at is null then
      update outreach_messages set approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now()
       where id = v_pv.id and sent_at is null;
    end if;
    if coalesce(NEW.ai_model, '') ~ scripted then
      NEW.approved_at := null;
      NEW.send_blocked_reason := 'pv_stale_step_after_reply';
      NEW.send_blocked_at := now();
    end if;
    return NEW;
  end if;
  NEW.approved_at := null;
  NEW.send_blocked_reason := case when v_pv.sent_at is null then 'pv_view_draft_approved' else 'pv_view_touch_sent' end;
  NEW.send_blocked_at := now();
  return NEW;
end $$;

-- live swishdm_claim_send (2026-10-28 Sol r2) + 298g: a view draft they already answered is refused and retired here
create or replace function public.swishdm_claim_send(p_msg uuid, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare m outreach_messages%rowtype; c jsonb; p outreach_prospects%rowtype; hold_reason text; pid uuid;
begin
  -- 2026-10-28 (Sol r2): the prospect is locked FIRST (FOR SHARE: waits for an in-flight niche / skip write, then reads it),
  -- the same lock order as swishdm_carry_approve_dm1 and swishdm_release_stamp; the message's prospect is re-checked
  select prospect_id into pid from outreach_messages where id = p_msg;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into p from outreach_prospects where id = pid for share;
  select * into m from outreach_messages where id = p_msg for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if m.prospect_id is distinct from pid then return jsonb_build_object('ok', false, 'reason', 'prospect_changed'); end if;
  if coalesce(m.draft_evidence->>'lane', '') not like 'swishdm\_%' then return jsonb_build_object('ok', false, 'reason', 'not_swishdm'); end if;
  if m.direction is distinct from 'outbound' then return jsonb_build_object('ok', false, 'reason', 'not_outbound'); end if;
  hold_reason := swishdm_pitch_hold_reason(p.name,p.enrichment_data,p.connection_sent_at);
  if hold_reason is not null and (hold_reason='manual_do_not_pitch_person'
    or coalesce(m.draft_evidence->>'lane','') <> 'swishdm_reply') then
    return jsonb_build_object('ok',false,'reason',hold_reason);
  end if;
  if m.sent_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;
  if m.send_blocked_reason is not null then return jsonb_build_object('ok', false, 'reason', 'held'); end if;
  if m.approved_at is null then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if jsonb_typeof(m.draft_evidence->'send_claim') = 'object' then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'claim', m.draft_evidence->'send_claim');
  end if;
  -- 298g (2026-10-30): a profile-view draft written before their reply (or booking) is retired here, never sent
  if m.ai_model in ('swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1', 'pv_dm1_v1', 'pv_cameback_followup_v1')
     and pv_reply_after_draft(m.prospect_id, m.created_at) then
    update outreach_messages set approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now() where id = p_msg;
    return jsonb_build_object('ok', false, 'reason', 'pv_superseded_by_reply');
  end if;
  -- 2026-10-28: a first touch (invite note, DM1, InMail) to a prospect niche-held or skipped in review is held here, at the
  -- last read before LinkedIn; held (not just refused) so it leaves the sender's queue
  if coalesce(m.draft_evidence->>'lane', '') in ('swishdm_first_list', 'swishdm_inmail') then
    hold_reason := case
      when p.enrichment_data->'swishdm_auto' ? 'niche_hold' or p.enrichment_data->'swishdm_auto'->'score'->>'niche' = 'out' then 'client_niche_excluded'
      when p.enrichment_data->'swishdm_review'->'jonathan'->>'decision' = 'skip' or p.enrichment_data->'swishdm_review'->'ivan'->>'decision' = 'skip' then 'skipped_in_review'
      else null end;
    if hold_reason is not null then
      update outreach_messages set approved_at = null, send_blocked_reason = hold_reason || ': at send claim', send_blocked_at = now() where id = p_msg;
      return jsonb_build_object('ok', false, 'reason', hold_reason);
    end if;
  end if;
  c := jsonb_build_object('at', clock_timestamp(), 'by', coalesce(nullif(p_by, ''), 'unknown'));
  update outreach_messages set draft_evidence = coalesce(draft_evidence, '{}'::jsonb) || jsonb_build_object('send_claim', c) where id = p_msg;
  return jsonb_build_object('ok', true, 'claim', c);
end $$;

revoke all on function public.pv_reply_after_draft(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.pv_retire_view_drafts(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.pv_retire_on_reply_msg() from public, anon, authenticated;
revoke all on function public.pv_retire_on_reply_stamp() from public, anon, authenticated;
revoke all on function public.pv_draft_send_check(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pv_draft_send_check(uuid, timestamptz) to service_role;
revoke all on function public.pv_view_draft_arbiter() from public, anon, authenticated;
revoke all on function public.swishdm_claim_send(uuid, text) from public, anon, authenticated;
grant execute on function public.swishdm_claim_send(uuid, text) to service_role;

-- backfill: view drafts already answered (0 rows on 2026-10-30)
select m.id, pv_retire_view_drafts(m.prospect_id, m.created_at, 'pv_superseded_by_reply') as retired
  from outreach_messages m
 where m.ai_model in ('pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
   and m.sent_at is null and m.unipile_message_id is null
   and pv_reply_after_draft(m.prospect_id, m.created_at);

-- stale ARCH view rows: staged at ballot_hold from a view already older than 7 days, no view inside the window now,
-- nothing approved, sent or written
with stale as (
  select p.id, coalesce((p.enrichment_data->>'viewed_at')::timestamptz, p.created_at) as viewed_at
    from outreach_prospects p
    join outreach_campaigns c on c.id = p.campaign_id
   where c.client_id = 'arch' and p.trigger_type = 'profile_view' and p.stage = 'ballot_hold'
     and p.connection_sent_at is null and p.connected_at is null
     and p.enrichment_data->>'signal_approved_at' is null
     and not exists (select 1 from outreach_messages m where m.prospect_id = p.id)
     and coalesce((p.enrichment_data->>'viewed_at')::timestamptz, p.created_at) < now() - interval '7 days'
     -- the bug: staged from a view that was already older than the window (a row staged fresh that aged is left alone)
     and p.created_at - (p.enrichment_data->>'viewed_at')::timestamptz > interval '7 days'
     and not exists (select 1 from profile_view_log l
                      where l.seat = 'arch'
                        and (l.prospect_id = p.id or 'https://www.linkedin.com/in/' || l.viewer_public_id = p.linkedin_url)
                        and coalesce(l.viewed_at, l.captured_at) >= now() - interval '7 days')
)
update outreach_prospects p
   set stage = 'skipped',
       skip_reason = 'pv_stale_view: staged from a profile view older than 7 days; nothing approved or sent',
       updated_at = now(),
       enrichment_data = coalesce(p.enrichment_data, '{}'::jsonb) || jsonb_build_object('pv_retired', jsonb_build_object(
         'at', now(), 'by', 'db/298g', 'from_stage', 'ballot_hold', 'viewed_at', s.viewed_at, 'window_days', 7,
         'why', 'only view older than the 7-day window when staged; no approval, invite, DM or draft existed'))
  from stale s
 where p.id = s.id
returning p.id, p.name, s.viewed_at;
