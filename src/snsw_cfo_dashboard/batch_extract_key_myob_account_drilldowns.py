#!/usr/bin/env python3
"""Batch precompute selected MYOB account drilldowns."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
PY = ROOT / 'tools/excel/.venv/bin/python'
EXTRACT = ROOT / 'tools/dashboard/extract_myob_account_drilldown.py'
OUT = ROOT / 'finance/myob-cache/account-drilldowns/key-account-drilldown-summary.json'

ACCOUNTS = [
    ('703100', 'Catering'),
    ('703080', 'Technology expense'),
    ('703090', 'Other expenses'),
    ('703850', 'Travel expense'),
    ('703460', 'Meeting expenses'),
    ('707701', 'Repairs and maintenance buildings'),
    ('703420', 'Linen services'),
    ('707100', 'Cleaning'),
    ('703020', 'Advertising/commission style expenses'),
    ('703430', 'Local church evangelism'),
]

def main() -> int:
    rows = []
    for account, label in ACCOUNTS:
        cmd = [str(PY), str(EXTRACT), '--account', account, '--bill-limit', '2500', '--journal-limit', '1200']
        proc = subprocess.run(cmd, text=True, capture_output=True, timeout=600)
        item = {'account': account, 'label': label, 'exit_code': proc.returncode}
        if proc.returncode == 0:
            try:
                parsed = json.loads(proc.stdout)
                item.update(parsed)
            except Exception as exc:
                item['parse_error'] = str(exc)
                item['stdout'] = proc.stdout[-1000:]
        else:
            item['stderr'] = proc.stderr[-1000:]
            item['stdout'] = proc.stdout[-1000:]
        rows.append(item)
        print(json.dumps(item.get('derived', item), indent=2))
    OUT.write_text(json.dumps({'accounts': rows}, indent=2), encoding='utf-8')
    print(OUT)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
