-- Rollback for 20261118m_content_desk_trigger_claim.sql (new function; only content-desk calls it).
drop function if exists public.desk_claim_trigger(text, text, jsonb, integer);
