import mysql from "mysql2/promise";
import type {
  Agent, InsertAgent,
  Task, InsertTask,
  Schedule, InsertSchedule,
  Report, InsertReport,
  ActivityLog,
  CostEntry, InsertCostEntry,
  Setting,
  Integration,
  CostAnalytics,
  DashboardStats,
  Approval, InsertApproval,
} from "@shared/schema";

// ── Interface ───────────────────────────────────────────
export interface IStorage {
  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(id: number): Promise<Agent | undefined>;
  getAgentByOpenclawId(openclawId: string): Promise<Agent | undefined>;
  createAgent(data: InsertAgent): Promise<Agent>;
  updateAgentStatus(id: number, status: string, taskSummary?: string | null): Promise<Agent | undefined>;
  updateAgent(id: number, updates: { name?: string; role?: string; avatar_color?: string; agent_type?: string; openclaw_id?: string | null; soul?: string | null; skills?: string[] | null; model_config?: Record<string, any> | null }): Promise<Agent | undefined>;
  // promoteAgent: flip ephemeral → permanent so it stays in the roster permanently
  promoteAgent(id: number): Promise<Agent | undefined>;

  // Tasks
  getTasks(status?: string): Promise<Task[]>;
  getTaskById(id: number): Promise<Task | undefined>;
  getTasksByStatus(status: string): Promise<Task[]>;
  getTasksByAgent(agentId: number): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: number): Promise<boolean>;
  moveTask(id: number, status: string, position: number): Promise<Task | undefined>;

  // Schedules
  getSchedules(): Promise<Schedule[]>;
  getSchedulesByAgent(agentId: number): Promise<Schedule[]>;
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  updateSchedule(id: number, updates: Partial<InsertSchedule>): Promise<Schedule | undefined>;
  deleteSchedule(id: number): Promise<boolean>;
  toggleSchedule(id: number): Promise<Schedule | undefined>;
  markScheduleRun(id: number): Promise<void>;

  // Reports
  getReports(filters?: { status?: string; type?: string; search?: string }): Promise<Report[]>;
  getReport(id: number): Promise<Report | undefined>;
  getReportsByAgent(agentId: number): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;
  updateReport(id: number, updates: Partial<InsertReport>): Promise<Report | undefined>;

  // Activity
  getActivityLog(limit?: number, agentId?: number): Promise<ActivityLog[]>;
  logActivity(eventType: string, description: string, agentId?: number | null, taskId?: number | null, metadata?: Record<string, any> | null): Promise<ActivityLog>;

  // Cost Analytics
  getCostAnalytics(period?: string): Promise<CostAnalytics>;
  getCostEntries(): Promise<CostEntry[]>;
  addCostEntry(entry: InsertCostEntry): Promise<CostEntry>;

  // Stats
  getStats(): Promise<DashboardStats>;

  // Settings
  getSettings(): Promise<Setting[]>;
  updateSetting(key: string, value: any): Promise<Setting | undefined>;

  // Integrations
  getIntegrations(): Promise<Integration[]>;
  updateIntegration(id: number, updates: { config?: Record<string, any>; is_connected?: boolean }): Promise<Integration | undefined>;

  // Search
  search(query: string): Promise<{ tasks: Task[]; reports: Report[]; schedules: Schedule[] }>;

  // Agent Memory
  writeMemory(entry: InsertAgentMemory): Promise<AgentMemory>;
  searchMemory(query: string, agentId?: number): Promise<AgentMemory[]>;
  getMemoryByKey(key: string, agentId?: number): Promise<AgentMemory | undefined>;

  // Approval Queue
  getApprovals(status?: string): Promise<Approval[]>;
  getApproval(id: number): Promise<Approval | undefined>;
  createApproval(data: InsertApproval): Promise<Approval>;
  decideApproval(id: number, decision: "approved" | "rejected", decidedBy: string): Promise<Approval | undefined>;
  getPendingApprovalCount(): Promise<number>;

  // Raw query — used by telemetry collector and analytics
  query(sql: string, params?: any[]): Promise<any>;
}

// ── AgentMemory type ────────────────────────────────────
export interface AgentMemory {
  id: number;
  agent_id: number | null;
  key: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface InsertAgentMemory {
  agent_id?: number | null;
  key: string;
  value: string;
  tags?: string[];
}

// ── Helper to parse JSON fields ─────────────────────────
function parseJson(val: any, fallback: any = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function rowToAgent(row: any): Agent {
  return {
    ...row,
    is_active: !!row.is_active,
    agent_type: row.agent_type ?? "permanent",
    openclaw_id: row.openclaw_id ?? null,
    soul: row.soul ?? null,
    skills: parseJson(row.skills, []),
    model_config: parseJson(row.model_config, null),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToTask(row: any): Task {
  return {
    ...row,
    notify_discord: !!row.notify_discord,
    notify_whatsapp: !!row.notify_whatsapp,
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToSchedule(row: any): Schedule {
  return {
    ...row,
    days: parseJson(row.days, []),
    is_enabled: !!row.is_enabled,
    notify_on_failure: !!row.notify_on_failure,
    notify_discord: !!row.notify_discord,
    notify_whatsapp: !!row.notify_whatsapp,
    last_run: row.last_run ? (row.last_run?.toISOString?.() ?? String(row.last_run)) : null,
    run_count: parseInt(row.run_count ?? "0"),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToReport(row: any): Report {
  return {
    ...row,
    tags: parseJson(row.tags, []),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToActivity(row: any): ActivityLog {
  return {
    ...row,
    metadata: parseJson(row.metadata, null),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
  };
}

function rowToCostEntry(row: any): CostEntry {
  return {
    ...row,
    cost_usd: parseFloat(row.cost_usd),
    entry_date: row.entry_date?.toISOString?.()?.split("T")[0] ?? String(row.entry_date),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
  };
}

function rowToSetting(row: any): Setting {
  return {
    ...row,
    setting_value: parseJson(row.setting_value, null),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToIntegration(row: any): Integration {
  return {
    ...row,
    config: parseJson(row.config, {}),
    is_connected: !!row.is_connected,
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function rowToMemory(row: any): AgentMemory {
  return {
    id: row.id,
    agent_id: row.agent_id ?? null,
    key: row.key,
    value: row.value,
    tags: parseJson(row.tags, []),
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

// ── Period helper ───────────────────────────────────────
/** Returns a YYYY-MM-DD cutoff date string for the given period, or null for "all". */
function periodCutoff(period: string): string | null {
  const d = new Date();
  if (period === "today") return d.toISOString().slice(0, 10);
  if (period === "week")  { d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); }
  if (period === "month") { d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); }
  return null; // "all"
}

// ── In-Memory Storage (for sandbox/dev when no DB) ──────
export class MemStorage implements IStorage {
  private agents: Agent[] = [];
  private tasks: Task[] = [];
  private schedules: Schedule[] = [];
  private reports: Report[] = [];
  private activityLog: ActivityLog[] = [];
  private costEntries: CostEntry[] = [];
  private settings: Setting[] = [];
  private integrations: Integration[] = [];
  private nextId = { agent: 1, task: 1, schedule: 1, report: 1, activity: 1, cost: 1, setting: 1, integration: 1 };

  constructor() {
    this.seedData();
  }

  private seedData() {
    const now = new Date().toISOString();
    // Seed agents
    const agentDefs: { name: string; role: string; avatar_color: string }[] = [
      { name: "CEO", role: "Strategic Oversight & Decision Making", avatar_color: "#0d9488" },
      { name: "Operations", role: "Process Management & Optimization", avatar_color: "#8b5cf6" },
      { name: "Accountant", role: "Financial Analysis & Reporting", avatar_color: "#f59e0b" },
      { name: "Market Intelligence", role: "Market Research & Competitive Analysis", avatar_color: "#3b82f6" },
      { name: "Customer Success", role: "Client Relations & Satisfaction", avatar_color: "#ec4899" },
      { name: "Marketing", role: "Brand Strategy & Content Creation", avatar_color: "#10b981" },
    ];
    for (const a of agentDefs) {
      this.agents.push({
        id: this.nextId.agent++,
        name: a.name, role: a.role, avatar_color: a.avatar_color,
        status: "idle", current_task_summary: null, is_active: true,
        created_at: now, updated_at: now,
      });
    }

    // Seed tasks
    const taskDefs = [
      { title: "Review Q1 Revenue Targets", status: "backlog" as const, priority: "high" as const, agent_id: 1 },
      { title: "Optimize Shipping Pipeline", status: "doing" as const, priority: "medium" as const, agent_id: 2 },
      { title: "Monthly P&L Reconciliation", status: "doing" as const, priority: "high" as const, agent_id: 3 },
      { title: "Competitor Pricing Analysis", status: "backlog" as const, priority: "medium" as const, agent_id: 4 },
      { title: "Onboard 3 New Enterprise Clients", status: "doing" as const, priority: "critical" as const, agent_id: 5 },
      { title: "Launch Spring Campaign", status: "backlog" as const, priority: "high" as const, agent_id: 6 },
      { title: "Quarterly Board Presentation", status: "done" as const, priority: "high" as const, agent_id: 1 },
      { title: "Update SOP Documentation", status: "done" as const, priority: "low" as const, agent_id: 2 },
    ];
    for (const t of taskDefs) {
      this.tasks.push({
        id: this.nextId.task++,
        title: t.title, description: null, status: t.status, priority: t.priority,
        agent_id: t.agent_id, notify_discord: false, notify_whatsapp: false,
        position: this.nextId.task, created_at: now, updated_at: now,
      });
    }

    // Seed schedules
    const scheduleDefs = [
      { name: "Daily Revenue Summary", time: "08:00", agent_id: 3, task_type: "reporting" as const, days: ["Mon","Tue","Wed","Thu","Fri"] },
      { name: "Inbox Triage", time: "08:30", agent_id: 2, task_type: "general" as const, days: ["Mon","Tue","Wed","Thu","Fri"] },
      { name: "AR Check", time: "09:00", agent_id: 3, task_type: "monitoring" as const, days: ["Mon","Wed","Fri"] },
      { name: "Ops Health", time: "09:00", agent_id: 2, task_type: "monitoring" as const, days: ["Mon","Tue","Wed","Thu","Fri"] },
      { name: "Cash Flow Forecast", time: "09:30", agent_id: 3, task_type: "reporting" as const, days: ["Mon","Fri"] },
      { name: "Competitor Scout", time: "13:00", agent_id: 4, task_type: "research" as const, days: ["Tue","Thu"] },
      { name: "Content Performance", time: "14:00", agent_id: 6, task_type: "monitoring" as const, days: ["Mon","Wed","Fri"] },
      { name: "End-of-Day Summary", time: "17:00", agent_id: 1, task_type: "reporting" as const, days: ["Mon","Tue","Wed","Thu","Fri"] },
    ];
    for (const s of scheduleDefs) {
      this.schedules.push({
        id: this.nextId.schedule++,
        name: s.name, description: null, cron_expression: "0 9 * * *",
        time: s.time, days: s.days, agent_id: s.agent_id, task_type: s.task_type,
        is_enabled: true, priority: "medium", on_failure: "notify_only",
        max_retries: 3, timeout_minutes: 60, notify_on_failure: true,
        notify_discord: false, notify_whatsapp: false,
        last_run: null, run_count: 0,
        created_at: now, updated_at: now,
      });
    }

    // Seed reports
    const reportDefs = [
      { title: "Q1 Revenue Analysis", type: "financial", status: "complete" as const, agent_id: 3, content: "## Q1 Revenue Summary\n\nTotal revenue for Q1 reached **$2.4M**, representing a 12% increase YoY.\n\n### Key Highlights\n- Subscription revenue up 18%\n- Enterprise deals closed: 7\n- Churn rate reduced to 2.1%\n\n### Recommendations\n1. Increase investment in enterprise sales\n2. Launch customer referral program\n3. Expand into APAC market", tags: ["finance", "quarterly"] },
      { title: "Competitor Landscape Report", type: "research", status: "complete" as const, agent_id: 4, content: "## Competitive Analysis\n\n### Key Competitors\n| Company | Market Share | Trend |\n|---------|-------------|-------|\n| Alpha Corp | 23% | ↑ |\n| Beta Inc | 18% | → |\n| Gamma Ltd | 12% | ↓ |\n\n### Strategic Insights\n- Alpha Corp launched AI-powered features\n- Beta Inc expanding into our segment\n- Gap in mid-market pricing identified", tags: ["competitive", "research"] },
      { title: "Customer Satisfaction Survey Results", type: "customer", status: "complete" as const, agent_id: 5, content: "## CSAT Results - March 2026\n\n**Overall Score: 4.3/5.0**\n\n### By Category\n- Product Quality: 4.5\n- Support Response: 4.1\n- Onboarding: 4.4\n- Value for Money: 4.2\n\n### Top Requests\n1. Mobile app improvements\n2. Better API documentation\n3. Real-time collaboration features", tags: ["customer", "survey"] },
    ];
    for (const r of reportDefs) {
      this.reports.push({
        id: this.nextId.report++,
        title: r.title, content: r.content, type: r.type, status: r.status,
        agent_id: r.agent_id, tags: r.tags,
        created_at: now, updated_at: now,
      });
    }

    // Seed activity
    const activities = [
      { event_type: "task_created" as const, description: "Created task: Review Q1 Revenue Targets", agent_id: 1 },
      { event_type: "report_generated" as const, description: "Generated Q1 Revenue Analysis report", agent_id: 3 },
      { event_type: "task_moved" as const, description: "Moved 'Optimize Shipping Pipeline' to Doing", agent_id: 2 },
      { event_type: "schedule_created" as const, description: "Created schedule: Daily Revenue Summary", agent_id: 3 },
      { event_type: "agent_status_change" as const, description: "CEO agent status changed to idle", agent_id: 1 },
      { event_type: "task_moved" as const, description: "Moved 'Quarterly Board Presentation' to Done", agent_id: 1 },
    ];
    for (const a of activities) {
      const offset = this.nextId.activity * 300000;
      this.activityLog.push({
        id: this.nextId.activity++,
        event_type: a.event_type, description: a.description,
        agent_id: a.agent_id, task_id: null, metadata: null,
        created_at: new Date(Date.now() - offset).toISOString(),
      });
    }

    // Seed cost entries
    const models = ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini", "gemini-pro"];
    for (let d = 0; d < 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split("T")[0];
      for (let agentIdx = 0; agentIdx < 6; agentIdx++) {
        const model = models[Math.floor(Math.random() * models.length)];
        const tokens = Math.floor(Math.random() * 50000) + 5000;
        const costPer1k = model.includes("mini") ? 0.00015 : model.includes("claude") ? 0.003 : model.includes("gemini") ? 0.001 : 0.005;
        const cost = parseFloat(((tokens / 1000) * costPer1k).toFixed(6));
        this.costEntries.push({
          id: this.nextId.cost++,
          agent_id: agentIdx + 1,
          model_name: model,
          tokens_used: tokens,
          cost_usd: cost,
          entry_date: dateStr,
          created_at: now,
        });
      }
    }

    // Seed settings
    this.settings.push({
      id: this.nextId.setting++,
      setting_key: "discord_webhook_url",
      setting_value: "",
      updated_at: now,
    });

    // Seed integrations
    const intDefs = [
      { category: "email" as const, name: "Gmail" },
      { category: "email" as const, name: "Outlook" },
      { category: "social" as const, name: "Twitter/X" },
      { category: "social" as const, name: "LinkedIn" },
      { category: "social" as const, name: "Instagram" },
      { category: "website_seo" as const, name: "Google Analytics" },
      { category: "website_seo" as const, name: "Search Console" },
      { category: "data_storage" as const, name: "Google Drive" },
      { category: "data_storage" as const, name: "OneDrive" },
      { category: "data_storage" as const, name: "Dropbox" },
      { category: "data_storage" as const, name: "AWS S3" },
      { category: "data_storage" as const, name: "Notion" },
      { category: "data_storage" as const, name: "Airtable" },
    ];
    for (const i of intDefs) {
      this.integrations.push({
        id: this.nextId.integration++,
        category: i.category, name: i.name,
        config: {}, is_connected: false,
        updated_at: now,
      });
    }
  }

  // ── Agents ──────────────────────────────────────────
  async getAgents(): Promise<Agent[]> { return this.agents; }
  async getAgent(id: number): Promise<Agent | undefined> { return this.agents.find(a => a.id === id); }
  async getAgentByOpenclawId(openclawId: string): Promise<Agent | undefined> {
    return this.agents.find(a => a.openclaw_id === openclawId);
  }
  async createAgent(data: InsertAgent): Promise<Agent> {
    const now = new Date().toISOString();
    const agent: Agent = {
      id: this.nextId.agent++,
      name: data.name,
      role: data.role,
      avatar_color: data.avatar_color ?? "#0d9488",
      status: "idle",
      current_task_summary: null,
      is_active: true,
      agent_type: data.agent_type ?? "permanent",
      openclaw_id: data.openclaw_id ?? null,
      soul: data.soul ?? null,
      skills: data.skills ?? [],
      model_config: data.model_config ?? null,
      created_at: now,
      updated_at: now,
    };
    this.agents.push(agent);
    return agent;
  }
  async promoteAgent(id: number): Promise<Agent | undefined> {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) return undefined;
    agent.agent_type = "permanent";
    agent.updated_at = new Date().toISOString();
    return agent;
  }
  async updateAgentStatus(id: number, status: string, taskSummary?: string | null): Promise<Agent | undefined> {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) return undefined;
    agent.status = status as any;
    if (taskSummary !== undefined) agent.current_task_summary = taskSummary;
    agent.updated_at = new Date().toISOString();
    return agent;
  }
  async updateAgent(id: number, updates: { name?: string; role?: string; avatar_color?: string; soul?: string | null; skills?: string[] | null; model_config?: Record<string, any> | null }): Promise<Agent | undefined> {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) return undefined;
    if (updates.name !== undefined) agent.name = updates.name;
    if (updates.role !== undefined) agent.role = updates.role;
    if (updates.avatar_color !== undefined) agent.avatar_color = updates.avatar_color;
    if (updates.soul !== undefined) agent.soul = updates.soul;
    if (updates.skills !== undefined) agent.skills = updates.skills;
    if (updates.model_config !== undefined) agent.model_config = updates.model_config;
    agent.updated_at = new Date().toISOString();
    return agent;
  }

  // ── Tasks ───────────────────────────────────────────
  async getTasks(status?: string): Promise<Task[]> {
    if (status) return this.tasks.filter(t => t.status === status);
    return this.tasks;
  }
  async getTaskById(id: number): Promise<Task | undefined> { return this.tasks.find(t => t.id === id); }
  async getTasksByStatus(status: string): Promise<Task[]> { return this.tasks.filter(t => t.status === status); }
  async getTasksByAgent(agentId: number): Promise<Task[]> { return this.tasks.filter(t => t.agent_id === agentId); }
  async createTask(task: InsertTask): Promise<Task> {
    const now = new Date().toISOString();
    const newTask: Task = {
      id: this.nextId.task++,
      title: task.title,
      description: task.description ?? null,
      status: task.status ?? "backlog",
      priority: task.priority ?? "medium",
      agent_id: task.agent_id ?? null,
      notify_discord: task.notify_discord ?? false,
      notify_whatsapp: task.notify_whatsapp ?? false,
      position: task.position ?? this.nextId.task,
      created_at: now,
      updated_at: now,
    };
    this.tasks.push(newTask);
    return newTask;
  }
  async updateTask(id: number, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return undefined;
    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    return task;
  }
  async deleteTask(id: number): Promise<boolean> {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    return true;
  }
  async moveTask(id: number, status: string, position: number): Promise<Task | undefined> {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return undefined;
    task.status = status as any;
    task.position = position;
    task.updated_at = new Date().toISOString();
    return task;
  }

  // ── Schedules ───────────────────────────────────────
  async getSchedules(): Promise<Schedule[]> { return this.schedules; }
  async getSchedulesByAgent(agentId: number): Promise<Schedule[]> { return this.schedules.filter(s => s.agent_id === agentId); }
  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const now = new Date().toISOString();
    const newSchedule: Schedule = {
      id: this.nextId.schedule++,
      name: schedule.name,
      description: schedule.description ?? null,
      cron_expression: schedule.cron_expression ?? "0 9 * * *",
      time: schedule.time ?? "09:00",
      days: schedule.days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"],
      agent_id: schedule.agent_id ?? null,
      task_type: schedule.task_type ?? "general",
      is_enabled: schedule.is_enabled ?? true,
      priority: schedule.priority ?? "medium",
      on_failure: schedule.on_failure ?? "notify_only",
      max_retries: schedule.max_retries ?? 3,
      timeout_minutes: schedule.timeout_minutes ?? 60,
      notify_on_failure: schedule.notify_on_failure ?? true,
      notify_discord: schedule.notify_discord ?? false,
      notify_whatsapp: schedule.notify_whatsapp ?? false,
      last_run: null,
      run_count: 0,
      created_at: now,
      updated_at: now,
    };
    this.schedules.push(newSchedule);
    return newSchedule;
  }
  async updateSchedule(id: number, updates: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const schedule = this.schedules.find(s => s.id === id);
    if (!schedule) return undefined;
    Object.assign(schedule, updates, { updated_at: new Date().toISOString() });
    return schedule;
  }
  async deleteSchedule(id: number): Promise<boolean> {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.schedules.splice(idx, 1);
    return true;
  }
  async toggleSchedule(id: number): Promise<Schedule | undefined> {
    const schedule = this.schedules.find(s => s.id === id);
    if (!schedule) return undefined;
    schedule.is_enabled = !schedule.is_enabled;
    schedule.updated_at = new Date().toISOString();
    return schedule;
  }
  async markScheduleRun(id: number): Promise<void> {
    const schedule = this.schedules.find(s => s.id === id);
    if (!schedule) return;
    schedule.last_run = new Date().toISOString();
    schedule.run_count = (schedule.run_count || 0) + 1;
    schedule.updated_at = new Date().toISOString();
  }

  // ── Reports ─────────────────────────────────────────
  async getReports(filters?: { status?: string; type?: string; search?: string }): Promise<Report[]> {
    let result = this.reports;
    if (filters?.status) result = result.filter(r => r.status === filters.status);
    if (filters?.type) result = result.filter(r => r.type === filters.type);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q) || r.content?.toLowerCase().includes(q));
    }
    return result;
  }
  async getReport(id: number): Promise<Report | undefined> { return this.reports.find(r => r.id === id); }
  async getReportsByAgent(agentId: number): Promise<Report[]> { return this.reports.filter(r => r.agent_id === agentId); }
  async createReport(report: InsertReport): Promise<Report> {
    const now = new Date().toISOString();
    const newReport: Report = {
      id: this.nextId.report++,
      title: report.title,
      content: report.content ?? null,
      type: report.type ?? "general",
      status: report.status ?? "generating",
      agent_id: report.agent_id ?? null,
      tags: report.tags ?? [],
      created_at: now,
      updated_at: now,
    };
    this.reports.push(newReport);
    return newReport;
  }
  async updateReport(id: number, updates: Partial<InsertReport>): Promise<Report | undefined> {
    const report = this.reports.find(r => r.id === id);
    if (!report) return undefined;
    Object.assign(report, updates, { updated_at: new Date().toISOString() });
    return report;
  }

  // ── Activity ────────────────────────────────────────
  async getActivityLog(limit = 50, agentId?: number): Promise<ActivityLog[]> {
    let result = [...this.activityLog].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (agentId) result = result.filter(a => a.agent_id === agentId);
    return result.slice(0, limit);
  }
  async logActivity(eventType: string, description: string, agentId?: number | null, taskId?: number | null, metadata?: Record<string, any> | null): Promise<ActivityLog> {
    const entry: ActivityLog = {
      id: this.nextId.activity++,
      event_type: eventType as any,
      description,
      agent_id: agentId ?? null,
      task_id: taskId ?? null,
      metadata: metadata ?? null,
      created_at: new Date().toISOString(),
    };
    this.activityLog.push(entry);
    return entry;
  }

  // ── Cost Analytics ──────────────────────────────────
  async getCostAnalytics(period = "all"): Promise<CostAnalytics> {
    const cutoff = periodCutoff(period);
    const entries = cutoff
      ? this.costEntries.filter(e => e.entry_date >= cutoff)
      : this.costEntries;

    const totalCost = entries.reduce((sum, e) => sum + e.cost_usd, 0);
    const dates = [...new Set(entries.map(e => e.entry_date))];
    const dailyAverage = dates.length > 0 ? totalCost / dates.length : 0;
    const totalTokens = entries.reduce((sum, e) => sum + e.tokens_used, 0);
    const activeModels = [...new Set(entries.map(e => e.model_name))].length;

    const dailyMap = new Map<string, number>();
    for (const e of entries) {
      dailyMap.set(e.entry_date, (dailyMap.get(e.entry_date) || 0) + e.cost_usd);
    }
    const dailyTrend = [...dailyMap.entries()]
      .map(([date, cost]) => ({ date, cost: parseFloat(cost.toFixed(4)) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const agentMap = new Map<number, { cost: number; tokens: number; models: Set<string> }>();
    for (const e of entries) {
      const cur = agentMap.get(e.agent_id) || { cost: 0, tokens: 0, models: new Set() };
      cur.cost += e.cost_usd; cur.tokens += e.tokens_used; cur.models.add(e.model_name);
      agentMap.set(e.agent_id, cur);
    }
    const perAgentCost = [...agentMap.entries()].map(([agentId, data]) => {
      const agent = this.agents.find(a => a.id === agentId);
      return { agent_name: agent?.name ?? `Agent ${agentId}`, cost: parseFloat(data.cost.toFixed(4)), tokens: data.tokens, models: [...data.models] };
    });

    const modelMap = new Map<string, { tokens: number; cost: number }>();
    for (const e of entries) {
      const existing = modelMap.get(e.model_name) || { tokens: 0, cost: 0 };
      existing.tokens += e.tokens_used;
      existing.cost += e.cost_usd;
      modelMap.set(e.model_name, existing);
    }
    const modelUsage = [...modelMap.entries()].map(([model, data]) => ({
      model, tokens: data.tokens, cost: parseFloat(data.cost.toFixed(4)),
    }));

    return { totalCost: parseFloat(totalCost.toFixed(4)), dailyAverage: parseFloat(dailyAverage.toFixed(4)), totalTokens, activeModels, period, dailyTrend, perAgentCost, modelUsage };
  }
  async getCostEntries(): Promise<CostEntry[]> { return this.costEntries; }
  async addCostEntry(entry: InsertCostEntry): Promise<CostEntry> {
    const newEntry: CostEntry = {
      id: this.nextId.cost++,
      ...entry,
      created_at: new Date().toISOString(),
    };
    this.costEntries.push(newEntry);
    return newEntry;
  }

  // ── Stats ───────────────────────────────────────────
  async getStats(): Promise<DashboardStats> {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = this.costEntries.filter(e => e.entry_date === today);
    return {
      totalTasks: this.tasks.length,
      tasksByStatus: {
        backlog: this.tasks.filter(t => t.status === "backlog").length,
        doing: this.tasks.filter(t => t.status === "doing").length,
        done: this.tasks.filter(t => t.status === "done").length,
      },
      activeAgents: this.agents.filter(a => a.is_active).length,
      totalSchedules: this.schedules.length,
      enabledSchedules: this.schedules.filter(s => s.is_enabled).length,
      totalReports: this.reports.length,
      recentActivity: this.activityLog.length,
      todayCost: parseFloat(todayEntries.reduce((s, e) => s + e.cost_usd, 0).toFixed(4)),
      todayTokens: todayEntries.reduce((s, e) => s + e.tokens_used, 0),
      contextUsagePercent: 0,
    };
  }

  // ── Settings ────────────────────────────────────────
  async getSettings(): Promise<Setting[]> { return this.settings; }
  async updateSetting(key: string, value: any): Promise<Setting | undefined> {
    let setting = this.settings.find(s => s.setting_key === key);
    if (!setting) {
      setting = {
        id: this.nextId.setting++,
        setting_key: key,
        setting_value: value,
        updated_at: new Date().toISOString(),
      };
      this.settings.push(setting);
    } else {
      setting.setting_value = value;
      setting.updated_at = new Date().toISOString();
    }
    return setting;
  }

  // ── Integrations ────────────────────────────────────
  async getIntegrations(): Promise<Integration[]> { return this.integrations; }
  async updateIntegration(id: number, updates: { config?: Record<string, any>; is_connected?: boolean }): Promise<Integration | undefined> {
    const integration = this.integrations.find(i => i.id === id);
    if (!integration) return undefined;
    if (updates.config !== undefined) integration.config = updates.config;
    if (updates.is_connected !== undefined) integration.is_connected = updates.is_connected;
    integration.updated_at = new Date().toISOString();
    return integration;
  }

  // ── Search ──────────────────────────────────────────
  async search(query: string): Promise<{ tasks: Task[]; reports: Report[]; schedules: Schedule[] }> {
    const q = query.toLowerCase();
    return {
      tasks: this.tasks.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)),
      reports: this.reports.filter(r => r.title.toLowerCase().includes(q) || r.content?.toLowerCase().includes(q)),
      schedules: this.schedules.filter(s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)),
    };
  }

  // ── Agent Memory ────────────────────────────────────
  private memories: AgentMemory[] = [];
  private nextMemoryId = 1;

  async writeMemory(entry: InsertAgentMemory): Promise<AgentMemory> {
    const existing = this.memories.find(
      m => m.key === entry.key && m.agent_id === (entry.agent_id ?? null)
    );
    if (existing) {
      existing.value = entry.value;
      existing.tags = entry.tags ?? [];
      existing.updated_at = new Date().toISOString();
      return existing;
    }
    const mem: AgentMemory = {
      id: this.nextMemoryId++,
      agent_id: entry.agent_id ?? null,
      key: entry.key,
      value: entry.value,
      tags: entry.tags ?? [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.memories.push(mem);
    return mem;
  }

  async searchMemory(query: string, agentId?: number): Promise<AgentMemory[]> {
    const q = query.toLowerCase();
    return this.memories.filter(m =>
      (agentId === undefined || m.agent_id === agentId) &&
      (m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q)))
    );
  }

  async getMemoryByKey(key: string, agentId?: number): Promise<AgentMemory | undefined> {
    return this.memories.find(m =>
      m.key === key && (agentId === undefined || m.agent_id === agentId)
    );
  }

  async query(_sql: string, _params?: any[]): Promise<any> {
    return []; // in-memory mode doesn't support raw queries
  }

  // Approval Queue (in-memory stubs)
  private approvals: Approval[] = [];
  async getApprovals(status?: string): Promise<Approval[]> { return status ? this.approvals.filter(a => a.status === status) : this.approvals; }
  async getApproval(id: number): Promise<Approval | undefined> { return this.approvals.find(a => a.id === id); }
  async createApproval(data: InsertApproval): Promise<Approval> {
    const a: Approval = { id: this.approvals.length + 1, tenant_id: 1, agent_id: data.agent_id ?? null, action_type: data.action_type, title: data.title, description: data.description || null, payload: data.payload || null, status: "pending", decided_by: null, decided_at: null, expires_at: data.expires_at || null, created_at: new Date().toISOString() };
    this.approvals.push(a);
    return a;
  }
  async decideApproval(id: number, decision: "approved" | "rejected", decidedBy: string): Promise<Approval | undefined> {
    const a = this.approvals.find(a => a.id === id);
    if (a) { a.status = decision; a.decided_by = decidedBy; a.decided_at = new Date().toISOString(); }
    return a;
  }
  async getPendingApprovalCount(): Promise<number> { return this.approvals.filter(a => a.status === "pending").length; }
}

// ── MariaDB Storage ─────────────────────────────────────
export class MariaDBStorage implements IStorage {
  private pool: mysql.Pool;

  constructor() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306", 10),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "mission_control",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }

  // ── Agents ──────────────────────────────────────────
  async getAgents(): Promise<Agent[]> {
    const rows = await this.query("SELECT * FROM agents ORDER BY id");
    return rows.map(rowToAgent);
  }
  async getAgent(id: number): Promise<Agent | undefined> {
    const rows = await this.query("SELECT * FROM agents WHERE id = ?", [id]);
    return rows[0] ? rowToAgent(rows[0]) : undefined;
  }
  async getAgentByOpenclawId(openclawId: string): Promise<Agent | undefined> {
    const rows = await this.query("SELECT * FROM agents WHERE openclaw_id = ? LIMIT 1", [openclawId]);
    return rows[0] ? rowToAgent(rows[0]) : undefined;
  }
  async createAgent(data: InsertAgent): Promise<Agent> {
    const [result] = await this.pool.execute(
      `INSERT INTO agents (name, role, avatar_color, agent_type, openclaw_id, soul, skills, model_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.role,
        data.avatar_color ?? "#0d9488",
        data.agent_type ?? "permanent",
        data.openclaw_id ?? null,
        data.soul ?? null,
        data.skills?.length ? JSON.stringify(data.skills) : null,
        data.model_config ? JSON.stringify(data.model_config) : null,
      ]
    );
    const insertId = (result as any).insertId;
    return (await this.getAgent(insertId))!;
  }
  async promoteAgent(id: number): Promise<Agent | undefined> {
    await this.query("UPDATE agents SET agent_type = 'permanent', updated_at = NOW() WHERE id = ?", [id]);
    return this.getAgent(id);
  }
  async updateAgentStatus(id: number, status: string, taskSummary?: string | null): Promise<Agent | undefined> {
    if (taskSummary !== undefined) {
      await this.query("UPDATE agents SET status = ?, current_task_summary = ?, updated_at = NOW() WHERE id = ?", [status, taskSummary, id]);
    } else {
      await this.query("UPDATE agents SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
    }
    return this.getAgent(id);
  }
  async updateAgent(id: number, updates: { name?: string; role?: string; avatar_color?: string; agent_type?: string; openclaw_id?: string | null; soul?: string | null; skills?: string[] | null; model_config?: Record<string, any> | null }): Promise<Agent | undefined> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
    if (updates.role !== undefined) { sets.push("role = ?"); params.push(updates.role); }
    if (updates.avatar_color !== undefined) { sets.push("avatar_color = ?"); params.push(updates.avatar_color); }
    if (updates.agent_type !== undefined) { sets.push("agent_type = ?"); params.push(updates.agent_type); }
    if (updates.openclaw_id !== undefined) { sets.push("openclaw_id = ?"); params.push(updates.openclaw_id); }
    if (updates.soul !== undefined) { sets.push("soul = ?"); params.push(updates.soul); }
    if (updates.skills !== undefined) { sets.push("skills = ?"); params.push(updates.skills === null ? null : JSON.stringify(updates.skills)); }
    if (updates.model_config !== undefined) { sets.push("model_config = ?"); params.push(updates.model_config === null ? null : JSON.stringify(updates.model_config)); }
    if (sets.length === 0) return this.getAgent(id);
    sets.push("updated_at = NOW()");
    params.push(id);
    await this.query(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.getAgent(id);
  }

  // ── Tasks ───────────────────────────────────────────
  async getTasks(status?: string): Promise<Task[]> {
    if (status) {
      const rows = await this.query("SELECT * FROM tasks WHERE status = ? ORDER BY position, id", [status]);
      return rows.map(rowToTask);
    }
    const rows = await this.query("SELECT * FROM tasks ORDER BY position, id");
    return rows.map(rowToTask);
  }
  async getTasksByStatus(status: string): Promise<Task[]> { return this.getTasks(status); }
  async getTasksByAgent(agentId: number): Promise<Task[]> {
    const rows = await this.query("SELECT * FROM tasks WHERE agent_id = ? ORDER BY position", [agentId]);
    return rows.map(rowToTask);
  }
  async createTask(task: InsertTask): Promise<Task> {
    const [result] = await this.pool.execute(
      "INSERT INTO tasks (title, description, status, priority, agent_id, notify_discord, notify_whatsapp, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [task.title, task.description ?? null, task.status ?? "backlog", task.priority ?? "medium", task.agent_id ?? null, task.notify_discord ? 1 : 0, task.notify_whatsapp ? 1 : 0, task.position ?? 0]
    );
    const insertId = (result as any).insertId;
    return (await this.getTaskById(insertId))!;
  }
  async getTaskById(id: number): Promise<Task | undefined> {
    const rows = await this.query("SELECT * FROM tasks WHERE id = ?", [id]);
    return rows[0] ? rowToTask(rows[0]) : undefined;
  }
  async updateTask(id: number, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
    if (updates.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(updates.agent_id); }
    if (updates.notify_discord !== undefined) { fields.push("notify_discord = ?"); values.push(updates.notify_discord ? 1 : 0); }
    if (updates.notify_whatsapp !== undefined) { fields.push("notify_whatsapp = ?"); values.push(updates.notify_whatsapp ? 1 : 0); }
    if (updates.position !== undefined) { fields.push("position = ?"); values.push(updates.position); }
    if (fields.length === 0) return this.getTaskById(id);
    fields.push("updated_at = NOW()");
    values.push(id);
    await this.query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values);
    return this.getTaskById(id);
  }
  async deleteTask(id: number): Promise<boolean> {
    const [result] = await this.pool.execute("DELETE FROM tasks WHERE id = ?", [id]);
    return (result as any).affectedRows > 0;
  }
  async moveTask(id: number, status: string, position: number): Promise<Task | undefined> {
    await this.query("UPDATE tasks SET status = ?, position = ?, updated_at = NOW() WHERE id = ?", [status, position, id]);
    return this.getTaskById(id);
  }

  // ── Schedules ───────────────────────────────────────
  async getSchedules(): Promise<Schedule[]> {
    const rows = await this.query("SELECT * FROM schedules ORDER BY time, id");
    return rows.map(rowToSchedule);
  }
  async getSchedulesByAgent(agentId: number): Promise<Schedule[]> {
    const rows = await this.query("SELECT * FROM schedules WHERE agent_id = ? ORDER BY time", [agentId]);
    return rows.map(rowToSchedule);
  }
  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const [result] = await this.pool.execute(
      "INSERT INTO schedules (name, description, cron_expression, time, days, agent_id, task_type, is_enabled, priority, on_failure, max_retries, timeout_minutes, notify_on_failure, notify_discord, notify_whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [schedule.name, schedule.description ?? null, schedule.cron_expression ?? "0 9 * * *", schedule.time ?? "09:00", JSON.stringify(schedule.days ?? []), schedule.agent_id ?? null, schedule.task_type ?? "general", schedule.is_enabled !== false ? 1 : 0, schedule.priority ?? "medium", schedule.on_failure ?? "notify_only", schedule.max_retries ?? 3, schedule.timeout_minutes ?? 60, schedule.notify_on_failure !== false ? 1 : 0, schedule.notify_discord ? 1 : 0, schedule.notify_whatsapp ? 1 : 0]
    );
    const insertId = (result as any).insertId;
    return (await this.getScheduleById(insertId))!;
  }
  private async getScheduleById(id: number): Promise<Schedule | undefined> {
    const rows = await this.query("SELECT * FROM schedules WHERE id = ?", [id]);
    return rows[0] ? rowToSchedule(rows[0]) : undefined;
  }
  async updateSchedule(id: number, updates: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
    if (updates.cron_expression !== undefined) { fields.push("cron_expression = ?"); values.push(updates.cron_expression); }
    if (updates.time !== undefined) { fields.push("time = ?"); values.push(updates.time); }
    if (updates.days !== undefined) { fields.push("days = ?"); values.push(JSON.stringify(updates.days)); }
    if (updates.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(updates.agent_id); }
    if (updates.task_type !== undefined) { fields.push("task_type = ?"); values.push(updates.task_type); }
    if (updates.is_enabled !== undefined) { fields.push("is_enabled = ?"); values.push(updates.is_enabled ? 1 : 0); }
    if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
    if (updates.on_failure !== undefined) { fields.push("on_failure = ?"); values.push(updates.on_failure); }
    if (updates.max_retries !== undefined) { fields.push("max_retries = ?"); values.push(updates.max_retries); }
    if (updates.timeout_minutes !== undefined) { fields.push("timeout_minutes = ?"); values.push(updates.timeout_minutes); }
    if (updates.notify_on_failure !== undefined) { fields.push("notify_on_failure = ?"); values.push(updates.notify_on_failure ? 1 : 0); }
    if (updates.notify_discord !== undefined) { fields.push("notify_discord = ?"); values.push(updates.notify_discord ? 1 : 0); }
    if (updates.notify_whatsapp !== undefined) { fields.push("notify_whatsapp = ?"); values.push(updates.notify_whatsapp ? 1 : 0); }
    if (fields.length === 0) return this.getScheduleById(id);
    fields.push("updated_at = NOW()");
    values.push(id);
    await this.query(`UPDATE schedules SET ${fields.join(", ")} WHERE id = ?`, values);
    return this.getScheduleById(id);
  }
  async deleteSchedule(id: number): Promise<boolean> {
    const [result] = await this.pool.execute("DELETE FROM schedules WHERE id = ?", [id]);
    return (result as any).affectedRows > 0;
  }
  async toggleSchedule(id: number): Promise<Schedule | undefined> {
    await this.query("UPDATE schedules SET is_enabled = NOT is_enabled, updated_at = NOW() WHERE id = ?", [id]);
    return this.getScheduleById(id);
  }
  async markScheduleRun(id: number): Promise<void> {
    await this.query(
      "UPDATE schedules SET last_run = NOW(), run_count = run_count + 1, updated_at = NOW() WHERE id = ?",
      [id]
    );
  }

  // ── Reports ─────────────────────────────────────────
  async getReports(filters?: { status?: string; type?: string; search?: string }): Promise<Report[]> {
    let sql = "SELECT * FROM reports WHERE 1=1";
    const params: any[] = [];
    if (filters?.status) { sql += " AND status = ?"; params.push(filters.status); }
    if (filters?.type) { sql += " AND type = ?"; params.push(filters.type); }
    if (filters?.search) { sql += " AND (title LIKE ? OR content LIKE ?)"; params.push(`%${filters.search}%`, `%${filters.search}%`); }
    sql += " ORDER BY created_at DESC";
    const rows = await this.query(sql, params);
    return rows.map(rowToReport);
  }
  async getReport(id: number): Promise<Report | undefined> {
    const rows = await this.query("SELECT * FROM reports WHERE id = ?", [id]);
    return rows[0] ? rowToReport(rows[0]) : undefined;
  }
  async getReportsByAgent(agentId: number): Promise<Report[]> {
    const rows = await this.query("SELECT * FROM reports WHERE agent_id = ? ORDER BY created_at DESC", [agentId]);
    return rows.map(rowToReport);
  }
  async createReport(report: InsertReport): Promise<Report> {
    const [result] = await this.pool.execute(
      "INSERT INTO reports (title, content, type, status, agent_id, tags) VALUES (?, ?, ?, ?, ?, ?)",
      [report.title, report.content ?? null, report.type ?? "general", report.status ?? "generating", report.agent_id ?? null, JSON.stringify(report.tags ?? [])]
    );
    const insertId = (result as any).insertId;
    return (await this.getReport(insertId))!;
  }
  async updateReport(id: number, updates: Partial<InsertReport>): Promise<Report | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.content !== undefined) { fields.push("content = ?"); values.push(updates.content); }
    if (updates.type !== undefined) { fields.push("type = ?"); values.push(updates.type); }
    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(updates.agent_id); }
    if (updates.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(updates.tags)); }
    if (fields.length === 0) return this.getReport(id);
    fields.push("updated_at = NOW()");
    values.push(id);
    await this.query(`UPDATE reports SET ${fields.join(", ")} WHERE id = ?`, values);
    return this.getReport(id);
  }

  // ── Activity ────────────────────────────────────────
  async getActivityLog(limit = 50, agentId?: number): Promise<ActivityLog[]> {
    let sql = "SELECT * FROM activity_log";
    const params: any[] = [];
    if (agentId) { sql += " WHERE agent_id = ?"; params.push(agentId); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const rows = await this.query(sql, params);
    return rows.map(rowToActivity);
  }
  async logActivity(eventType: string, description: string, agentId?: number | null, taskId?: number | null, metadata?: Record<string, any> | null): Promise<ActivityLog> {
    const [result] = await this.pool.execute(
      "INSERT INTO activity_log (event_type, description, agent_id, task_id, metadata) VALUES (?, ?, ?, ?, ?)",
      [eventType, description, agentId ?? null, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
    );
    const insertId = (result as any).insertId;
    const rows = await this.query("SELECT * FROM activity_log WHERE id = ?", [insertId]);
    return rowToActivity(rows[0]);
  }

  // ── Cost Analytics ──────────────────────────────────
  async getCostAnalytics(period = "all"): Promise<CostAnalytics> {
    const cutoff = periodCutoff(period);
    const where  = cutoff ? `WHERE entry_date >= '${cutoff}'` : "";

    const [totalsRows] = await this.pool.execute(
      `SELECT SUM(cost_usd) as total_cost, SUM(tokens_used) as total_tokens,
              COUNT(DISTINCT model_name) as active_models, COUNT(DISTINCT entry_date) as num_days
       FROM cost_entries ${where}`
    ) as any;
    const totals = totalsRows[0];
    const totalCost = parseFloat(totals.total_cost || "0");
    const totalTokens = parseInt(totals.total_tokens || "0");
    const activeModels = parseInt(totals.active_models || "0");
    const numDays = parseInt(totals.num_days || "1");
    const dailyAverage = numDays > 0 ? totalCost / numDays : 0;

    const dailyRows = await this.query(
      `SELECT entry_date, SUM(cost_usd) as cost FROM cost_entries ${where} GROUP BY entry_date ORDER BY entry_date`
    );
    const dailyTrend = dailyRows.map((r: any) => ({
      date: r.entry_date?.toISOString?.()?.split("T")[0] ?? String(r.entry_date),
      cost: parseFloat(parseFloat(r.cost).toFixed(4)),
    }));

    const agentRows = await this.query(
      `SELECT ce.agent_id, a.name as agent_name, SUM(ce.cost_usd) as cost, SUM(ce.tokens_used) as tokens,
              GROUP_CONCAT(DISTINCT ce.model_name ORDER BY ce.model_name SEPARATOR ',') as models
       FROM cost_entries ce JOIN agents a ON ce.agent_id = a.id ${where} GROUP BY ce.agent_id, a.name`
    );
    const perAgentCost = agentRows.map((r: any) => ({
      agent_name: r.agent_name,
      cost:   parseFloat(parseFloat(r.cost).toFixed(4)),
      tokens: parseInt(r.tokens || "0"),
      models: r.models ? String(r.models).split(",").filter(Boolean) : [],
    }));

    const modelRows = await this.query(
      `SELECT model_name, SUM(tokens_used) as tokens, SUM(cost_usd) as cost FROM cost_entries ${where} GROUP BY model_name`
    );
    const modelUsage = modelRows.map((r: any) => ({
      model: r.model_name,
      tokens: parseInt(r.tokens),
      cost: parseFloat(parseFloat(r.cost).toFixed(4)),
    }));

    return {
      totalCost: parseFloat(totalCost.toFixed(4)),
      dailyAverage: parseFloat(dailyAverage.toFixed(4)),
      totalTokens,
      activeModels,
      period,
      dailyTrend,
      perAgentCost,
      modelUsage,
    };
  }
  async getCostEntries(): Promise<CostEntry[]> {
    const rows = await this.query("SELECT * FROM cost_entries ORDER BY entry_date DESC, id DESC");
    return rows.map(rowToCostEntry);
  }
  async addCostEntry(entry: InsertCostEntry): Promise<CostEntry> {
    const [result] = await this.pool.execute(
      "INSERT INTO cost_entries (agent_id, model_name, tokens_used, cost_usd, entry_date) VALUES (?, ?, ?, ?, ?)",
      [entry.agent_id, entry.model_name, entry.tokens_used, entry.cost_usd, entry.entry_date]
    );
    const insertId = (result as any).insertId;
    const rows = await this.query("SELECT * FROM cost_entries WHERE id = ?", [insertId]);
    return rowToCostEntry(rows[0]);
  }

  // ── Stats ───────────────────────────────────────────
  async getStats(): Promise<DashboardStats> {
    const [taskRows] = await this.pool.execute("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status") as any;
    const tasksByStatus = { backlog: 0, doing: 0, done: 0 };
    let totalTasks = 0;
    for (const r of taskRows) {
      (tasksByStatus as any)[r.status] = parseInt(r.cnt);
      totalTasks += parseInt(r.cnt);
    }

    const today = new Date().toISOString().slice(0, 10);
    const [agentRows]  = await this.pool.execute("SELECT COUNT(*) as cnt FROM agents WHERE is_active = 1") as any;
    const [schedRows]  = await this.pool.execute("SELECT COUNT(*) as total, SUM(is_enabled) as enabled FROM schedules") as any;
    const [reportRows] = await this.pool.execute("SELECT COUNT(*) as cnt FROM reports") as any;
    const [actRows]    = await this.pool.execute("SELECT COUNT(*) as cnt FROM activity_log") as any;
    const [costRows]   = await this.pool.execute(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COALESCE(SUM(tokens_used),0) as tokens FROM cost_entries WHERE entry_date = ?",
      [today]
    ) as any;

    return {
      totalTasks,
      tasksByStatus,
      activeAgents:      parseInt(agentRows[0].cnt),
      totalSchedules:    parseInt(schedRows[0].total),
      enabledSchedules:  parseInt(schedRows[0].enabled || "0"),
      totalReports:      parseInt(reportRows[0].cnt),
      recentActivity:    parseInt(actRows[0].cnt),
      todayCost:         parseFloat(parseFloat(costRows[0].cost || "0").toFixed(4)),
      todayTokens:       parseInt(costRows[0].tokens || "0"),
      contextUsagePercent: 0,
    };
  }

  // ── Settings ────────────────────────────────────────
  async getSettings(): Promise<Setting[]> {
    const rows = await this.query("SELECT * FROM settings ORDER BY id");
    return rows.map(rowToSetting);
  }
  async updateSetting(key: string, value: any): Promise<Setting | undefined> {
    // Guard: MySQL2 rejects undefined bind parameters — coerce to null so
    // JSON.stringify produces "null" (a valid string) rather than undefined.
    const safeValue = value === undefined ? null : value;
    await this.query("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()", [key, JSON.stringify(safeValue), JSON.stringify(safeValue)]);
    const rows = await this.query("SELECT * FROM settings WHERE setting_key = ?", [key]);
    return rows[0] ? rowToSetting(rows[0]) : undefined;
  }

  // ── Integrations ────────────────────────────────────
  async getIntegrations(): Promise<Integration[]> {
    const rows = await this.query("SELECT * FROM integrations ORDER BY category, name");
    return rows.map(rowToIntegration);
  }
  async updateIntegration(id: number, updates: { config?: Record<string, any>; is_connected?: boolean }): Promise<Integration | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.config !== undefined) { fields.push("config = ?"); values.push(JSON.stringify(updates.config)); }
    if (updates.is_connected !== undefined) { fields.push("is_connected = ?"); values.push(updates.is_connected ? 1 : 0); }
    if (fields.length === 0) return undefined;
    fields.push("updated_at = NOW()");
    values.push(id);
    await this.query(`UPDATE integrations SET ${fields.join(", ")} WHERE id = ?`, values);
    const rows = await this.query("SELECT * FROM integrations WHERE id = ?", [id]);
    return rows[0] ? rowToIntegration(rows[0]) : undefined;
  }

  // ── Search ──────────────────────────────────────────
  async search(query: string): Promise<{ tasks: Task[]; reports: Report[]; schedules: Schedule[] }> {
    const q = `%${query}%`;
    const taskRows = await this.query("SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 20", [q, q]);
    const reportRows = await this.query("SELECT * FROM reports WHERE title LIKE ? OR content LIKE ? LIMIT 20", [q, q]);
    const scheduleRows = await this.query("SELECT * FROM schedules WHERE name LIKE ? OR description LIKE ? LIMIT 20", [q, q]);
    return {
      tasks: taskRows.map(rowToTask),
      reports: reportRows.map(rowToReport),
      schedules: scheduleRows.map(rowToSchedule),
    };
  }

  // ── Agent Memory ────────────────────────────────────
  async writeMemory(entry: InsertAgentMemory): Promise<AgentMemory> {
    const agentId = entry.agent_id ?? null;
    await this.pool.execute(
      `INSERT INTO agent_memory (agent_id, \`key\`, value, tags)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), tags = VALUES(tags), updated_at = NOW()`,
      [agentId, entry.key, entry.value, JSON.stringify(entry.tags ?? [])]
    );
    // Re-fetch: ON DUPLICATE UPDATE returns insertId=0, so search by key + agentId
    const agentFilter = agentId !== null ? "agent_id = ?" : "agent_id IS NULL";
    const params: any[] = [entry.key];
    if (agentId !== null) params.push(agentId);
    const rows = await this.query(
      `SELECT * FROM agent_memory WHERE \`key\` = ? AND ${agentFilter} ORDER BY updated_at DESC LIMIT 1`,
      params
    );
    return rowToMemory(rows[0]);
  }

  async searchMemory(query: string, agentId?: number): Promise<AgentMemory[]> {
    const agentFilter = agentId !== undefined ? " AND agent_id = ?" : "";
    try {
      // Use FULLTEXT search when available
      const ftParams: any[] = [query, query];
      if (agentId !== undefined) ftParams.push(agentId);
      const ftRows = await this.query(
        `SELECT *, MATCH(\`key\`, value) AGAINST (? IN NATURAL LANGUAGE MODE) as score
         FROM agent_memory
         WHERE MATCH(\`key\`, value) AGAINST (? IN NATURAL LANGUAGE MODE)${agentFilter}
         ORDER BY score DESC LIMIT 20`,
        ftParams
      );
      if (ftRows.length > 0) return ftRows.map(rowToMemory);
    } catch { /* FULLTEXT not yet available — fall through to LIKE */ }
    // LIKE fallback
    const q = `%${query}%`;
    const likeParams: any[] = [q, q, q];
    if (agentId !== undefined) likeParams.push(agentId);
    const rows = await this.query(
      `SELECT * FROM agent_memory WHERE (\`key\` LIKE ? OR value LIKE ? OR JSON_SEARCH(tags, 'one', ?) IS NOT NULL)${agentFilter} LIMIT 20`,
      likeParams
    );
    return rows.map(rowToMemory);
  }

  async getMemoryByKey(key: string, agentId?: number): Promise<AgentMemory | undefined> {
    const agentFilter = agentId !== undefined ? " AND agent_id = ?" : "";
    const params: any[] = [key];
    if (agentId !== undefined) params.push(agentId);
    const rows = await this.query(
      `SELECT * FROM agent_memory WHERE \`key\` = ?${agentFilter} ORDER BY updated_at DESC LIMIT 1`,
      params
    );
    return rows[0] ? rowToMemory(rows[0]) : undefined;
  }



  // ── Approval Queue ────────────────────────────────────

  async getApprovals(status?: string): Promise<Approval[]> {
    let sql = "SELECT * FROM approval_queue";
    const params: any[] = [];
    if (status) { sql += " WHERE status = ?"; params.push(status); }
    sql += " ORDER BY created_at DESC";
    const rows = await this.query(sql, params);
    return rows.map((r: any) => ({
      ...r,
      payload: parseJson(r.payload),
      decided_at: r.decided_at ? (r.decided_at?.toISOString?.() || String(r.decided_at)) : null,
      expires_at: r.expires_at ? (r.expires_at?.toISOString?.() || String(r.expires_at)) : null,
      created_at: r.created_at?.toISOString?.() || String(r.created_at),
    }));
  }

  async getApproval(id: number): Promise<Approval | undefined> {
    const rows = await this.query("SELECT * FROM approval_queue WHERE id = ?", [id]);
    if (!rows[0]) return undefined;
    const r = rows[0];
    return { ...r, payload: parseJson(r.payload), decided_at: r.decided_at ? (r.decided_at?.toISOString?.() || String(r.decided_at)) : null, expires_at: r.expires_at ? (r.expires_at?.toISOString?.() || String(r.expires_at)) : null, created_at: r.created_at?.toISOString?.() || String(r.created_at) };
  }

  async createApproval(data: InsertApproval): Promise<Approval> {
    const [result] = await this.pool.execute(
      "INSERT INTO approval_queue (agent_id, action_type, title, description, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      [data.agent_id ?? null, data.action_type, data.title, data.description || null, data.payload ? JSON.stringify(data.payload) : null, data.expires_at || null]
    ) as any;
    return (await this.getApproval(result.insertId))!;
  }

  async decideApproval(id: number, decision: "approved" | "rejected", decidedBy: string): Promise<Approval | undefined> {
    await this.pool.execute(
      "UPDATE approval_queue SET status = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'",
      [decision, decidedBy, id]
    );
    return this.getApproval(id);
  }

  async getPendingApprovalCount(): Promise<number> {
    const rows = await this.query("SELECT COUNT(*) as cnt FROM approval_queue WHERE status = 'pending'");
    return parseInt(rows[0]?.cnt || "0");
  }
}

// ── Export ───────────────────────────────────────────────
// Priority: MariaDB (production) → SQLite (zero-config persistent) → MemStorage (sandbox)
function createStorage(): IStorage {
  if (process.env.DB_NAME && process.env.DB_USER) {
    console.log("Using MariaDB storage");
    return new MariaDBStorage();
  }
  if (process.env.DB_ENGINE === "memory") {
    console.log("Using in-memory storage (DB_ENGINE=memory)");
    return new MemStorage();
  }
  // Default: SQLite — zero-config, persistent, no external DB needed
  try {
    const { SQLiteStorage } = require("./sqlite-storage");
    const dbPath = process.env.SQLITE_PATH || undefined;
    console.log("Using SQLite storage (.data/mc.sqlite)");
    return new SQLiteStorage(dbPath);
  } catch (err: any) {
    console.warn("SQLite unavailable (better-sqlite3 not installed?), falling back to in-memory storage:", err.message);
    return new MemStorage();
  }
}

export const storage = createStorage();
