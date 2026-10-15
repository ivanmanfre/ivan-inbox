-- rollback of 279_brain_carry_rotation.sql
BEGIN;
UPDATE integration_config SET value = 'off' WHERE key IN ('brain_carry_ivan','brain_carry_risedtc','brain_carry_arch');
DELETE FROM content_prompts WHERE slug IN ('cb-brief-carry-rotation','cb-brief-must-carry-check') AND updated_by = 'cb-draft-quality-2026-10-15';
UPDATE cb38_fact_packs SET active = true, confirmation_note = NULL WHERE client_id = 'arch' AND fact_id = 'arch-81d0573ae5' AND NOT active
  AND confirmation_note LIKE 'RESTED 2026-10-15%';
COMMIT;
-- Prompt rows edited in the same change (restore the prior body; the version trigger bumps again):
--   ivan-post-check v7, ivan-voice-card-cb47 v6, rise-dtc-author-voice v38 -> bodies in content_prompt_versions and in
--   ~/.local/state/cb-draft-quality-1015/backup/. For ivan-voice-card-cb47 also set the ULWz3DbYF0oSv2G8 CB47_PINS pin back to its old version.
