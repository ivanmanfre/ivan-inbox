-- Remove only this additive API. All source objects and source rows remain intact.
-- Commit job removal before waiting for its active transaction. If refresh_running occurs,
-- wait for the bounded exact job and execute this inverse again. Never drop during refresh.
begin;
select reply_source_private.unschedule_job();
commit;
begin;
do $$
declare jid bigint; active_job boolean;
begin
 select job_id into jid from reply_source_private.scheduler where singleton;
 if jid is not null then
  execute 'select exists(select 1 from cron.job_run_details where jobid=$1 and status in (''starting'',''running''))' into active_job using jid;
  if active_job then raise exception 'refresh_running' using errcode='55P03'; end if;
 end if;
 if not pg_try_advisory_xact_lock(20261007,741) then raise exception 'refresh_running' using errcode='55P03'; end if;
end $$;
drop function public.client_board_reply_source_v2(text,text,uuid);
drop function public.client_board_reply_sources_v2(text,text,integer);
drop function public.client_board_reply_source(text,text,uuid);
drop function public.client_board_reply_sources(text,text,integer);
drop function public.inbox_reply_source(uuid);
drop function public.outreach_reply_sources(text,integer,uuid);
drop function reply_source_private.board_read(text,text,boolean,integer,uuid,boolean,timestamptz);
drop function reply_source_private.read_result(text,integer,uuid,uuid,boolean,timestamptz);
drop function reply_source_private.snapshot_owned(reply_source_private.snapshots);
drop function reply_source_private.unschedule_job();
drop function reply_source_private.register_job();
drop function reply_source_private.refresh_all();
drop function reply_source_private.refresh_one(text,timestamptz);
drop table reply_source_private.scheduler;
drop table reply_source_private.refresh_status;
drop table reply_source_private.snapshots;
drop type reply_source_private.message_owner_row;
drop type reply_source_private.campaign_owner_row;
drop type reply_source_private.prospect_owner_row;
drop function reply_source_private.detail(text,uuid,timestamptz);
drop function reply_source_private.payload(text,integer,uuid,timestamptz);
drop function reply_source_private.payload_from_history(text,integer,uuid,timestamptz,reply_source_private.people_row[],reply_source_private.events_row[],reply_source_private.replies_row[],reply_source_private.followup_events_row[]);
drop function reply_source_private.detail_from_history(uuid,timestamptz,reply_source_private.people_row[],reply_source_private.events_row[],reply_source_private.replies_row[],reply_source_private.followup_events_row[]);
drop function reply_source_private.followup_events(text,timestamptz);
drop function reply_source_private.replies(text,timestamptz);
drop function reply_source_private.events(text,timestamptz);
drop function reply_source_private.history(text,timestamptz);
drop function reply_source_private.people(text,timestamptz);
drop function reply_source_private.purpose(text,text,integer,text,text);
drop type reply_source_private.followup_events_row;
drop type reply_source_private.replies_row;
drop type reply_source_private.events_row;
drop type reply_source_private.people_row;
drop schema reply_source_private;
notify pgrst,'reload schema';
commit;
