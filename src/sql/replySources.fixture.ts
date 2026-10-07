import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
export const AS_OF = '2026-10-07T12:00:00Z'
export const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
export const OPERATOR = id(900)
// Column names and types match the saved 2026-10-07 live schema. No private source data is copied.
export async function fixture() {
 const db = new PGlite()
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 alter default privileges grant execute on functions to anon, authenticated, service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
 create schema extensions;
 -- PGlite lacks pgcrypto. Keep actual SHA-256 via PostgreSQL core, never replace auth predicates.
 create function extensions.digest(text,text) returns bytea language plpgsql immutable as $$
 begin if $2 <> 'sha256' then raise exception 'unsupported hash'; end if;
 return pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8')); end $$;
 create table public.client_board_sessions (id uuid, slug text, email text, token_hash text, created_at timestamptz, expires_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz);
create table public.client_boards (id uuid, slug text, prospect_id uuid, scan_id uuid, client_id text, mode text, token text, board jsonb, expires_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table public.client_registry (id uuid, client_id text, display_name text, github_repo text, n8n_url text, n8n_api_key text, extra_env jsonb, aliases text[], is_active bool, created_at timestamptz, supabase_url text, supabase_service_key text, extra_mcps jsonb, platform jsonb);
create table public.outreach_agent_accounts (account_id text, client_id text, campaign_id uuid, provider_account_id text, provider_owner_id text, operator_ids uuid[], capabilities jsonb, provider_config jsonb, shadow_enabled bool, enrollment_enabled bool, dispatch_enabled bool, auto_enabled bool, cold_enabled bool, viewer_daily_cap int4, cold_daily_cap int4, active_thread_cap int4, dm_bubble_daily_cap int4, post_reaction_daily_cap int4, model_call_daily_cap int4, icp_floor int4, required_scorer_version text, score_max_age_days int4, shared_cap_seat text, shared_dm_action_type text, shared_reaction_action_type text, operating_timezone text, operating_start time, operating_end time, created_at timestamptz, updated_at timestamptz);
create table public.outreach_campaigns (id uuid, name text, description text, apollo_filters jsonb, niche_tags text[], is_active bool, max_prospects int4, warmup_days int4, prospect_count int4, connected_count int4, replied_count int4, last_import_at timestamptz, created_at timestamptz, updated_at timestamptz, replenish_paused bool, rotation_active_until timestamptz, rotation_priority int4, archived bool, vertical_slug text, lm_audience_descriptor text, client_id text);
create table public.outreach_messages (id uuid, prospect_id uuid, direction text, message_text text, message_type text, sequence_step int4, unipile_message_id text, unipile_chat_id text, sent_at timestamptz, read_at timestamptz, prompt_page_id text, ai_model text, created_at timestamptz, matched_content_type text, matched_content_title text, matched_content_url text, industry_cluster text, channel text, approved_at timestamptz, recipient_email text, email_step int4, email_sequence_stopped_at timestamptz, email_sequence_stopped_reason text, send_blocked_reason text, send_blocked_at timestamptz, replies_to_message_id uuid, is_reaction bool, qa_total int2, qa_decision text, qa_dim_scores jsonb, qa_banned_hits text[], qa_run_at timestamptz, qa_retry_count int2, qa_rewrite_hint text, qa_regex_hits text[], qa_floor_fails text[], matched_offer text, email_mirror_text text, context_gap jsonb, snoozed_until timestamptz, snoozed_at timestamptz, draft_evidence jsonb, reply_intent text, reply_intent_at timestamptz, reply_intent_model text, agent_action_id uuid, discard_mode text);
create table public.outreach_prospects (id uuid, campaign_id uuid, linkedin_url text, linkedin_profile_id text, apollo_id text, name text, headline text, company text, location text, industry text, profile_photo_url text, icp_score int4, icp_reasoning text, activity_score int4, last_post_date timestamptz, last_engagement_date timestamptz, post_count_30d int4, recent_topics text[], stage text, profile_viewed_at timestamptz, posts_liked int4, posts_commented int4, last_engaged_at timestamptz, connection_sent_at timestamptz, connection_note text, connected_at timestamptz, last_dm_sent_at timestamptz, dm_count int4, last_reply_at timestamptz, reply_count int4, needs_manual_reply bool, next_touch_after timestamptz, blacklisted bool, notes text, skip_reason text, enrichment_data jsonb, created_at timestamptz, updated_at timestamptz, seniority text, department text, employee_count text, founded_year int4, company_domain text, company_linkedin_url text, email_status text, city text, state text, country text, title text, email text, phone text, annual_revenue text, company_description text, company_keywords text[], note_variant text, preferred_channel text, trigger_type text, trigger_detail text, trigger_hook text, trigger_ask text, trigger_source_url text, trigger_confidence int4, researched_at timestamptz, micro_persona text, messaging_pattern text, research_sources jsonb, skip_state text, skip_state_reason text, skip_state_at timestamptz, matched_offer text, offer_angle text, ad_signal text, send_priority int2, rescore_attempts int2, follower_count int4, email_icebreaker text, recent_posts jsonb, email_descriptor text, email_verification text, email_verified_at timestamptz, hypertarget_reserved bool, scorer_version text, scored_at timestamptz, audience_density numeric, email_campaign_id int8, email_loaded_at timestamptz, operator_note text, operator_note_at timestamptz, connections_count int4, liveness_checked_at timestamptz, call_booked_at timestamptz, recycled_at timestamptz, attributed_post_id uuid, attribution text, attributed_at timestamptz, attribution_meta jsonb, booking_variant text, slot_ask jsonb, solved_at timestamptz);
 create table public.integration_config(key text, value text, updated_at timestamptz, is_secret bool);
 create table public.audn_person_label_v(client_id text, person_key text, label text, classifier_slug text, classifier_version text, judged_at timestamptz, conflict bool, n_rows int4, is_operator bool, is_excluded bool);
 create table public.outreach_templates(key text, client_id text, lane text, step text, label text, body text, subject text, tokens jsonb, editable bool, in_rotation bool, source text, live_synced bool, notes text, updated_at timestamptz, history jsonb);
 create function public._bk_host(u text) returns text language sql immutable as $$
 select nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(u,''))), '^[a-z]+://', ''), '^www[.]', ''), '[/?#:].*$', ''), '') $$;
 create function public._bk_email_domain(e text) returns text language sql immutable as $$
 select case when position('@' in coalesce(e,'')) > 1 then nullif(split_part(lower(btrim(e)), '@', 2), '') end $$;
 create function public.li_slug(u text) returns text language sql immutable as $$
 select split_part(regexp_replace(lower(u),'^(https?://)?(www[.])?linkedin[.]com/in/',''), '/',1) $$;
 insert into client_registry(client_id,is_active) values ('ivan',true),('risedtc',true),('arch',true),('empty',true),('inactive',false);
 insert into outreach_agent_accounts(client_id,operator_ids) values ('ivan',array['${OPERATOR}'::uuid]);
 `)
 if (existsSync('db/20261007_reply_sources.sql')) await db.exec(readFileSync('db/20261007_reply_sources.sql','utf8'))
 return db
}
export async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
 const keys = Object.keys(values)
 await db.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_,i) => '$'+(i+1)).join(',')})`, Object.values(values))
}
export async function campaign(db: PGlite, n=1, client: string | null='ivan', extra: Record<string,unknown>={}) {
 await insert(db,'outreach_campaigns',{id:id(n),client_id:client,name:'Fixture',is_active:true,archived:false,...extra}); return id(n)
}
export async function person(db: PGlite, n=10, camp: number|null=1, extra: Record<string,unknown>={}) {
 await insert(db,'outreach_prospects',{id:id(n),campaign_id:camp===null?null:id(camp),linkedin_profile_id:'fixture-person-'+n,...extra}); return id(n)
}
export async function message(db: PGlite, n: number, time: string, extra: Record<string,unknown>={}) {
 await insert(db,'outreach_messages',{id:id(n),prospect_id:id(10),direction:'outbound',message_type:'dm',sequence_step:4,ai_model:'content_system_dm4_v1',unipile_message_id:'fixture-receipt-'+n,unipile_chat_id:'fixture-chat',sent_at:time,created_at:time,channel:'linkedin',message_text:'fixture text',...extra}); return id(n)
}
export const reply = (db: PGlite,n:number,time:string,extra:Record<string,unknown>={}) => message(db,n,time,{direction:'inbound',sequence_step:null,ai_model:null,channel:null,...extra})
export async function payload(db:PGlite,client='ivan',camp:string|null=null,days=30):Promise<any> {
 return (await db.query<{p:unknown}>(`select reply_source_private.payload($1,$2,$3,$4) p`,[client,days,camp,AS_OF])).rows[0].p
}
export async function detail(db:PGlite,n=10):Promise<any> {
 return (await db.query<{p:unknown}>(`select reply_source_private.detail('ivan',$1,$2) p`,[id(n),AS_OF])).rows[0].p
}
export const row=(p:any,touch:string)=>p.touches.find((r:any)=>r.touch===touch)
export const source=(p:any,touch:string)=>p.sources.find((r:any)=>r.touch===touch)
