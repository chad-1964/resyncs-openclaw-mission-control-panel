# Mission Control — Feature Backlog

Ideas and enhancements to build. Add to this file during brainstorming sessions.

---

## Settings / AI Models

- **Multi-provider routing** — Settings UI to choose which configured provider is "active" (primary) for agent chat. Currently defaults to first configured. Should let user pick: Anthropic, OpenRouter, Ollama, etc. per-agent or globally.

---

## Agents

- **CEO-driven provider routing** — The CEO (default OpenClaw agent) should be able to instruct sub-agents which API/provider to use per task. Since all configured provider profiles are available in OpenClaw, the CEO can orchestrate model selection natively rather than relying on a single global default. This is a stronger solution than UI toggles — wire all configured providers into auth-profiles.json and let the CEO decide routing via its soul/instructions.

- **MCP tools for agent management** *(next priority)* — Register Mission Control API actions as MCP tools on the OpenClaw gateway so the CEO agent can explicitly execute MC API actions: create agent, update agent soul/skills, assign tasks, etc. Tools needed: `mc_create_agent`, `mc_update_agent_soul`, `mc_append_skill`, `mc_create_task`.

- **Native OpenClaw agent sync loop** *(critical for product credibility)* — OpenClaw's CEO already creates agents natively inside `~/.openclaw/agents/` when it decides to delegate a task to a specialist that doesn't exist yet. MC must detect and surface these agents automatically. Without this, MC is a "wrapper" — with it, MC is a live dashboard of what OpenClaw is actually doing. Implementation: background polling loop reads `~/.openclaw/agents/`, compares against MC's DB, auto-imports new agents with sensible defaults. The `syncAgents()` function in `openclaw-client.ts` is already the foundation — needs to be wired to a scheduled job and auto-create flow.

---

## General

> **Note:** The full feature backlog, competitive analysis, and build plan have been consolidated into [ROADMAP.md](ROADMAP.md). New feature ideas should be evaluated against the roadmap phases before adding here.

- See ROADMAP.md Phase 5 for Projects, cost alerts, Gateway WS, auto-detect
- See ROADMAP.md Phase 6 for approval queue, audit logging
- See ROADMAP.md Phase 7 for Super Powers (self-learning, memory, skills, nudges)
- See ROADMAP.md Phase 8 for skill evaluation pipeline, security policies
- See ROADMAP.md Phase 9 for multi-model routing, agent scoring, subagent delegation
- See ROADMAP.md Phase 10 for GUI polish (terminal, org chart, themes, MFA, PWA, i18n)
