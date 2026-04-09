import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTaskSchema, insertAgentSchema, insertScheduleSchema, insertReportSchema } from "@shared/schema";
import os from "os";
import crypto from "crypto";
import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { getOpenClawStatus, addOpenClawAgent, deployAgentSoul, chatWithAgent } from "./openclaw-client";
import { deployMCSkill } from "./mc-skill";
import { OPENCLAW_HOME, OPENCLAW_WORKSPACE, OPENCLAW_AGENTS_DIR, OPENCLAW_CONFIG, openclawEnv } from "./paths";

// ── Session type augmentation ────────────────────────────
declare module "express-session" {
  interface SessionData {
    email: string;
    role: string;
    userName: string;
  }
}

// ── Auth middleware ──────────────────────────────────────
const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/setup/",
  "/api/tools/",   // CEO agent calls these via web_fetch (no browser session)
];

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (req.headers["x-mc-internal"] === "1") return next();
  if (req.session?.email) return next();
  res.status(401).json({ message: "Unauthorized — please sign in" });
}


// ── OpenClaw gateway hardening ───────────────────────────
// Ensures openclaw.json has gateway.bind = "loopback" and gateway.auth.mode = "token"
// Called after setup wizard saves a domain, so the gateway is never publicly exposed
// even when the MC domain is reachable externally. MC proxies to the gateway internally.
function lockOpenClawToLoopback(): void {
  try {
    const configPath = OPENCLAW_CONFIG;
    if (!existsSync(configPath)) return; // openclaw not installed yet — wizard will handle

    const raw = readFileSync(configPath, "utf8");
    let config: any = {};
    try { config = JSON.parse(raw); } catch { return; } // JSON5 — skip rather than corrupt

    // Ensure gateway section exists and is locked to loopback with token auth
    config.gateway = config.gateway ?? {};
    config.gateway.bind = "loopback";              // 127.0.0.1 only
    config.gateway.auth = config.gateway.auth ?? {};
    if (!config.gateway.auth.mode) {
      config.gateway.auth.mode = "token";           // require token, not open
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch (err: any) {
    // Non-fatal — log but don't fail setup
    console.warn(`⚠️  Could not lock OpenClaw to loopback: ${err.message}`);
  }
}

// ── Provider → OpenClaw model string mapping ────────────
const PROVIDER_MODEL_MAP: Record<string, string> = {
  anthropic:  "anthropic/claude-3-5-sonnet-20241022",
  openai:     "openai/gpt-4o",
  openrouter: "openrouter/auto",
  ollama:     "openai/llama3.2",
  google:     "google/gemini-pro",
  xai:        "xai/grok-beta",
  perplexity: "perplexity/llama-3.1-sonar-small-128k-online",
  custom:     "openai/custom",
};

// Provider API format used by OpenClaw in models.json
const PROVIDER_API_MAP: Record<string, string> = {
  anthropic:  "anthropic-messages",
  openai:     "openai-completions",
  openrouter: "openai-completions",
  ollama:     "openai-completions",
  google:     "google-gemini",
  xai:        "openai-completions",
  perplexity: "openai-completions",
  custom:     "openai-completions",
};

// Default base URLs per provider
const PROVIDER_BASE_URL: Record<string, string> = {
  anthropic:  "https://api.anthropic.com/v1",
  openai:     "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama:     "http://localhost:11434/v1",
  google:     "https://generativelanguage.googleapis.com/v1beta",
  xai:        "https://api.x.ai/v1",
  perplexity: "https://api.perplexity.ai",
};

// Cost per 1M tokens (input, output) in USD — approximate published pricing
const MODEL_PRICING: { pattern: RegExp; input: number; output: number }[] = [
  { pattern: /claude-opus-4/i,               input: 15.00, output: 75.00 },
  { pattern: /claude-3-5-sonnet|sonnet-4/i,  input:  3.00, output: 15.00 },
  { pattern: /claude-3-5-haiku|haiku-4/i,    input:  0.80, output:  4.00 },
  { pattern: /claude-3-opus/i,               input: 15.00, output: 75.00 },
  { pattern: /claude/i,                      input:  3.00, output: 15.00 },
  { pattern: /gpt-4o-mini/i,                 input:  0.15, output:  0.60 },
  { pattern: /gpt-4o/i,                      input:  5.00, output: 15.00 },
  { pattern: /gpt-4/i,                       input: 10.00, output: 30.00 },
  { pattern: /gpt-3.5/i,                     input:  0.50, output:  1.50 },
  { pattern: /gemini-1\.5-pro/i,             input:  3.50, output: 10.50 },
  { pattern: /gemini/i,                      input:  0.35, output:  1.05 },
  { pattern: /grok/i,                        input:  5.00, output: 15.00 },
  { pattern: /ollama|llama/i,                input:  0.00, output:  0.00 },
];

/**
 * Estimate cost in USD from prompt/completion token counts and a model name string.
 * Falls back to $3/$15 (Claude Sonnet pricing) if model is unrecognised.
 */
function estimateChatCost(usage: { prompt_tokens: number; completion_tokens: number }, modelName: string): number {
  const pricing = MODEL_PRICING.find(p => p.pattern.test(modelName))
    ?? { input: 3.00, output: 15.00 }; // safe default
  const cost = (usage.prompt_tokens / 1_000_000) * pricing.input
             + (usage.completion_tokens / 1_000_000) * pricing.output;
  return parseFloat(cost.toFixed(6));
}

/**
 * Read the active model name from ~/.openclaw/openclaw.json agents.defaults.model.
 * Returns null if unavailable.
 */
function readActiveModel(): string | null {
  try {
    const configPath = OPENCLAW_CONFIG;
    if (!existsSync(configPath)) return null;
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    return cfg?.agents?.defaults?.model ?? null;
  } catch { return null; }
}

// Default model IDs per provider (for models.json)
const PROVIDER_DEFAULT_MODELS: Record<string, { id: string; name: string }[]> = {
  anthropic:  [{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" }, { id: "claude-opus-4-6", name: "Claude Opus 4.6" }],
  openai:     [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-4o-mini", name: "GPT-4o Mini" }],
  openrouter: [
    { id: "auto", name: "OpenRouter Auto" },
    { id: "openrouter/hunter-alpha", name: "Hunter Alpha" },
    { id: "openrouter/healer-alpha", name: "Healer Alpha" },
  ],
  ollama:     [{ id: "llama3.2", name: "Llama 3.2" }],
  google:     [{ id: "gemini-pro", name: "Gemini Pro" }, { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" }],
  xai:        [{ id: "grok-beta", name: "Grok Beta" }],
  perplexity: [{ id: "llama-3.1-sonar-small-128k-online", name: "Sonar Small Online" }],
  custom:     [{ id: "custom", name: "Custom Model" }],
};

/**
 * Wire the user's chosen AI provider into OpenClaw after install.
 * Writes auth-profiles.json (API key) and models.json (provider config),
 * then updates agents.defaults.model in openclaw.json via CLI.
 *
 * models = the ai_models object from the setup wizard:
 *   { openrouter: { apiKey: "sk-or-v1-...", endpointUrl: "...", configured: true }, ... }
 */
function wireOpenClawProvider(models: Record<string, any> | undefined): void {
  if (!models) return;

  const ocDir = OPENCLAW_HOME;
  const agentDir = join(ocDir, "agents", "main", "agent");

  if (!existsSync(ocDir)) {
    console.warn("[wireOpenClawProvider] ~/.openclaw not found — skipping");
    return;
  }

  // Collect ALL configured providers (configured=true with a key, or Ollama which needs no key)
  const allConfigured = (Object.entries(models) as [string, any][]).filter(([p, cfg]) =>
    cfg?.configured === true && (cfg?.apiKey?.trim() || p === "ollama")
  );

  if (allConfigured.length === 0) {
    console.warn("[wireOpenClawProvider] No configured providers found in ai_models");
    return;
  }

  // Primary = last configured entry (most recently toggled on / saved)
  const [provider] = allConfigured[allConfigured.length - 1];
  console.log(`[wireOpenClawProvider] Wiring ${allConfigured.length} provider(s), primary: ${provider}`);

  // ── 1. Write auth-profiles.json — ALL configured providers ──
  mkdirSync(agentDir, { recursive: true });
  const authProfilesPath = join(agentDir, "auth-profiles.json");
  const authProfiles: Record<string, any> = { version: 1, profiles: {} };

  for (const [p, cfg] of allConfigured) {
    const key = (cfg.apiKey || "").trim();
    if (p === "ollama") {
      authProfiles.profiles[`${p}-main`] = { type: "api_key", provider: "openai", key: "ollama" };
    } else if (key) {
      authProfiles.profiles[`${p}-main`] = { type: "api_key", provider: p, key };
    }
  }

  writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2), "utf8");
  console.log(`[wireOpenClawProvider] Wrote auth-profiles.json (${Object.keys(authProfiles.profiles).length} profiles)`);

  // ── 2. Write models.json — ALL configured providers ─────────
  const modelsPath = join(agentDir, "models.json");
  const modelsProviders: Record<string, any> = {};

  for (const [p, cfg] of allConfigured) {
    const key      = (cfg.apiKey || "").trim();
    const endpoint = (cfg.endpointUrl || "").trim();
    const pk       = p === "ollama" ? "openai" : p;
    modelsProviders[pk] = {
      baseUrl: p === "ollama" ? (endpoint || "http://localhost:11434/v1") : (endpoint || PROVIDER_BASE_URL[p] || ""),
      api: PROVIDER_API_MAP[p] || "openai-completions",
      models: (PROVIDER_DEFAULT_MODELS[p] || [{ id: "default", name: "Default" }]).map((m: any) => ({
        id: m.id, name: m.name, reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000, maxTokens: 8192,
      })),
      ...(key ? { apiKey: key } : {}),
    };
  }

  writeFileSync(modelsPath, JSON.stringify({ providers: modelsProviders }, null, 2), "utf8");
  console.log(`[wireOpenClawProvider] Wrote models.json`);

  // ── 3. Set agents.defaults.model in openclaw.json (primary provider) ───
  const modelString = PROVIDER_MODEL_MAP[provider] || `${provider}/default`;
  const configPath  = join(ocDir, "openclaw.json");

  try {
    execSync(`openclaw config set agents.defaults.model '${modelString}'`, {
      shell: true, encoding: "utf8", stdio: "pipe",
    });
    console.log(`[wireOpenClawProvider] Set agents.defaults.model = ${modelString} via CLI`);
    return;
  } catch { /* fall through to direct JSON patch */ }

  // Direct JSON patch fallback
  if (existsSync(configPath)) {
    try {
      const raw    = readFileSync(configPath, "utf8");
      const config = JSON.parse(raw);
      config.agents = config.agents ?? {};
      config.agents.defaults = config.agents.defaults ?? {};
      config.agents.defaults.model = modelString;
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      console.log(`[wireOpenClawProvider] Set agents.defaults.model = ${modelString} via JSON patch`);
    } catch (err: any) {
      console.warn(`[wireOpenClawProvider] Could not update model in openclaw.json: ${err.message}`);
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Apply auth middleware globally — public routes bypass it (see PUBLIC_PREFIXES above)
  app.use(requireAuth);

  // ── Auth ─────────────────────────────────────────────

  // Check current session — used by frontend to decide login vs app
  app.get("/api/auth/me", (req, res) => {
    if (req.session?.email) {
      return res.json({
        authenticated: true,
        email: req.session.email,
        role: "owner",
        name: req.session.userName || "",
      });
    }
    res.json({ authenticated: false });
  });

  // Login — validate against stored admin credentials (settings table)
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    try {
      const inputHash = crypto.createHash("sha256").update(password + "_mc_salt").digest("hex");
      let userName: string = "";
      let matched = false;

      // Check settings table — single admin user
      const settings = await storage.getSettings();
      const storedEmail = settings.find(s => s.setting_key === "admin_email")?.setting_value;
      const storedHash  = settings.find(s => s.setting_key === "admin_password_hash")?.setting_value;
      if (storedEmail && storedHash) {
        const emailMatch = String(storedEmail).toLowerCase() === String(email).toLowerCase();
        try {
          matched = emailMatch && crypto.timingSafeEqual(
            Buffer.from(inputHash, "hex"),
            Buffer.from(String(storedHash), "hex")
          );
        } catch { matched = false; }
        if (matched) {
          userName = String(settings.find(s => s.setting_key === "admin_name")?.setting_value || "Admin");
        }
      }

      if (!matched) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Regenerate session to prevent fixation attacks
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ message: "Session error" });
        req.session.email = String(email);
        req.session.role = "owner";
        req.session.userName = userName;
        req.session.save((saveErr) => {
          if (saveErr) return res.status(500).json({ message: "Session save error" });
          res.json({ authenticated: true, email, role: "owner", name: userName });
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Login failed" });
    }
  });

  // Logout — destroy session
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("mc.sid");
      res.json({ ok: true });
    });
  });

  // ── Change Password ──────────────────────────────────
  app.post("/api/auth/change-password", async (req, res) => {
    const { current, new: newPw } = req.body;
    if (!current || !newPw) return res.status(400).json({ message: "Current and new password required" });
    if (newPw.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });

    const settings = await storage.getSettings();
    const storedHash = settings.find(s => s.setting_key === "admin_password_hash")?.setting_value;
    const inputHash = crypto.createHash("sha256").update(current + "_mc_salt").digest("hex");

    try {
      const matched = crypto.timingSafeEqual(
        Buffer.from(inputHash, "hex"),
        Buffer.from(String(storedHash), "hex")
      );
      if (!matched) return res.status(401).json({ message: "Current password is incorrect" });
    } catch {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const newHash = crypto.createHash("sha256").update(newPw + "_mc_salt").digest("hex");
    await storage.updateSetting("admin_password_hash", newHash);
    res.json({ success: true });
  });

  // ── Agents ──────────────────────────────────────────
  app.get("/api/agents", async (_req: Request, res: Response) => {
    // Filter out stray OpenClaw sync artifacts (any name/id starting with "openclaw")
    const filterStray = (agents: any[]) => agents.filter(a =>
      !/^openclaw/i.test(a.name) && !/^openclaw/i.test(a.openclaw_id || "")
    );
    const agents = await storage.getAgents();
    res.json(filterStray(agents));
  });

  app.get("/api/agents/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const agent = await storage.getAgent(id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    const [tasks, reports, schedules] = await Promise.all([
      storage.getTasksByAgent(id),
      storage.getReportsByAgent(id),
      storage.getSchedulesByAgent(id),
    ]);
    const activity = await storage.getActivityLog(20, id);
    res.json({ ...agent, tasks, reports, schedules, recentActivity: activity });
  });

  // Per-agent cost history — used by the Token Usage tab on agent profile
  app.get("/api/agents/:id/costs", async (req, res) => {
    const id = parseInt(req.params.id);
    const period = (req.query.period as string) || "month";
    const cutoff = (() => {
      const d = new Date();
      if (period === "today") return d.toISOString().slice(0, 10);
      if (period === "week")  { d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); }
      if (period === "month") { d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); }
      return null;
    })();

    const entries = await storage.getCostEntries();
    const filtered = entries.filter(e =>
      e.agent_id === id && (!cutoff || e.entry_date >= cutoff)
    );

    const totalTokens = filtered.reduce((s, e) => s + e.tokens_used, 0);
    const totalCost   = filtered.reduce((s, e) => s + e.cost_usd, 0);

    // Daily breakdown
    const dailyMap = new Map<string, { tokens: number; cost: number }>();
    for (const e of filtered) {
      const cur = dailyMap.get(e.entry_date) || { tokens: 0, cost: 0 };
      cur.tokens += e.tokens_used; cur.cost += e.cost_usd;
      dailyMap.set(e.entry_date, cur);
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, tokens: d.tokens, cost: parseFloat(d.cost.toFixed(6)) }));

    // Model breakdown
    const modelMap = new Map<string, { tokens: number; cost: number }>();
    for (const e of filtered) {
      const cur = modelMap.get(e.model_name) || { tokens: 0, cost: 0 };
      cur.tokens += e.tokens_used; cur.cost += e.cost_usd;
      modelMap.set(e.model_name, cur);
    }
    const byModel = [...modelMap.entries()].map(([model, d]) => ({
      model, tokens: d.tokens, cost: parseFloat(d.cost.toFixed(6))
    }));

    res.json({ agentId: id, period, totalTokens, totalCost: parseFloat(totalCost.toFixed(6)), daily, byModel });
  });

  app.patch("/api/agents/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    // General agent update — accepts name, role, avatar_color, soul, skills, model_config
    const { name, role, avatar_color, soul, skills, model_config } = req.body;
    const agent = await storage.updateAgent(id, { name, role, avatar_color, soul, skills, model_config });
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  });

  app.patch("/api/agents/:id/status", async (req, res) => {
    const id = parseInt(req.params.id);
    const { status, current_task_summary } = req.body;
    const agent = await storage.updateAgentStatus(id, status, current_task_summary);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    await storage.logActivity("agent_status_change", `${agent.name} status changed to ${status}`, id);
    res.json(agent);
  });

  // Create a new agent — also registers it in OpenClaw if openclaw_id is provided
  app.post("/api/agents", async (req, res) => {
    const parsed = insertAgentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const agent = await storage.createAgent(parsed.data);

    // If an openclaw_id was specified, register the agent in OpenClaw too
    if (agent.openclaw_id) {
      const result = await addOpenClawAgent(agent.openclaw_id, agent.soul ?? null);
      if (!result.ok) {
        // Non-fatal — agent exists in MC DB even if OpenClaw registration failed
        console.warn(`⚠️  OpenClaw agent registration failed for ${agent.openclaw_id}: ${result.error}`);
      }
    }

    await storage.logActivity("agent_status_change", `New agent created: ${agent.name}`, agent.id);
    res.status(201).json(agent);
  });

  // Promote a dynamic agent to permanent roster member
  app.patch("/api/agents/:id/promote", async (req, res) => {
    const id = parseInt(req.params.id);
    const agent = await storage.promoteAgent(id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  });

  // Append skills to an agent without replacing existing ones
  // Used by CEO agent soul to add task-specific skills before delegation
  app.patch("/api/agents/:id/skills/append", async (req, res) => {
    const id = parseInt(req.params.id);
    const { skills: newSkills } = req.body;
    if (!Array.isArray(newSkills)) return res.status(400).json({ message: "skills must be an array" });

    const agent = await storage.getAgent(id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    // Merge, deduplicate
    const merged = [...new Set([...(agent.skills ?? []), ...newSkills])];
    const updated = await storage.updateAgent(id, { skills: merged });
    res.json(updated);
  });

  // Chat with an agent via OpenClaw CLI (--local, no gateway needed)
  app.post("/api/agents/:id/chat", async (req, res) => {
    const id = parseInt(req.params.id);
    const agent = await storage.getAgent(id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: "messages array required" });
    }

    const agentName = agent.openclaw_id || "main";
    const isCEO = agentName === "main" || agentName === "openclaw/main";

    // For the CEO, inject the current agent roster so it never needs to
    // call list-agents as a separate round-trip before acting.
    let agentRoster: import("./openclaw-client").RosterAgent[] | undefined;
    if (isCEO) {
      const all = await storage.getAgents();
      agentRoster = all.map(a => ({
        id: a.id,
        name: a.name,
        openclaw_id: a.openclaw_id ?? null,
        role: a.role,
        skills: Array.isArray(a.skills) ? a.skills : [],
      }));
    }

    const result = await chatWithAgent(agentName, messages, { agentRoster });

    // Record token usage for cost tracking
    if (result.usage && result.usage.total_tokens > 0) {
      try {
        const activeModel = readActiveModel() || result.model || "openclaw/main";
        const cost_usd = estimateChatCost(result.usage, activeModel);
        await storage.addCostEntry({
          agent_id: agent.id,
          model_name: activeModel,
          tokens_used: result.usage.total_tokens,
          cost_usd,
          entry_date: new Date().toISOString().slice(0, 10),
        });
      } catch { /* non-fatal */ }
    }

    // Log chat interaction to activity feed
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const preview = lastUserMsg ? (lastUserMsg.content || "").substring(0, 80) : "";
    await storage.logActivity("chat_message", `Chat with ${agent.name}: "${preview}"`, agent.id).catch(() => {});

    res.json(result);
  });

  // ── Live task output streaming (SSE) ─────────────────
  const taskOutputBuffers = new Map<number, string>();   // taskId → accumulated output
  const taskSseClients    = new Map<number, Set<any>>(); // taskId → set of SSE res objects

  function broadcastTaskChunk(taskId: number, chunk: string) {
    const current = taskOutputBuffers.get(taskId) ?? "";
    taskOutputBuffers.set(taskId, (current + chunk).slice(-65536)); // keep last 64KB
    for (const res of taskSseClients.get(taskId) ?? []) {
      try { res.write(`data: ${JSON.stringify({ chunk })}\n\n`); } catch { /* disconnected */ }
    }
  }

  function completeTaskStream(taskId: number) {
    for (const res of taskSseClients.get(taskId) ?? []) {
      try { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); } catch {}
    }
    taskSseClients.delete(taskId);
    setTimeout(() => taskOutputBuffers.delete(taskId), 60000); // keep buffer 60s for late joiners
  }

  app.get("/api/tasks/:id/live", (req, res) => {
    const id = parseInt(req.params.id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // Replay any buffered output so a late-connecting client catches up
    const buffer = taskOutputBuffers.get(id);
    if (buffer) res.write(`data: ${JSON.stringify({ chunk: buffer, replay: true })}\n\n`);
    // If no buffer exists the task is already done — send done immediately
    if (!taskOutputBuffers.has(id)) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }
    if (!taskSseClients.has(id)) taskSseClients.set(id, new Set());
    taskSseClients.get(id)!.add(res);
    req.on("close", () => { taskSseClients.get(id)?.delete(res); });
  });

  // Detect whether an agent response is asking for clarification / direction
  // rather than delivering a completed result. Checks for question patterns,
  // "please clarify", "which approach", "let me know", etc.
  function isAwaitingInput(text: string): boolean {
    const t = text.toLowerCase();
    const patterns = [
      /\?\s*$/m,                          // ends a line with a question mark
      /please (clarify|confirm|advise|let me know|specify|provide)/,
      /which (option|approach|direction|way|one) (would you|do you|should i)/,
      /would you like me to/,
      /how would you like (me to|to proceed)/,
      /before i (proceed|continue|start)/,
      /let me know (how|which|what|if|whether)/,
      /i('d| would) need (more|your|additional)/,
      /can you (confirm|clarify|provide|let me know)/,
      /awaiting your (input|direction|feedback|confirmation)/,
      /to proceed[,.]? (i need|please|can you)/,
    ];
    return patterns.some(p => p.test(t));
  }

  // ── Task execution engine ────────────────────────────
  // Called whenever a task lands in "doing" with an assigned agent.
  // Fire-and-forget — the HTTP response has already been sent.
  async function runTaskWithAgent(taskId: number): Promise<void> {
    try {
      const taskRow = await storage.getTaskById(taskId);
      if (!taskRow || !taskRow.agent_id) return;

      const agents = await storage.getAgents();
      const agent  = agents.find(a => a.id === taskRow.agent_id);
      if (!agent?.openclaw_id) return;

      await storage.updateAgentStatus(agent.id, "working", taskRow.title);

      const agentName = agent.openclaw_id.replace(/^openclaw\//, "");
      console.log(`[task] running "${taskRow.title}" via ${agentName}`);
      const agentRoster = agents.map(a => ({
        id: a.id, name: a.name, openclaw_id: a.openclaw_id ?? null,
        role: a.role, skills: Array.isArray(a.skills) ? a.skills : [],
      }));

      taskOutputBuffers.set(taskId, ""); // open stream
      const onData = (chunk: string) => broadcastTaskChunk(taskId, chunk);

      const result = await chatWithAgent(agentName, [
        { role: "user", content: taskRow.description ?? taskRow.title },
      ], { agentRoster, onData });

      // Detect whether the agent actually finished or is waiting for direction.
      // If the response reads like a question / request for clarification,
      // move back to backlog so the user knows it needs input.
      const needsInput = result.ok && result.text ? isAwaitingInput(result.text) : false;
      const finalStatus = !result.ok ? "backlog" : needsInput ? "backlog" : "done";

      await storage.updateTask(taskId, { status: finalStatus });
      await storage.updateAgentStatus(agent.id, "idle", null);
      completeTaskStream(taskId);

      // Always save a report if we got content — even if awaiting input,
      // the agent's response/questions are useful context.
      if (result.ok && result.text) {
        await storage.createReport({
          title: taskRow.title,
          content: result.text,
          type: "operational",
          status: needsInput ? "draft" : "complete",
          agent_id: taskRow.agent_id,
          tags: needsInput ? ["task", "awaiting-input"] : ["task"],
        });
      }

      await storage.logActivity(
        finalStatus === "done" ? "task_completed" : "task_moved",
        finalStatus === "done"
          ? `${agent.name} completed: ${taskRow.title}: ${result.text?.slice(0, 120) ?? ""}${(result.text?.length ?? 0) > 120 ? "…" : ""}`
          : `${agent.name} needs input on: ${taskRow.title} — moved to backlog`,
        taskRow.agent_id, taskId
      );

      if (result.ok && result.usage) {
        const tokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0);
        if (tokens > 0) {
          const activeModel = readActiveModel() || result.model || "openclaw/main";
          await storage.addCostEntry({
            agent_id: taskRow.agent_id,
            model_name: activeModel,
            tokens_used: tokens,
            cost_usd: estimateChatCost(result.usage, activeModel),
            entry_date: new Date().toISOString().split("T")[0],
          });
        }
      }
    } catch (e: any) {
      console.warn(`[task] runTaskWithAgent(${taskId}) failed:`, e.message);
      // Ensure agent doesn't stay stuck in "working" on unexpected failure
      try {
        const taskRow = await storage.getTaskById(taskId);
        if (taskRow?.agent_id) await storage.updateAgentStatus(taskRow.agent_id, "idle", null);
      } catch { /* best-effort */ }
      completeTaskStream(taskId);
    }
  }

  // ── Tasks ───────────────────────────────────────────
  app.get("/api/tasks", async (req, res) => {
    const status = req.query.status as string | undefined;
    const tasks = await storage.getTasks(status);
    res.json(tasks);
  });

  app.post("/api/tasks", async (req, res) => {
    const parsed = insertTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const task = await storage.createTask(parsed.data);
    await storage.logActivity("task_created", `Created task: ${task.title}`, task.agent_id, task.id);
    res.status(201).json(task);
    // If created directly into "doing" with an agent, execute immediately
    if (task.status === "doing" && task.agent_id) {
      runTaskWithAgent(task.id).catch(e => console.warn("[task] exec error:", e.message));
    }
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const task = await storage.updateTask(id, req.body);
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteTask(id);
    if (!deleted) return res.status(404).json({ message: "Task not found" });
    await storage.logActivity("task_deleted", `Deleted task #${id}`);
    res.json({ success: true });
  });

  app.patch("/api/tasks/:id/move", async (req, res) => {
    const id = parseInt(req.params.id);
    const { status, position } = req.body;
    const task = await storage.moveTask(id, status, position ?? 0);
    if (!task) return res.status(404).json({ message: "Task not found" });
    await storage.logActivity("task_moved", `Moved '${task.title}' to ${status}`, task.agent_id, task.id);
    res.json(task);
    // Dragged into "doing" with an agent assigned — execute it
    if (status === "doing" && task.agent_id) {
      runTaskWithAgent(task.id).catch(e => console.warn("[task] exec error:", e.message));
    }
  });

  // ── Schedules ───────────────────────────────────────
  app.get("/api/schedules", async (_req: Request, res: Response) => {
    const schedules = await storage.getSchedules();
    res.json(schedules);
  });

  app.post("/api/schedules", async (req, res) => {
    const parsed = insertScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const schedule = await storage.createSchedule(parsed.data);
    await storage.logActivity("schedule_created", `Created schedule: ${schedule.name}`, schedule.agent_id);
    res.status(201).json(schedule);
  });

  app.patch("/api/schedules/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const schedule = await storage.updateSchedule(id, req.body);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    await storage.logActivity("schedule_updated", `Updated schedule: ${schedule.name}`, schedule.agent_id);
    res.json(schedule);
  });

  app.delete("/api/schedules/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteSchedule(id);
    if (!deleted) return res.status(404).json({ message: "Schedule not found" });
    res.json({ success: true });
  });

  app.patch("/api/schedules/:id/toggle", async (req, res) => {
    const id = parseInt(req.params.id);
    const schedule = await storage.toggleSchedule(id);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    await storage.logActivity("schedule_updated", `${schedule.is_enabled ? "Enabled" : "Disabled"} schedule: ${schedule.name}`, schedule.agent_id);
    res.json(schedule);
  });

  // ── Reports ─────────────────────────────────────────
  app.get("/api/reports", async (req, res) => {
    const filters = {
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
      search: req.query.search as string | undefined,
    };
    const reports = await storage.getReports(filters);
    res.json(reports);
  });

  app.get("/api/reports/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const report = await storage.getReport(id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    res.json(report);
  });

  app.post("/api/reports", async (req, res) => {
    const parsed = insertReportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const report = await storage.createReport(parsed.data);
    await storage.logActivity("report_generated", `Generated report: ${report.title}`, report.agent_id);
    res.status(201).json(report);
  });

  app.patch("/api/reports/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const report = await storage.updateReport(id, req.body);
    if (!report) return res.status(404).json({ message: "Report not found" });
    res.json(report);
  });

  // ── Activity ────────────────────────────────────────
  app.get("/api/activity", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id as string) : undefined;
    const activity = await storage.getActivityLog(limit, agentId);
    res.json(activity);
  });

  // ── Analytics ───────────────────────────────────────
  app.get("/api/analytics/costs", async (req, res) => {
    const period = (req.query.period as string) || "all";
    const analytics = await storage.getCostAnalytics(period);
    res.json(analytics);
  });

  app.get("/api/analytics/costs/entries", async (_req, res) => {
    const entries = await storage.getCostEntries();
    res.json(entries);
  });

  // ── Analytics Usage Sync ─────────────────────────────
  // Pulls actual token/cost usage from each configured AI provider's API.
  // Provider-specific endpoints:
  //   Anthropic  → GET /v1/usage (beta)
  //   OpenAI     → GET /v1/usage?date=YYYY-MM-DD (past 7 days)
  //   OpenRouter → GET /api/v1/auth/key (credits + usage)
  app.post("/api/analytics/sync", async (_req, res) => {
    try {
      const allSettings = await storage.getSettings();
      const aiModelsSetting = allSettings.find(s => s.setting_key === "ai_models");
      const aiModels = aiModelsSetting?.setting_value
        ? JSON.parse(aiModelsSetting.setting_value as string)
        : {};

      const agents = await storage.getAgents();
      const systemAgentId = agents[0]?.id ?? 1; // attribute synced entries to first agent

      const results: { provider: string; status: string; entries: number }[] = [];

      // ── Anthropic ────────────────────────────────────
      const anthropicKey = aiModels?.anthropic?.apiKey || aiModels?.anthropic?.api_key;
      if (anthropicKey) {
        try {
          const now = new Date();
          const startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          const resp = await fetch(
            `https://api.anthropic.com/v1/usage?start_time=${startDate.toISOString()}&end_time=${now.toISOString()}`,
            {
              headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "usage-1",
              },
              signal: AbortSignal.timeout(10000),
            }
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            let count = 0;
            // Response shape: { data: [{ model, usage: { input_tokens, output_tokens }, date }] }
            for (const item of (data.data || [])) {
              const tokens = (item.usage?.input_tokens || 0) + (item.usage?.output_tokens || 0);
              if (!tokens) continue;
              const model = item.model || "claude";
              const dateStr = item.date || new Date().toISOString().split("T")[0];
              // Estimate cost using published pricing (approx)
              const inputCost = (item.usage?.input_tokens || 0) / 1_000_000 * 3.0;
              const outputCost = (item.usage?.output_tokens || 0) / 1_000_000 * 15.0;
              await storage.addCostEntry({
                agent_id: systemAgentId,
                model_name: model,
                tokens_used: tokens,
                cost_usd: parseFloat((inputCost + outputCost).toFixed(6)),
                entry_date: dateStr,
              });
              count++;
            }
            results.push({ provider: "anthropic", status: "ok", entries: count });
          } else {
            results.push({ provider: "anthropic", status: `HTTP ${resp.status}`, entries: 0 });
          }
        } catch (e: any) {
          results.push({ provider: "anthropic", status: e.message, entries: 0 });
        }
      }

      // ── OpenAI ────────────────────────────────────────
      const openaiKey = aiModels?.openai?.apiKey || aiModels?.openai?.api_key;
      if (openaiKey) {
        try {
          let count = 0;
          // OpenAI usage endpoint: GET /v1/usage?date=YYYY-MM-DD (one day at a time)
          for (let d = 6; d >= 0; d--) {
            const day = new Date();
            day.setDate(day.getDate() - d);
            const dateStr = day.toISOString().split("T")[0];
            const resp = await fetch(
              `https://api.openai.com/v1/usage?date=${dateStr}`,
              {
                headers: { Authorization: `Bearer ${openaiKey}` },
                signal: AbortSignal.timeout(10000),
              }
            );
            if (!resp.ok) continue;
            const data = await resp.json() as any;
            // Response: { data: [{ model, n_context_tokens_total, n_generated_tokens_total, ... }] }
            for (const item of (data.data || [])) {
              const tokens = (item.n_context_tokens_total || 0) + (item.n_generated_tokens_total || 0);
              if (!tokens) continue;
              // Cost from snapshot_id or model name; OpenAI doesn't return cost directly
              const model = item.snapshot_id || item.model || "gpt";
              const costPer1k = model.includes("gpt-4o-mini") ? 0.00015 : model.includes("gpt-4o") ? 0.005 : model.includes("gpt-4") ? 0.01 : 0.002;
              await storage.addCostEntry({
                agent_id: systemAgentId,
                model_name: model,
                tokens_used: tokens,
                cost_usd: parseFloat(((tokens / 1000) * costPer1k).toFixed(6)),
                entry_date: dateStr,
              });
              count++;
            }
          }
          results.push({ provider: "openai", status: "ok", entries: count });
        } catch (e: any) {
          results.push({ provider: "openai", status: e.message, entries: 0 });
        }
      }

      // ── OpenRouter ────────────────────────────────────
      const openrouterKey = aiModels?.openrouter?.apiKey || aiModels?.openrouter?.api_key;
      if (openrouterKey) {
        try {
          const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${openrouterKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            const data = await resp.json() as any;
            // Returns { data: { usage, limit, is_free_tier, rate_limit } }
            // usage = credits used (in USD). No per-model breakdown here.
            const usageDollars = parseFloat(data.data?.usage || "0");
            if (usageDollars > 0) {
              const today = new Date().toISOString().split("T")[0];
              await storage.addCostEntry({
                agent_id: systemAgentId,
                model_name: "openrouter",
                tokens_used: Math.round(usageDollars * 200000), // rough estimate
                cost_usd: parseFloat(usageDollars.toFixed(6)),
                entry_date: today,
              });
              results.push({ provider: "openrouter", status: "ok (account total)", entries: 1 });
            } else {
              results.push({ provider: "openrouter", status: "ok (no usage)", entries: 0 });
            }
          } else {
            results.push({ provider: "openrouter", status: `HTTP ${resp.status}`, entries: 0 });
          }
        } catch (e: any) {
          results.push({ provider: "openrouter", status: e.message, entries: 0 });
        }
      }

      res.json({ success: true, results, synced: results.reduce((s, r) => s + r.entries, 0) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── Channel Analytics ────────────────────────────────
  // Per-channel breakdown: messages, tokens, cost, users
  app.get("/api/analytics/channels", async (req, res) => {
    const days = parseInt(req.query.days as string) || 30;
    try {
      // Channel summary
      const channels = await storage.query(`
        SELECT channel,
          COUNT(*) as messages,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost,
          COUNT(DISTINCT sender_id) as unique_users,
          AVG(duration_ms) as avg_duration_ms,
          SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) as errors
        FROM conversation_turns
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY channel
        ORDER BY messages DESC
      `, [days]);

      // Daily trend by channel
      const dailyTrend = await storage.query(`
        SELECT DATE(created_at) as date, channel,
          COUNT(*) as messages,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost
        FROM conversation_turns
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(created_at), channel
        ORDER BY date
      `, [days]);

      // Top users across channels
      const topUsers = await storage.query(`
        SELECT sender_id, sender_name, channel,
          COUNT(*) as messages,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost
        FROM conversation_turns
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND sender_id IS NOT NULL
        GROUP BY sender_id, sender_name, channel
        ORDER BY messages DESC
        LIMIT 20
      `, [days]);

      // Totals
      const totals = channels.reduce((acc: any, c: any) => ({
        messages: acc.messages + (parseInt(c.messages) || 0),
        tokens: acc.tokens + (parseInt(c.tokens) || 0),
        cost: acc.cost + (parseFloat(c.cost) || 0),
      }), { messages: 0, tokens: 0, cost: 0 });

      res.json({
        channels: channels.map((c: any) => ({
          channel: c.channel,
          messages: parseInt(c.messages) || 0,
          tokens: parseInt(c.tokens) || 0,
          cost: parseFloat(c.cost) || 0,
          uniqueUsers: parseInt(c.unique_users) || 0,
          avgDurationMs: Math.round(parseFloat(c.avg_duration_ms) || 0),
          errors: parseInt(c.errors) || 0,
        })),
        dailyTrend: dailyTrend.map((d: any) => ({
          date: d.date,
          channel: d.channel,
          messages: parseInt(d.messages) || 0,
          tokens: parseInt(d.tokens) || 0,
          cost: parseFloat(d.cost) || 0,
        })),
        topUsers: topUsers.map((u: any) => ({
          sender_id: u.sender_id,
          sender_name: u.sender_name,
          channel: u.channel,
          messages: parseInt(u.messages) || 0,
          tokens: parseInt(u.tokens) || 0,
          cost: parseFloat(u.cost) || 0,
        })),
        totalMessages: totals.messages,
        totalTokens: totals.tokens,
        totalCost: totals.cost,
      });
    } catch (err: any) {
      // Table might not exist yet (pre-migration)
      res.json({ channels: [], dailyTrend: [], topUsers: [], totalMessages: 0, totalTokens: 0, totalCost: 0 });
    }
  });

  // Recent conversation turns (paginated)
  app.get("/api/analytics/conversations", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const channel = req.query.channel as string;
    try {
      const where = channel ? "WHERE channel = ?" : "";
      const params: any[] = channel ? [channel, limit, offset] : [limit, offset];
      const rows = await storage.query(`
        SELECT ct.*, a.name as agent_name
        FROM conversation_turns ct
        LEFT JOIN agents a ON ct.agent_id = a.id
        ${where}
        ORDER BY ct.created_at DESC
        LIMIT ? OFFSET ?
      `, params);
      res.json(rows);
    } catch {
      res.json([]);
    }
  });

  // ── Stats ───────────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    const stats = await storage.getStats();
    res.json(stats);
  });

  // ── Settings ────────────────────────────────────────
  app.get("/api/settings", async (_req: Request, res: Response) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.patch("/api/settings/:key", async (req, res) => {
    const key = req.params.key;
    const { value } = req.body;

    const setting = await storage.updateSetting(key, value);
    if (!setting) return res.status(404).json({ message: "Setting not found" });
    // BILLING CONTROL: re-wire OpenClaw on every ai_models change.
    // The toggle (configured=true/false) immediately adds/removes a provider
    // from auth-profiles.json so OpenClaw physically cannot use a toggled-off
    // provider — this is the customer's manual billing kill-switch.
    if (key === "ai_models") {
      try { wireOpenClawProvider(value); } catch (err: any) {
        console.error("[settings] wireOpenClawProvider failed:", err.message);
      }
    }
    res.json(setting);
  });

  // ── Integrations ────────────────────────────────────
  app.get("/api/integrations", async (_req, res) => {
    const integrations = await storage.getIntegrations();
    res.json(integrations);
  });

  // Map integration names to OpenClaw channel names + which config field holds the token
  const CHANNEL_MAP: Record<string, { channel: string; tokenField: string }> = {
    Discord:  { channel: "discord",  tokenField: "bot_token" },
    Telegram: { channel: "telegram", tokenField: "bot_token" },
    Slack:    { channel: "slack",    tokenField: "bot_token" },
    WhatsApp: { channel: "whatsapp", tokenField: "access_token" },
  };

  app.patch("/api/integrations/:id", async (req, res) => {
    const id = parseInt(req.params.id);

    // Look up the current integration to get its name
    const existing = (await storage.getIntegrations()).find(i => i.id === id);

    // OpenClaw-first: if this is a chat channel, push to OpenClaw before saving to DB
    if (existing && req.body.config) {
      const mapping = CHANNEL_MAP[existing.name];
      if (mapping) {
        const token = req.body.config[mapping.tokenField];
        if (token) {
          try {
            execSync(
              `openclaw channels add --channel ${mapping.channel} --token '${token.replace(/'/g, "'\\''")}'`,
              { timeout: 10000, env: openclawEnv() }
            );
          } catch (err: any) {
            // Log but don't block — the user can still save to DB even if openclaw isn't running
            console.error(`[mc] OpenClaw channel add failed for ${mapping.channel}:`, err.stderr?.toString() || err.message);
          }
        }
      }
    }

    const integration = await storage.updateIntegration(id, req.body);
    if (!integration) return res.status(404).json({ message: "Integration not found" });
    res.json(integration);
  });



  // ── Channel Connection Monitor ──────────────────────

  app.get("/api/channels/status", async (_req, res) => {
    // Check which integrations are configured + try to probe their connectivity
    const integrations = await storage.getIntegrations();
    const channels: { name: string; configured: boolean; connected: boolean; lastMessage?: string; error?: string }[] = [];

    for (const integ of integrations) {
      // Only check messaging channels
      if (!["Discord", "WhatsApp", "Telegram", "Slack", "Signal"].includes(integ.name)) continue;

      const hasConfig = Object.values(integ.config || {}).some(v => !!v);
      channels.push({
        name: integ.name,
        configured: hasConfig,
        connected: integ.is_connected && hasConfig,
      });
    }

    // Try to get live channel status from OpenClaw gateway
    try {
      const probe = require("child_process").execSync(
        "curl -s -m 3 http://127.0.0.1:18789/api/status 2>/dev/null || echo '{}'",
        { encoding: "utf8", timeout: 5000 }
      ).trim();
      const gwStatus = JSON.parse(probe || "{}");
      if (gwStatus.channels) {
        for (const ch of channels) {
          const gwCh = gwStatus.channels?.find((c: any) => c.name?.toLowerCase() === ch.name.toLowerCase());
          if (gwCh) {
            ch.connected = gwCh.connected ?? ch.connected;
            if (gwCh.error) ch.error = gwCh.error;
            if (gwCh.lastMessage) ch.lastMessage = gwCh.lastMessage;
          }
        }
      }
    } catch { /* gateway not running — use DB status only */ }

    res.json({ channels, gatewayRunning: false }); // Will be true when gateway probe succeeds
  });

  // ── API Documentation (OpenAPI) ─────────────────────

  app.get("/api/docs", (_req, res) => {
    res.json({
      openapi: "3.0.3",
      info: {
        title: "Mission Control API",
        version: "1.2.0",
        description: "REST API for managing AI agents, tasks, projects, schedules, reports, and analytics. Integrates with OpenClaw via MCP.",
      },
      servers: [{ url: "/api", description: "Current server" }],
      paths: {
        "/agents": {
          get: { summary: "List all agents", tags: ["Agents"], responses: { "200": { description: "Array of agents" } } },
          post: { summary: "Create an agent", tags: ["Agents"], requestBody: { content: { "application/json": { schema: { type: "object", required: ["name", "role"], properties: { name: { type: "string" }, role: { type: "string" }, soul: { type: "string" }, skills: { type: "array", items: { type: "string" } } } } } } }, responses: { "201": { description: "Created agent" } } },
        },
        "/agents/{id}": {
          get: { summary: "Get agent detail", tags: ["Agents"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Agent with tasks, schedules, reports" } } },
          patch: { summary: "Update agent", tags: ["Agents"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Updated agent" } } },
        },
        "/tasks": {
          get: { summary: "List all tasks", tags: ["Tasks"], responses: { "200": { description: "Array of tasks" } } },
          post: { summary: "Create a task", tags: ["Tasks"], requestBody: { content: { "application/json": { schema: { type: "object", required: ["title"], properties: { title: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["backlog", "doing", "done"] }, priority: { type: "string", enum: ["low", "medium", "high", "critical"] }, agent_id: { type: "integer" } } } } } }, responses: { "201": { description: "Created task" } } },
        },
        "/tasks/{id}": {
          patch: { summary: "Update a task", tags: ["Tasks"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Updated task" } } },
          delete: { summary: "Delete a task", tags: ["Tasks"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Deleted" } } },
        },
        "/schedules": {
          get: { summary: "List all schedules", tags: ["Schedules"], responses: { "200": { description: "Array of schedules" } } },
          post: { summary: "Create a schedule", tags: ["Schedules"], responses: { "201": { description: "Created schedule" } } },
        },
        "/reports": {
          get: { summary: "List reports", tags: ["Reports"], parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "type", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Array of reports" } } },
          post: { summary: "Create a report", tags: ["Reports"], responses: { "201": { description: "Created report" } } },
        },
        "/approvals": {
          get: { summary: "List approval requests", tags: ["Approvals"], parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected"] } }], responses: { "200": { description: "Array of approvals" } } },
          post: { summary: "Create approval request", tags: ["Approvals"], requestBody: { content: { "application/json": { schema: { type: "object", required: ["title", "action_type"], properties: { title: { type: "string" }, description: { type: "string" }, action_type: { type: "string", enum: ["file_delete", "external_api", "agent_create", "schedule_modify", "cost_exceed", "custom"] }, agent_id: { type: "integer" } } } } } }, responses: { "201": { description: "Created approval" } } },
        },
        "/approvals/{id}/decide": {
          post: { summary: "Approve or reject a request", tags: ["Approvals"], requestBody: { content: { "application/json": { schema: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["approved", "rejected"] } } } } } }, responses: { "200": { description: "Updated approval" } } },
        },
        "/analytics/costs": {
          get: { summary: "Get cost analytics", tags: ["Analytics"], parameters: [{ name: "period", in: "query", schema: { type: "string", enum: ["today", "week", "month", "all"] } }], responses: { "200": { description: "Cost analytics with trends" } } },
        },
        "/activity": {
          get: { summary: "Get activity log", tags: ["Activity"], parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }, { name: "agentId", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Array of activity events" } } },
        },
        "/openclaw/files": {
          get: { summary: "List OpenClaw bootstrap files", tags: ["OpenClaw Files"], parameters: [{ name: "agent", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Available files" } } },
        },
        "/openclaw/files/{filename}": {
          get: { summary: "Read a bootstrap file", tags: ["OpenClaw Files"], responses: { "200": { description: "File content" } } },
          put: { summary: "Write a bootstrap file", tags: ["OpenClaw Files"], requestBody: { content: { "application/json": { schema: { type: "object", required: ["content"], properties: { content: { type: "string" } } } } } }, responses: { "200": { description: "File written" } } },
        },
        "/mcp": {
          post: { summary: "MCP JSON-RPC endpoint (CEO agent tools)", tags: ["MCP"], description: "JSON-RPC 2.0 endpoint for Model Context Protocol. Tools: mc_create_agent, mc_list_agents, mc_update_soul, mc_append_skill, mc_create_task, mc_schedule_task, mc_get_token_usage, mc_log_activity, mc_memory_write, mc_memory_search, mc_delegate_task, mc_request_approval", responses: { "200": { description: "JSON-RPC response" } } },
        },
        "/search": {
          get: { summary: "Global search across tasks, reports, schedules", tags: ["Search"], parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Search results" } } },
        },
      },
      tags: [
        { name: "Agents", description: "AI agent management" },
        { name: "Tasks", description: "Task board management" },
        { name: "Schedules", description: "Cron-based scheduling" },
        { name: "Reports", description: "Agent-generated reports" },
        { name: "Approvals", description: "Human approval queue" },
        { name: "Analytics", description: "Token spend and cost analytics" },
        { name: "Activity", description: "Event timeline" },
        { name: "OpenClaw Files", description: "Bootstrap file editor (SOUL.md, etc.)" },
        { name: "MCP", description: "Model Context Protocol for CEO agent" },
        { name: "Search", description: "Global search" },
      ],
    });
  });

  // ── Approval Queue ──────────────────────────────────

  app.get("/api/approvals", async (req, res) => {
    const status = req.query.status as string | undefined;
    const approvals = await storage.getApprovals(status);
    res.json(approvals);
  });

  app.get("/api/approvals/count", async (_req, res) => {
    const count = await storage.getPendingApprovalCount();
    res.json({ pending: count });
  });

  app.post("/api/approvals", async (req, res) => {
    try {
      const { insertApprovalSchema } = await import("@shared/schema");
      const data = insertApprovalSchema.parse(req.body);
      const approval = await storage.createApproval(data);
      await storage.logActivity("note", `Approval requested: ${approval.title}`, approval.agent_id, null, { approval_id: approval.id, action_type: approval.action_type });
      res.status(201).json(approval);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/approvals/:id/decide", async (req, res) => {
    const { decision } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be 'approved' or 'rejected'" });
    }

    const decidedBy = req.session?.email || "admin";
    const approval = await storage.decideApproval(parseInt(req.params.id), decision, decidedBy);
    if (!approval) return res.status(404).json({ message: "Approval not found or already decided" });
    await storage.logActivity("note", `Approval ${decision}: ${approval.title} (by ${decidedBy})`, approval.agent_id, null, { approval_id: approval.id, decision });
    res.json(approval);
  });

  // ── Search ──────────────────────────────────────────
  app.get("/api/search", async (req, res) => {
    const q = (req.query.q as string) || "";
    if (!q.trim()) return res.json({ tasks: [], reports: [], schedules: [] });
    const results = await storage.search(q);
    res.json(results);
  });

  // ── Setup Wizard ──────────────────────────────────────

  // Check if setup is complete
  app.get("/api/setup/status", async (_req, res) => {
    const settings = await storage.getSettings();
    const setupComplete = settings.find(s => s.setting_key === "setup_complete");
    res.json({
      isSetupComplete: setupComplete?.setting_value === true || setupComplete?.setting_value === "true",
    });
  });

  // Pre-seed agents + schedules + tasks when user selects preset and clicks Next
  // Runs during wizard navigation so data is ready before Launch
  app.post("/api/setup/pre-seed", async (req, res) => {
    const { preset } = req.body;
    if (!preset) return res.json({ ok: false });
    try {
      // Reuse the same preset definitions from setup/complete
      const PRESET_AGENTS: Record<string, { name: string; role: string; id: string; color: string; skills: string[] }[]> = {
        business: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Competitive Research", "Executive Reporting", "Decision Making"] },
          { name: "Operations", role: "Process Management & Optimization", id: "ops", color: "#8b5cf6", skills: ["Model Routing", "Cost Optimization", "Task Triage", "Process Monitoring"] },
          { name: "Accountant", role: "Financial Analysis & Reporting", id: "accountant", color: "#f59e0b", skills: ["Financial Analysis", "Budget Monitoring", "Cost Tracking", "P&L Reporting"] },
          { name: "Market Intelligence", role: "Market Research & Competitive Analysis", id: "intel", color: "#3b82f6", skills: ["Competitor Analysis", "Market Research", "Trend Monitoring", "SWOT Analysis"] },
          { name: "Customer Success", role: "Client Relations & Satisfaction", id: "support", color: "#ec4899", skills: ["Client Relations", "Onboarding", "Issue Resolution", "Retention Analysis"] },
          { name: "Marketing", role: "Brand Strategy & Content Creation", id: "marketing", color: "#10b981", skills: ["Brand Strategy", "Content Creation", "SEO", "Campaign Analytics", "Social Media"] },
        ],
        development: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "Project Manager", role: "Sprint Planning & Delivery", id: "pm", color: "#8b5cf6", skills: ["Sprint Planning", "Task Breakdown", "Risk Management"] },
          { name: "Frontend Dev", role: "UI/UX Implementation", id: "frontend", color: "#3b82f6", skills: ["React", "TypeScript", "CSS", "Performance"] },
          { name: "Backend Dev", role: "API & Database Development", id: "backend", color: "#10b981", skills: ["Node.js", "SQL", "API Design", "Security"] },
          { name: "QA Engineer", role: "Testing & Quality Assurance", id: "qa", color: "#f59e0b", skills: ["Test Planning", "Automation", "Bug Triage"] },
          { name: "DevOps", role: "Infrastructure & Deployment", id: "devops", color: "#ef4444", skills: ["Docker", "CI/CD", "Monitoring", "Server Management"] },
        ],
        seo: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "SEO Strategist", role: "Keyword Research & On-Page Optimization", id: "seo", color: "#3b82f6", skills: ["Keyword Research", "On-Page SEO", "Technical Audit", "SERP Analysis"] },
          { name: "Content Writer", role: "SEO Content Creation & Optimization", id: "content", color: "#8b5cf6", skills: ["SEO Writing", "Blog Posts", "Meta Descriptions"] },
          { name: "Market Intelligence", role: "Market Research & Competitive Analysis", id: "intel", color: "#f59e0b", skills: ["Competitor Analysis", "Market Research", "Trend Monitoring"] },
        ],
        social: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "Social Media Manager", role: "Content Scheduling & Engagement", id: "social", color: "#ec4899", skills: ["Content Creation", "Post Scheduling", "Engagement Analysis"] },
          { name: "Creative Director", role: "Campaign Design & Brand Voice", id: "creative", color: "#8b5cf6", skills: ["Campaign Design", "Visual Concepts", "Brand Guidelines"] },
          { name: "Marketing", role: "Brand Strategy & Content Creation", id: "marketing", color: "#10b981", skills: ["Brand Strategy", "Content Creation", "SEO", "Email Marketing"] },
        ],
      };
      const agents = PRESET_AGENTS[preset] || PRESET_AGENTS.business;
      await storage.query("DELETE FROM agents");
      for (const a of agents) {
        await storage.createAgent({ name: a.name, role: a.role, avatar_color: a.color, openclaw_id: a.id, skills: a.skills });
      }
      console.log(`[pre-seed] Created ${agents.length} agents for "${preset}"`);
      res.json({ ok: true, count: agents.length });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Launch progress — reports what's been seeded so the UI can show real status
  app.get("/api/setup/launch-status", async (_req, res) => {
    try {
      const [agents] = await storage.query("SELECT COUNT(*) as cnt FROM agents") as any[];
      const [schedules] = await storage.query("SELECT COUNT(*) as cnt FROM schedules") as any[];
      const [tasks] = await storage.query("SELECT COUNT(*) as cnt FROM tasks") as any[];
      const [approvals] = await storage.query("SELECT COUNT(*) as cnt FROM approval_queue") as any[];

      const agentCount = parseInt(agents?.cnt || "0");
      const scheduleCount = parseInt(schedules?.cnt || "0");
      const taskCount = parseInt(tasks?.cnt || "0");
      const approvalCount = parseInt(approvals?.cnt || "0");

      // Check if admin credentials are set in settings
      const settings = await storage.getSettings();
      const adminReady = !!settings.find(s => s.setting_key === "admin_email")?.setting_value;

      const steps = [
        { name: "Agents created", done: agentCount > 0, count: agentCount },
        { name: "Schedules created", done: scheduleCount > 0, count: scheduleCount },
        { name: "Tasks created", done: taskCount > 0, count: taskCount },
        { name: "Approvals ready", done: true, count: approvalCount },
        { name: "Admin account ready", done: adminReady, count: adminReady ? 1 : 0 },
      ];

      const allDone = steps.every(s => s.done);
      res.json({ steps, allDone, summary: `${steps.filter(s => s.done).length}/${steps.length} complete` });
    } catch {
      res.json({ steps: [], allDone: false, summary: "Starting..." });
    }
  });

  // Server info for Domain & SSL step
  app.get("/api/setup/server-info", async (_req, res) => {
    const interfaces = os.networkInterfaces();
    let ip = "127.0.0.1";
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          ip = addr.address;
          break;
        }
      }
    }
    res.json({
      ip,
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
    });
  });

  // Auto-detect OpenClaw installation — scan ~/.openclaw/ for agents, API keys, gateway config
  app.get("/api/setup/detect-openclaw", async (_req, res) => {
    const clawDir = OPENCLAW_HOME;
    const result: {
      installed: boolean;
      version: string | null;
      workspacePath: string | null;
      agents: { id: string; hasSoul: boolean; name?: string }[];
      providers: { provider: string; hasKey: boolean }[];
      gatewayToken: string | null;
      gatewayUrl: string;
    } = {
      installed: false,
      version: null,
      workspacePath: null,
      agents: [],
      providers: [],
      gatewayToken: null,
      gatewayUrl: "http://127.0.0.1:18789",
    };

    if (!existsSync(clawDir)) {
      return res.json(result);
    }
    result.installed = true;
    result.workspacePath = join(clawDir, "workspace");

    // Get version
    try {
      const ver = require("child_process").execSync("openclaw --version", { encoding: "utf8", timeout: 5000 }).trim();
      const match = ver.match(/(\d+\.\d+\.\d+)/);
      result.version = match ? match[1] : ver;
    } catch { /* not in PATH */ }

    // Scan agents
    const agentsDir = join(clawDir, "agents");
    if (existsSync(agentsDir)) {
      try {
        const dirs = require("fs").readdirSync(agentsDir, { withFileTypes: true });
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const agent: { id: string; hasSoul: boolean; name?: string } = { id: d.name, hasSoul: false };
          // Check for SOUL.md in multiple locations
          for (const soulPath of [
            join(agentsDir, d.name, "agent", "workspace", "SOUL.md"),
            join(agentsDir, d.name, "SOUL.md"),
            join(clawDir, "workspace", "SOUL.md"),
          ]) {
            if (existsSync(soulPath)) {
              agent.hasSoul = true;
              try {
                const content = readFileSync(soulPath, "utf8");
                const h1 = content.match(/^#\s+(.+)/m);
                if (h1) agent.name = h1[1].replace(/[—–-].*$/, "").trim();
              } catch { /* skip */ }
              break;
            }
          }
          result.agents.push(agent);
        }
      } catch { /* skip */ }
    }

    // Scan auth-profiles.json for existing API keys
    const authPaths = [
      join(agentsDir, "main", "agent", "auth-profiles.json"),
      join(clawDir, "workspace", "auth-profiles.json"),
    ];
    for (const ap of authPaths) {
      if (existsSync(ap)) {
        try {
          const data = JSON.parse(readFileSync(ap, "utf8"));
          if (data.profiles) {
            for (const [, profile] of Object.entries(data.profiles) as any) {
              if (profile.provider && profile.key) {
                result.providers.push({ provider: profile.provider, hasKey: true });
              }
            }
          }
        } catch { /* skip */ }
        break;
      }
    }

    // Read gateway token from config
    const configPath = join(clawDir, "openclaw.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        if (config.gateway?.auth?.token) result.gatewayToken = config.gateway.auth.token;
        if (config.gateway?.port) result.gatewayUrl = `http://127.0.0.1:${config.gateway.port}`;
      } catch { /* skip */ }
    }

    res.json(result);
  });

  // Test DB connection (used by direct-install wizard path; PHP installs skip this)
  app.post("/api/setup/test-db", async (req, res) => {
    const { host, port, user, password, database } = req.body;
    try {
      const mysql = await import("mysql2/promise");
      const conn = await mysql.createConnection({
        host: host || "localhost",
        port: port || 3306,
        user,
        password,
        database,
        connectTimeout: 5000,
      });
      const [rows] = await conn.execute("SELECT VERSION() AS v") as any;
      await conn.end();
      const ver: string = rows[0]?.v ?? "";
      const detectedType = ver.toLowerCase().includes("mariadb") ? "mariadb" : "mysql";
      res.json({ success: true, message: `Connected — ${ver}`, detectedType });
    } catch (err: any) {
      res.json({ success: false, message: err.message });
    }
  });

  // Test AI model API key
  app.post("/api/setup/test-model", async (req, res) => {
    const { provider, apiKey, endpoint } = req.body;
    const testStart = Date.now();
    try {
      switch (provider) {
        case "anthropic": {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
          });
          if (r.ok || r.status === 400) return res.json({ success: true, message: "Anthropic API key valid" });
          return res.json({ success: false, message: `Anthropic rejected key (${r.status})` });
        }
        case "openai": {
          const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.ok) return res.json({ success: true, message: "OpenAI API key valid" });
          return res.json({ success: false, message: `OpenAI rejected key (${r.status})` });
        }
        case "google": {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
          if (r.ok) return res.json({ success: true, message: "Google API key valid" });
          return res.json({ success: false, message: `Google rejected key (${r.status})` });
        }
        case "xai": {
          const r = await fetch("https://api.x.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.ok) return res.json({ success: true, message: "xAI API key valid" });
          return res.json({ success: false, message: `xAI rejected key (${r.status})` });
        }
        case "perplexity": {
          const r = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
          });
          if (r.ok || r.status === 400) return res.json({ success: true, message: "Perplexity API key valid" });
          return res.json({ success: false, message: `Perplexity rejected key (${r.status})` });
        }
        case "ollama": {
          const url = endpoint || "http://localhost:11434";
          const r = await fetch(`${url}/api/tags`);
          if (r.ok) {
            const data = await r.json() as any;
            const count = data.models?.length || 0;
            return res.json({ success: true, message: `Ollama connected — ${count} model(s) available` });
          }
          return res.json({ success: false, message: "Could not reach Ollama" });
        }
        case "openrouter": {
          // Use /auth/key endpoint (lightweight) instead of /models (downloads 300+ model catalog)
          const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            const label = data.data?.label || "valid";
            return res.json({ success: true, message: `OpenRouter connected — key: ${label}` });
          }
          // Fallback: try /models if /auth/key doesn't exist
          if (r.status === 404) {
            const r2 = await fetch("https://openrouter.ai/api/v1/models", {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (r2.ok) return res.json({ success: true, message: "OpenRouter connected" });
            return res.json({ success: false, message: `OpenRouter rejected key (${r2.status})` });
          }
          return res.json({ success: false, message: `OpenRouter rejected key (${r.status})` });
        }
        case "custom": {
          // Generic OpenAI-compatible endpoint — hit /models to verify key + connectivity
          const base = (endpoint || "").replace(/\/$/, "");
          if (!base) return res.json({ success: false, message: "Endpoint URL is required for custom providers" });
          const r = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.ok) return res.json({ success: true, message: `Connected to ${base}` });
          // Some providers return 401 on /models but still accept the key for completions
          if (r.status === 401) return res.json({ success: false, message: "API key rejected (401)" });
          // Treat other non-5xx as "key accepted, endpoint works"
          if (r.status < 500) return res.json({ success: true, message: `Connected to ${base} (${r.status})` });
          return res.json({ success: false, message: `Server error from ${base} (${r.status})` });
        }
        default:
          return res.json({ success: false, message: `Unknown provider: ${provider}` });
      }
    } catch (err: any) {
      res.json({ success: false, message: err.message || "Connection test failed" });
    } finally {
      console.log(`[test-model] ${provider} test took ${Date.now() - testStart}ms`);
    }
  });

  // Test integration connection (chat providers, email, productivity, etc.)
  // Lives under /api/setup/ so it bypasses auth — same as /api/setup/test-model
  app.post("/api/setup/test-integration", async (req, res) => {
    const { integration, config } = req.body;
    try {
      switch (integration) {
        // ── Chat Providers ──────────────────────────────────
        case "discord": {
          // Test via webhook URL (sends nothing — just validates the URL) or bot token
          if (config.webhook_url) {
            const r = await fetch(config.webhook_url, { method: "GET" });
            // Discord webhooks return 200 with webhook info on GET
            if (r.ok) return res.json({ success: true, message: "Discord webhook valid" });
            return res.json({ success: false, message: `Discord webhook returned ${r.status}` });
          }
          if (config.bot_token) {
            const r = await fetch("https://discord.com/api/v10/users/@me", {
              headers: { Authorization: `Bot ${config.bot_token}` },
            });
            if (r.ok) {
              const data = await r.json() as any;
              return res.json({ success: true, message: `Discord bot connected: ${data.username}#${data.discriminator}` });
            }
            return res.json({ success: false, message: `Discord bot token rejected (${r.status})` });
          }
          return res.json({ success: false, message: "Provide a bot token or webhook URL" });
        }
        case "slack": {
          if (!config.bot_token) return res.json({ success: false, message: "Bot token required" });
          const r = await fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: { Authorization: `Bearer ${config.bot_token}`, "content-type": "application/json" },
          });
          if (r.ok) {
            const data = await r.json() as any;
            if (data.ok) return res.json({ success: true, message: `Slack connected: ${data.team} (${data.user})` });
            return res.json({ success: false, message: `Slack error: ${data.error}` });
          }
          return res.json({ success: false, message: `Slack API returned ${r.status}` });
        }
        case "telegram": {
          if (!config.bot_token) return res.json({ success: false, message: "Bot token required" });
          const r = await fetch(`https://api.telegram.org/bot${config.bot_token}/getMe`);
          if (r.ok) {
            const data = await r.json() as any;
            if (data.ok) return res.json({ success: true, message: `Telegram bot connected: @${data.result.username}` });
          }
          return res.json({ success: false, message: "Telegram bot token invalid" });
        }
        case "whatsapp": {
          if (!config.access_token || !config.phone_number_id) return res.json({ success: false, message: "Access token and Phone Number ID required" });
          const r = await fetch(`https://graph.facebook.com/v18.0/${config.phone_number_id}`, {
            headers: { Authorization: `Bearer ${config.access_token}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `WhatsApp connected: ${data.display_phone_number || config.phone_number_id}` });
          }
          return res.json({ success: false, message: `WhatsApp API returned ${r.status} — check token & Phone Number ID` });
        }

        // ── Email & Social ──────────────────────────────────
        case "gmail": {
          if (!config.client_id || !config.client_secret || !config.refresh_token) {
            return res.json({ success: false, message: "Client ID, Client Secret, and Refresh Token required" });
          }
          // Exchange refresh token for access token to validate credentials
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: config.client_id,
              client_secret: config.client_secret,
              refresh_token: config.refresh_token,
              grant_type: "refresh_token",
            }),
          });
          if (r.ok) {
            const tokens = await r.json() as any;
            // Use the access token to get user email
            const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (profile.ok) {
              const data = await profile.json() as any;
              return res.json({ success: true, message: `Gmail connected: ${data.emailAddress}` });
            }
            return res.json({ success: true, message: "Gmail OAuth valid (could not fetch profile)" });
          }
          const err = await r.json() as any;
          return res.json({ success: false, message: `Gmail OAuth failed: ${err.error_description || err.error || r.status}` });
        }
        case "twitter": {
          if (!config.bearer_token) return res.json({ success: false, message: "Bearer token required" });
          const r = await fetch("https://api.twitter.com/2/users/me", {
            headers: { Authorization: `Bearer ${config.bearer_token}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Twitter/X connected: @${data.data?.username}` });
          }
          return res.json({ success: false, message: `Twitter/X API returned ${r.status}` });
        }

        // ── Productivity ────────────────────────────────────
        case "notion": {
          if (!config.api_key) return res.json({ success: false, message: "Integration token required" });
          const r = await fetch("https://api.notion.com/v1/users/me", {
            headers: { Authorization: `Bearer ${config.api_key}`, "Notion-Version": "2022-06-28" },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Notion connected: ${data.name || "workspace accessible"}` });
          }
          return res.json({ success: false, message: `Notion rejected token (${r.status})` });
        }
        case "trello": {
          if (!config.api_key || !config.token) return res.json({ success: false, message: "API Key and Token required" });
          const r = await fetch(`https://api.trello.com/1/members/me?key=${config.api_key}&token=${config.token}`);
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Trello connected: ${data.fullName || data.username}` });
          }
          return res.json({ success: false, message: `Trello rejected credentials (${r.status})` });
        }
        case "github": {
          const token = config.pat;
          if (!token) return res.json({ success: false, message: "Personal Access Token required" });
          const r = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "MissionControl/1.0" },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `GitHub connected: ${data.login}` });
          }
          return res.json({ success: false, message: `GitHub rejected token (${r.status})` });
        }

        // ── Search ──────────────────────────────────────────
        case "brave": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
            headers: { "X-Subscription-Token": config.api_key, Accept: "application/json" },
          });
          if (r.ok) return res.json({ success: true, message: "Brave Search API key valid" });
          return res.json({ success: false, message: `Brave Search rejected key (${r.status})` });
        }
        case "serp": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch(`https://serpapi.com/account.json?api_key=${config.api_key}`);
          if (r.ok) return res.json({ success: true, message: "SerpAPI key valid" });
          return res.json({ success: false, message: `SerpAPI rejected key (${r.status})` });
        }

        // ── Data Storage ────────────────────────────────────
        case "google_drive": {
          if (!config.client_id || !config.client_secret || !config.refresh_token) {
            return res.json({ success: false, message: "Client ID, Client Secret, and Refresh Token required" });
          }
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: config.client_id,
              client_secret: config.client_secret,
              refresh_token: config.refresh_token,
              grant_type: "refresh_token",
            }),
          });
          if (r.ok) return res.json({ success: true, message: "Google Drive OAuth valid" });
          const err2 = await r.json() as any;
          return res.json({ success: false, message: `Google Drive OAuth failed: ${err2.error_description || r.status}` });
        }
        case "dropbox": {
          if (!config.access_token) return res.json({ success: false, message: "Access token required" });
          const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
            method: "POST",
            headers: { Authorization: `Bearer ${config.access_token}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Dropbox connected: ${data.name?.display_name || "account accessible"}` });
          }
          return res.json({ success: false, message: `Dropbox rejected token (${r.status})` });
        }
        case "supabase": {
          if (!config.url || !config.anon_key) return res.json({ success: false, message: "Project URL and Anon Key required" });
          const base = config.url.replace(/\/$/, "");
          const r = await fetch(`${base}/rest/v1/`, {
            headers: { apikey: config.anon_key, Authorization: `Bearer ${config.anon_key}` },
          });
          if (r.ok || r.status === 200) return res.json({ success: true, message: "Supabase connected" });
          return res.json({ success: false, message: `Supabase returned ${r.status}` });
        }
        case "airtable": {
          if (!config.api_key) return res.json({ success: false, message: "Personal Access Token required" });
          const r = await fetch("https://api.airtable.com/v0/meta/whoami", {
            headers: { Authorization: `Bearer ${config.api_key}` },
          });
          if (r.ok) return res.json({ success: true, message: "Airtable token valid" });
          return res.json({ success: false, message: `Airtable rejected token (${r.status})` });
        }

        // ── Smart Home ──────────────────────────────────────
        case "home_assistant": {
          if (!config.url || !config.access_token) return res.json({ success: false, message: "URL and access token required" });
          const base = config.url.replace(/\/$/, "");
          const r = await fetch(`${base}/api/`, {
            headers: { Authorization: `Bearer ${config.access_token}` },
          });
          if (r.ok) return res.json({ success: true, message: "Home Assistant connected" });
          return res.json({ success: false, message: `Home Assistant returned ${r.status}` });
        }

        // ── Music ───────────────────────────────────────────
        case "spotify": {
          if (!config.client_id || !config.client_secret || !config.refresh_token) {
            return res.json({ success: false, message: "Client ID, Client Secret, and Refresh Token required" });
          }
          const basic = Buffer.from(`${config.client_id}:${config.client_secret}`).toString("base64");
          const r = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { Authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refresh_token }),
          });
          if (r.ok) return res.json({ success: true, message: "Spotify OAuth valid" });
          return res.json({ success: false, message: `Spotify OAuth failed (${r.status})` });
        }

        // ── Voice & Speech ──────────────────────────────────
        case "elevenlabs": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch("https://api.elevenlabs.io/v1/user", {
            headers: { "xi-api-key": config.api_key },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `ElevenLabs connected: ${data.subscription?.tier || "valid"}` });
          }
          return res.json({ success: false, message: `ElevenLabs rejected key (${r.status})` });
        }

        // ── Memory & Knowledge ──────────────────────────────
        case "qdrant": {
          if (!config.url) return res.json({ success: false, message: "Qdrant URL required" });
          const base = config.url.replace(/\/$/, "");
          const headers: Record<string, string> = {};
          if (config.api_key) headers["api-key"] = config.api_key;
          const r = await fetch(`${base}/healthz`, { headers });
          if (r.ok) return res.json({ success: true, message: "Qdrant connected" });
          return res.json({ success: false, message: `Qdrant returned ${r.status}` });
        }
        case "chroma": {
          const host = config.host || "localhost";
          const port = config.port || "8000";
          const r = await fetch(`http://${host}:${port}/api/v1/heartbeat`);
          if (r.ok) return res.json({ success: true, message: "Chroma connected" });
          return res.json({ success: false, message: "Could not reach Chroma" });
        }
        case "pinecone": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch("https://api.pinecone.io/indexes", {
            headers: { "Api-Key": config.api_key },
          });
          if (r.ok) {
            const data = await r.json() as any;
            const count = data.indexes?.length || 0;
            return res.json({ success: true, message: `Pinecone connected — ${count} index(es)` });
          }
          return res.json({ success: false, message: `Pinecone rejected key (${r.status})` });
        }

        // ── Calendar ────────────────────────────────────────
        case "google_calendar": {
          if (!config.client_id || !config.client_secret || !config.refresh_token) {
            return res.json({ success: false, message: "Client ID, Client Secret, and Refresh Token required" });
          }
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: config.client_id,
              client_secret: config.client_secret,
              refresh_token: config.refresh_token,
              grant_type: "refresh_token",
            }),
          });
          if (r.ok) return res.json({ success: true, message: "Google Calendar OAuth valid" });
          const err3 = await r.json() as any;
          return res.json({ success: false, message: `Google Calendar OAuth failed: ${err3.error_description || r.status}` });
        }

        // ── Dev Tools ───────────────────────────────────────
        case "vercel": {
          if (!config.access_token) return res.json({ success: false, message: "Access token required" });
          const r = await fetch("https://api.vercel.com/v2/user", {
            headers: { Authorization: `Bearer ${config.access_token}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Vercel connected: ${data.user?.username || "valid"}` });
          }
          return res.json({ success: false, message: `Vercel rejected token (${r.status})` });
        }
        case "github_actions": {
          if (!config.pat) return res.json({ success: false, message: "Personal Access Token required" });
          const r = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${config.pat}`, "User-Agent": "MissionControl/1.0" },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `GitHub Actions connected: ${data.login}` });
          }
          return res.json({ success: false, message: `GitHub rejected token (${r.status})` });
        }
        case "grafana": {
          if (!config.url || !config.api_key) return res.json({ success: false, message: "URL and API key required" });
          const base = config.url.replace(/\/$/, "");
          const r = await fetch(`${base}/api/org`, {
            headers: { Authorization: `Bearer ${config.api_key}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `Grafana connected: ${data.name || "org accessible"}` });
          }
          return res.json({ success: false, message: `Grafana returned ${r.status}` });
        }
        case "wordpress": {
          if (!config.site_url || !config.username || !config.app_password) {
            return res.json({ success: false, message: "Site URL, username, and app password required" });
          }
          const base = config.site_url.replace(/\/$/, "");
          const basic = Buffer.from(`${config.username}:${config.app_password}`).toString("base64");
          const r = await fetch(`${base}/wp-json/wp/v2/users/me`, {
            headers: { Authorization: `Basic ${basic}` },
          });
          if (r.ok) {
            const data = await r.json() as any;
            return res.json({ success: true, message: `WordPress connected: ${data.name || data.slug}` });
          }
          return res.json({ success: false, message: `WordPress returned ${r.status}` });
        }
        case "portainer": {
          if (!config.portainer_url || !config.api_key) return res.json({ success: false, message: "Portainer URL and API key required" });
          const base = config.portainer_url.replace(/\/$/, "");
          const r = await fetch(`${base}/api/users/admin/check`, {
            headers: { "X-API-Key": config.api_key },
          });
          // Portainer returns 204 if admin exists, regardless of auth
          // Instead try /api/status which is open, or /api/endpoints with key
          const r2 = await fetch(`${base}/api/endpoints`, {
            headers: { "X-API-Key": config.api_key },
          });
          if (r2.ok) return res.json({ success: true, message: "Portainer connected" });
          return res.json({ success: false, message: `Portainer returned ${r2.status}` });
        }

        // ── Finance ─────────────────────────────────────────
        case "alpha_vantage": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=${config.api_key}&datatype=json`);
          if (r.ok) {
            const data = await r.json() as any;
            if (data["Error Message"] || data["Note"]) return res.json({ success: false, message: data["Error Message"] || "Rate limited — key may be valid" });
            return res.json({ success: true, message: "Alpha Vantage API key valid" });
          }
          return res.json({ success: false, message: `Alpha Vantage returned ${r.status}` });
        }

        // ── Weather ─────────────────────────────────────────
        case "weather": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${config.api_key}`);
          if (r.ok) return res.json({ success: true, message: "OpenWeatherMap API key valid" });
          return res.json({ success: false, message: `OpenWeatherMap rejected key (${r.status})` });
        }

        // ── Maps ────────────────────────────────────────────
        case "google_maps": {
          if (!config.api_key) return res.json({ success: false, message: "API Key required" });
          const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${config.api_key}`);
          if (r.ok) {
            const data = await r.json() as any;
            if (data.status === "REQUEST_DENIED") return res.json({ success: false, message: "Google Maps API key denied — check API restrictions" });
            return res.json({ success: true, message: "Google Maps API key valid" });
          }
          return res.json({ success: false, message: `Google Maps returned ${r.status}` });
        }

        // ── Media ───────────────────────────────────────────
        case "giphy": {
          if (!config.giphy_api_key) return res.json({ success: false, message: "Giphy API Key required" });
          const r = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${config.giphy_api_key}&limit=1`);
          if (r.ok) return res.json({ success: true, message: "Giphy API key valid" });
          return res.json({ success: false, message: `Giphy rejected key (${r.status})` });
        }

        default:
          return res.json({ success: false, message: `No test available for: ${integration}` });
      }
    } catch (err: any) {
      res.json({ success: false, message: err.message || "Connection test failed" });
    }
  });

  // Complete setup
  app.post("/api/setup/complete", async (req, res) => {
    const { admin, models, chatProviders, agentPreset, domain, licenseKey, database } = req.body;

    try {
      // If the wizard collected DB credentials (direct install, not PHP path),
      // write them to .env so the app can reconnect on restart.
      if (database) {
        const { existsSync, readFileSync, writeFileSync } = await import("fs");
        const envPath = new URL("../../.env", import.meta.url).pathname;
        const envLines = existsSync(envPath)
          ? readFileSync(envPath, "utf8").split("\n").filter(l => !l.startsWith("DB_"))
          : [];
        if (database.type === "sqlite") {
          envLines.push(`DB_TYPE=sqlite`);
        } else {
          envLines.push(
            `DB_HOST=${database.host || "localhost"}`,
            `DB_PORT=${database.port || 3306}`,
            `DB_NAME=${database.name}`,
            `DB_USER=${database.user}`,
            `DB_PASSWORD=${database.password}`,
            `DB_TYPE=${database.type || "mariadb"}`,
          );
        }
        writeFileSync(envPath, envLines.join("\n") + "\n");
        await storage.updateSetting("db_type", database.type || "mariadb");
      }

      // Store admin info
      const passwordHash = crypto.createHash("sha256").update(admin.password + "_mc_salt").digest("hex");
      await storage.updateSetting("admin_name", admin.fullName);
      await storage.updateSetting("admin_email", admin.email);
      await storage.updateSetting("admin_password_hash", passwordHash);

      // Store license key
      if (licenseKey) {
        await storage.updateSetting("license_key", String(licenseKey));
      }

      // Store AI model configs — pass object directly; updateSetting handles serialization
      if (models) {
        await storage.updateSetting("ai_models", models);
      }

      // Store chat provider configs — same: no pre-stringify, updateSetting serializes
      if (chatProviders) {
        await storage.updateSetting("chat_providers", chatProviders);
      }

      // Store domain config — guard every field against undefined
      if (domain) {
        await storage.updateSetting("domain", domain.domainName || "");
        await storage.updateSetting("auto_ssl", String(domain.autoSsl ?? true));
        await storage.updateSetting("http_port", String(domain.httpPort || 80));
        await storage.updateSetting("https_port", String(domain.httpsPort || 443));
      }

      // Store agent preset + mark complete + respond IMMEDIATELY
      await storage.updateSetting("agent_preset", agentPreset || "business");
      await storage.updateSetting("setup_complete", true);
      await storage.updateSetting("setup_completed_at", new Date().toISOString());
      try { writeFileSync(resolve(process.cwd(), ".installed"), new Date().toISOString(), "utf8"); } catch {}
      if (domain?.domainName) {
        await storage.updateSetting("public_url", `${domain.autoSsl !== false ? "https" : "http"}://${domain.domainName}`);
      }
      await storage.logActivity("agent_status_change", "Mission Control setup completed");

      // RESPOND NOW — browser gets the green light immediately
      res.json({ success: true });

      // Break out of request handler — detached setTimeout so HTTP response is fully flushed
      const _preset = agentPreset || "business";
      const _models = models;
      const _domain = domain;
      setTimeout(async () => { try {

      // Create agents if not already pre-seeded by /api/setup/pre-seed
      const existingAgents = await storage.getAgents();
      const alreadySeeded = existingAgents.length > 0;
      if (alreadySeeded) {
        console.log(`[setup] Agents already pre-seeded (${existingAgents.length} agents) — skipping creation`);
      }
      // Only create if not pre-seeded
      const PRESET_AGENTS: Record<string, { name: string; role: string; id: string; color: string; skills: string[] }[]> = {
        business: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Competitive Research", "Executive Reporting", "Decision Making"] },
          { name: "Operations", role: "Process Management & Optimization", id: "ops", color: "#8b5cf6", skills: ["Model Routing", "Cost Optimization", "Task Triage", "Process Monitoring"] },
          { name: "Accountant", role: "Financial Analysis & Reporting", id: "accountant", color: "#f59e0b", skills: ["Financial Analysis", "Budget Monitoring", "Cost Tracking", "P&L Reporting"] },
          { name: "Market Intelligence", role: "Market Research & Competitive Analysis", id: "intel", color: "#3b82f6", skills: ["Competitor Analysis", "Market Research", "Trend Monitoring", "SWOT Analysis"] },
          { name: "Customer Success", role: "Client Relations & Satisfaction", id: "support", color: "#ec4899", skills: ["Client Relations", "Onboarding", "Issue Resolution", "Retention Analysis"] },
          { name: "Marketing", role: "Brand Strategy & Content Creation", id: "marketing", color: "#10b981", skills: ["Brand Strategy", "Content Creation", "SEO", "Campaign Analytics", "Social Media"] },
        ],
        development: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "Project Manager", role: "Sprint Planning & Delivery", id: "pm", color: "#8b5cf6", skills: ["Sprint Planning", "Task Breakdown", "Risk Management", "Stakeholder Updates"] },
          { name: "Frontend Dev", role: "UI/UX Implementation", id: "frontend", color: "#3b82f6", skills: ["React", "TypeScript", "CSS", "Accessibility", "Performance"] },
          { name: "Backend Dev", role: "API & Database Development", id: "backend", color: "#10b981", skills: ["Node.js", "SQL", "API Design", "Security", "Scaling"] },
          { name: "QA Engineer", role: "Testing & Quality Assurance", id: "qa", color: "#f59e0b", skills: ["Test Planning", "Automation", "Bug Triage", "Regression Testing"] },
          { name: "DevOps", role: "Infrastructure & Deployment", id: "devops", color: "#ef4444", skills: ["Docker", "CI/CD", "Monitoring", "Server Management"] },
        ],
        seo: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "SEO Strategist", role: "Keyword Research & On-Page Optimization", id: "seo", color: "#3b82f6", skills: ["Keyword Research", "On-Page SEO", "Technical Audit", "Content Strategy", "SERP Analysis"] },
          { name: "Content Writer", role: "SEO Content Creation & Optimization", id: "content", color: "#8b5cf6", skills: ["SEO Writing", "Blog Posts", "Meta Descriptions", "Content Optimization"] },
          { name: "Market Intelligence", role: "Market Research & Competitive Analysis", id: "intel", color: "#f59e0b", skills: ["Competitor Analysis", "Market Research", "Trend Monitoring"] },
        ],
        social: [
          { name: "CEO", role: "Strategic Oversight & Decision Making", id: "main", color: "#0d9488", skills: ["Strategic Planning", "Decision Making"] },
          { name: "Social Media Manager", role: "Content Scheduling & Engagement", id: "social", color: "#ec4899", skills: ["Content Creation", "Post Scheduling", "Engagement Analysis", "Hashtag Strategy"] },
          { name: "Creative Director", role: "Campaign Design & Brand Voice", id: "creative", color: "#8b5cf6", skills: ["Campaign Design", "Visual Concepts", "Brand Guidelines", "A/B Testing"] },
          { name: "Marketing", role: "Brand Strategy & Content Creation", id: "marketing", color: "#10b981", skills: ["Brand Strategy", "Content Creation", "SEO", "Email Marketing"] },
        ],
      };

      const targetAgents = PRESET_AGENTS[_preset] || PRESET_AGENTS.business;

      if (!alreadySeeded) {
        await storage.query("DELETE FROM agents");
        for (const a of targetAgents) {
          await storage.createAgent({
            name: a.name, role: a.role, avatar_color: a.color,
            openclaw_id: a.id, skills: a.skills,
          });
        }
        console.log(`[setup] Created ${targetAgents.length} agents for "${_preset}" preset`);
      }

      // Create preset-matched schedules — wipe migration seeds, create fresh
      await storage.query("DELETE FROM schedules");
      const createdAgents = await storage.getAgents();
      const agentByName = (name: string) => createdAgents.find(a => a.name === name)?.id || null;

      const PRESET_SCHEDULES: Record<string, { name: string; desc: string; cron: string; time: string; days: string[]; agentName: string; type: string }[]> = {
        business: [
          { name: "Daily Revenue Summary", desc: "Generate daily revenue breakdown", cron: "0 13 * * 1,2,3,4,5", time: "08:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Accountant", type: "reporting" },
          { name: "Inbox Triage", desc: "Process and categorize incoming communications", cron: "30 13 * * 1,2,3,4,5", time: "08:30", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Operations", type: "general" },
          { name: "Competitor Scout", desc: "Scan competitor activity and pricing", cron: "0 18 * * 2,4", time: "13:00", days: ["Tue","Thu"], agentName: "Market Intelligence", type: "research" },
          { name: "End-of-Day Summary", desc: "Compile executive summary", cron: "0 22 * * 1,2,3,4,5", time: "17:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "CEO", type: "reporting" },
        ],
        development: [
          { name: "Daily Standup Digest", desc: "Summarize open PRs, blockers, and sprint progress", cron: "0 14 * * 1,2,3,4,5", time: "09:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Project Manager", type: "reporting" },
          { name: "Code Review Queue", desc: "Check for pending code reviews and assign reviewers", cron: "0 15 * * 1,2,3,4,5", time: "10:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Backend Dev", type: "monitoring" },
          { name: "QA Test Run", desc: "Run automated test suite and report failures", cron: "0 18 * * 1,2,3,4,5", time: "13:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "QA Engineer", type: "monitoring" },
          { name: "Sprint Retrospective Prep", desc: "Compile sprint metrics and improvement notes", cron: "0 21 * * 5", time: "16:00", days: ["Fri"], agentName: "Project Manager", type: "reporting" },
        ],
        seo: [
          { name: "Daily SERP Check", desc: "Monitor keyword rankings and position changes", cron: "0 14 * * 1,2,3,4,5", time: "09:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "SEO Strategist", type: "monitoring" },
          { name: "Content Publishing", desc: "Review and publish scheduled content", cron: "0 15 * * 1,3,5", time: "10:00", days: ["Mon","Wed","Fri"], agentName: "Content Writer", type: "outreach" },
          { name: "Weekly SEO Report", desc: "Compile traffic, rankings, and backlink analysis", cron: "0 14 * * 1", time: "09:00", days: ["Mon"], agentName: "SEO Strategist", type: "reporting" },
          { name: "Competitor Keyword Scan", desc: "Analyze competitor keyword movements", cron: "0 18 * * 2,4", time: "13:00", days: ["Tue","Thu"], agentName: "Market Intelligence", type: "research" },
        ],
        social: [
          { name: "Daily Post Queue", desc: "Schedule and publish today's social media posts", cron: "0 13 * * 1,2,3,4,5", time: "08:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Social Media Manager", type: "outreach" },
          { name: "Engagement Check", desc: "Review comments, mentions, and DMs across platforms", cron: "0 17 * * 1,2,3,4,5", time: "12:00", days: ["Mon","Tue","Wed","Thu","Fri"], agentName: "Social Media Manager", type: "monitoring" },
          { name: "Weekly Content Batch", desc: "Create next week's content batch with Creative Director", cron: "0 15 * * 5", time: "10:00", days: ["Fri"], agentName: "Creative Director", type: "general" },
          { name: "Monthly Analytics Report", desc: "Compile engagement, follower growth, and ROI metrics", cron: "0 15 1 * *", time: "10:00", days: ["Mon"], agentName: "Marketing", type: "reporting" },
        ],
      };

      const schedSeed = PRESET_SCHEDULES[_preset] || PRESET_SCHEDULES.business;
      for (const s of schedSeed) {
        await storage.createSchedule({
          name: s.name, description: s.desc, cron_expression: s.cron,
          time: s.time, days: s.days, agent_id: agentByName(s.agentName),
          task_type: s.type as any, is_enabled: true, priority: "medium",
          on_failure: "notify_only", max_retries: 3, timeout_minutes: 60,
        });
      }
      console.log(`[setup] Created ${schedSeed.length} schedules for "${_preset}" preset`);

      // Create preset-matched sample tasks
      await storage.query("DELETE FROM tasks");
      const PRESET_TASKS: Record<string, { title: string; desc: string; agentName: string; priority: string }[]> = {
        business: [
          { title: "Review Q1 Revenue Targets", desc: "Analyze Q1 revenue against targets and identify gaps", agentName: "CEO", priority: "high" },
          { title: "Optimize Shipping Pipeline", desc: "Review and optimize order fulfillment process", agentName: "Operations", priority: "medium" },
          { title: "Quarterly Board Presentation", desc: "Prepare quarterly board presentation with key metrics", agentName: "CEO", priority: "high" },
        ],
        development: [
          { title: "Set up CI/CD pipeline", desc: "Configure automated testing and deployment pipeline", agentName: "DevOps", priority: "high" },
          { title: "API documentation", desc: "Document all REST endpoints with examples", agentName: "Backend Dev", priority: "medium" },
          { title: "Performance audit", desc: "Profile and optimize slow page loads", agentName: "Frontend Dev", priority: "medium" },
        ],
        seo: [
          { title: "Initial keyword research", desc: "Research and compile target keywords with search volume and difficulty", agentName: "SEO Strategist", priority: "high" },
          { title: "Technical SEO audit", desc: "Crawl site for broken links, missing meta tags, slow pages", agentName: "SEO Strategist", priority: "high" },
          { title: "Content calendar creation", desc: "Build 30-day content calendar targeting researched keywords", agentName: "Content Writer", priority: "medium" },
        ],
        social: [
          { title: "Brand voice document", desc: "Define tone, style, vocabulary, and platform guidelines", agentName: "Creative Director", priority: "high" },
          { title: "Content pillar strategy", desc: "Define 4-6 content pillars aligned with brand and audience", agentName: "Social Media Manager", priority: "high" },
          { title: "Engagement audit", desc: "Review follower growth, engagement rates, best-performing posts", agentName: "Marketing", priority: "medium" },
        ],
      };

      const taskSeed = PRESET_TASKS[_preset] || PRESET_TASKS.business;
      for (const t of taskSeed) {
        await storage.createTask({
          title: t.title, description: t.desc,
          agent_id: agentByName(t.agentName), priority: t.priority as any,
          status: "backlog",
        });
      }
      console.log(`[setup] Created ${taskSeed.length} tasks for "${_preset}" preset`);

      // Create sample approvals so the user sees the feature in action
      const ceoId = agentByName("CEO");
      await storage.createApproval({
        agent_id: ceoId,
        action_type: "external_api",
        title: "Example: Send weekly report via email",
        description: "This is a sample approval request to demonstrate the approval queue. You can approve, reject, or delete this example.",
        expires_at: null,
      });
      await storage.createApproval({
        agent_id: agentByName(targetAgents[1]?.name || "Operations"),
        action_type: "file_delete",
        title: "Example: Clean up temporary files",
        description: "This is a sample approval to show how agents request permission before taking irreversible actions. Safe to discard.",
        expires_at: null,
      });
      console.log("[setup] Created 2 sample approvals");

      // Lock OpenClaw gateway to loopback
      if (_domain?.domainName) lockOpenClawToLoopback();

      // Install/update OpenClaw — spawn detached
        const cwd = process.cwd();
        const nodeBin = process.execPath.replace(/\/node$/, "");
        const spawnEnv = { ...openclawEnv(), PATH: `${nodeBin}:${process.env.PATH}` };

        const { spawn: spawnChild } = require("child_process");
        const child = spawnChild("npm", ["run", "install-openclaw"], { cwd, env: spawnEnv, stdio: "ignore", detached: true });
        child.unref(); // Don't block Node event loop

        child.on("close", (code: number) => {
          if (code !== 0) console.error("[setup] install-openclaw exited with code", code);
          else console.log("[setup] install-openclaw completed");

          // Wire AI provider + register agents AFTER openclaw finishes
          try { wireOpenClawProvider(_models); } catch (err: any) { console.error("[setup] wireOpenClawProvider failed:", err.message); }

          (async () => {
            try {
              const allAgents = await storage.getAgents();
              for (const agent of allAgents) {
                if (!agent.openclaw_id || agent.openclaw_id === "main") continue;
                const result = await addOpenClawAgent(agent.openclaw_id, agent.soul || null);
                if (result.ok) console.log(`[setup] Registered OpenClaw agent: ${agent.openclaw_id}`);
                else console.warn(`[setup] Failed to register agent ${agent.openclaw_id}: ${result.error}`);
              }
            } catch (err: any) { console.error("[setup] Agent registration failed:", err.message); }
          })();

          // Deploy MC skill so the CEO can call MC's tools immediately
          try {
            deployMCSkill(parseInt(process.env.PORT || "5000"));
          } catch (err: any) {
            console.error("[setup] deployMCSkill failed:", err.message);
          }
        }); // end child.on("close")

      } catch (bgErr: any) { console.error("[setup] Background setup error:", bgErr.message); }
      }, 100); // end detached setTimeout

    } catch (err: any) {
      console.error("Setup error:", err);
      if (!res.headersSent) res.status(500).json({ success: false, message: err.message || "Setup failed" });
    }
  });

  // ── OpenClaw Integration ─────────────────────────────

  // Ping the local OpenClaw gateway + return live agent list
  app.get("/api/system/openclaw/status", async (_req, res) => {
    const status = await getOpenClawStatus();
    res.json(status);
  });

  // Read gateway token from ~/.openclaw/openclaw.json and save to MC settings.
  // Called by setup wizard after OpenClaw is onboarded.
  app.post("/api/system/openclaw/token-read", async (_req, res) => {
    try {
      const { existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const configPath = OPENCLAW_CONFIG;

      if (!existsSync(configPath)) {
        return res.json({ ok: false, message: "openclaw.json not found — is OpenClaw installed and onboarded?" });
      }

      const raw = readFileSync(configPath, "utf8");
      let token: string | null = null;
      try {
        const parsed = JSON.parse(raw);
        token = parsed?.gateway?.auth?.token ?? null;
      } catch { /* JSON5 */ }
      if (!token) {
        const match = raw.match(/"token"\s*:\s*"([^"]+)"/);
        token = match ? match[1] : null;
      }
      if (!token && process.env.OPENCLAW_GATEWAY_TOKEN) {
        token = process.env.OPENCLAW_GATEWAY_TOKEN;
      }

      if (!token) {
        return res.json({ ok: false, message: "No token found in openclaw.json. Check gateway.auth.token." });
      }

      await storage.updateSetting("openclaw_gateway_token", token);
      await storage.updateSetting("openclaw_gateway_url", "http://127.0.0.1:18789");
      res.json({ ok: true, message: "Token saved to Mission Control settings." });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // ── OpenClaw Channel Management ────────────────────────

  // List pending pairing requests (Discord, Telegram, etc.)
  app.get("/api/system/openclaw/pairing", async (_req, res) => {
    try {
      const raw = execSync("openclaw pairing list --json", { timeout: 5000, env: openclawEnv() }).toString().trim();
      const data = JSON.parse(raw);
      res.json(data);
    } catch (err: any) {
      // If no pairing requests or command fails, return empty
      res.json({ channel: "discord", requests: [] });
    }
  });

  // Approve a pairing request
  app.post("/api/system/openclaw/pairing/approve", async (req, res) => {
    const { channel, code } = req.body;
    if (!channel || !code) return res.status(400).json({ ok: false, message: "Channel and code required" });
    try {
      const result = execSync(
        `openclaw pairing approve ${channel} ${code} --notify`,
        { timeout: 10000, env: openclawEnv() }
      ).toString().trim();
      res.json({ ok: true, message: result || `Approved ${channel} pairing ${code}` });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.stderr?.toString() || err.message || "Pairing approval failed" });
    }
  });

  // Add or update an OpenClaw channel (called when MC saves chat integration creds)
  app.post("/api/system/openclaw/channel", async (req, res) => {
    const { channel, token, account } = req.body;
    if (!channel || !token) return res.status(400).json({ ok: false, message: "Channel and token required" });
    try {
      const acctFlag = account ? ` --account ${account}` : "";
      execSync(
        `openclaw channels add --channel ${channel} --token '${token}'${acctFlag}`,
        { timeout: 10000, env: openclawEnv() }
      );
      res.json({ ok: true, message: `${channel} channel configured in OpenClaw` });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.stderr?.toString() || err.message || "Channel add failed" });
    }
  });

  // Get OpenClaw channel status
  app.get("/api/system/openclaw/channels", async (_req, res) => {
    try {
      const raw = execSync("openclaw channels list --json", { timeout: 5000, env: openclawEnv() }).toString().trim();
      const data = JSON.parse(raw);
      res.json(data);
    } catch (err: any) {
      // Fallback: try non-json and parse manually
      try {
        const raw = execSync("openclaw channels list", { timeout: 5000, env: openclawEnv() }).toString().trim();
        res.json({ raw, channels: [] });
      } catch {
        res.json({ channels: [] });
      }
    }
  });

  // ── OpenClaw Bootstrap Files (SOUL.md, IDENTITY.md, etc.) ──

  const ALLOWED_BOOTSTRAP_FILES = ["SOUL.md", "AGENTS.md", "HEARTBEAT.md", "IDENTITY.md", "TOOLS.md", "USER.md", "MEMORY.md"];

  // List available bootstrap files for the workspace or a specific agent
  app.get("/api/openclaw/files", async (req, res) => {
    const agentId = req.query.agent as string | undefined; // openclaw agent id like "main", "ops"
    const sharedWs = OPENCLAW_WORKSPACE;
    const basePath = agentId
      ? join(OPENCLAW_AGENTS_DIR, agentId, "agent", "workspace")
      : sharedWs;

    // Search agent-specific paths first, then shared workspace as fallback
    const searchPaths = agentId
      ? [basePath, join(OPENCLAW_AGENTS_DIR, agentId), sharedWs]
      : [sharedWs];

    const files: { name: string; path: string; size: number; modified: string }[] = [];
    for (const f of ALLOWED_BOOTSTRAP_FILES) {
      for (const dir of searchPaths) {
        const fp = join(dir, f);
        if (existsSync(fp)) {
          try {
            const stat = require("fs").statSync(fp);
            files.push({ name: f, path: fp, size: stat.size, modified: stat.mtime.toISOString() });
          } catch { /* skip */ }
          break; // Don't list same file from both paths
        }
      }
    }
    res.json({ basePath, files });
  });

  // Read a specific bootstrap file
  app.get("/api/openclaw/files/:filename", async (req, res) => {
    const filename = req.params.filename;
    if (!ALLOWED_BOOTSTRAP_FILES.includes(filename)) {
      return res.status(400).json({ message: `File not allowed: ${filename}` });
    }

    const agentId = req.query.agent as string | undefined;

    // Search in multiple possible locations
    const candidates = [
      agentId ? join(OPENCLAW_AGENTS_DIR, agentId, "agent", "workspace", filename) : null,
      agentId ? join(OPENCLAW_AGENTS_DIR, agentId, filename) : null,
      join(OPENCLAW_WORKSPACE, filename),
    ].filter(Boolean) as string[];

    for (const fp of candidates) {
      if (existsSync(fp)) {
        try {
          const content = readFileSync(fp, "utf8");
          return res.json({ filename, content, path: fp });
        } catch (err: any) {
          return res.status(500).json({ message: `Failed to read: ${err.message}` });
        }
      }
    }
    res.json({ filename, content: "", path: null }); // File doesn't exist yet — return empty
  });

  // Write a bootstrap file (OpenClaw First — writes to filesystem, then logs)
  app.put("/api/openclaw/files/:filename", async (req, res) => {
    const filename = req.params.filename;
    if (!ALLOWED_BOOTSTRAP_FILES.includes(filename)) {
      return res.status(400).json({ message: `File not allowed: ${filename}` });
    }

    const { content } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ message: "Content must be a string" });
    }

    const agentId = (req.query.agent as string) || null;

    // Determine write path
    let writePath: string;
    if (agentId) {
      const agentWs = join(OPENCLAW_AGENTS_DIR, agentId, "agent", "workspace");
      if (existsSync(agentWs)) {
        writePath = join(agentWs, filename);
      } else {
        const agentDir = join(OPENCLAW_AGENTS_DIR, agentId);
        if (existsSync(agentDir)) {
          writePath = join(agentDir, filename);
        } else {
          return res.status(404).json({ message: `Agent directory not found: ${agentId}` });
        }
      }
    } else {
      writePath = join(OPENCLAW_WORKSPACE, filename);
    }

    try {
      writeFileSync(writePath, content, "utf8");
      await storage.logActivity("note", `Updated OpenClaw file: ${filename}${agentId ? ` (agent: ${agentId})` : ""}`, null, null, { filename, agent: agentId });
      res.json({ ok: true, path: writePath });
    } catch (err: any) {
      res.status(500).json({ message: `Failed to write: ${err.message}` });
    }
  });

  // ── OpenClaw agent sync — shared logic ─────────────────
  // Called by the endpoint below AND by the startup scan.
  // Scans ~/.openclaw/agents/, imports new agents (reading SOUL.md for name/role),
  // marks gone agents offline.
  async function runOpenClawAgentSync(): Promise<{ added: string[]; wentOffline: string[] }> {
    const agentsDir = OPENCLAW_AGENTS_DIR;
    const added: string[] = [];
    const wentOffline: string[] = [];

    if (!existsSync(agentsDir)) return { added, wentOffline };

    const { readdirSync } = await import("fs");
    const mcAgents = await storage.getAgents();
    // Build lookup that handles both prefixed ("openclaw/main") and bare ("main") ids
    const mcByOpenclawId = new Map<string, typeof mcAgents[0]>();
    for (const a of mcAgents) {
      if (!a.openclaw_id) continue;
      mcByOpenclawId.set(a.openclaw_id, a);
      // Also index bare name so "main" matches against live id "openclaw/main"
      const bare = a.openclaw_id.replace(/^openclaw\//, "");
      if (bare !== a.openclaw_id) mcByOpenclawId.set(bare, a);
    }

    // Skip agent dirs whose name looks like a file artifact or internal placeholder
    const SKIP_NAMES = new Set(["workspace", "skills", "memory", ".git", "openclaw", "openclaw-main", "main"]);

    // Discover directories in ~/.openclaw/agents/
    const liveIds = new Set<string>();
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentName  = entry.name;
      if (SKIP_NAMES.has(agentName)) continue;

      const openclawId = `openclaw/${agentName}`;
      liveIds.add(openclawId);
      liveIds.add(agentName); // so bare-id DB records also match

      // Already known under either form — skip creation but we may update status below
      if (mcByOpenclawId.has(openclawId) || mcByOpenclawId.has(agentName)) continue;

      // New agent — read SOUL.md for display name and role
      let displayName = agentName.charAt(0).toUpperCase() + agentName.slice(1);
      let role        = "OpenClaw agent";
      let soul: string | null = null;

      for (const soulPath of [
        join(agentsDir, agentName, "agent", "workspace", "SOUL.md"),
        join(agentsDir, agentName, "SOUL.md"),
      ]) {
        if (existsSync(soulPath)) {
          soul = readFileSync(soulPath, "utf8");
          const h1 = soul.match(/^#\s+(.+)/m);
          const firstLine = soul.split("\n").map(l => l.trim()).filter(Boolean)
            .find((l, i, a) => i > a.findIndex(x => x.startsWith("# ")) && !l.startsWith("#") && !l.startsWith("---"));
          // Reject obviously meta H1 headings like "SOUL.md - Who You Are"
          if (h1 && !/soul\.md|who you are|template/i.test(h1[1])) displayName = h1[1].trim();
          if (firstLine && !/soul\.md|who you are|template/i.test(firstLine)) {
            role = firstLine.replace(/^\*+|\*+$/g, "").trim().slice(0, 120);
          }
          break;
        }
      }

      await storage.createAgent({
        name: displayName, role,
        avatar_color: "#8b5cf6",
        agent_type: "dynamic",
        openclaw_id: openclawId,
        soul, skills: [], model_config: null,
      });
      added.push(openclawId);
      console.log(`[agent-sync] Auto-imported: ${openclawId} → "${displayName}"`);
      await storage.logActivity("agent_created", `Auto-imported from OpenClaw: ${displayName} (${agentName})`);
    }

    // Mark agents that have disappeared from OpenClaw as offline
    // Only applies to dynamic (auto-imported) agents — permanent roster agents are
    // always available and should never be auto-set offline by sync.
    for (const [key, agent] of mcByOpenclawId) {
      if (key.startsWith("openclaw/")) continue; // handled via bare key to avoid double-marking
      if (agent.agent_type === "permanent") continue; // never auto-offline permanent agents
      if (!liveIds.has(key) && !liveIds.has(`openclaw/${key}`)) {
        await storage.updateAgentStatus(agent.id, "offline", null);
        wentOffline.push(key);
      }
    }

    await storage.updateSetting("openclaw_last_sync", new Date().toISOString());
    return { added, wentOffline };
  }

  // Sync endpoint — called by the frontend on page load and after key events
  // (chat reply, agent create/save). No background timer needed.
  app.post("/api/system/openclaw/sync", async (_req, res) => {
    try {
      const result = await runOpenClawAgentSync();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // ── System Version & Update ──────────────────────────
  app.get("/api/system/version", async (_req, res) => {
    try {
      // Read installed version from package.json
      const pkgPath = resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const currentVersion = pkg.version || "1.0.0";

      // Get current git commit hash for reference
      let gitCommit = "unknown";
      let hasGit = false;
      try {
        gitCommit = execSync("git rev-parse --short HEAD", { cwd: process.cwd() }).toString().trim();
        hasGit = true;
      } catch {}

      // Check GitHub for latest version — try releases API first, fallback to raw package.json
      let latestVersion: string | null = null;
      let updateAvailable = false;
      let releaseUrl: string | null = null;
      let versionCheckNote: string | null = null;
      try {
        const ghRepo = process.env.GITHUB_REPO || "chad-1964/mission-control";
        const ghToken = process.env.GITHUB_TOKEN;
        const headers: Record<string, string> = { "User-Agent": "mission-control-updater" };
        if (ghToken) headers["Authorization"] = `Bearer ${ghToken}`;

        // 1) Try releases API
        const relResp = await fetch(`https://api.github.com/repos/${ghRepo}/releases/latest`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (relResp.ok) {
          const release = await relResp.json() as any;
          latestVersion = (release.tag_name || "").replace(/^v/, "");
          releaseUrl = release.html_url || null;
          updateAvailable = !!latestVersion && latestVersion !== currentVersion;
        } else if (relResp.status === 404) {
          // No releases published yet — try raw package.json on main branch
          const rawResp = await fetch(`https://raw.githubusercontent.com/${ghRepo}/main/package.json`, {
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (rawResp.ok) {
            const rawPkg = await rawResp.json() as any;
            latestVersion = (rawPkg.version || "").replace(/^v/, "") || null;
            updateAvailable = !!latestVersion && latestVersion !== currentVersion;
            versionCheckNote = "Latest from main branch (no release published yet)";
          } else {
            versionCheckNote = rawResp.status === 404 ? "Repository not found" : "No releases published yet";
          }
        } else if (relResp.status === 403) {
          versionCheckNote = "GitHub auth required — set GITHUB_TOKEN in .env";
        } else {
          versionCheckNote = "Unable to reach GitHub";
        }
      } catch {
        versionCheckNote = "Unable to reach GitHub";
      }

      // Get installed OpenClaw version — read from config file, fall back to CLI
      // Never call `npm view openclaw version` here: it's a blocking network call (5-10s)
      let openclawVersion: string | null = null;
      try {
        const configPath = OPENCLAW_CONFIG;
        if (existsSync(configPath)) {
          const cfg = JSON.parse(readFileSync(configPath, "utf8"));
          const v = cfg?.meta?.lastTouchedVersion;
          if (v && typeof v === "string") openclawVersion = v;
        }
        if (!openclawVersion) {
          const raw = execSync("openclaw --version", { timeout: 3000, env: openclawEnv() }).toString().trim();
          const match = raw.match(/(\d{4}\.\d+\.\d+(?:[.\-][^\s]*)?)/);
          openclawVersion = match ? match[1] : raw || null;
        }
      } catch { /* openclaw not installed */ }

      // Skip live npm registry check — too slow for a hot path. Report current = latest.
      const openclawLatest: string | null = openclawVersion;
      const openclawUpdateAvailable = false;

      res.json({
        currentVersion,
        latestVersion,
        updateAvailable,
        gitCommit,
        hasGit,
        releaseUrl,
        versionCheckNote,
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()}`,
        openclawVersion,
        openclawLatest,
        openclawUpdateAvailable,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // One-click OpenClaw update — installs latest from npm, re-reads gateway token
  app.post("/api/system/update-openclaw", async (_req, res) => {
    try {
      res.json({ success: true, message: "OpenClaw update started — will complete in ~30 seconds" });
      setTimeout(() => {
        try {
          const cwd = process.cwd();
          const nodeBin = process.execPath.replace(/\/node$/, "");
          const env = { ...openclawEnv(), PATH: `${nodeBin}:${process.env.PATH}` };
          execSync("npm run install-openclaw", { cwd, env, stdio: "inherit", timeout: 120000 });
          console.log("[update-openclaw] Complete");
        } catch (err: any) {
          console.error("[update-openclaw] Failed:", err.message);
        }
      }, 200);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Trigger an in-place update: git pull → npm install → build → restart via PM2
  // Protected by a simple token check (admin_password_hash from settings)
  app.post("/api/system/update", async (req, res) => {
    try {
      const { confirmToken } = req.body;
      const stored = await storage.getSettings();
      const hashEntry = stored.find(s => s.setting_key === "admin_password_hash");
      if (!hashEntry || hashEntry.setting_value !== confirmToken) {
        return res.status(403).json({ success: false, message: "Invalid confirmation token" });
      }

      // Run update in background — respond immediately so the client doesn't hang
      res.json({ success: true, message: "Update started — app will restart in ~30 seconds" });

      setTimeout(() => {
        try {
          const cwd = process.cwd();
          const nodeBin = process.execPath.replace(/\/node$/, "");
          const env = { ...openclawEnv(), PATH: `${nodeBin}:${process.env.PATH}` };
          execSync("git pull origin main", { cwd, env, stdio: "inherit" });
          execSync("npm install --production=false", { cwd, env, stdio: "inherit" });
          // Always run migrate so new tables/columns from the update are applied
          execSync("npm run migrate", { cwd, env, stdio: "inherit" });
          execSync("npm run build", { cwd, env, stdio: "inherit" });
          // PM2 restart — picks up new dist/index.cjs
          execSync("pm2 restart mission-control", { cwd, env, stdio: "inherit" });
        } catch (err: any) {
          console.error("[update] Failed:", err.message);
        }
      }, 500);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── OpenClaw Config Diagnostics (admin-only) ────────────
  // Shows what config files OpenClaw has on disk so we can verify wiring
  // without needing SSH. API keys are masked.
  app.get("/api/debug/openclaw-config", async (req, res) => {
    const ocDir = OPENCLAW_HOME;
    const agentDir = join(ocDir, "agents", "main", "agent");

    function readJsonMasked(filePath: string): { exists: boolean; data?: any; error?: string } {
      if (!existsSync(filePath)) return { exists: false };
      try {
        const raw = readFileSync(filePath, "utf8");
        const data = JSON.parse(raw);
        // Mask any API keys
        const masked = JSON.parse(JSON.stringify(data, (k, v) => {
          if (typeof v === "string" && (k === "key" || k === "apiKey" || k === "token") && v.length > 8) {
            return v.slice(0, 6) + "..." + v.slice(-4);
          }
          return v;
        }));
        return { exists: true, data: masked };
      } catch (err: any) {
        return { exists: true, error: err.message };
      }
    }

    res.json({
      home,
      ocDir: existsSync(ocDir) ? "exists" : "MISSING",
      agentDir: existsSync(agentDir) ? "exists" : "MISSING",
      openclaw_json:    readJsonMasked(join(ocDir, "openclaw.json")),
      auth_profiles:    readJsonMasked(join(agentDir, "auth-profiles.json")),
      models_json:      readJsonMasked(join(agentDir, "models.json")),
    });
  });

  // Self-heal on startup: if OpenClaw is installed but auth-profiles.json is
  // missing, re-wire from DB settings. This handles the race where OpenClaw
  // finishes installing after setup/complete ran on first boot.
  (async () => {
    try {
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      const perAgentAuthProfiles = join(OPENCLAW_AGENTS_DIR, "main", "agent", "auth-profiles.json");
      if (existsSync(OPENCLAW_HOME) && !existsSync(perAgentAuthProfiles)) {
        const allSettings = await storage.getSettings();
        const aiSetting = allSettings.find(s => s.setting_key === "ai_models");
        if (aiSetting?.setting_value) {
          wireOpenClawProvider(aiSetting.setting_value);
          console.log("[startup] wired OpenClaw provider (auth-profiles.json was missing)");
        }
      }
    } catch (err: any) {
      console.warn("[startup] wireOpenClawProvider self-heal skipped:", err.message);
    }
  })();

  // ── MC Tools — CEO agent API (localhost-only, called via skill + web_fetch) ──
  // These endpoints let the CEO create agents, tasks, schedules, and log activity
  // directly from chat. Auth: localhost IP check only — CEO runs on same server.

  // MC tools are called by the CEO via exec+curl. The CEO always passes
  // X-MC-Internal: 1. IP-based checks fail behind proxies, so we use the header.
  function requireMCInternal(req: Request, res: Response, next: NextFunction) {
    if (req.headers["x-mc-internal"] === "1") return next();
    // Also allow direct localhost (for debugging / future gateway use)
    const ip = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    if (ip === "127.0.0.1" || ip === "::1") return next();
    return res.status(403).json({ error: "MC tools require X-MC-Internal header" });
  }

  // Create agent — CEO calls this to create a persistent named agent
  app.post("/api/tools/create-agent", requireMCInternal, async (req, res) => {
    try {
      const { name, role, soul, skills: agentSkills } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });

      const openclawId = `openclaw/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

      // Create in MC DB
      const agent = await storage.createAgent({
        name: name.trim(),
        role: role?.trim() || "AI Agent",
        avatar_color: "#8b5cf6",
        agent_type: "dynamic",
        openclaw_id: openclawId,
        soul: soul || null,
        skills: Array.isArray(agentSkills) ? agentSkills : [],
        model_config: null,
      });

      // Register in OpenClaw filesystem
      await addOpenClawAgent(openclawId.replace("openclaw/", ""), soul || null);

      await storage.logActivity("agent_created", `CEO created agent: ${name}`, agent.id);

      res.json({ ok: true, agent: { id: agent.id, name: agent.name, openclaw_id: openclawId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // List agents
  app.get("/api/tools/agents", requireMCInternal, async (_req, res) => {
    try {
      const agents = await storage.getAgents();
      res.json(agents.map(a => ({
        id: a.id, name: a.name, role: a.role,
        status: a.status, openclaw_id: a.openclaw_id,
      })));
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Update soul
  app.patch("/api/tools/update-soul", requireMCInternal, async (req, res) => {
    try {
      const { agentId, soul } = req.body;
      if (!agentId) return res.status(400).json({ error: "agentId required" });
      const agent = await storage.updateAgent(agentId, { soul: soul || null });
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      // Also deploy to OpenClaw workspace
      if (agent.openclaw_id && soul) {
        await deployAgentSoul(agent.openclaw_id.replace("openclaw/", ""), soul);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Append skill
  app.post("/api/tools/append-skill", requireMCInternal, async (req, res) => {
    try {
      const { agentId, skill } = req.body;
      if (!agentId || !skill) return res.status(400).json({ error: "agentId and skill required" });
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      const merged = [...new Set([...(agent.skills ?? []), skill])];
      await storage.updateAgent(agentId, { skills: merged });
      res.json({ ok: true, skills: merged });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Create task
  app.post("/api/tools/create-task", requireMCInternal, async (req, res) => {
    try {
      const { title, agentId, description, priority, status } = req.body;
      if (!title?.trim()) return res.status(400).json({ error: "title required" });
      const task = await storage.createTask({
        title: title.trim(),
        agent_id: agentId || null,
        description: description || null,
        priority: priority || "medium",
        status: status || "backlog",
      });
      if (task.status === "doing" && task.agent_id) {
        runTaskWithAgent(task.id).catch(e => console.warn("[task] exec error:", e.message));
      }
      await storage.logActivity("task_created", `CEO created task: ${title}`, agentId, task.id);
      res.json({ ok: true, task: { id: task.id, title: task.title, status: task.status } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Schedule recurring task
  app.post("/api/tools/schedule-task", requireMCInternal, async (req, res) => {
    try {
      const { name, agentId, cron, description, taskType } = req.body;
      if (!name?.trim() || !cron?.trim()) return res.status(400).json({ error: "name and cron required" });

      // Parse cron to human-readable time (best effort)
      const [min, hour] = cron.split(" ");
      const timeStr = (hour !== "*" && min !== "*") ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : "00:00";

      const schedule = await storage.createSchedule({
        name: name.trim(),
        description: description || null,
        cron_expression: cron.trim(),
        time: timeStr,
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        agent_id: agentId || null,
        task_type: taskType || "general",
        is_enabled: true,
        priority: "medium",
        on_failure: "notify_only",
        max_retries: 3,
        timeout_minutes: 60,
        notify_on_failure: true,
      });

      await storage.logActivity("schedule_created", `CEO scheduled: ${name} (${cron})`, agentId);
      res.json({ ok: true, schedule: { id: schedule.id, name: schedule.name, cron: schedule.cron_expression } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Token usage
  app.get("/api/tools/token-usage", requireMCInternal, async (req, res) => {
    try {
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string) : undefined;
      const period  = (req.query.period as string) || "month";

      const allCosts = await storage.getCostEntries();
      const costs = agentId ? allCosts.filter((c: any) => c.agent_id === agentId) : allCosts;

      const now = Date.now();
      const periodMs: Record<string, number> = {
        day: 86400000, week: 604800000, month: 2592000000, all: Infinity,
      };
      const cutoff = now - (periodMs[period] ?? periodMs.month);

      const filtered = costs.filter((c: any) => new Date(c.created_at).getTime() >= cutoff);
      const total = filtered.reduce((acc: any, c: any) => ({
        input:    acc.input    + (c.prompt_tokens    || 0),
        output:   acc.output   + (c.completion_tokens || 0),
        cost_usd: acc.cost_usd + (c.cost_usd         || 0),
      }), { input: 0, output: 0, cost_usd: 0 });

      res.json({ ok: true, period, total, entries: filtered.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Log activity — maps unknown/CEO-invented event types to valid enum values
  const VALID_EVENT_TYPES = new Set([
    "task_created","task_moved","task_completed","task_deleted",
    "schedule_created","schedule_updated","schedule_fired",
    "report_generated","agent_status_change","agent_created",
    "note","memory_written",
  ]);
  app.post("/api/tools/log-activity", requireMCInternal, async (req, res) => {
    try {
      const { type, message, agentId } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: "message required" });
      const safeType = VALID_EVENT_TYPES.has(type) ? type : "note";
      await storage.logActivity(safeType, message.trim(), agentId || null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Memory write — stores in DB + appends to OpenClaw workspace memory file
  app.post("/api/tools/memory-write", requireMCInternal, async (req, res) => {
    try {
      const { key, value, agentId, tags } = req.body;
      if (!key?.trim() || !value?.trim()) return res.status(400).json({ error: "key and value required" });

      const mem = await storage.writeMemory({
        key: key.trim(),
        value: value.trim(),
        agent_id: agentId || null,
        tags: Array.isArray(tags) ? tags : [],
      });

      // Sync to OpenClaw workspace memory .md so native memory_search finds it
      try {
        const memDir = join(OPENCLAW_WORKSPACE, "memory");
        if (existsSync(OPENCLAW_WORKSPACE)) {
          mkdirSync(memDir, { recursive: true });
          const today = new Date().toISOString().split("T")[0];
          const mdPath = join(memDir, `${today}.md`);
          const tagLine = mem.tags.length ? ` [${mem.tags.join(", ")}]` : "";
          const entry = `\n## ${mem.key}${tagLine}\n\n${mem.value}\n`;
          appendFileSync(mdPath, entry, "utf8");
        }
      } catch { /* non-fatal — DB write already succeeded */ }

      await storage.logActivity("memory_written", `Memory saved: ${key.trim().slice(0, 80)}`, agentId || null);
      res.json({ ok: true, memory: mem });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Memory search
  app.get("/api/tools/memory-search", requireMCInternal, async (req, res) => {
    try {
      const { q, agentId } = req.query;
      if (!q?.toString().trim()) return res.status(400).json({ error: "q required" });
      const results = await storage.searchMemory(q.toString().trim(), agentId ? parseInt(agentId as string) : undefined);
      res.json({ ok: true, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── MCP Server endpoint ─────────────────────────────
  // Implements the Model Context Protocol (JSON-RPC 2.0) so OpenClaw's
  // gateway can register Mission Control as a native MCP tool provider.
  // Supports: initialize, tools/list, tools/call
  //
  // OpenClaw registration (done at startup below):
  //   openclaw mcp add mission-control http://localhost:<port>/api/mcp
  //
  // In --local mode the CEO gets tools via context injection (mc-skill.ts).
  // This endpoint powers gateway sessions where --local isn't used.

  const MCP_TOOLS = [
    {
      name: "mc_create_agent",
      description: "Create a new agent in Mission Control with a name, role, soul (personality), and skills.",
      inputSchema: {
        type: "object",
        properties: {
          name:   { type: "string", description: "Agent display name" },
          role:   { type: "string", description: "One-line role description" },
          soul:   { type: "string", description: "Full SOUL.md markdown personality" },
          skills: { type: "array", items: { type: "string" }, description: "Skill tags" },
        },
        required: ["name", "role"],
      },
    },
    {
      name: "mc_list_agents",
      description: "List all agents in Mission Control with their status and token spend.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mc_update_soul",
      description: "Rewrite an agent's SOUL.md personality/instructions.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "number", description: "Agent ID from mc_list_agents" },
          soul:    { type: "string", description: "New SOUL.md markdown content" },
        },
        required: ["agentId", "soul"],
      },
    },
    {
      name: "mc_append_skill",
      description: "Add a skill tag to an existing agent.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "number" },
          skill:   { type: "string" },
        },
        required: ["agentId", "skill"],
      },
    },
    {
      name: "mc_create_task",
      description: "Create and assign a task to an agent.",
      inputSchema: {
        type: "object",
        properties: {
          title:       { type: "string" },
          agentId:     { type: "number" },
          description: { type: "string" },
          priority:    { type: "string", enum: ["low", "medium", "high", "urgent"] },
          status:      { type: "string", enum: ["backlog", "doing", "done"] },
        },
        required: ["title", "agentId"],
      },
    },
    {
      name: "mc_schedule_task",
      description: "Create a recurring scheduled task for an agent using a cron expression.",
      inputSchema: {
        type: "object",
        properties: {
          name:        { type: "string" },
          agentId:     { type: "number" },
          cron:        { type: "string", description: "5-part cron: '0 9 * * 1'" },
          description: { type: "string" },
        },
        required: ["name", "agentId", "cron"],
      },
    },
    {
      name: "mc_get_token_usage",
      description: "Get token usage and cost breakdown by agent and provider.",
      inputSchema: {
        type: "object",
        properties: {
          period:  { type: "string", enum: ["day", "week", "month", "all"], description: "Time window" },
          agentId: { type: "number", description: "Filter to a specific agent (optional)" },
        },
      },
    },
    {
      name: "mc_log_activity",
      description: "Write a message to the Mission Control activity feed.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          type:    { type: "string", description: "Event type e.g. task_completed, note" },
          agentId: { type: "number" },
        },
        required: ["message"],
      },
    },
    {
      name: "mc_memory_write",
      description: "Save a memory entry to persistent storage (DB + OpenClaw workspace). Use to remember facts, decisions, research results, or anything that should survive across sessions.",
      inputSchema: {
        type: "object",
        properties: {
          key:     { type: "string", description: "Short identifier, e.g. 'pricing_research' or 'brand_voice'" },
          value:   { type: "string", description: "Content to remember — markdown OK" },
          agentId: { type: "number", description: "Agent ID this memory belongs to (optional, omit for shared)" },
          tags:    { type: "array", items: { type: "string" }, description: "Optional tag list for categorization" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "mc_memory_search",
      description: "Search persistent memory for stored facts, research, or decisions.",
      inputSchema: {
        type: "object",
        properties: {
          q:       { type: "string", description: "Search query" },
          agentId: { type: "number", description: "Filter to a specific agent's memories (optional)" },
        },
        required: ["q"],
      },
    },
    {
      name: "mc_delegate_task",
      description: "Delegate a subtask to a child agent. Creates the task and assigns it to the specified agent. Parent task tracks the delegation.",
      inputSchema: {
        type: "object",
        properties: {
          title:       { type: "string", description: "Subtask title" },
          description: { type: "string", description: "Detailed instructions for the child agent" },
          agentId:     { type: "number", description: "Agent to delegate to" },
          parentTaskId:{ type: "number", description: "Parent task ID (for tracking)" },
          priority:    { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
        required: ["title", "agentId"],
      },
    },
    {
      name: "mc_request_approval",
      description: "Request human approval before taking an irreversible action. The action will be paused until approved or rejected in the Mission Control UI.",
      inputSchema: {
        type: "object",
        properties: {
          title:       { type: "string", description: "Short description of the action needing approval" },
          description: { type: "string", description: "Detailed explanation of what will happen if approved" },
          action_type: { type: "string", enum: ["file_delete", "external_api", "agent_create", "schedule_modify", "cost_exceed", "custom"] },
          agentId:     { type: "number", description: "Agent requesting approval" },
        },
        required: ["title", "action_type"],
      },
    },
  ];

  app.post("/api/mcp", requireMCInternal, async (req, res) => {
    const { id, method, params } = req.body || {};

    const ok = (result: any) => res.json({ jsonrpc: "2.0", id, result });
    const err = (code: number, message: string) =>
      res.json({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      if (method === "initialize") {
        return ok({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mission-control", version: "1.2.0" },
        });
      }

      if (method === "tools/list") {
        return ok({ tools: MCP_TOOLS });
      }

      if (method === "tools/call") {
        const { name, arguments: args = {} } = params || {};
        const base = `http://localhost:${mcPort}`;
        const H = { "X-MC-Internal": "1", "Content-Type": "application/json" };

        let text = "";

        if (name === "mc_create_agent") {
          const r = await fetch(`${base}/api/tools/create-agent`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? `Created agent "${j.agent?.name}" (ID:${j.agent?.id})` : `Error: ${j.error}`;
        } else if (name === "mc_list_agents") {
          const r = await fetch(`${base}/api/tools/agents`, { headers: H });
          const j = await r.json();
          text = Array.isArray(j) ? j.map((a: any) => `ID:${a.id} "${a.name}" (${a.status})`).join("\n") : JSON.stringify(j);
        } else if (name === "mc_update_soul") {
          const r = await fetch(`${base}/api/tools/update-soul`, { method: "PATCH", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? "Soul updated." : `Error: ${j.error}`;
        } else if (name === "mc_append_skill") {
          const r = await fetch(`${base}/api/tools/append-skill`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? "Skill added." : `Error: ${j.error}`;
        } else if (name === "mc_create_task") {
          const r = await fetch(`${base}/api/tools/create-task`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? `Task created (ID:${j.task?.id})` : `Error: ${j.error}`;
        } else if (name === "mc_schedule_task") {
          const r = await fetch(`${base}/api/tools/schedule-task`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? `Schedule created (ID:${j.schedule?.id})` : `Error: ${j.error}`;
        } else if (name === "mc_get_token_usage") {
          const qs = new URLSearchParams();
          if (args.period) qs.set("period", args.period);
          if (args.agentId) qs.set("agentId", String(args.agentId));
          const r = await fetch(`${base}/api/tools/token-usage?${qs}`, { headers: H });
          const j = await r.json();
          text = JSON.stringify(j, null, 2);
        } else if (name === "mc_log_activity") {
          const r = await fetch(`${base}/api/tools/log-activity`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? "Activity logged." : `Error: ${j.error}`;
        } else if (name === "mc_memory_write") {
          const r = await fetch(`${base}/api/tools/memory-write`, { method: "POST", headers: H, body: JSON.stringify(args) });
          const j = await r.json();
          text = j.ok ? `Memory saved: "${args.key}"` : `Error: ${j.error}`;
        } else if (name === "mc_memory_search") {
          const qs = new URLSearchParams({ q: args.q || "" });
          if (args.agentId) qs.set("agentId", String(args.agentId));
          const r = await fetch(`${base}/api/tools/memory-search?${qs}`, { headers: H });
          const j = await r.json();
          text = j.ok ? JSON.stringify(j.results, null, 2) : `Error: ${j.error}`;
        } else if (name === "mc_delegate_task") {
          const task = await storage.createTask({
            title: args.title,
            description: args.description || `Delegated subtask${args.parentTaskId ? ` (parent: #${args.parentTaskId})` : ""}`,
            agent_id: args.agentId,
            priority: args.priority || "medium",
            status: "backlog",
          });
          await storage.logActivity("task_created", `Delegated: "${task.title}" to agent #${args.agentId}`, args.agentId, task.id, { parent_task_id: args.parentTaskId, delegated: true });
          text = `Task delegated: "${task.title}" (ID:${task.id}) assigned to agent #${args.agentId}${args.parentTaskId ? ` (subtask of #${args.parentTaskId})` : ""}`;
        } else if (name === "mc_request_approval") {
          const r = await fetch(`${base}/api/approvals`, { method: "POST", headers: { ...H, "Cookie": "mc_internal=1" }, body: JSON.stringify({ title: args.title, description: args.description, action_type: args.action_type || "custom", agent_id: args.agentId }) });
          const j = await r.json();
          text = j.id ? `Approval requested (ID:${j.id}). Action paused — waiting for human decision in Mission Control.` : `Error: ${j.message}`;
        } else {
          return err(-32601, `Unknown tool: ${name}`);
        }

        return ok({ content: [{ type: "text", text }] });
      }

      return err(-32601, `Unknown method: ${method}`);
    } catch (e: any) {
      return err(-32603, e.message);
    }
  });

  // Write MC port to ~/.openclaw/workspace/.mc_port so the CEO can read it
  // reliably even when PM2/nohup strips the PORT env variable.
  const mcPort = parseInt(process.env.PORT || "5000");
  setTimeout(() => {
    try {
      const ws = OPENCLAW_WORKSPACE;
      if (existsSync(ws)) {
        writeFileSync(join(ws, ".mc_port"), String(mcPort), "utf8");
        console.log(`[mc] wrote .mc_port = ${mcPort}`);
      }
      deployMCSkill(mcPort);
      // Register MC as an MCP server with OpenClaw gateway so CEO gets native
      // tool calls in gateway/interactive sessions (not just --local context injection).
      // Uses `openclaw mcp set` (v2026.4+) — idempotent, safe to run on every restart.
      // Run async via spawn (not spawnSync) to avoid blocking the event loop.
      try {
        const mcpUrl = `http://localhost:${mcPort}/api/mcp`;
        const mcpJson = JSON.stringify({ url: mcpUrl });
        const { spawn: spawnAsync } = require("child_process");
        const child = spawnAsync("openclaw", ["mcp", "set", "mission-control", mcpJson], {
          env: openclawEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
        });
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code: number) => {
          if (code === 0 || stdout.includes("Saved MCP server")) {
            console.log(`[mcp] Registered mission-control MCP server → ${mcpUrl}`);
          } else {
            const errMsg = stderr.trim().split("\n").pop() || "openclaw mcp set failed";
            console.log(`[mcp] Gateway registration skipped (${errMsg})`);
          }
        });
        child.on("error", () => { /* non-fatal */ });
      } catch { /* non-fatal */ }
    } catch (e: any) { console.warn("[mc-skill] deploy skipped:", e.message); }
  }, 3000);

  // Reset any agents stuck in "working" from a previous crashed session
  setTimeout(async () => {
    try {
      const agents = await storage.getAgents();
      const stuck = agents.filter(a => a.status === "working");
      for (const a of stuck) {
        await storage.updateAgentStatus(a.id, "idle", null);
        console.log(`[startup] reset stuck agent "${a.name}" (id=${a.id}) from working → idle`);
      }
    } catch (e: any) { console.warn("[startup] stuck-agent reset failed:", e.message); }
  }, 1000);

  // Run once at startup — catches agents created before MC booted
  setTimeout(() => runOpenClawAgentSync().catch(e => console.warn("[agent-sync] startup scan:", e.message)), 5000);

  // Ensure all DB agents are registered in OpenClaw (wipe-proof recovery)
  // If OpenClaw was updated and ~/.openclaw was wiped, this re-creates agent workspaces from DB
  setTimeout(async () => {
    try {
      const agents = await storage.getAgents();
      for (const agent of agents) {
        if (!agent.openclaw_id || agent.openclaw_id === "main") continue;
        const agentDir = join(OPENCLAW_AGENTS_DIR, agent.openclaw_id);
        if (!existsSync(agentDir)) {
          console.log(`[startup] Re-registering wiped agent: ${agent.openclaw_id}`);
          const result = await addOpenClawAgent(agent.openclaw_id, agent.soul || null);
          if (result.ok) console.log(`[startup] Re-registered: ${agent.openclaw_id}`);
          else console.warn(`[startup] Failed: ${agent.openclaw_id} — ${result.error}`);
        }
      }
    } catch (e: any) { console.warn("[startup] agent re-register failed:", e.message); }
  }, 8000);

  // ── Cron Ticker ──────────────────────────────────────────────────────────────
  // Fires every minute, checks all enabled schedules, runs any that are due.
  function matchesCron(expr: string, d: Date): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hour, dom, mon, dow] = parts;
    const ok = (field: string, val: number): boolean => {
      if (field === "*") return true;
      if (field.startsWith("*/")) { const n = parseInt(field.slice(2)); return n > 0 && val % n === 0; }
      if (field.includes(",")) return field.split(",").some(f => parseInt(f) === val);
      if (field.includes("-")) { const [lo, hi] = field.split("-").map(Number); return val >= lo && val <= hi; }
      return parseInt(field) === val;
    };
    return ok(min, d.getMinutes()) && ok(hour, d.getHours()) &&
           ok(dom, d.getDate()) && ok(mon, d.getMonth() + 1) && ok(dow, d.getDay());
  }

  async function runDueSchedules() {
    try {
      // Cron expressions are stored in UTC (converted from local time on save).
      // Match against UTC time — no timezone conversion needed here.
      const now = new Date();
      const schedules = await storage.getSchedules();
      for (const sched of schedules) {
        if (!sched.is_enabled || !sched.agent_id) continue;
        if (!matchesCron(sched.cron_expression, now)) continue;
        // Skip if already ran this minute
        if (sched.last_run) {
          const diffMs = now.getTime() - new Date(sched.last_run).getTime();
          if (diffMs < 60_000) continue;
        }
        // Mark immediately to prevent double-fire
        await storage.markScheduleRun(sched.id);
        console.log(`[cron] firing "${sched.name}" (agent ${sched.agent_id})`);

        // Fire and forget — don't block the tick loop
        (async () => {
          try {
            const agents = await storage.getAgents();
            const agent = agents.find(a => a.id === sched.agent_id);
            if (!agent?.openclaw_id) return;

            const task = await storage.createTask({
              title: sched.name,
              description: sched.description ?? sched.name,
              agent_id: sched.agent_id,
              status: "doing",
              priority: sched.priority,
              due_date: null,
              tags: ["scheduled"],
            });

            const agentOpenclawId = agent.openclaw_id.replace(/^openclaw\//, "");
            const allAgents = agents.map(a => ({
              id: a.id,
              name: a.name,
              openclaw_id: a.openclaw_id ?? null,
              role: a.role,
              skills: Array.isArray(a.skills) ? a.skills : [],
            }));
            const result = await chatWithAgent(agentOpenclawId, [
              { role: "user", content: `[Scheduled task] ${sched.description ?? sched.name}` },
            ], { agentRoster: allAgents });

            await storage.updateTask(task.id, { status: result.ok ? "done" : "doing" });

            // Save agent response as a Report so it shows up in the Reports page
            if (result.ok && result.text) {
              const reportTypeMap: Record<string, string> = {
                reporting: "financial", research: "research",
                monitoring: "operational", general: "operational",
                data_processing: "financial", outreach: "operational",
              };
              await storage.createReport({
                title: sched.name,
                content: result.text,
                type: reportTypeMap[sched.task_type] ?? "operational",
                status: "complete",
                agent_id: sched.agent_id,
                tags: ["scheduled", sched.task_type],
              });
            }

            await storage.logActivity(
              "task_completed",
              `[Scheduled] ${sched.name}: ${result.ok ? result.text.slice(0, 120) + (result.text.length > 120 ? "…" : "") : ("Error: " + result.error)}`,
              sched.agent_id
            );

            // Send to notification channels if configured
            if (result.ok && (sched.notify_discord || sched.notify_whatsapp)) {
              const settings = await storage.getSettings();
              const summary = result.text.slice(0, 1800);
              if (sched.notify_discord) {
                const webhookUrl = settings.find(s => s.setting_key === "discord_webhook_url")?.setting_value;
                if (webhookUrl && typeof webhookUrl === "string" && webhookUrl.startsWith("https://")) {
                  try {
                    await fetch(webhookUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: `**${sched.name}**\n${summary}` }),
                    });
                  } catch (e: any) {
                    console.warn(`[cron] Discord notify failed for "${sched.name}":`, e.message);
                  }
                }
              }
              if (sched.notify_whatsapp) {
                // WhatsApp integration not yet configured — placeholder
                console.log(`[cron] WhatsApp notify requested for "${sched.name}" but not yet configured`);
              }
            }

            if (result.ok && result.usage) {
              const today = new Date().toISOString().split("T")[0];
              const tokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0);
              if (tokens > 0) {
                const activeModel = readActiveModel() || result.model || "openclaw/main";
                await storage.addCostEntry({
                  agent_id: sched.agent_id,
                  model_name: activeModel,
                  tokens_used: tokens,
                  cost_usd: estimateChatCost(result.usage, activeModel),
                  entry_date: today,
                });
              }
            }
          } catch (e: any) {
            console.warn(`[cron] task "${sched.name}" failed:`, e.message);
          }
        })();
      }
    } catch (e: any) {
      console.warn("[cron] tick error:", e.message);
    }
  }

  // Align to the top of each minute
  function scheduleCronTick() {
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 200;
    setTimeout(async () => {
      await runDueSchedules();
      scheduleCronTick(); // re-schedule for next minute
    }, msUntilNextMinute);
  }
  scheduleCronTick();
  console.log("[cron] scheduler started");

  // ── Integrated Terminal (WebSocket + PTY or SSH) ─────
  // Auto-detects: node-pty available → local shell, otherwise → SSH mode
  let hasNodePty = false;
  try { require("node-pty"); hasNodePty = true; } catch { /* not available */ }

  // Endpoint to check terminal capabilities
  app.get("/api/terminal/capabilities", (_req, res) => {
    res.json({ localShell: hasNodePty, sshAvailable: true });
  });

  try {
    const { WebSocketServer } = require("ws");
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req: any, socket: any, head: any) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      if (!url.pathname.startsWith("/api/terminal")) return;

      wss.handleUpgrade(req, socket, head, (ws: any) => {
        const mode = url.searchParams.get("mode") || (hasNodePty ? "local" : "ssh");

        if (mode === "local" && hasNodePty) {
          // ── Local PTY mode (Docker, VPS, bare metal) ──
          try {
            const pty = require("node-pty");
            const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
            const term = pty.spawn(shell, [], {
              name: "xterm-256color",
              cols: 120, rows: 30,
              cwd: process.env.HOME || "/root",
              env: { ...process.env, TERM: "xterm-256color" },
            });
            term.onData((data: string) => { try { ws.send(data); } catch {} });
            ws.on("message", (msg: any) => {
              const str = msg.toString();
              if (str.startsWith("\x01resize:")) {
                try { const [c, r] = str.slice(8).split(",").map(Number); if (c > 0 && r > 0) term.resize(c, r); } catch {}
                return;
              }
              term.write(str);
            });
            ws.on("close", () => { term.kill(); });
            term.onExit(() => { try { ws.close(); } catch {} });
          } catch (err: any) {
            ws.send(`\r\n\x1b[31mLocal terminal error: ${err.message}\x1b[0m\r\n`);
            ws.close();
          }
        } else if (mode === "ssh") {
          // ── SSH mode (cPanel, shared hosting, remote servers) ──
          const sshHost = url.searchParams.get("host") || "127.0.0.1";
          const sshPort = parseInt(url.searchParams.get("port") || "22");
          const sshUser = url.searchParams.get("user") || "";
          const sshPass = url.searchParams.get("pass") || "";

          if (!sshUser) {
            ws.send("\r\n\x1b[33mSSH credentials required. Configure host, port, username, and password in the terminal settings above.\x1b[0m\r\n");
            ws.close();
            return;
          }

          try {
            const { Client } = require("ssh2");
            const conn = new Client();

            conn.on("ready", () => {
              conn.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err: any, stream: any) => {
                if (err) { ws.send(`\r\n\x1b[31mSSH shell error: ${err.message}\x1b[0m\r\n`); ws.close(); return; }

                stream.on("data", (data: Buffer) => { try { ws.send(data.toString()); } catch {} });
                stream.on("close", () => { conn.end(); try { ws.close(); } catch {} });

                ws.on("message", (msg: any) => {
                  const str = msg.toString();
                  if (str.startsWith("\x01resize:")) {
                    try { const [c, r] = str.slice(8).split(",").map(Number); if (c > 0 && r > 0) stream.setWindow(r, c, 0, 0); } catch {}
                    return;
                  }
                  stream.write(str);
                });
                ws.on("close", () => { stream.close(); conn.end(); });
              });
            });

            conn.on("error", (err: any) => {
              ws.send(`\r\n\x1b[31mSSH connection failed: ${err.message}\x1b[0m\r\n`);
              ws.close();
            });

            conn.connect({ host: sshHost, port: sshPort, username: sshUser, password: sshPass, readyTimeout: 10000 });
          } catch (err: any) {
            ws.send(`\r\n\x1b[31mSSH error: ${err.message}\x1b[0m\r\n`);
            ws.close();
          }
        } else {
          ws.send("\r\n\x1b[31mNo terminal backend available. Install node-pty for local shell or configure SSH credentials.\x1b[0m\r\n");
          ws.close();
        }
      });
    });
    console.log(`[terminal] WebSocket handler registered (mode: ${hasNodePty ? "local PTY" : "SSH only"})`);
  } catch (err: any) {
    console.log(`[terminal] Not available: ${err.message}`);
  }

  return httpServer;
}
