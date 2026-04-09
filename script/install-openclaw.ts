/**
 * install-openclaw.ts
 * Installs OpenClaw globally and seeds the ~/.openclaw workspace from
 * bundled starter files if this is a fresh install. Reads/generates a
 * unique gateway token and saves it to Mission Control's settings table.
 *
 * Strategy:
 *   - If ~/.openclaw/openclaw.json EXISTS  → preserve everything (idempotent)
 *   - If ~/.openclaw/openclaw.json MISSING → copy openclaw-starter/ files +
 *     generate a unique token → write openclaw.json
 *   - The AI provider API key is written separately by /api/setup/complete
 *
 * Usage:
 *   npm run install-openclaw              # install + seed if needed
 *   npm run install-openclaw -- --check   # verify only, no changes
 */

import "dotenv/config";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const CHECK_ONLY = process.argv.includes("--check");
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ─────────────────────────────────────────────

function run(cmd: string, opts: { fatal?: boolean } = {}): { ok: boolean; out: string; err: string } {
  // Set HOME to project dir so openclaw uses .openclaw/ locally, not ~/.openclaw/
  const env = { ...process.env, HOME: process.cwd(), OPENCLAW_STATE_DIR: openclawDir() };
  const result = spawnSync(cmd, { shell: true, encoding: "utf8", env });
  const ok = result.status === 0;
  if (!ok && opts.fatal) {
    console.error(`❌  Command failed: ${cmd}\n${result.stderr}`);
    process.exit(1);
  }
  return { ok, out: (result.stdout || "").trim(), err: (result.stderr || "").trim() };
}

function openclawDir(): string {
  // OpenClaw lives inside the project directory, not ~/.openclaw/
  return join(process.cwd(), ".openclaw");
}

function openclawConfigPath(): string {
  return join(openclawDir(), "openclaw.json");
}

/** Read gateway token from ~/.openclaw/openclaw.json */
function readGatewayToken(): string | null {
  const configPath = openclawConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.gateway?.auth?.token;
      if (token && typeof token === "string") return token;
    } catch { /* JSON5 with comments */ }
    const match = raw.match(/"token"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Generate a unique gateway token: oc_ + 40 random hex bytes */
function generateToken(): string {
  return "oc_" + randomBytes(40).toString("hex");
}

/**
 * Seed ~/.openclaw from the bundled openclaw-starter/ directory.
 * Only copies files that don't already exist, preserving any user edits.
 */
function seedStarterFiles(): void {
  // openclaw-starter/ lives at the repo root, one level up from script/
  const starterDir = join(__dirname, "..", "openclaw-starter");
  if (!existsSync(starterDir)) {
    console.warn(`⚠️   openclaw-starter/ not found at ${starterDir} — skipping seed`);
    return;
  }

  const dest = openclawDir();
  mkdirSync(dest, { recursive: true });

  // Copy workspace files (skip if destination already has them — preserves user edits)
  const workspaceSrc  = join(starterDir, "workspace");
  const workspaceDest = join(dest, "workspace");
  if (existsSync(workspaceSrc) && !existsSync(workspaceDest)) {
    cpSync(workspaceSrc, workspaceDest, { recursive: true });
    console.log("  ✅ Seeded workspace/ files");
  }

  // Copy agents/main/agent structure (auth-profiles.json + models.json stubs)
  // setup/complete will overwrite these with the actual API key
  const agentSrc  = join(starterDir, "agents");
  const agentDest = join(dest, "agents");
  if (existsSync(agentSrc) && !existsSync(agentDest)) {
    cpSync(agentSrc, agentDest, { recursive: true });
    console.log("  ✅ Seeded agents/ structure");
  }
}

/** Write openclaw.json from template, inserting a fresh token */
function writeOpenclawConfig(token: string): void {
  const templatePath = join(__dirname, "..", "openclaw-starter", "openclaw.json.template");
  let content: string;

  if (existsSync(templatePath)) {
    content = readFileSync(templatePath, "utf8").replace("{{TOKEN}}", token);
  } else {
    // Fallback inline template
    content = JSON.stringify({
      gateway: { mode: "local", auth: { mode: "token", token } },
      agents:  { defaults: { model: "openrouter/auto" } },
    }, null, 2) + "\n";
  }

  const configPath = openclawConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, content, "utf8");
  console.log(`  ✅ Wrote openclaw.json (token: ${token.slice(0, 8)}...${token.slice(-4)})`);
}

function isOpenclawInstalled(): boolean {
  return run("openclaw --version").ok;
}

// ── DB helper — save token to settings ──────────────────

async function saveTokenToDb(token: string): Promise<void> {
  if (!process.env.DB_NAME || !process.env.DB_USER) {
    console.warn("⚠️   DB env vars not set — token not saved to DB. Set manually in Settings.");
    return;
  }
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || "localhost",
    port:     parseInt(process.env.DB_PORT || "3306"),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
  });
  await conn.execute(
    `INSERT INTO settings (setting_key, setting_value)
     VALUES ('openclaw_gateway_token', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [JSON.stringify(token)]
  );
  await conn.execute(
    `INSERT INTO settings (setting_key, setting_value)
     VALUES ('openclaw_gateway_url', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [JSON.stringify("http://127.0.0.1:18789")]
  );
  await conn.end();
  console.log("  ✅ Token saved to MC settings table");
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log("🦞 OpenClaw Integration Setup\n");

  // ── Step 1: Check existing install ──────────────────
  const alreadyInstalled = isOpenclawInstalled();

  if (CHECK_ONLY) {
    if (alreadyInstalled) {
      const v = run("openclaw --version");
      console.log(`✅  OpenClaw installed: ${v.out}`);
      const token = readGatewayToken();
      console.log(token
        ? `✅  Gateway token found in openclaw.json`
        : `⚠️   No gateway token found — config will be seeded on next run`
      );
    } else {
      console.log("❌  OpenClaw not installed. Run: npm run install-openclaw");
    }
    process.exit(alreadyInstalled ? 0 : 1);
  }

  // ── Step 2: Install / upgrade openclaw npm package ──
  // Augment PATH first so openclaw is findable after install
  const npmPrefix = run("npm config get prefix").out || "/usr/local";
  const globalBin = `${npmPrefix}/bin`;
  const homeBin   = `${process.env.HOME || "/root"}/.npm-global/bin`;
  process.env.PATH = `${globalBin}:${homeBin}:${process.env.PATH || ""}`;

  let skipInstall = false;
  if (alreadyInstalled) {
    const current = run("openclaw --version").out;
    const latest  = run("npm view openclaw version 2>/dev/null").out;
    const curVer  = current.match(/\d+\.\d+\.\d+/)?.[0] ?? "";
    if (curVer && latest && curVer === latest) {
      console.log(`✅  OpenClaw already up to date: ${current}`);
      skipInstall = true;
    } else {
      console.log(`✅  OpenClaw installed: ${current}`);
      console.log(`   Update available: ${latest} — upgrading…`);
    }
  } else {
    console.log("📦  Installing OpenClaw globally (npm install -g openclaw@latest)…");
  }

  if (!skipInstall) {
    const install = run("npm install -g openclaw@latest");
    if (!install.ok) {
      console.warn("⚠️   Global install failed, trying with user prefix...");
      run("npm config set prefix ~/.npm-global");
      run("npm install -g openclaw@latest", { fatal: true });
    }

    if (!run("openclaw --version").ok) {
      const which = run(`find "${globalBin}" "${homeBin}" -name "openclaw" 2>/dev/null | head -1`);
      if (which.out) {
        process.env.PATH = `${dirname(which.out)}:${process.env.PATH}`;
      } else {
        console.error("❌  openclaw command not found after install. Check your PATH.");
        process.exit(1);
      }
    }
    console.log(`✅  OpenClaw installed: ${run("openclaw --version").out}`);
  }

  // ── Step 3: Seed workspace files + generate token ───
  // If openclaw.json already exists, the install is already onboarded — preserve it.
  const configPath = openclawConfigPath();
  const alreadyOnboarded = existsSync(configPath);

  if (alreadyOnboarded) {
    console.log(`✅  OpenClaw config found — preserving existing install`);
  } else {
    console.log("🌱  Fresh install — seeding workspace from bundled starter files...");
    seedStarterFiles();

    const token = generateToken();
    writeOpenclawConfig(token);
    console.log("   Seeding complete. AI provider key will be set by setup wizard.");
  }

  // ── Step 4: Read token and save to DB ───────────────
  const token = readGatewayToken();
  if (token) {
    console.log(`✅  Gateway token ready (${token.slice(0, 8)}...${token.slice(-4)})`);
    await saveTokenToDb(token);
  } else {
    console.warn("⚠️   Could not read gateway token — unexpected state.");
    console.warn("    Check ~/.openclaw/openclaw.json manually.");
  }

  console.log(`\n✅  OpenClaw ready.`);
  console.log(`   Gateway: http://127.0.0.1:18789`);
  console.log(`   Start with: openclaw gateway`);
  console.log(`   Or via PM2: pm2 start "openclaw gateway" --name openclaw-gateway`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌  install-openclaw failed:", err.message);
  process.exit(1);
});
