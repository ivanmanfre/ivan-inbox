import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

type Brand = { name?: string; site?: string };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// White-label page for a client sequence (send_config.brand, e.g. SwishDM, RISE):
// the client's name and site, never Ivan's. No brand = the page below, byte-identical.
function brandPage(brand: Brand, title: string, msg: string, sub?: string) {
  const name = esc(String(brand.name));
  const site = /^https:\/\/[^\s"<>]+$/.test(String(brand.site || "")) ? String(brand.site) : "";
  const host = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${name}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:2rem;background:#f5f5f5;color:#111}.card{max-width:480px;background:#fff;border-radius:16px;padding:2.5rem 2rem;text-align:center}.badge{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9b9b9b;margin-bottom:1.25rem}h1{font-size:1.5rem;font-weight:700;margin:0 0 .5rem}p{font-size:1rem;color:#444;margin:.5rem 0}a{color:#111}</style></head><body><div class="card"><div class="badge">${name}</div><h1>${msg}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}${host ? `<p style="margin-top:1.5rem;font-size:.85rem;color:#888"><a href="${esc(site)}">${esc(host)}</a></p>` : ""}</div></body></html>`;
}

function page(title: string, msg: string, sub?: string, brand?: Brand | null) {
  if (brand && brand.name) return brandPage(brand, title, msg, sub);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,'Segoe UI','Space Grotesk',sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:2rem;background:#fff;color:#000}.card{max-width:480px;border:4px solid #000;box-shadow:8px 8px 0 #00E676;padding:2.5rem 2rem;text-align:center}.badge{display:inline-block;padding:.25rem 1rem;background:#000;color:#fff;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:1.5rem}h1{font-size:1.75rem;font-weight:900;text-transform:uppercase;margin:0 0 .5rem}p{font-size:1rem;color:#444;margin:.5rem 0}a{color:#000;text-decoration:underline;text-decoration-color:#00E676;font-weight:700}</style></head><body><div class="card"><div class="badge">Email Preferences</div><h1>${msg}</h1>${sub ? `<p>${sub}</p>` : ""}<p style="margin-top:1.5rem;font-size:.85rem;color:#888"><a href="https://ivanmanfredi.com">ivanmanfredi.com</a></p></div></body></html>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || url.searchParams.get("token");
  if (!token) return new Response(page("Invalid", "Missing token", "This unsubscribe link is malformed."), { status: 400, headers: HTML_HEADERS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Find subscriber by token and mark unsubscribed (RFC 8058 one-click: POST also works)
  const { data: sub, error } = await supabase
    .from("nurture_subscribers")
    .select("id, email, unsubscribed_at, sequence:nurture_sequences(send_config)")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (error || !sub) return new Response(page("Link expired", "Link expired or invalid", "This unsubscribe link is no longer valid."), { status: 404, headers: HTML_HEADERS });
  const brand: Brand | null = (sub as any).sequence?.send_config?.brand ?? null;
  if (sub.unsubscribed_at) return new Response(page("Already unsubscribed", "Already unsubscribed", `${sub.email} was already removed from the sequence.`, brand), { status: 200, headers: HTML_HEADERS });

  // Cancel all pending queue items for THIS subscriber across ALL sequences (since one token = one subscriber row, we also cancel others by email)
  await supabase.from("nurture_subscribers").update({ unsubscribed_at: new Date().toISOString() }).eq("email", sub.email);
  await supabase.from("nurture_queue").update({ status: "cancelled", error_message: "unsubscribed" })
    .eq("status", "pending")
    .in("subscriber_id", (await supabase.from("nurture_subscribers").select("id").eq("email", sub.email)).data?.map((s: any) => s.id) || []);

  // Log event
  await supabase.from("nurture_events").insert({
    subscriber_id: sub.id,
    event_type: "unsubscribed",
    metadata: { source: "web_link" },
  });

  return new Response(page("Unsubscribed", "You're unsubscribed", `${sub.email} will no longer receive the sequence. Thanks for being a subscriber.`, brand), { status: 200, headers: HTML_HEADERS });
});
