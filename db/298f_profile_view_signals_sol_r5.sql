-- Sol r5: the arbiter (r4 + a reply-retired view draft keeps guarding).
-- Sol r4: the arbiter (r3 + inbound compared to the send time; a stale scripted step stays held after a reply).
--   view draft (pv_*) becoming sendable: refused when another outbound was written or sent after it, or another
--     sendable one exists (unchanged).
--   any other draft becoming sendable:
--     the person wrote to us after the latest view draft -> it is a conversation: the reply goes through, and a still
--       unsent view draft is retired (pv_superseded_by_reply);
--     else an approved unsent view draft waits, or a view next-touch (pv_cameback_followup_v1) was SENT in the last
--       45 days -> held (pv_view_draft_approved / pv_view_touch_sent): the view draft took that step, and a sent
--       came-back touch ends the scripted ladder (the sequencers' own 09-24 rule, repeated here for a writer that read
--       before the send).
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

revoke all on function public.pv_view_draft_arbiter() from public, anon, authenticated;
