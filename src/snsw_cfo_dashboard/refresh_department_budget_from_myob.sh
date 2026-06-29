#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/snswcommunications/Hermes-CFO"
PY="$ROOT/tools/excel/.venv/bin/python"
cd "$ROOT"

FROM_DATE="${1:-2026-01-01}"

echo "[1/4] Pulling read-only MYOB live GL from Morpheus from $FROM_DATE..."
"$PY" tools/dashboard/extract_morpheus_myob_live_gl.py --from-date "$FROM_DATE" --journal-limit 20000 --include-bills

echo "[2/4] Building department budget/actual report dataset..."
"$PY" tools/dashboard/build_department_budget_myob_report.py

echo "[3/4] Regenerating Department Budget Dashboard..."
"$PY" tools/dashboard/generate_department_budget_dashboard.py

echo "[4/4] Exporting department budget report pack..."
"$PY" tools/dashboard/export_department_budget_report_pack.py

echo "Done: $ROOT/briefings/dashboards/department-budget-dashboard.html"
echo "Report pack: $ROOT/briefings/report-packs/department-budget/latest"
