<?php
/**
 * Mission Control — PHP Bootstrap / Step 1 of the Setup Wizard
 *
 * Styled to be visually identical to the React wizard so the customer
 * feels like they are already inside the app from the moment they extract
 * the zip. Handles DB credentials + connection test, writes .env, starts
 * Node, then redirects to /?installer=1 so React picks up at Step 2 (Admin).
 *
 * After installation the lock-check at the top redirects / immediately,
 * so this file never interferes with normal app access.
 */

define('MC_DIR',  __DIR__);
define('MC_ENV',  MC_DIR . '/.env');
define('MC_LOG',  MC_DIR . '/install.log');
define('MC_LOCK', MC_DIR . '/.installed');

// ── Ensure .htaccess exists (cPanel needs PHP handler to avoid redirect loops) ──
$htFile = MC_DIR . '/.htaccess';
$htDefault = MC_DIR . '/.htaccess.default';
if (!file_exists($htFile) && file_exists($htDefault)) {
    copy($htDefault, $htFile);
}

// ── Helpers ────────────────────────────────────────────────────

function env_val(string $key, string $default = ''): string {
    if (!file_exists(MC_ENV)) return $default;
    foreach (file(MC_ENV, FILE_IGNORE_NEW_LINES) as $line) {
        if (str_starts_with(trim($line), "$key="))
            return trim(substr(trim($line), strlen($key) + 1));
    }
    return $default;
}

function can_exec(): bool {
    if (!function_exists('exec')) return false;
    $d = ini_get('disable_functions');
    return !str_contains($d, 'exec') && !str_contains($d, 'shell_exec');
}

function find_bin(string $name): string {
    foreach ([
        "/usr/local/bin/$name", "/usr/bin/$name", "/bin/$name",
        "/opt/cpanel/ea-nodejs22/bin/$name",
        "/opt/cpanel/ea-nodejs20/bin/$name",
        "/opt/cpanel/ea-nodejs18/bin/$name",
    ] as $p) { if (file_exists($p)) return $p; }
    if (can_exec()) {
        $f = trim(shell_exec("which $name 2>/dev/null") ?? '');
        if ($f) return $f;
    }
    return $name;
}

function find_free_port(int $start = 5000): int {
    for ($p = $start; $p < 6000; $p++) {
        $c = @fsockopen('127.0.0.1', $p, $e, $m, 0.1);
        if (!$c) return $p;
        fclose($c);
    }
    return $start;
}

function app_alive(int $port): bool {
    // Check if the API actually responds (not just port open)
    $ctx = stream_context_create(['http' => ['timeout' => 2, 'method' => 'GET']]);
    $body = @file_get_contents("http://127.0.0.1:$port/api/setup/status", false, $ctx);
    return $body !== false && str_contains($body, 'isSetupComplete');
}

function write_htaccess(int $port): void {
    $ht = MC_DIR . '/.htaccess';
    $b  = "\n# ── Mission Control proxy — BEGIN ──\n"
        . "<IfModule mod_rewrite.c>\n"
        . "  RewriteEngine On\n"
        . "  RewriteRule ^index\\.php$ - [L]\n"
        . "  RewriteRule ^$ http://127.0.0.1:$port/ [P,L]\n"
        . "  RewriteCond %{REQUEST_FILENAME} !-f\n"
        . "  RewriteCond %{REQUEST_FILENAME} !-d\n"
        . "  RewriteRule ^(.*)$ http://127.0.0.1:$port/\$1 [P,L]\n"
        . "</IfModule>\n"
        . "<IfModule mod_proxy.c>\n"
        . "  ProxyPassReverse / http://127.0.0.1:$port/\n"
        . "</IfModule>\n"
        . "# ── Mission Control proxy — END ──\n";
    $existing = file_exists($ht) ? file_get_contents($ht) : '';
    $existing = preg_replace('/\n# ── Mission Control proxy — BEGIN ──.*?# ── Mission Control proxy — END ──\n/s', '', $existing);
    // Put Mission Control rules FIRST so the index.php exemption fires before any pre-existing catch-all rules
    file_put_contents($ht, $b . $existing);
}

// ── AJAX: Test DB connection ──────────────────────────────────
if (($_GET['action'] ?? '') === 'test') {
    header('Content-Type: application/json');
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $host  = trim($input['host']     ?? 'localhost');
    $dport = (int)($input['port']    ?? 3306);
    $name  = trim($input['database'] ?? '');
    $user  = trim($input['user']     ?? '');
    $pass  = $input['password']      ?? '';

    if (!$name || !$user) {
        echo json_encode(['success' => false, 'message' => 'Database name and username are required.']);
        exit;
    }
    try {
        $dsn = "mysql:host=$host;port=$dport;dbname=$name;charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass,
                       [PDO::ATTR_TIMEOUT => 5, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $row = $pdo->query("SELECT VERSION() AS v")->fetch(PDO::FETCH_ASSOC);
        $ver = $row['v'] ?? '';
        $type = stripos($ver, 'mariadb') !== false ? 'mariadb' : 'mysql';
        echo json_encode(['success' => true, 'message' => "Connected — $ver", 'detectedType' => $type]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

// ── Ping: is Node alive yet? ──────────────────────────────────
if (($_GET['ping'] ?? '') === '1') {
    $port = (int) env_val('PORT', '5000');
    $log = '';
    if (file_exists(MC_LOG)) {
        $raw = implode('', array_slice(file(MC_LOG), -60));
        // Strip ANSI escape codes (colour, bold, reset etc.)
        $raw = preg_replace('/\x1B\[[0-9;]*[A-Za-z]/u', '', $raw);
        // Strip box-drawing / table chars that clutter the log view
        $raw = preg_replace('/[┌┐└┘├┤┬┴┼─│╔╗╚╝╠╣╦╩╬═║]/u', '', $raw);
        // Collapse runs of whitespace left by stripped chars
        $raw = preg_replace('/[ \t]{3,}/', '  ', $raw);
        $log = trim($raw);
    }
    header('Content-Type: application/json');
    echo json_encode(['up' => app_alive($port), 'log' => $log]);
    exit;
}

// ── Already installed & running? Redirect to app ──────────────
if (file_exists(MC_LOCK) && app_alive((int) env_val('PORT', '5000'))) {
    header('Location: /'); exit;
}

// ── Polling page (GET ?starting=1) — check if Node is alive yet ──
// Uses PHP-side fsockopen so the proxy never intercepts it.
if (($_GET['starting'] ?? '') === '1') {
    $port = (int) env_val('PORT', '5000');
    if (app_alive($port)) {
        header('Location: /?installer=1'); exit;
    }
    // Not up yet — fall through to render the spinner ($state set below)
}

// ── Handle form POST (final submit after test passes) ─────────
$error = '';
$state = 'form';
$port  = find_free_port(5000);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $dbType= trim($_POST['db_type'] ?? 'mariadb');

    if ($dbType === 'sqlite') {
        // SQLite — no credentials needed, write minimal .env
        $port   = find_free_port((int)($_POST['port'] ?? 5000));
        $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'true' : 'false';
        $secret = bin2hex(random_bytes(32));
        $domain = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $pm2n   = 'mc-' . preg_replace('/[^a-zA-Z0-9]/', '-', $domain);

        file_put_contents(MC_ENV, implode("\n", [
            "# Mission Control — generated " . date('c'),
            "NODE_ENV=production",
            "PORT=$port",
            "HTTPS=$https",
            "",
            "DB_TYPE=sqlite",
            "",
            "SESSION_SECRET=$secret",
            "GITHUB_REPO=chad-1964/resyncs-openclaw-mission-control-panel",
            "PM2_NAME=$pm2n",
        ]) . "\n");
    } else {
        // MySQL/MariaDB — validate credentials
        $host  = trim($_POST['db_host']  ?? 'localhost');
        $dport = trim($_POST['db_port']  ?? '3306');
        $name  = trim($_POST['db_name']  ?? '');
        $user  = trim($_POST['db_user']  ?? '');
        $pass  = $_POST['db_pass']       ?? '';

        if (!$name || !$user) {
            $error = 'Database name and username are required.';
        } else {
            try {
                $dsn = "mysql:host=$host;port=$dport;dbname=$name;charset=utf8mb4";
                $pdo = new PDO($dsn, $user, $pass,
                               [PDO::ATTR_TIMEOUT => 5, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $row = $pdo->query("SELECT VERSION() AS v")->fetch(PDO::FETCH_ASSOC);
                $ver = $row['v'] ?? '';
                $dbType = stripos($ver, 'mariadb') !== false ? 'mariadb' : 'mysql';
                $pdo = null;
            } catch (PDOException $e) {
                $error = 'Cannot connect to database: ' . $e->getMessage();
            }
        }
    }

    if (!$error) {
        if ($dbType !== 'sqlite') {
            $port   = find_free_port((int)($_POST['port'] ?? 5000));
            $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'true' : 'false';
            $secret = bin2hex(random_bytes(32));
            $domain = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $pm2n   = 'mc-' . preg_replace('/[^a-zA-Z0-9]/', '-', $domain);

            file_put_contents(MC_ENV, implode("\n", [
                "# Mission Control — generated " . date('c'),
                "NODE_ENV=production",
                "PORT=$port",
                "HTTPS=$https",
                "",
                "DB_HOST=$host",
                "DB_PORT=$dport",
                "DB_NAME=$name",
                "DB_USER=$user",
                "DB_PASSWORD=$pass",
                "DB_TYPE=$dbType",
                "",
                "SESSION_SECRET=$secret",
                "GITHUB_REPO=chad-1964/resyncs-openclaw-mission-control-panel",
                "PM2_NAME=$pm2n",
            ]) . "\n");
        }

        write_htaccess($port);

        if (can_exec()) {
            $node    = find_bin('node');
            $npm     = find_bin('npm');
            $pm2     = find_bin('pm2');
            $dir     = escapeshellarg(MC_DIR);
            $logf    = escapeshellarg(MC_LOG);
            // Prepend the node bin directory to PATH so npm post-install
            // scripts (e.g. esbuild) can find `node` even in a restricted shell
            $nodeBin    = dirname($node);
            // Let bash resolve the npm global bin at runtime using npm itself —
            // avoids HOME ambiguity in PHP CGI environments
            // Set PM2_HOME inside the app directory so pm2 never touches paths
            // outside the domain root — avoids /etc/.pm2 permission errors
            $pm2Home    = MC_DIR . '/.pm2';
            $pathExport = "export PATH=$nodeBin:\$PATH; NPM_PREFIX=\$(npm config get prefix 2>/dev/null); export PATH=\$NPM_PREFIX/bin:\$HOME/.npm-global/bin:\$PATH; export PM2_HOME=" . escapeshellarg($pm2Home);

            // Always use bare 'pm2' — the PATH export above adds the npm global
            // bin so pm2 will be found regardless of which user/home is active
            $pm2Cmd = 'pm2';

            // Always use pm2 — dist/index.cjs will exist by the time $start runs
            // (either it was already there, or the build step just created it).
            // The old file_exists() check was evaluated at PHP time (before build)
            // so a fresh install always got the nohup fallback — never starting pm2.
            $start = "$pm2Cmd delete " . escapeshellarg($pm2n) . " 2>/dev/null; "
                   . "$pm2Cmd start dist/index.cjs --name " . escapeshellarg($pm2n) . " >> $logf 2>&1";

            // Timestamp helper — prefixes each step in the log so timing is visible
            $ts = 'echo "[$(date +%H:%M:%S)]"';
            $sf = escapeshellarg(MC_DIR . '/.install-progress'); // progress status file

            // Progress file lets the polling page show which step is running
            $step = function(string $n, string $msg) use ($sf, $ts, $logf) {
                return "echo '$n' > $sf && $ts ' $msg' >> $logf";
            };

            // For a fresh install (no dist/) we need devDependencies for the build step.
            $isFresh = !file_exists(MC_DIR . '/dist/index.cjs');
            $installCmd  = $isFresh
                ? $step('installing', 'Installing dependencies…') . " && $npm install --no-fund >> $logf 2>&1"
                : $step('installing', 'Updating dependencies…') . " && $npm install --omit=dev --no-fund >> $logf 2>&1";
            $migrateCmd  = $step('migrating', 'Running migrations…') . " && $npm run migrate >> $logf 2>&1";
            $buildCmd    = $isFresh
                ? " && " . $step('building', 'Building application…') . " && $npm run build >> $logf 2>&1"
                  . " && $ts ' Pruning dev deps…' >> $logf && $npm prune --omit=dev --no-fund >> $logf 2>&1"
                : "";
            $startLog    = $step('starting', 'Starting server…');
            $ocCmd = $step('openclaw', 'Setting up OpenClaw…')
                   . " && ($npm run install-openclaw >> $logf 2>&1"
                   . " || echo 'OpenClaw install failed — can retry in Settings' >> $logf)";

            $build = "$installCmd && $migrateCmd$buildCmd && $startLog";

            // Kill any stale processes on our chosen port before starting
            // fuser may not be available on all hosts — fall back to lsof/kill
            $killStale = "( fuser -k {$port}/tcp 2>/dev/null || kill \$(lsof -ti:{$port}) 2>/dev/null || true ); sleep 1";
            // Start Node first, THEN install OpenClaw in background (non-blocking)
            $cmd = "cd $dir && $pathExport && $killStale && $build && $start && ($ocCmd &)";
            exec("nohup bash -c " . escapeshellarg($cmd) . " > /dev/null 2>&1 &");
            // PRG: redirect to GET so meta-refresh re-polls without re-POSTing
            header('Location: index.php?starting=1'); exit;
        } else {
            $state = 'manual';
        }
    }
}

$nodeVer = can_exec() ? trim(shell_exec(find_bin('node') . ' -v 2>/dev/null') ?? '') : '';

// Polling page triggered by ?starting=1
if (($_GET['starting'] ?? '') === '1') {
    $state = 'starting';
}

// Checklist on first visit
if ($state === 'form' && !isset($_GET['go']) && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    $state = 'checklist';
}

// ── Step definitions (mirrors React STEPS array) ─────────────
// 7 steps: PHP owns step 0 (Database), React owns steps 1-6
$steps = ['Database','Admin','AI Models','Chat','Agents','Domain','Review'];
$currentStepIdx = 0; // PHP always shows Database (step 0) as active
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mission Control — Setup</title>
<style>
/* ── Design tokens — identical to the React wizard's Tailwind theme ── */
:root {
  --bg:           hsl(220,14%,9%);
  --bg-card:      hsla(220,14%,9%,.60);
  --bg-section:   hsla(220,14%,9%,.80);
  --bg-creds:     hsla(220,16%,5%,.40);
  --bg-input:     hsla(220,16%,5%,.60);
  --border:       hsl(217,14%,13%);
  --border-field: hsl(217,14%,15%);
  --border-input: hsl(217,14%,18%);
  --border-step:  hsl(217,14%,20%);
  --step-dot-bg:  hsl(217,14%,14%);
  --primary:      hsl(173,58%,44%);
  --primary-10:   hsla(173,58%,44%,.10);
  --primary-20:   hsla(173,58%,44%,.20);
  --primary-40:   hsla(173,58%,44%,.40);
  --text:         hsl(213,31%,91%);
  --text-70:      hsla(213,31%,91%,.70);
  --muted:        hsl(215,20%,55%);
  --muted-40:     hsla(215,20%,55%,.40);
  --muted-50:     hsla(215,20%,55%,.50);
  --emerald:      hsl(142,71%,55%);
  --emerald-10:   hsla(142,71%,45%,.10);
  --emerald-15:   hsla(16,185,129,.15); /* badge bg */
  --emerald-25:   hsla(142,71%,45%,.25);
  /* badge exact colours from React */
  --badge-ok-bg:  hsla(152,76%,40%,.15);
  --badge-ok-fg:  hsl(152,76%,60%);
  --badge-ok-bd:  hsla(152,76%,40%,.25);
  --badge-err-bg: hsl(0,84%,30%);
  --badge-err-fg: hsl(0,0%,100%);
  --secondary:    hsl(217,14%,14%);   /* "secondary" button bg */
  --secondary-hover: hsl(217,14%,18%);
  --warn-bg:      hsla(43,74%,40%,.15);
  --warn-border:  hsl(43,60%,40%);
  --warn-text:    hsl(43,90%,65%);
  --ok-bg:        hsla(142,71%,45%,.10);
  --ok-border:    hsla(142,71%,45%,.25);
  --ok-text:      hsl(142,71%,55%);
}

*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%;height:100%}
body{
  background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:14px;line-height:1.5;
  display:flex;flex-direction:column;min-height:100vh;
}

/* ── Step progress bar ── */
.pgbar{width:100%;padding:24px 16px 8px;flex-shrink:0}
.pgbar-inner{max-width:700px;margin:0 auto;position:relative}
.pg-line-bg{position:absolute;top:16px;left:16px;right:16px;height:2px;background:var(--border-field)}
.pg-line-fill{
  position:absolute;top:16px;left:16px;height:2px;
  background:var(--primary);transition:width .5s ease-out;
}
.pg-steps{display:flex;justify-content:space-between;position:relative;z-index:1}
.pg-step{display:flex;flex-direction:column;align-items:center;gap:6px}
.pg-dot{
  width:32px;height:32px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;transition:all .3s;
}
.pg-dot.done   {background:var(--primary);color:#fff;border:none}
.pg-dot.active {background:var(--primary-10);color:var(--primary);border:2px solid var(--primary)}
.pg-dot.upcoming{background:var(--step-dot-bg);color:var(--muted);border:1px solid var(--border-step)}
.pg-dot svg{width:14px;height:14px}
.pg-lbl{font-size:10px;font-weight:500;transition:color .3s;display:none}
@media(min-width:520px){.pg-lbl{display:block}}
.pg-lbl.active  {color:var(--primary)}
.pg-lbl.done    {color:var(--text-70)}
.pg-lbl.upcoming{color:var(--muted-50)}

/* ── Layout ── */
.content{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:4px 16px 120px;overflow-y:auto}
.card-wrap{width:100%;max-width:640px}
.card{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:12px;
  padding:24px 28px 28px;
}

/* ── Typography ── */
.step-heading{font-size:20px;font-weight:600;display:flex;align-items:center;gap:8px;margin-bottom:4px}
.step-heading svg{width:20px;height:20px;color:var(--primary);flex-shrink:0}
.step-sub{font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.6}
.field-label{display:block;font-size:11px;color:var(--muted);font-weight:500;margin-bottom:6px}

/* ── Sections inside the card ── */
.db-type-section{
  border:1px solid var(--border-field);
  background:var(--bg-section);
  border-radius:8px;padding:16px;
  margin-bottom:16px;
}
.db-type-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.db-type-header svg{width:16px;height:16px;color:var(--primary);flex-shrink:0}
.db-type-header-text p:first-child{font-size:14px;font-weight:500}
.db-type-header-text p:last-child{font-size:10px;color:var(--muted)}
.badge-autodetect{
  margin-left:auto;
  font-size:10px;padding:2px 8px;border-radius:99px;
  background:var(--badge-ok-bg);color:var(--badge-ok-fg);
  border:1px solid var(--badge-ok-bd);
  font-family:monospace;white-space:nowrap;
}
.db-type-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.db-type-btn{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:12px 8px;border-radius:8px;
  border:1px solid var(--border-input);
  background:none;cursor:pointer;
  color:var(--muted);font-size:12px;
  transition:border .15s,color .15s,background .15s;
  font-family:inherit;
}
.db-type-btn:hover:not(:disabled){border-color:var(--primary-40);color:var(--text)}
.db-type-btn.selected{border-color:var(--primary);background:var(--primary-10);color:var(--primary)}
.db-type-btn:disabled{border-color:hsl(217,14%,13%);color:hsla(215,20%,55%,.40);cursor:not-allowed}
.db-type-btn span:first-child{font-weight:600}
.db-type-btn span:last-child{font-size:10px;opacity:.6}

.creds-section{
  border:1px solid var(--border-field);
  background:var(--bg-creds);
  border-radius:8px;padding:16px;
  margin-bottom:16px;
  display:flex;flex-direction:column;gap:12px;
}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
input[type=text],input[type=password],input[type=number]{
  width:100%;
  background:var(--bg-input);
  border:1px solid var(--border-input);
  border-radius:7px;
  padding:8px 12px;
  color:var(--text);
  font-size:12px;font-family:monospace;
  outline:none;
  transition:border .15s,box-shadow .15s;
}
input[type=text]:focus,input[type=password]:focus,input[type=number]:focus{
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-10);
}
.pw-wrap{position:relative}
.pw-wrap input{padding-right:36px}
.pw-eye{
  position:absolute;right:10px;top:50%;transform:translateY(-50%);
  background:none;border:none;padding:2px;cursor:pointer;
  color:var(--muted);display:flex;align-items:center;justify-content:center;
}
.pw-eye svg{width:16px;height:16px}
.pw-eye:hover{color:var(--text)}

/* ── Test Connection area ── */
.test-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px}
.btn-secondary{
  display:flex;align-items:center;gap:6px;
  background:var(--secondary);color:var(--text);
  border:1px solid var(--border-step);
  border-radius:8px;padding:8px 16px;
  font-size:13px;font-weight:500;cursor:pointer;
  transition:background .15s;font-family:inherit;
  white-space:nowrap;
}
.btn-secondary:hover:not(:disabled){background:var(--secondary-hover)}
.btn-secondary:disabled{opacity:.5;cursor:not-allowed}
.btn-secondary svg{width:16px;height:16px}
.badge{
  display:inline-flex;align-items:center;gap:4px;
  font-size:12px;font-weight:500;padding:2px 10px;border-radius:99px;
  border:1px solid transparent;
}
.badge svg{width:12px;height:12px}
.badge-ok{background:var(--badge-ok-bg);color:var(--badge-ok-fg);border-color:var(--badge-ok-bd)}
.badge-err{background:var(--badge-err-bg);color:var(--badge-err-fg)}
.test-msg{font-size:10px;color:hsl(0,90%,70%);margin-top:6px;width:100%}

/* ── Alert banners ── */
.alert{display:flex;gap:8px;align-items:flex-start;border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:16px;line-height:1.6}
.alert svg{width:14px;height:14px;flex-shrink:0;margin-top:1px}
.alert-warn{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text)}
.alert-ok{background:var(--ok-bg);border:1px solid var(--ok-border);color:var(--ok-text)}
.alert-err{background:hsla(0,80%,30%,.15);border:1px solid hsl(0,72%,45%);color:hsl(0,90%,70%)}

/* ── Checklist cards ── */
.check-cards{display:flex;flex-direction:column;gap:10px;margin-bottom:24px}
.check-card{background:hsla(220,14%,5%,.5);border:1px solid var(--border-field);border-radius:8px;padding:14px 16px}
.check-card-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:7px}
.check-card-title svg{width:14px;height:14px;color:var(--primary);flex-shrink:0}
.check-card-body{font-size:11px;color:var(--muted);line-height:1.75}
.check-card-body strong{color:hsl(213,31%,80%)}
.hl{color:hsl(210,70%,70%)}
.check-card-body code{background:var(--bg-section);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:10px}

/* ── Starting / log ── */
.log-box{background:hsla(220,16%,4%,.95);border:1px solid var(--border-field);border-radius:8px;padding:16px;font:12px/1.7 monospace;color:hsl(210,30%,70%);height:320px;overflow-y:auto;white-space:pre-wrap;margin:16px 0;box-shadow:inset 0 2px 8px rgba(0,0,0,.4)}
.status-line{font-size:12px;color:var(--muted);text-align:center;padding:6px 0}
.spin{display:inline-block;animation:spin .7s linear infinite;margin-right:6px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Manual / code ── */
.code-block{background:hsla(220,16%,5%,.8);border:1px solid var(--border-field);border-radius:7px;padding:12px 14px;font:11px/1.6 monospace;color:hsl(210,80%,72%);white-space:pre-wrap;margin:8px 0;overflow-x:auto}
.code-label{font-size:11px;color:var(--muted);margin-top:14px;margin-bottom:2px}
.sep{border:none;border-top:1px solid var(--border-field);margin:20px 0}

/* ── Bottom nav — matches React wizard fixed bottom bar ── */
.bottom-nav{
  position:fixed;bottom:0;left:0;right:0;
  border-top:1px solid var(--border);
  background:hsla(220,14%,9%,.85);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  z-index:40;
}
.bottom-nav-inner{
  max-width:640px;margin:0 auto;
  padding:14px 16px 18px;
  display:flex;align-items:center;justify-content:space-between;
}
.btn-ghost{
  background:none;border:none;color:var(--muted);
  font-size:13px;cursor:pointer;
  padding:8px 12px;border-radius:7px;
  display:inline-flex;align-items:center;gap:6px;
  transition:color .15s,background .15s;font-family:inherit;
  text-decoration:none;
}
.btn-ghost:hover{background:hsla(215,20%,55%,.1);color:var(--text)}
.btn-ghost svg{width:16px;height:16px}
.btn-primary{
  background:var(--primary);color:#fff;
  border:none;border-radius:8px;
  padding:10px 24px;font-size:13px;font-weight:600;
  cursor:pointer;display:inline-flex;align-items:center;gap:6px;
  transition:opacity .15s,transform .1s;
  font-family:inherit;min-width:140px;justify-content:center;
  text-decoration:none;
}
.btn-primary:hover:not(:disabled){opacity:.9}
.btn-primary:active:not(:disabled){transform:scale(.98)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
.btn-primary svg{width:16px;height:16px}
a{color:hsl(210,70%,70%);text-decoration:none}
a:hover{text-decoration:underline}

/* ── Inline SVG helpers ── */
svg.icon{display:inline-block;vertical-align:middle}
</style>
</head>
<body>

<?php
/* ── Inline SVGs (Lucide paths — stroke-based, viewBox 0 0 24 24) ── */
function ic(string $name, string $style = 'width:14px;height:14px'): string {
    $paths = [
      'database'    => '<path d="M12 3C7.03 3 3 4.79 3 7c0 2.21 4.03 4 9 4s9-1.79 9-4c0-2.21-4.03-4-9-4Z"/><path d="M3 7v5c0 2.21 4.03 4 9 4s9-1.79 9-4V7"/><path d="M3 12v5c0 2.21 4.03 4 9 4s9-1.79 9-4v-5"/>',
      'server'      => '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
      'shield'      => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
      'bot'         => '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8.01" y2="16" stroke-width="3"/><line x1="16" y1="16" x2="16.01" y2="16" stroke-width="3"/>',
      'message'     => '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
      'users'       => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      'globe'       => '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
      'check-circle'=> '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
      'check'       => '<path d="M20 6 9 17l-5-5"/>',
      'arrow-left'  => '<path d="m15 18-6-6 6-6"/>',
      'arrow-right' => '<path d="m9 18 6-6-6-6"/>',
      'zap'         => '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      'alert'       => '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      'check-c2'    => '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
      'alert-circ'  => '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      'eye'         => '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
      'eye-off'     => '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
      'loader'      => '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
      'terminal'    => '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    ];
    $p = $paths[$name] ?? '';
    return "<svg style=\"$style\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">$p</svg>";
}

// Step icons for the progress bar
$stepIcons = ['database','shield','bot','message','users','globe','check-circle'];
$stepCount = count($steps);
$pctFill   = $currentStepIdx === 0 ? 0 : round($currentStepIdx / ($stepCount - 1) * 100);

if (in_array($state, ['form','starting','checklist'])):
?>
<!-- ── Step Progress Bar ─────────────────────────────── -->
<div class="pgbar">
  <div class="pgbar-inner">
    <div class="pg-line-bg"></div>
    <div class="pg-line-fill" style="width:calc(<?= $pctFill ?>% - 32px)"></div>
    <div class="pg-steps">
      <?php foreach ($steps as $i => $label):
        $done   = $i < $currentStepIdx;
        $active = $i === $currentStepIdx;
        $cls    = $done ? 'done' : ($active ? 'active' : 'upcoming');
      ?>
      <div class="pg-step">
        <div class="pg-dot <?= $cls ?>">
          <?= $done ? ic('check','width:14px;height:14px') : ic($stepIcons[$i],'width:14px;height:14px') ?>
        </div>
        <span class="pg-lbl <?= $cls ?>"><?= htmlspecialchars($label) ?></span>
      </div>
      <?php endforeach; ?>
    </div>
  </div>
</div>
<?php endif; ?>

<div class="content">
<div class="card-wrap">

<?php if ($state === 'checklist'): ?>
<!-- ── Welcome / Checklist ────────────────────────────── -->
<div class="card">
  <div class="step-heading">
    <?= ic('zap','width:20px;height:20px') ?>
    Welcome to Mission Control
  </div>
  <p class="step-sub">Before we start, gather these details — copy them into Notepad first if it helps. You'll be live in under 5 minutes.</p>

  <div class="check-cards">
    <div class="check-card">
      <div class="check-card-title"><?= ic('database') ?> MySQL / MariaDB Database</div>
      <div class="check-card-body">
        Create a database + user in <strong>cPanel → MySQL Databases</strong> first.<br>
        You'll need: <span class="hl">Database name &nbsp;·&nbsp; Username &nbsp;·&nbsp; Password</span><br>
        Host is almost always <code>localhost</code>.
      </div>
    </div>
    <div class="check-card">
      <div class="check-card-title"><?= ic('shield') ?> Admin Account</div>
      <div class="check-card-body">
        Decide your <span class="hl">email address</span> and a strong <span class="hl">password</span> for Mission Control — you'll set these in Step 2.
      </div>
    </div>
    <div class="check-card">
      <div class="check-card-title"><?= ic('globe') ?> Your Domain / Subdomain</div>
      <div class="check-card-body">
        Know the URL where this is installed (e.g. <span class="hl">mc.yourdomain.com</span>).<br>
        Make sure the subdomain already points to this account in cPanel.
      </div>
    </div>
    <div class="check-card">
      <div class="check-card-title"><?= ic('bot') ?> AI API Key <span style="font-size:10px;color:var(--muted);font-weight:400">&nbsp;(optional — can add later)</span></div>
      <div class="check-card-body">
        An Anthropic, OpenAI, or Ollama API key to power your agents. You can skip this during setup and add it in Settings afterwards.
      </div>
    </div>
    <?php if (!$nodeVer): ?>
    <div class="alert alert-warn" style="margin:0">
      <?= ic('alert') ?>
      <div><strong>Node.js not detected.</strong> Go to <strong>cPanel → Node.js Application Manager</strong>, enable Node.js for this domain, then refresh before continuing.</div>
    </div>
    <?php else: ?>
    <div class="alert alert-ok" style="margin:0">
      <?= ic('check') ?>
      <div><strong>Node.js <?= htmlspecialchars($nodeVer) ?> detected.</strong> Your server is ready to run Mission Control.</div>
    </div>
    <?php endif; ?>
  </div>
</div>

<div class="bottom-nav">
  <div class="bottom-nav-inner">
    <span></span>
    <a href="?go=1" style="text-decoration:none">
      <button class="btn-primary" <?= !$nodeVer ? 'disabled' : '' ?>>
        Get Started
        <?= ic('arrow-right','width:16px;height:16px') ?>
      </button>
    </a>
  </div>
</div>

<?php elseif ($state === 'form'): ?>
<!-- ── Step 1: Database Configuration ────────────────── -->
<form method="post" id="dbform" onsubmit="return submitForm(event)">
<div class="card">

  <div class="step-heading">
    <?= ic('database','width:20px;height:20px') ?>
    Database Configuration
  </div>
  <p class="step-sub">Configure your database — or use the built-in SQLite for zero-config setup</p>

  <?php if (!$nodeVer): ?>
  <div class="alert alert-warn">
    <?= ic('alert') ?>
    <div>Node.js not detected — enable it in <strong>cPanel → Node.js Application Manager</strong> first.</div>
  </div>
  <?php endif; ?>

  <?php if ($error): ?>
  <div class="alert alert-err">
    <?= ic('alert-circ') ?>
    <div><?= htmlspecialchars($error) ?></div>
  </div>
  <?php endif; ?>

  <!-- DB Type Selector — mirrors React wizard exactly -->
  <div class="db-type-section">
    <div class="db-type-header">
      <?= ic('server','width:16px;height:16px') ?>
      <div class="db-type-header-text">
        <p>Database Type</p>
        <p>Select your DB engine — auto-detected after Test Connection</p>
      </div>
      <span class="badge-autodetect" id="badge-autodetect" style="display:none">Auto-detected</span>
    </div>
    <div class="db-type-grid">
      <button type="button" class="db-type-btn selected" id="btn-mariadb"    onclick="selectType('mariadb',3306)">
        <span>MariaDB</span><span>10.x / 11.x</span>
      </button>
      <button type="button" class="db-type-btn"         id="btn-mysql"       onclick="selectType('mysql',3306)">
        <span>MySQL</span><span>5.7 / 8.x</span>
      </button>
      <button type="button" class="db-type-btn" disabled id="btn-postgresql">
        <span>PostgreSQL</span><span>Coming soon</span>
      </button>
      <button type="button" class="db-type-btn" id="btn-sqlite" onclick="selectSqlite()">
        <span>SQLite</span><span>Built-in / Zero config</span>
      </button>
    </div>
  </div>

  <!-- Credentials — mirrors React wizard creds box (hidden for SQLite) -->
  <div class="creds-section">
    <div class="grid2">
      <div>
        <label class="field-label">Host</label>
        <input type="text" id="db_host" name="db_host" placeholder="localhost"
               value="<?= htmlspecialchars($_POST['db_host'] ?? 'localhost') ?>"
               oninput="resetTest()">
      </div>
      <div>
        <label class="field-label">Port</label>
        <input type="number" id="db_port" name="db_port" placeholder="3306"
               value="<?= htmlspecialchars($_POST['db_port'] ?? '3306') ?>"
               oninput="resetTest()">
      </div>
    </div>
    <div>
      <label class="field-label">Database Name</label>
      <input type="text" id="db_name" name="db_name" placeholder="mission_control"
             value="<?= htmlspecialchars($_POST['db_name'] ?? '') ?>"
             oninput="resetTest()">
    </div>
    <div>
      <label class="field-label">Username</label>
      <input type="text" id="db_user" name="db_user" placeholder="root"
             value="<?= htmlspecialchars($_POST['db_user'] ?? '') ?>"
             oninput="resetTest()">
    </div>
    <div>
      <label class="field-label">Password</label>
      <div class="pw-wrap">
        <input type="password" id="db_pass" name="db_pass" placeholder="Database password"
               oninput="resetTest()">
        <button type="button" class="pw-eye" onclick="togglePw()" title="Show/hide password">
          <span id="eye-icon"><?= ic('eye','width:16px;height:16px') ?></span>
        </button>
      </div>
    </div>
  </div>

  <!-- Test Connection row -->
  <div class="test-row">
    <button type="button" class="btn-secondary" id="btn-test" onclick="testConnection()">
      <?= ic('database','width:16px;height:16px') ?>
      <span id="btn-test-label">Test Connection</span>
    </button>
    <span class="badge badge-ok"  id="badge-ok"  style="display:none">
      <?= ic('check-c2','width:12px;height:12px') ?> Connected
    </span>
    <span class="badge badge-err" id="badge-err" style="display:none">
      <?= ic('alert-circ','width:12px;height:12px') ?> Failed
    </span>
    <span class="test-msg" id="test-msg" style="display:none"></span>
  </div>

  <!-- Hidden fields carried through form POST -->
  <input type="hidden" name="db_type" id="db_type_hidden" value="mariadb">
  <input type="hidden" name="port"    value="<?= $port ?>">
</div>

<div class="bottom-nav">
  <div class="bottom-nav-inner">
    <a href="?" class="btn-ghost">
      <?= ic('arrow-left','width:16px;height:16px') ?>
      Back
    </a>
    <button type="submit" class="btn-primary" id="btn-continue" disabled>
      Continue
      <?= ic('arrow-right','width:16px;height:16px') ?>
    </button>
  </div>
</div>
</form>

<?php elseif ($state === 'starting'):
// ── Server-side polling — no JS fetch, no proxy issues ───────────────────
// PHP checks the port directly (fsockopen bypasses Apache proxy entirely).
// The page auto-refreshes every 5s via <meta http-equiv="refresh">.
// When Node answers, PHP redirects to /?installer=1 above (before we get here).
$startingPort = (int) env_val('PORT', '5000');

// Read and clean the install log for display
$logContent = '';
if (file_exists(MC_LOG)) {
    $raw = implode('', array_slice(file(MC_LOG), -80));
    $raw = preg_replace('/\x1B\[[0-9;]*[A-Za-z]/u', '', $raw);
    $raw = preg_replace('/[┌┐└┘├┤┬┴┼─│╔╗╚╝╠╣╦╩╬═║]/u', '', $raw);
    $raw = preg_replace('/[ \t]{3,}/', '  ', $raw);
    $logContent = trim($raw);
}

// Compute elapsed seconds from log file mtime (approximate)
$elapsed = file_exists(MC_LOG) ? max(0, time() - filemtime(MC_LOG)) : 0;
// If install.log doesn't exist yet, estimate from .env mtime
if (!file_exists(MC_LOG) && file_exists(MC_ENV)) {
    $elapsed = max(0, time() - filemtime(MC_ENV));
}

// Read actual progress from status file (written by build script)
$progressFile = MC_DIR . '/.install-progress';
$progressStep = file_exists($progressFile) ? trim(file_get_contents($progressFile)) : 'starting';
$progressLabels = [
    'starting' => 'Preparing…',
    'installing' => 'Installing dependencies (npm install)…',
    'migrating' => 'Running database migrations…',
    'building' => 'Building application bundle…',
    'starting' => 'Launching server…',
    'openclaw' => 'Setting up OpenClaw…',
    'done' => 'Almost ready…',
];
$phaseMsg = $progressLabels[$progressStep] ?? "Working ($progressStep)…";
?>
<!-- meta refresh every 5s — PHP checks port server-side, no JS fetch needed -->
<meta http-equiv="refresh" content="5; url=index.php?starting=1">
<div class="card">
  <div class="step-heading">
    <svg class="spin" style="width:20px;height:20px;color:var(--primary)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
    Starting Mission Control…
  </div>
  <p class="step-sub">Installing dependencies, running migrations, setting up OpenClaw, and launching the server. This takes 3–5 minutes.</p>
  <div class="log-box" id="log"><?= htmlspecialchars($logContent ?: '⏳  Starting install process — output will appear here shortly…') ?></div>
  <p class="status-line"><?= htmlspecialchars($phaseMsg) ?> (<?= $elapsed ?>s elapsed)</p>
  <?php if ($elapsed > 750): ?>
  <p style="text-align:center;margin-top:8px;font-size:12px">
    Taking longer than expected — <a href="?state=manual">view terminal commands →</a>
  </p>
  <?php endif; ?>
</div>
<script>
// Scroll log to bottom on load so latest output is visible
document.addEventListener('DOMContentLoaded', function(){
  var el = document.getElementById('log');
  if (el) el.scrollTop = el.scrollHeight;
});
</script>

<?php elseif ($state === 'manual'): ?>
<!-- ── Manual terminal fallback ───────────────────────── -->
<?php
$pm2b  = find_bin('pm2');
$pm2ok = $pm2b !== 'pm2' && file_exists($pm2b);
$pm2n  = env_val('PM2_NAME','mission-control');
?>
<div class="card">
  <div class="step-heading">
    <?= ic('terminal','width:20px;height:20px') ?>
    Open cPanel Terminal to finish
  </div>
  <p class="step-sub">Your configuration was saved. Run these commands in <strong style="color:var(--text)">cPanel → Terminal</strong> or SSH to complete installation.</p>

  <div class="code-label">Navigate to install folder:</div>
  <div class="code-block">cd <?= htmlspecialchars(MC_DIR) ?></div>

  <div class="code-label">Install, migrate and start:</div>
  <div class="code-block">npm install --omit=dev && npm run migrate<?= file_exists(MC_DIR.'/dist/index.cjs') ? '' : ' && npm run build' ?>
<?= $pm2ok ? "pm2 start dist/index.cjs --name {$pm2n} && pm2 save" : "nohup node dist/index.cjs >> logs/mc.log 2>&1 &" ?></div>

  <div class="sep"></div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:10px"><strong style="color:var(--text)">Cron strings</strong> — paste into cPanel → Cron Jobs:</p>
  <?php if ($pm2ok): ?>
  <div class="code-block">@reboot sleep 20 && <?= $pm2b ?> resurrect</div>
  <div class="code-block">*/5 * * * * <?= $pm2b ?> list | grep -q '<?= $pm2n ?>.*online' || (cd <?= MC_DIR ?> && <?= $pm2b ?> start dist/index.cjs --name <?= $pm2n ?>)</div>
  <?php else: ?>
  <div class="code-block">@reboot sleep 20 && cd <?= MC_DIR ?> && nohup node dist/index.cjs >> logs/mc.log 2>&1 &</div>
  <div class="code-block">*/5 * * * * pgrep -f 'node.*<?= basename(MC_DIR) ?>' || (cd <?= MC_DIR ?> && nohup node dist/index.cjs >> logs/mc.log 2>&1 &)</div>
  <?php endif; ?>

  <div class="sep"></div>
  <p style="text-align:center;font-size:13px"><a href="/?installer=1">Click here once the app is running →</a></p>
</div>
<?php endif; ?>

</div><!-- /card-wrap -->
</div><!-- /content -->

<script>
/* ── DB form interactive logic ─────────────────────────── */
let testStatus   = 'idle';  // idle | testing | success | failed
let detectedType = null;

let usingSqlite = false;

function selectType(key, port) {
    usingSqlite = false;
    document.getElementById('btn-mariadb').classList.remove('selected');
    document.getElementById('btn-mysql').classList.remove('selected');
    document.getElementById('btn-sqlite').classList.remove('selected');
    document.getElementById('btn-'+key).classList.add('selected');
    document.getElementById('db_type_hidden').value = key;
    document.getElementById('db_port').value = port;
    // Show credentials section
    document.querySelector('.creds-section').style.display = '';
    document.getElementById('btn-test')?.parentElement && (document.getElementById('btn-test').style.display = '');
    resetTest();
}

function selectSqlite() {
    usingSqlite = true;
    document.getElementById('btn-mariadb').classList.remove('selected');
    document.getElementById('btn-mysql').classList.remove('selected');
    document.getElementById('btn-sqlite').classList.add('selected');
    document.getElementById('db_type_hidden').value = 'sqlite';
    // Hide credentials section — SQLite needs no config
    document.querySelector('.creds-section').style.display = 'none';
    // Auto-pass the test
    testStatus = 'success';
    renderTestUI();
}

function resetTest() {
    if (testStatus === 'idle') return;
    testStatus = 'idle';
    detectedType = null;
    renderTestUI();
}

function renderTestUI() {
    const btnTest  = document.getElementById('btn-test');
    if (!btnTest) return; // not on the DB step
    const lbl      = document.getElementById('btn-test-label');
    const okBadge  = document.getElementById('badge-ok');
    const errBadge = document.getElementById('badge-err');
    const msg      = document.getElementById('test-msg');
    const autoDetect = document.getElementById('badge-autodetect');
    const btnContinue = document.getElementById('btn-continue');

    // Spinner icon for testing state
    const spinSvg = '<svg class="spin" style="width:16px;height:16px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';
    const dbSvg   = '<svg style="width:16px;height:16px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3C7.03 3 3 4.79 3 7c0 2.21 4.03 4 9 4s9-1.79 9-4c0-2.21-4.03-4-9-4Z"/><path d="M3 7v5c0 2.21 4.03 4 9 4s9-1.79 9-4V7"/><path d="M3 12v5c0 2.21 4.03 4 9 4s9-1.79 9-4v-5"/></svg>';

    if (testStatus === 'testing') {
        btnTest.disabled = true;
        btnTest.firstElementChild.outerHTML = spinSvg;
        lbl.textContent = 'Testing…';
        okBadge.style.display  = 'none';
        errBadge.style.display = 'none';
        msg.style.display      = 'none';
        if (btnContinue) btnContinue.disabled = true;
    } else if (testStatus === 'success') {
        btnTest.disabled = false;
        btnTest.firstElementChild.outerHTML = dbSvg;
        lbl.textContent = 'Test Connection';
        okBadge.style.display  = '';
        errBadge.style.display = 'none';
        msg.style.display      = 'none';
        if (autoDetect && detectedType) autoDetect.style.display = '';
        if (btnContinue) btnContinue.disabled = false;
    } else if (testStatus === 'failed') {
        btnTest.disabled = false;
        btnTest.firstElementChild.outerHTML = dbSvg;
        lbl.textContent = 'Test Connection';
        okBadge.style.display  = 'none';
        errBadge.style.display = '';
        if (msg.dataset.msg) {
            msg.textContent   = msg.dataset.msg;
            msg.style.display = '';
        }
        if (btnContinue) btnContinue.disabled = true;
    } else {
        // idle
        btnTest.disabled = false;
        btnTest.firstElementChild.outerHTML = dbSvg;
        lbl.textContent = 'Test Connection';
        okBadge.style.display  = 'none';
        errBadge.style.display = 'none';
        msg.style.display      = 'none';
        if (autoDetect) autoDetect.style.display = 'none';
        if (btnContinue) btnContinue.disabled = true;
    }
}

async function testConnection() {
    testStatus = 'testing';
    renderTestUI();

    const body = {
        host:     document.getElementById('db_host').value || 'localhost',
        port:     parseInt(document.getElementById('db_port').value) || 3306,
        database: document.getElementById('db_name').value,
        user:     document.getElementById('db_user').value,
        password: document.getElementById('db_pass').value,
    };

    try {
        const res  = await fetch('?action=test', {
            method:  'POST',
            headers: {'Content-Type':'application/json'},
            body:    JSON.stringify(body),
        });
        const json = await res.json();
        if (json.success) {
            testStatus   = 'success';
            detectedType = json.detectedType || null;
            // Auto-select the detected type
            if (detectedType === 'mysql' || detectedType === 'mariadb') {
                document.getElementById('btn-mariadb').classList.remove('selected');
                document.getElementById('btn-mysql').classList.remove('selected');
                document.getElementById('btn-' + detectedType).classList.add('selected');
                document.getElementById('db_type_hidden').value = detectedType;
            }
        } else {
            testStatus = 'failed';
            const msgEl = document.getElementById('test-msg');
            msgEl.dataset.msg = json.message || 'Connection failed';
        }
    } catch (e) {
        testStatus = 'failed';
        const msgEl = document.getElementById('test-msg');
        msgEl.dataset.msg = e.message || 'Connection failed';
    }
    renderTestUI();
}

function submitForm(e) {
    if (testStatus !== 'success') {
        e.preventDefault();
        return false;
    }
    return true;
}

function togglePw() {
    const inp = document.getElementById('db_pass');
    const ico = document.getElementById('eye-icon');
    if (!inp) return;
    const eyeSvg    = '<svg style="width:16px;height:16px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeOffSvg = '<svg style="width:16px;height:16px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
    if (inp.type === 'password') {
        inp.type = 'text';
        if (ico) ico.innerHTML = eyeOffSvg;
    } else {
        inp.type = 'password';
        if (ico) ico.innerHTML = eyeSvg;
    }
}

// Initialize the test row on load
document.addEventListener('DOMContentLoaded', function() {
    renderTestUI();
});
</script>

</body>
</html>
