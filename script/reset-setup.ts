/**
 * reset-setup.ts
 * Clears setup_complete from the settings table so the Setup Wizard
 * runs again on next visit. Useful for testing and customer resets.
 *
 * Usage:
 *   npx tsx script/reset-setup.ts
 *
 * --full   Wipe all wizard-saved settings (admin, db config, ai_models, etc.)
 * --nuke   Full wipe of ALL data tables (agents, tasks, schedules, etc.)
 *          Use for a true clean install test. Implies --full.
 *   npx tsx script/reset-setup.ts --full
 *   npx tsx script/reset-setup.ts --nuke
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const SETUP_KEYS = [
  "setup_complete",
  "setup_completed_at",
];

const FULL_KEYS = [
  ...SETUP_KEYS,
  "admin_name",
  "admin_email",
  "admin_password_hash",
  "license_key",
  "db_host",
  "db_port",
  "db_name",
  "db_user",
  "db_type",
  "ai_models",
  "chat_providers",
  "domain",
  "auto_ssl",
  "http_port",
  "https_port",
  "agent_preset",
  // OpenClaw integration — reset token so wizard re-reads it on next install
  "openclaw_gateway_token",
  "openclaw_last_sync",
  "public_url",
  // Note: openclaw_gateway_url is intentionally NOT cleared — it's always 127.0.0.1:18789
];

// Tables wiped in order (respects FK constraints)
const NUKE_TABLES = [
  "activity_log",
  "cost_entries",
  "reports",
  "tasks",
  "schedules",
  "agents",
  "integrations",
  "settings",
];

async function main() {
  const full = process.argv.includes("--full") || process.argv.includes("--nuke");
  const nuke = process.argv.includes("--nuke");
  const keys = full ? FULL_KEYS : SETUP_KEYS;

  if (!process.env.DB_NAME || !process.env.DB_USER) {
    console.error("❌  DB_NAME and DB_USER env vars required. Check your .env file.");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
  });

  if (nuke) {
    // Wipe all data tables for a true clean install test
    await conn.execute("SET FOREIGN_KEY_CHECKS=0");
    for (const table of NUKE_TABLES) {
      await conn.execute(`TRUNCATE TABLE \`${table}\``);
    }
    await conn.execute("SET FOREIGN_KEY_CHECKS=1");
    await conn.end();
    console.log("✅  Full nuke complete — all tables cleared");
    console.log(`   Tables wiped: ${NUKE_TABLES.join(", ")}`);
    console.log("   Run npm run migrate next to re-seed.");
    return;
  }

  const placeholders = keys.map(() => "?").join(", ");
  const [result]: any = await conn.execute(
    `DELETE FROM settings WHERE setting_key IN (${placeholders})`,
    keys,
  );

  await conn.end();

  console.log(`✅  Setup reset complete (${full ? "full" : "minimal"})`);
  console.log(`   Removed ${result.affectedRows} setting(s): ${keys.join(", ")}`);
  console.log(`   Refresh the app — Setup Wizard will appear.`);
}

main().catch((err) => {
  console.error("❌  Reset failed:", err.message);
  process.exit(1);
});
