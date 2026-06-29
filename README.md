# SNSW CFO Dashboard

Private dashboard tooling for Kyle Morrison / SNSW Conference CFO workflows.

This repository is intended to let Bem and an assistant help improve the dashboard code and merge useful pieces into their tool without exposing live finance files, email vault contents, OAuth tokens, MYOB credentials, or generated confidential reports.

## What is included

- Python dashboard generators in `src/snsw_cfo_dashboard/`
- local dashboard server helper
- shared Stripe-style dashboard theme/static assets
- security and contribution notes

## What is deliberately excluded

- live OneDrive finance workbooks
- generated dashboard HTML/JSON outputs containing financial or staffing data
- OAuth/device-flow files
- MYOB credentials or session tokens
- email vault data
- SQLite/cache files

## Local-only design rule

The dashboards are designed to run against Kyle's local/private source files and write generated HTML/JSON locally. Do not add external analytics, hosted fonts, telemetry, or cloud uploads unless Kyle explicitly approves it.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Run a dashboard generator

Most current generators still point at Kyle's local workspace paths. Treat that as technical debt to be parameterised before wider reuse.

```bash
python src/snsw_cfo_dashboard/generate_cfo_budget_dashboard.py
```

## Security posture

This should remain a **private GitHub repository**. Branch protection and PR review are recommended before any external collaborator merges changes.
