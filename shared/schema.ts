import { z } from "zod";

// ── Agents ──────────────────────────────────────────────
export const agentStatusEnum = z.enum(["idle", "working", "error", "offline"]);
export type AgentStatus = z.infer<typeof agentStatusEnum>;

export const agentTypeEnum = z.enum(["permanent", "ephemeral"]);
export type AgentType = z.infer<typeof agentTypeEnum>;

export const agentSchema = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  avatar_color: z.string(),
  status: agentStatusEnum,
  current_task_summary: z.string().nullable(),
  is_active: z.boolean(),
  // agent_type: permanent = roster agent; ephemeral = CEO-spawned for a specific task
  agent_type: agentTypeEnum.optional().default("permanent"),
  // openclaw_id: string ID used by OpenClaw CLI (e.g. "ceo", "lisa", "jordan")
  // maps this DB record to the agent OpenClaw calls via --agent {openclaw_id}
  openclaw_id: z.string().nullable().optional(),
  // soul: agent personality/instructions stored in DB — never in flat files
  soul: z.string().nullable().optional(),
  // skills: capability tags shown in UI and referenced in soul prompts
  skills: z.array(z.string()).nullable().optional(),
  // model_config: per-agent AI provider + model + future voice_config sub-object
  model_config: z.record(z.any()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Agent = z.infer<typeof agentSchema>;

export const insertAgentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().min(1, "Role is required"),
  avatar_color: z.string().optional().default("#0d9488"),
  agent_type: agentTypeEnum.optional().default("permanent"),
  openclaw_id: z.string().nullable().optional(),
  soul: z.string().nullable().optional(),
  skills: z.array(z.string()).optional().default([]),
  model_config: z.record(z.any()).nullable().optional(),
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;

// ── Tasks ───────────────────────────────────────────────
export const taskStatusEnum = z.enum(["backlog", "doing", "done"]);
export const taskPriorityEnum = z.enum(["low", "medium", "high", "critical"]);

export const taskSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusEnum,
  priority: taskPriorityEnum,
  agent_id: z.number().nullable(),
  notify_discord: z.boolean(),
  notify_whatsapp: z.boolean(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const insertTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  status: taskStatusEnum.optional().default("backlog"),
  priority: taskPriorityEnum.optional().default("medium"),
  agent_id: z.number().nullable().optional(),
  notify_discord: z.boolean().optional().default(false),
  notify_whatsapp: z.boolean().optional().default(false),
  position: z.number().optional(),
});
export type InsertTask = z.infer<typeof insertTaskSchema>;

// ── Schedules ───────────────────────────────────────────
export const taskTypeEnum = z.enum(["general", "research", "monitoring", "reporting", "outreach", "data_processing"]);
export const onFailureEnum = z.enum(["notify_only", "auto_retry", "skip_continue", "escalate"]);

export const scheduleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  cron_expression: z.string(),
  time: z.string(),
  days: z.array(z.string()),
  agent_id: z.number().nullable(),
  task_type: taskTypeEnum,
  is_enabled: z.boolean(),
  priority: taskPriorityEnum,
  on_failure: onFailureEnum,
  max_retries: z.number(),
  timeout_minutes: z.number(),
  notify_on_failure: z.boolean(),
  notify_discord: z.boolean(),
  notify_whatsapp: z.boolean(),
  last_run: z.string().nullable(),
  run_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const insertScheduleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  cron_expression: z.string().optional().default("0 9 * * *"),
  time: z.string().optional().default("09:00"),
  days: z.array(z.string()).optional().default(["Mon", "Tue", "Wed", "Thu", "Fri"]),
  agent_id: z.number().nullable().optional(),
  task_type: taskTypeEnum.optional().default("general"),
  is_enabled: z.boolean().optional().default(true),
  priority: taskPriorityEnum.optional().default("medium"),
  on_failure: onFailureEnum.optional().default("notify_only"),
  max_retries: z.number().min(0).max(10).optional().default(3),
  timeout_minutes: z.number().min(1).max(1440).optional().default(60),
  notify_on_failure: z.boolean().optional().default(true),
  notify_discord: z.boolean().optional().default(false),
  notify_whatsapp: z.boolean().optional().default(false),
});
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;

// ── Reports ─────────────────────────────────────────────
export const reportStatusEnum = z.enum(["generating", "complete", "error"]);

export const reportSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string().nullable(),
  type: z.string(),
  status: reportStatusEnum,
  agent_id: z.number().nullable(),
  project_id: z.number().nullable().optional(),
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Report = z.infer<typeof reportSchema>;

export const insertReportSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().nullable().optional(),
  type: z.string().optional().default("general"),
  status: reportStatusEnum.optional().default("generating"),
  agent_id: z.number().nullable().optional(),
  project_id: z.number().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
});
export type InsertReport = z.infer<typeof insertReportSchema>;

// ── Activity Log ────────────────────────────────────────
export const eventTypeEnum = z.enum([
  "task_created", "task_moved", "task_completed", "task_deleted",
  "schedule_created", "schedule_updated", "schedule_fired",
  "report_generated", "agent_status_change", "agent_created",
]);

export const activityLogSchema = z.object({
  id: z.number(),
  event_type: eventTypeEnum,
  description: z.string(),
  agent_id: z.number().nullable(),
  task_id: z.number().nullable(),
  metadata: z.record(z.any()).nullable(),
  created_at: z.string(),
});
export type ActivityLog = z.infer<typeof activityLogSchema>;

// ── Cost Entries ────────────────────────────────────────
export const costEntrySchema = z.object({
  id: z.number(),
  agent_id: z.number(),
  model_name: z.string(),
  tokens_used: z.number(),
  cost_usd: z.number(),
  entry_date: z.string(),
  created_at: z.string(),
});
export type CostEntry = z.infer<typeof costEntrySchema>;

export const insertCostEntrySchema = z.object({
  agent_id: z.number(),
  model_name: z.string(),
  tokens_used: z.number(),
  cost_usd: z.number(),
  entry_date: z.string(),
});
export type InsertCostEntry = z.infer<typeof insertCostEntrySchema>;

// ── Settings ────────────────────────────────────────────
export const settingSchema = z.object({
  id: z.number(),
  setting_key: z.string(),
  setting_value: z.any(),
  updated_at: z.string(),
});
export type Setting = z.infer<typeof settingSchema>;

// ── Integrations ────────────────────────────────────────
export const integrationCategoryEnum = z.enum(["email", "social", "website_seo", "data_storage"]);

export const integrationSchema = z.object({
  id: z.number(),
  category: integrationCategoryEnum,
  name: z.string(),
  config: z.record(z.any()),
  is_connected: z.boolean(),
  updated_at: z.string(),
});
export type Integration = z.infer<typeof integrationSchema>;

// ── Conversation Turns ─────────────────────────────────
export const conversationTurnSchema = z.object({
  id: z.number(),
  session_id: z.string(),
  agent_id: z.number().nullable(),
  channel: z.string(),
  sender_id: z.string().nullable(),
  sender_name: z.string().nullable(),
  direction: z.enum(["inbound", "outbound"]),
  message_preview: z.string().nullable(),
  model_name: z.string().nullable(),
  provider: z.string().nullable(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_write_tokens: z.number(),
  total_tokens: z.number(),
  cost_usd: z.number(),
  duration_ms: z.number(),
  error_type: z.string().nullable(),
  created_at: z.string(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

// ── Channel Daily Stats ────────────────────────────────
export const channelDailyStatsSchema = z.object({
  id: z.number(),
  stat_date: z.string(),
  channel: z.string(),
  agent_id: z.number().nullable(),
  message_count: z.number(),
  unique_users: z.number(),
  total_tokens: z.number(),
  total_cost_usd: z.number(),
  avg_duration_ms: z.number(),
  error_count: z.number(),
});
export type ChannelDailyStats = z.infer<typeof channelDailyStatsSchema>;

export interface ChannelAnalytics {
  channels: {
    channel: string;
    messages: number;
    tokens: number;
    cost: number;
    uniqueUsers: number;
    avgDurationMs: number;
    errors: number;
  }[];
  dailyTrend: { date: string; channel: string; messages: number; tokens: number; cost: number }[];
  topUsers: { sender_id: string; sender_name: string | null; channel: string; messages: number; tokens: number; cost: number }[];
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
}

// ── Analytics ───────────────────────────────────────────
export interface CostAnalytics {
  totalCost: number;
  dailyAverage: number;
  totalTokens: number;
  activeModels: number;
  period: string;
  dailyTrend: { date: string; cost: number }[];
  perAgentCost: { agent_name: string; cost: number; tokens: number; models: string[] }[];
  modelUsage: { model: string; tokens: number; cost: number }[];
}

export interface DashboardStats {
  totalTasks: number;
  tasksByStatus: { backlog: number; doing: number; done: number };
  activeAgents: number;
  totalSchedules: number;
  enabledSchedules: number;
  totalReports: number;
  recentActivity: number;
  todayCost: number;
  todayTokens: number;
  contextUsagePercent: number;
}

// ── Approval Queue ─────────────────────────────────────
export const approvalStatusEnum = z.enum(["pending", "approved", "rejected", "expired"]);
export const approvalActionEnum = z.enum(["file_delete", "external_api", "agent_create", "schedule_modify", "cost_exceed", "custom"]);

export const approvalSchema = z.object({
  id: z.number(),
  tenant_id: z.number().default(1),
  agent_id: z.number().nullable(),
  action_type: approvalActionEnum,
  title: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.any()).nullable(),
  status: approvalStatusEnum,
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const insertApprovalSchema = z.object({
  agent_id: z.number().nullable().optional(),
  action_type: approvalActionEnum,
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  payload: z.record(z.any()).nullable().optional(),
  expires_at: z.string().nullable().optional(),
});
export type InsertApproval = z.infer<typeof insertApprovalSchema>;

