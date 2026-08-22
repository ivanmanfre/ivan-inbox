-- 🔴🔴 NOT APPLIED. SHIPPED AS A FILE ONLY. Nothing in the app calls this, and
-- nothing will until Ivan applies it, because a button pointed at a function
-- that does not exist is a button that 404s in front of a client's backlog.
--
-- WHY IT EXISTS AT ALL
--
-- Phase 4 item 3 asked for `skip` and `promote` on client review rows. Promote
-- shipped: `operator_set_board_visible` already exists and the app already calls
-- it. Skip did NOT ship, because there is no path to it in the data layer:
--
--   · skipDraft()              content.ts, scoped `.is('client_id', null)`.
--                              Pointed at a client row it matches nothing, and
--                              PostgREST answers a silent 204 to an UPDATE that
--                              RLS filtered away. That is a button that lies.
--   · operator_* RPCs          set_board_visible / edit_draft_body /
--                              schedule_draft / set_schedule_date. Not one of
--                              them writes `status`.
--   · deleteClientDraft()      does reach `status='disqualified'`, but only as
--                              the FALLBACK of a hard delete. Routing "skip"
--                              through the delete path would make the
--                              destructive action easier to reach, which is
--                              exactly what the phase forbids.
--
-- So the choice was between inventing a direct `update({status})` write against
-- a client's rows, or shipping nothing and saying so. Nothing shipped. This file
-- is the proposal, not the fix.
--
-- THE ONE RULE HERE THAT IS NOT COPIED FROM AN EXISTING FUNCTION
--
-- `board_visible` must be false. The client board's `queue` is a DENORMALISED
-- copy of the promoted drafts, and only operator_set_board_visible rebuilds it
-- (see clientDeletable in src/lib/content.ts). Disqualifying a promoted row
-- would drop it from our side while leaving a full copy of it on a paying
-- client's live board with nothing scheduled to clean it up. Same trap the
-- delete path already refuses; refused here for the same reason.
--
-- Gate, grant shape and refusal codes mirror db/032 exactly.

CREATE OR REPLACE FUNCTION public.operator_skip_client_draft(p_gate text, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare d carousel_drafts;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;

  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Client rows only. Ivan's lane has skipDraft() and does not come here.
  if d.client_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_client_draft');
  end if;

  -- Same predicate the promote RPC uses, so the two capabilities are offered on
  -- exactly the same set of rows and neither can be shown where the other is not.
  if d.status <> 'review' then
    return jsonb_build_object('ok', false, 'error', 'not_in_review', 'status', d.status);
  end if;

  -- The board-ghost guard. See the header.
  if coalesce(d.board_visible, false) then
    return jsonb_build_object('ok', false, 'error', 'on_client_board');
  end if;

  update carousel_drafts
     set status = 'disqualified',
         updated_at = now()
   where id = p_draft_id;

  return jsonb_build_object('ok', true, 'id', p_draft_id, 'status', 'disqualified');
end; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_skip_client_draft(text, uuid) FROM public, anon;
