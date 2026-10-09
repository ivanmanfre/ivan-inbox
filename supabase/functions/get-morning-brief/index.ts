import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBrief } from "./builder.js";
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Content-Type": "application/json" };
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
// R2 additive cache. The backed-up live builder and its auth/mode contract stay
// intact; gateway JWT validation still runs before this handler. Cache storage
// is service-role only. Full, counts and spoken never share a cache key.
const cacheClient = createClient(SB_URL!, SB_KEY!);
const rebuilding = new Map<string, Promise<Response>>();
function cacheMode(req: Request): string {
  const requested = new URL(req.url).searchParams.get("mode") ?? "full";
  if (requested === "spoken") return "spoken";
  let role = "anon";
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    role = JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).role ?? "anon";
  } catch { /* Same counts-only downgrade as buildBrief. */ }
  return requested === "counts" || !["authenticated","service_role"].includes(role) ? "counts" : "full";
}
function hourKey(): string {
  const d = new Date(); d.setUTCMinutes(0,0,0); return d.toISOString();
}
function rebuild(req: Request, mode: string, hour: string): Promise<Response> {
  const key = mode + ":" + hour;
  const existing = rebuilding.get(key);
  if (existing) return existing.then(r => r.clone());
  const job = buildBrief(req).then(async response => {
    if (response.ok) {
      const payload = await response.clone().json();
      // Cache only the expected builder shape; never turn an error into a copy.
      if (payload && (mode === "spoken" || payload.generated_at) && (mode !== "counts" || payload.mode === "counts")) {
        const { error } = await cacheClient.from("inbox_phone_brief_cache_r2").upsert({ mode, hour, payload, generated_at: payload.generated_at ?? new Date().toISOString() }, { onConflict: "mode,hour" });
        if (error) console.error("brief cache write failed", error.code);
      }
    }
    return response;
  }).finally(() => rebuilding.delete(key));
  rebuilding.set(key, job);
  return job.then(r => r.clone());
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return buildBrief(req);
  const mode = cacheMode(req), hour = hourKey();
  if (new URL(req.url).searchParams.get("refresh") === "1") return rebuild(req, mode, hour);
  let { data, error } = await cacheClient.from("inbox_phone_brief_cache_r2")
    .select("payload,generated_at").eq("mode",mode).eq("hour",hour).maybeSingle();
  if (error) return rebuild(req,mode,hour);
  // At the hour boundary the last copy can paint while the new hourly row is
  // generated. Keep its timestamp. Do not serve copies older than six hours.
  if (!data?.payload) {
    const previous = await cacheClient.from("inbox_phone_brief_cache_r2")
      .select("payload,generated_at").eq("mode",mode)
      .gte("generated_at",new Date(Date.now()-6*60*60_000).toISOString())
      .order("hour",{ ascending: false }).limit(1).maybeSingle();
    if (previous.error || !previous.data?.payload) return rebuild(req,mode,hour);
    data = previous.data;
  }
  if (Date.now() - Date.parse(data.generated_at) > 5 * 60_000) {
    EdgeRuntime.waitUntil(rebuild(req,mode,hour).then(() => undefined).catch(e => console.error("brief refresh failed",String(e))));
  }
  // Existing Swift decoders ignore this additive metadata. Web readers label
  // the copy using the original generated_at, rather than claiming fresh now.
  return new Response(JSON.stringify({ ...data.payload, _cache: { generated_at: data.generated_at, from_cache: true } }), { headers: cors });
});
