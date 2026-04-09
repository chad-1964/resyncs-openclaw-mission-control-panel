# Changelog

All notable changes to Mission Control for OpenClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1-beta] - 2026-04-09

Initial public beta release for community testing and feedback.

## [1.0.0] - TBD (Stable release after multi-node compatibility testing)

### Added
- One-click installer with automatic database detection (MariaDB, MySQL, PostgreSQL, SQLite)
- Bundled SQLite fallback for environments without a database server
- Encrypted API key storage at the database level
- Agent orchestration dashboard with start/stop/restart controls
- Real-time agent status monitoring with live output
- Setup Wizard with guided 7-step onboarding
- Kanban task board for agent work management
- Scheduled task management with cron-style job configuration
- One-click updates for both OpenClaw upstream and Mission Control
- Agent activity logs with searchable history
- Docker support with production-ready compose configuration
- cPanel/WHM deployment support
- PM2 process management integration
- Role-based access scoping
- Audit logging for agent actions
- Discord, WhatsApp, Telegram, and Slack channel integration

### Security
- All API keys and tokens encrypted at rest in the database
- No plaintext secrets in configuration files
- Input validation on all API endpoints
- Secure session management
