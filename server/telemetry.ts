/**
 * OpenClaw Telemetry Collector
 *
 * Reads OpenClaw session files (.jsonl) and sessions.json to capture:
 * - Per-turn token usage, cost, model, provider, duration
 * - Channel source (discord, telegram, whatsapp, slack, etc.)
 * - Sender identity (name, username, ID) for per-user analytics
 * - Conversation memory extraction → agent_memory table + workspace .md files
 * - Learning engine triggers (Super Powers self-learning loop)
 *
 * Runs as a background interval inside the MC Express server.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { storage } from "./storage";
import { OPENCLAW_HOME, OPENCLAW_AGENTS_DIR, OPENCLAW_WORKSPACE } from "./paths";
// Learning engine (Pro feature) — stubs for core
const trackToolCall = (..._args: any[]) => {};
const trackTurn = (..._args: any[]) => {};
const processLearningTrigger = (..._args: any[]) => {};
const scoreTaskCompletion = (..._args: any[]) => {};

// ── Cost-per-token lookup (approximate, input pricing per 1K tokens) ──
const COST_PER_1K_INPUT: Record<string, number> = {
  "openrouter/auto": 0.002,
  "claude-sonnet": 0.003,
  "claude-opus": 0.015,
  "gpt-4o": 0.005,
  "gpt-4o-mini": 0.00015,
  "gemini-pro": 0.001,
  "gemini-2.0-flash": 0.0001,
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(COST_PER_1K_INPUT).find(k => model.includes(k));
  const inputRate = key ? COST_PER_1K_INPUT[key] : 0.002;
  const outputRate = inputRate * 3;
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

// ── State: track what we've already ingested ──
const processedMessageIds = new Set<string>();
let lastSessionsHash = "";

interface SessionMeta {
  key: string;
  sessionId: string;
  sessionFile: string;
  channel: string;
  senderId: string | null;
  senderName: string | null;
  senderUsername: string | null;
  agentId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Parse sessions.json to get session metadata (channel, sender, file paths)
 */
function readSessionsStore(): SessionMeta[] {
  const agentsDir = OPENCLAW_AGENTS_DIR;
  const results: SessionMeta[] = [];

  if (!existsSync(agentsDir)) return results;

  // Scan all agent directories
  let agentDirs: string[];
  try {
    agentDirs = readdirSync(agentsDir).filter(d => {
      const p = join(agentsDir, d, "sessions", "sessions.json");
      return existsSync(p);
    });
  } catch { return results; }

  for (const agentDir of agentDirs) {
    const sessionsFile = join(agentsDir, agentDir, "sessions", "sessions.json");
    try {
      const raw = readFileSync(sessionsFile, "utf8");
      const sessions = JSON.parse(raw);

      for (const [key, session] of Object.entries(sessions) as [string, any][]) {
        const origin = session.origin || {};
        const delivery = session.deliveryContext || {};

        results.push({
          key,
          sessionId: session.sessionId || "unknown",
          sessionFile: session.sessionFile || "",
          channel: origin.provider || delivery.channel || "direct",
          senderId: origin.from?.replace(/^discord:/, "").replace(/^telegram:/, "").replace(/^whatsapp:/, "") || null,
          senderName: origin.label?.split(" user id:")[0] || origin.label?.split(" (")[0] || null,
          senderUsername: null, // enriched from message content
          agentId: agentDir,
          model: session.authProfileOverride || "openrouter/auto",
          provider: "openrouter",
          inputTokens: 0,
          outputTokens: 0,
        });
      }
    } catch { /* corrupted or locked */ }
  }

  return results;
}

/**
 * Parse a .jsonl session file for conversation turns
 */
function parseSessionFile(filepath: string): Array<{
  id: string;
  role: "user" | "assistant";
  text: string;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  timestamp: string;
  senderId: string | null;
  senderName: string | null;
  senderUsername: string | null;
}> {
  if (!existsSync(filepath)) return [];
  const turns: any[] = [];

  try {
    const content = readFileSync(filepath, "utf8");
    const lines = content.split("\n").filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;

        const msg = entry.message;
        const id = entry.id || "";

        if (msg.role === "assistant") {
          // Extract text from content blocks
          const textBlocks = (msg.content || []).filter((b: any) => b.type === "text");
          const text = textBlocks.map((b: any) => b.text).join("\n");
          const usage = msg.usage || {};

          turns.push({
            id,
            role: "assistant",
            text: text.substring(0, 500), // preview
            model: msg.model || null,
            provider: msg.provider || null,
            inputTokens: usage.input || 0,
            outputTokens: usage.output || 0,
            cacheRead: usage.cacheRead || 0,
            cacheWrite: usage.cacheWrite || 0,
            timestamp: entry.timestamp || new Date().toISOString(),
            senderId: null,
            senderName: null,
            senderUsername: null,
          });
        } else if (msg.role === "user") {
          // Extract sender info from the conversation metadata block
          const textBlocks = (msg.content || []).filter((b: any) => b.type === "text");
          const fullText = textBlocks.map((b: any) => b.text).join("\n");

          let senderId: string | null = null;
          let senderName: string | null = null;
          let senderUsername: string | null = null;
          let userMessage = fullText;

          // Parse sender metadata from OpenClaw's format
          const senderMatch = fullText.match(/"sender_id":\s*"(\d+)"/);
          const nameMatch = fullText.match(/"sender":\s*"([^"]+)"/);
          const usernameMatch = fullText.match(/"username":\s*"([^"]+)"/);
          if (senderMatch) senderId = senderMatch[1];
          if (nameMatch) senderName = nameMatch[1];
          if (usernameMatch) senderUsername = usernameMatch[1];

          // Extract the actual user message (after the metadata blocks)
          const lastText = fullText.split("```\n").pop() || fullText;
          userMessage = lastText.trim().substring(0, 500);

          turns.push({
            id,
            role: "user",
            text: userMessage,
            model: null,
            provider: null,
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            timestamp: entry.timestamp || new Date().toISOString(),
            senderId,
            senderName,
            senderUsername,
          });
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read error */ }

  return turns;
}

/**
 * Main ingestion: read session files and write to conversation_turns
 */
async function ingestSessionData() {
  const sessions = readSessionsStore();
  if (sessions.length === 0) return;

  // Resolve agent DB IDs
  let agentMap: Record<string, number> = {};
  try {
    const agents = await storage.getAgents();
    for (const a of agents) {
      if (a.openclaw_id) agentMap[a.openclaw_id] = a.id;
      agentMap[a.name.toLowerCase()] = a.id;
    }
  } catch { return; }

  let ingested = 0;

  for (const session of sessions) {
    if (!session.sessionFile || !existsSync(session.sessionFile)) continue;

    const turns = parseSessionFile(session.sessionFile);
    const agentDbId = agentMap[session.agentId] || agentMap["main"] || Object.values(agentMap)[0] || null;

    // Track sender info from user turns to apply to subsequent assistant turns
    let lastSenderId = session.senderId;
    let lastSenderName = session.senderName;

    for (const turn of turns) {
      if (processedMessageIds.has(turn.id)) continue;
      processedMessageIds.add(turn.id);

      // Update sender tracking from user turns
      if (turn.role === "user") {
        if (turn.senderId) lastSenderId = turn.senderId;
        if (turn.senderName) lastSenderName = turn.senderName;
      }

      const costUsd = turn.role === "assistant"
        ? estimateCost(turn.model || "openrouter/auto", turn.inputTokens, turn.outputTokens)
        : 0;

      try {
        await storage.query(
          `INSERT INTO conversation_turns
            (session_id, agent_id, channel, sender_id, sender_name, direction,
             message_preview, model_name, provider, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, total_tokens, cost_usd,
             duration_ms, error_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.sessionId,
            agentDbId,
            session.channel,
            lastSenderId,
            turn.senderName || turn.senderUsername || lastSenderName,
            turn.role === "user" ? "inbound" : "outbound",
            turn.text,
            turn.model,
            turn.provider,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheRead,
            turn.cacheWrite,
            turn.inputTokens + turn.outputTokens,
            costUsd.toFixed(6),
            0, // duration_ms — not available per-turn in session files
            null,
            // Convert ISO 8601 to MySQL datetime format
            turn.timestamp.replace("T", " ").replace("Z", "").replace(/\.\d+$/, ""),
          ]
        );
        ingested++;

        // ── Super Powers: Archive to session_archive for FTS search (Layer 2) ──
        if (turn.text && turn.text.length > 10) {
          try {
            await storage.archiveSession({
              agent_id: agentDbId || undefined,
              session_id: session.sessionId || "unknown",
              role: turn.role,
              content: turn.text,
              tool_calls: turn.toolCalls || undefined,
              tokens: turn.inputTokens + turn.outputTokens,
            });
          } catch { /* duplicate or table not ready — safe to skip */ }
        }

        // ── Super Powers: Learning Engine triggers ──
        if (agentDbId) {
          try {
            // Track turns for nudge + user correction detection
            const turnTrigger = trackTurn(agentDbId, turn.role, turn.text || "");
            if (turnTrigger) processLearningTrigger(turnTrigger).catch(() => {});

            // Track tool calls for skill generation triggers
            if (turn.toolCalls && Array.isArray(turn.toolCalls)) {
              for (const tc of turn.toolCalls) {
                const toolTrigger = trackToolCall(agentDbId, tc.name || "unknown", !tc.error);
                if (toolTrigger) processLearningTrigger(toolTrigger).catch(() => {});
              }
            }
          } catch { /* non-fatal — learning engine errors must never break telemetry */ }
        }

        const senderLabel = turn.senderName || turn.senderUsername || lastSenderName || "user";
        const channelLabel = session.channel.charAt(0).toUpperCase() + session.channel.slice(1);

        // ── Activity Feed: log every chat interaction ──
        // Skip heartbeat channel — system health checks aren't useful for humans
        const isSystemChannel = session.channel === "direct" || session.channel.toLowerCase() === "heartbeat";
        if (!isSystemChannel) {
          if (turn.role === "user") {
            // User sent a message via chat channel
            try {
              await storage.logActivity(
                "chat_message",
                `${senderLabel} via ${channelLabel}: "${(turn.text || "").substring(0, 120)}"`,
                agentDbId,
                null,
                { channel: session.channel, sender: senderLabel, senderId: lastSenderId, direction: "inbound" }
              );
            } catch { /* enum might not be widened yet */ }
          } else if (turn.role === "assistant" && turn.text && turn.text.length > 5) {
            // Bot responded — log with token cost
            const costLabel = costUsd > 0.001 ? ` ($${costUsd.toFixed(4)})` : "";
            try {
              await storage.logActivity(
                "chat_message",
                `Bot replied on ${channelLabel}: "${(turn.text || "").substring(0, 100)}"${costLabel}`,
                agentDbId,
                null,
                { channel: session.channel, direction: "outbound", model: turn.model, tokens: turn.inputTokens + turn.outputTokens, cost: costUsd }
              );
            } catch { /* safe */ }
          }
        }

        // ── Live Task: create a task when bot does substantial work (>2000 tokens) ──
        if (turn.role === "assistant" && !isSystemChannel && (turn.inputTokens + turn.outputTokens) > 2000) {
          const taskTitle = `${channelLabel} — ${senderLabel}: ${(turn.text || "chat task").substring(0, 80)}`;
          try {
            // Check if we already have a recent task for this session
            const existing = await storage.query(
              `SELECT id FROM tasks WHERE title LIKE ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE) LIMIT 1`,
              [`${channelLabel} — ${senderLabel}%`]
            ) as any[];
            if (!existing || existing.length === 0) {
              await storage.createTask({
                title: taskTitle,
                description: `Auto-created from ${channelLabel} conversation. ${turn.inputTokens + turn.outputTokens} tokens used, model: ${turn.model || "auto"}`,
                status: "done",
                priority: "medium",
                agent_id: agentDbId,
              });
              try {
                await storage.logActivity(
                  "chat_task_completed",
                  `Completed ${channelLabel} request from ${senderLabel} (${turn.inputTokens + turn.outputTokens} tokens)`,
                  agentDbId,
                  null,
                  { channel: session.channel, sender: senderLabel, tokens: turn.inputTokens + turn.outputTokens, cost: costUsd }
                );
              } catch { /* safe */ }
            }
          } catch { /* task creation failed — not critical */ }
        }

        // Feed assistant turns into cost_entries for the existing Analytics page
        if (agentDbId && turn.role === "assistant" && turn.model) {
          const entryDate = turn.timestamp.split("T")[0];
          try {
            await storage.addCostEntry({
              agent_id: agentDbId,
              model_name: turn.model,
              tokens_used: turn.inputTokens + turn.outputTokens,
              cost_usd: parseFloat(costUsd.toFixed(6)),
              entry_date: entryDate,
            });
          } catch { /* duplicate — safe to ignore */ }
        }
      } catch (err: any) {
        // Skip duplicates silently
        if (!err.message?.includes("Duplicate")) {
          console.error("[telemetry] Failed to ingest turn:", err.message);
        }
      }
    }
  }

  if (ingested > 0) {
    console.log(`[telemetry] Ingested ${ingested} conversation turns from session files`);
  }
}

/**
 * Sync agent status: set "working" when active session is recent, "idle" otherwise
 */
let gatewayAlive = false;
// Probe gateway every 30s — but ONLY if this install has a local .openclaw/ config
setInterval(() => {
  // No local OpenClaw config = no gateway to probe
  if (!existsSync(join(OPENCLAW_HOME, "openclaw.json"))) { gatewayAlive = false; return; }

  const net = require("net");
  const sock = net.createConnection({ host: "127.0.0.1", port: 18789, timeout: 2000 });
  sock.on("connect", () => { gatewayAlive = true; sock.destroy(); });
  sock.on("error", () => { gatewayAlive = false; });
  sock.on("timeout", () => { gatewayAlive = false; sock.destroy(); });
}, 30000);

let syncAgentLock = false;
async function syncAgentStatus() {
  if (!gatewayAlive) return; // Gateway not running — skip
  if (syncAgentLock) return; // Previous call still in-flight
  syncAgentLock = true;

  try {
    const resp = await fetch("http://127.0.0.1:18789/api/sessions?allAgents=true", { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) { syncAgentLock = false; return; }
    const data = await resp.json();

    // Resolve agent DB IDs
    const agents = await storage.getAgents();
    const agentMap: Record<string, number> = {};
    for (const a of agents) {
      if (a.openclaw_id) agentMap[a.openclaw_id] = a.id;
    }

    for (const session of data.sessions || []) {
      const agentId = agentMap[session.agentId];
      if (!agentId) continue;

      // If session was updated in the last 30 seconds, agent is working
      const ageMs = session.ageMs || Infinity;
      const isActive = ageMs < 30000;

      const currentAgent = agents.find(a => a.id === agentId);
      if (!currentAgent) continue;

      if (isActive && currentAgent.status !== "working") {
        const origin = session.deliveryContext?.channel || "direct";
        await storage.updateAgentStatus(agentId, "working", `Processing ${origin} message`);
      } else if (!isActive && currentAgent.status === "working") {
        await storage.updateAgentStatus(agentId, "idle");
      }
    }
  } catch {
    // Gateway not running or command failed — don't touch status
  } finally {
    syncAgentLock = false;
  }
}

/**
 * Roll up conversation_turns into channel_daily_stats
 */
async function rollupDailyStats() {
  const today = new Date().toISOString().split("T")[0];
  try {
    await storage.query(`
      INSERT INTO channel_daily_stats
        (stat_date, channel, agent_id, message_count, unique_users, total_tokens,
         total_cost_usd, avg_duration_ms, error_count)
      SELECT
        DATE(created_at) as stat_date,
        channel,
        agent_id,
        COUNT(*) as message_count,
        COUNT(DISTINCT sender_id) as unique_users,
        SUM(total_tokens) as total_tokens,
        SUM(cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms,
        SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) as error_count
      FROM conversation_turns
      WHERE DATE(created_at) >= DATE_SUB(?, INTERVAL 1 DAY)
      GROUP BY DATE(created_at), channel, agent_id
      ON DUPLICATE KEY UPDATE
        message_count = VALUES(message_count),
        unique_users = VALUES(unique_users),
        total_tokens = VALUES(total_tokens),
        total_cost_usd = VALUES(total_cost_usd),
        avg_duration_ms = VALUES(avg_duration_ms),
        error_count = VALUES(error_count)
    `, [today]);
  } catch (err: any) {
    if (!err.message?.includes("doesn't exist")) {
      console.error("[telemetry] Rollup failed:", err.message);
    }
  }
}

/**
 * Sync conversation memories to OpenClaw workspace .md files + agent_memory DB
 */
async function syncConversationMemories() {
  const memDir = join(OPENCLAW_WORKSPACE, "memory");
  if (!existsSync(memDir)) {
    try { mkdirSync(memDir, { recursive: true }); } catch { return; }
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    const rows = await storage.query(`
      SELECT channel, sender_id, sender_name, message_preview, direction, created_at
      FROM conversation_turns
      WHERE message_preview IS NOT NULL
        AND LENGTH(message_preview) > 10
        AND channel != 'direct'
        AND DATE(created_at) = ?
      ORDER BY created_at ASC
      LIMIT 200
    `, [today]) as any[];

    if (!rows || rows.length === 0) return;

    // Group by channel
    const byChannel: Record<string, any[]> = {};
    for (const row of rows) {
      const ch = row.channel;
      if (!byChannel[ch]) byChannel[ch] = [];
      byChannel[ch].push(row);
    }

    for (const [channel, channelRows] of Object.entries(byChannel)) {
      const uniqueUsers = new Set(channelRows.filter(r => r.sender_id).map(r => r.sender_id)).size;

      const mdContent = [
        `# ${channel} Conversations — ${today}`,
        ``,
        `**Messages:** ${channelRows.length} | **Unique users:** ${uniqueUsers}`,
        ``,
        ...channelRows.slice(0, 40).map(r => {
          const sender = r.direction === "inbound" ? (r.sender_name || r.sender_id || "user") : "Bot";
          const time = new Date(r.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          return `**${time} — ${sender}:** ${(r.message_preview || "").substring(0, 200)}`;
        }),
      ].join("\n");

      const filepath = join(memDir, `${channel}-${today}.md`);
      try { writeFileSync(filepath, mdContent, "utf8"); } catch { /* permission */ }
    }

    // Write per-user summaries to agent_memory DB
    const byUser: Record<string, { channel: string; sender: string; count: number; texts: string[] }> = {};
    for (const row of rows) {
      if (!row.sender_id) continue;
      const key = `${row.channel}:${row.sender_id}`;
      if (!byUser[key]) byUser[key] = { channel: row.channel, sender: row.sender_name || row.sender_id, count: 0, texts: [] };
      byUser[key].count++;
      if (row.message_preview) byUser[key].texts.push(row.message_preview.substring(0, 100));
    }

    for (const [, data] of Object.entries(byUser)) {
      const memKey = `chat:${data.channel}:${data.sender}:${today}`;
      const memVal = `${data.channel} user "${data.sender}" — ${data.count} messages. Samples: ${data.texts.slice(0, 3).join(" | ")}`;
      try {
        await storage.query(
          `INSERT INTO agent_memory (\`key\`, value, tags)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
          [memKey, memVal, JSON.stringify([data.channel, "conversation", today])]
        );
      } catch { /* safe to skip */ }
    }

    console.log(`[telemetry] Memory sync: ${Object.keys(byChannel).length} channel(s), ${rows.length} turns`);
  } catch (err: any) {
    if (!err.message?.includes("doesn't exist")) {
      console.error("[telemetry] Memory sync failed:", err.message);
    }
  }
}

/**
 * Start the telemetry collector
 */
/**
 * Check cost alerts — compare current spend against thresholds
 */
async function checkCostAlerts() {
  try {
    const alerts = await storage.getCostAlerts();
    const activeAlerts = alerts.filter(a => a.is_active);
    if (activeAlerts.length === 0) return;

    const now = new Date();
    for (const alert of activeAlerts) {
      // Determine date range based on period
      let startDate: string;
      if (alert.period === "daily") {
        startDate = now.toISOString().split("T")[0];
      } else if (alert.period === "weekly") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split("T")[0];
      } else {
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 30);
        startDate = monthAgo.toISOString().split("T")[0];
      }

      // Query cost
      let sql = "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE entry_date >= ?";
      const params: any[] = [startDate];
      if (alert.agent_id) {
        sql += " AND agent_id = ?";
        params.push(alert.agent_id);
      }
      const rows = await storage.query(sql, params);
      const totalCost = parseFloat(rows[0]?.total || "0");

      if (totalCost >= alert.threshold_usd) {
        // Don't re-trigger if already triggered today
        if (alert.last_triggered) {
          const lastTriggered = new Date(alert.last_triggered);
          const hoursSince = (now.getTime() - lastTriggered.getTime()) / (1000 * 60 * 60);
          if (hoursSince < 24) continue; // Skip — already triggered within 24h
        }

        // Trigger!
        await storage.triggerCostAlert(alert.id);
        const agentLabel = alert.agent_id ? `Agent #${alert.agent_id}` : "All agents";
        const msg = `Cost alert "${alert.name}" triggered: ${agentLabel} spent $${totalCost.toFixed(2)} (threshold: $${alert.threshold_usd.toFixed(2)}, period: ${alert.period})`;
        console.log(`[cost-alert] ${msg}`);

        // Log to activity feed
        try {
          await storage.logActivity("note", msg, alert.agent_id, null, { alert_id: alert.id, cost: totalCost, threshold: alert.threshold_usd });
        } catch { /* safe */ }
      }
    }
  } catch (err: any) {
    // Non-critical — table might not exist yet on older installs
    if (!err.message?.includes("doesn't exist")) {
      console.error("[cost-alert] Check failed:", err.message);
    }
  }
}

/**
 * Super Powers: Periodic nudge — update memory layer stats
 * In a full implementation, this would inject a reflection prompt into active agent sessions.
 * For now, it maintains the memory layer size tracking.
 */
async function updateMemoryLayerStats() {
  try {
    const agents = await storage.getAgents();
    for (const agent of agents) {
      // Layer 1: Prompt memory — check MEMORY.md + USER.md file sizes
      let promptSize = 0;
      for (const f of ["MEMORY.md", "USER.md"]) {
        const fp = join(OPENCLAW_WORKSPACE, f);
        if (existsSync(fp)) {
          try { promptSize += readFileSync(fp, "utf8").length; } catch { /* skip */ }
        }
      }
      if (promptSize > 0) {
        await storage.updateMemoryLayer(agent.id, "prompt", promptSize, 2);
      }

      // Layer 2: Session count
      const sessionCount = await storage.getSessionCount(agent.id);
      if (sessionCount > 0) {
        await storage.updateMemoryLayer(agent.id, "session", 0, sessionCount);
      }

      // Layer 3: Skills count
      const skills = await storage.getSkills(agent.id);
      const totalContent = skills.reduce((sum, s) => sum + s.content.length, 0);
      if (skills.length > 0) {
        await storage.updateMemoryLayer(agent.id, "skills", totalContent, skills.length);
      }
    }
  } catch (err: any) {
    if (!err.message?.includes("doesn't exist")) {
      console.error("[memory-layers] Update failed:", err.message);
    }
  }
}

export function startTelemetryCollector() {
  console.log("[telemetry] Starting OpenClaw telemetry collector (30s interval, session-based)");

  // Initial run after 5 seconds
  setTimeout(async () => {
    try {
      await ingestSessionData();
      await rollupDailyStats();
      await syncConversationMemories();
    } catch (err: any) {
      console.error("[telemetry] Initial run error:", err.message);
    }
  }, 5000);

  // Ingest + rollup + agent status + cost alerts every 30 seconds
  setInterval(async () => {
    try {
      await ingestSessionData();
      await rollupDailyStats();
      await syncAgentStatus();
      await checkCostAlerts();
      await updateMemoryLayerStats();
      try { await (storage as any).truncateOldNudges?.(); } catch {}
    } catch (err: any) {
      console.error("[telemetry] Collector error:", err.message);
    }
  }, 30000);

  // Memory sync every 5 minutes
  setInterval(async () => {
    try {
      await syncConversationMemories();
    } catch (err: any) {
      console.error("[telemetry] Memory sync error:", err.message);
    }
  }, 300000);
}
