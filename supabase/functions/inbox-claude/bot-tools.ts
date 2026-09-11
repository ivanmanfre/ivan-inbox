// bot-tools.ts - what a cron-started bot turn is allowed to run.
//
// An operator turn is Ivan typing, so it goes upstream with
// `permission_mode: 'bypassPermissions'` and the full tool set. A bot turn is
// started by a clock with nobody watching, so the one real hazard named in the
// design spec is a turn that WRITES. This constant is the boundary, and it is
// the tool SET plus deny rules, not an allowlist, because an allowlist restrains
// nothing under bypass.
//
// Probed on the local CLI 2.1.219 on 2026-09-11 (the full runs are in
// goal-runs/claude-bot-thread-2026-09-11-out/evidence/W2/permission-mode-probe-1.txt
// and -2.txt). Quoting the results:
//
//   A. bypass + `--allowedTools Read,Grep,Glob`
//      "It worked - probe.txt was created successfully with "hello" inside."
//      The write LANDED. An allowlist restrains nothing under bypass.
//   B. default + `--allowedTools Read,Grep,Glob`
//      "It worked-probe.txt was created with the word hello."
//      `default` alone is not a boundary either: the settings on the host decide,
//      and the container's entrypoint.sh allows Bash(curl:*), Bash(python3:*),
//      Bash(n8nac:*), Bash(git:*), Bash(npm:*), Bash(node:*) and mcp__*.
//   C. default + `Bash(curl:*)` allowed, curl GET
//      "HTTP status code: **200**" - the DB read path still works.
//   D. bypass + `--disallowedTools Write,Edit,MultiEdit,NotebookEdit,Bash`
//      "Write tool is disabled and Bash is unavailable, so I could not create the
//      file." / "ls: probe.txt: No such file or directory". Deny rules HOLD.
//   E. bypass + `--tools Read,Grep,Glob,Bash` + deny
//      "ls: probe.txt: No such file or directory", but the model still reached for
//      computer control, so `--tools` trims built-ins only and the deny list is
//      what has to name mcp__*.
//
// So: a tool set that does not contain Write/Edit/Agent, plus deny rules that
// close every Bash verb the container's own settings would otherwise re-open.
// `curl` stays, because it is how the bot reads the database; the allowlist
// cannot tell a GET from a POST, so the standing instruction forbids writes and
// week one reviews every bot turn's tool_events for a non-GET call (design spec
// section 3).
//
// Orchestrator decision D2 in
// goal-runs/claude-bot-thread-2026-09-11-out/DECISIONS.md.
export const BOT_TOOLS = {
  permission_mode: 'default',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
  allowed_tools: ['Read', 'Grep', 'Glob', 'Bash(curl:*)'],
  disallowed_tools: [
    'Bash(git:*)',
    'Bash(python3:*)',
    'Bash(node:*)',
    'Bash(npm:*)',
    'Bash(n8nac:*)',
    'mcp__*',
  ],
} as const

/**
 * The standing instruction the tick reads from content_prompts and passes on the
 * server door. Bounded here because it lands in append_system_prompt, which the
 * assembler's cap ladder has to reserve room for.
 */
export const MAX_SYSTEM_APPEND_CHARS = 6_000
