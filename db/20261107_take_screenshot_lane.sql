-- "My take + screenshot" lane for Ivan's feed (triage #47, Ivan 2026-11-05: "we could build that for
-- source of ideas on relevant posts for main niches... Ivan's case: linkedin outreach, content, Poland").
-- The n8n job "Ivan Take + Screenshot Lane" reads candidates here, asks a reasoned judge (proxy, user turn
-- only) which posts sit in his niches, screenshots the real post (Railway /capture-post, platform embed),
-- writes his take with the canonical ivan-writer + ivan-post-check rows plus the lane format row below,
-- and inserts ONE held draft a day into his Review (status review, qa REVIEW). Nothing posts without his tap.
-- Rollback: 20261107_take_screenshot_lane_rollback.sql
begin;

-- 1. Candidates: tracked X accounts (outlier-copy handles + the reaction roster) and the LinkedIn creators
--    Ivan tracks (competitor_posts, client_id null). Each scored against the author's OWN median likes.
--    Posts that already have any draft (source_ref = url) are out. An X post that meets the outlier-copy bar
--    (>= 3x own median and >= 25 likes) is left to that lane for its first 2 days. Reposts ("RT @") are out.
create or replace function public.ivan_take_candidates_v1(
  p_exclude text[] default '{}', p_x_days int default 7, p_li_days int default 14, p_per_platform int default 25)
returns jsonb
language sql stable security definer set search_path = public
as $$
with x as (
  select distinct on (source_id) source_id, source_url, owner, source_published_at, candidate_fields cf
  from editorial_sources
  where client_id = 'ivan'
    and candidate_fields->>'query_config_id' in ('ivan-x-tracked-v1', 'ivan-x-agency-owner-v1')
    and source_published_at > now() - interval '30 days'
  order by source_id, seen_version desc, created_at desc
), xm as (
  select owner, (percentile_cont(0.5) within group (
           order by coalesce((cf->'observed_metrics'->>'likes')::numeric, 0)))::numeric med, count(*) n
  from x group by owner
), xc as (
  select 'x'::text platform, x.source_url url, x.owner handle, null::text author_name,
         x.source_published_at published_at,
         coalesce((cf->'observed_metrics'->>'likes')::int, 0) likes,
         coalesce((cf->'observed_metrics'->>'reposts')::int, 0) reposts,
         coalesce((cf->'observed_metrics'->>'replies')::int, 0) comments,
         coalesce((cf->'observed_metrics'->>'views')::int, 0) views,
         xm.med own_median, xm.n median_n,
         round(coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) / greatest(xm.med, 1), 1) ratio,
         coalesce(nullif(cf->>'evidence', ''), '') post_text,
         null::text post_type, cf->>'query_config_id' feed
  from x join xm using (owner)
  where x.source_published_at > now() - make_interval(days => p_x_days)
    and coalesce(cf->>'evidence', '') !~ '^\s*RT @'
    and length(coalesce(cf->>'evidence', '')) >= 40
    and coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) >= greatest(1.5 * xm.med, 10)
    and not (coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) >= greatest(3 * xm.med, 25)
             and x.source_published_at > now() - interval '2 days')
), lm as (
  select competitor_name, (percentile_cont(0.5) within group (order by likes_count))::numeric med, count(*) n
  from competitor_posts
  where client_id is null and post_date > now() - interval '60 days'
  group by competitor_name
), lc as (
  select 'linkedin'::text platform, p.linkedin_post_url url, null::text handle, p.competitor_name author_name,
         p.post_date published_at, coalesce(p.likes_count, 0) likes, coalesce(p.reposts_count, 0) reposts,
         coalesce(p.comments_count, 0) comments, null::int views, lm.med own_median, lm.n median_n,
         round(coalesce(p.likes_count, 0) / greatest(lm.med, 1), 1) ratio,
         coalesce(p.post_text, '') post_text, p.post_type, 'competitor_posts'::text feed
  from competitor_posts p join lm using (competitor_name)
  where p.client_id is null
    and p.post_date > now() - make_interval(days => p_li_days)
    and p.linkedin_post_url ~ '(activity|ugcPost|share)[-:][0-9]{16,20}'
    and length(coalesce(p.post_text, '')) >= 40
    and coalesce(p.likes_count, 0) >= greatest(1.5 * lm.med, 10)
), u as (
  select * from xc union all select * from lc
), fresh as (
  select u.* from u
  where not (u.url = any (coalesce(p_exclude, '{}')))
    and not exists (select 1 from carousel_drafts c where c.source_ref = u.url)
), ranked as (
  select fresh.*, row_number() over (partition by platform order by ratio desc, likes desc) rn from fresh
)
select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.ratio desc), '[]'::jsonb)
from ranked r where r.rn <= greatest(1, least(p_per_platform, 200));
$$;
revoke all on function public.ivan_take_candidates_v1(text[], int, int, int) from public, anon, authenticated;
grant execute on function public.ivan_take_candidates_v1(text[], int, int, int) to service_role;

-- 2. Lane settings (read by the n8n job each run). Pace from his approvals: of ~45 outlier copies put in his
--    Review since 27 Sep, ~8 were scheduled or posted (~1.3 a week). So: at most 1 take a day, and none while
--    3 takes from the last 7 days still wait in Review.
insert into public.integration_config (key, value, is_secret) values ('ivan_take_lane', $j${
  "enabled": true,
  "per_day": 1,
  "max_waiting": 3,
  "waiting_days": 7,
  "niches": "1. LinkedIn outreach: connection requests, DMs, follow-ups, reply and accept rates, booking calls from LinkedIn, warm vs cold outreach, outbound for agencies and service businesses.\n2. LinkedIn content: posts, hooks, formats, personal brand, ghostwriting, AI-written content, inbound from content, lead magnets, what founders should post and why.\n3. Poland: living in Poland or Warsaw as a foreigner, safety, costs, taxes, business climate, Polish politics and society, migration, Poland compared with other countries."
}$j$, false)
on conflict (key) do nothing;

-- 3. Canonical prompts (the job has no inline copy).
insert into public.content_prompts (slug, title, body, kind, category, scope, updated_by, is_active)
select 'ivan-take-screenshot-judge', 'Ivan take + screenshot: which tracked posts sit in his niches', $p$You pick public posts that Ivan Manfredi could answer on LinkedIn with his own take, posted with a screenshot of the original post under his text. Return ONLY JSON.

Who Ivan is: 25, Argentinian, Italian passport, Polish grandmother, living in Warsaw since spring 2026. He runs a one-man agency doing LinkedIn content, lead magnets and LinkedIn outreach for agency founders and service-business owners, who are his readers. His Poland posts (life in Warsaw as a foreigner, safety, taxes, politics, migration, what he sees living there) are among his best-read posts.

His main niches (Ivan, 2026-11-05: "linkedin outreach, content, Poland"):
{{NICHES}}

For EACH candidate, read what the post is about (its subject and its point, never the words it happens to contain) and decide:
- relevant: true only when the post's own subject is one of the niches above. A passing mention is false (a fitness post that says "LinkedIn" once, a Polish flag on a holiday photo from Italy, a generic productivity quote). Polemic and political posts about Poland count as Poland (Ivan's ruling: polemic and political takes are never filtered out). Politics about another country is not Poland.
- takeable: true only when Ivan can say something of his own: agree and push it further, disagree with a reason, or add the angle of someone who runs LinkedIn outreach and content every day, or of a foreigner living in Warsaw. False when the only reply is "great post", when the post is a promo, a giveaway, an event or job ad, a photo with a caption, or a repost of someone else, and when a take would need facts about Ivan that are not given here.
- For a relevant and takeable post: point (the claim Ivan's post would make, one sentence), stance (his opinion, first person, one or two sentences, fitting who he is; an opinion only, never an invented fact, test, number, client or event of his), hook (what his first line could open on: the claim or tension, never a quote of the post), and strength 1-5 (how much his readers would care, and how clear and his own the take is).

A post can use none of the niche words and still be squarely about a niche, or use all of them and be about something else. Judge the subject.

CANDIDATES:
{{CANDIDATES}}

Return ONLY this JSON, one entry per candidate, in the order given:
{"judgements":[{"id":"<candidate id>","relevant":true,"niche":"<LinkedIn outreach|LinkedIn content|Poland|none>","takeable":true,"why":"<one short sentence>","point":"...","stance":"...","hook":"...","strength":3}]}$p$,
  'prompt', 'Post pipeline', 'client:ivan', 'take-screenshot-lane-2026-11-07', true
where not exists (select 1 from public.content_prompts where slug = 'ivan-take-screenshot-judge');

insert into public.content_prompts (slug, title, body, kind, category, scope, updated_by, is_active)
select 'ivan-take-screenshot-format', 'Ivan take + screenshot: lane format block for ivan-writer', $p$## 3b. This post's format: his take, with a screenshot of the post he is answering (Ivan, 2026-11-05)

This post is Ivan's take on ONE public post by {{AUTHOR}} on {{PLATFORM}}. A screenshot of that post goes under his text as the post's image. The shape he asked for ("I like the 'I don't judge an influencer by CPM alone...' post format with X screenshot"):
1. Open on HIS stance on the subject, in his words. Not a quote, not the author's name, not "I saw a post".
2. Then bring the post in as the example: name the author once, by the name shown on the post ({{AUTHOR}}), and say in a few plain words what they posted. You may quote ONE short phrase, copied exactly from VISIBLE TEXT, as theirs.
3. Then his extension, his disagreement or his verdict, and the landing line from section 2.

Rules for this format:
- The reader sees the screenshot. Never describe the image, and never write "screenshot", "this post", "see below", "link" or a pointing emoji.
- Quote only words that appear in VISIBLE TEXT. The author's numbers, results and story stay theirs (THIRD-PARTY rules above).
- Disagreeing is fine and often better. Never mock the author; argue with the claim.
- 60-150 words. No hashtags, no @tag of the author, no link.$p$,
  'prompt', 'Post pipeline', 'client:ivan', 'take-screenshot-lane-2026-11-07', true
where not exists (select 1 from public.content_prompts where slug = 'ivan-take-screenshot-format');

commit;
