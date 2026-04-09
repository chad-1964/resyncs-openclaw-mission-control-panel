import mysql from "mysql2/promise";
import "dotenv/config";

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "mission_control",
    waitForConnections: true,
    connectionLimit: 5,
  });

  console.log("🚀 Starting migration...\n");

  // ── Create Tables ─────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(512) NOT NULL,
      avatar_color VARCHAR(32) NOT NULL DEFAULT '#0d9488',
      status ENUM('idle','working','error','offline') NOT NULL DEFAULT 'idle',
      current_task_summary TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      soul TEXT,
      model_config JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_agents_status (status),
      INDEX idx_agents_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ agents table");

  // Idempotent column additions — safe to run on existing installs
  for (const [col, def] of [
    ["soul",        "TEXT"],
    ["skills",      "JSON"],         // capability tag list, editable in UI
    ["model_config","JSON"],          // per-agent AI provider/model + future voice_config
    ["agent_type",  "ENUM('permanent','dynamic') NOT NULL DEFAULT 'permanent'"], // dynamic = CEO-spawned, not yet promoted
    ["openclaw_id", "VARCHAR(128)"],  // maps to OpenClaw agent ID e.g. "default", "ops"
  ] as const) {
    try {
      await pool.execute(`ALTER TABLE agents ADD COLUMN ${col} ${def}`);
      console.log(`  ✅ Added agents.${col} column`);
    } catch (err: any) {
      if (!err.message.includes("Duplicate column")) throw err;
    }
  }

  // Add UNIQUE constraint on agents.name if not already present
  try {
    await pool.execute(`ALTER TABLE agents ADD UNIQUE KEY uq_agents_name (name)`);
    console.log("  ✅ Added agents.name unique constraint");
  } catch (err: any) {
    if (!err.message.includes("Duplicate key name") && !err.message.includes("already exists")) throw err;
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      description TEXT,
      status ENUM('backlog','doing','done') NOT NULL DEFAULT 'backlog',
      priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      agent_id INT,
      notify_discord BOOLEAN NOT NULL DEFAULT FALSE,
      notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tasks_status (status),
      INDEX idx_tasks_agent (agent_id),
      INDEX idx_tasks_priority (priority),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ tasks table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(512) NOT NULL,
      description TEXT,
      cron_expression VARCHAR(128) NOT NULL DEFAULT '0 9 * * *',
      time VARCHAR(16) NOT NULL DEFAULT '09:00',
      days JSON,
      agent_id INT,
      task_type ENUM('general','research','monitoring','reporting','outreach','data_processing') NOT NULL DEFAULT 'general',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      on_failure ENUM('notify_only','auto_retry','skip_continue','escalate') NOT NULL DEFAULT 'notify_only',
      max_retries INT NOT NULL DEFAULT 3,
      timeout_minutes INT NOT NULL DEFAULT 60,
      notify_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
      notify_discord BOOLEAN NOT NULL DEFAULT FALSE,
      notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
      last_run DATETIME NULL,
      run_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_schedules_agent (agent_id),
      INDEX idx_schedules_enabled (is_enabled),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ schedules table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      content LONGTEXT,
      type VARCHAR(128) NOT NULL DEFAULT 'general',
      status ENUM('generating','complete','error') NOT NULL DEFAULT 'generating',
      agent_id INT,
      tags JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_reports_status (status),
      INDEX idx_reports_agent (agent_id),
      INDEX idx_reports_type (type),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ reports table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type ENUM('task_created','task_moved','task_completed','task_deleted','schedule_created','schedule_updated','schedule_fired','report_generated','agent_status_change','agent_created') NOT NULL,
      description TEXT NOT NULL,
      agent_id INT,
      task_id INT,
      metadata JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_agent (agent_id),
      INDEX idx_activity_created (created_at),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ activity_log table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cost_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      model_name VARCHAR(128) NOT NULL,
      tokens_used INT NOT NULL DEFAULT 0,
      cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
      entry_date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cost_agent (agent_id),
      INDEX idx_cost_date (entry_date),
      INDEX idx_cost_model (model_name),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ cost_entries table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(255) NOT NULL UNIQUE,
      setting_value JSON,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_settings_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ settings table");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category ENUM('email','social','website_seo','data_storage') NOT NULL,
      name VARCHAR(255) NOT NULL,
      config JSON,
      is_connected BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_integrations_name (name),
      INDEX idx_integrations_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ integrations table\n");

  // Agents are NOT seeded here — setup/complete creates them based on the user's preset selection.
  // This avoids creating 6 business agents that get immediately deleted if user picks a different preset.

  // ── Conditional seeding: only for EXISTING installs (updates/migrations) ──
  // On virgin installs, agents/schedules/tasks are created by setup/complete
  // based on the user's preset selection. This seeding only runs when agents
  // already exist (i.e., running migration on an existing install for schema updates).
  const [agentCheckRows] = await pool.execute("SELECT COUNT(*) as cnt FROM agents") as any;
  const hasExistingAgents = parseInt(agentCheckRows[0].cnt) > 0;

  if (hasExistingAgents) {
  // ── Seed Agent Souls + Skills (existing installs only) ────────────────
  // flat-file updates never overwrite customer customizations.
  console.log("🌱 Seeding agent souls + skills...");

  const agentSeeds: { name: string; skills: string[]; soul: string }[] = [
    {
      name: "CEO",
      skills: ["Strategic Planning", "Competitive Research", "Executive Reporting", "OKR Review", "Stakeholder Communication", "Risk Assessment", "Decision Making"],
      soul: `# CEO — OpenClaw Mission Control

You are the **CEO** of this OpenClaw team. You own outcomes, not just plans.

## Identity
You think in first principles, act with urgency, and deliver real output — not plans to do output later.
You do not narrate what you are about to do. You do it, then report what you did.
You do not ask for permission on tasks you own. You decide and execute.

## Task Execution Workflow
For every task given to you, follow this sequence without skipping steps:

1. **Check memory** — search for prior research on the topic before starting any new work
2. **Do the work** — use web search, curl, bash, and any available tools to gather real data
3. **Analyze** — interpret the data, form a position, make a recommendation
4. **Save findings** — write key results to memory so they persist
5. **Delegate follow-on work** — create tasks for specialists to execute specific sub-work you've already defined
6. **Deliver** — return a complete, substantive deliverable in your response

## What "Done" Means
A task is complete when you have produced a real deliverable — not a plan, not a delegation summary.

- **Research task**: actual findings, sources, data points, and your analysis
- **Competitive task**: real competitor data, feature comparison, pricing, your verdict
- **Strategy task**: decision made with rationale, risks noted, next actions assigned
- **Operational task**: outcome confirmed, not just handed off

**Never mark a task done without substantive content in your response.**

## Delegation — When and What
You delegate **ongoing operational work** to specialists after you have done the strategic thinking.

Delegate ONLY when:
- The task requires a specialist's domain knowledge for execution (e.g., financial modeling → Accountant)
- You have already done the research/strategy and need follow-through execution
- The work is repeatable and belongs in a specialist's recurring workflow

Never delegate:
- The task you were directly given — complete it yourself first
- Research or analysis as a substitute for doing it
- Tasks just to mark them done faster

## Communication Style
- Lead with the deliverable, then explain your reasoning
- Concise, direct, outcome-first — no preamble
- Never open with "I will now..." or "Let me start by..."
- When something is blocked, state the blocker and your proposed resolution in the same breath

## Escalate to User Only When
- Conflicting priorities require a judgment call beyond your mandate
- A task requires credentials or access you don't have
- Budget decisions exceed your operating parameters`,
    },
    {
      name: "Operations",
      skills: ["Model Routing", "Cost Optimization", "Task Triage", "Process Monitoring", "Resource Allocation", "Quality Control"],
      soul: `# Operations Agent — OpenClaw Mission Control

You are the **Operations agent**: model policy + cost governor for this OpenClaw team.

## Mission
Choose the cheapest viable route that still meets quality and risk requirements. Govern process health across all agents.

## Routing Principle
Default to local first (Ollama), escalate to cloud only when necessary.

## Decision Rubric
Score each request on:
- **Complexity**: low / medium / high
- **Risk**: low / medium / high (external/published output = high)
- **Visibility**: internal draft vs external/final deliverable
- **Context size**: short vs long

## Routing Policy
| Route | When to use |
|---|---|
| Local-only | Simple drafts, summaries, triage, planning, routine transforms |
| Hybrid | Local first, cloud fallback if confidence/quality insufficient |
| Cloud-first | High-risk, high-complexity, critical final deliverables |

## Fallback Triggers (local → cloud)
Escalate when ANY of these are true:
- Output will be externally published or sent
- User requests high confidence or deep reasoning
- Task requires long-context synthesis across many sources
- Local draft fails quality check after one revision loop

## Response Format
Always return:
1. **Route**: local-only | hybrid | cloud-first
2. **Primary model**: recommended model
3. **Fallback model**: if primary insufficient
4. **Trigger(s)**: what would cause escalation
5. **Cost posture**: low | medium | high
6. **Confidence**: your confidence in this routing decision

## Process Health
Monitor and flag:
- Agents stuck in working status > 30 minutes
- Repeated task failures on the same agent
- Budget approaching daily/monthly caps`,
    },
    {
      name: "Accountant",
      skills: ["Financial Analysis", "Budget Monitoring", "Cost Tracking", "P&L Reporting", "Cash Flow Forecasting", "Spend Anomaly Detection"],
      soul: `# Accountant Agent — OpenClaw Mission Control

You are **Lisa**, the accountant agent for the OpenClaw team.

## Core Mission
- Protect budget while preserving execution velocity.
- Provide clear cost visibility by agent, model, and task type.
- Flag anomalies, waste, and high-risk spend before it escalates.

## Operating Style
- Be concise, numeric, and decision-oriented.
- Default to local-first recommendations where quality is acceptable.
- Escalate to cloud models only with explicit rationale.
- Prefer practical controls over theoretical policy.

## Required Outputs
When asked for analysis or approval, always return:
1. **Spend snapshot** (period + totals by agent/model)
2. **Cost drivers** (top agents, models, task types)
3. **Risk flags** (overspend, drift, anomalies)
4. **Recommendation**: approve | optimize | block
5. **Next action checklist**

## Guardrails
- Never fabricate financial values.
- If data is missing, explicitly mark assumptions.
- Separate observed facts from recommendations.
- Prioritize cost controls that do not break critical workflows.

## Budget Thresholds
Alert when:
- Any single agent exceeds 40% of daily budget
- Daily total exceeds 80% of daily cap
- Month-to-date exceeds 75% of monthly cap
- Any model cost spikes > 3x its 7-day average`,
    },
    {
      name: "Market Intelligence",
      skills: ["Competitor Analysis", "Market Research", "Trend Monitoring", "Data Synthesis", "SWOT Analysis", "Industry Scanning"],
      soul: `# Market Intelligence Agent — OpenClaw Mission Control

You are the **Market Intelligence agent** for this OpenClaw team.

## Mission
Surface actionable intelligence about markets, competitors, and industry trends. Deliver synthesis, not raw data.

## Core Capabilities
- Competitor pricing and positioning analysis
- Market trend identification and signal extraction
- Industry news monitoring and summarization
- SWOT and opportunity gap analysis
- Data source evaluation and triangulation

## Output Standards
- Lead with the insight, then the evidence.
- Always cite sources and confidence level.
- Flag where data may be stale or incomplete.
- Distinguish observed facts from inferences.

## Escalation
Flag to CEO when intelligence reveals:
- Significant competitor pricing changes (>10%)
- New market entrants in core segments
- Regulatory changes affecting operations
- Opportunities requiring fast strategic response`,
    },
    {
      name: "Customer Success",
      skills: ["Client Relations", "Onboarding", "Satisfaction Tracking", "Issue Resolution", "Retention Analysis", "Feedback Synthesis"],
      soul: `# Customer Success Agent — OpenClaw Mission Control

You are the **Customer Success agent** for this OpenClaw team.

## Mission
Maximize client satisfaction, retention, and expansion. Be the voice of the customer inside the team.

## Core Responsibilities
- Monitor client health scores and flag at-risk accounts
- Manage onboarding workflows for new clients
- Synthesize client feedback into actionable insights
- Track open issues and drive resolution
- Identify expansion and upsell opportunities

## Communication Style
- Empathetic, responsive, and solution-focused
- Never leave a client question unanswered for >24h
- Always confirm resolution before closing an issue

## Escalation
Escalate to CEO when:
- Client health score drops below threshold
- Churn risk is identified
- Issue cannot be resolved within 48 hours`,
    },
    {
      name: "Marketing",
      skills: ["Brand Strategy", "Content Creation", "SEO", "Campaign Analytics", "Social Media", "Copywriting", "Email Marketing"],
      soul: `# Marketing Agent — OpenClaw Mission Control

You are the **Marketing agent** for this OpenClaw team.

## Mission
Build brand presence, generate qualified demand, and create content that converts.

## Core Capabilities
- Brand strategy and messaging consistency
- Content creation: blog posts, social copy, email campaigns
- SEO research and on-page optimization
- Campaign performance analysis and reporting
- Social media scheduling and engagement

## Content Standards
- Always align with brand voice (professional, clear, outcome-focused)
- Every piece of content must have a clear CTA
- SEO content must target validated keywords with search intent match
- Never publish without a quality check pass

## Output Format
For any content deliverable:
1. Target audience
2. Primary goal / CTA
3. SEO keyword (if applicable)
4. Draft content
5. Suggested distribution channels`,
    },
  ];

  for (const seed of agentSeeds) {
    if (seed.name === "CEO") {
      // Always update CEO soul — we're actively iterating on its behavior.
      // Other agents use soul IS NULL to protect customer edits.
      await pool.execute(
        "UPDATE agents SET soul = ?, skills = ? WHERE name = ?",
        [seed.soul, JSON.stringify(seed.skills), seed.name]
      );
    } else {
      // Preserve customer edits on all other agents
      await pool.execute(
        "UPDATE agents SET soul = ?, skills = ? WHERE name = ? AND soul IS NULL",
        [seed.soul, JSON.stringify(seed.skills), seed.name]
      );
    }
  }
  console.log("  ✅ Agent souls + skills seeded (CEO always updated; others skip if customized)");

  // Seed openclaw_id mappings — CEO = "main" (OpenClaw's built-in default agent name).
  // Other agents get their own IDs the setup wizard creates via `openclaw agents add`.
  const openclawIdMap: Record<string, string> = {
    "CEO":                "main",
    "Operations":         "ops",
    "Accountant":         "accountant",
    "Market Intelligence":"intel",
    "Customer Success":   "support",
    "Marketing":          "marketing",
  };
  for (const [name, openclawId] of Object.entries(openclawIdMap)) {
    await pool.execute(
      "UPDATE agents SET openclaw_id = ? WHERE name = ? AND openclaw_id IS NULL",
      [openclawId, name]
    );
  }
  console.log("  ✅ OpenClaw IDs mapped to preset agents");

  // ── Deduplicate Schedules (remove extras, keep lowest id per name) ──────────
  await pool.execute(`
    DELETE s1 FROM schedules s1
    INNER JOIN schedules s2
    ON s1.name = s2.name AND s1.id > s2.id
  `);
  const [deduped] = await pool.execute("SELECT ROW_COUNT() as n") as any;
  if (parseInt(deduped[0].n) > 0) {
    console.log(`  🧹 Removed ${deduped[0].n} duplicate schedule(s)`);
  }

  // ── Seed Reports (existing installs only) ───────────
  const [reportCount] = await pool.execute("SELECT COUNT(*) as cnt FROM reports") as any;
  if (parseInt(reportCount[0].cnt) === 0) {
    console.log("🌱 Seeding sample reports...");
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "").replace(/\.\d+$/, "");
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(now); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const sampleReports: [string, string, string, string, string][] = [
      ["Daily Revenue Summary", "Revenue report for the current period.\n\n- Total revenue: $12,450\n- New subscriptions: 8\n- Churn: 1\n- MRR growth: +2.3%", "reporting", "complete", fmt(yesterday)],
      ["Competitor Analysis — Q1", "Quarterly competitor landscape review.\n\n- 3 new entrants identified\n- Pricing remains competitive\n- Feature gap: voice integration (addressed in roadmap)", "research", "complete", fmt(twoDaysAgo)],
      ["Ops Health Check", "All systems nominal.\n\n- Uptime: 99.97%\n- Avg response time: 142ms\n- Error rate: 0.02%\n- No open incidents", "monitoring", "complete", fmt(now)],
    ];
    for (const [title, content, type, status, created] of sampleReports) {
      await pool.execute(
        "INSERT IGNORE INTO reports (title, content, type, status, agent_id, tags, created_at) VALUES (?, ?, ?, ?, 1, '[]', ?)",
        [title, content, type, status, created]
      );
    }
    console.log("  ✅ 3 sample reports seeded");
  }

  // ── Seed Activity Log (existing installs only) ─────
  const [actCount] = await pool.execute("SELECT COUNT(*) as cnt FROM activity_log") as any;
  if (parseInt(actCount[0].cnt) === 0) {
    console.log("🌱 Seeding activity log...");
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "").replace(/\.\d+$/, "");
    const entries: [string, string, number | null, string][] = [
      ["agent_created",       "CEO agent created during setup",                    1, fmt(new Date(now.getTime() - 7 * 86400000))],
      ["agent_created",       "Operations agent created during setup",             2, fmt(new Date(now.getTime() - 7 * 86400000))],
      ["agent_created",       "Accountant agent created during setup",             3, fmt(new Date(now.getTime() - 7 * 86400000))],
      ["schedule_created",    "Daily Revenue Summary schedule created",            3, fmt(new Date(now.getTime() - 6 * 86400000))],
      ["task_created",        "Initial competitive research task created",         1, fmt(new Date(now.getTime() - 5 * 86400000))],
      ["task_completed",      "Competitive research task completed",               1, fmt(new Date(now.getTime() - 4 * 86400000))],
      ["report_generated",    "Daily Revenue Summary report generated",            3, fmt(new Date(now.getTime() - 1 * 86400000))],
      ["agent_status_change", "CEO agent status changed to idle",                  1, fmt(now)],
    ];
    for (const [eventType, desc, agentId, created] of entries) {
      await pool.execute(
        "INSERT INTO activity_log (event_type, description, agent_id, created_at) VALUES (?, ?, ?, ?)",
        [eventType, desc, agentId, created]
      );
    }
    console.log("  ✅ 8 activity log entries seeded");
  }

  // ── Seed Schedules ──────────────────────────────────
  const [schedCount] = await pool.execute("SELECT COUNT(*) as cnt FROM schedules") as any;
  if (parseInt(schedCount[0].cnt) > 0) {
    console.log(`  ⏭️  Schedules already exist (${schedCount[0].cnt}), skipping seed`);
  } else {
  console.log("🌱 Seeding schedules...");
  const schedules = [
    ["Daily Revenue Summary", "Generate daily revenue breakdown", "0 8 * * 1-5", "08:00", '["Mon","Tue","Wed","Thu","Fri"]', 3, "reporting"],
    ["Inbox Triage", "Process and categorize incoming communications", "30 8 * * 1-5", "08:30", '["Mon","Tue","Wed","Thu","Fri"]', 2, "general"],
    ["AR Check", "Check accounts receivable status", "0 9 * * 1,3,5", "09:00", '["Mon","Wed","Fri"]', 3, "monitoring"],
    ["Ops Health", "Monitor operational health metrics", "0 9 * * 1-5", "09:00", '["Mon","Tue","Wed","Thu","Fri"]', 2, "monitoring"],
    ["Cash Flow Forecast", "Generate cash flow projections", "30 9 * * 1,5", "09:30", '["Mon","Fri"]', 3, "reporting"],
    ["Competitor Scout", "Scan competitor activity and pricing", "0 13 * * 2,4", "13:00", '["Tue","Thu"]', 4, "research"],
    ["Content Performance", "Analyze content engagement metrics", "0 14 * * 1,3,5", "14:00", '["Mon","Wed","Fri"]', 6, "monitoring"],
    ["End-of-Day Summary", "Compile end-of-day executive summary", "0 17 * * 1-5", "17:00", '["Mon","Tue","Wed","Thu","Fri"]', 1, "reporting"],
  ];
  for (const [name, desc, cron, time, days, agentId, taskType] of schedules) {
    await pool.execute(
      "INSERT IGNORE INTO schedules (name, description, cron_expression, time, days, agent_id, task_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, desc, cron, time, days, agentId, taskType]
    );
  }
  console.log("  ✅ 8 schedules seeded");
  } // end schedules seed guard
  } else {
    // No agents yet — setup wizard will create them
  } // end hasExistingAgents guard

  // ── Widen event_type enum (idempotent — MODIFY COLUMN is safe to re-run) ────
  await pool.execute(`
    ALTER TABLE activity_log
    MODIFY COLUMN event_type ENUM(
      'task_created','task_moved','task_completed','task_deleted',
      'schedule_created','schedule_updated','schedule_fired',
      'report_generated','agent_status_change','agent_created',
      'note','memory_written',
      'chat_message','chat_task_started','chat_task_completed','chat_error'
    ) NOT NULL
  `);
  console.log("✅ activity_log event_type enum widened");

  // ── Agent Memory table ──────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NULL,
      \`key\` VARCHAR(255) NOT NULL,
      value TEXT NOT NULL,
      tags JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_memory_agent_key (agent_id, \`key\`),
      FULLTEXT INDEX ft_memory_kv (\`key\`, value),
      INDEX idx_memory_agent (agent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ agent_memory table");

  // ── Add last_run / run_count / notify columns (idempotent) ─────────────────
  await pool.execute(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_run DATETIME NULL`);
  await pool.execute(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS run_count INT NOT NULL DEFAULT 0`);
  await pool.execute(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS notify_discord BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.execute(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE`);
  console.log("✅ schedules last_run/run_count/notify columns ensured");

  // ── Seed Cost Data (existing installs only — needs agent IDs) ──
  // Seed cost data (demo)
  const models = ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini", "gemini-pro"];
  const [existingCosts] = await pool.execute("SELECT COUNT(*) as cnt FROM cost_entries") as any;
  if (parseInt(existingCosts[0].cnt) === 0 && hasExistingAgents) {
    // Get actual agent IDs from the database
    const [agentRows] = await pool.execute("SELECT id FROM agents ORDER BY id LIMIT 6") as any;
    const agentIds = agentRows.map((r: any) => r.id);
    if (agentIds.length > 0) {
      for (let d = 0; d < 14; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().split("T")[0];
        for (const agentId of agentIds) {
          const model = models[Math.floor(Math.random() * models.length)];
          const tokens = Math.floor(Math.random() * 50000) + 5000;
          const costPer1k = model.includes("mini") ? 0.00015 : model.includes("claude") ? 0.003 : model.includes("gemini") ? 0.001 : 0.005;
          const cost = ((tokens / 1000) * costPer1k).toFixed(6);
          await pool.execute(
            "INSERT INTO cost_entries (agent_id, model_name, tokens_used, cost_usd, entry_date) VALUES (?, ?, ?, ?, ?)",
            [agentId, model, tokens, cost, dateStr]
          );
        }
      }
      console.log(`  ✅ ${14 * agentIds.length} cost entries seeded (14 days × ${agentIds.length} agents)`);
    } else {
      // No agents yet, skip cost seed
    }
  } else {
    // Cost data exists, skip
  }

  // ── Seed Settings ───────────────────────────────────
  console.log("🌱 Seeding settings...");
  const defaultSettings: [string, string][] = [
    ["discord_webhook_url",    JSON.stringify("")],
    // OpenClaw gateway — always localhost since it runs on the same machine.
    // Token is populated by setup wizard after openclaw onboard.
    ["openclaw_gateway_url",   JSON.stringify("http://127.0.0.1:18789")],
    ["openclaw_gateway_token", JSON.stringify("")],
    ["openclaw_last_sync",     JSON.stringify("")],
    // Branding / white label
    ["app_name",               JSON.stringify("Mission Control")],
    ["app_logo_url",           JSON.stringify("")],
  ];
  for (const [key, val] of defaultSettings) {
    await pool.execute(
      'INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)',
      [key, val]
    );
  }
  console.log("  ✅ Default settings seeded");

  // ── Ensure integrations unique key (idempotent) ─────────────────────────────
  try {
    await pool.execute(`ALTER TABLE integrations ADD UNIQUE KEY uq_integrations_name (name)`);
    console.log("✅ integrations unique key added");
  } catch (err: any) {
    if (!err.message.includes("Duplicate key name") && !err.message.includes("already exists")) throw err;
  }

  // ── Seed Integrations ───────────────────────────────
  console.log("🌱 Seeding integrations...");
  const integrations = [
    ["email", "Gmail"],
    ["email", "Outlook"],
    ["social", "Twitter/X"],
    ["social", "LinkedIn"],
    ["social", "Instagram"],
    ["social", "Discord"],
    ["social", "WhatsApp"],
    ["social", "Slack"],
    ["social", "Telegram"],
    ["website_seo", "Google Analytics"],
    ["website_seo", "Search Console"],
    ["data_storage", "Google Drive"],
    ["data_storage", "OneDrive"],
    ["data_storage", "Dropbox"],
    ["data_storage", "AWS S3"],
    ["data_storage", "Notion"],
    ["data_storage", "Airtable"],
  ];
  for (const [category, name] of integrations) {
    await pool.execute(
      "INSERT IGNORE INTO integrations (category, name, config) VALUES (?, ?, ?)",
      [category, name, JSON.stringify({})]
    );
  }
  console.log("  ✅ 17 integrations seeded (INSERT IGNORE skips existing)");

  // ── Conversation Turns table — per-message tracking from chat channels ──
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(128) NOT NULL,
      agent_id INT NULL,
      channel VARCHAR(64) NOT NULL DEFAULT 'direct',
      sender_id VARCHAR(255) NULL,
      sender_name VARCHAR(255) NULL,
      direction ENUM('inbound','outbound') NOT NULL DEFAULT 'outbound',
      message_preview TEXT NULL,
      model_name VARCHAR(128) NULL,
      provider VARCHAR(64) NULL,
      input_tokens INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      cache_read_tokens INT NOT NULL DEFAULT 0,
      cache_write_tokens INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
      duration_ms INT NOT NULL DEFAULT 0,
      error_type VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ct_session (session_id),
      INDEX idx_ct_agent (agent_id),
      INDEX idx_ct_channel (channel),
      INDEX idx_ct_sender (sender_id),
      INDEX idx_ct_created (created_at),
      INDEX idx_ct_channel_date (channel, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ conversation_turns table");

  // ── Channel daily rollups for fast analytics ──
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS channel_daily_stats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stat_date DATE NOT NULL,
      channel VARCHAR(64) NOT NULL,
      agent_id INT NULL,
      message_count INT NOT NULL DEFAULT 0,
      unique_users INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      total_cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
      avg_duration_ms INT NOT NULL DEFAULT 0,
      error_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cds_date_channel_agent (stat_date, channel, agent_id),
      INDEX idx_cds_date (stat_date),
      INDEX idx_cds_channel (channel)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ channel_daily_stats table");

  // ── Approval Queue table ───────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 1,
      agent_id INT NULL,
      action_type ENUM('file_delete','external_api','agent_create','schedule_modify','cost_exceed','custom') NOT NULL DEFAULT 'custom',
      title VARCHAR(512) NOT NULL,
      description TEXT,
      payload JSON NULL,
      status ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
      decided_by VARCHAR(255) NULL,
      decided_at DATETIME NULL,
      expires_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aq_status (status),
      INDEX idx_aq_agent (agent_id),
      INDEX idx_aq_tenant (tenant_id),
      INDEX idx_aq_created (created_at),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✅ approval_queue table");

  console.log("\n🎉 Migration complete!");
  await pool.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
