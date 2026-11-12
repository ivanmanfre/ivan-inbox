-- content_prompts ivan-card-question and ivan-card-weave (client:ivan): the prompts the edge functions content-card-ask
-- and content-card-weave send (one proxy call each, user turn only, no system field). Canonical here; the functions
-- read the active row at call time and have no inline copy (no row = no question that day, nothing made up).
-- Placeholders the functions fill: {{SOURCE}} {{HINTS}} {{DRAFT}} (both), {{QUESTION}} {{ANCHOR}} {{ANSWER}} (weave).
-- Rollback: 20261112b_content_card_question_prompt_rollback.sql
insert into public.content_prompts (slug, title, body, kind, category, scope, updated_by, is_active)
select 'ivan-card-question', 'Ivan post card: one guided question for a lived detail', $p$You read one LinkedIn draft for Ivan Manfredi on the day he may post it. A machine wrote the draft. On his account only posts with a real detail from his own life get reach: something he did, saw, said or was told, a number he counted himself, a real moment. The machine must never invent such a detail. Only Ivan can give it, and he will give it only when asked ONE specific question he can answer in one line. Decide whether the draft already carries such a detail, and if it does not, write that one question. Return ONLY JSON.

What this draft is: {{SOURCE}}

Step 1. Does the draft already carry a concrete first-hand detail of Ivan's? Yes when it states something he did, saw, said or was told, a number he counted himself, or a real moment with a when, a where or a who. A general claim, an opinion, advice, a framework, a list of tips or a public statistic is not one. In a copy of another author's post, the author's own life is NOT his detail: the lines under HINTS were marked as such. If the draft already has his detail: has_lived_detail true, and question, anchor and kind null. Most days there should be no question; ask only when the post truly has nothing of his own.

Step 2. Otherwise write ONE question:
- At most 22 words, in plain everyday words, the way a friend would ask him over coffee.
- He can answer it in one line, from memory, with no research.
- It asks for something only he can know: what he did, what was said, the number, the moment, or his own take.
- It is tied to one line of the draft. anchor = that line copied character for character from DRAFT (a whole sentence or line exactly as it appears). His answer will be placed next to it.
- For a copy of another author's post: ask for HIS version of the author's personal line (what happened to him, what he saw himself), or for his own take on the author's claim.
- kind: own_moment (a moment, what happened), own_number (a number he counted himself), own_take (his own view, in his words), own_words (what he or someone else actually said).

Never:
- an open-ended ask ("Tell me about...", "What are your thoughts on...", "Can you share more...")
- asking him to write, rewrite, improve or add to the post
- asking for a fact a search could answer
- two questions in one
- a yes or no question with nothing after it (after "Do you agree?" always add the part that gets the detail, as in the last good example)
- anything that presumes a fact the draft does not state
- dashes as punctuation (no em dash, no en dash)

Good questions (the bar):
- You told the client their expert posts only reach existing followers. What did they say back?
- The prospect replied with just 'GEO?'. What did you answer?
- What was the moment you decided to stay in Poland?
- Kevin says Warsaw is dirty. Do you agree, and what did you see yourself?

Bad questions (never like these):
- Can you share more about your experience?
- What is your view on LinkedIn outreach?
- Could you add a personal story here?

HINTS (lines an earlier check marked as another author's own life; may be empty):
{{HINTS}}

DRAFT:
<<<
{{DRAFT}}
>>>

Return ONLY this JSON, nothing before or after it:
{"has_lived_detail": false, "question": "<the one question>", "anchor": "<exact line from DRAFT>", "kind": "own_moment", "why": "<one short plain sentence>"}$p$,
  'prompt', 'Post pipeline', 'client:ivan', 'content-card-question 2026-11-12 (plan step 2)', true
 where not exists (select 1 from public.content_prompts where slug = 'ivan-card-question' and scope = 'client:ivan');

insert into public.content_prompts (slug, title, body, kind, category, scope, updated_by, is_active)
select 'ivan-card-weave', 'Ivan post card: work his one-line answer into the draft', $p$Ivan Manfredi answered one question about his LinkedIn draft. Put his answer into the draft and change nothing else. He reads the result and saves it himself. Return ONLY JSON.

What this draft is: {{SOURCE}}

QUESTION he was asked: {{QUESTION}}
ANCHOR (the line of the draft the question is about): {{ANCHOR}}
HIS ANSWER (typed or dictated on his phone): {{ANSWER}}

Rules:
1. Add his answer as one or two sentences at the ANCHOR line or right next to it. Use his own words. Clean up only dictation errors, casing and punctuation.
2. Change nothing else. The only exceptions: the smallest change in the paragraph around the ANCHOR that the new sentences need to read naturally, and, for a copy of another author's post, replacing the author's personal line the question was about with his version.
3. Every other paragraph stays exactly as it is, character for character, in the same order.
4. Add no fact, name, number, quote or feeling his answer does not say.
5. No dashes as punctuation (no em dash, no en dash). No "X, not Y" contrast. Do not end the post with a question.
6. If his answer is empty, off topic or cannot be used, return the draft unchanged with changed false, and say why in reason.

DRAFT:
<<<
{{DRAFT}}
>>>

Return ONLY this JSON, nothing before or after it:
{"changed": true, "body": "<the whole post with his answer in it>", "reason": "<one short plain sentence>"}$p$,
  'prompt', 'Post pipeline', 'client:ivan', 'content-card-question 2026-11-12 (plan step 2)', true
 where not exists (select 1 from public.content_prompts where slug = 'ivan-card-weave' and scope = 'client:ivan');
