-- content_prompts ivan-draft-line-flags (client:ivan): the prompt the n8n job "Ivan Draft Line Flags" sends for
-- each Ivan draft (one proxy call, user turn only, no system field). Canonical here; the job has no inline copy.
-- Rollback: update content_prompts set is_active = false where slug = 'ivan-draft-line-flags';
insert into public.content_prompts (slug, title, body, kind, category, scope, updated_by, is_active)
select 'ivan-draft-line-flags', 'Ivan draft line flags (personal lines in copies, dated life claims)', $p$You read one LinkedIn draft for Ivan Manfredi before he posts it, and point at the lines he must check himself. Nothing is blocked or rewritten: each line you return becomes a highlight with a short question on his review screen, and he decides. Return ONLY JSON.

What is known about Ivan: {{IVAN_FACTS}}

Flag two kinds of line.

1. personal (only when a SOURCE block is given below, which means the draft is a near word-for-word copy of another author's post). A sentence that states the source author's own life as a fact about the narrator: what they did, places they went or live, counts about themselves ("I've been there 5 times"), their results and numbers, their identity or group ("I am Polish", "We, the Polish people"), their family and friends, their plans. Flag it even when it might also be true for Ivan, unless the facts above clearly make it true for him. Do not flag opinions, takes, general observations or public facts (statistics, news, history): Ivan keeps those as written. HINTS lists sentences an earlier step marked; use them as a starting point, not as the answer.

2. dated (any draft). A sentence that ties something in the narrator's own life to a time counted from the day the post goes out, such as "just back from", "this weekend", "today in", "last night", "yesterday", "this morning", "this week I", "next week". Ivan must confirm it is true on {{DATE}}. A fixed, named date ("in 1989", "on 3 September") is not a dated line. A time word inside a general claim ("every weekend people...") is not a dated line.

For each flag:
- text: the exact sentence, or the shortest complete clause, copied character for character from DRAFT, emoji and punctuation included. It must appear in DRAFT exactly as you write it.
- kind: "personal" or "dated". A sentence that is both is given twice, once per kind.
- ask: one short plain question for Ivan, at most 8 words, naming the claim, for example "Denis's 5 trips to Cyprus: yours?" or "Were you in Kraków that weekend?". No dashes as punctuation.
- At most 8 flags. An empty list is the right answer when nothing qualifies.

SOURCE:
{{SOURCE}}

HINTS:
{{HINTS}}

DRAFT (goes out {{DATE}}):
<<<
{{DRAFT}}
>>>

Return ONLY this JSON, nothing before or after it:
{"lines": [{"text": "<exact text from DRAFT>", "kind": "personal", "ask": "<short question>"}]}$p$,
  'prompt', 'Post pipeline', 'client:ivan', 'build-09 2026-11-06 (#27 personal lines, #33 dated claims)', true
 where not exists (select 1 from public.content_prompts where slug = 'ivan-draft-line-flags' and scope = 'client:ivan');
