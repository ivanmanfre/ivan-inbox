import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Keeps `unipile_chats` fed, so every DM in the inbox can carry a LinkedIn chat URL.
//
// Ivan, 2026-08-24: "I ask you for the chat URL, the chat URL, so Mattan can directly
// open the chat." `outreach_messages.unipile_chat_id` is a Unipile id and resolves to
// nothing on linkedin.com. The Unipile chat object ALSO carries `provider_id`, which is
// LinkedIn's own conversation id and the last segment of a messaging thread URL. This
// mirrors that map into Postgres so the inbox (a static site with no API key) can build
// the link with no network call at click time.
//
// Cron-invoked, no input, upsert-only — it never writes to LinkedIn and never touches a
// prospect row. Rerunning it is free.
//
// INCREMENTAL BY CONSTRUCTION: Unipile returns chats newest-first, so a top-up only has
// to walk far enough to pass everything it already knows. It stops after MAX_PAGES, or
// early once a whole page is already on file — a bound on cost, not a correctness risk,
// because the next run picks up whatever a burst pushed past the window.
const MAX_PAGES = 6;
const PAGE = 100;

Deno.serve(async () => {
  try {
    const dsn = Deno.env.get("UNIPILE_DSN") ?? Deno.env.get("FOLLOWER_UNIPILE_DSN");
    const key = Deno.env.get("UNIPILE_KEY") ?? Deno.env.get("FOLLOWER_UNIPILE_KEY");
    if (!dsn || !key) return json({ ok: false, stage: "config", error: "no unipile dsn/key" }, 500);

    const uni = (path: string) =>
      fetch(`https://${dsn}/api/v1${path}`, {
        headers: { "X-API-KEY": key, accept: "application/json" },
      });

    // Read the seats rather than hardcoding them, so a new seat starts syncing on its own.
    const accRes = await uni("/accounts?limit=50");
    if (!accRes.ok) {
      return json({ ok: false, stage: "accounts", status: accRes.status, body: (await accRes.text()).slice(0, 300) }, 502);
    }
    const accounts: string[] = ((await accRes.json()).items ?? [])
      .filter((a: { type?: string }) => (a.type ?? "").toUpperCase() === "LINKEDIN")
      .map((a: { id: string }) => a.id);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const perAccount: Record<string, { seen: number; written: number; pages: number }> = {};
    for (const account of accounts) {
      const stat = { seen: 0, written: 0, pages: 0 };
      perAccount[account] = stat;
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ account_id: account, limit: String(PAGE) });
        if (cursor) q.set("cursor", cursor);
        const res = await uni(`/chats?${q}`);
        if (!res.ok) {
          return json({ ok: false, stage: "chats", account, status: res.status, body: (await res.text()).slice(0, 300) }, 502);
        }
        const body = await res.json();
        const items = (body.items ?? []) as Array<{
          id?: string; provider_id?: string; account_id?: string; attendee_provider_id?: string;
        }>;
        stat.pages++;
        stat.seen += items.length;

        const rows = items
          .filter((c) => c.id && c.provider_id)
          .map((c) => ({
            chat_id: c.id!,
            provider_id: c.provider_id!,
            account_id: c.account_id ?? account,
            attendee_provider_id: c.attendee_provider_id ?? null,
            resolved_at: new Date().toISOString(),
          }));

        // Which of these are actually new? Asked BEFORE the upsert, because the upsert
        // itself cannot tell an insert from a no-op and the early stop depends on knowing.
        let fresh = rows.length;
        if (rows.length) {
          const { data: known } = await supabase
            .from("unipile_chats")
            .select("chat_id")
            .in("chat_id", rows.map((r) => r.chat_id));
          fresh = rows.length - (known?.length ?? 0);

          const { error } = await supabase
            .from("unipile_chats")
            .upsert(rows, { onConflict: "chat_id" });
          if (error) return json({ ok: false, stage: "upsert", account, error: error.message }, 500);
          stat.written += rows.length;
        }

        cursor = body.cursor ?? null;
        if (!cursor || !items.length || fresh === 0) break;
      }
    }

    const { count } = await supabase
      .from("unipile_chats")
      .select("chat_id", { count: "exact", head: true });

    return json({ ok: true, accounts: accounts.length, perAccount, total_rows: count ?? null });
  } catch (e) {
    return json({ ok: false, stage: "exception", error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
