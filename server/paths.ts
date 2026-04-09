/**
 * Centralized path configuration — all OpenClaw paths are project-local.
 *
 * RULE: OpenClaw lives INSIDE the MC project directory, never in ~/.openclaw/.
 * This ensures:
 * - Multiple MC installs on the same server don't conflict
 * - Uninstalling MC is just deleting the folder
 * - Customers can move/copy the entire directory
 * - Virgin installs are truly isolated
 *
 * Structure:
 *   {projectDir}/
 *   ├── .openclaw/           ← OpenClaw home (NOT ~/.openclaw/)
 *   │   ├── openclaw.json
 *   │   ├── workspace/
 *   │   │   ├── SOUL.md
 *   │   │   ├── skills/
 *   │   │   └── memory/
 *   │   └── agents/
 *   │       ├── main/
 *   │       ├── ops/
 *   │       └── ...
 *   ├── server/
 *   ├── client/
 *   ├── dist/
 *   └── .env
 */

import { join } from "path";

/** The MC project root directory (where package.json lives) */
export const PROJECT_DIR = process.cwd();

/** OpenClaw home — project-local, not global */
export const OPENCLAW_HOME = join(PROJECT_DIR, ".openclaw");

/** OpenClaw workspace (shared workspace for the default/main agent) */
export const OPENCLAW_WORKSPACE = join(OPENCLAW_HOME, "workspace");

/** OpenClaw agents directory */
export const OPENCLAW_AGENTS_DIR = join(OPENCLAW_HOME, "agents");

/** OpenClaw config file */
export const OPENCLAW_CONFIG = join(OPENCLAW_HOME, "openclaw.json");

/** Get the workspace path for a specific agent */
export function agentWorkspace(agentId: string): string {
  if (agentId === "main" || agentId === "default") {
    return OPENCLAW_WORKSPACE;
  }
  return join(OPENCLAW_AGENTS_DIR, agentId, "workspace");
}

/** Get the agent directory for a specific agent */
export function agentDir(agentId: string): string {
  return join(OPENCLAW_AGENTS_DIR, agentId);
}

/** Get the skills directory */
export function skillsDir(): string {
  return join(OPENCLAW_WORKSPACE, "skills");
}

/** Get the memory directory */
export function memoryDir(): string {
  return join(OPENCLAW_WORKSPACE, "memory");
}

/**
 * Environment variables to pass to OpenClaw CLI so it uses our local .openclaw/.
 * OpenClaw reads HOME to find ~/.openclaw/ — we point HOME to PROJECT_DIR
 * so it finds {PROJECT_DIR}/.openclaw/ instead.
 * Also sets OPENCLAW_STATE_DIR as an explicit override.
 */
export function openclawEnv(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    HOME: PROJECT_DIR,
    OPENCLAW_STATE_DIR: OPENCLAW_HOME,
  };
}
