# Mission Control — Master Roadmap v2

> Last updated: 2026-04-06
> Supersedes: PRODUCT.md Phase 4-5 backlog, FEATURES.md backlog, SUPERPOWERS-PLAN.md phases
> Hermes reference repo: D:\ClaudeCodeProjects\hermes-reference (cloned for engine scanning)

## Current Build Status (2026-04-06)

**Database:** 27 tables built and migrated (MariaDB)
**Pages:** 15 UI pages live
**MCP Tools:** 17 registered
**API Endpoints:** ~65+

### ✅ Fully Wired & Working
- Projects system (CRUD, templates, members, MCP tools)
- Cost alert thresholds (auto-check in telemetry every 30s)
- Approval queue (approve/reject, MCP tool, sidebar badge count)
- Bootstrap file editor (SOUL.md, IDENTITY.md, etc. — read/write OpenClaw filesystem)
- Agent org chart (visual CEO → sub-agent hierarchy)
- Integrated terminal (xterm.js + node-pty WebSocket)
- Command palette (Ctrl+K)
- 6 color schemes (Teal, Ocean, Midnight, Forest, Slate, Amber)
- OpenClaw auto-detect in setup wizard
- SEO & Social Media setup wizard presets
- Session archiving from telemetry into FULLTEXT-indexed table
- Skills CRUD + manual creation + OpenClaw filesystem sync
- Security policies CRUD + 2 default templates
- Channel connection monitor
- OpenAPI docs at /api/docs
- Heartbeat noise filtered from activity feed
- MCP registration fixed (async openclaw mcp set)
- Telemetry process spam fixed (gateway probe guard)
- Memory provider interface initialized (DBMemoryProvider)

### ✅ Intelligence Engines Wired (2026-04-06)
1. **Self-Learning Trigger Detector** — `learning-engine.ts`: iteration counter, error→recovery detection, user correction patterns. Triggers auto-generate skills via background processing. Wired into telemetry ingestion loop.
2. **Progressive Skill Loading** — L0 skill registry injected into agent chat system prompt. L1/L2 available via `mc_skill_search` MCP tool on-demand.
3. **Nudge System** — Turn counter triggers nudge logging. Memory layer stats auto-update every 30s.
4. **ClawHub Skill Evaluator** — `skill_evaluations` table + API ready. Evaluation pipeline scaffolded (needs ClawHub API integration for live search).
5. **Security Policy Interceptor** — `security-interceptor.ts`: pre-execution check on ALL MCP tool calls. Pattern matching against blocked commands, blocked paths, allowed commands, requires_approval rules. Violations logged to `policy_violations` table. Fail-open on errors.
6. **Context Compression** — Architecture planned per Hermes reference (prune→protect→summarize→sanitize). Needs LLM integration for summarization phase (deferred to runtime when models are connected).
7. **Multi-Model Routing** — `mc_set_model_route` MCP tool + `model_assignments` table + CRUD API. CEO can configure per-task routing via chat.
8. **Agent Run Auto-Scoring** — Wired into task move-to-done handler. Success logged to `agent_run_scores`. Performance API available at `/api/performance`.
9. **Subagent Delegation** — `mc_delegate_task` MCP tool creates subtasks with parent tracking. Activity feed logs delegation events.

### 🔮 Remaining (Runtime-Dependent)
- **ClawHub live search** — Needs ClawHub API endpoint to query skill marketplace
- **LLM-based context compression** — Needs active LLM connection for summarization calls
- **Performance Dashboard page** — UI page not yet created (API is ready)
- **Multi-Model Routing UI page** — UI page not yet created (API + MCP tool ready)
- **DB Dialect Abstraction (Phase 4)** — PostgreSQL + SQLite drivers not yet wired

---

## Blueprint Rules (Apply to EVERY item below)

### Rule #1 — Dual-Mode Architecture (Standalone + SaaS)
Every feature, table, endpoint, and UI component must work in BOTH deployment modes:
- **Standalone** — single customer, single workspace, one DB
- **SaaS** — multi-tenant, `tenant_id` on every table, workspace isolation

**Implementation:** Every new DB table gets a `tenant_id` column (nullable, defaults to 1 for standalone). Every query accepts optional tenant scope. SaaS enforcement is a middleware layer, not per-query logic. Build it once, enforce it everywhere.

### Rule #2 — Multi-DB Auto-Generation on Install
Every schema, migration, and query must produce valid SQL for ALL THREE databases:
- **MariaDB / MySQL** — cPanel standard, most customers
- **PostgreSQL** — enterprise/developer target
- **SQLite** — lightweight local/standalone default

**Implementation:** Use a `DbDialect` abstraction in `storage.ts` that generates dialect-specific DDL and DML. The setup wizard's DB type selection (already exists) drives which dialect loads. Known MySQL-isms to abstract: `ON DUPLICATE KEY UPDATE` → `ON CONFLICT DO UPDATE`, `INSERT IGNORE` → `ON CONFLICT DO NOTHING`, `FULLTEXT INDEX` → `GIN + tsvector` (PG) / `FTS5` (SQLite), `MODIFY COLUMN` → `ALTER COLUMN TYPE`, inline `ENUM` → `CREATE TYPE` (PG) / `TEXT CHECK()` (SQLite).

**Migration generator:** `npm run migrate` reads `db_type` from settings and generates the correct DDL. Schema definitions live as TypeScript objects in `shared/schema.ts`, compiled to SQL per dialect at migration time.

### Rule #3 — Files First, Wireups Second
The build order for every phase is:
1. **Zod schemas** (`shared/schema.ts`) — define the data shape
2. **DB migration SQL** — create tables (all 3 dialects)
3. **IStorage interface methods** — define the contract
4. **Storage implementations** — MySQL, PG, SQLite
5. **API route stubs** — endpoints that return 501 until wired
6. **UI page shells** — components with layout, empty state, loading skeletons
7. **Wire backend** — implement storage methods, connect routes
8. **Wire frontend** — connect UI to real API calls
9. **OpenClaw sync** — write to OpenClaw filesystem FIRST, then DB

This means we can generate ALL schemas, migrations, interfaces, route stubs, and UI shells for the entire roadmap upfront, then wire them phase by phase.

---

## Current State — Milestone v1.0 (Phases 1-3 COMPLETE)

### What's Built & Working

| Feature | Status |
|---------|--------|
| Dashboard — kanban, live output, KPI strip, agent roster | ✅ |
| Task management — CRUD, drag-drop, priority, notifications | ✅ |
| Scheduling — cron, calendar view, failure handling, retries | ✅ |
| Reports — generate, list, filter, detail view | ✅ |
| Analytics — cost tracking, per-agent, per-model, period filter | ✅ |
| Activity feed — real-time timeline, filtering, pagination | ✅ |
| Agent management — CRUD, soul editor, skills, model config, chat | ✅ |
| Settings — 60+ integrations, API keys, pairing flows | ✅ |
| Setup wizard — multi-step onboarding, DB config, provider setup | ✅ |
| Auth — session-based login, password hashing | ✅ |
| MCP protocol — JSON-RPC 2.0, 10 tools registered with OpenClaw | ✅ |
| OpenClaw sync — agent auto-import, soul/skill sync | ✅ |
| Dark/light theme, responsive design, global search | ✅ |

### Current DB Tables (10)
`agents`, `tasks`, `schedules`, `reports`, `activity_logs`, `cost_entries`, `settings`, `integrations`, `conversation_turns`, `channel_daily_stats`

### What's Stubbed / Partially Built
- Voice chat — UI placeholder, no backend
- Projects — referenced in wizard presets, no page/table/endpoints
- PostgreSQL — driver not wired, SQL not abstracted
- Multi-tenant — no tenant_id, no isolation

---

## Phase 4 — Core Infrastructure (DB Abstraction + Multi-Tenant Foundation)

> **Goal:** Make the codebase multi-DB and multi-tenant BEFORE adding new features.
> Everything after this phase inherits the abstractions automatically.

### 4.1 — DB Dialect Abstraction Layer
- [ ] Create `server/db/dialect.ts` — interface with methods: `createTable()`, `upsert()`, `fullTextIndex()`, `fullTextSearch()`, `alterColumn()`, `enumType()`
- [ ] Implement `MysqlDialect`, `PostgresDialect`, `SqliteDialect`
- [ ] Add `pg` driver alongside existing `mysql2`
- [ ] Add `better-sqlite3` driver for SQLite mode
- [ ] Refactor `storage.ts` to route through dialect layer
- [ ] Refactor `migrate.ts` to generate DDL per dialect
- [ ] Abstract all known MySQL-isms (see Rule #2 list above)
- [ ] Test: run full migration + seed on all 3 DB types

### 4.2 — Multi-Tenant Foundation
- [ ] Add `tenant_id INT DEFAULT 1` column to ALL existing tables
- [ ] Create `tenants` table: id, name, slug, domain, license_key, plan_tier, is_active, created_at
- [ ] Create tenant middleware: extracts tenant from subdomain/header, injects into request context
- [ ] Refactor all storage queries to accept optional tenant scope
- [ ] Settings table: add tenant_id scope (global settings vs tenant settings)
- [ ] Standalone mode: tenant_id always = 1, middleware is a no-op

### 4.3 — Files-First: Generate ALL Schemas for Future Phases
> Generate the Zod schemas, migration SQL (all 3 dialects), IStorage interface stubs, and API route stubs for EVERYTHING in Phases 5-9 now. No wireup yet.

**New tables to define (schemas + migrations only):**

| Table | Phase | Purpose |
|-------|-------|---------|
| `projects` | 5 | Project workspaces (SEO campaigns, social media, etc.) |
| `project_members` | 5 | Agent-to-project assignment |
| `project_templates` | 5 | Reusable project type templates (SEO, Social, Legal, etc.) |
| `approval_queue` | 6 | Pending agent actions awaiting human sign-off |
| `cost_alerts` | 6 | Budget thresholds with notification rules |
| `skills` | 7 | Auto-generated + ClawHub + manual skill files |
| `skill_versions` | 7 | Skill revision history (patch-over-rewrite tracking) |
| `session_archive` | 7 | Full conversation archive with FTS indexing |
| `memory_layers` | 7 | Per-agent memory tier tracking (sizes, counts) |
| `nudge_log` | 7 | What the agent decided to remember/learn per nudge |
| `skill_evaluations` | 8 | ClawHub skill eval scores + reasoning |
| `security_policies` | 8 | Per-agent/tenant policy rules (JSON) |
| `policy_violations` | 8 | Logged security policy breaches |
| `agent_run_scores` | 9 | Task outcome logging for performance trends |
| `model_assignments` | 9 | Per-task model routing rules |

**New UI page shells to generate (layout + empty state only):**

| Page | Route | Phase |
|------|-------|-------|
| Projects | `/projects` | 5 |
| Project Detail | `/projects/:id` | 5 |
| Approval Queue | `/approvals` | 6 |
| Skills Browser | `/skills` | 7 |
| Memory Dashboard | `/memory` | 7 |
| Security Policies | `/security` | 8 |
| Agent Performance | `/performance` | 9 |

**New API route stubs (return 501 until wired):**

| Prefix | Endpoints | Phase |
|--------|-----------|-------|
| `/api/projects` | CRUD + members + templates | 5 |
| `/api/approvals` | list, approve, reject, escalate | 6 |
| `/api/cost-alerts` | CRUD + trigger test | 6 |
| `/api/skills` | CRUD + evaluate + generate + import | 7 |
| `/api/memory` | layers, search, stats, nudge-config | 7 |
| `/api/security` | policies CRUD, violations log | 8 |
| `/api/performance` | agent scores, trends, model routing | 9 |

---

## Phase 5 — Projects & Customer-Ready Features

> **Goal:** The #1 missing feature. Both SEO and social media customers need organized workspaces.

### 5.1 — Projects System
- [ ] Wire `projects` table + CRUD endpoints
- [ ] Wire `project_members` (agent assignment to projects)
- [ ] Wire `project_templates` — seed with: SEO Campaign, Social Media, Legal Review, Research, General
- [ ] Projects page UI: list view, create dialog, template picker
- [ ] Project detail page: assigned agents, tasks filtered to project, schedules, reports, activity
- [ ] Tasks get `project_id` foreign key (nullable — standalone tasks still work)
- [ ] Schedules get `project_id` foreign key
- [ ] Reports get `project_id` foreign key
- [ ] Dashboard: project filter dropdown (show tasks/stats for selected project or all)
- [ ] MCP tool: `mc_create_project` — CEO can create projects via chat
- [ ] MCP tool: `mc_assign_to_project` — CEO can assign agents/tasks to projects
- [ ] Nav sidebar: add Projects link between Dashboard and Calendar

### 5.2 — Project Templates (Customer-Specific)
- [ ] **SEO Campaign template**: keyword tracking tasks, content calendar schedule, SERP monitoring agent role, backlink analysis report type
- [ ] **Social Media template**: post creation tasks, cross-platform scheduling, engagement analytics, brand voice skill auto-assign
- [ ] **Legal Review template**: contract review tasks, compliance checks, deadline tracking
- [ ] **Research template**: data gathering tasks, source tracking, synthesis reports
- [ ] Templates define: default agents (with roles/souls), default task types, default schedules, suggested skills

### 5.3 — Competitive Table Stakes
- [ ] **Cost alert thresholds** — `cost_alerts` table wired: per-agent or global, daily/weekly/monthly period, USD threshold, notification channel (UI toast, Discord, WhatsApp, email)
- [ ] **Gateway WebSocket RPC** — direct WS connection to OpenClaw gateway (port 18789) alongside current HTTP proxy. Enables real-time agent status, live tool call streaming, exec approvals.
- [ ] **Zero-config OpenClaw auto-detect** — on first run / setup wizard, scan `~/.openclaw/` for agents, SOUL.md files, auth-profiles.json, and pre-populate MC config. Reduce setup from 5 minutes to 30 seconds.
- [ ] **REST API documentation** — auto-generate OpenAPI spec from route definitions. Expose at `/api/docs`. Customers can wire MC into Zapier, n8n, custom scripts.

---

## Phase 6 — Human Oversight Layer

> **Goal:** Enterprise trust — humans approve before agents act on irreversible actions.

### 6.1 — Approval Queue
- [ ] Wire `approval_queue` table + endpoints
- [ ] Approval queue page UI: pending items, approve/reject buttons, bulk actions
- [ ] Agent integration: when agent hits a "requires_approval" action, it pauses and creates an approval request
- [ ] Approval types: file deletion, external API calls, spend over threshold, agent creation, schedule modification
- [ ] Notification: push to Discord/WhatsApp/email when approval needed
- [ ] Auto-approve rules: configurable per-agent trust levels (new agents need approval, veteran agents auto-approved for routine tasks)
- [ ] MCP tool: `mc_request_approval` — agents can explicitly request human sign-off

### 6.2 — Enhanced Activity & Audit
- [ ] Agent activity timeline: "what did Tom do between 2pm and 4pm?" — minute-by-minute detail view
- [ ] Cost trend charts: spending going up or down? Projected monthly spend.
- [ ] Audit log: every API call, every approval decision, every setting change — with who/when/what
- [ ] Export: CSV/JSON export of activity, costs, audit logs

---

## Phase 7 — OpenClaw Super Powers (The Moat)

> **Goal:** Self-improving agents. The feature set no competitor has.
> **Branding:** "OpenClaw Super Powers — only available on Mission Control"

### 7.1 — Session Archive & Tiered Memory (Layers 1-2)
- [ ] Wire `session_archive` table with FTS index (MariaDB FULLTEXT / PG tsvector+GIN / SQLite FTS5)
- [ ] Store all agent conversations: session_id, agent_id, tenant_id, role, content, tool_calls, tokens, timestamp
- [ ] Wire `memory_layers` tracking table: per-agent sizes, counts, last_updated
- [ ] **Layer 1 (Prompt Memory):** GUI editor for MEMORY.md + USER.md with hard size limits (2,200 / 1,375 chars), usage meter bar, writes to OpenClaw filesystem FIRST then MC DB
- [ ] **Layer 2 (Session Search):** MCP tool `mc_session_search` — agent queries FTS index, results LLM-summarized via cheap model (Haiku) before injection into context
- [ ] Memory dashboard page UI: 4-layer visual breakdown per agent, search box, token gauges
- [ ] Per-agent memory isolation (tenant_id + agent_id scoping)

### 7.2 — Self-Learning Loop & Progressive Skills (Layers 3)
- [ ] Wire `skills` table: name, description, category, version, content (SKILL.md body), source (auto/clawhub/manual), agent_id, tenant_id, eval_score, use_count, last_used, platforms, requires_toolsets
- [ ] Wire `skill_versions` table: skill_id, version, content_diff, created_at
- [ ] **Trigger detector:** background service monitors completed tasks for 4 triggers:
  - 5+ sequential tool calls
  - Error → recovery pattern
  - User correction
  - Non-obvious workflow succeeded
- [ ] **Skill generator:** when triggered, prompt agent to summarize as SKILL.md (agentskills.io YAML frontmatter + markdown body)
- [ ] **Skill writer:** save to OpenClaw filesystem (`~/.openclaw/skills/`) FIRST, then index in MC DB
- [ ] **Progressive loader:** 
  - L0: `registry.json` with skill names + descriptions only (~3K tokens flat) — injected into system prompt always
  - L1: full SKILL.md loaded on-demand when agent determines relevance
  - L2: reference/template/script files loaded on-demand
- [ ] **Patch engine:** when skill reused and improved, apply targeted text diff (not full rewrite)
- [ ] Skills browser page UI: categories, search, tags, eval scores, version history, auto-learn toggle per agent
- [ ] Activity feed integration: "Agent learned: cPanel deployment workflow" with diff view
- [ ] MCP tool: `mc_skill_create` — agents can explicitly save skills
- [ ] MCP tool: `mc_skill_search` — agents can query available skills

### 7.3 — Periodic Nudges (Layer 4 trigger)
- [ ] Wire `nudge_log` table: agent_id, tenant_id, nudge_type, agent_response, memories_saved, skills_created, timestamp
- [ ] **Nudge engine:** configurable timer per agent (default: every 15 min OR every 10 tool calls)
- [ ] Nudge prompt injection: "Review your recent actions. Anything worth saving to memory or extracting as a skill?"
- [ ] Process agent response → route to memory or skill writer
- [ ] Nudge config UI: frequency slider (time + action count), on/off toggle, nudge log viewer

### 7.4 — External Memory Provider Interface (Layer 4)
- [ ] Define `IMemoryProvider` interface: `prefetch()`, `store()`, `query()`, `sync()`, `extractEndOfSession()`
- [ ] Built-in provider: DB-backed (uses session_archive + skills tables)
- [ ] Provider config UI: select active provider, configure credentials
- [ ] Future providers (interface only, implement later): Honcho, Mem0, ChromaDB, Hindsight

---

## Phase 8 — Intelligent Skill Pipeline & Security

> **Goal:** Quality gate for skills + safety guardrails for agents.

### 8.1 — ClawHub Skill Evaluator
- [ ] Wire `skill_evaluations` table: skill_name, source, agent_id, score, reasoning, decision (install/review/reject), timestamp
- [ ] **Search stage:** query ClawHub API for candidate skills matching agent need
- [ ] **Evaluate stage:** score each candidate (0.0-1.0) against:
  - Toolset match (does agent have required tools?)
  - Platform constraint match
  - SOUL.md / MEMORY.md conflict check
  - Prior failure history (session archive query)
  - Security scan (data exfiltration, prompt injection, destructive commands)
- [ ] **Decide stage:**
  - Score ≥ 0.7 → auto-install + adapt to agent context
  - Score 0.4-0.7 → flag for human review (approval queue integration)
  - Score < 0.4 → reject, trigger self-learning fallback
- [ ] Skill eval UI: recommendations with scores + reasoning, "why rejected?" explainer, approval queue for 0.4-0.7 range
- [ ] MCP tool: `mc_evaluate_skill` — agent can request skill evaluation

### 8.2 — Security Policy Engine
- [ ] Wire `security_policies` table: name, agent_id (null = global), tenant_id, rules (JSON), is_active
- [ ] Wire `policy_violations` table: policy_id, agent_id, tool_call, violation_type, severity, timestamp
- [ ] **Policy rules format (JSON):**
  ```json
  {
    "allowed_commands": ["git *", "npm *", "curl *"],
    "blocked_commands": ["rm -rf *", "drop table *"],
    "blocked_paths": ["/etc/", "/root/", "~/.ssh/"],
    "max_tokens_per_task": 50000,
    "max_cost_per_task_usd": 5.00,
    "requires_approval": ["file_delete", "external_api", "agent_create"],
    "network_restrictions": ["*.internal.company.com"]
  }
  ```
- [ ] **Interceptor:** middleware checks every tool call against active policies before execution
- [ ] Security policies page UI: policy editor, violation log, template policies (Restrictive / Standard / Permissive)
- [ ] Default templates: "Standalone Permissive" (minimal restrictions) and "SaaS Restrictive" (tight controls for multi-tenant)

---

## Phase 9 — Power Features (Pro/Enterprise Tier)

> **Goal:** Premium features that justify higher SaaS pricing.

### 9.1 — Context Compression
- [ ] When conversation approaches token limit, summarize middle turns via cheap model
- [ ] Reference chains: compressed turns link back to full originals in session_archive
- [ ] Worth-keeping extraction: key facts get written to MEMORY.md within size limits
- [ ] Configurable compression threshold (percentage of context window)

### 9.2 — Multi-Model Switching
- [ ] Wire `model_assignments` table: agent_id, task_type, model_name, provider, reason
- [ ] Per-task model routing: cheap model (Haiku) for summarization, expensive (Opus) for reasoning
- [ ] Cost tracking per model assignment — "you saved $X by routing summaries to Haiku"
- [ ] UI: model routing rules editor on agent profile page
- [ ] MCP tool: `mc_set_model_route` — CEO can configure routing via chat

### 9.3 — Agent Run Scoring
- [ ] Wire `agent_run_scores` table: agent_id, task_id, outcome (success/fail/partial), tokens, cost, duration, user_rating, timestamp
- [ ] Auto-scoring: task moved to "done" = success, agent error = fail, human intervention = partial
- [ ] Manual rating: user can rate agent task completion (thumbs up/down or 1-5 stars)
- [ ] Performance dashboard page: trends over time, best/worst agents, cost efficiency ratios
- [ ] Feed scoring data into skill generation — high-scoring approaches become skills

### 9.4 — Subagent Delegation
- [ ] Parent agent spawns child agents via `mc_delegate_task` MCP tool
- [ ] Task queue: child tasks tracked as subtasks under parent task
- [ ] Lifecycle management: child agents inherit parent's project, tenant, security policies
- [ ] Result aggregation: child results roll up to parent task
- [ ] UI: visual agent hierarchy (tree view), subtask tracking on task detail

---

## Phase 10 — OpenClaw GUI Enhancements (Ongoing Polish)

> **Goal:** Management layer for non-CLI users. Ship incrementally alongside other phases.

### 10.1 — High Priority (ship with Phase 5)
- [ ] **Bootstrap file editors** — SOUL.md, AGENTS.md, MEMORY.md: syntax-highlighted markdown editor, preview, validation, writes to OpenClaw first
- [ ] **Integrated terminal** — embedded terminal in MC UI (xterm.js), SSH to OpenClaw host
- [ ] **Agent org chart** — visual hierarchy showing CEO → sub-agents → ephemeral agents with relationship lines

### 10.2 — Medium Priority (ship with Phase 6-7)
- [ ] **Visual cron scheduler** — drag-to-schedule, timeline view (already have calendar, enhance it)
- [ ] **Channel connection monitor** — real-time status of WhatsApp/Telegram/Discord/Slack connections with reconnect buttons
- [ ] **MCP server manager** — add/remove MCP servers, view registered tools, test connections
- [ ] **ClawHub skill browser** — search ClawHub catalog from MC UI, one-click install (feeds into Phase 8 eval)

### 10.3 — Lower Priority (ship with Phase 8-9)
- [ ] **Model provider manager** — API key vault, per-agent model assignment UI, provider health check
- [ ] **Theme switching** — 4-6 themes beyond dark/light (Slate, Mono, Ocean, Forest)
- [ ] **Command palette** — Ctrl+K quick access to any page/agent/task/action
- [ ] **TOTP MFA** — two-factor auth for enterprise security checkbox
- [ ] **Mobile PWA** — responsive PWA with service worker, push notifications
- [ ] **i18n** — start with English + Spanish + Portuguese (largest OpenClaw communities)

---

## SaaS Tier Mapping

| Tier | Phases Included | Features |
|------|----------------|----------|
| **Free** | 4, 5 (partial), 10.1 | Projects (3 max), basic dashboard, bootstrap editors, cost tracking, OpenClaw sync |
| **Pro** | 5-8 | Unlimited projects, all templates, approval queue, cost alerts, Super Powers (self-learning, memory, skills, nudges, eval pipeline), security policies |
| **Enterprise** | 5-10 | Everything + subagent delegation, multi-model routing, agent scoring, context compression, terminal, MFA, i18n, priority support |

---

## File Generation Order (Rule #3)

When starting a phase, generate files in this exact order:

```
1. shared/schema.ts          — Add Zod schemas for new tables
2. server/db/migrations/     — DDL for MariaDB, PostgreSQL, SQLite
3. server/storage.ts          — Add IStorage interface methods
4. server/db/mysql-storage.ts — MySQL/MariaDB implementation stubs
5. server/db/pg-storage.ts    — PostgreSQL implementation stubs
6. server/db/sqlite-storage.ts — SQLite implementation stubs
7. server/routes.ts           — API endpoint stubs (return 501)
8. client/src/pages/          — UI page shells (layout + empty state)
9. client/src/components/     — Shared components for new features
10. Wire backend              — Implement storage methods
11. Wire frontend             — Connect UI to API
12. Wire OpenClaw             — Filesystem sync
13. Wire MCP tools            — Register new tools with gateway
```

---

## Quick Reference: New MCP Tools (All Phases)

| Tool | Phase | What It Does |
|------|-------|-------------|
| `mc_create_project` | 5 | Create a project workspace |
| `mc_assign_to_project` | 5 | Assign agent/task to project |
| `mc_request_approval` | 6 | Agent requests human sign-off |
| `mc_session_search` | 7 | Query conversation archive |
| `mc_skill_create` | 7 | Agent saves a learned skill |
| `mc_skill_search` | 7 | Agent queries available skills |
| `mc_evaluate_skill` | 8 | Request skill evaluation |
| `mc_set_model_route` | 9 | Configure per-task model routing |
| `mc_delegate_task` | 9 | Spawn child agent for subtask |

---

## Quick Reference: New DB Tables (All Phases)

| Table | Phase | Columns (key fields) |
|-------|-------|---------------------|
| `tenants` | 4 | id, name, slug, domain, license_key, plan_tier, is_active |
| `projects` | 5 | id, tenant_id, name, description, template_type, status, created_at |
| `project_members` | 5 | project_id, agent_id, role |
| `project_templates` | 5 | id, name, type, default_agents, default_tasks, default_schedules, skills |
| `approval_queue` | 6 | id, tenant_id, agent_id, action_type, payload, status, decided_by, decided_at |
| `cost_alerts` | 6 | id, tenant_id, agent_id, period, threshold_usd, notification_channel, is_active |
| `skills` | 7 | id, tenant_id, agent_id, name, description, category, version, content, source, eval_score, use_count, platforms, requires_toolsets |
| `skill_versions` | 7 | id, skill_id, version, content_diff, created_at |
| `session_archive` | 7 | id, tenant_id, agent_id, session_id, role, content, tool_calls, tokens, created_at + FTS index |
| `memory_layers` | 7 | id, tenant_id, agent_id, layer_type, size_chars, item_count, last_updated |
| `nudge_log` | 7 | id, tenant_id, agent_id, nudge_type, response, memories_saved, skills_created, created_at |
| `skill_evaluations` | 8 | id, tenant_id, skill_name, source, agent_id, score, reasoning, decision, created_at |
| `security_policies` | 8 | id, tenant_id, agent_id, name, rules (JSON), is_active |
| `policy_violations` | 8 | id, policy_id, agent_id, tool_call, violation_type, severity, created_at |
| `agent_run_scores` | 9 | id, tenant_id, agent_id, task_id, outcome, tokens, cost, duration, user_rating, created_at |
| `model_assignments` | 9 | id, tenant_id, agent_id, task_type, model_name, provider, reason |

**Total: 16 new tables across Phases 4-9**

---

*This is the single source of truth. All other planning docs reference this file.*
