-- operator_client_ideas: carry the DECLARED funnel stage.
--
-- Ivan, 2026-08-23, on the client lanes' new Ideas tab: "should we categorise
-- it by top funnel, bottom funnel, mid funnel? Should we do it from here, or
-- wait till it's generated?"
--
-- It is ALREADY categorised here, and it already travels. The ingestor stages
-- `funnel_stage` on the row (147 of the 183 staged rows carry one: reach 69 ·
-- trust 60 · buyers 18 · none 36) and the generation kickoff copies it onto the
-- draft verbatim, with `funnel_source='declared'` (n8n FsuRkf1owG1QpcyD). So
-- the tag the post ships with is decided at STAGING, and the one surface that
-- could not see it was this RPC — which selected eleven columns and not that
-- one. Ivan was being asked to approve a stage he could not read.
--
-- ADDITIVE ONLY. The function body is unchanged except for the extra key, the
-- signature is identical, and the other consumer (personal-site Client Ops,
-- clientops2/shared.tsx:501) maps the payload onto a typed interface that
-- ignores keys it does not name. Nothing that reads this today can break on it.
CREATE OR REPLACE FUNCTION public.operator_client_ideas(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare out jsonb;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select jsonb_agg(jsonb_build_object(
    'id', i.id, 'hook', i.hook, 'title', i.title, 'source_label', i.source_label,
    'source_ref', i.source_ref, 'pillar', i.pillar, 'format', i.format,
    'status', i.status, 'created_at', i.created_at,
    'icp_score', i.icp_score, 'score_breakdown', i.score_breakdown,
    'funnel_stage', i.funnel_stage, 'funnel_source', i.funnel_source,
    'agent_log', coalesce(i.agent_log, '[]'::jsonb)
  ) order by i.icp_score desc nulls last, i.created_at desc) into out
  from client_ideas i
  where i.client_id = p_client_id and i.status = 'staged';
  return jsonb_build_object('ok', true, 'ideas', coalesce(out, '[]'::jsonb));
end; $function$;

-- The grants a CREATE OR REPLACE preserves are re-stated rather than assumed:
-- `authenticated` is what both the dashboard and the workbench sign in as, and
-- `anon` has never been able to call this.
REVOKE EXECUTE ON FUNCTION public.operator_client_ideas(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_client_ideas(text, text) TO authenticated, service_role;
