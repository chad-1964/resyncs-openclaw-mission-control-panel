import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
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
import type { IStorage, AgentMemory, InsertAgentMemory } from "./storage";

// ── Helpers ────────────────────────────────────────────────
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
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToTask(row: any): Task {
  return {
    ...row,
    notify_discord: !!row.notify_discord,
    notify_whatsapp: !!row.notify_whatsapp,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
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
    last_run: row.last_run ?? null,
    run_count: parseInt(row.run_count ?? "0"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToReport(row: any): Report {
  return {
    ...row,
    tags: parseJson(row.tags, []),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToActivity(row: any): ActivityLog {
  return {
    ...row,
    metadata: parseJson(row.metadata, null),
    created_at: String(row.created_at),
  };
}

function rowToCostEntry(row: any): CostEntry {
  return {
    ...row,
    cost_usd: parseFloat(row.cost_usd),
    entry_date: String(row.entry_date),
    created_at: String(row.created_at),
  };
}

function rowToSetting(row: any): Setting {
  return {
    ...row,
    setting_value: parseJson(row.setting_value, null),
    updated_at: String(row.updated_at),
  };
}

function rowToIntegration(row: any): Integration {
  return {
    ...row,
    config: parseJson(row.config, {}),
    is_connected: !!row.is_connected,
    updated_at: String(row.updated_at),
  };
}

function rowToMemory(row: any): AgentMemory {
  return {
    id: row.id,
    agent_id: row.agent_id ?? null,
    key: row.key,
    value: row.value,
    tags: parseJson(row.tags, []),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToApproval(row: any): Approval {
  return {
    ...row,
    payload: parseJson(row.payload),
    decided_at: row.decided_at ?? null,
    expires_at: row.expires_at ?? null,
    created_at: String(row.created_at),
  };
}

/** Returns a YYYY-MM-DD cutoff date string for the given period, or null for "all". */
function periodCutoff(period: string): string | null {
  const d = new Date();
  if (period === "today") return d.toISOString().slice(0, 10);
  if (period === "week")  { d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); }
  if (period === "month") { d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); }
  return null;
}

// ── SQLite Storage ─────────────────────────────────────────
export class SQLiteStorage implements IStorage {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), ".data", "mc.sqlite");
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runMigration();
  }

  // ── Migration ──────────────────────────────────────────
  private runMigration() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        avatar_color TEXT NOT NULL DEFAULT '#0d9488',
        status TEXT CHECK(status IN ('idle','working','error','offline')) NOT NULL DEFAULT 'idle',
        current_task_summary TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        agent_type TEXT CHECK(agent_type IN ('permanent','dynamic')) NOT NULL DEFAULT 'permanent',
        openclaw_id TEXT,
        soul TEXT,
        skills TEXT,
        model_config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT CHECK(status IN ('backlog','doing','done')) NOT NULL DEFAULT 'backlog',
        priority TEXT CHECK(priority IN ('low','medium','high','critical')) NOT NULL DEFAULT 'medium',
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        notify_discord INTEGER NOT NULL DEFAULT 0,
        notify_whatsapp INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        cron_expression TEXT NOT NULL DEFAULT '0 9 * * *',
        time TEXT NOT NULL DEFAULT '09:00',
        days TEXT,
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        task_type TEXT CHECK(task_type IN ('general','research','monitoring','reporting','outreach','data_processing')) NOT NULL DEFAULT 'general',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        priority TEXT CHECK(priority IN ('low','medium','high','critical')) NOT NULL DEFAULT 'medium',
        on_failure TEXT CHECK(on_failure IN ('notify_only','auto_retry','skip_continue','escalate')) NOT NULL DEFAULT 'notify_only',
        max_retries INTEGER NOT NULL DEFAULT 3,
        timeout_minutes INTEGER NOT NULL DEFAULT 60,
        notify_on_failure INTEGER NOT NULL DEFAULT 1,
        notify_discord INTEGER NOT NULL DEFAULT 0,
        notify_whatsapp INTEGER NOT NULL DEFAULT 0,
        last_run TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        type TEXT NOT NULL DEFAULT 'general',
        status TEXT CHECK(status IN ('generating','complete','error')) NOT NULL DEFAULT 'generating',
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cost_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        model_name TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT NOT NULL UNIQUE,
        setting_value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT CHECK(category IN ('email','social','website_seo','data_storage')) NOT NULL,
        name TEXT NOT NULL UNIQUE,
        config TEXT,
        is_connected INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(agent_id, key)
      );

      CREATE TABLE IF NOT EXISTS approval_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
        action_type TEXT CHECK(action_type IN ('file_delete','external_api','agent_create','schedule_modify','cost_exceed','custom')) NOT NULL DEFAULT 'custom',
        title TEXT NOT NULL,
        description TEXT,
        payload TEXT,
        status TEXT CHECK(status IN ('pending','approved','rejected','expired')) NOT NULL DEFAULT 'pending',
        decided_by TEXT,
        decided_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id INTEGER,
        channel TEXT NOT NULL DEFAULT 'direct',
        sender_id TEXT,
        sender_name TEXT,
        direction TEXT CHECK(direction IN ('inbound','outbound')) NOT NULL DEFAULT 'outbound',
        message_preview TEXT,
        model_name TEXT,
        provider TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_type TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS channel_daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stat_date TEXT NOT NULL,
        channel TEXT NOT NULL,
        agent_id INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        avg_duration_ms INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(stat_date, channel, agent_id)
      );
    `);

    // Create indexes (CREATE INDEX IF NOT EXISTS is safe to re-run)
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)",
      "CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(is_active)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_schedules_agent ON schedules(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(is_enabled)",
      "CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)",
      "CREATE INDEX IF NOT EXISTS idx_reports_agent ON reports(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at)",
      "CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_entries(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_entries(entry_date)",
      "CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_aq_status ON approval_queue(status)",
      "CREATE INDEX IF NOT EXISTS idx_ct_session ON conversation_turns(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_ct_channel ON conversation_turns(channel)",
      "CREATE INDEX IF NOT EXISTS idx_ct_created ON conversation_turns(created_at)",
      "CREATE INDEX IF NOT EXISTS idx_cds_date ON channel_daily_stats(stat_date)",
    ];
    for (const sql of indexes) this.db.exec(sql);
  }

  // ── Raw query (used by telemetry collector and analytics) ──
  async query(sql: string, params?: any[]): Promise<any> {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
      return this.db.prepare(sql).all(...(params ?? []));
    }
    // For INSERT/UPDATE/DELETE return info object
    const info = this.db.prepare(sql).run(...(params ?? []));
    return [{ insertId: info.lastInsertRowid, affectedRows: info.changes }];
  }

  // ── Agents ──────────────────────────────────────────────
  async getAgents(): Promise<Agent[]> {
    return this.db.prepare("SELECT * FROM agents ORDER BY id").all().map(rowToAgent);
  }

  async getAgent(id: number): Promise<Agent | undefined> {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
    return row ? rowToAgent(row) : undefined;
  }

  async getAgentByOpenclawId(openclawId: string): Promise<Agent | undefined> {
    const row = this.db.prepare("SELECT * FROM agents WHERE openclaw_id = ? LIMIT 1").get(openclawId);
    return row ? rowToAgent(row) : undefined;
  }

  async createAgent(data: InsertAgent): Promise<Agent> {
    const stmt = this.db.prepare(
      `INSERT INTO agents (name, role, avatar_color, agent_type, openclaw_id, soul, skills, model_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.name,
      data.role,
      data.avatar_color ?? "#0d9488",
      data.agent_type ?? "permanent",
      data.openclaw_id ?? null,
      data.soul ?? null,
      data.skills?.length ? JSON.stringify(data.skills) : null,
      data.model_config ? JSON.stringify(data.model_config) : null,
    );
    return (await this.getAgent(Number(info.lastInsertRowid)))!;
  }

  async promoteAgent(id: number): Promise<Agent | undefined> {
    this.db.prepare("UPDATE agents SET agent_type = 'permanent', updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getAgent(id);
  }

  async updateAgentStatus(id: number, status: string, taskSummary?: string | null): Promise<Agent | undefined> {
    if (taskSummary !== undefined) {
      this.db.prepare("UPDATE agents SET status = ?, current_task_summary = ?, updated_at = datetime('now') WHERE id = ?").run(status, taskSummary, id);
    } else {
      this.db.prepare("UPDATE agents SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
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
    sets.push("updated_at = datetime('now')");
    params.push(id);
    this.db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.getAgent(id);
  }

  // ── Tasks ───────────────────────────────────────────────
  async getTasks(status?: string): Promise<Task[]> {
    if (status) {
      return this.db.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY position, id").all(status).map(rowToTask);
    }
    return this.db.prepare("SELECT * FROM tasks ORDER BY position, id").all().map(rowToTask);
  }

  async getTaskById(id: number): Promise<Task | undefined> {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? rowToTask(row) : undefined;
  }

  async getTasksByStatus(status: string): Promise<Task[]> { return this.getTasks(status); }

  async getTasksByAgent(agentId: number): Promise<Task[]> {
    return this.db.prepare("SELECT * FROM tasks WHERE agent_id = ? ORDER BY position").all(agentId).map(rowToTask);
  }

  async createTask(task: InsertTask): Promise<Task> {
    const info = this.db.prepare(
      "INSERT INTO tasks (title, description, status, priority, agent_id, notify_discord, notify_whatsapp, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      task.title, task.description ?? null, task.status ?? "backlog", task.priority ?? "medium",
      task.agent_id ?? null, task.notify_discord ? 1 : 0, task.notify_whatsapp ? 1 : 0, task.position ?? 0
    );
    return (await this.getTaskById(Number(info.lastInsertRowid)))!;
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
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getTaskById(id);
  }

  async deleteTask(id: number): Promise<boolean> {
    const info = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return info.changes > 0;
  }

  async moveTask(id: number, status: string, position: number): Promise<Task | undefined> {
    this.db.prepare("UPDATE tasks SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?").run(status, position, id);
    return this.getTaskById(id);
  }

  // ── Schedules ───────────────────────────────────────────
  async getSchedules(): Promise<Schedule[]> {
    return this.db.prepare("SELECT * FROM schedules ORDER BY time, id").all().map(rowToSchedule);
  }

  async getSchedulesByAgent(agentId: number): Promise<Schedule[]> {
    return this.db.prepare("SELECT * FROM schedules WHERE agent_id = ? ORDER BY time").all(agentId).map(rowToSchedule);
  }

  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const info = this.db.prepare(
      "INSERT INTO schedules (name, description, cron_expression, time, days, agent_id, task_type, is_enabled, priority, on_failure, max_retries, timeout_minutes, notify_on_failure, notify_discord, notify_whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      schedule.name, schedule.description ?? null, schedule.cron_expression ?? "0 9 * * *",
      schedule.time ?? "09:00", JSON.stringify(schedule.days ?? []), schedule.agent_id ?? null,
      schedule.task_type ?? "general", schedule.is_enabled !== false ? 1 : 0, schedule.priority ?? "medium",
      schedule.on_failure ?? "notify_only", schedule.max_retries ?? 3, schedule.timeout_minutes ?? 60,
      schedule.notify_on_failure !== false ? 1 : 0, schedule.notify_discord ? 1 : 0, schedule.notify_whatsapp ? 1 : 0
    );
    return (await this.getScheduleById(Number(info.lastInsertRowid)))!;
  }

  private async getScheduleById(id: number): Promise<Schedule | undefined> {
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
    return row ? rowToSchedule(row) : undefined;
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
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE schedules SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getScheduleById(id);
  }

  async deleteSchedule(id: number): Promise<boolean> {
    return this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id).changes > 0;
  }

  async toggleSchedule(id: number): Promise<Schedule | undefined> {
    this.db.prepare("UPDATE schedules SET is_enabled = CASE WHEN is_enabled THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getScheduleById(id);
  }

  async markScheduleRun(id: number): Promise<void> {
    this.db.prepare("UPDATE schedules SET last_run = datetime('now'), run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  }

  // ── Reports ─────────────────────────────────────────────
  async getReports(filters?: { status?: string; type?: string; search?: string }): Promise<Report[]> {
    let sql = "SELECT * FROM reports WHERE 1=1";
    const params: any[] = [];
    if (filters?.status) { sql += " AND status = ?"; params.push(filters.status); }
    if (filters?.type) { sql += " AND type = ?"; params.push(filters.type); }
    if (filters?.search) { sql += " AND (title LIKE ? OR content LIKE ?)"; params.push(`%${filters.search}%`, `%${filters.search}%`); }
    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params).map(rowToReport);
  }

  async getReport(id: number): Promise<Report | undefined> {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    return row ? rowToReport(row) : undefined;
  }

  async getReportsByAgent(agentId: number): Promise<Report[]> {
    return this.db.prepare("SELECT * FROM reports WHERE agent_id = ? ORDER BY created_at DESC").all(agentId).map(rowToReport);
  }

  async createReport(report: InsertReport): Promise<Report> {
    const info = this.db.prepare(
      "INSERT INTO reports (title, content, type, status, agent_id, tags) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      report.title, report.content ?? null, report.type ?? "general",
      report.status ?? "generating", report.agent_id ?? null, JSON.stringify(report.tags ?? [])
    );
    return (await this.getReport(Number(info.lastInsertRowid)))!;
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
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE reports SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getReport(id);
  }

  // ── Activity ────────────────────────────────────────────
  async getActivityLog(limit = 50, agentId?: number): Promise<ActivityLog[]> {
    let sql = "SELECT * FROM activity_log";
    const params: any[] = [];
    if (agentId) { sql += " WHERE agent_id = ?"; params.push(agentId); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    return this.db.prepare(sql).all(...params).map(rowToActivity);
  }

  async logActivity(eventType: string, description: string, agentId?: number | null, taskId?: number | null, metadata?: Record<string, any> | null): Promise<ActivityLog> {
    const info = this.db.prepare(
      "INSERT INTO activity_log (event_type, description, agent_id, task_id, metadata) VALUES (?, ?, ?, ?, ?)"
    ).run(eventType, description, agentId ?? null, taskId ?? null, metadata ? JSON.stringify(metadata) : null);
    const row = this.db.prepare("SELECT * FROM activity_log WHERE id = ?").get(Number(info.lastInsertRowid));
    return rowToActivity(row);
  }

  // ── Cost Analytics ──────────────────────────────────────
  async getCostAnalytics(period = "all"): Promise<CostAnalytics> {
    const cutoff = periodCutoff(period);
    const where = cutoff ? "WHERE entry_date >= ?" : "";
    const wp = cutoff ? [cutoff] : [];

    const totals: any = this.db.prepare(
      `SELECT COALESCE(SUM(cost_usd),0) as total_cost, COALESCE(SUM(tokens_used),0) as total_tokens,
              COUNT(DISTINCT model_name) as active_models, COUNT(DISTINCT entry_date) as num_days
       FROM cost_entries ${where}`
    ).get(...wp);
    const totalCost = parseFloat(totals.total_cost || 0);
    const totalTokens = parseInt(totals.total_tokens || 0);
    const activeModels = parseInt(totals.active_models || 0);
    const numDays = parseInt(totals.num_days || 1);
    const dailyAverage = numDays > 0 ? totalCost / numDays : 0;

    const dailyRows: any[] = this.db.prepare(
      `SELECT entry_date, SUM(cost_usd) as cost FROM cost_entries ${where} GROUP BY entry_date ORDER BY entry_date`
    ).all(...wp);
    const dailyTrend = dailyRows.map(r => ({ date: String(r.entry_date), cost: parseFloat(parseFloat(r.cost).toFixed(4)) }));

    const agentRows: any[] = this.db.prepare(
      `SELECT ce.agent_id, a.name as agent_name, SUM(ce.cost_usd) as cost, SUM(ce.tokens_used) as tokens,
              GROUP_CONCAT(DISTINCT ce.model_name) as models
       FROM cost_entries ce JOIN agents a ON ce.agent_id = a.id ${where ? where.replace("entry_date", "ce.entry_date") : ""}
       GROUP BY ce.agent_id, a.name`
    ).all(...wp);
    const perAgentCost = agentRows.map(r => ({
      agent_name: r.agent_name,
      cost: parseFloat(parseFloat(r.cost).toFixed(4)),
      tokens: parseInt(r.tokens || 0),
      models: r.models ? String(r.models).split(",").filter(Boolean) : [],
    }));

    const modelRows: any[] = this.db.prepare(
      `SELECT model_name, SUM(tokens_used) as tokens, SUM(cost_usd) as cost FROM cost_entries ${where} GROUP BY model_name`
    ).all(...wp);
    const modelUsage = modelRows.map(r => ({
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
    return this.db.prepare("SELECT * FROM cost_entries ORDER BY entry_date DESC, id DESC").all().map(rowToCostEntry);
  }

  async addCostEntry(entry: InsertCostEntry): Promise<CostEntry> {
    const info = this.db.prepare(
      "INSERT INTO cost_entries (agent_id, model_name, tokens_used, cost_usd, entry_date) VALUES (?, ?, ?, ?, ?)"
    ).run(entry.agent_id, entry.model_name, entry.tokens_used, entry.cost_usd, entry.entry_date);
    const row = this.db.prepare("SELECT * FROM cost_entries WHERE id = ?").get(Number(info.lastInsertRowid));
    return rowToCostEntry(row);
  }

  // ── Stats ───────────────────────────────────────────────
  async getStats(): Promise<DashboardStats> {
    const taskRows: any[] = this.db.prepare("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status").all();
    const tasksByStatus = { backlog: 0, doing: 0, done: 0 };
    let totalTasks = 0;
    for (const r of taskRows) {
      (tasksByStatus as any)[r.status] = parseInt(r.cnt);
      totalTasks += parseInt(r.cnt);
    }

    const today = new Date().toISOString().slice(0, 10);
    const agentRow: any = this.db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE is_active = 1").get();
    const schedRow: any = this.db.prepare("SELECT COUNT(*) as total, COALESCE(SUM(is_enabled),0) as enabled FROM schedules").get();
    const reportRow: any = this.db.prepare("SELECT COUNT(*) as cnt FROM reports").get();
    const actRow: any = this.db.prepare("SELECT COUNT(*) as cnt FROM activity_log").get();
    const costRow: any = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COALESCE(SUM(tokens_used),0) as tokens FROM cost_entries WHERE entry_date = ?"
    ).get(today);

    return {
      totalTasks,
      tasksByStatus,
      activeAgents: parseInt(agentRow.cnt),
      totalSchedules: parseInt(schedRow.total),
      enabledSchedules: parseInt(schedRow.enabled || "0"),
      totalReports: parseInt(reportRow.cnt),
      recentActivity: parseInt(actRow.cnt),
      todayCost: parseFloat(parseFloat(costRow.cost || "0").toFixed(4)),
      todayTokens: parseInt(costRow.tokens || "0"),
    };
  }

  // ── Settings ────────────────────────────────────────────
  async getSettings(): Promise<Setting[]> {
    return this.db.prepare("SELECT * FROM settings ORDER BY id").all().map(rowToSetting);
  }

  async updateSetting(key: string, value: any): Promise<Setting | undefined> {
    const safeValue = value === undefined ? null : value;
    this.db.prepare(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`
    ).run(key, JSON.stringify(safeValue));
    const row = this.db.prepare("SELECT * FROM settings WHERE setting_key = ?").get(key);
    return row ? rowToSetting(row) : undefined;
  }

  // ── Integrations ────────────────────────────────────────
  async getIntegrations(): Promise<Integration[]> {
    return this.db.prepare("SELECT * FROM integrations ORDER BY category, name").all().map(rowToIntegration);
  }

  async updateIntegration(id: number, updates: { config?: Record<string, any>; is_connected?: boolean }): Promise<Integration | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.config !== undefined) { fields.push("config = ?"); values.push(JSON.stringify(updates.config)); }
    if (updates.is_connected !== undefined) { fields.push("is_connected = ?"); values.push(updates.is_connected ? 1 : 0); }
    if (fields.length === 0) return undefined;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE integrations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    const row = this.db.prepare("SELECT * FROM integrations WHERE id = ?").get(id);
    return row ? rowToIntegration(row) : undefined;
  }

  // ── Search ──────────────────────────────────────────────
  async search(query: string): Promise<{ tasks: Task[]; reports: Report[]; schedules: Schedule[] }> {
    const q = `%${query}%`;
    const taskRows = this.db.prepare("SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 20").all(q, q);
    const reportRows = this.db.prepare("SELECT * FROM reports WHERE title LIKE ? OR content LIKE ? LIMIT 20").all(q, q);
    const scheduleRows = this.db.prepare("SELECT * FROM schedules WHERE name LIKE ? OR description LIKE ? LIMIT 20").all(q, q);
    return {
      tasks: taskRows.map(rowToTask),
      reports: reportRows.map(rowToReport),
      schedules: scheduleRows.map(rowToSchedule),
    };
  }

  // ── Agent Memory ────────────────────────────────────────
  async writeMemory(entry: InsertAgentMemory): Promise<AgentMemory> {
    const agentId = entry.agent_id ?? null;
    this.db.prepare(
      `INSERT INTO agent_memory (agent_id, key, value, tags)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, tags = excluded.tags, updated_at = datetime('now')`
    ).run(agentId, entry.key, entry.value, JSON.stringify(entry.tags ?? []));
    // Re-fetch
    const agentFilter = agentId !== null ? "agent_id = ?" : "agent_id IS NULL";
    const params: any[] = [entry.key];
    if (agentId !== null) params.push(agentId);
    const row = this.db.prepare(
      `SELECT * FROM agent_memory WHERE key = ? AND ${agentFilter} ORDER BY updated_at DESC LIMIT 1`
    ).get(...params);
    return rowToMemory(row);
  }

  async searchMemory(query: string, agentId?: number): Promise<AgentMemory[]> {
    const q = `%${query}%`;
    const agentFilter = agentId !== undefined ? " AND agent_id = ?" : "";
    const params: any[] = [q, q, q];
    if (agentId !== undefined) params.push(agentId);
    const rows = this.db.prepare(
      `SELECT * FROM agent_memory WHERE (key LIKE ? OR value LIKE ? OR tags LIKE ?)${agentFilter} LIMIT 20`
    ).all(...params);
    return rows.map(rowToMemory);
  }

  async getMemoryByKey(key: string, agentId?: number): Promise<AgentMemory | undefined> {
    const agentFilter = agentId !== undefined ? " AND agent_id = ?" : "";
    const params: any[] = [key];
    if (agentId !== undefined) params.push(agentId);
    const row = this.db.prepare(
      `SELECT * FROM agent_memory WHERE key = ?${agentFilter} ORDER BY updated_at DESC LIMIT 1`
    ).get(...params);
    return row ? rowToMemory(row) : undefined;
  }

  // ── Approval Queue ──────────────────────────────────────
  async getApprovals(status?: string): Promise<Approval[]> {
    let sql = "SELECT * FROM approval_queue";
    const params: any[] = [];
    if (status) { sql += " WHERE status = ?"; params.push(status); }
    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params).map(rowToApproval);
  }

  async getApproval(id: number): Promise<Approval | undefined> {
    const row = this.db.prepare("SELECT * FROM approval_queue WHERE id = ?").get(id);
    return row ? rowToApproval(row) : undefined;
  }

  async createApproval(data: InsertApproval): Promise<Approval> {
    const info = this.db.prepare(
      "INSERT INTO approval_queue (agent_id, action_type, title, description, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      data.agent_id ?? null, data.action_type, data.title,
      data.description || null, data.payload ? JSON.stringify(data.payload) : null, data.expires_at || null
    );
    return (await this.getApproval(Number(info.lastInsertRowid)))!;
  }

  async decideApproval(id: number, decision: "approved" | "rejected", decidedBy: string): Promise<Approval | undefined> {
    this.db.prepare(
      "UPDATE approval_queue SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(decision, decidedBy, id);
    return this.getApproval(id);
  }

  async getPendingApprovalCount(): Promise<number> {
    const row: any = this.db.prepare("SELECT COUNT(*) as cnt FROM approval_queue WHERE status = 'pending'").get();
    return parseInt(row.cnt || "0");
  }
}
