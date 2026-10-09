// get-morning-brief — single aggregation endpoint for the Daily Brief surface in Ivan Listener.app.
// Returns one JSON payload covering all panels. Panels never null; arrays default to [].
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSpokenOutreach } from "./spoken-outreach.ts";
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const N8N_HOST = Deno.env.get("N8N_HOST") ?? "https://n8n.ivanmanfredi.com";
const N8N_KEY = Deno.env.get("N8N_API_KEY") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json"
};
export async function buildBrief(req) {
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  const sb = createClient(SB_URL, SB_KEY);
  // --- mode (2026-07-25) ---
  // "full"   (default) — unchanged payload SHAPE; the Swift Brief decoder owns it.
  // "counts" — scalars ONLY, with deliberately DISTINCT key names so a strict decoder can
  //            never half-decode a counts response as a Brief. Zero PII, zero tokens, no URLs.
  //            Runs the same query blocks but skips every heavy / non-scalar section.
  const mode = (()=>{
    try {
      return new URL(req.url).searchParams.get("mode") ?? "full";
    } catch  {
      return "full";
    }
  })();
  // --- D11 gating (2026-07-25) --- full payload is authenticated-only.
  // The gateway (verify_jwt=true) already validated the JWT signature; we only read
  // the role claim here. Anon-key callers are forced to the counts shape — no approve
  // tokens / PII ever reach an unauthenticated caller.
  const callerRole = (()=>{
    try {
      const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.role ?? "anon";
    } catch  {
      return "anon";
    }
  })();
  // Spoken mode is counts-only and skips the existing full/counts query blocks.
  if (mode === "spoken") return new Response(JSON.stringify(await loadSpokenOutreach(sb, new Date())), { headers: cors });
  const countsMode = mode === "counts" || callerRole !== "authenticated" && callerRole !== "service_role";
  const cnt = async (q)=>(await q).count ?? 0;
  const nowIso = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = startOfToday.toISOString();
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400_000);
  const tomorrowIso = startOfTomorrow.toISOString();
  // --- approval-draft freshness (2026-08-02) ---
  // The two approval queues (comment drafts, DM drafts) had no age signal at all, so a
  // 16-day-old draft and one written last night read identically on the Today screen
  // ("the approve dm draft is old asf"). AGE, DON'T HIDE: unlike feed_drafts (hard 3d
  // window) and urgencies (hard 72h cutoff), these are one-off manual decisions Ivan still
  // owes — dropping them would bury a real backlog. So every row carries is_aging and the
  // arrays come back OLDEST FIRST (the row owed longest is the one the zone previews).
  const AGING_MS = 7 * 86400_000;
  const ts = (iso)=>{
    const t = new Date(iso ?? "").getTime();
    return Number.isFinite(t) ? t : NaN;
  };
  const isAging = (iso)=>{
    const t = ts(iso);
    return Number.isFinite(t) && Date.now() - t > AGING_MS;
  };
  // Undated rows sink to the bottom: unknown age is not evidence of urgency (same
  // reasoning as the urgency cutoff, which keeps unparseable waiting_since rows).
  const oldestFirst = (a, b)=>{
    const ta = ts(a), tb = ts(b);
    if (!Number.isFinite(ta)) return Number.isFinite(tb) ? 1 : 0;
    if (!Number.isFinite(tb)) return -1;
    return ta - tb;
  };
  // --- workflow_errors_count (counts mode only) ---
  // Kicked off FIRST and awaited last so its latency hides behind the DB work. Counts the
  // distinct workflows that errored in the last 24h, on a hard 2s budget. ANY failure,
  // non-200, timeout or missing key -> null, NEVER 0: a silent zero reads as "all green"
  // when the truth is "unknown".
  const workflow_errors_count_p = countsMode && N8N_KEY ? (async ()=>{
    const ac = new AbortController();
    const killer = setTimeout(()=>ac.abort(), 2000);
    try {
      const r = await fetch(`${N8N_HOST}/api/v1/executions?status=error&limit=30&includeData=false`, {
        headers: {
          "X-N8N-API-KEY": N8N_KEY,
          accept: "application/json"
        },
        signal: ac.signal
      });
      if (!r.ok) return null;
      const j = await r.json();
      const wfIds = new Set();
      for (const e of j.data ?? []){
        const when = e.stoppedAt ?? e.startedAt;
        if (new Date(when ?? 0).toISOString() < dayAgo) continue;
        wfIds.add(e.workflowId ?? "");
      }
      return wfIds.size; // same unit as full mode's workflow_errors.length
    } catch (_e) {
      return null;
    } finally{
      clearTimeout(killer);
    }
  })() : null;
  // --- needs_you: comment drafts ---
  // counts mode takes a head-count instead of the rows (no author names / comment text).
  // In counts mode the head-counts are STARTED but not awaited (resolved just before the
  // response) so they overlap the sequential blocks below — that's the <3s budget.
  let commentDrafts = [];
  let comments_pending_p;
  // 2026-08-21: a FRESH head-count (drafted in the last 7d) alongside the all-time one. Measured
  // live: all 6 standing comment drafts date from 06-28..07-01 — seven weeks old. The cockpit keeps
  // showing them aged (AGE, DON'T HIDE), but the spoken welcome must not call them "drafts to clear".
  let comments_fresh_p = Promise.resolve(0);
  const freshSince = new Date(Date.now() - AGING_MS).toISOString();
  if (countsMode) {
    comments_pending_p = cnt(sb.from("commenting_log").select("id", {
      count: "exact",
      head: true
    }).eq("status", "draft"));
    comments_fresh_p = cnt(sb.from("commenting_log").select("id", {
      count: "exact",
      head: true
    }).eq("status", "draft").gte("drafted_at", freshSince));
  } else {
    const { data } = await sb.from("commenting_log").select("id,post_author_name,comment_text,post_excerpt,post_url,drafted_at").eq("status", "draft").order("drafted_at", {
      ascending: false
    }).limit(50);
    // desc + limit(50) at the DB stays the newest-50 WINDOW (flipping it there would make
    // the cap hide new drafts); the oldest-first order is applied to the returned page.
    // No supersession check here: probed 2026-08-02, each of the 6 standing drafts is the
    // only commenting_log row for its post_social_id — there is no later posted/approved
    // sibling, so the DM orphan pattern has no analogue on this table.
    commentDrafts = (data ?? []).map((r)=>({
        ...r,
        is_aging: isAging(r.drafted_at)
      })).sort((a, b)=>oldestFirst(a.drafted_at, b.drafted_at));
    comments_pending_p = Promise.resolve(commentDrafts.length);
  }
  // --- needs_you: comment_feed drafts (drafts+approve-to-post engine, 2026-07-17) ---
  // BOTH reads below are scoped to lane='quality' (2026-09-22). The volume lane writes
  // lane='volume' rows to the same table, and its approve links live on a DIFFERENT
  // webhook - the approve_url this function prebuilds would hard-refuse them. Volume
  // drafts reach Ivan as ops_drafts cards on the Ops board instead.
  // The live comment lane: pending rows carry a machine draft + per-row approve token.
  // approve_url/skip_url are prebuilt server-side so no client ever assembles token links.
  // Recent non-pending rows (3d) ride along so the brief shows posted/failed outcomes.
  // counts mode NEVER selects approve_token and never builds an approve/skip URL — it only
  // head-counts the rows still awaiting an approve (status='pending').
  const feedSince = new Date(Date.now() - 3 * 86400_000).toISOString();
  let feed_drafts = [];
  let feed_pending_p;
  if (countsMode) {
    feed_pending_p = cnt(sb.from("comment_feed").select("id", {
      count: "exact",
      head: true
    }).eq("lane", "quality").not("manual_comment_text", "is", null).gte("created_at", feedSince).eq("status", "pending"));
  } else {
    const { data: feedDraftsRaw } = await sb.from("comment_feed").select("id,target_name,target_class,hook,manual_comment_text,approve_token,post_url,status,post_error,posted_at,created_at").eq("lane", "quality").not("manual_comment_text", "is", null).gte("created_at", feedSince).in("status", [
      "pending",
      "approved",
      "posting",
      "posted",
      "failed"
    ]).order("created_at", {
      ascending: false
    }).limit(20);
    const approveBase = `${N8N_HOST}/webhook/comment-approve`;
    feed_drafts = (feedDraftsRaw ?? []).map((r)=>({
        id: r.id,
        target_name: r.target_name ?? "(unknown)",
        target_class: r.target_class ?? "",
        hook: r.hook ?? "",
        draft: r.manual_comment_text ?? "",
        post_url: r.post_url ?? "",
        status: r.status ?? "pending",
        post_error: r.post_error ?? null,
        posted_at: r.posted_at ?? null,
        created_at: r.created_at ?? null,
        approve_url: `${approveBase}?id=${r.id}&k=${r.approve_token}`,
        skip_url: `${approveBase}?id=${r.id}&k=${r.approve_token}&dismiss=1`
      }));
    feed_pending_p = Promise.resolve(feed_drafts.filter((d)=>d.status === "pending").length);
  }
  // --- needs_you: DM drafts (outbound, unsent, exclude retired hiring_signal lane) ---
  const { data: dmRows } = await sb.from("outreach_messages").select("id,message_type,channel,matched_offer,message_text,created_at,prospect_id,sent_at,direction,send_blocked_reason").eq("direction", "outbound").is("sent_at", null).eq("message_type", "dm")// inbox isDraft (2026-08-22): unapproved, and either unblocked or a recoverable race hold.
  .is("approved_at", null)// exclude gate-blocked rows: ~100 linter-suppressed sends share sent_at=null and were
  // flooding the 50-row limit, pushing real review drafts (stall bumps etc.) out of view
  .or("send_blocked_reason.is.null,send_blocked_reason.like.post_approval_race:*")// snoozed (db/037, 2026-08-22): a draft Ivan pushed to later is not "to clear" until
  // snoozed_until passes. The inbox honours this already; the spoken drafts count did not.
  .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`).order("created_at", {
    ascending: false
  }).limit(50);
  const dmIds = (dmRows ?? []).map((r)=>r.prospect_id).filter(Boolean);
  const { data: dmProspects } = dmIds.length ? await sb.from("outreach_prospects").select("id,name,trigger_type,enrichment_data,stage,campaign_id").in("id", dmIds) : {
    data: []
  };
  const pById = new Map((dmProspects ?? []).map((p)=>[
      p.id,
      p
    ]));
  // --- supersession (2026-08-02) ---
  // A draft whose prospect has a LATER outbound that actually went out is a decision
  // already made: the thread moved on and this row is the abandoned predecessor. Nothing
  // in the send path retires it, so it kept reading as "waiting for your approve" forever
  // — and, being the newest, it was the row the Today zone previewed. (David Card: draft
  // 07-29 20:30, superseded by a real send 07-30 09:00.) STRICTLY LATER is load-bearing:
  // the three genuinely-open 13-16d drafts all have EARLIER sends in-thread and must
  // survive. Compared as instants, never lexically. dmRows is limit(50) so dmIds cannot
  // approach the ~16KB in.() URL ceiling — no batching needed.
  const { data: dmSentRows } = dmIds.length ? await sb.from("outreach_messages").select("prospect_id,sent_at").eq("direction", "outbound").not("sent_at", "is", null).in("prospect_id", dmIds) : {
    data: []
  };
  const lastSentByProspect = new Map();
  for (const m of dmSentRows ?? []){
    const t = ts(m.sent_at);
    if (!Number.isFinite(t)) continue;
    const cur = lastSentByProspect.get(m.prospect_id);
    if (cur === undefined || t > cur) lastSentByProspect.set(m.prospect_id, t);
  }
  let dm_superseded_count = 0;
  const dmDrafts = (dmRows ?? []).filter((r)=>{
    const p = pById.get(r.prospect_id);
    const src = p?.enrichment_data?.source;
    return !(p?.trigger_type === "hiring" && src === "hiring_signal");
  })// inbox mirror (2026-08-22): the inbox view INNER-joins campaigns and drops archived
  // prospects' drafts; a draft the inbox cannot show is not "to clear" (Vuk/Prakhar/Joachim,
  // campaign NULL since July, and Alec Lorenzo on an archived duplicate, were counted here).
  .filter((r)=>{
    const p = pById.get(r.prospect_id);
    return !!p && !!p.campaign_id && p.stage !== "archived";
  }).filter((r)=>{
    const sent = lastSentByProspect.get(r.prospect_id);
    const made = ts(r.created_at);
    if (sent === undefined || !Number.isFinite(made) || sent <= made) return true;
    dm_superseded_count++;
    return false;
  }).map((r)=>({
      id: r.id,
      prospect_name: pById.get(r.prospect_id)?.name ?? "(unknown)",
      message_text: r.message_text,
      channel: r.channel,
      matched_offer: r.matched_offer,
      created_at: r.created_at,
      // aged, not hidden — the client renders an honest age stamp off created_at
      is_aging: isAging(r.created_at)
    })).sort((a, b)=>oldestFirst(a.created_at, b.created_at));
  const dm_aging_count = dmDrafts.filter((d)=>d.is_aging).length;
  // --- today_content ---
  // today only (start-of-today .. start-of-tomorrow); future posts live in the full calendar
  // counts mode takes a head-count instead of the rows (no post text).
  // 2026-08-21 (goal-run daily-brief-app-overhaul): counts mode now EXCLUDES cancelled/failed rows.
  // Measured live: the day's "4 posts" were 1 posted + 3 cancelled, and 33 of the last 48
  // scheduled_posts rows are cancelled — the scalar was counting posts that will never go out.
  let scheduledPosts = [];
  let posts_today_p;
  if (countsMode) {
    posts_today_p = cnt(sb.from("scheduled_posts").select("id", {
      count: "exact",
      head: true
    }).gte("scheduled_at", todayIso).lt("scheduled_at", tomorrowIso).not("status", "in", "(cancelled,failed)"));
  } else {
    const { data } = await sb.from("scheduled_posts").select("id,post_text,post_format,platform,scheduled_at,status,error_message").gte("scheduled_at", todayIso).lt("scheduled_at", tomorrowIso).order("scheduled_at", {
      ascending: true
    }).limit(20);
    scheduledPosts = data ?? [];
    posts_today_p = Promise.resolve(scheduledPosts.length);
  }
  // --- outreach_health.linkedin ---
  // needs_reply is the one scalar counts mode shares with the full payload, so it always runs;
  // the rest of the health counters are full-mode only.
  const needs_reply_p = cnt(sb.from("outreach_prospects").select("id", {
    count: "exact",
    head: true
  }).eq("needs_manual_reply", true));
  let fresh_supply = 0, sends_today = 0, accepts_today = 0, replies_today = 0, stuck = 0;
  let tasks = [];
  if (!countsMode) {
    fresh_supply = await cnt(sb.from("outreach_prospects").select("id", {
      count: "exact",
      head: true
    }).eq("stage", "enriched"));
    sends_today = await cnt(sb.from("outreach_messages").select("id", {
      count: "exact",
      head: true
    }).eq("channel", "linkedin").gte("sent_at", todayIso));
    accepts_today = await cnt(sb.from("outreach_prospects").select("id", {
      count: "exact",
      head: true
    }).gte("connected_at", todayIso));
    replies_today = await cnt(sb.from("outreach_prospects").select("id", {
      count: "exact",
      head: true
    }).gte("last_reply_at", todayIso));
    stuck = await cnt(sb.from("outreach_messages").select("id", {
      count: "exact",
      head: true
    }).not("send_blocked_reason", "is", null).is("sent_at", null));
    // --- urgent_tasks ---
    // priority enum in this DB is null/normal/high; actionable statuses are open/pending
    const { data: taskRows } = await sb.from("dashboard_tasks").select("id,title,source,priority,due_date,status").eq("priority", "high").in("status", [
      "open",
      "pending"
    ]).order("due_date", {
      ascending: true,
      nullsFirst: false
    }).limit(20);
    tasks = taskRows ?? [];
  }
  // --- content_performance ---
  // Repointed 2026-07-17 from own_posts -> own_posts_scored (gap report ADD 3): superset
  // view, actively re-scored, same field names the Swift app already decodes. post_text /
  // num_impressions / posted_at are guaranteed non-null (verified 0% null across 221 rows);
  // num_likes/num_comments/pillar kept for byte-compat but are optional/sparse downstream.
  let recentPosts = [];
  if (!countsMode) {
    const { data } = await sb.from("own_posts_scored").select("id,post_text,posted_at,num_impressions,num_likes,num_comments,pillar").order("posted_at", {
      ascending: false
    }).limit(8);
    recentPosts = data ?? [];
  }
  // --- outreach_queue: next leads ready for a connection request ---
  // enriched + not blacklisted + not skipped + connection not yet sent; best first.
  const queueFilter = (q)=>q.eq("stage", "enriched").eq("blacklisted", false).is("skip_state", null).is("connection_sent_at", null);
  // counts mode takes the total only — never the named rows.
  let queueRows = [];
  if (!countsMode) {
    const { data } = await queueFilter(sb.from("outreach_prospects").select("id,name,title,company,icp_score,send_priority,trigger_type,matched_offer")).order("send_priority", {
      ascending: true
    }).order("icp_score", {
      ascending: false
    }).limit(10);
    queueRows = data ?? [];
  }
  const outreach_queue_total_p = cnt(queueFilter(sb.from("outreach_prospects").select("id", {
    count: "exact",
    head: true
  })));
  // --- content_calendar: rolling window (today-2 .. today+14) of scheduled content ---
  // Every lane the dashboard calendar shows is a scheduled_posts row; classify each by
  // its clickup_task_id: an lm_drafts_v2 id → lead magnet, a carousel_drafts id → carousel.
  let calRows = [];
  if (!countsMode) {
    const calStart = new Date(startOfToday.getTime() - 2 * 86400_000).toISOString();
    const calEnd = new Date(startOfToday.getTime() + 14 * 86400_000).toISOString();
    const { data: calRowsRaw } = await sb.from("scheduled_posts").select("id,post_text,post_format,platform,scheduled_at,status,error_message,clickup_task_id").gte("scheduled_at", calStart).lt("scheduled_at", calEnd).order("scheduled_at", {
      ascending: true
    }).limit(60);
    const taskIds = (calRowsRaw ?? []).map((p)=>p.clickup_task_id).filter(Boolean);
    let lmIds = new Set();
    let carouselIds = new Set();
    if (taskIds.length) {
      const { data: lmHit } = await sb.from("lm_drafts_v2").select("id").in("id", taskIds);
      lmIds = new Set((lmHit ?? []).map((r)=>r.id));
      const { data: carHit } = await sb.from("carousel_drafts").select("id").in("id", taskIds);
      carouselIds = new Set((carHit ?? []).map((r)=>r.id));
    }
    calRows = (calRowsRaw ?? []).map((p)=>{
      const tid = p.clickup_task_id;
      const kind = tid && lmIds.has(tid) ? "lm" : tid && carouselIds.has(tid) ? "carousel" : "post";
      return {
        ...p,
        kind
      };
    });
  }
  // --- urgencies: the ONE act-now list — leads where the ball is in Ivan's court ---
  // Redesign (2026-07-11): the Brief's hero surface is "what leads need me first",
  // not content approvals. Two honest signals, both noise-filtered:
  //   reply     — the last message in the thread is INBOUND (they spoke last, Ivan
  //               owes a reply). This is the real "waiting on you" signal;
  //               needs_manual_reply is barely maintained and raw stage='replied'
  //               is polluted with dead threads, so we compute ball-in-court from
  //               the message log and drop vetted-dead + reaction-only rows.
  //   approve    — a hypertarget scan+DM built and parked, waiting on Ivan's approve.
  // REMOVED 2026-07-25: the scan-open / "handraiser" signal. A report open is passive
  // interest, not a ball-in-court item; it inflated the act-now count and the badge with
  // rows Ivan could not act on. Dropped at the source so array, count, badge and push all
  // agree by construction (one definition, not three).
  // Post-filters below (also 2026-07-25), applied ONCE to the assembled array:
  //   aging     — anything waiting >72h leaves the array AND the count (aging_count).
  //   autoreply — a CLEAR out-of-office / autoresponder reply STAYS in the array flagged
  //               is_autoreply:true but never counts toward the badge (autoreplies_count).
  // NOTE: "stuck/blocked" was considered and deliberately excluded — 98 blocked
  // sends are ~all systemic (em_dash linter, revival/vetting kills, superseded),
  // i.e. the system correctly suppressing low-quality/dead sends, NOT leads that
  // need Ivan. Surfacing them would recreate the clutter this redesign removes.
  const urgencies = [];
  const clean = (s)=>(s ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  // Out-of-office / autoresponder detection. Deliberately CONSERVATIVE — a false positive
  // silently hides a real reply from the badge, which is worse than counting one bot mail.
  // Only unambiguous constructions; run against the FULL reply text, not the 140-char snippet.
  // ("back on <weekday|date>" is date-anchored on purpose: a bare /back on \w+/ would eat
  // "back on track", "back on this", "back on Monday's thread" style human replies.)
  const AUTOREPLY_RX = [
    // strongest signal: the inbound ingestor already stamps recognised autoresponders.
    // Verified live 2026-07-25 — 4 of 12 reply-urgencies carried this prefix.
    /\[ooo_autoreply\]/i,
    /\bout of (the )?office\b/i,
    /\bOOO\b/i,
    /\bauto[-\s]?repl/i,
    /\bauto[-\s]?respon/i,
    /\bautomat(ic|ed|ically)[^.]{0,20}\brepl/i,
    /\bannual leave\b/i,
    /\bon vacation\b/i,
    /\bon holiday\b/i,
    /\b(parental|maternity|paternity) leave\b/i,
    /\bunavailable until\b/i,
    /\baway until\b/i,
    /\baway from (the|my) (office|desk)\b/i,
    /\blimited access to (my )?e-?mail\b/i,
    // "back/returning ON <date>" only — date-anchored. A bare weekday ("back Monday") and a
    // bare "I'm away" are NOT enough: both appear in genuine human replies ("I'm away with
    // the kids this weekend but let's talk Monday"), and a false demote silently hides a real
    // lead from the badge, which is worse than counting one autoresponder.
    /\b(back|returning|will return|i return)\s+on\s+(the\s+)?(\d{1,2}(st|nd|rd|th)?\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    // "I'm away / currently away" only when an out-of-office qualifier follows close behind.
    /\b(i\s?['’]?m|i am|currently)\s+away\b[^.!?]{0,60}\b(until|office|desk|return|back|e-?mail)\b/i
  ];
  const isAutoreply = (t)=>AUTOREPLY_RX.some((rx)=>rx.test(t ?? ""));
  // Plain declines (2026-08-21). Read the 9 rows the welcome called "replies waiting, answer those
  // before anything else": "Not even close. Sorry", "I already use one solution for linkedin
  // outreach", "don't really need that many leads", "inbound and outreach is the one category V8
  // builds in house" — four of nine were polite noes. Same treatment as autoreplies: the row STAYS
  // in the array flagged is_decline (the cockpit can still show it), but it leaves every count the
  // app speaks or badges. Deliberately CONSERVATIVE and anchored: only unambiguous closers; a
  // question mark anywhere keeps the row (a decline that asks something still wants an answer).
  const DECLINE_RX = [
    /\bnot interested\b/i,
    /\bno,? thank(s| you)\b/i,
    /\bnot even close\b/i,
    /\bnot (right now|at (this|the) (time|moment))\b/i,
    /\bwe'?re (pretty |all |fully |well )?(covered|set|good|sorted)( on (that|this))?\b/i,
    /\balready (use|have|work with|working with) (one|a|an|another|our own)\b/i,
    /\bdon'?t (really )?need\b/i,
    /\b(build|builds|do|does|handle|handles|run|runs|keep|keeps)\b[^.?!]{0,30}\bin[- ]house\b/i,
    /\bbest of luck\b/i,
    /\bplease,? don'?t (offer|pitch|sell)\b/i,
    /\bnot (a|the right) fit\b/i,
    /\bi'?ll pass\b/i
  ];
  const isDecline = (t)=>{
    const s = t ?? "";
    if (s.includes("?")) return false;
    return DECLINE_RX.some((rx)=>rx.test(s));
  };
  try {
    // 1) reply-waiting — MIRRORS THE INBOX. Ivan 2026-08-22: "inbox and db is source of
    //    truth, not the morning app". This is a port of ivan-inbox `src/lib/inbox.ts`
    //    needsAnswer(): same regexes, same 14-day window, same "a discarded draft or a pushed
    //    (snoozed) draft IS an answer", same clocks (eventTime = sent_at ?? created_at for
    //    inbound, sent_at for sends), same inner join on campaigns (no campaign = not in the
    //    inbox). No ICP floor and no 72h cut in the COUNT: the number spoken in the morning
    //    must equal what the DMs tab shows as "To answer". Keep the two in lockstep — if the
    //    inbox rule changes, change THIS, never the other way round.
    const STALE_DAYS = 14;
    const sinceIso = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
    const DEAD_TAG = /^\s*\[(ooo_autoreply|negative|negative_optout|unsubscribe|auto_reply)/i;
    const OOO_TEXT = /\b(out of (the )?office|on holiday|on annual leave|on leave until|currently away|away from my desk|i am ooo|back in the office)\b/i;
    const SIGNOFF = /^[\s\p{P}]*(many )?(thanks?|thank you|thx|cheers|no worries|you'?re welcome|ok(ay)?|got it|sounds good|will do|appreciate it)[\s\p{P}\p{Extended_Pictographic}]*(ivan|iv[áa]n|mattan|matt)?[\s\p{P}\p{Extended_Pictographic}]*$/iu;
    const REACTION = /^\s*\S+\s+reacted\b|^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}]+$/u;
    const INBOX_DECLINE = /\b(no thanks|not interested|i'?m retired|i am retired|i quit|please remove|remove our details|do not (send|contact|text)|never text me again|unsubscribe|not at that stage)\b/i;
    const CLOSED_STAGES = new Set([
      "archived",
      "skipped",
      "disqualified",
      "unsubscribed",
      "blacklisted"
    ]);
    const DISCARD_REASON = "discarded_in_inbox";
    const RACE_HOLD_PREFIX = "post_approval_race:";
    const isRealReply = (t)=>{
      const x = (t ?? "").trim();
      if (!x) return false;
      return !DEAD_TAG.test(x) && !OOO_TEXT.test(x) && !REACTION.test(x) && !INBOX_DECLINE.test(x) && !SIGNOFF.test(x);
    };
    const evt = (m)=>m.sent_at ?? m.created_at;
    // PostgREST clamps every select at 1000 rows; page explicitly.
    const pageAll = async (build)=>{
      const out = [];
      for(let from = 0; from < 20000; from += 1000){
        const { data } = await build(from, from + 999);
        out.push(...data ?? []);
        if (!data || data.length < 1000) break;
      }
      return out;
    };
    const inWin = await pageAll((a, b)=>sb.from("outreach_messages").select("prospect_id,message_text,created_at,sent_at").eq("direction", "inbound").or(`sent_at.gte.${sinceIso},created_at.gte.${sinceIso}`).order("created_at", {
        ascending: true
      }).order("id", {
        ascending: true
      }).range(a, b));
    const cand = [
      ...new Set(inWin.map((m)=>m.prospect_id).filter(Boolean))
    ];
    if (cand.length) {
      const chunks = [];
      for(let i = 0; i < cand.length; i += 80)chunks.push(cand.slice(i, i + 80));
      const [outAll, prosAll] = await Promise.all([
        Promise.all(chunks.map((c)=>pageAll((a, b)=>sb.from("outreach_messages").select("prospect_id,sent_at,created_at,approved_at,send_blocked_at,send_blocked_reason,snoozed_until,snoozed_at").in("prospect_id", c).eq("direction", "outbound").order("created_at", {
              ascending: true
            }).order("id", {
              ascending: true
            }).range(a, b)))).then((r)=>r.flat()),
        Promise.all(chunks.map((c)=>sb.from("outreach_prospects").select("id,name,company,title,linkedin_url,stage,campaign_id").in("id", c))).then((r)=>r.flatMap((x)=>x.data ?? []))
      ]);
      const campIds = [
        ...new Set(prosAll.map((p)=>p.campaign_id).filter(Boolean))
      ];
      const clientByCampaign = new Map();
      if (campIds.length) {
        const { data: camps } = await sb.from("outreach_campaigns").select("id,client_id").in("id", campIds);
        for (const c of camps ?? [])clientByCampaign.set(c.id, c.client_id ?? "ivan"); // view: coalesce(client_id,'ivan')
      }
      const byP = new Map();
      const slot = (pid)=>{
        let t = byP.get(pid);
        if (!t) {
          t = {
            ins: [],
            outs: []
          };
          byP.set(pid, t);
        }
        return t;
      };
      for (const m of inWin)if (m.prospect_id) slot(m.prospect_id).ins.push(m);
      for (const m of outAll)if (m.prospect_id) slot(m.prospect_id).outs.push(m);
      const nowMs = Date.now();
      for (const p of prosAll){
        if (!p.campaign_id || !clientByCampaign.has(p.campaign_id)) continue; // not in inbox_messages_v
        if (CLOSED_STAGES.has(p.stage)) continue;
        const t = byP.get(p.id);
        if (!t) continue;
        const realIns = t.ins.filter((m)=>isRealReply(m.message_text)).sort((a, b)=>evt(a).localeCompare(evt(b)));
        const lastIn = realIns[realIns.length - 1];
        if (!lastIn) continue;
        const lastInAt = evt(lastIn);
        if (nowMs - Date.parse(lastInAt) > STALE_DAYS * 86400_000) continue;
        // isDraft: unsent, unapproved, not blocked (or a recoverable race hold); archived handled above.
        const drafts = t.outs.filter((m)=>!m.sent_at && !m.approved_at && (!m.send_blocked_at || String(m.send_blocked_reason ?? "").startsWith(RACE_HOLD_PREFIX))).sort((a, b)=>evt(a).localeCompare(evt(b)));
        const draft = drafts[drafts.length - 1];
        // snoozeActive: target time not reached AND nothing inbound since the push.
        if (draft && draft.snoozed_until && Date.parse(draft.snoozed_until) > nowMs && !(draft.snoozed_at && lastInAt > draft.snoozed_at)) continue;
        const discarded = t.outs.filter((m)=>!m.sent_at && m.send_blocked_reason === DISCARD_REASON).map(evt).sort().slice(-1)[0] ?? null;
        if (discarded !== null && discarded > lastInAt) continue;
        const lastSent = t.outs.filter((m)=>m.sent_at).map((m)=>m.sent_at).sort().slice(-1)[0] ?? null;
        if (lastSent !== null && lastSent > lastInAt) continue;
        const client = clientByCampaign.get(p.campaign_id);
        urgencies.push({
          id: `reply:${p.id}`,
          kind: "reply",
          prospect_id: p.id,
          name: p.name ?? "(unknown)",
          company: p.company ?? null,
          title: p.title ?? null,
          linkedin_url: p.linkedin_url ?? null,
          snippet: clean(lastIn.message_text ?? ""),
          waiting_since: lastInAt,
          action_url: p.linkedin_url ?? null,
          client_id: client === "ivan" ? null : client,
          // display-only flags (the broader brief regexes); they no longer change any count
          ...isAutoreply(lastIn.message_text) ? {
            is_autoreply: true
          } : {},
          ...isDecline(lastIn.message_text) ? {
            is_decline: true
          } : {}
        });
      }
      urgencies.sort((a, b)=>(b.waiting_since ?? "").localeCompare(a.waiting_since ?? ""));
    }
    // 2) [REMOVED 2026-07-25] scan hand-raisers (kind:"handraiser", from scan_opens).
    //    A /scan report open is not a ball-in-court item — it made the act-now list and the
    //    badge un-actionable. The whole block (scan_opens + scans + scan_prospect_tokens
    //    reads, bot filter, per-company latest-open fold) is gone; no scan-open row can
    //    reach urgencies. Restore from index.ts.SNAPSHOT-2026-07-25 if this is ever reversed.
    // 3) hypertarget scans built + parked at asset_ready (2026-07-16): the lane
    // reserves the prospect (DM Sequence skips them), builds the scan + DM, sends
    // ONE WhatsApp ping, then waits forever for Ivan's dashboard approve. Ste Bell
    // sat 3 days invisible after a connection note that promised his 3 wins.
    const { data: htRows } = await sb.from("hypertarget_corpus").select("prospect_id,company_slug,built_at").eq("stage", "asset_ready");
    const htIds = (htRows ?? []).map((r)=>r.prospect_id).filter(Boolean);
    if (htIds.length) {
      const { data: htPros } = await sb.from("outreach_prospects").select("id,name,company,linkedin_url,blacklisted").in("id", htIds);
      const hpById = new Map((htPros ?? []).map((p)=>[
          p.id,
          p
        ]));
      for (const r of htRows ?? []){
        const p = hpById.get(r.prospect_id);
        if (!p || p.blacklisted) continue;
        urgencies.push({
          id: `ht:${r.company_slug}`,
          kind: "approve",
          name: p.name ?? r.company_slug,
          company: p.company ?? null,
          title: null,
          linkedin_url: p.linkedin_url ?? null,
          snippet: "scan + DM built, waiting for your approve & send",
          waiting_since: r.built_at ?? null,
          action_url: "https://ivanmanfredi.com/?section=reach&otab=hypertarget"
        });
      }
    }
  } catch (_e) {}
  // --- urgency post-filters ---
  // 2026-08-22 (inbox = source of truth): the 72h splice and the autoreply/decline
  // exclusions no longer change any COUNT — the inbox's needsAnswer() already decided who
  // is owed an answer, and its "To answer" number is what the welcome must say. aging_* and
  // the flag counts stay as information for the follow-ups window / Today tab.
  const AGE_CUTOFF = Date.now() - 72 * 3600_000;
  let aging_count = 0;
  let aging_raw = 0;
  for (const u of urgencies){
    const t = u?.waiting_since ? new Date(u.waiting_since).getTime() : NaN;
    if (Number.isFinite(t) && t < AGE_CUTOFF) {
      aging_raw++;
      if (u.is_autoreply !== true && u.is_decline !== true) aging_count++;
    }
  }
  const autoreplies_count = urgencies.filter((u)=>u.is_autoreply === true).length;
  const declines_count = urgencies.filter((u)=>u.is_decline === true && u.is_autoreply !== true).length;
  const urgencies_count = urgencies.length;
  // replies_waiting = the inbox's "To answer" bucket (kind:"reply" rows, every one of them).
  // NEVER the needs_manual_reply flag (unmaintained column).
  const liveReplies = urgencies.filter((u)=>u.kind === "reply");
  const replies_waiting = liveReplies.length;
  // Per-tenant split of the same rows: own = campaign.client_id 'ivan'/null.
  const replies_waiting_own = liveReplies.filter((u)=>!u.client_id).length;
  const replies_waiting_by_client = {};
  for (const u of liveReplies){
    if (!u.client_id) continue;
    replies_waiting_by_client[u.client_id] = (replies_waiting_by_client[u.client_id] ?? 0) + 1;
  }
  // replies_seen: payload compatibility; the inbox rule EXCLUDES discarded threads, so 0.
  const replies_seen = liveReplies.filter((u)=>u.is_seen === true).length;
  if (countsMode) {
    // Scalars ONLY. No names, no message text, no approve/skip URLs, no k= tokens.
    const [comments_pending, comments_fresh, feed_pending, posts_today, needs_reply, queue_total, wfCount] = await Promise.all([
      comments_pending_p,
      comments_fresh_p,
      feed_pending_p,
      posts_today_p,
      needs_reply_p,
      outreach_queue_total_p,
      workflow_errors_count_p ?? Promise.resolve(null)
    ]);
    const dms_fresh = dmDrafts.filter((d)=>!d.is_aging).length;
    return new Response(JSON.stringify({
      mode: "counts",
      generated_at: nowIso,
      urgencies_count,
      autoreplies_count,
      declines_count,
      aging_count,
      aging_raw,
      needs_reply,
      replies_waiting,
      replies_waiting_own,
      replies_waiting_by_client,
      replies_seen,
      workflow_errors_count: wfCount,
      posts_today,
      queue_total,
      approvals: {
        comments: comments_pending,
        dms: dmDrafts.length,
        feed: feed_pending
      },
      // 2026-08-21: the same queues restricted to rows <= 7d old. The welcome speaks THESE as
      // "drafts to clear"; the all-time numbers above stay for the cockpit's aged view.
      approvals_fresh: {
        comments: comments_fresh,
        dms: dms_fresh,
        feed: feed_pending
      }
    }), {
      headers: cors
    });
  }
  const needs_reply = await needs_reply_p;
  const outreach_queue_total = await outreach_queue_total_p;
  // --- workflow_errors (best-effort; never break the brief) ---
  // The executions endpoint omits the workflow name (only workflowId), so resolve names
  // from /api/v1/workflows once, then group recent errors per workflow with a count.
  let workflow_errors = [];
  if (N8N_KEY) {
    try {
      const nameById = {};
      try {
        const wr = await fetch(`${N8N_HOST}/api/v1/workflows?limit=250`, {
          headers: {
            "X-N8N-API-KEY": N8N_KEY,
            accept: "application/json"
          }
        });
        if (wr.ok) {
          const wj = await wr.json();
          for (const w of wj.data ?? [])nameById[w.id] = w.name;
        }
      } catch (_e) {}
      const r = await fetch(`${N8N_HOST}/api/v1/executions?status=error&limit=30&includeData=false`, {
        headers: {
          "X-N8N-API-KEY": N8N_KEY,
          accept: "application/json"
        }
      });
      if (r.ok) {
        const j = await r.json();
        const byWf = new Map();
        for (const e of j.data ?? []){
          const when = e.stoppedAt ?? e.startedAt;
          if (new Date(when ?? 0).toISOString() < dayAgo) continue;
          const id = e.workflowId ?? "";
          const ex = byWf.get(id);
          if (!ex) {
            byWf.set(id, {
              workflow: nameById[id] ?? e.workflowData?.name ?? "(unknown)",
              last_error_at: when,
              count: 1,
              message: "execution error"
            });
          } else {
            ex.count++;
            if ((when ?? "") > (ex.last_error_at ?? "")) ex.last_error_at = when;
          }
        }
        workflow_errors = [
          ...byWf.values()
        ].sort((a, b)=>(b.last_error_at ?? "").localeCompare(a.last_error_at ?? ""));
      }
    } catch (_e) {}
  }
  // --- client_errors: unresolved client_workflow_errors (best-effort; never break the brief) ---
  // ADD 1 (gap report / build ledger contract, 2026-07-17). Unresolved column is `is_resolved`
  // (boolean) — verified live, no separate `resolved_at`. Client name resolved via
  // client_instances with a COLUMN ALLOWLIST (id,client_name only — that table carries inline
  // API keys, never select=*). ai_analysis is never selected/shipped.
  let client_errors = {
    fresh_count: 0,
    items: [],
    folded_count: 0
  };
  try {
    const { data: cwErrors } = await sb.from("client_workflow_errors").select("id,client_id,workflow_name,severity,occurrence_count,first_seen,last_seen,error_message").eq("is_resolved", false).order("last_seen", {
      ascending: false
    }).limit(500);
    const rows = cwErrors ?? [];
    // fresh_count: unresolved AND last_seen within 24h — the ONLY badge input (never the
    // standing ~56 unresolved total).
    const fresh_count = rows.filter((r)=>new Date(r.last_seen ?? 0).getTime() >= new Date(dayAgo).getTime()).length;
    const sevRank = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    // Fold rule: (severity=low AND occurrence_count<5) OR last_seen older than 7d -> folded.
    // These rows are counted, never shipped.
    const isFolded = (r)=>{
      const lowOcc = r.severity === "low" && (r.occurrence_count ?? 0) < 5;
      const stale7d = new Date(r.last_seen ?? 0).getTime() < sevenDaysAgo;
      return lowOcc || stale7d;
    };
    const kept = rows.filter((r)=>!isFolded(r));
    kept.sort((a, b)=>{
      const sd = (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0);
      if (sd !== 0) return sd;
      return (b.last_seen ?? "").localeCompare(a.last_seen ?? "");
    });
    const clientIds = [
      ...new Set(rows.map((r)=>r.client_id).filter(Boolean))
    ];
    const { data: clientRows } = clientIds.length ? await sb.from("client_instances").select("id,client_name").in("id", clientIds) : {
      data: []
    };
    const nameById = new Map((clientRows ?? []).map((c)=>[
        c.id,
        c.client_name
      ]));
    const firstLine = (s)=>(s ?? "").split("\n")[0].trim().slice(0, 140);
    const items = kept.slice(0, 8).map((r)=>({
        client_name: nameById.get(r.client_id) ?? "(unknown client)",
        workflow_name: r.workflow_name,
        severity: r.severity,
        occurrence_count: r.occurrence_count ?? 0,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        error_line: firstLine(r.error_message)
      }));
    // folded_count covers every unresolved row that did NOT ship in items — both explicit
    // fold-rule matches and any non-folded rows beyond the cap-of-8 (containment comes from
    // the cap; see 01-evidence.md skeptic pass). This keeps the count self-consistent with
    // what's actually hidden rather than only the fold-rule subset.
    client_errors = {
      fresh_count,
      items,
      folded_count: rows.length - items.length
    };
  } catch (_e) {}
  // --- pipeline: content-table jams (status='error') + review aging (best-effort) ---
  // ADD 2 (gap report / build ledger contract, 2026-07-17). Day-1 rule: status='error' ONLY
  // (no 'generating' status exists; 'pending' held out — normal queue buffer, not stuck).
  // Age basis is created_at, NOT updated_at (skeptic pass correction: updated_at can be
  // touched by unrelated field writes and isn't reserved for status transitions).
  // Title columns differ per table: lm_drafts_v2 -> topic, carousel_drafts -> title.
  let pipeline = {
    errors: [],
    review_aging: {
      count: 0,
      oldest_days: 0
    }
  };
  try {
    const ageDays = (iso)=>iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000) : 0;
    const [{ data: lmErr }, { data: carErr }, { data: lmReview }, { data: carReview }] = await Promise.all([
      sb.from("lm_drafts_v2").select("id,topic,created_at").eq("status", "error"),
      sb.from("carousel_drafts").select("id,title,created_at").eq("status", "error"),
      sb.from("lm_drafts_v2").select("id,created_at").eq("status", "review"),
      sb.from("carousel_drafts").select("id,created_at").eq("status", "review")
    ]);
    const errors = [
      ...(lmErr ?? []).map((r)=>({
          id: r.id,
          kind: "lm",
          title: r.topic ?? "(untitled)",
          age_days: ageDays(r.created_at)
        })),
      ...(carErr ?? []).map((r)=>({
          id: r.id,
          kind: "carousel",
          title: r.title ?? "(untitled)",
          age_days: ageDays(r.created_at)
        }))
    ];
    const reviewAges = [
      ...lmReview ?? [],
      ...carReview ?? []
    ].map((r)=>ageDays(r.created_at));
    const oldRev = reviewAges.filter((d)=>d > 7);
    pipeline = {
      errors,
      review_aging: {
        count: oldRev.length,
        oldest_days: oldRev.length ? Math.max(...oldRev) : 0
      }
    };
  } catch (_e) {}
  const payload = {
    generated_at: nowIso,
    urgencies,
    // additive scalars (2026-07-25) — same definition the counts mode and the badge use.
    // Unknown keys are ignored by Swift's Codable, so the Brief decoder is unaffected.
    urgencies_count,
    autoreplies_count,
    declines_count,
    aging_count,
    aging_raw,
    replies_waiting,
    replies_waiting_own,
    replies_waiting_by_client,
    replies_seen,
    // approval-queue freshness (2026-08-02). Unlike aging_count (urgencies), these count
    // rows that are STILL IN the array — an aging draft is owed, not hidden. superseded
    // rows are the only ones actually removed, and they are counted so the drop is visible.
    dm_aging_count,
    comment_aging_count: commentDrafts.filter((d)=>d.is_aging).length,
    dm_superseded_count,
    needs_you: {
      comment_drafts: commentDrafts ?? [],
      dm_drafts: dmDrafts,
      feed_drafts
    },
    today_content: {
      scheduled_posts: scheduledPosts ?? []
    },
    outreach_health: {
      linkedin: {
        fresh_supply,
        sends_today,
        accepts_today,
        replies_today,
        needs_reply,
        stuck
      },
      cold_email: {
        connected: false,
        note: "Smartlead not connected"
      }
    },
    workflow_errors,
    urgent_tasks: tasks ?? [],
    content_performance: {
      recent_posts: recentPosts ?? []
    },
    outreach_queue: {
      items: queueRows ?? [],
      total: outreach_queue_total
    },
    content_calendar: {
      entries: calRows ?? []
    },
    client_errors,
    pipeline
  };
  return new Response(JSON.stringify(payload), {
    headers: cors
  });
}

