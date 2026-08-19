-- 036: Per-client content strategy — the Strategy tab (2026-08-19)
--
-- Ivan, 2026-08-19: "i feel like i need a strategy doc per client that im
-- currently kinda flying... maybe in here we can do a tab strategy besides
-- magnets and styles". He ruled OUT content_prompts (that row set is the
-- generation canon the n8n pipeline reads; this is HIS working strategy, not a
-- prompt) and ruled OUT the client panel at resources.risedtc.com (a client
-- host, where "hidden" is obscurity rather than privacy).
--
-- So: its own table, read and written only by the inbox app, one row per
-- content lane. `client_id` matches ContentLane exactly ('ivan' | 'risedtc' |
-- 'arch') so the Strategy tab reuses the SAME lane state Content/Magnets/Styles
-- already share — no second client vocabulary to keep in sync.
--
-- `sections` is an ORDERED array of {key, title, body}. Ordered, because the
-- sequence is the argument: who we sell to, then the angles that follow from
-- it, then the week that carries them. A jsonb OBJECT would lose that order.
-- Free-text bodies on purpose: nothing machine-reads this, so a schema would
-- only be a thing to fight when the strategy changes shape.

create table if not exists client_strategy (
  client_id text primary key,
  sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table client_strategy enable row level security;

-- Same posture as the rest of the inbox: Ivan is the sole authenticated login.
-- Note what this means and is meant to mean: NOT client-facing. No anon policy,
-- ever. The client board and the RISE panel must never read this table.
drop policy if exists "authenticated all client_strategy" on client_strategy;
create policy "authenticated all client_strategy" on client_strategy
  for all to authenticated using (true) with check (true);

-- Seed rows. Only what Ivan has actually said or ruled is stated as settled;
-- everything else is an explicit blank for him to fill, because a placeholder
-- written in his voice would read as decided a week from now.
insert into client_strategy (client_id, sections) values
('risedtc', $json$[
  {"key":"buyer","title":"Who Mattan sells to","body":"TODO — fill in his buyer in THEIR nouns, not marketer nouns. (Ivan 2026-08-18: buyer vocabulary is not vendor vocabulary; mine it from call transcripts, never hand-author the list.)"},
  {"key":"offer","title":"What he sells","body":"The performance model. TODO — the one-line version Mattan himself uses, plus what it replaces and what it costs."},
  {"key":"angles","title":"Angles that convert","body":"Bottom funnel: the performance model itself — how it works, what it costs, who it is wrong for.\nTeardown: the standard ad-spend / retainer model — what a brand pays for it and what it gets back.\nThese two are the spine. Everything else feeds them."},
  {"key":"week","title":"Week structure","body":"5 pieces of content a week. No lead magnets (Ivan 2026-08-15: \"we are not ready on engagement for that\").\nMix 2 reach / 2 trust / 1 buyers, declared at generation, warn-never-block (ruled 2026-08-17).\nOne case study a week where supply allows; the rest run off the sales calls."},
  {"key":"personal","title":"Personal posts","body":"Roughly 1 every 10 days.\n⚠ Two live constraints: personal drafts were HELD pending Mattan approval as of 2026-08-15 (7 sitting undated), and the Register Gate ceiling is personal <= 2 per trailing 10 drafts. At cadence 5 that is ~1.4 per 10 posts, so this sits on the ceiling with no headroom — a refused brief exits WITHOUT generating and the slot starves silently."},
  {"key":"never","title":"Off-lane — never post this","body":"TODO — the list of topics that are wrong for his feed even when they are true."},
  {"key":"open","title":"Open / undecided","body":"Did Mattan approve the personal drafts? If yes, date them.\nBuyer + offer sections above are still blank."}
]$json$::jsonb),
('ivan', $json$[
  {"key":"buyer","title":"Who I sell to","body":"TODO"},
  {"key":"offer","title":"What I sell","body":"TODO"},
  {"key":"angles","title":"Angles that convert","body":"TODO"},
  {"key":"week","title":"Week structure","body":"TODO"},
  {"key":"never","title":"Off-lane — never post this","body":"TODO"},
  {"key":"open","title":"Open / undecided","body":"TODO"}
]$json$::jsonb),
('arch', $json$[
  {"key":"buyer","title":"Who Arch sells to","body":"TODO"},
  {"key":"offer","title":"What he sells","body":"TODO"},
  {"key":"angles","title":"Angles that convert","body":"TODO"},
  {"key":"week","title":"Week structure","body":"TODO"},
  {"key":"never","title":"Off-lane — never post this","body":"TODO"},
  {"key":"open","title":"Open / undecided","body":"TODO"}
]$json$::jsonb)
on conflict (client_id) do nothing;

-- Restore: drop table client_strategy;
