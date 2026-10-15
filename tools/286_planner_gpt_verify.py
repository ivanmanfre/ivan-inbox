#!/usr/bin/env python3
"""Verify real GPT replay -> existing DB release -> eligibility in a rolled-back clone.

No model calls, production rule changes, dates, or original content edits.
Usage: python3 tools/286_planner_gpt_verify.py [--replay PRIVATE_REPLAY_JSON]
Private inputs/outputs stay in ~/.local/state/planner-ideas-1015; stdout is a safe summary.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--replay', type=Path, default=Path.home()/'.local/state/planner-ideas-1015/replay-positive-gpt-6.1-sol.json')
args = parser.parse_args()
proof_dir = args.replay.parent
q_path = Path.home()/'.local/state/inbox-ux-1015-tools/q.sh'
replay = json.loads(args.replay.read_text())
frozen = json.loads((proof_dir/'preflight.json').read_text())[0]['proof']
original_id = frozen['pending']['draft_id']
candidate_id = frozen['member']['candidate_id']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sql_json(value, tag):
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    delimiter = '$' + tag + '$'
    if delimiter in raw:
        raise ValueError('SQL dollar delimiter appears in private value')
    return delimiter + raw + delimiter + '::jsonb'


def query(sql):
    proc = subprocess.run([str(q_path), sql], text=True, capture_output=True, check=True)
    result = json.loads(proc.stdout)
    if not isinstance(result, list):
        raise RuntimeError('Database returned an error; private details were not printed')
    return result


# Actual receipt provenance is required before any validation reaches the DB.
assert replay.get('judge_model') == 'gpt-6.1-sol'
assert len(replay['calls']) == 6
assert len(replay['writes']) == 1 and replay['writes'][0]['fn'] == 'cb51_brain_release_v3'
release_args = replay['writes'][0]['args']
assert replay['body_sha256'] == frozen['pending']['expected_body_sha256'] == release_args['p_expected_body_sha256']
assert release_args['p_expected_qa_sha256'] == frozen['pending']['expected_qa_sha256']
assert release_args['p_draft'] == original_id
assert sha(frozen['pending']['post_body'].encode()) == replay['body_sha256']
receipts = []
for index, call in enumerate(replay['calls']):
    assert call['request']['model'] == call['response']['model'] == 'gpt-6.1-sol'
    assert call['transport'] == 'codex-cli-chatgpt-subscription'
    receipt_file = Path(call['receipt'] + '.receipt.json')
    request_file = Path(call['receipt'] + '.request.json')
    response_file = Path(call['receipt'] + '.response.json')
    receipt = json.loads(receipt_file.read_text())
    assert receipt['model'] == receipt['requested_model'] == 'gpt-6.1-sol'
    assert receipt['transport'] == call['transport']
    actual = json.loads(''.join(block['text'] for block in call['response']['content'] if block['type'] == 'text'))
    assert actual == receipt['results'][0]['answer']
    assert frozen['pending']['post_body'] in call['request']['messages'][0]['content'] or json.dumps(frozen['pending']['post_body'], ensure_ascii=False) in call['request']['messages'][0]['content']
    receipts.append({'kind': 'invention' if index < 3 else 'narrow', 'model': receipt['model'],
                     'transport': receipt['transport'], 'receipt_sha256': sha(receipt_file.read_bytes()),
                     'request_sha256': sha(request_file.read_bytes()), 'response_sha256': sha(response_file.read_bytes())})
validation = copy.deepcopy(release_args['p_validation'])
old_model = validation['checks']['invention']['model']
assert old_model in ('claude-opus-5-5', 'gpt-6.1-sol')
# The original node had a hardcoded Claude metadata label. Only this provenance label changes.
# No flags, votes, checks, scores, or verdicts are synthesized or replaced.
validation['checks']['invention']['model'] = 'gpt-6.1-sol'
normalized_back = copy.deepcopy(validation)
normalized_back['checks']['invention']['model'] = old_model
assert normalized_back == release_args['p_validation']
for field in ('qa', 'lint', 'sameness', 'length', 'invention'):
    assert validation['checks'][field]['pass'] is True
assert validation['checks']['invention']['calls'] == 6
snapshot_sql = f"""SELECT jsonb_build_object(
 'original', (select encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') from public.carousel_drafts d where d.id='{original_id}'),
 'candidate', (select encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') from public.lm_idea_candidates c where c.id='{candidate_id}'),
 'functions', (select jsonb_object_agg(proname,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')) from pg_proc
 where pronamespace='public'::regnamespace and proname in ('content_plan_register_ivan_idea','content_plan_register_ivan_idea_tg','content_autopilot_candidates','content_plan_week','cb51_brain_release_v3','content_brain_eligibility')),
 'plan_members', (select count(*) from public.cb34_p2_members where run_id like 'cb35-plan-%')) AS state"""
before = query(snapshot_sql)[0]['state']
expected_source = sql_json(frozen['member']['brief'], '_286_source_')
validation_sql = sql_json(validation, '_286_validation_')
sql = f"""BEGIN;
CREATE TEMP TABLE planner_gpt_286_proof(proof jsonb) ON COMMIT DROP;
DO $test$
DECLARE c public.lm_idea_candidates%rowtype; d public.carousel_drafts%rowtype;
 ci uuid:=gen_random_uuid(); di uuid:=gen_random_uuid(); si uuid:=gen_random_uuid();
 wk date:=date_trunc('week',now() AT TIME ZONE 'Europe/Warsaw')::date+7;
 expected_brief jsonb:={expected_source}; actual_validation jsonb:={validation_sql};
 body_hash text; qa_hash text; reg jsonb; result jsonb; e jsonb; ac jsonb; st jsonb; rejected boolean:=false;
BEGIN
 SELECT * INTO STRICT c FROM public.lm_idea_candidates WHERE id='{candidate_id}' FOR SHARE;
 SELECT * INTO STRICT d FROM public.carousel_drafts WHERE id='{original_id}' FOR SHARE;
 body_hash:=encode(sha256(convert_to(d.post_body,'UTF8')),'hex');
 qa_hash:=encode(sha256(convert_to(d.qa::text,'UTF8')),'hex');
 IF body_hash IS DISTINCT FROM '{release_args['p_expected_body_sha256']}' OR qa_hash IS DISTINCT FROM '{release_args['p_expected_qa_sha256']}' THEN
   RAISE EXCEPTION 'Real source artifact changed after the genuine model replay'; END IF;
 INSERT INTO public.lm_idea_candidates(id,source,source_ref,raw_topic,post_angle,raw_context,evidence,content_type,status,workspace_type)
 VALUES(ci,c.source,c.source_ref,c.raw_topic,c.post_angle,c.raw_context,c.evidence,'post','reviewing','own');
 INSERT INTO public.content_plan_slots(id,account,week_start,kind,idea_source,idea_ref,topic,why_now,status)
 VALUES(si,'ivan',wk,'idea','lm_idea_candidates',ci::text,c.raw_topic,'real GPT verifier proof, rolled back','requested');
 INSERT INTO public.carousel_drafts(id,title,topic,type,status,post_body,qa,description,taxonomy)
 VALUES(di,d.title,d.topic,d.type,'review',d.post_body,d.qa,d.description,
 jsonb_build_object('source_candidate_id',ci,'source',c.source));
 UPDATE public.lm_idea_candidates SET promoted_draft_id=di,promoted_draft_table='carousel_drafts',status='promoted' WHERE id=ci;
 -- Source/fact scope must be identical to the real six model calls, despite new fixture identifiers.
 IF NOT EXISTS(SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id=di AND m.state='held'
   AND m.source_text=(select mm.source_text from jsonb_populate_record(null::public.cb34_p2_members,{sql_json(frozen['member'], '_286_member_')}) mm)
   AND m.brief->>'check_source'=expected_brief->>'check_source'
   AND m.brief->'brief_v3'=expected_brief->'brief_v3'
   AND m.brief#>'{{candidate_snapshot,evidence}}'=expected_brief#>'{{candidate_snapshot,evidence}}'
   AND m.brief#>'{{candidate_snapshot,raw_context}}'=expected_brief#>'{{candidate_snapshot,raw_context}}') THEN
   RAISE EXCEPTION 'Clone source/brief is not identical to the genuine replay source'; END IF;
 SELECT x INTO e FROM jsonb_array_elements(public.content_brain_eligibility('ivan',now(),ARRAY[di])) x;
 IF e->>'eligible' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'unreleased clone became eligible'; END IF;
 -- Deliberately synthetic API-guard test, not a model verdict: one required pass is false.
 BEGIN
   PERFORM public.cb51_brain_release_v3(di,jsonb_set(actual_validation,'{{checks,invention,pass}}','false'::jsonb),
     '286-synthetic-required-check-negative',body_hash,qa_hash,0);
 EXCEPTION WHEN others THEN
   IF SQLERRM LIKE '%requires four passing checks%' THEN rejected:=true; ELSE RAISE; END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'release accepted a failed required check'; END IF;
 -- Actual six-vote validation; only its model provenance label was normalized outside this transaction.
 result:=public.cb51_brain_release_v3(di,actual_validation,'286-real-gpt-six-vote-proof',body_hash,qa_hash,0);
 IF result->>'decision' IS DISTINCT FROM 'released' THEN RAISE EXCEPTION 'genuine validation not released: %',result; END IF;
 SELECT x INTO e FROM jsonb_array_elements(public.content_brain_eligibility('ivan',now(),ARRAY[di])) x;
 IF e->>'eligible' IS DISTINCT FROM 'true' OR e->'fails' IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'released clone not eligible: %',e->'fails'; END IF;
 SELECT x INTO ac FROM jsonb_array_elements(public.content_autopilot_candidates('ivan',wk)) x WHERE x->>'draft_id'=di::text;
 IF ac->>'eligible' IS DISTINCT FROM 'true' OR ac->>'plan_slot_id' IS DISTINCT FROM si::text
   OR (ac->>'planned_week')::date IS DISTINCT FROM wk THEN RAISE EXCEPTION 'eligible clone not mapped to its idea week'; END IF;
 st:=public.content_plan_week('ivan');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(st->'weeks') w,jsonb_array_elements(w->'planned') p
   WHERE p->>'slot_id'=si::text AND p->>'draft_id'=di::text AND p->>'status'='waiting_review') THEN
   RAISE EXCEPTION 'released clone missing from planned idea slot'; END IF;
 IF EXISTS(SELECT 1 FROM public.carousel_drafts WHERE id=di AND (scheduled_at IS NOT NULL OR published_at IS NOT NULL OR status<>'review')) THEN
   RAISE EXCEPTION 'proof altered a content date/status'; END IF;
 INSERT INTO planner_gpt_286_proof VALUES(jsonb_build_object('decision',result->>'decision','eligible',e->'eligible','fails',e->'fails',
   'fixture_draft_id',di,'fixture_candidate_id',ci,'fixture_slot_id',si,'planned_week',wk,'slot_resolved',true,'planner_status','waiting_review',
   'required_check_negative_rejected',rejected,'body_sha256',body_hash,'qa_sha256',qa_hash,'judge_model',actual_validation#>>'{{checks,invention,model}}',
   'judge_calls',actual_validation#>'{{checks,invention,calls}}','scheduled_at',null,'published_at',null));
END $test$;
SELECT proof FROM planner_gpt_286_proof;
ROLLBACK;
"""
(proof_dir/'286-real-gpt-release.sql').write_text(sql)
(proof_dir/'286-real-gpt-release.sql').chmod(0o600)
result = query(sql)[0]['proof']
after = query(snapshot_sql)[0]['state']
assert before == after, 'Original draft, original candidate, production functions, or live registration count changed'
# Verify rollback removed every fixture identifier (not merely its visible content row).
left = query(f"SELECT (select count(*) from public.carousel_drafts where id='{result['fixture_draft_id']}')+(select count(*) from public.lm_idea_candidates where id='{result['fixture_candidate_id']}')+(select count(*) from public.content_plan_slots where id='{result['fixture_slot_id']}')+(select count(*) from public.cb34_p2_members where draft_id='{result['fixture_draft_id']}') as rows")[0]['rows']
assert left == 0
full_proof = {'source_replay_sha256': sha(args.replay.read_bytes()), 'receipts': receipts,
              'normalization': {'path': 'checks.invention.model', 'from': old_model, 'to': 'gpt-6.1-sol', 'all_other_validation_fields_unchanged': True},
              'validation': validation, 'database_proof': result, 'before': before, 'after': after, 'fixture_rows_after_rollback': left}
(proof_dir/'286-real-gpt-release-proof.json').write_text(json.dumps(full_proof, indent=2)+'\n')
(proof_dir/'286-real-gpt-release-proof.json').chmod(0o600)
summary = {'result': 'PASS', 'model': 'gpt-6.1-sol', 'actual_model_calls': len(receipts),
           'release': result['decision'], 'eligible': result['eligible'], 'fails': result['fails'],
           'idea_slot_week_resolved': result['slot_resolved'], 'planner_status': result['planner_status'],
           'required_check_negative_rejected': result['required_check_negative_rejected'],
           'original_draft_and_candidate_unchanged': before == after, 'production_functions_unchanged': before['functions'] == after['functions'],
           'fixture_rows_after_rollback': left, 'scheduled_or_published': False,
           'normalization': full_proof['normalization'], 'body_sha256': result['body_sha256'],
           'source_replay_sha256': full_proof['source_replay_sha256'], 'receipt_sha256': [r['receipt_sha256'] for r in receipts]}
(proof_dir/'286-real-gpt-release-summary.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps(summary, indent=2))
