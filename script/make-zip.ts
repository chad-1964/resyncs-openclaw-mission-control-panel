/**
 * make-zip.ts
 * Builds Mission Control and packages it into a distributable zip.
 *
 * The zip includes a pre-built dist/ so the PHP web installer only
 * needs to write .env, run migrate, and start Node — no compile step
 * during customer install. Customer experience: enter DB creds → app
 * launches in ~5 seconds → React wizard takes over.
 *
 * Usage:  npm run make-zip
 * Output: mission-control-v{version}.zip
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { resolve } from "path";

const root = resolve(process.cwd());
const pkg  = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const ver  = pkg.version || "1.0.0";
const name = `mission-control-v${ver}`;
const zip  = resolve(root, `${name}.zip`);

// Directories/files to EXCLUDE from the zip
// Note: dist/ is INCLUDED (pre-built for instant customer install)
// Note: node_modules is EXCLUDED — customer runs npm install --omit=dev
const EXCLUDE = [
  ".git",
  "node_modules",
  ".env",
  "*.env.local",
  "install.log",
  "*.pid",
  "logs",
  ".installed",
  ".installer-meta",
  "mission-control-v*.zip",
  "mission-control-v*.tar.gz",
  ".DS_Store",
  "__MACOSX",
];

function run(cmd: string, label: string) {
  process.stdout.write(`  ${label}... `);
  try {
    execSync(cmd, { cwd: root, stdio: "pipe" });
    console.log("✓");
  } catch (e: any) {
    console.log("✗");
    console.error(e.stderr?.toString() || e.message);
    process.exit(1);
  }
}

console.log(`\n📦  Mission Control v${ver} — building distributable zip\n`);

// ── Step 1: Clean old artifacts ───────────────────────────────
process.stdout.write("  Cleaning old build... ");
try { rmSync(resolve(root, "dist"), { recursive: true, force: true }); } catch {}
try { execSync(`rm -f "${zip}"`, { cwd: root }); } catch {}
console.log("✓");

// ── Step 2: Production build ──────────────────────────────────
run("npm run build", "Building server + client (esbuild + vite)");

if (!existsSync(resolve(root, "dist/index.cjs"))) {
  console.error("✗  Build failed — dist/index.cjs not found");
  process.exit(1);
}

// ── Step 3: Zip ───────────────────────────────────────────────
process.stdout.write("  Creating zip... ");
const excludeFlags = EXCLUDE.map(p => `--exclude='./${p}' --exclude='*/${p}/*' --exclude='*/${p}'`).join(" ");
try {
  execSync(`zip -r "${zip}" . ${excludeFlags}`, { cwd: root, stdio: "pipe" });
  console.log("✓");
} catch {
  // Fallback to tar.gz
  console.log("(zip not found, using tar.gz)");
  const tar = resolve(root, `${name}.tar.gz`);
  const excludeTar = EXCLUDE.map(p => `--exclude='./${p}'`).join(" ");
  execSync(`tar czf "${tar}" ${excludeTar} .`, { cwd: root, stdio: "pipe" });
  const size = execSync(`du -sh "${tar}"`).toString().split("\t")[0];
  console.log(`\n✅  Created: ${name}.tar.gz  (${size})\n`);
  process.exit(0);
}

// ── Summary ───────────────────────────────────────────────────
const size = execSync(`du -sh "${zip}"`).toString().split("\t")[0].trim();
console.log(`\n✅  ${name}.zip — ${size}`);
console.log(`\n  Install flow for customers:`);
console.log(`  1. Extract zip to subdomain directory`);
console.log(`  2. Visit subdomain → PHP installer collects DB creds`);
console.log(`  3. Node.js starts (no build wait — dist/ is pre-built)`);
console.log(`  4. React Setup Wizard handles the rest\n`);
