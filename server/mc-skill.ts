/**
 * mc-skill.ts
 *
 * Deploys the Mission Control skill to OpenClaw's workspace so the CEO
 * can natively call MC's tools via web_fetch.
 *
 * Skills live at ~/.openclaw/workspace/skills/<name>/SKILL.md.
 * OpenClaw loads them automatically at session start.
 *
 * This file is safe to re-run — it overwrites the skill on every MC startup
 * so the URL/port stays current.
 */

import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { OPENCLAW_WORKSPACE } from "./paths";

export function deployMCSkill(port: number): void {
  const workspaceDir = OPENCLAW_WORKSPACE;

  if (!existsSync(workspaceDir)) {
    console.log("[mc-skill] .openclaw/workspace not found — skipping skill deploy");
    return;
  }

  const skillDir = join(workspaceDir, "skills", "mission-control");
  mkdirSync(skillDir, { recursive: true });

  const base = `http://localhost:${port}`;

  const skill = `---
name: mission_control
description: >
  Manage Mission Control — the business dashboard. Use these tools whenever
  the user asks to create an agent, assign a task, set a schedule, or check
  token spend. Always prefer Mission Control tools over native session spawning
  for persistent agents and scheduled work.
---

# Mission Control

Mission Control is your business dashboard. It runs locally at ${base}.
Call its API with the \`web_fetch\` tool. Always include the header
\`Content-Type: application/json\` on POST/PATCH requests.

---

## Create an Agent

\`\`\`
POST ${base}/api/tools/create-agent
Content-Type: application/json

{
  "name": "Attorney Tom",
  "role": "Legal expert and contract attorney",
  "soul": "# Attorney Tom\\n\\nYou are Tom, a sharp legal mind specialised in contract law...",
  "skills": ["contract-review", "legal-research"]
}
\`\`\`

Returns: \`{ "ok": true, "agent": { "id": 7, "name": "Attorney Tom", "openclaw_id": "openclaw/attorney-tom" } }\`

After creating an agent, confirm to the user: their name, role, and that they are
now visible in Mission Control.

---

## List Agents

\`\`\`
GET ${base}/api/tools/agents
\`\`\`

Returns array: \`[{ "id", "name", "role", "status", "openclaw_id", "token_spend_today" }]\`

---

## Update Agent Soul / Personality

\`\`\`
PATCH ${base}/api/tools/update-soul
Content-Type: application/json

{ "agentId": 7, "soul": "# Attorney Tom\\n\\nUpdated personality..." }
\`\`\`

---

## Append Skill to Agent

\`\`\`
POST ${base}/api/tools/append-skill
Content-Type: application/json

{ "agentId": 7, "skill": "contract-review" }
\`\`\`

---

## Create a Task

\`\`\`
POST ${base}/api/tools/create-task
Content-Type: application/json

{
  "title": "Review NDA for Acme Corp",
  "agentId": 7,
  "description": "Full NDA review — flag non-standard clauses",
  "priority": "high",
  "status": "backlog"
}
\`\`\`

\`priority\`: low | medium | high | urgent
\`status\`: backlog | doing | done

---

## Schedule a Recurring Task

\`\`\`
POST ${base}/api/tools/schedule-task
Content-Type: application/json

{
  "name": "Weekly contract review",
  "agentId": 7,
  "cron": "0 9 * * 1",
  "description": "Review all contracts received this week",
  "taskType": "general"
}
\`\`\`

\`cron\` is a 5-part cron expression (minute hour dom month dow).
Common examples: daily 8am = \`0 8 * * *\`, Mon 9am = \`0 9 * * 1\`, weekdays 6pm = \`0 18 * * 1-5\`.

After scheduling, tell the user the schedule name and when it next runs.

---

## Get Token Usage

\`\`\`
GET ${base}/api/tools/token-usage?period=month
GET ${base}/api/tools/token-usage?agentId=7&period=week
\`\`\`

\`period\`: day | week | month | all

Returns: \`{ "total": { "input": N, "output": N, "cost_usd": N }, "byAgent": [...], "byProvider": [...] }\`

Use this when the user asks about spending, costs, or token usage.

---

## Log to Activity Feed

\`\`\`
POST ${base}/api/tools/log-activity
Content-Type: application/json

{ "type": "task_completed", "message": "Finished reviewing Acme NDA — 3 issues flagged", "agentId": 7 }
\`\`\`

Call this after completing significant work so the customer can see it in their dashboard.
Common types: task_completed, task_started, agent_created, note.

---

## Workflow Example

User: "Create a legal expert called Tom and schedule him to review contracts every Monday"

1. \`POST /api/tools/create-agent\` → get agentId
2. \`POST /api/tools/schedule-task\` with agentId and cron \`0 9 * * 1\`
3. \`POST /api/tools/log-activity\` → "Attorney Tom created and scheduled for Monday contract reviews"
4. Reply to user: "Done — Tom is ready and will review contracts every Monday at 9am. You can track his activity and costs in Mission Control."
`;

  writeFileSync(join(skillDir, "SKILL.md"), skill, "utf8");
  console.log(`[mc-skill] Deployed mission-control skill → ${skillDir}/SKILL.md`);
}
