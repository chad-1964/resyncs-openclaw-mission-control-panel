# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Mission Control, **do not open a public issue.**

Instead, please report it privately:

- **Email**: security@YOUR_DOMAIN
- **Subject**: [SECURITY] Brief description of the vulnerability

We take all security reports seriously and will respond within 48 hours.

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | Yes       |

## Security Features

Mission Control is built with security as a core principle:

- **Encrypted credential storage** — All API keys, tokens, and secrets are encrypted at the database level. No plaintext credentials in config files.
- **Role-based access control** — Scoped permissions prevent unauthorized access to sensitive operations.
- **Approval workflows** — Sensitive agent actions require explicit approval before execution.
- **Audit logging** — All agent actions and administrative changes are logged with timestamps and user attribution.
- **Input validation** — All API endpoints validate and sanitize input.
- **Secure sessions** — Session tokens are cryptographically generated and properly expired.

## Responsible Disclosure

We ask that you:

1. Give us reasonable time to address the issue before public disclosure
2. Make a good faith effort to avoid privacy violations, data destruction, or service disruption
3. Do not access or modify data belonging to other users

We will:

1. Acknowledge your report within 48 hours
2. Provide an estimated timeline for a fix
3. Credit you in the security advisory (unless you prefer to remain anonymous)
