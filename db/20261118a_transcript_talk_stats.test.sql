-- Test of 20261118a. Read-only: transcript_talk_stats is a pure function, nothing is written.
-- Result: one row, "result" starts with TEST_PASS or TEST_FAIL and lists every failed check.
-- Run on the live database before the migration (expect an error: function does not exist) and after (expect TEST_PASS).
with fx as (
  select
    -- 75%: Ivan 300 words, Other 100 words, 5 utterances each
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', repeat('w ', 20))) from generate_series(1, 5)) as two,
    -- one speaker only
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 60))) from generate_series(1, 6)) as one,
    -- accented label
    (select jsonb_agg(jsonb_build_object('speaker', 'Iván Manfredi', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', repeat('w ', 20))) from generate_series(1, 5)) as accent,
    -- under 200 words
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', 'a b c')) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', 'a b c')) from generate_series(1, 5)) as small,
    -- nobody is Ivan
    (select jsonb_agg(jsonb_build_object('speaker', 'Participant', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', repeat('w ', 60))) from generate_series(1, 5)) as noivan,
    -- second speaker has only 4 utterances
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', repeat('w ', 60))) from generate_series(1, 4)) as thin,
    -- two Ivan labels, nobody else
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 30))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan Manfredi', 'text', repeat('w ', 30))) from generate_series(1, 5)) as twoivan,
    -- two Ivan labels plus another speaker with 2 utterances
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 30))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan Manfredi', 'text', repeat('w ', 30))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Petros', 'text', repeat('w ', 20))) from generate_series(1, 2)) as twoivan_p2,
    -- Ivan plus Ivana Petrova (not Ivan), 5 utterances each
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivan', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivana Petrova', 'text', repeat('w ', 20))) from generate_series(1, 5)) as ivana,
    -- only Ivana and Ivanka: nobody is Ivan
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivana Petrova', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Ivanka', 'text', repeat('w ', 60))) from generate_series(1, 5)) as noivan2,
    -- uppercase label
    (select jsonb_agg(jsonb_build_object('speaker', 'IVAN', 'text', repeat('w ', 60))) from generate_series(1, 5)) ||
    (select jsonb_agg(jsonb_build_object('speaker', 'Other', 'text', repeat('w ', 20))) from generate_series(1, 5)) as upper
), chk(name, ok) as (
  select 'two speakers 300/100 = 75', transcript_talk_stats(two)->>'ivan_pct' = '75' and (transcript_talk_stats(two)->>'total')::int = 400
         and (transcript_talk_stats(two)->'words'->>'Ivan')::int = 300 from fx
  union all select 'one speaker = null ivan_pct', transcript_talk_stats(one) is not null and transcript_talk_stats(one)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'accented label counts as Ivan', transcript_talk_stats(accent)->>'ivan_pct' = '75' from fx
  union all select 'under 200 words = null ivan_pct', transcript_talk_stats(small)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'no Ivan speaker = null ivan_pct', transcript_talk_stats(noivan)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'second speaker 4 utterances = null ivan_pct', transcript_talk_stats(thin)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'two Ivan labels, no other party = null ivan_pct', transcript_talk_stats(twoivan)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'two Ivan labels + other with 2 utterances = null ivan_pct', transcript_talk_stats(twoivan_p2)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'Ivana Petrova is not Ivan (Ivan 300 of 400 = 75)', transcript_talk_stats(ivana)->>'ivan_pct' = '75' and (transcript_talk_stats(ivana)->'words'->>'Ivan')::int = 300 from fx
  union all select 'Ivana / Ivanka only = no Ivan = null ivan_pct', transcript_talk_stats(noivan2)->'ivan_pct' = 'null'::jsonb from fx
  union all select 'IVAN uppercase counts as Ivan', transcript_talk_stats(upper)->>'ivan_pct' = '75' from fx
  union all select 'null input = null', transcript_talk_stats(null) is null
  union all select 'json null = null', transcript_talk_stats('null'::jsonb) is null
  union all select 'object input = null', transcript_talk_stats('{"a":1}'::jsonb) is null
  union all select 'empty array = null', transcript_talk_stats('[]'::jsonb) is null
  union all select 'elements without speaker/text = null', transcript_talk_stats('[{"x":1},"str",3,null,{"speaker":"Ivan"},{"text":"hi"}]'::jsonb) is null
  union all select 'non-string text does not raise', transcript_talk_stats('[{"speaker":"Ivan","text":12},{"speaker":"Ivan","text":{"a":1}}]'::jsonb) is not null
  union all select 'column exists', exists (select 1 from information_schema.columns where table_name='transcripts' and column_name='talk_stats' and data_type='jsonb')
  union all select 'trigger exists, insert+update of transcript_json', exists (
      select 1 from pg_trigger where tgname='transcripts_talk_stats' and tgrelid='public.transcripts'::regclass
         and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE OF transcript_json%')
)
select case when bool_and(ok) then 'TEST_PASS' else 'TEST_FAIL: ' || string_agg(name, '; ') filter (where not ok) end as result,
       count(*) as checks
  from chk;
