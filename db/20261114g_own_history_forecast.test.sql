-- Always rolls back. Harness: begin; <migration body> <seed body>; this block; rollback.
-- py_asof = Python backtest predictions as of each niche forecast time (backtest2.py, capture-time availability).

do $t$
declare r jsonb; v_idea text; v_q jsonb; v_w jsonb; v_g jsonb; v_f1 uuid; v_f2 uuid; v_dig text; v_av0 timestamptz; v_av1 timestamptz; v_snap text; v_base_dig text; v_bav0 timestamptz; v_bav1 timestamptz;
begin
  select id::text into v_idea from public.client_ideas where client_id='risedtc' and status='staged' order by created_at desc limit 1;
  v_q := public.content_own_label_queue(40);
  v_w := public.content_own_label_write(jsonb_build_array(jsonb_build_object('key','client_ideas:'||v_idea,'source_kind','call_material','audience_lane','business','hook_shape','story','confidence','high','why','test'),
           jsonb_build_object('key','client_ideas:'||v_idea,'source_kind','nonsense','audience_lane','business'),
           jsonb_build_object('key','carousel_drafts:00000000-0000-0000-0000-000000000000','source_kind','hand','audience_lane','business')));
  v_f1 := public.content_own_forecast_record('client_ideas', v_idea);
  update public.content_own_outcomes set log_ratio = log_ratio + 0.5 where client_id = 'risedtc' and reading is not null;
  v_f2 := public.content_own_forecast_record('client_ideas', v_idea);
  v_g := public.content_own_forecast_grade('test-20261114');
  with py as (select key as draft_id, value::text::numeric as p from jsonb_each('{"7596cf26-db7a-4f11-b003-1504bc771dee": -0.3048742126629319, "1e723cef-50ae-488d-8240-68a01aee2290": 1.3821903407746374, "f4ee408f-861f-47b1-be2e-7254cb11b7ca": -0.370553687472205, "225998fd-c27c-4980-a8c6-8ea78a5a67c9": -0.5746763126027619, "96c93855-106d-5e87-9d44-8d059d49dd2a": 1.2120268850132097, "de9336b6-17dd-4722-8ad3-75b34fdffeb7": 1.0264061608649735, "03ea68d5-0c45-492d-b858-d82aea21e04a": -0.2922901845074923, "73d3fd79-a6b4-4251-a622-be1cef5df029": 1.0264061608649735, "18784917-4a9c-456b-bc3f-1a3e156317d5": -0.33439210542665593, "90e3965c-4433-4471-b1b1-8d1c5ba2dfca": -0.4687921838697391, "f23a3c92-d155-4e61-92b3-69659a588348": -0.371959695793173, "ca61ca1b-118b-4585-9fcf-23dd97b7b884": 1.0264061608649735, "8955fe06-3875-5bc2-81b7-a53124bacdd8": -0.5445969801624108, "ad6e04e2-ea0b-41ff-974e-d4b9730910b7": -0.18754491092269854, "9e46a7af-5bd4-4e52-835e-7a7ba1517ecf": 0.08171355353699664, "1aa967c9-fa94-5e43-83a2-cda0b9facb9f": 2.2719726886246683, "8403dbc5-3ed1-429e-832b-218ff54899e3": -0.4862939871617725, "aea39dbf-679e-4fec-84fa-793de5ba13aa": 0.03526360675588612, "f1446c26-b7e7-4195-9e83-1fca8108f82a": 0.08171355353699664, "b1dde8eb-30e6-4a9c-b3d3-933708416925": -0.3387859562842287, "e119e39e-cf0a-4ca6-9d08-31d491f8f36d": -0.4761178639912099, "118f7de7-f591-4daa-b632-c73d043cf689": -0.3387859562842287, "1fae5356-c979-46db-9173-d1f1d31ac8ac": -0.2270227645008906, "8887c794-4fc1-5b12-b0fc-763fa8256a9e": 0.03526360675588612, "2ce1315a-76df-4a93-acbc-5ae229099f55": 0.08171355353699664, "c53f1759-0cd2-4033-94d0-e34ae5f7e98e": -0.3387859562842287, "5c66e97e-123c-4ca4-b2fb-9727c8124896": -0.33026985444855816, "7272e27a-cd41-48cf-b85b-deddb27ef302": 0.08171355353699664, "ad6073de-80f1-39f9-5123-6e114730d4df": -0.3387859562842287, "e9966e70-994c-41ec-8eb3-bb6c9443282f": -0.0034333536826175737, "c2098060-29f4-4728-904a-f8edf1fe080d": -0.3387859562842287, "3bed996b-3b16-44ad-adc2-02addfb23241": 0.15473139529923866, "f0435946-44d0-48e6-88b0-92e2b3b142b7": -0.5434356267739995, "63dc11e7-a813-448f-8ae1-b6f8d4e4320e": -0.016815103348645492, "e92f4398-5233-5ab6-bb55-6430fed4ba26": 0.15473139529923866, "a3710f97-4c7d-4018-80b9-f037068a6844": -0.023737047035922387, "a7e7e4e4-1421-408f-9203-bca4ee64f264": 0.8475468356968068, "57863002-b9c6-45ae-880e-8ff905f247eb": -0.5476687124214377, "afc9ae79-3607-4c09-bbfa-8d6f32cd141f": 0.06508859959019227, "7b4e7461-19a5-4281-b3cb-91bf25bb1920": 0.8475468356968068, "b0b0c754-d65d-4f64-ac80-ddff53f0a9f5": 0.34330850186970463, "c3debf3b-6238-49ad-b39c-b26ab0f8e376": 0.23881234884623614, "2370ae6a-f9ea-4535-a6c2-738bd5e150a5": 0.34330850186970463, "a6059ce5-35f9-4d5b-afa7-36293a8957b7": -0.5087406118798042, "8287af2f-14ee-540a-8ec9-902670f0f285": -0.19569938178423074, "4468f9e7-df95-4fae-81c2-83dd37b72890": 0.23881234884623614, "b54800b6-25b8-4d7c-8d23-970dda258891": 0.7349520860886101, "9fff617e-6d8f-497f-92da-22003e73cfd2": 0.021157780088279222, "e3fe15e6-76eb-5105-8f2a-e55758b79bb8": -0.2572078366387564, "8bed75fc-372f-40e6-8bff-b7b1c273b61a": 0.05123642061990541, "1b80c511-00ea-45d6-a901-6351fc968f6a": 0.7349520860886101, "383873b7-7021-4ba0-8ec7-25516a8650ef": -0.2043297783153416, "415aa009-0079-4941-af2e-4625872de70b": -0.04276196872786268, "c6b3b8c5-2170-5093-9952-27df9247b1f5": 1.11243358068189, "b2ad9fb8-2b21-440d-9547-abcfce4cb720": -0.2043297783153416, "e128700e-15c6-4167-abf9-7b0cad3757af": 0.0016247579838007953}'::jsonb))
  select jsonb_build_object(
    'labels', (select count(*) from public.content_own_labels),
    'outcomes_with_reading', (select count(*) from public.content_own_outcomes where reading is not null),
    'available_null_with_reading', (select count(*) from public.content_own_outcomes where reading is not null and available_at is null),
    'available_before_pub_plus7', (select count(*) from public.content_own_outcomes where available_at < published_at + interval '7 days'),
    'backtest_with_pred', (select count(*) from public.content_own_forecast_grades where origin='backtest' and predicted_ratio is not null),
    'parity_n', (select count(*) from py join public.content_own_forecasts f on f.subject_ref=py.draft_id and f.origin='backtest' and f.predicted_log_ratio is not null),
    'parity_max_abs_diff', (select round(max(abs(f.predicted_log_ratio - py.p)),4) from py join public.content_own_forecasts f on f.subject_ref=py.draft_id and f.origin='backtest'),
    'sql_pred_not_in_py', (select count(*) from public.content_own_forecasts f where f.origin='backtest' and f.predicted_log_ratio is not null and not exists (select 1 from py where py.draft_id=f.subject_ref)),
    'queue_n', jsonb_array_length(v_q), 'write', v_w, 'dedupe_new_row_after_change', v_f1 is distinct from v_f2,
    'grade_test', v_g, 'cron', (select count(*) from cron.job where jobname='cb60_own_forecast_grader'),
    'backtests', (select jsonb_agg(jsonb_build_object(client_id, own_beats_niche)) from public.content_own_backtests)) into r;
  -- late-capture fixture: push the chosen reading's captured_at 7 days past its window end; availability must follow
  select o.digits, o.available_at into v_dig, v_av0 from public.content_own_outcomes o where o.client_id='risedtc' and o.reading is not null order by o.published_at desc limit 1;
  -- append-only table: append a reading at exactly day 7 (it wins the closest-to-7 pick) captured 20 days after publish
  insert into public.editorial_outcome_snapshots (client_id, snapshot_id, brief_id, brief_version, artifact_id, artifact_role, metric,
    observed_value, unknown_reason, denominator, scope, window_start, window_end, captured_at, event_definition, attribution, limitation, publication_id)
  select s.client_id, 'cb60-test-late-' || s.snapshot_id, s.brief_id, s.brief_version, s.artifact_id, s.artifact_role, s.metric,
    s.observed_value, s.unknown_reason, s.denominator, s.scope, s.window_start, s.window_start + interval '7 days',
    s.window_start + interval '20 days', s.event_definition, s.attribution, s.limitation, s.publication_id
  from public.editorial_outcome_snapshots s
  where s.client_id='risedtc' and s.metric='impressions' and s.artifact_role='own_post' and s.observed_value is not null
    and public.outlier_canonical_post_ref(s.publication_id)=v_dig limit 1;
  perform public.content_own_outcomes_refresh(now() + interval '30 days');
  select available_at into v_av1 from public.content_own_outcomes where client_id='risedtc' and digits=v_dig;
  -- a later post whose baseline holds v_dig must also move
  select o.digits, o.available_at into v_base_dig, v_bav0 from public.content_own_outcomes o where o.client_id='risedtc' and o.reading is not null order by o.published_at desc limit 1;
  r := r || jsonb_build_object('late_fixture', jsonb_build_object('digits', v_dig, 'available_before', v_av0, 'available_after', v_av1, 'after_is_pub_plus_20d', v_av1 >= (select published_at from public.content_own_outcomes where client_id='risedtc' and digits=v_dig) + interval '20 days'));
  raise exception 'TEST_RESULT %', r;
end $t$;
