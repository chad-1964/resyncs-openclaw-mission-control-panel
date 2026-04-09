# Mission Control — Product Vision

## What We Are Building

**Mission Control is OpenClaw with superpowers — controlled by human oversight.**

OpenClaw is a headless autonomous agent runtime. Agents run, spawn sub-agents, spend tokens, and complete tasks with no visibility unless you live in the terminal. Mission Control changes that fundamentally.

It is not a dashboard bolted on the side. It is a **wrapper UI MCP** — a Mission Control Protocol server that registers itself directly into OpenClaw's tool belt at install time. From that moment, the CEO agent *is* Mission Control. It can hire and fire agents, schedule automation, control budgets, and manage fully parallel workflows — all from a single chat message, with every action visible and reversible from the UI.

---

## The Core Problem We Solve

AI agents are autonomous by design. That's the point. But businesses need:

- **Visibility** — What are my agents working on right now?
- **Cost control** — How many tokens did we burn this week? Which agent is the expensive one?
- **Scheduling** — Run the daily revenue summary at 8am. Not "when the CEO feels like it."
- **Oversight** — Approve before the agent does something irreversible.
- **History** — What did Agent X do last Tuesday and what was the outcome?

OpenClaw doesn't provide any of this out of the box. Mission Control does.

---

## Deployment — Any Server, Any Database, Any Mode

Mission Control is built to install anywhere:

| Mode | Description |
|------|-------------|
| **Standalone** | Single install on any server — VPS, cPanel, bare metal, local machine |
| **SaaS** | Multi-tenant deployment — one Mission Control instance, many customer workspaces |
| **Docker** | Containerized for local dev or cloud-native deployments |

**Database support:**
- MariaDB / MySQL
- PostgreSQL *(in progress)*
- SQLite *(lightweight/local)*

**Install path:**
1. PHP installer (`index.php`) — runs without Node.js, bootstraps the environment
2. React setup wizard — database config, admin account, OpenClaw connection
3. Dashboard live — MCP tools registered with OpenClaw gateway automatically

No terminal required for end users. No config file editing. No SOUL.md hand-crafting.

---

## The Architecture That Makes It Real

### MCP Tools — The CEO's Native Superpowers

The CEO agent (OpenClaw's default `main` agent) has a tool belt. Mission Control registers its own tools into that tool belt via MCP (Model Context Protocol) at install time.

Once registered, the CEO can:

```
User: "Create a legal expert agent called Tom and schedule him to 
       review contracts every Monday at 9am"

CEO:  [calls mc_create_agent]     → Tom created in MC + OpenClaw
      [calls mc_update_soul]      → Tom's personality written
      [calls mc_schedule_task]    → Monday 9am recurring task created
      "Done. Tom is ready. I've scheduled his first contract review 
       for Monday. You can track his activity and token spend in 
       Mission Control."
```

No terminal. No config files. No SOUL.md editing. The customer types one sentence and it's done — with full audit trail in the UI.

### Registered MCP Tools

| Tool | What It Does |
|------|-------------|
| `mc_create_agent` | Create a named agent with soul and skills, visible in MC |
| `mc_list_agents` | Return all agents with status and last activity |
| `mc_update_soul` | Rewrite an agent's personality/instructions |
| `mc_append_skill` | Add a skill/capability to an existing agent |
| `mc_create_task` | Create and assign a task to an agent |
| `mc_list_tasks` | Query tasks by agent, status, or date range |
| `mc_schedule_task` | Create a recurring scheduled task (cron) |
| `mc_get_token_usage` | Return token spend by agent, provider, and time range |
| `mc_log_activity` | Let agents write to the activity feed directly |

Every tool call is logged. Every token spent is recorded. Everything the CEO does shows up in the UI immediately — because the CEO IS writing to the same database the UI reads from.

---

## The Token Spend Dashboard

This is the feature that saves customers money and justifies the product every month.

- Per-agent token spend, daily/weekly/monthly
- Per-provider cost breakdown (Anthropic vs OpenRouter vs Ollama)
- Cost trends — is spending going up or down?
- **Kill switch** — toggle off a provider immediately from the dashboard, no terminal needed
- Alert thresholds — notify when an agent exceeds N tokens in a period

The CEO can query this too: *"Which agent is costing the most this month?"* → calls `mc_get_token_usage` → gives the customer a plain-English answer.

---

## The Scheduling Layer

Humans think in calendars. Agents think in cron expressions. Mission Control bridges this.

- Visual schedule builder — pick days, times, agent, task type
- The CEO can create schedules on behalf of the customer via chat
- Full history: last run time, next run time, success/failure count
- Pause/resume any schedule without touching config files

---

## The Agent Roster

Every agent the CEO spawns natively in OpenClaw automatically appears in Mission Control within seconds (event-driven sync, no polling). Each agent card shows:

- Current status (idle / working / error)
- Last task completed
- Token spend this session / all time
- Soul (personality) — viewable and editable
- Skills — addable/removable without touching files
- Full chat history with that agent

---

## Why This Is a Competitive Moat

Anyone can install OpenClaw. Not everyone can build and maintain what Mission Control provides:

1. **MCP tool integration** — the CEO treats MC as part of itself, not an external app
2. **Real-time agent sync** — agents the CEO spawns appear without user action
3. **Token spend tracking** — tied to real DB records, not estimates
4. **Visual scheduling** — humans schedule, agents execute, dashboard confirms
5. **Human kill-switch** — provider toggle removes the API key from auth-profiles.json immediately
6. **Deploy anywhere** — any server, any DB, standalone or SaaS, PHP installer entry point
7. **No terminal required** — full agent management from chat + UI

The more tools we register, the more powerful the CEO becomes — and the more indispensable Mission Control is to every OpenClaw customer.

---

## Build Roadmap

### Phase 1 — Foundation ✅
- [x] Virgin install: PHP installer → React wizard → working dashboard
- [x] AI provider wiring (Anthropic, OpenRouter, toggle kill-switch)
- [x] CEO chat working (payloads format, real responses)
- [x] Event-driven agent sync (CEO-spawned agents appear in UI)

### Phase 2 — MCP Tools ✅
- [x] MC MCP server endpoint (`/api/mcp`) — JSON-RPC 2.0, 8 tools
- [x] Register with OpenClaw gateway at startup (`openclaw mcp add mission-control`)
- [x] `mc_create_agent` — CEO creates Tom, Tom appears in UI
- [x] `mc_update_soul` + `mc_append_skill`
- [x] `mc_create_task` + `mc_schedule_task`
- [x] `mc_get_token_usage` + `mc_log_activity`

### Phase 3 — Token Intelligence ✅
- [x] Token spend recorded per chat call (real USD pricing per model)
- [x] Per-agent spend dashboard — Analytics page with period filter (Today/7d/30d/All Time)
- [x] Per-provider/model cost breakdown — Model Usage donut + Agent Breakdown table
- [x] Token Usage tab on every Agent Profile — daily chart + model breakdown
- [x] Today's tokens + cost in sidebar Running Tally
- [x] KPI strip on Dashboard (In Progress, Done, Active Agents, Today's Cost)
- [x] Brave Search integration — CEO uses Brave API instead of bot-blocked DuckDuckGo
- [x] Settings overhaul — Search, Voice, Memory, Calendar, Maps, Finance, Dev Tools, Local LLM categories
- [ ] Alert thresholds (future)

### Phases 4-10 → See [ROADMAP.md](ROADMAP.md)

The full roadmap (Phases 4-10) including DB abstraction, multi-tenant, Projects, Approval Queue, OpenClaw Super Powers (self-learning, tiered memory, skills, nudges, eval pipeline), security policies, and all GUI enhancements is maintained in **ROADMAP.md** as the single source of truth.

---

## One-Liner

> *OpenClaw gives you autonomous AI agents. Mission Control gives you the power to actually run them — and makes them smarter every day.*

---

*Mission Control is not a wrapper. It is the control room with superpowers.*
