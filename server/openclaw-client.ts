/**
 * openclaw-client.ts
 * Interface to the local OpenClaw installation.
 *
 * OpenClaw's gateway is WebSocket-based (not OpenAI-compatible REST).
 * Requests that appear to be at /v1/models or /v1/chat/completions
 * actually serve the gateway's control-panel SPA — not JSON.
 *
 * All agent interactions therefore go through the CLI:
 *   openclaw agent --local --json ...
 *
 * Status checks use `openclaw --version` (fast, no gateway required).
 *
 * All methods are safe to call when OpenClaw is unreachable — they
 * return typed error results rather than throwing.
 */

import { execSync, spawnSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import os from "os";
import { storage } from "./storage";
import { OPENCLAW_HOME, OPENCLAW_WORKSPACE, OPENCLAW_AGENTS_DIR, OPENCLAW_CONFIG, agentDir, openclawEnv } from "./paths";

// ── Process guard — prevent runaway openclaw spawns ──────
const MAX_CONCURRENT_OPENCLAW = 3;
const activeProcesses = new Set<number>();
function canSpawnOpenClaw(): boolean {
  for (const pid of activeProcesses) { try { process.kill(pid, 0); } catch { activeProcesses.delete(pid); } }
  return activeProcesses.size < MAX_CONCURRENT_OPENCLAW;
}
function trackProcess(pid: number): void { activeProcesses.add(pid); }
function untrackProcess(pid: number): void { activeProcesses.delete(pid); }

// ── Types ────────────────────────────────────────────────

export interface OpenClawAgent {
  id: string;
  name: string;
  object: "model";
}

export interface OpenClawStatus {
  reachable: boolean;
  version?: string;
  agents: OpenClawAgent[];
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: string;
}

// ── Config resolution ────────────────────────────────────

/** Augment PATH so openclaw is findable from npm global bin dirs.
 *  Computed once at module load — never blocks a request. */
const AUGMENTED_PATH: string = (() => {
  try {
    const result = spawnSync("npm config get prefix", { shell: true, encoding: "utf8", timeout: 3000 });
    const npmPrefix = (result.stdout || "").trim() || "/usr/local";
    const globalBin = `${npmPrefix}/bin`;
    const homeBin = `${os.homedir() || process.env.HOME || "/root"}/.npm-global/bin`;
    return `${globalBin}:${homeBin}:${process.env.PATH || ""}`;
  } catch {
    return process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  }
})();

function augmentPath(): string {
  return AUGMENTED_PATH;
}

/**
 * Read gateway token — preference order:
 * 1. MC settings table
 * 2. OPENCLAW_GATEWAY_TOKEN env var
 * 3. Direct read from ~/.openclaw/openclaw.json
 */
async function getGatewayToken(): Promise<string | null> {
  try {
    const settings = await storage.getSettings();
    const row = settings.find(s => s.setting_key === "openclaw_gateway_token");
    if (row?.setting_value && typeof row.setting_value === "string" && row.setting_value.length > 0) {
      return row.setting_value;
    }
  } catch { /* storage unavailable */ }

  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;

  return readTokenFromConfigFile();
}

function readTokenFromConfigFile(): string | null {
  try {
    const configPath = OPENCLAW_CONFIG;
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      const t = parsed?.gateway?.auth?.token;
      if (t && typeof t === "string") return t;
    } catch { /* JSON5 */ }
    const match = raw.match(/"token"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Async spawn — captures stdout+stderr without blocking the event loop. */
function spawnAsync(
  cmd: string, args: string[],
  opts: { env: NodeJS.ProcessEnv; timeoutMs: number; onData?: (chunk: string) => void }
): Promise<{ stdout: string; stderr: string; status: number | null; spawnError?: Error }> {
  if (!canSpawnOpenClaw()) {
    return Promise.resolve({ stdout: "", stderr: "", status: null, spawnError: new Error("Too many concurrent OpenClaw processes") });
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(cmd, args, { env: opts.env });

    if (child.pid) trackProcess(child.pid);

    child.stdout.on("data", (d: Buffer) => { const s = d.toString(); stdout += s; opts.onData?.(s); });
    child.stderr.on("data", (d: Buffer) => { const s = d.toString(); stderr += s; opts.onData?.(s); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.pid) untrackProcess(child.pid);
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      resolve({ stdout, stderr, status: null, spawnError: new Error("timeout") });
    }, opts.timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (child.pid) untrackProcess(child.pid);
      clearTimeout(timer);
      resolve({ stdout, stderr, status: code });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (child.pid) untrackProcess(child.pid);
      clearTimeout(timer);
      resolve({ stdout, stderr, status: null, spawnError: err });
    });
  });
}

/** Run openclaw CLI, returning stdout or null on failure */
function runCLI(args: string, timeoutMs = 10000): string | null {
  try {
    const env = { ...openclawEnv(), PATH: augmentPath() };
    const out = execSync(`openclaw ${args}`, { encoding: "utf8", timeout: timeoutMs, env });
    return out.trim();
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────

/**
 * Check OpenClaw is installed and return version + known agents.
 * Uses `openclaw --version` + reads agent directories from ~/.openclaw.
 * Safe to call when OpenClaw is not installed.
 */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const version = runCLI("--version", 5000);
  if (!version) {
    return { reachable: false, agents: [], error: "OpenClaw not installed or not on PATH" };
  }

  // Build agent list from the filesystem (no gateway call needed)
  const agents: OpenClawAgent[] = [];
  try {
    const { readdirSync } = await import("fs");
    const agentsDir = OPENCLAW_AGENTS_DIR;
    if (existsSync(agentsDir)) {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          agents.push({
            id: `openclaw/${entry.name}`,
            name: entry.name,
            object: "model",
          });
        }
      }
    }
  } catch { /* non-fatal */ }

  // Always include the default agent even if the directory scan failed
  if (agents.length === 0) {
    agents.push({ id: "openclaw/main", name: "main", object: "model" });
  }

  return { reachable: true, version, agents };
}

/**
 * Sync MC's agents table with OpenClaw's known agent list.
 */
export async function syncAgents(mcAgents: { id: number; openclaw_id?: string | null }[]): Promise<{
  newOpenclawIds: string[];
  missingOpenclawIds: string[];
}> {
  const status = await getOpenClawStatus();
  if (!status.reachable) return { newOpenclawIds: [], missingOpenclawIds: [] };

  const liveIds = new Set(status.agents.map(a => a.id));
  const mcIds   = new Set(mcAgents.filter(a => a.openclaw_id).map(a => a.openclaw_id as string));

  return {
    newOpenclawIds:     [...liveIds].filter(id => !mcIds.has(id)),
    missingOpenclawIds: [...mcIds].filter(id  => !liveIds.has(id)),
  };
}

/**
 * Send a single-turn message to an OpenClaw agent via CLI.
 *
 * Uses `openclaw agent --agent <id> --message <msg> --local --json`
 * which runs the embedded agent directly without needing the gateway daemon.
 *
 * agentOpenclawId: just the agent name, e.g. "main", "ops", "researcher-abc"
 */
export interface RosterAgent {
  id: number;
  name: string;
  openclaw_id: string | null;
  role?: string;
  skills?: string[];
}

export async function chatWithAgent(
  agentOpenclawId: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; agentRoster?: RosterAgent[]; onData?: (chunk: string) => void } = {}
): Promise<ChatResult> {
  // Extract just the last user message for the CLI --message flag
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  if (!lastUserMsg) {
    return { ok: false, text: "", model: "", error: "No user message provided" };
  }

  // Collapse conversation history into a single prompt for the CLI
  // If there are prior messages, prepend them as context
  const systemMsg = messages.find(m => m.role === "system");
  const history   = messages.filter(m => m !== lastUserMsg && m !== systemMsg);

  let prompt = lastUserMsg.content;
  if (history.length > 0) {
    const ctx = history.map(m => `[${m.role}]: ${m.content}`).join("\n");
    prompt = `${ctx}\n[user]: ${lastUserMsg.content}`;
  }

  // Strip the "openclaw/" prefix if present — CLI takes just the agent name
  const agentName = agentOpenclawId.replace(/^openclaw\//, "");
  const modelId   = `openclaw/${agentName}`;

  // Inject MC tool context for the main/CEO agent.
  // web_fetch blocks localhost, so all MC API calls use exec+curl.
  // Port is read from ~/.openclaw/workspace/.mc_port (written by MC on startup)
  // so it survives nohup/PM2 env stripping.
  if (agentName === "main") {
    let port = process.env.PORT || "5000";
    try {
      const portFile = join(OPENCLAW_WORKSPACE, ".mc_port");
      if (existsSync(portFile)) port = readFileSync(portFile, "utf8").trim();
    } catch { /* use fallback */ }

    const base = `http://localhost:${port}`;
    const H = `-H 'X-MC-Internal: 1' -H 'Content-Type: application/json'`;

    // Read Brave Search API key from settings (if configured)
    let braveApiKey: string | null = null;
    try {
      const allSettings = await storage.getSettings();
      const sp = allSettings.find(s => s.setting_key === "search_providers");
      if (sp?.setting_value) {
        const parsed = typeof sp.setting_value === "object"
          ? sp.setting_value as any
          : JSON.parse(sp.setting_value as string);
        const key = parsed?.brave?.apiKey;
        if (key && typeof key === "string" && key.length > 0) braveApiKey = key;
      }
    } catch { /* non-fatal */ }

    // Inject known agent roster so CEO never needs a list round-trip.
    // Skills + role are included so CEO can delegate intelligently.
    const rosterLines = opts.agentRoster?.length
      ? [
          `AGENT ROSTER — always delegate to an existing agent before creating a new one:`,
          `  Rule 1: Pick the agent whose role/skills best match the task.`,
          `  Rule 2: If an agent is close but missing a skill, use append-skill to extend them.`,
          `  Rule 3: Only use create-agent if NO existing agent can be adapted. Never clone.`,
          ``,
          ...opts.agentRoster.map(a => {
            const skillStr = a.skills?.length ? ` [${a.skills.join(", ")}]` : "";
            const roleStr  = a.role ? ` — ${a.role}` : "";
            return `  ID:${a.id} "${a.name}"${a.openclaw_id ? ` (${a.openclaw_id})` : ""}${roleStr}${skillStr}`;
          }),
          ``,
        ]
      : [];

    // Brave Search tool — injected only when a key is configured
    const searchLines = braveApiKey
      ? [
          `Web Search (Brave — use instead of DuckDuckGo):`,
          `  curl -s "https://api.search.brave.com/res/v1/web/search?q=QUERY&count=5" \\`,
          `    -H "Accept: application/json" -H "X-Subscription-Token: ${braveApiKey}"`,
          `  Parse .web.results[].title/.url/.description from the JSON response.`,
          ``,
        ]
      : [];

    const mcCtx = [
      `[Mission Control — Team Management Tools]`,
      ``,
      `CRITICAL — READ BEFORE ACTING:`,
      `  You are the CEO. Your job is to DO the work, not outsource it.`,
      `  Use your native capabilities (curl, bash, web search) to complete the actual task.`,
      `  MC tools below are ONLY for: persisting results, managing team roles, and scheduling future work.`,
      `  NEVER create a new agent to do the current task — that is YOUR job.`,
      `  NEVER mark a task done without having done the actual work first.`,
      ``,
      `WORKFLOW for any task:`,
      `  1. Do the research/work yourself using curl/bash/search`,
      `  2. Save key findings: POST memory-write`,
      `  3. If follow-up work fits an existing agent's role, delegate via create-task`,
      `  4. Log completion: POST log-activity`,
      ``,
      `MEMORY: Check memory-search before starting — avoid re-doing prior research.`,
      `All MC calls use: curl -s ... ${H}`,
      ``,
      ...rosterLines,
      ...searchLines,
      `POST ${base}/api/tools/memory-write       {"key":"slug_name","value":"findings...","tags":["tag1"]}`,
      `GET  ${base}/api/tools/memory-search?q=QUERY`,
      `POST ${base}/api/tools/create-task        {"title","agentId":ID,"description","priority"}  ← delegate follow-up only`,
      `POST ${base}/api/tools/log-activity       {"type":"task_completed","message":"..."}`,
      `POST ${base}/api/tools/schedule-task      {"name","agentId":ID,"cron":"0 9 * * 1","description"}`,
      `GET  ${base}/api/tools/token-usage?period=month`,
      `GET  ${base}/api/tools/agents`,
      `POST ${base}/api/tools/create-agent       {"name","role","soul","skills":[]}  ← permanent new role only`,
      `PATCH ${base}/api/tools/update-soul       {"agentId":ID,"soul":"..."}`,
      `POST ${base}/api/tools/append-skill       {"agentId":ID,"skill":"..."}`,
      `[end MC tools]\n`,
    ].join("\n");
    prompt = mcCtx + prompt;
  }

  const env = { ...openclawEnv(), PATH: augmentPath() };
  // OpenClaw's own agentic loop handles multi-turn tool calls internally.
  // Its default timeout is 600s — we give it 660s so our wrapper never fires
  // before openclaw's own timeout does. Never use a shorter timeout here or
  // we'll kill mid-research.
  const timeoutMs = 660_000;

  // Use async spawn — keeps the Node.js event loop alive while OpenClaw runs.
  // spawnSync would block the entire server for the duration of the AI call.
  const spawnResult = await spawnAsync(
    "openclaw",
    ["agent", "--agent", agentName, "--message", prompt, "--local", "--json", "--timeout", "600"],
    { env, timeoutMs, onData: opts.onData }
  );

  const rawOut = (spawnResult.stdout || "").trim();
  const rawErr = (spawnResult.stderr || "").trim();

  // If the process failed to even start (ENOENT etc.)
  if (spawnResult.spawnError) {
    return { ok: false, text: "", model: modelId, error: spawnResult.spawnError.message };
  }

  // OpenClaw mixes log lines with JSON in stderr, e.g.:
  //   [agent/embedded] embedded run agent end: ... isError=true ...\n{ "payloads": [...] }
  // Extract just the JSON object by finding the first '{'.
  function extractJson(raw: string): any | null {
    const start = raw.indexOf("{");
    if (start === -1) return null;
    try { return JSON.parse(raw.slice(start)); } catch { return null; }
  }

  // Try stdout first, then stderr
  let parsed: any = extractJson(rawOut) ?? extractJson(rawErr);

  let text = "";
  let usage: ChatResult["usage"] | undefined;

  if (parsed) {
    // OpenClaw --json output shape variations:
    //   Standard: { reply, text, response, output }
    //   Payloads: { payloads: [{ text: "..." }] }
    //
    // The agentic loop produces multiple payloads — one per assistant turn.
    // Concatenate ALL real payloads (skip HEARTBEAT_OK pings) to get the
    // full multi-step output rather than just the first turn.
    const realPayloads = parsed.payloads
      ?.filter((p: any) => p?.text && p.text !== "HEARTBEAT_OK")
      ?.map((p: any) => p.text as string) ?? [];

    const allPayloadsText = realPayloads.join("\n\n---\n\n");

    text = parsed.reply
        ?? parsed.text
        ?? parsed.response
        ?? parsed.output
        ?? allPayloadsText
        ?? parsed.payloads?.[0]?.text  // fallback: even HEARTBEAT_OK if nothing better
        ?? "";

    // If it's ONLY a bare HEARTBEAT_OK with no other content, that means
    // the agent pinged itself (e.g. message was "hi") — return it as-is so
    // the user sees a response rather than an error.
    // (A real provider failure returns isError=true in the log line above the JSON.)

    // Usage may be at parsed.usage (standard) or parsed.meta.agentMeta.usage (payloads format)
    const usageRaw = parsed.usage ?? parsed.meta?.agentMeta?.usage;
    if (usageRaw) {
      usage = {
        prompt_tokens:     usageRaw.promptTokens  ?? usageRaw.prompt_tokens  ?? usageRaw.input  ?? 0,
        completion_tokens: usageRaw.completionTokens ?? usageRaw.completion_tokens ?? usageRaw.output ?? 0,
        total_tokens:      usageRaw.totalTokens   ?? usageRaw.total_tokens   ?? usageRaw.total  ?? 0,
      };
    }
  } else {
    // No JSON — use whatever raw output we have
    text = rawOut || rawErr;
  }

  // Non-zero exit with no parseable text = CLI error
  if (spawnResult.status !== 0 && !text) {
    return { ok: false, text: "", model: modelId, error: rawErr || rawOut || "openclaw CLI error" };
  }

  return { ok: !!text, text, model: modelId, usage };
}

/**
 * Register a new agent in OpenClaw via CLI.
 * Creates the workspace directory and agent entry in openclaw.json.
 */
export async function addOpenClawAgent(
  openclawId: string,
  soul: string | null
): Promise<{ ok: boolean; openclawId: string; error?: string }> {
  try {
    const workspace = join(OPENCLAW_AGENTS_DIR, openclawId, "workspace");
    runCLI(`agents add ${openclawId} --non-interactive --workspace ${workspace}`, 15000);

    // Deploy SOUL.md to the agent's workspace
    if (soul) {
      const { writeFileSync, mkdirSync } = await import("fs");
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, "SOUL.md"), soul, "utf8");
    }

    return { ok: true, openclawId };
  } catch (err: any) {
    // Agent may already exist — that's fine
    if (err.message?.includes("already exists") || err.message?.includes("already configured")) {
      return { ok: true, openclawId };
    }
    return { ok: false, openclawId, error: err.message };
  }
}

/**
 * Write (or overwrite) an agent's SOUL.md in its OpenClaw workspace.
 */
export async function deployAgentSoul(openclawId: string, soul: string): Promise<boolean> {
  try {
    const { writeFileSync, mkdirSync } = await import("fs");
    const isDefault = openclawId === "default" || openclawId === "main";
    const dir = isDefault
      ? OPENCLAW_WORKSPACE
      : join(OPENCLAW_AGENTS_DIR, openclawId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SOUL.md"), soul, "utf8");
    return true;
  } catch {
    return false;
  }
}
