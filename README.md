<p align="center">
  <img src="assets/mission-control-banner.png" alt="Mission Control for OpenClaw" width="800"/>
</p>

<h1 align="center">Mission Control for OpenClaw</h1>

<p align="center">
  <strong>The self-hosted AI agent management dashboard for OpenClaw.<br/>One install. Any server. Full control. Own your data.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#database-support">Database Support</a> &bull;
  <a href="#requirements">Requirements</a> &bull;
  <a href="#pro-upgrade">Pro</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/chad-1964/resyncs-openclaw-mission-control-panel?style=social" alt="GitHub Stars"/>
  <img src="https://img.shields.io/github/license/chad-1964/resyncs-openclaw-mission-control-panel" alt="License"/>
  <img src="https://img.shields.io/badge/OpenClaw-compatible-blue" alt="OpenClaw Compatible"/>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node >= 20"/>
  <img src="https://img.shields.io/github/v/release/chad-1964/resyncs-openclaw-mission-control-panel" alt="Latest Release"/>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"/>
</p>

---

<!-- TODO: Replace with actual GIF recording of the dashboard -->
<p align="center">
  <img src="assets/demo.gif" alt="Mission Control Demo" width="720"/>
</p>

## Why Mission Control?

OpenClaw is an incredibly powerful AI agent framework — but out of the box it's a CLI tool. No dashboard. No schedule management. No cost tracking. API keys sitting in plaintext config files. Setting up a production-ready agent team takes hours of manual configuration.

**Mission Control gives OpenClaw a proper management layer.** Install it once, walk through the setup wizard, and you have a fully operational AI agent command center — running on your own hardware, with your own data, under your control.

No cloud dependency. No monthly per-seat fees. No vendor lock-in. **Self-hosted means you own everything.**

## Features

### PHP Bootstrap Installer + React Setup Wizard
Upload the files, visit the URL, and the installer handles everything — dependency installation, database migration, build, and PM2 process setup. Then a guided 7-step wizard walks you through admin account creation, AI model connections, agent team configuration, and launch.

### Agent Orchestration Dashboard
- **Agent roster** with real-time status monitoring
- **Scheduled tasks** with cron-style job management and weekly calendar view
- **Cost tracking** — per-agent token usage and spend analytics
- **Activity feed** — searchable timeline of all agent actions
- **Approval queue** — agents request permission before taking sensitive actions
- **Reports** — agent-generated reports with history

### 8 AI Provider Integrations
Connect any combination of AI providers. Test connections directly from the setup wizard.

- Anthropic (Claude) &bull; OpenAI (GPT-4/5) &bull; Google (Gemini)
- xAI (Grok) &bull; Perplexity &bull; OpenRouter
- Ollama (local models) &bull; Custom / Self-hosted

### Chat Provider Support
Connect your agents to the messaging platforms your team already uses:

- Discord &bull; Telegram &bull; WhatsApp &bull; Slack &bull; Signal

### White-Label Branding
Customize the app name and logo from Settings. Your branding shows on the sidebar, login page, and browser tab. Perfect for agencies and resellers.

### Profile & Preferences
Admin profile with contact details, notification preferences, preferred chat channel, and password management.

### One-Click Updates
Update both OpenClaw and Mission Control from the dashboard. No SSH required.

### Encrypted Credential Storage
All API keys and tokens are encrypted in the database. No plaintext secrets in config files.

## Database Support

Mission Control works with the database you already have:

| Database | Version | Status |
|----------|---------|--------|
| **MariaDB** | 10.11+ | Fully supported (cPanel/WHM default) |
| **MySQL** | 8.0+ | Fully supported |
| **PostgreSQL** | 15+ | Supported |

The installer auto-detects your database engine and configures the schema automatically. No manual SQL required.

## Quick Start

### Option 1: Upload & Install (cPanel / VPS)

1. Upload the release zip to your domain's document root
2. Visit your domain in a browser — the PHP installer loads automatically
3. Enter your database credentials and click Install
4. Walk through the setup wizard
5. Done — your AI command center is live

### Option 2: Git Clone

```bash
git clone https://github.com/chad-1964/resyncs-openclaw-mission-control-panel.git
cd resyncs-openclaw-mission-control-panel
npm install
cp .env.example .env
# Edit .env with your database credentials
npm run migrate
npm run build
npm start
```

### Option 3: Docker

```bash
git clone https://github.com/chad-1964/resyncs-openclaw-mission-control-panel.git
cd resyncs-openclaw-mission-control-panel
cp .env.example .env
docker compose up -d
```

## Screenshots

<!-- TODO: Replace with actual screenshots -->

| Dashboard | Agent Management |
|:-:|:-:|
| ![Dashboard](assets/screenshots/dashboard.png) | ![Agents](assets/screenshots/agents.png) |

| Setup Wizard | Schedule Calendar |
|:-:|:-:|
| ![Setup](assets/screenshots/setup-wizard.png) | ![Calendar](assets/screenshots/calendar.png) |

## Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | 20.x | 22.x LTS |
| **RAM** | 512 MB | 2 GB+ |
| **Disk** | 500 MB | 2 GB+ |
| **Database** | MariaDB 10.11+ / MySQL 8+ / PostgreSQL 15+ | MariaDB 10.11+ |
| **OS** | Any Linux, macOS, Windows (WSL2) | Ubuntu 22.04+ / Debian 12+ |

### Supported Environments

- **Shared Hosting** — cPanel/WHM with Node.js support
- **VPS** — DigitalOcean, Linode, Vultr, Hetzner, AWS EC2, etc.
- **Containers** — Docker, Docker Compose, Podman
- **Local Development** — macOS, Linux, Windows via WSL2

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | Node.js, Express v5, TypeScript |
| **Database** | MariaDB / MySQL / PostgreSQL |
| **Process Manager** | PM2 |
| **AI Framework** | OpenClaw (MCP integration) |
| **Installer** | PHP bootstrap + React setup wizard |

## Pro Upgrade

Mission Control's free core is fully functional for individuals and solo developers. **If you find this project useful and want to support its development, upgrading to Pro is the best way to help us keep building.**

Pro is a **one-time purchase** — no subscriptions, no recurring fees. You get the upgrade and every future update included.

### What Pro Adds

**Self-Learning AI Agents** — We've taken the best ideas from the Hermes agent architecture — self-learning loops, progressive skill loading, tiered memory — and rebuilt them on top of OpenClaw's MCP stack. The result is agents that genuinely get better over time, without the high token overhead that makes vanilla Hermes expensive to run at scale.

**Team Collaboration** — Invite team members, assign roles, set per-user budgets, and give each person their own scoped AI agent team. Approval workflows let team members operate independently while escalating sensitive actions to admin.

**Advanced Security** — Tool permission gates, security policies, audit logging, and agent identity binding. Built for environments where AI agents need guardrails.

**Plugin Ecosystem** — We're building dozens of plugins to meet the real-world needs of developers and SMBs: accounting, onboarding, media management, CRM, and more. Pro unlocks access to the plugin marketplace as it grows.

**Upgrade at [resyncs.com/pro](https://resyncs.com/pro)** — or connect your Resyncs account directly from Mission Control's Settings page.

## Roadmap

- [x] PHP bootstrap installer with auto DB detection
- [x] React setup wizard with 5 team presets
- [x] Agent orchestration dashboard
- [x] 8 AI provider integrations
- [x] Chat provider support (Discord, Telegram, WhatsApp, Slack, Signal)
- [x] Cost tracking and analytics
- [x] Scheduled task management with calendar view
- [x] Approval queue for agent actions
- [x] One-click updates (OpenClaw + Mission Control)
- [x] White-label branding
- [x] Profile and notification preferences
- [ ] Multi-node compatibility testing (MariaDB, MySQL, PostgreSQL)
- [ ] Self-learning agent improvements (Pro)
- [ ] Plugin marketplace with dozens of add-ons for developers and SMBs
- [ ] WHMCS provisioning module for hosting providers

## Contributing

We welcome contributions from the community. Bug fixes, documentation improvements, new features — every PR helps. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/your-feature`)
3. **Commit** your changes
4. **Open** a Pull Request

Found a bug or have an idea? [Open an issue](https://github.com/chad-1964/resyncs-openclaw-mission-control-panel/issues/new/choose).

## Community

- **Discord** — [Join our server](https://discord.gg/resyncs) for support and discussion
- **Twitter/X** — Follow [@reaborncreative](https://x.com/reaborncreative) for updates

## Support the Project

If Mission Control saves you time or helps your business, there are a few ways to support development:

- **Star this repo** — it helps others find the project
- **Upgrade to Pro** — a one-time purchase that funds ongoing development at [resyncs.com/pro](https://resyncs.com/pro)
- **Contribute** — PRs, bug reports, and documentation improvements are always welcome
- **Spread the word** — tell other OpenClaw users about Mission Control

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Built for the OpenClaw community. Self-hosted. Open source. Your data, your servers, your control.</strong><br/>
  <sub>Mission Control is an independent project and is not affiliated with or endorsed by Anthropic or the OpenClaw team.</sub>
</p>
