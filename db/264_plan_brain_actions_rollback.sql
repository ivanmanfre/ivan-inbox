-- Rollback for db/264: both wrappers are new (no earlier body to restore), so rollback removes them.
-- No data is touched: proposals already decided and rules already undone keep that state.
drop function if exists public.operator_brain_proposal_decide(text, bigint, boolean);
drop function if exists public.operator_brain_rule_undo(text, uuid);
