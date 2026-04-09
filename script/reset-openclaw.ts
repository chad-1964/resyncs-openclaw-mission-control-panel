/**
 * reset-openclaw.ts
 * Wipes the local OpenClaw install back to a clean slate for install testing.
 * Also clears the OpenClaw-related keys from MC's settings table.
 *
 * Usage:
 *   npm run reset-openclaw              # backup ~/.openclaw → ~/.openclaw.bak, clear MC settings
 *   npm run reset-openclaw -- --hard    # delete ~/.openclaw entirely (no backup)
 *   npm run reset-openclaw -- --mc-only # only clear MC settings, leave ~/.openclaw alone
 *
 * After running, do a fresh install test with:
 *   npm run reset-setup:full            # wipe MC setup wizard state
 *   npm run install-openclaw            # reinstall + re-onboard OpenClaw
 *   # then visit the app and walk through the setup wizard
 *
 * IMPORTANT: This is a destructive dev/test tool. Never run on a live install
 * without --mc-only.
 */

import "dotenv/config";
import { execSync, spawnSync } from "child_process";
import { existsSync, renameSync, rmSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";

const HARD   = process.argv.includes("--hard");
const MC_ONLY = process.argv.includes("--mc-only");

// Settings keys that belong to the OpenClaw integration
const OPENCLAW_SETTING_KEYS = [
  "openclaw_gateway_token",
  "openclaw_gateway_url",
  "openclaw_last_sync",
];

function openclawDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/root";
  return join(home, ".openclaw");
}

function run(cmd: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

async function clearMcSettings(): Promise<void> {
  if (!process.env.DB_NAME || !process.env.DB_USER) {
    console.warn("⚠️   DB env vars not set — cannot clear MC settings. Check .env file.");
    return;
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
  });
  const placeholders = OPENCLAW_SETTING_KEYS.map(() => "?").join(", ");
  const [result]: any = await conn.execute(
    `DELETE FROM settings WHERE setting_key IN (${placeholders})`,
    OPENCLAW_SETTING_KEYS
  );
  await conn.end();
  console.log(`  ✅ Cleared ${result.affectedRows} OpenClaw setting(s) from MC DB`);
}

async function main() {
  console.log("🔄  OpenClaw Reset Tool\n");

  // ── Stop gateway if running ──────────────────────────
  if (!MC_ONLY) {
    console.log("⏹   Stopping OpenClaw gateway (if running)...");
    run("pm2 stop openclaw-gateway 2>/dev/null || true");
    run("pkill -f 'openclaw gateway' 2>/dev/null || true");
    console.log("   Done (no error if it wasn't running).");
  }

  // ── Wipe ~/.openclaw ─────────────────────────────────
  if (!MC_ONLY) {
    const dir = openclawDir();
    if (existsSync(dir)) {
      if (HARD) {
        console.log(`🗑   Deleting ${dir} (--hard)...`);
        rmSync(dir, { recursive: true, force: true });
        console.log("  ✅ Deleted.");
      } else {
        const bak = `${dir}.bak`;
        // Remove stale backup first
        if (existsSync(bak)) rmSync(bak, { recursive: true, force: true });
        console.log(`📦  Backing up ${dir} → ${bak}...`);
        renameSync(dir, bak);
        console.log("  ✅ Backed up. Original is gone, backup at .openclaw.bak");
      }
    } else {
      console.log(`ℹ️   ${dir} does not exist — nothing to wipe.`);
    }
  }

  // ── Clear MC settings ────────────────────────────────
  console.log("🧹  Clearing OpenClaw keys from MC settings table...");
  await clearMcSettings();

  console.log("\n✅  OpenClaw reset complete.");
  console.log("\nNext steps for a clean install test:");
  console.log("  1. npm run reset-setup:full     — wipe MC setup wizard state");
  console.log("  2. npm run install-openclaw     — fresh OpenClaw install + token read");
  console.log("  3. Visit the app and walk through the setup wizard");
}

main().catch((err) => {
  console.error("❌  reset-openclaw failed:", err.message);
  process.exit(1);
});
