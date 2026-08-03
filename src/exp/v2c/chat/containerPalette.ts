// Generated 2026-08-03 by the inbox-usability-and-voice-live run's Phase 4.
// SKILLS: probed LIVE from the deployed container (GET /skills, saved as
// goal-runs/inbox-usability-and-voice-live-2026-08-03-out/phase4-container-skills.json).
// COMMANDS: build-artifact truth — the deployed image (repo HEAD 3ea8208) copies
// claude-code-railway/commands/ into ~/.claude/commands (Dockerfile:78-81).
// A future run must RE-PROBE, not extend by hand: local-only skills the container
// lacks must never appear here (the deployed set has 9 skills the repo lacks).

export type PaletteEntry = {
  name: string
  desc: string
  insert: string // inserted into the composer, cursor at ⌶ — never auto-sent
  source: 'probed-live' | 'image-artifact'
}

export const CONTAINER_SKILLS: PaletteEntry[] = [
  { name: "brain", desc: "Use ANY time you need to answer entity-scoped or relational questions about Ivan's work \u2014\u2026", insert: "Use the brain skill: \u2336", source: 'probed-live' },
  { name: "clickup-searcher", desc: "Use ANY time you need to query, search, list, comment on, or update ClickUp tasks/lists/s\u2026", insert: "Use the clickup-searcher skill: \u2336", source: 'probed-live' },
  { name: "docx", desc: "Comprehensive document creation, editing, and analysis with support for tracked changes,\u2026", insert: "Use the docx skill: \u2336", source: 'probed-live' },
  { name: "leverage-radar", desc: "Use when Ivan asks \"what should I automate next\", \"find me opportunities\", \"what am I doi\u2026", insert: "Use the leverage-radar skill: \u2336", source: 'probed-live' },
  { name: "n8n-execs", desc: "Use ANY time you need to inspect n8n workflow runtime state \u2014 recent executions, errors,\u2026", insert: "Use the n8n-execs skill: \u2336", source: 'probed-live' },
  { name: "n8n-expression-syntax", desc: "Validate n8n expression syntax and fix common errors. Use when writing n8n expressions, u\u2026", insert: "Use the n8n-expression-syntax skill: \u2336", source: 'probed-live' },
  { name: "n8n-mcp-tools-expert", desc: "Expert guide for using n8n-mcp MCP tools effectively. Use when searching for nodes, valid\u2026", insert: "Use the n8n-mcp-tools-expert skill: \u2336", source: 'probed-live' },
  { name: "n8n-node-configuration", desc: "Operation-aware node configuration guidance. Use when configuring nodes, understanding pr\u2026", insert: "Use the n8n-node-configuration skill: \u2336", source: 'probed-live' },
  { name: "n8n-validation-expert", desc: "Interpret validation errors and guide fixing them. Use when encountering validation error\u2026", insert: "Use the n8n-validation-expert skill: \u2336", source: 'probed-live' },
  { name: "n8n-workflow-patterns", desc: "Proven workflow architectural patterns from real n8n workflows. Use when building new wor\u2026", insert: "Use the n8n-workflow-patterns skill: \u2336", source: 'probed-live' },
  { name: "negotiate", desc: "Use ANY time Ivan is handling a mid-funnel client moment \u2014 objection on price/scope, stal\u2026", insert: "Use the negotiate skill: \u2336", source: 'probed-live' },
  { name: "pdf", desc: "Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs,\u2026", insert: "Use the pdf skill: \u2336", source: 'probed-live' },
  { name: "playwright-driver", desc: "Use when you need a browser to do precise, repeatable, or scripted work \u2014 multi-viewport\u2026", insert: "Use the playwright-driver skill: \u2336", source: 'probed-live' },
  { name: "pp-firecrawl", desc: "Printing Press CLI for Firecrawl. API for interacting with Firecrawl services to perform\u2026", insert: "Use the pp-firecrawl skill: \u2336", source: 'probed-live' },
  { name: "pptx", desc: "Presentation creation, editing, and analysis. When Claude needs to work with presentation\u2026", insert: "Use the pptx skill: \u2336", source: 'probed-live' },
  { name: "proposals", desc: "Use when building client proposals, editing proposals, generating quotes, or when the use\u2026", insert: "Use the proposals skill: \u2336", source: 'probed-live' },
  { name: "recall", desc: "Use ANY time you're about to answer a question that depends on a remembered fact (workflo\u2026", insert: "Use the recall skill: \u2336", source: 'probed-live' },
  { name: "video-use", desc: "Edit any video by conversation. Transcribe, cut, color grade, generate overlay animations\u2026", insert: "Use the video-use skill: \u2336", source: 'probed-live' },
  { name: "xlsx", desc: "Comprehensive spreadsheet creation, editing, and analysis with support for formulas, form\u2026", insert: "Use the xlsx skill: \u2336", source: 'probed-live' },
]

export const CONTAINER_COMMANDS: PaletteEntry[] = [
  { name: "/stochastic-audit", desc: "Run a parallel system health sweep across all subsystems. Each agent audits a different d\u2026", insert: "/stochastic-audit \u2336", source: 'image-artifact' },
  { name: "/stochastic-content", desc: "Evaluate a draft post or topic from multiple audience perspectives. Returns what lands, w\u2026", insert: "/stochastic-content \u2336", source: 'image-artifact' },
  { name: "/stochastic-decision", desc: "Make a binary or ternary decision using 5 agents that independently argue different sides\u2026", insert: "/stochastic-decision \u2336", source: 'image-artifact' },
  { name: "/stochastic-red-team", desc: "Before building something, 5 agents try to poke holes in the proposed approach from diffe\u2026", insert: "/stochastic-red-team \u2336", source: 'image-artifact' },
  { name: "/stochastic-research", desc: "Run a stochastic multi-agent analysis on the given question or decision. This spawns 10 a\u2026", insert: "/stochastic-research \u2336", source: 'image-artifact' },
  { name: "/gsd:add-backlog", desc: "Add an idea to the backlog parking lot (999.x numbering)", insert: "/gsd:add-backlog \u2336", source: 'image-artifact' },
  { name: "/gsd:add-phase", desc: "Add phase to end of current milestone in roadmap", insert: "/gsd:add-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:add-tests", desc: "Generate tests for a completed phase based on UAT criteria and implementation", insert: "/gsd:add-tests \u2336", source: 'image-artifact' },
  { name: "/gsd:add-todo", desc: "Capture idea or task as todo from current conversation context", insert: "/gsd:add-todo \u2336", source: 'image-artifact' },
  { name: "/gsd:audit-milestone", desc: "Audit milestone completion against original intent before archiving", insert: "/gsd:audit-milestone \u2336", source: 'image-artifact' },
  { name: "/gsd:audit-uat", desc: "Cross-phase audit of all outstanding UAT and verification items", insert: "/gsd:audit-uat \u2336", source: 'image-artifact' },
  { name: "/gsd:autonomous", desc: "Run all remaining phases autonomously \u2014 discuss\u2192plan\u2192execute per phase", insert: "/gsd:autonomous \u2336", source: 'image-artifact' },
  { name: "/gsd:check-todos", desc: "List pending todos and select one to work on", insert: "/gsd:check-todos \u2336", source: 'image-artifact' },
  { name: "/gsd:cleanup", desc: "Archive accumulated phase directories from completed milestones", insert: "/gsd:cleanup \u2336", source: 'image-artifact' },
  { name: "/gsd:complete-milestone", desc: "Archive completed milestone and prepare for next version", insert: "/gsd:complete-milestone \u2336", source: 'image-artifact' },
  { name: "/gsd:debug", desc: "Systematic debugging with persistent state across context resets", insert: "/gsd:debug \u2336", source: 'image-artifact' },
  { name: "/gsd:discuss-phase", desc: "Gather phase context through adaptive questioning before planning. Use --auto to skip int\u2026", insert: "/gsd:discuss-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:do", desc: "Route freeform text to the right GSD command automatically", insert: "/gsd:do \u2336", source: 'image-artifact' },
  { name: "/gsd:execute-phase", desc: "Execute all plans in a phase with wave-based parallelization", insert: "/gsd:execute-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:fast", desc: "Execute a trivial task inline \u2014 no subagents, no planning overhead", insert: "/gsd:fast \u2336", source: 'image-artifact' },
  { name: "/gsd:forensics", desc: "Post-mortem investigation for failed GSD workflows \u2014 analyzes git history, artifacts, and\u2026", insert: "/gsd:forensics \u2336", source: 'image-artifact' },
  { name: "/gsd:health", desc: "Diagnose planning directory health and optionally repair issues", insert: "/gsd:health \u2336", source: 'image-artifact' },
  { name: "/gsd:help", desc: "Show available GSD commands and usage guide", insert: "/gsd:help \u2336", source: 'image-artifact' },
  { name: "/gsd:insert-phase", desc: "Insert urgent work as decimal phase (e.g., 72.1) between existing phases", insert: "/gsd:insert-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:join-discord", desc: "Join the GSD Discord community", insert: "/gsd:join-discord \u2336", source: 'image-artifact' },
  { name: "/gsd:list-phase-assumptions", desc: "Surface Claude's assumptions about a phase approach before planning", insert: "/gsd:list-phase-assumptions \u2336", source: 'image-artifact' },
  { name: "/gsd:list-workspaces", desc: "List active GSD workspaces and their status", insert: "/gsd:list-workspaces \u2336", source: 'image-artifact' },
  { name: "/gsd:manager", desc: "Interactive command center for managing multiple phases from one terminal", insert: "/gsd:manager \u2336", source: 'image-artifact' },
  { name: "/gsd:map-codebase", desc: "Analyze codebase with parallel mapper agents to produce .planning/codebase/ documents", insert: "/gsd:map-codebase \u2336", source: 'image-artifact' },
  { name: "/gsd:milestone-summary", desc: "Generate a comprehensive project summary from milestone artifacts for team onboarding and\u2026", insert: "/gsd:milestone-summary \u2336", source: 'image-artifact' },
  { name: "/gsd:new-milestone", desc: "Start a new milestone cycle \u2014 update PROJECT.md and route to requirements", insert: "/gsd:new-milestone \u2336", source: 'image-artifact' },
  { name: "/gsd:new-project", desc: "Initialize a new project with deep context gathering and PROJECT.md", insert: "/gsd:new-project \u2336", source: 'image-artifact' },
  { name: "/gsd:new-workspace", desc: "Create an isolated workspace with repo copies and independent .planning/", insert: "/gsd:new-workspace \u2336", source: 'image-artifact' },
  { name: "/gsd:next", desc: "Automatically advance to the next logical step in the GSD workflow", insert: "/gsd:next \u2336", source: 'image-artifact' },
  { name: "/gsd:note", desc: "Zero-friction idea capture. Append, list, or promote notes to todos.", insert: "/gsd:note \u2336", source: 'image-artifact' },
  { name: "/gsd:pause-work", desc: "Create context handoff when pausing work mid-phase", insert: "/gsd:pause-work \u2336", source: 'image-artifact' },
  { name: "/gsd:plan-milestone-gaps", desc: "Create phases to close all gaps identified by milestone audit", insert: "/gsd:plan-milestone-gaps \u2336", source: 'image-artifact' },
  { name: "/gsd:plan-phase", desc: "Create detailed phase plan (PLAN.md) with verification loop", insert: "/gsd:plan-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:plant-seed", desc: "Capture a forward-looking idea with trigger conditions \u2014 surfaces automatically at the ri\u2026", insert: "/gsd:plant-seed \u2336", source: 'image-artifact' },
  { name: "/gsd:pr-branch", desc: "Create a clean PR branch by filtering out .planning/ commits \u2014 ready for code review", insert: "/gsd:pr-branch \u2336", source: 'image-artifact' },
  { name: "/gsd:profile-user", desc: "Generate developer behavioral profile and create Claude-discoverable artifacts", insert: "/gsd:profile-user \u2336", source: 'image-artifact' },
  { name: "/gsd:progress", desc: "Check project progress, show context, and route to next action (execute or plan)", insert: "/gsd:progress \u2336", source: 'image-artifact' },
  { name: "/gsd:quick", desc: "Execute a quick task with GSD guarantees (atomic commits, state tracking) but skip option\u2026", insert: "/gsd:quick \u2336", source: 'image-artifact' },
  { name: "/gsd:reapply-patches", desc: "Reapply local modifications after a GSD update", insert: "/gsd:reapply-patches \u2336", source: 'image-artifact' },
  { name: "/gsd:remove-phase", desc: "Remove a future phase from roadmap and renumber subsequent phases", insert: "/gsd:remove-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:remove-workspace", desc: "Remove a GSD workspace and clean up worktrees", insert: "/gsd:remove-workspace \u2336", source: 'image-artifact' },
  { name: "/gsd:research-phase", desc: "Research how to implement a phase (standalone - usually use /gsd:plan-phase instead)", insert: "/gsd:research-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:resume-work", desc: "Resume work from previous session with full context restoration", insert: "/gsd:resume-work \u2336", source: 'image-artifact' },
  { name: "/gsd:review-backlog", desc: "Review and promote backlog items to active milestone", insert: "/gsd:review-backlog \u2336", source: 'image-artifact' },
  { name: "/gsd:review", desc: "Request cross-AI peer review of phase plans from external AI CLIs", insert: "/gsd:review \u2336", source: 'image-artifact' },
  { name: "/gsd:session-report", desc: "Generate a session report with token usage estimates, work summary, and outcomes", insert: "/gsd:session-report \u2336", source: 'image-artifact' },
  { name: "/gsd:set-profile", desc: "Switch model profile for GSD agents (quality/balanced/budget/inherit)", insert: "/gsd:set-profile \u2336", source: 'image-artifact' },
  { name: "/gsd:settings", desc: "Configure GSD workflow toggles and model profile", insert: "/gsd:settings \u2336", source: 'image-artifact' },
  { name: "/gsd:ship", desc: "Create PR, run review, and prepare for merge after verification passes", insert: "/gsd:ship \u2336", source: 'image-artifact' },
  { name: "/gsd:stats", desc: "Display project statistics \u2014 phases, plans, requirements, git metrics, and timeline", insert: "/gsd:stats \u2336", source: 'image-artifact' },
  { name: "/gsd:thread", desc: "Manage persistent context threads for cross-session work", insert: "/gsd:thread \u2336", source: 'image-artifact' },
  { name: "/gsd:ui-phase", desc: "Generate UI design contract (UI-SPEC.md) for frontend phases", insert: "/gsd:ui-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:ui-review", desc: "Retroactive 6-pillar visual audit of implemented frontend code", insert: "/gsd:ui-review \u2336", source: 'image-artifact' },
  { name: "/gsd:update", desc: "Update GSD to latest version with changelog display", insert: "/gsd:update \u2336", source: 'image-artifact' },
  { name: "/gsd:validate-phase", desc: "Retroactively audit and fill Nyquist validation gaps for a completed phase", insert: "/gsd:validate-phase \u2336", source: 'image-artifact' },
  { name: "/gsd:verify-work", desc: "Validate built features through conversational UAT", insert: "/gsd:verify-work \u2336", source: 'image-artifact' },
  { name: "/gsd:workstreams", desc: "Manage parallel workstreams \u2014 list, create, switch, status, progress, complete, and resume", insert: "/gsd:workstreams \u2336", source: 'image-artifact' },
]
