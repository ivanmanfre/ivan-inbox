// Public response contains aggregates only. Service-role rows never leave this module.
type Prospect = { id: string; connection_sent_at: string; trigger_type: string | null; note_variant: string | null; lane: string | null; c: { client_id: string | null } | null };
type SendLog = { prospect_id: string; created_at: string; p: Prospect | null };
type Refill = { client_id: string; lane: string; day: string; qualified_in: number };
// Existing campaign registry convention: a present campaign with null client_id is Ivan; missing campaign is unknown.
const seatOf = (p: Prospect) => p.c ? (p.c.client_id ?? "ivan") : null;
const seats = ["ivan", "risedtc", "arch"];
const laneOrder = ["warm_engagers", "cold", "partner", "company_expansion", "signals", "hiring", "retry", "reconnect", "other"];
const dayMs = 86400000, tolerance = 5 * 60000;
const localParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}).formatToParts(date).map(p => [p.type, p.value]));

function midnight(day: string): string {
  const target = Date.parse(day + "T00:00:00Z");
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(utc));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    utc += target - local;
  }
  return new Date(utc).toISOString();
}
export function windows(now: Date) {
  const p = localParts(now), today = `${p.year}-${p.month}-${p.day}`;
  const day = new Date(Date.parse(today + "T00:00:00Z") - dayMs).toISOString().slice(0, 10);
  const utcToday = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  return { day, day_from: midnight(day), day_to: midnight(today),
    weekly_from: new Date(utcToday - 7 * dayMs).toISOString(), weekly_to: new Date(utcToday).toISOString() };
}
function sourceLane(p: Prospect): string {
  const source = `${p.lane ?? ""} ${p.trigger_type ?? ""}`.toLowerCase();
  if (source.includes("company_expansion")) return "company_expansion";
  if (source.includes("partner")) return "partner";
  if (source.includes("cold")) return "cold";
  if (/engag|warm|harvest/.test(source)) return "warm_engagers";
  if (/signal/.test(source)) return "signals";
  if (/hiring/.test(source)) return "hiring";
  return "other";
}
function deliveryLane(p: Prospect): string {
  if (p.note_variant?.includes("retry")) return "retry";
  if (p.note_variant?.includes("reconnect")) return "reconnect";
  return sourceLane(p);
}
// Reconcile both directions; duplicate successful attempts do not inflate delivery.
function confirmed(stamps: Prospect[], logs: SendLog[], from: string, to: string): Prospect[] | null {
  const a = Date.parse(from), b = Date.parse(to);
  const inside = (t: number) => t >= a && t < b;
  const recorded = new Map(stamps.filter(p => inside(Date.parse(p.connection_sent_at))).map(p => [p.id, p]));
  const matched = new Set<string>();
  for (const l of logs) {
    const sent = Date.parse(l.p?.connection_sent_at ?? ""), logged = Date.parse(l.created_at);
    if (!inside(sent) && !inside(logged)) continue;
    if (!Number.isFinite(sent) || Math.abs(sent - logged) > tolerance || !l.p?.c) return null;
    if (!inside(sent)) continue; // successful confirmation just after the calendar boundary
    if (!recorded.has(l.prospect_id)) return null;
    matched.add(l.prospect_id);
  }
  for (const p of recorded.values()) if (!p.c || !matched.has(p.id)) return null;
  return [...recorded.values()].filter(p => seats.includes(seatOf(p)!));
}
export function summarize(stamps: Prospect[], logs: SendLog[], refill: Refill[] | null, now: Date) {
  const w = windows(now);
  const daily = confirmed(stamps, logs, w.day_from, w.day_to);
  const weekly = confirmed(stamps, logs, w.weekly_from, w.weekly_to);
  return { version: 1, generated_at: now.toISOString(), timezone: "Europe/Warsaw", ...w,
    yesterday: daily === null ? null : seats.map(client_id => {
      const own = daily.filter(p => seatOf(p) === client_id);
      const by_lane = laneOrder.map(lane => ({ lane, sent: own.filter(p => deliveryLane(p) === lane).length })).filter(x => x.sent > 0);
      return { client_id, invites: own.length, by_lane };
    }),
    refill: weekly === null || refill === null ? null : [
      { seat: "ivan", label: "your warm lane", lanes: ["harvest", "engager", "warm"], warm: true },
      { seat: "risedtc", label: "RISE warm", lanes: ["engager"], warm: true },
      { seat: "arch", label: "ARCH mixed", lanes: null, warm: false },
    ].map(({ seat, label, lanes, warm }) => ({ label,
      qualified: refill.filter(r => r.client_id === seat && r.day >= w.weekly_from.slice(0, 10) && r.day < w.weekly_to.slice(0, 10) && (!lanes || lanes.includes(r.lane))).reduce((n, r) => n + r.qualified_in, 0),
      invited: weekly.filter(p => seatOf(p) === seat && (!warm || sourceLane(p) === "warm_engagers")).length,
    })) };
}

// Page explicitly: PostgREST's row cap must never turn partial coverage into zero.
async function rows(makeQuery: () => any): Promise<any[] | null> {
  const all: any[] = [];
  for (let page = 0; page < 3; page++) {
    const { data, error } = await makeQuery().range(page * 1000, (page + 1) * 1000 - 1);
    if (error || !Array.isArray(data)) return null;
    all.push(...data);
    if (data.length < 1000) return all;
  }
  return null;
}
export async function loadSpokenOutreach(sb: any, now: Date) {
  const w = windows(now), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  const fields = "id,connection_sent_at,trigger_type,note_variant,lane:enrichment_data->>lane,c:outreach_campaigns(client_id)";
  const from = new Date(Math.min(Date.parse(w.day_from), Date.parse(w.weekly_from)) - tolerance).toISOString();
  const to = new Date(Math.max(Date.parse(w.day_to), Date.parse(w.weekly_to)) + tolerance).toISOString();
  try {
    const [stamps, logs, refill] = await Promise.all([
      rows(() => sb.from("outreach_prospects").select(fields).gte("connection_sent_at", from).lt("connection_sent_at", to).order("id").abortSignal(controller.signal)),
      rows(() => sb.from("outreach_engagement_log").select(`prospect_id,created_at,p:outreach_prospects(${fields})`).eq("action_type", "connection_request").eq("success", true).gte("created_at", from).lt("created_at", to).order("id").abortSignal(controller.signal)),
      rows(() => sb.from("inbox_replacement_v").select("client_id,lane,day,qualified_in").gte("day", w.weekly_from.slice(0, 10)).lt("day", w.weekly_to.slice(0, 10)).order("day").order("client_id").order("lane").abortSignal(controller.signal)),
    ]);
    if (stamps === null || logs === null) return { version: 1, generated_at: now.toISOString(), timezone: "Europe/Warsaw", ...w, yesterday: null, refill: null };
    return summarize(stamps, logs, refill, now);
  } catch {
    return { version: 1, generated_at: now.toISOString(), timezone: "Europe/Warsaw", ...w, yesterday: null, refill: null };
  } finally { clearTimeout(timer); }
}
