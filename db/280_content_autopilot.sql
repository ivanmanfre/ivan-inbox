-- db/280 (2026-10-15): Content Brain autopilot, round 3. SHADOW ONLY for Ivan; off for risedtc / arch / swishdm.
--
-- Ivan 10-11: per-client Sunday autopilot, warnings only, he "does not want to check each post".
-- Ivan 10-12: "be careful with the self updating brain tho to not do retarded decisions".
-- Fact 10-15: 0 of 50 brain drafts were ever scheduled; the planner (content_plan_slots) puts drafts in a week but nothing dates them.
--
-- What it does (content_autopilot_run, weekly from content_autopilot_sunday, pg_cron Sunday 06:00 UTC):
--   1. Reads the target week (next Monday in the lane's clock) from content_plan_week: posts already dated, the week target,
--      the planner's slots. Open = target minus posts already dated. It never moves, re-dates or removes a dated post.
--   2. Candidates (content_autopilot_candidates): the seat's brain drafts (cb34_p2_members) in Review or approved, undated,
--      that pass EVERY check: verifier released with PASS, Review QA gate (cb34_p2_review_block) clear, no invention flag
--      (verifier majority, v32 flags, invented elements, fact check), lint + sameness + length pass, must-carry passed
--      (the verifier's own check, or the 10-15 must-carry replay on the same text, or nothing to carry), body unchanged since
--      the checks (unless Ivan edited it himself), no Drop verdict, no link unless a boosted lead magnet, picture present when
--      the format needs one, at most 30 days old, not planned for another week.
--   3. Picks per open slot by score (Ivan approved/kept > the planner's own pick for this week > clean QA > proven read > fresh),
--      with hard rotation rules: founder stories <= content_plan_config.founder_story_max per week (posts already dated count),
--      no two posts from the same source post or source author in the week or within 21 days, at most 2 of one pillar a week;
--      soft: a different opener than the other picks, a different format than the neighbouring day.
--   4. Days: free weekdays only (the weekday guard's automatic rule, one post a day) at the lane time (Ivan 09:00 Warsaw), and
--      never inside the veto window (veto_hours, default and minimum 48h, from the run time).
--   5. SHADOW: writes what it would do to content_autopilot_runs + content_autopilot_log and posts ONE feed-only summary
--      (family content_plan, source content-plan, push false, via inbox-notify). It writes nothing to carousel_drafts.
--      LIVE (ivan only, not enabled): the same picks go through content_autopilot_schedule_ivan, which is the Inbox's own
--      Schedule write (src/d/content/writes.ts scheduleGuarded: status='scheduled' + scheduled_at, Ivan scope, schedulable
--      status), so the weekday guard, the Bridge publisher, the calendar, the move log and the implicit-verdict trigger all
--      see exactly what a person's Schedule produces. The implicit-verdict trigger records NO keep for it (machine fates are
--      not taste, db/277), so the brain never learns from its own picks; Ivan's later removal/edit/delete is recorded as usual.
--   Clients (risedtc/arch/swishdm): action 'propose_to_board'. Shadow logs 'would_propose' with a suggested day. Live is
--   blocked by a CHECK constraint until a later migration builds the propose step on each client's existing flow
--   (RISE: on the board undated, a person's date arms it; ARCH: on the board, publishes only after Davorin approves). No
--   client message is ever sent by this code.
--
-- Switch Ivan to live: update public.content_autopilot_config set mode = 'live', updated_at = now() where account = 'ivan';
-- Stop everything:     update public.content_autopilot_config set mode = 'off', updated_at = now();
-- Rollback: db/280_content_autopilot_rollback.sql
BEGIN;

-- ===== config: one row per seat, the flag =====
CREATE TABLE IF NOT EXISTS public.content_autopilot_config (
  account text PRIMARY KEY CHECK (account IN ('ivan','risedtc','arch','swishdm')),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')),
  action text NOT NULL CHECK (action IN ('schedule','propose_to_board')),
  lane_time time NOT NULL,
  lane_tz text NOT NULL,
  veto_hours int NOT NULL DEFAULT 48 CHECK (veto_hours >= 48),
  max_picks int NOT NULL DEFAULT 5 CHECK (max_picks BETWEEN 0 AND 7),
  max_draft_age_days int NOT NULL DEFAULT 30 CHECK (max_draft_age_days BETWEEN 1 AND 60),
  source_cooldown_days int NOT NULL DEFAULT 21 CHECK (source_cooldown_days >= 0),
  pillar_max_per_week int NOT NULL DEFAULT 2 CHECK (pillar_max_per_week >= 1),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Only Ivan's lane can go live in this build: the client propose step is not built (see header).
  CONSTRAINT content_autopilot_client_live_not_built CHECK (account = 'ivan' OR mode <> 'live'),
  CONSTRAINT content_autopilot_action_fits_seat CHECK ((account = 'ivan') = (action = 'schedule'))
);
ALTER TABLE public.content_autopilot_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_autopilot_config FROM anon, authenticated;

INSERT INTO public.content_autopilot_config(account, mode, action, lane_time, lane_tz, note) VALUES
  ('ivan',    'shadow', 'schedule',         '09:00', 'Europe/Warsaw',       'Shadow since 2026-10-15. Live = schedules into open slots, veto window 48h.'),
  ('risedtc', 'off',    'propose_to_board', '07:00', 'America/Los_Angeles', 'Mattan never approves; his board is a buffer and a person dating an on-board post arms it. Live propose step not built.'),
  ('arch',    'off',    'propose_to_board', '11:00', 'Europe/Warsaw',       'Publishes only after Davorin approves on his panel. Live propose step not built.'),
  ('swishdm', 'off',    'propose_to_board', '11:00', 'Europe/London',       'No plan config for this seat yet (content_plan_config).')
ON CONFLICT (account) DO NOTHING;

-- ===== must-carry replay verdicts (2026-10-15, ~/.local/state/cb-draft-quality-1015/out/mc_stored.json) =====
-- Drafts released before the verifier's must-carry check existed have no checks.must_carry. The 10-15 replay ran the live
-- judge (3 votes) on their stored text; body_sha256 is the text it judged, so an edited body no longer counts as checked.
CREATE TABLE IF NOT EXISTS public.cb_must_carry_replay (
  draft_id uuid PRIMARY KEY,
  client_id text NOT NULL,
  verdict text NOT NULL,
  carry_pass boolean NOT NULL,
  length_pass boolean NOT NULL,
  body_sha256 text NOT NULL,
  words int,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'replay 2026-10-15 mc_stored.json (cb-brief-must-carry-check v1, 3 votes)',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cb_must_carry_replay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cb_must_carry_replay FROM anon, authenticated;

INSERT INTO public.cb_must_carry_replay(draft_id, client_id, verdict, carry_pass, length_pass, body_sha256, words, items) VALUES
  ('4b9b5661-d639-4441-bc11-89d52b6a3210'::uuid, 'arch', 'SEND BACK', false, true, '2092bfeaca64c6b728003b4c4a95447a605fe46734ee59e1a5085b2fb6ce6135', 143, $j$[{"kind": "hook_shape", "item": "The fake-out opener: ask which agencies to stay away from, promise to name names, then take it back and offer the red flags instead", "carried": false, "not_carried_votes": 3, "why": "The post opens with a plain instruction to vet the agency's roster, with no question about whom to avoid, no promise to name names and no take-back."}, {"kind": "device", "item": "A numbered list of red flags, each a short one-line flag followed by a brief line on what fair looks like or what the reader should do", "carried": false, "not_carried_votes": 3, "why": "There is no numbered list of red flags. The post makes one argument across explained paragraphs instead of short flag-plus-fair-deal lines."}]$j$::jsonb),
  ('cd983727-e343-4dac-bf8d-6af25cd864f7'::uuid, 'arch', 'PASS', true, true, '67c3a64c037ea892f8999d49d4108cdf774e7af92eac189b0fb786d35842cc86', 195, $j$[{"kind": "hook_shape", "item": "A blunt one-line read on where things stand, delivered with insider attitude and ending on a personal note about how he likes to work, followed by a one-line pivot that promises a list of what he's seeing", "carried": true, "not_carried_votes": 0, "why": "Opens with a blunt read on where things stand, adds a personal line on how he likes to work, then pivots in one line to a promised list, the same three beats as the winner's opening."}, {"kind": "device", "item": "A numbered run of headline takeaways, each a short punchy observation as its own line, followed by a brief note on what it means for a UA lead, with one of them undercut by a quick self-deprecating aside about his own misstep", "carried": true, "not_carried_votes": 0, "why": "A numbered run of short headline takeaways, each followed by a brief practical note for the reader, with one undercut by a parenthetical aside admitting his own repeated misstep."}]$j$::jsonb),
  ('277e1038-57a2-427d-8e48-657bbdd6bce9'::uuid, 'arch', 'SEND BACK', false, true, '00a79df1e0c33de641483c1b4c90729ebec4450e330e4f544fce109effdf1802', 112, $j$[{"kind": "hook_shape", "item": "A one-line first-person receipt about a concrete campaign he ran himself, followed on its own line by a short 'and the biggest lesson?' question that holds back the point", "carried": false, "not_carried_votes": 3, "why": "The post opens with a belief statement about building pitch lists, not a first-person receipt about a campaign followed by a held-back 'biggest lesson?' question."}, {"kind": "device", "item": "A run of short fragment lines, one per line, naming the new things teams keep booking, which lands on a challenge question to the reader: if one works, can you explain why?", "carried": false, "not_carried_votes": 3, "why": "There is no run of short fragment lines naming new things teams try, and no challenge question to the reader; the post uses explanatory paragraphs and statements instead."}]$j$::jsonb),
  ('d60f6b09-bb8a-458e-a51d-869c369f8fd4'::uuid, 'arch', 'SEND BACK', false, true, 'e7a0d8b21c99ddaa4fe5831b7dc2ff92b56a40f3715b84e7e8afd0fbd84a9f49', 147, $j$[{"kind": "hook_shape", "item": "Open on a single provocative claim that tells the reader their default assumption about the creator's opening quote is wrong, optionally followed by a line saying the problem is bigger than the obvious reading (more than a bit of haggling room)", "carried": false, "not_carried_votes": 3, "why": "The opener states the author's own practice rather than putting a provocative claim to the reader that their assumption is wrong, and there is no 'bigger than the obvious reading' escalation line, so it reads as a plain claim, not the winne"}, {"kind": "device", "item": "A pre-emptive 'this doesn't mean the crude version' caveat, then a short standalone line that flips the assumption being challenged (the first quote is not the price), set apart on its own so it lands as the post's central reversal", "carried": true, "not_carried_votes": 0, "why": "It has the same pre-emptive 'this doesn't mean the crude version' caveat, followed by a standalone '≠' line that flips the assumption and serves as the central reversal."}]$j$::jsonb),
  ('1c8ecd0b-1744-4d58-a75e-b4145e1892b8'::uuid, 'arch', 'SEND BACK', false, true, 'f6f4927527ef3c4997a331962a350d4e2dea27bc8f249982f67cc3ba0faa0fdb', 151, $j$[{"kind": "hook_shape", "item": "Open on a single direct question about whether the finished campaign holds more than the one number teams take from it. It sets up the post as an answer to that question. Keep it to one or two short lines in his own words, and make it a fresh question rather than the opening shape of his earlier pos", "carried": false, "not_carried_votes": 3, "why": "The post opens on a flat statement about the recap's blended CPI, not a direct question about whether the campaign holds more than one number."}, {"kind": "device", "item": "A closing caveat that names the obvious pushback and draws a clear line on how far the claim goes, stated plainly as where he stands. Here it is a measurement caveat: one creator or one video is too thin a read to drop a market or creator type, so look for a pattern across tries. It is not a warning", "carried": true, "not_carried_votes": 0, "why": "The close names the obvious pushback (one video is too thin a read) and plainly limits the claim to a pattern repeated across tries and markets."}]$j$::jsonb),
  ('c0be59af-6928-44ff-9e6f-3a53c98f4bbe'::uuid, 'arch', 'SEND BACK', false, true, '67ade0cc21c0009e9ee649be5ac1e79bdafa07d46c27d34cddd6445e66201cb0', 172, $j$[{"kind": "hook_shape", "item": "A scale/proof line about the author's own work that earns him the right to teach, followed by a standalone one-line question teasing the lesson or mistake he is about to name", "carried": false, "not_carried_votes": 3, "why": "The post opens with a plain claim ('A lot of influencer bookings get called a \"test\".') instead of a scale/proof line about the author's own work followed by a standalone teaser question."}, {"kind": "device", "item": "After the short fragment lines that list the volume habit (new creator, new market, new format), a pointed challenge question put to the reader: if one of those bookings wins, can they explain why? It exposes the gap between booking more and actually testing.", "carried": false, "not_carried_votes": 3, "why": "There is no run of fragment lines listing the volume habit, and the idea arrives as a statement ('you can't tell which of the three did it') rather than a challenge question put to the reader."}]$j$::jsonb),
  ('46e9ca34-c422-452c-90c5-4aad33264abf'::uuid, 'ivan', 'SEND BACK', false, false, '09c40cebfe835cd48cfd09c9a8f3cd468913e3d3a1413a0c9adde710deb18b68', 237, $j$[{"kind": "hook_shape", "item": "A one-line '60-second ... masterclass' promise that opens the post and sets up compressed, quick-read value about his LinkedIn inbound subject", "carried": false, "not_carried_votes": 3, "why": "Opens with a credential line ('I scale founders' LinkedIn for a living') instead of a '60-second masterclass' promise of compressed, quick-read value."}, {"kind": "device", "item": "A short numbered list of operating rules, each a bare one-line imperative with no explanation, story or stat behind it, so the post reads as fast as the hook promises", "carried": false, "not_carried_votes": 3, "why": "The rules are arrow bullets, each followed by an explanation or reason ('Posting more than that is gonna lower your impressions'), so they aren't bare one-line imperatives that read fast."}]$j$::jsonb),
  ('9e7a8fcf-e0fb-423b-beff-019a84f888bd'::uuid, 'ivan', 'SEND BACK', false, true, '249a67617a0cc1d6e0ac12ec69ce7bce66c73a469e535904cde55e0837be5c20', 296, $j$[{"kind": "hook_shape", "item": "A one-line claim that every account he runs goes through the same fixed set of steps, followed by a short line promising to walk through them in the order the work actually happens", "carried": false, "not_carried_votes": 3, "why": "The opener zooms in on a single step, the value resource, and only then pulls back to the path, so the 'every client runs through the same fixed steps' claim is replaced by a different move. The promise line is the only part that survives."}, {"kind": "device", "item": "A numbered walk-through of the process in working order, where each step gets a short plain label and then one concrete, practical detail from how he actually does that step, so the post reads like a real operating sequence rather than advice", "carried": true, "not_carried_votes": 0, "why": "It walks through the process in working order. Each step gets a short plain label and a concrete detail from practice, such as the paid-ads scan, small email batches and the 60-day wait, so it reads as a real operating sequence even though "}]$j$::jsonb),
  ('7b8c449f-c8d6-45ac-a6bd-61bc0159701b'::uuid, 'ivan', 'SEND BACK', false, false, '22fe7d8b620770c864e44f1d419d154e455fe7a89b73d1250df9e44e608656dc', 318, $j$[{"kind": "device", "item": "The impressive-looking offer laid out as a quick stacked list of its parts, each shown as the selling point the agency thinks it is, then deflated with a short dry jab that turns that part into the problem (extra accounts mean bans are expected, the setter means a stranger answers). The list sets th", "carried": false, "not_carried_votes": 3, "why": "The stacked offer list is there, but the short dry jab that deflates it is replaced by explained paragraphs that argue each part is a problem, so the quick punchline undercut is lost."}]$j$::jsonb),
  ('71828386-9b5e-4114-a4a6-13ea22f37309'::uuid, 'ivan', 'SEND BACK', false, true, '0da61063eb7a2730ab3b4deecb90ed78bef52875c9f1d20cd865290ba304a2f8', 237, $j$[{"kind": "hook_shape", "item": "A one-line flat rule up top, stated as a command before any context, telling the reader never to open outreach with their heaviest personalized piece (the per-prospect video or deep audit). It is said his way, with no all-caps.", "carried": false, "not_carried_votes": 3, "why": "The post opens with context ('With every new client, the first thing I decide...') and then a general principle, not a flat command; the 'save the heavy stuff' instruction only appears at the very end."}, {"kind": "device", "item": "The cause-and-effect chain in short plain lines. Every first message needs someone's prep time, client work eats that time first, so outreach only runs in the quiet weeks. It is argued as his own reasoning, not as a story about a founder.", "carried": true, "not_carried_votes": 0, "why": "The same chain appears as his own reasoning in short plain lines: each first message needs prep time, client work takes that time first, so outreach stops in busy weeks."}]$j$::jsonb),
  ('1c285e37-9a76-4a7c-bcd2-302633d06143'::uuid, 'ivan', 'PASS', true, true, '999a825f4e751fdbd29c16f60bd73bd02b3f6c29e197729744c838b08d05f374', 292, $j$[{"kind": "hook_shape", "item": "A rule-first opening: one blunt line that tells the reader never to open outreach with their heaviest personalized piece (the per-prospect video or deep audit), stated as a flat rule in Ivan's own words before any explanation.", "carried": true, "not_carried_votes": 0, "why": "It opens with a blunt one-line rule against leading with the heavy personalized piece, given before any explanation; it is phrased as 'send it second' rather than 'never', but it does the same job."}, {"kind": "device", "item": "The busy-week cause-and-effect chain in short plain lines: the first message needs someone's prep time, client work piles up and that time goes first, so outreach only runs in the quiet weeks. Each step leads to the next, ending on the consequence, argued as opinion without anyone's story.", "carried": true, "not_carried_votes": 0, "why": "The same chain is here: prep-dependent first message, client work eats those hours first, outreach runs only in quiet weeks. Each step leads to the next and it ends on the consequence, argued as opinion without a story."}]$j$::jsonb),
  ('15a0615b-3de3-4d62-bde3-e9b4bc030bc7'::uuid, 'ivan', 'SEND BACK', false, false, 'cf286442b474d8be79e7156709cd008c2ffccaea8230d6d1cf5dc1c553d1440a', 198, $j$[{"kind": "hook_shape", "item": "A one-line '60-second ... masterclass' promise that frames the post as compressed, start-here value on LinkedIn inbound, stated as the opening line on its own", "carried": true, "not_carried_votes": 0, "why": "Opens on its own line with the same compressed '60-second ... masterclass' promise, applied to LinkedIn inbound."}, {"kind": "device", "item": "A short run of numbered rules, each one bare imperative line with no explanation, reason or story attached, so the list reads as fast operating rules and the post stays short", "carried": false, "not_carried_votes": 3, "why": "The rules are arrow bullets, and each one comes with explanations, reasons and anecdotes, so they read as explained paragraphs rather than bare one-line imperative rules."}]$j$::jsonb),
  ('3ebab6a4-0237-4a20-b0d0-4b6a0a3d4fc6'::uuid, 'ivan', 'SEND BACK', true, false, '99f7c7c6a51be331016faab9d6fe0c9d016c7715f7c66426276dd7c062182d1e', 308, $j$[{"kind": "device", "item": "The offer laid out as a quick stacked list of its impressive-sounding parts, read straight like a pitch, then punctured one part at a time with short, dry, deflating lines. The list should feel like a machine, and each knock-down should show the impressive part as the problem.", "carried": true, "not_carried_votes": 1, "why": "The same stacked pitch list is read straight, then knocked down part by part (accounts, setter, volume, guarantee), each shown as the problem; the bans-are-expected jab echoes the winner's. The knock-downs are wordier than the winner's one-"}]$j$::jsonb),
  ('68e8af37-932f-457b-a9e9-6be4f69faa3b'::uuid, 'ivan', 'SEND BACK', false, true, 'b999d7102a58f73918cb262544a28032e09cbbe7ab50465988e9a9ae2ded0a0e', 258, $j$[{"kind": "hook_shape", "item": "A one-line contrarian rule as the opener: tell the reader flatly never to open outreach with a common, effortful move (the heavy per-prospect personalized piece), stated as a command in his own casual words, with no all-caps gimmick.", "carried": false, "not_carried_votes": 3, "why": "The post opens with a plain context line about choosing a resource, not a flat 'never open with the heavy personalized piece' command; the rule only appears later as a soft suggestion ('I'd keep the scan & move it later')."}, {"kind": "device", "item": "The quiet-weeks chain: a short run of plain cause-and-effect lines showing that the heavy prep step depends on someone's spare time, that this time disappears when client work piles up, and that outreach therefore only runs in the slow weeks. This mechanism is what makes the rule land, so it should ", "carried": true, "not_carried_votes": 0, "why": "The same plain cause-and-effect run is there: the prep depends on someone's spare time, client work eats that time, so outreach only runs in slow weeks."}]$j$::jsonb),
  ('28978825-a547-47cb-9cec-9793130234c1'::uuid, 'ivan', 'SEND BACK', false, false, '97c156d7b8ea3366a953bd150c1a94fb2fc0edfc0a9a275f793cff6eaff467d2', 166, $j$[{"kind": "hook_shape", "item": "A one-line '60-second ... masterclass' promise on Ivan's subject: open by promising a whole LinkedIn inbound lesson compressed into something you can read in a minute, then go straight to the list", "carried": false, "not_carried_votes": 3, "why": "The opening is a credential plus a plain intro line, not a promise of a whole lesson compressed into a one-minute read."}, {"kind": "device", "item": "A short numbered run of rules he'd start a founder on, each a bare one-line imperative with no explanation, story or stat behind it, so the post reads as a fast checklist", "carried": false, "not_carried_votes": 3, "why": "There is a run of rules, but each one is followed by explanation and reasoning ('LinkedIn limits you when you post a lot', 'there are just more people active'), so it reads as explained paragraphs rather than a fast checklist of bare one-li"}]$j$::jsonb),
  ('4468f9e7-df95-4fae-81c2-83dd37b72890'::uuid, 'ivan', 'SEND BACK', true, false, '103c364a968c741231682e952cd982a316dc843b3a98e3f35a8d76bdf22965d1', 305, $j$[{"kind": "device", "item": "Lay out the offer founders get pitched as a short stacked list of its parts, one plain line each, so it looks like an impressive machine. Then knock each part down with a short, dry, sarcastic jab, so the very things that make the offer look sophisticated become the punchline.", "carried": true, "not_carried_votes": 0, "why": "The offer is stacked as plain arrow lines that read like an impressive machine, then flipped so each part becomes the problem, with the same banned-accounts jab; the knockdowns run longer and are less dry, but the move is recognisable."}]$j$::jsonb),
  ('c3debf3b-6238-49ad-b39c-b26ab0f8e376'::uuid, 'ivan', 'PASS', true, true, '61fd9b1a0ab035dc47608fec428a120a06da9113b6924c3f87dacbbaa356b975', 310, $j$[{"kind": "hook_shape", "item": "A sweeping promise to show how to get the result for anyone, whatever they sell, then a short tease, then the payoff on its own line that there is no playbook. The promise is set up only to be overturned.", "carried": true, "not_carried_votes": 0, "why": "The sweeping 'for anyone, whatever you sell' promise is overturned by 'There is no playbook' on its own line. The short tease is skipped, but the fake-out move is clearly recognisable."}, {"kind": "device", "item": "The same tactic shown side by side with opposite outcomes: it works for one, and the identical move flops for another. This makes 'it depends on context' concrete before naming what decides it. Here it is a clearly marked hypothetical of two founders running the same LinkedIn playbook.", "carried": true, "not_carried_votes": 0, "why": "A marked hypothetical runs the identical tactic side by side with opposite outcomes, then names what decides it ('What decides it is who's there engaging')."}]$j$::jsonb),
  ('4e8b08b4-e618-4933-a689-3fb0db57558e'::uuid, 'risedtc', 'SEND BACK', false, true, '22649255d700a781cab39f4418d5cb853ac4b7bd6bdd8f202f654982cc538069', 162, $j$[{"kind": "hook_shape", "item": "A reassurance opener that tells the reader the problem isn't their fault, followed straight away by an outside source's blunt verdict that Meta itself has gotten worse. Here that means CTR looks great while each real customer costs more.", "carried": false, "not_carried_votes": 3, "why": "The post opens with a directive ('Set your max CAC before a DOLLAR moves into retargeting') instead of telling the reader it isn't their fault, and the Northbeam CTR stat comes later as scene-setting rather than as an immediate outside verd"}, {"kind": "device", "item": "The fix laid out as a numbered list in priority order, announced as the order he would tackle things in. Each step is a short heading with a few terse, concrete one-line moves under it, not explained in paragraphs.", "carried": true, "not_carried_votes": 0, "why": "The fix is a numbered, sequenced list announced as what they do first, with terse one-line concrete moves rather than explanatory paragraphs, so it is the same prioritized-steps device despite having no sub-bullets."}]$j$::jsonb),
  ('ea551193-d59d-44c6-bada-4dd793cea340'::uuid, 'risedtc', 'SEND BACK', false, false, 'cd72f9a326717853aeb748c0e5960ac3fbeb46b1c9bbf6fcdc1f46f103a3d6d0', 122, $j$[{"kind": "hook_shape", "item": "A forecast label alone on the first line, followed by a contrarian one-line claim that the best-paid media buyers won't be the ones who know the most platform mechanics but the ones who know what the platform's numbers are hiding.", "carried": true, "not_carried_votes": 0, "why": "A forecast label stands alone on line one, followed by a contrarian one-liner that devalues the button-knowing buyer, the same opening move as the winner."}, {"kind": "device", "item": "A run of terse list lines, each just a few words with no explanation, naming what this buyer catches or distrusts (PMax quietly retargeting, branded search in disguise, true break-even ROAS, a max CAC). Each item is a fragment, not a sentence, and none is explained, so the post stays short.", "carried": false, "not_carried_votes": 3, "why": "There is no run of bare fragment lines; the items are numbered and each is followed by explanatory sentences, so the terse list is replaced by explained paragraphs."}]$j$::jsonb),
  ('144e2a82-e09b-43b3-825a-673c9a86e594'::uuid, 'risedtc', 'SEND BACK', false, true, 'e13b9f16e6d6c973f13a40de40f0adb7147cf799e7b07ad8f37bde7d11d6c404', 148, $j$[{"kind": "hook_shape", "item": "A two-line how-to promise that claims both sides of the trade-off at once: first line says how to keep doing the broad, hands-off thing, second line says you still get control over who you reach. Mattan fills it with his own subject (running broad on Meta without it turning into remarketing), with t", "carried": true, "not_carried_votes": 0, "why": "The opening is still a how-to promise that claims both sides at once: keep running broad with the big auction pool, but control who you reach so it doesn't become remarketing."}, {"kind": "device", "item": "A closing recap block that compresses the whole post into a few short, standalone one-line rules, one per step, with no explanation, so the reader can screenshot the method without rereading the steps. In Mattan's version each line restates one of his own steps.", "carried": false, "not_carried_votes": 3, "why": "The post ends on a diagnostic note about checking the audience segment breakdown, with no closing block of one-line rules restating the steps."}]$j$::jsonb),
  ('e4987796-7e43-4034-9a10-ab4aca4ac5cd'::uuid, 'risedtc', 'SEND BACK', false, true, '527dcdc5752e35013dc66d6c039ec4f550968f7f0dfecb7df01c847265adcf5b', 123, $j$[{"kind": "device", "item": "A blunt two-beat close that turns the lesson back on the reader: first, that their customers already want the easy subscribe option; then, flatly, that the reader is the one making the choice too hard. Said in Mattan's own words, as the line the post lands on before the question to the reader.", "carried": false, "not_carried_votes": 3, "why": "The post goes from the fix ('I'd give the box one default frequency...') straight to the question, with no two-beat close saying customers already want to subscribe and the reader is the one making the choice too hard."}]$j$::jsonb),
  ('57863002-b9c6-45ae-880e-8ff905f247eb'::uuid, 'risedtc', 'SEND BACK', false, true, '10bdee424afd4ce868c5183d44d38d8335aa949afce83a78f1576b7f98ed5a1f', 176, $j$[{"kind": "hook_shape", "item": "A reassurance opener that takes the blame off the reader: first tell them the drop in results isn't their fault, then a line saying the platform itself got worse for everyone. Mattan says both lines his own way, framed as rising cost rather than saturation.", "carried": true, "not_carried_votes": 0, "why": "Same two-beat opener: it clears the reader of blame, then says the platform got worse for everyone, framed as rising cost."}, {"kind": "device", "item": "A ranked fix list of the levers the brand controls, introduced as the order he'd work them in. Each numbered lever gets a few short one-line action bullets underneath, with no long explanation, so the reader can see what to do first, second and third.", "carried": false, "not_carried_votes": 3, "why": "There is a numbered 'Where we start' list, but each lever gets an explained paragraph instead of short one-line action bullets, so the scannable fix-list device is swapped out."}]$j$::jsonb),
  ('254d701b-8517-4f06-9f66-3947610293fc'::uuid, 'risedtc', 'PASS', true, true, 'ae6eca794c0d7adb3cf6065b22d4b5a45b46318be165cf1c20f095833e8cceea', 190, $j$[{"kind": "device", "item": "The whole prompt sits right in the post, ready to copy and paste with no gate, link or comment ask. It is a labeled block that gives the AI a role, a task, a bracketed slot for the reader's own customer language, short numbered rules and a table it must output. The reader leaves with a working tool,", "carried": true, "not_carried_votes": 0, "why": "The full prompt is pasted in with no gate or link. It is a labeled block with a role, a task, a bracketed slot for the reader's own customer language, short numbered rules and a required output table."}]$j$::jsonb)
ON CONFLICT (draft_id) DO NOTHING;

-- ===== run + log =====
CREATE TABLE IF NOT EXISTS public.content_autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL,
  week_start date,
  mode text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  ran_at timestamptz NOT NULL DEFAULT now(),
  target int,
  dated_before int,
  open_before int,
  picked int NOT NULL DEFAULT 0,
  scheduled int NOT NULL DEFAULT 0,
  eligible int,
  outcome text NOT NULL,
  summary text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected jsonb NOT NULL DEFAULT '[]'::jsonb,
  notify jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS content_autopilot_runs_recent ON public.content_autopilot_runs(account, ran_at DESC);
ALTER TABLE public.content_autopilot_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_autopilot_runs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.content_autopilot_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.content_autopilot_runs(id) ON DELETE CASCADE,
  account text NOT NULL,
  week_start date NOT NULL,
  mode text NOT NULL,
  slot_n int NOT NULL,
  plan_slot_id uuid,
  slot_day date,
  slot_at timestamptz,
  draft_id uuid,
  title text,
  action text NOT NULL CHECK (action IN ('would_schedule','scheduled','would_propose','not_scheduled','error')),
  score numeric,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_autopilot_log_run ON public.content_autopilot_log(run_id);
CREATE INDEX IF NOT EXISTS content_autopilot_log_draft ON public.content_autopilot_log(draft_id);
ALTER TABLE public.content_autopilot_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_autopilot_log FROM anon, authenticated;

-- ===== candidates: every brain draft of the seat that could take a slot, with what it failed =====
CREATE OR REPLACE FUNCTION public.content_autopilot_candidates(p_account text, p_week date, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '30s'
AS $function$
DECLARE
  cfg public.content_autopilot_config%ROWTYPE;
  v_ids uuid[]; v_brain jsonb := '{}'::jsonb; b jsonb; r record; out jsonb := '[]'::jsonb;
  f text[]; wn text[]; why text[]; sc numeric; inv jsonb; chk jsonb; mc jsonb; bv3 jsonb; v_carry text; age int; rd jsonb;
BEGIN
  SELECT * INTO cfg FROM public.content_autopilot_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no autopilot config for %', p_account; END IF;

  SELECT array_agg(d.id) INTO v_ids
    FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE m.client_id = p_account
     AND (CASE WHEN p_account = 'ivan' THEN d.client_id IS NULL ELSE d.client_id = p_account END)
     AND d.status IN ('review','approved') AND d.scheduled_at IS NULL AND d.published_at IS NULL
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'deleted_by_operator' = 'true', false)
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'internal_test' = 'true', false);
  IF v_ids IS NULL THEN RETURN out; END IF;
  BEGIN
    SELECT coalesce(jsonb_object_agg(x.draft_id::text, x.brain), '{}'::jsonb) INTO v_brain
      FROM public.content_plan_brain_items(p_account, v_ids, p_now) x;
  EXCEPTION WHEN others THEN v_brain := '{}'::jsonb;  -- fail closed below: no brain facts = 'fact check unreadable'
  END;

  FOR r IN
    SELECT d.id, d.status, d.type, coalesce(nullif(d.title,''), left(d.post_body, 80)) AS title, d.post_body, d.image_urls, d.slides, d.pdf_url,
           CASE WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy ELSE '{}'::jsonb END AS tax, d.qa, d.created_at,
           m.state, m.validation AS val, m.source_ref, m.brief,
           public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author') AS author,
           encode(sha256(convert_to(coalesce(d.post_body, ''), 'UTF8')), 'hex') AS sha,
           (SELECT v.verdict FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id) AS verdict,
           (SELECT v.source FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id) AS verdict_source,
           mr.verdict AS mr_verdict, mr.carry_pass AS mr_carry, mr.length_pass AS mr_len, mr.body_sha256 AS mr_sha,
           (SELECT s.week_start FROM public.content_plan_slots s WHERE s.account = p_account AND s.idea_source = 'carousel_drafts'
               AND s.idea_ref = d.id::text AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1) AS planned_week,
           (SELECT s.id FROM public.content_plan_slots s WHERE s.account = p_account AND s.idea_source = 'carousel_drafts'
               AND s.idea_ref = d.id::text AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1) AS plan_slot_id
      FROM public.carousel_drafts d
      JOIN public.cb34_p2_members m ON m.draft_id = d.id
      LEFT JOIN public.cb_must_carry_replay mr ON mr.draft_id = d.id
     WHERE d.id = ANY (v_ids)
  LOOP
    f := '{}'; wn := '{}'; why := '{}'; sc := 0;
    b := v_brain -> (r.id::text);
    chk := CASE WHEN jsonb_typeof(r.val -> 'checks') = 'object' THEN r.val -> 'checks' ELSE '{}'::jsonb END;

    -- 1. verifier released it
    IF r.state IS DISTINCT FROM 'released' OR coalesce(r.val ->> 'verdict', '') <> 'PASS' THEN
      f := f || ('the verifier did not release it (' || coalesce(r.state, '?') || ', ' || coalesce(r.val ->> 'verdict', 'no verdict') || ')');
    END IF;
    -- 2. Review QA gate (db/277)
    IF public.cb34_p2_review_block(r.qa, r.tax) IS NOT NULL THEN
      f := f || ('the QA gate holds it (' || public.cb34_p2_review_block(r.qa, r.tax) || ')');
    END IF;
    -- 3. invention
    inv := chk -> 'invention';
    IF jsonb_typeof(inv) <> 'object' OR coalesce(inv ->> 'pass', '') <> 'true' THEN
      f := f || 'the invention check did not pass'::text;
    ELSIF (jsonb_typeof(inv -> 'majority') = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(inv -> 'majority') e WHERE e.value = 'true'))
       OR (jsonb_typeof(inv -> 'v32') = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(inv -> 'v32') e WHERE e.value = 'true'))
       OR (jsonb_typeof(inv -> 'invented_elements') = 'array' AND jsonb_array_length(inv -> 'invented_elements') > 0) THEN
      f := f || 'an invention flag is raised'::text;
    END IF;
    IF b IS NULL THEN
      f := f || 'its fact check could not be read'::text;
    ELSIF coalesce(b -> 'flags' ->> 'fact_fail', '') = 'true' THEN
      f := f || 'the fact check failed'::text;
    END IF;
    -- 4. deterministic checks
    IF coalesce(chk -> 'lint' ->> 'pass', 'true') = 'false' THEN f := f || 'the copy lint failed'::text; END IF;
    IF coalesce(chk -> 'sameness' ->> 'pass', 'true') = 'false' THEN f := f || 'too close to the source post'::text; END IF;
    IF coalesce(chk -> 'length' ->> 'pass', 'true') = 'false' THEN f := f || 'the length check failed'::text; END IF;
    -- 5. must-carry
    mc := chk -> 'must_carry';
    bv3 := CASE WHEN r.brief ->> 'brief_version' = 'cb51-v3' AND jsonb_typeof(r.brief -> 'brief_v3') = 'object' THEN r.brief -> 'brief_v3' END;
    IF jsonb_typeof(mc) = 'object' THEN
      v_carry := CASE WHEN mc ->> 'pass' = 'true' THEN 'verifier' ELSE 'missed' END;
    ELSIF r.mr_verdict IS NOT NULL THEN
      v_carry := CASE WHEN r.mr_sha <> r.sha THEN 'replay_stale' WHEN r.mr_carry AND r.mr_len THEN 'replay' ELSE 'missed_replay' END;
    ELSIF bv3 IS NOT NULL AND bv3 ? 'carry_version' AND coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(bv3 -> 'must_carry') = 'array' THEN bv3 -> 'must_carry' END), 0) = 0 THEN
      v_carry := 'nothing_to_carry';
    ELSE
      v_carry := 'never';
    END IF;
    IF v_carry = 'missed' THEN f := f || 'it misses what the winner had to carry (verifier)'::text;
    ELSIF v_carry = 'missed_replay' THEN f := f || ('it misses what the winner had to carry (15 Oct replay' || CASE WHEN NOT r.mr_len THEN ', length too' ELSE '' END || ')');
    ELSIF v_carry = 'replay_stale' THEN f := f || 'the post changed after the must-carry replay'::text;
    ELSIF v_carry = 'never' THEN f := f || 'the must-carry check never ran on it'::text;
    END IF;
    -- 6. the text that was checked is the text that would post
    IF r.val ->> 'input_body_sha256' IS DISTINCT FROM r.sha THEN
      IF r.tax ->> 'human_edited' = 'true' THEN wn := wn || 'you edited it after the checks ran'::text;
      ELSE f := f || 'the post changed after the checks ran'::text; END IF;
    END IF;
    -- 7. Ivan's own word
    IF r.verdict = 'drop' THEN f := f || 'you dropped it'::text; END IF;
    -- 8. link rule (links only on a lead magnet boosted with paid ads)
    IF coalesce(r.post_body ~* '(https?://|www\.)[^\s]+', false) AND coalesce(r.tax ->> 'paid_boost', '') <> 'true' THEN
      f := f || 'it carries a link'::text;
    END IF;
    -- 9. picture the format needs
    IF r.type = 'single_image' AND coalesce(cardinality(r.image_urls), 0) = 0 THEN f := f || 'it needs a picture and has none'::text; END IF;
    IF r.type IN ('carousel','pdf','document') AND coalesce(cardinality(r.image_urls), 0) = 0 AND r.pdf_url IS NULL
       AND coalesce(jsonb_typeof(r.slides) = 'array' AND jsonb_array_length(r.slides) > 0, false) = false THEN
      f := f || 'its deck is not built'::text;
    END IF;
    -- 10. freshness and other weeks
    age := (p_now::date - r.created_at::date);
    IF age > cfg.max_draft_age_days THEN f := f || ('older than ' || cfg.max_draft_age_days || ' days'); END IF;
    IF r.planned_week IS NOT NULL AND r.planned_week <> p_week THEN
      f := f || ('planned for the week of ' || to_char(r.planned_week, 'FMDD Mon'));
    END IF;
    IF coalesce(cardinality(r.image_urls), 0) = 0 AND r.type = 'text' THEN wn := wn || 'text only, no picture'::text; END IF;

    -- score (only explains the order; every pick already passed every check)
    IF r.status = 'approved' OR (r.verdict = 'keep' AND r.verdict_source <> 'implicit') THEN sc := sc + 100; why := why || 'you approved it'::text; END IF;
    IF r.planned_week = p_week THEN sc := sc + 50; why := why || 'the planner put it in this week'::text; END IF;
    IF b -> 'qa' ->> 'outcome' = 'passed' THEN sc := sc + 10; why := why || 'QA passed first time'::text;
    ELSIF b -> 'qa' ->> 'outcome' = 'recovered' THEN sc := sc + 5; why := why || 'QA passed after one rewrite'::text; END IF;
    rd := b -> 'read';
    IF jsonb_typeof(rd) = 'object' AND rd ->> 'proven' = 'true' AND coalesce(rd ->> 'small', 'false') <> 'true'
       AND (rd ->> 'rate') ~ '^[0-9.]+$' AND (rd ->> 'base') ~ '^[0-9.]+$' AND (rd ->> 'rate')::numeric > (rd ->> 'base')::numeric THEN
      sc := sc + 15; why := why || ('its kind of post (' || coalesce(rd ->> 'dim', '?') || ' ' || coalesce(rd ->> 'val', '?') || ') is proven above your usual');
    END IF;
    sc := sc + greatest(0, 10 - age / 3.0);
    IF r.source_ref LIKE 'outlier:%' THEN why := why || ('adapts a niche outlier by ' || coalesce(b -> 'brief' ->> 'author', r.author, 'an unnamed author')); END IF;
    IF v_carry IN ('verifier','replay') THEN why := why || 'carries what made the winner work'::text; END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'draft_id', r.id, 'title', r.title, 'status', r.status, 'type', r.type,
      'pillar', r.tax ->> 'pillar', 'founder', coalesce(r.tax ->> 'pillar' = 'personal', false),
      'opener', b -> 'angle' ->> 'opener', 'source_ref', r.source_ref, 'author', r.author,
      'author_name', b -> 'brief' ->> 'author', 'created_at', r.created_at, 'age_days', age,
      'must_carry', v_carry, 'planned_week', r.planned_week, 'plan_slot_id', r.plan_slot_id,
      'eligible', cardinality(f) = 0, 'fails', to_jsonb(f), 'warnings', to_jsonb(wn),
      'score', round(sc, 1), 'why', to_jsonb(why)));
  END LOOP;
  RETURN out;
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_candidates(text, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_autopilot_candidates(text, date, timestamptz) TO service_role;

-- ===== LIVE write for Ivan's lane: the Inbox's own Schedule (src/d/content/writes.ts scheduleGuarded) =====
CREATE OR REPLACE FUNCTION public.content_autopilot_schedule_ivan(p_draft uuid, p_at timestamptz, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_at timestamptz; v_mode text;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
  SELECT mode INTO v_mode FROM public.content_autopilot_config WHERE account = 'ivan';
  IF v_mode IS DISTINCT FROM 'live' THEN RAISE EXCEPTION 'autopilot for ivan is %, not live: nothing scheduled', coalesce(v_mode, 'missing'); END IF;
  -- the move log (content_plan_record_move) names the planner, not Ivan, as who set the time
  PERFORM set_config('content_plan.actor', 'planner', true);
  PERFORM set_config('content_plan.move_reason', left('autopilot: ' || coalesce(p_reason, ''), 300), true);
  UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = p_at
   WHERE id = p_draft AND client_id IS NULL AND status IN ('review','approved','scheduled') AND published_at IS NULL
   RETURNING scheduled_at INTO v_at;
  PERFORM set_config('content_plan.actor', '', true);
  PERFORM set_config('content_plan.move_reason', '', true);
  IF v_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_schedulable'); END IF;
  RETURN jsonb_build_object('ok', true, 'scheduled_at', v_at, 'requested_at', p_at, 'shifted_by_weekday_guard', v_at IS DISTINCT FROM p_at);
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_schedule_ivan(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;

-- ===== the run =====
CREATE OR REPLACE FUNCTION public.content_autopilot_run(p_account text, p_week date DEFAULT NULL, p_now timestamptz DEFAULT now(),
  p_notify boolean DEFAULT true, p_trigger text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '90s'
AS $function$
#variable_conflict use_variable
DECLARE
  cfg public.content_autopilot_config%ROWTYPE; pcfg public.content_plan_config%ROWTYPE;
  v_run uuid := gen_random_uuid(); v_today date; v_week date; st jsonb; w jsonb; dated jsonb; planned jsonb; cands jsonb;
  target int; n_dated int; v_open int; n_slots int; n_elig int; founder_n int; founder_max int;
  dated_days date[] := '{}'; day_fmt jsonb := '{}'::jsonb; free_days date[] := '{}'; veto_days date[] := '{}';
  srcs text[] := '{}'; authors text[] := '{}'; pillar_n jsonb := '{}'::jsonb; openers text[] := '{}'; picked_ids uuid[] := '{}';
  picks jsonb := '[]'::jsonb; warnings jsonb := '[]'::jsonb; rejected jsonb := '[]'::jsonb; skip jsonb := '{}'::jsonb;
  c jsonb; best jsonb; best_sc numeric; adj numeric; why_skip text; k int; i int; dd date; v_day date; v_at timestamptz;
  fmt_prev text; fmt_next text; res jsonb; n_sched int := 0; v_summary text; v_lines text := ''; v_title text; v_payload jsonb;
  v_url text; v_secret text; v_req bigint; v_notify jsonb; v_outcome text; v_action text; p jsonb; v_reason text; s jsonb;
  lab text := CASE p_account WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' WHEN 'arch' THEN 'Arch' ELSE p_account END;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
  SELECT * INTO cfg FROM public.content_autopilot_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no autopilot config for %', p_account; END IF;
  v_today := (p_now AT TIME ZONE cfg.lane_tz)::date;
  v_week := coalesce(p_week, v_today + (8 - extract(isodow FROM v_today)::int));
  IF extract(isodow FROM v_week) <> 1 THEN RAISE EXCEPTION 'week must start on a Monday: %', v_week; END IF;
  IF cfg.mode = 'off' THEN
    INSERT INTO public.content_autopilot_runs(id, account, week_start, mode, trigger, outcome, summary)
    VALUES (v_run, p_account, v_week, 'off', p_trigger, 'off', 'Autopilot is off for this seat.');
    RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'mode', 'off');
  END IF;
  IF cfg.mode = 'live' AND cfg.action <> 'schedule' THEN RAISE EXCEPTION 'client live step is not built'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('content-autopilot:' || p_account, 0));
  INSERT INTO public.content_autopilot_runs(id, account, week_start, mode, trigger, outcome) VALUES (v_run, p_account, v_week, cfg.mode, p_trigger, 'running');
  v_action := CASE WHEN cfg.action = 'propose_to_board' THEN 'would_propose' WHEN cfg.mode = 'live' THEN 'scheduled' ELSE 'would_schedule' END;

  SELECT * INTO pcfg FROM public.content_plan_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no plan config for %', p_account; END IF;
  founder_max := pcfg.founder_story_max;
  st := public.content_plan_week(p_account, p_now);
  SELECT x INTO w FROM jsonb_array_elements(st -> 'weeks') x WHERE (x ->> 'start')::date = v_week;
  IF w IS NULL THEN RAISE EXCEPTION 'the week of % is outside the plan horizon', v_week; END IF;
  target := (w ->> 'target')::int;
  dated := coalesce(w -> 'posts', '[]'::jsonb);
  planned := coalesce(w -> 'planned', '[]'::jsonb);
  n_dated := jsonb_array_length(dated);
  v_open := greatest(target - n_dated, 0);
  n_slots := least(v_open, cfg.max_picks);

  -- what the dated posts already take: days, formats, founder count, pillars, sources
  FOR p IN SELECT * FROM jsonb_array_elements(dated) LOOP
    IF p ->> 'day' IS NOT NULL THEN
      dated_days := dated_days || (p ->> 'day')::date;
      day_fmt := day_fmt || jsonb_build_object(p ->> 'day', coalesce(p ->> 'format', '?'));
    END IF;
  END LOOP;
  founder_n := (SELECT count(*) FROM jsonb_array_elements(dated) x WHERE coalesce((x ->> 'founder')::boolean, false));
  SELECT coalesce(jsonb_object_agg(t.pillar, t.n), '{}'::jsonb) INTO pillar_n FROM (
    SELECT d.taxonomy ->> 'pillar' AS pillar, count(*) AS n FROM public.carousel_drafts d
     WHERE d.id IN (SELECT (x ->> 'draft_id')::uuid FROM jsonb_array_elements(dated) x WHERE x ->> 'draft_id' IS NOT NULL)
       AND jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'pillar' IS NOT NULL GROUP BY 1) t;
  SELECT coalesce(array_agg(DISTINCT m.source_ref) FILTER (WHERE m.source_ref LIKE 'outlier:%'), '{}'),
         coalesce(array_agg(DISTINCT public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author'))
                  FILTER (WHERE public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author') IS NOT NULL), '{}')
    INTO srcs, authors
    FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE m.client_id = p_account AND (CASE WHEN p_account = 'ivan' THEN d.client_id IS NULL ELSE d.client_id = p_account END)
     AND d.status IN ('review','approved','scheduled','published')
     AND coalesce(d.published_at, d.scheduled_at) >= (v_week - cfg.source_cooldown_days)::timestamp AT TIME ZONE cfg.lane_tz
     AND coalesce(d.published_at, d.scheduled_at) <  (v_week + 7 + cfg.source_cooldown_days)::timestamp AT TIME ZONE cfg.lane_tz;

  -- free weekdays (automatic dates stay weekday-only, one post a day) outside the veto window
  FOR i IN 0..4 LOOP
    dd := v_week + i;
    CONTINUE WHEN dd = ANY (dated_days);
    IF ((dd::timestamp + cfg.lane_time) AT TIME ZONE cfg.lane_tz) < p_now + make_interval(hours => cfg.veto_hours) THEN
      veto_days := veto_days || dd; CONTINUE;
    END IF;
    free_days := free_days || dd;
  END LOOP;

  cands := public.content_autopilot_candidates(p_account, v_week, p_now);
  n_elig := (SELECT count(*) FROM jsonb_array_elements(cands) x WHERE (x ->> 'eligible')::boolean);
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id', x -> 'draft_id', 'title', left(x ->> 'title', 90), 'fails', x -> 'fails')
           ORDER BY (x ->> 'created_at') DESC), '[]'::jsonb)
    INTO rejected FROM jsonb_array_elements(cands) x WHERE NOT (x ->> 'eligible')::boolean;

  FOR k IN 1..n_slots LOOP
    best := NULL; best_sc := NULL;
    FOR c IN SELECT x FROM jsonb_array_elements(cands) x WHERE (x ->> 'eligible')::boolean AND NOT ((x ->> 'draft_id')::uuid = ANY (picked_ids)) LOOP
      why_skip := NULL;
      IF (c ->> 'founder')::boolean AND founder_n >= founder_max THEN
        why_skip := 'founder stories are at the cap of ' || founder_max || ' this week';
      ELSIF c ->> 'source_ref' LIKE 'outlier:%' AND c ->> 'source_ref' = ANY (srcs) THEN
        why_skip := 'its source post is already used this week or within ' || cfg.source_cooldown_days || ' days';
      ELSIF c ->> 'author' IS NOT NULL AND c ->> 'author' = ANY (authors) THEN
        why_skip := 'another post from ' || coalesce(c ->> 'author_name', c ->> 'author') || ' is already used this week or within ' || cfg.source_cooldown_days || ' days';
      ELSIF c ->> 'pillar' IS NOT NULL AND coalesce((pillar_n ->> (c ->> 'pillar'))::int, 0) >= cfg.pillar_max_per_week THEN
        why_skip := 'already ' || cfg.pillar_max_per_week || ' ' || (c ->> 'pillar') || ' posts this week';
      END IF;
      IF why_skip IS NOT NULL THEN skip := skip || jsonb_build_object(c ->> 'draft_id', why_skip); CONTINUE; END IF;
      adj := (c ->> 'score')::numeric - CASE WHEN c ->> 'opener' IS NOT NULL AND c ->> 'opener' = ANY (openers) THEN 15 ELSE 0 END;
      IF best IS NULL OR adj > best_sc OR (adj = best_sc AND c ->> 'created_at' > best ->> 'created_at') THEN best := c; best_sc := adj; END IF;
    END LOOP;

    IF best IS NULL THEN
      INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, action, reasons, warnings)
      VALUES (v_run, p_account, v_week, cfg.mode, k, 'not_scheduled',
        jsonb_build_array(CASE WHEN n_elig = 0 THEN 'no brain draft passed every check'
                               ELSE 'no draft left that passes every check and the rotation rules' END),
        CASE WHEN skip <> '{}'::jsonb THEN jsonb_build_array(jsonb_build_object('held_back_by_rotation', skip)) ELSE '[]'::jsonb END);
      CONTINUE;
    END IF;
    IF cardinality(free_days) = 0 THEN
      INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, draft_id, title, action, score, reasons)
      VALUES (v_run, p_account, v_week, cfg.mode, k, (best ->> 'draft_id')::uuid, best ->> 'title', 'not_scheduled', best_sc,
        jsonb_build_array('no free weekday left at least ' || cfg.veto_hours || 'h ahead'));
      CONTINUE;
    END IF;
    -- day: the first free weekday whose neighbours carry a different format; else the first free weekday
    v_day := NULL;
    FOREACH dd IN ARRAY free_days LOOP
      fmt_prev := day_fmt ->> ((dd - 1)::text); fmt_next := day_fmt ->> ((dd + 1)::text);
      IF coalesce(fmt_prev, '') <> (best ->> 'type') AND coalesce(fmt_next, '') <> (best ->> 'type') THEN v_day := dd; EXIT; END IF;
    END LOOP;
    s := '[]'::jsonb;
    IF v_day IS NULL THEN v_day := free_days[1]; s := s || jsonb_build_array('two ' || (best ->> 'type') || ' posts on back-to-back days'); END IF;
    free_days := array_remove(free_days, v_day);
    v_at := (v_day::timestamp + cfg.lane_time) AT TIME ZONE cfg.lane_tz;

    picked_ids := picked_ids || (best ->> 'draft_id')::uuid;
    day_fmt := day_fmt || jsonb_build_object(v_day::text, best ->> 'type');
    IF (best ->> 'founder')::boolean THEN founder_n := founder_n + 1; END IF;
    IF best ->> 'source_ref' LIKE 'outlier:%' THEN srcs := srcs || (best ->> 'source_ref'); END IF;
    IF best ->> 'author' IS NOT NULL THEN authors := authors || (best ->> 'author'); END IF;
    IF best ->> 'pillar' IS NOT NULL THEN pillar_n := pillar_n || jsonb_build_object(best ->> 'pillar', coalesce((pillar_n ->> (best ->> 'pillar'))::int, 0) + 1); END IF;
    IF best ->> 'opener' IS NOT NULL THEN openers := openers || (best ->> 'opener'); END IF;

    picks := picks || jsonb_build_array(best || jsonb_build_object('slot_n', k, 'day', v_day, 'at', v_at, 'adj_score', best_sc, 'pick_warnings', (best -> 'warnings') || s));
  END LOOP;

  -- write: shadow and client = log only; live (ivan) = the Inbox's Schedule write, one savepoint per pick
  FOR p IN SELECT * FROM jsonb_array_elements(picks) LOOP
    res := NULL; v_reason := 'week of ' || to_char(v_week, 'FMDD Mon') || ', slot ' || (p ->> 'slot_n');
    IF cfg.mode = 'live' AND cfg.action = 'schedule' THEN
      BEGIN
        res := public.content_autopilot_schedule_ivan((p ->> 'draft_id')::uuid, (p ->> 'at')::timestamptz, v_reason);
      EXCEPTION WHEN others THEN res := jsonb_build_object('ok', false, 'error', SQLERRM);
      END;
      IF coalesce((res ->> 'ok')::boolean, false) THEN n_sched := n_sched + 1; END IF;
    END IF;
    INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, plan_slot_id, slot_day, slot_at, draft_id, title,
      action, score, reasons, warnings, result)
    VALUES (v_run, p_account, v_week, cfg.mode, (p ->> 'slot_n')::int, (p ->> 'plan_slot_id')::uuid, (p ->> 'day')::date, (p ->> 'at')::timestamptz,
      (p ->> 'draft_id')::uuid, p ->> 'title',
      CASE WHEN res IS NULL THEN v_action WHEN (res ->> 'ok')::boolean THEN 'scheduled' ELSE 'error' END,
      (p ->> 'adj_score')::numeric, p -> 'why', coalesce(p -> 'pick_warnings', '[]'::jsonb),
      jsonb_build_object('must_carry', p ->> 'must_carry', 'source_ref', p ->> 'source_ref', 'author', coalesce(p ->> 'author_name', p ->> 'author'),
        'pillar', p ->> 'pillar', 'opener', p ->> 'opener', 'format', p ->> 'type', 'write', res));
  END LOOP;

  -- warnings: the plan's own (empty pillar, no proof, photos, LM due, founder cap) + what the autopilot could not do
  -- plan warnings that are about this week, or about the seat as a whole (no proof, no photos, empty pillar); not other weeks' days
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO warnings FROM jsonb_array_elements(coalesce(st -> 'warnings', '[]'::jsonb)) x
   WHERE x ->> 'code' IN ('no_fresh_proof', 'no_photos', 'empty_topic_area')
      OR EXISTS (SELECT 1 FROM generate_series(0, 6) g WHERE (x ->> 'text') LIKE '%' || to_char(v_week + g, 'FMDD Mon') || '%');
  IF jsonb_array_length(picks) < n_slots THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'unfilled',
      'text', (n_slots - jsonb_array_length(picks)) || ' of ' || n_slots || ' open slots stay empty: '
        || CASE WHEN n_elig = 0 THEN 'no brain draft passed every check' ELSE 'not enough drafts pass every check and the rotation rules' END));
  END IF;
  IF cardinality(veto_days) > 0 AND v_open > 0 THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'veto_window',
      'text', (SELECT string_agg(to_char(x, 'Dy FMDD Mon'), ', ') FROM unnest(veto_days) x) || ' left free: less than ' || cfg.veto_hours || 'h ahead'));
  END IF;
  FOR s IN SELECT x FROM jsonb_array_elements(planned) x LOOP
    c := (SELECT y FROM jsonb_array_elements(cands) y WHERE y ->> 'draft_id' = s ->> 'draft_id');
    IF c IS NOT NULL AND NOT (c ->> 'eligible')::boolean THEN
      warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'planned_draft_failed', 'draft_id', c -> 'draft_id',
        'text', 'Planned "' || left(c ->> 'title', 60) || '" not used: ' || (c -> 'fails' ->> 0)));
    END IF;
  END LOOP;
  IF n_elig < target THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'thin_supply',
      'text', CASE WHEN n_elig = 0 THEN 'No brain draft passes every check right now' WHEN n_elig = 1 THEN 'Only 1 brain draft passes every check right now'
                   ELSE 'Only ' || n_elig || ' brain drafts pass every check right now' END));
  END IF;

  -- one summary line, plain words
  v_outcome := CASE WHEN v_open = 0 THEN 'week_full' WHEN jsonb_array_length(picks) = 0 THEN 'no_supply' ELSE 'ok' END;
  SELECT coalesce(string_agg(to_char((x ->> 'day')::date, 'Dy FMDD Mon') || ' ' || left(cfg.lane_time::text, 5) || ' "' || left(x ->> 'title', 70) || '"', '; '
           ORDER BY (x ->> 'day')), '') INTO v_lines FROM jsonb_array_elements(picks) x;
  v_title := 'Autopilot' || CASE WHEN cfg.mode = 'shadow' THEN ' (shadow)' ELSE '' END || ' · ' || lab || ' · week of ' || to_char(v_week, 'FMDD Mon');
  v_summary := CASE
    WHEN v_open = 0 THEN 'Nothing to schedule: the week already has ' || n_dated || ' of ' || target || ' posts.'
    WHEN jsonb_array_length(picks) = 0 THEN 'Nothing to schedule: ' || v_open || ' open slot' || CASE WHEN v_open = 1 THEN '' ELSE 's' END || ', no draft passed every check.'
    WHEN cfg.action = 'propose_to_board' THEN 'Autopilot would propose: ' || v_lines || '.'
    WHEN cfg.mode = 'shadow' THEN 'Autopilot would schedule: ' || v_lines || '. Nothing was scheduled.'
    ELSE 'Autopilot scheduled: ' || v_lines || '. Move or remove any of them in the calendar; each is at least ' || cfg.veto_hours || 'h away.' END;
  IF jsonb_array_length(warnings) > 0 THEN
    v_summary := v_summary || ' Warnings: ' || (SELECT string_agg(rtrim(x ->> 'text', '. '), '; ') FROM jsonb_array_elements(warnings) x) || '.';
  END IF;

  UPDATE public.content_autopilot_runs SET target = target, dated_before = n_dated, open_before = v_open, picked = jsonb_array_length(picks),
         scheduled = n_sched, eligible = n_elig, outcome = v_outcome, summary = v_summary, warnings = warnings, rejected = rejected
   WHERE id = v_run;

  -- ONE feed-only row in Ivan's inbox through the inbox-notify front door (content-plan producer, Plan view link)
  IF p_notify THEN
    v_payload := jsonb_build_object('family', 'content_plan', 'source', 'content-plan',
      'dedupe_key', 'autopilot:' || cfg.mode || ':' || p_account || ':' || v_week::text, 'severity', 'info',
      'title', v_title, 'body', left(v_summary, 1500), 'url', './#exp/d/content/plan?lane=' || p_account,
      'media', jsonb_build_object('kind', 'autopilot', 'mode', cfg.mode, 'account', p_account, 'week', v_week, 'run_id', v_run),
      'push', false);
    BEGIN
      SELECT value INTO v_url FROM public.integration_config WHERE key = 'inbox_notify_url';
      SELECT value INTO v_secret FROM public.integration_config WHERE key = 'inbox_push_secret';
      SELECT net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
               body := v_payload, timeout_milliseconds := 30000) INTO v_req;
      v_notify := jsonb_build_object('request_id', v_req, 'dedupe_key', v_payload ->> 'dedupe_key', 'title', v_title);
    EXCEPTION WHEN others THEN v_notify := jsonb_build_object('error', SQLERRM);
    END;
    UPDATE public.content_autopilot_runs SET notify = v_notify WHERE id = v_run;
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'account', p_account, 'mode', cfg.mode, 'week', v_week, 'target', target,
    'dated', n_dated, 'open', v_open, 'eligible', n_elig, 'picked', jsonb_array_length(picks), 'scheduled', n_sched,
    'summary', v_summary, 'notify', v_notify);
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_run(text, date, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_autopilot_run(text, date, timestamptz, boolean, text) TO service_role;

-- ===== Sunday driver: every seat that is not off; one seat failing never stops the others =====
CREATE OR REPLACE FUNCTION public.content_autopilot_sunday(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a text; out jsonb := '[]'::jsonb; res jsonb;
BEGIN
  FOR a IN SELECT account FROM public.content_autopilot_config WHERE mode <> 'off' ORDER BY account LOOP
    BEGIN
      res := public.content_autopilot_run(a, NULL, p_now, true, 'cron');
    EXCEPTION WHEN others THEN
      INSERT INTO public.content_autopilot_runs(account, mode, trigger, outcome, error)
      VALUES (a, (SELECT mode FROM public.content_autopilot_config WHERE account = a), 'cron', 'error', SQLERRM);
      res := jsonb_build_object('account', a, 'error', SQLERRM);
    END;
    out := out || jsonb_build_array(res);
  END LOOP;
  RETURN out;
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_sunday(timestamptz) FROM PUBLIC, anon, authenticated;

-- ===== what happened to each live pick afterwards (veto audit; empty while shadow) =====
CREATE OR REPLACE VIEW public.content_autopilot_outcomes_v AS
  SELECT l.run_id, l.account, l.week_start, l.slot_at, l.draft_id, l.title, d.status, d.scheduled_at, d.published_at,
         CASE WHEN d.id IS NULL OR coalesce(d.taxonomy ->> 'deleted_by_operator', '') = 'true' THEN 'deleted'
              WHEN d.published_at IS NOT NULL THEN 'published'
              WHEN d.status <> 'scheduled' OR d.scheduled_at IS NULL THEN 'removed'
              WHEN d.scheduled_at <> l.slot_at THEN 'moved'
              ELSE 'kept' END AS outcome,
         (SELECT v.verdict FROM public.cb39_draft_verdicts v WHERE v.draft_id = l.draft_id) AS verdict
    FROM public.content_autopilot_log l
    LEFT JOIN public.carousel_drafts d ON d.id = l.draft_id
   WHERE l.action = 'scheduled';
REVOKE ALL ON public.content_autopilot_outcomes_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.content_autopilot_outcomes_v TO service_role;

-- Sunday 06:00 UTC (08:00 Warsaw summer, 07:00 winter), after the 05:20 UTC planner run.
SELECT cron.schedule('content-autopilot-sunday', '0 6 * * 0', $$set statement_timeout = '300s'; select public.content_autopilot_sunday()$$);

COMMIT;
