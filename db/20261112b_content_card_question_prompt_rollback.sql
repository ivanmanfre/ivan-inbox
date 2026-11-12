-- Rollback of 20261112b_content_card_question_prompt.sql, the repo's prompt-row rule: the rows are switched off, kept
-- as history. With no active row both functions store or return nothing (no question that day; the weave says it
-- could not add it).
update public.content_prompts set is_active = false where slug in ('ivan-card-question', 'ivan-card-weave') and scope = 'client:ivan';
