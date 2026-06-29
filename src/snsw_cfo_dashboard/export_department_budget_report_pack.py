#!/usr/bin/env python3
"""Export Department Budget report pack from dashboard data.

Creates CFO/audit-friendly CSV + source manifest outputs from the same dataset that
feeds the dashboard. When MYOB live extraction is active, this becomes the report
pack replacing manual Velixo workbook exports for this lane.
"""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
DASH = ROOT / 'briefings' / 'dashboards'
DATA = DASH / 'department-budget-dashboard-data.json'
OUT_ROOT = ROOT / 'briefings' / 'report-packs' / 'department-budget'


def safe_name(s: str) -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in s).strip('-')[:80]


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main() -> int:
    data = json.loads(DATA.read_text())
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = OUT_ROOT / stamp
    out.mkdir(parents=True, exist_ok=True)

    departments = []
    lines = []
    evidence = []
    for d in data.get('departments', []):
        departments.append({
            'department': d.get('name'),
            'budget': d.get('budget'),
            'actual_spend': d.get('spent'),
            'remaining': d.get('remaining'),
            'used_pct': d.get('used_pct'),
            'status': d.get('status'),
            'source_basis': d.get('source_basis') or data.get('period_context', {}).get('period_note'),
        })
        for line in d.get('lines', []):
            line_id = f"{safe_name(d.get('name','dept'))}-{safe_name(line.get('line','line'))}"
            lines.append({
                'department': d.get('name'),
                'line': line.get('line'),
                'budget': line.get('budget'),
                'actual_spend': line.get('spent'),
                'remaining': line.get('remaining'),
                'transaction_count': line.get('transaction_count'),
                'source': line.get('source'),
                'line_id': line_id,
            })
            for ev in line.get('evidence', []) or []:
                evidence.append({
                    'line_id': line_id,
                    'department': d.get('name'),
                    'line': line.get('line'),
                    'date': ev.get('date'),
                    'period': ev.get('period'),
                    'reference': ev.get('reference'),
                    'batch': ev.get('batch'),
                    'account': ev.get('account'),
                    'subaccount': ev.get('subaccount'),
                    'vendor_customer': ev.get('vendor_customer'),
                    'description': ev.get('description'),
                    'net_debit': ev.get('net_debit'),
                    'source_endpoint': ev.get('source_endpoint'),
                })

    write_csv(out / 'department-summary.csv', departments, ['department','budget','actual_spend','remaining','used_pct','status','source_basis'])
    write_csv(out / 'department-lines.csv', lines, ['department','line','budget','actual_spend','remaining','transaction_count','source','line_id'])
    write_csv(out / 'department-evidence-sample.csv', evidence, ['line_id','department','line','date','period','reference','batch','account','subaccount','vendor_customer','description','net_debit','source_endpoint'])

    manifest = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'report_pack': str(out),
        'source_dashboard_data': str(DATA),
        'source': data.get('source'),
        'period_context': data.get('period_context'),
        'myob_source_meta': data.get('myob_source_meta'),
        'files': {
            'department_summary_csv': str(out / 'department-summary.csv'),
            'department_lines_csv': str(out / 'department-lines.csv'),
            'department_evidence_sample_csv': str(out / 'department-evidence-sample.csv'),
        },
        'audit_note': 'If period_context.source_kind is myob_live_gl_cache, actuals are MYOB JournalTransaction-backed. If source_kind is missing/legacy, this pack is not a live MYOB report and should not replace current MYOB/Velixo reporting.',
    }
    (out / 'source-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (OUT_ROOT / 'latest').unlink(missing_ok=True) if (OUT_ROOT / 'latest').is_symlink() else None
    try:
        (OUT_ROOT / 'latest').symlink_to(out, target_is_directory=True)
    except Exception:
        pass
    print(json.dumps({'report_pack': str(out), 'files': manifest['files'], 'source_kind': data.get('period_context', {}).get('source_kind')}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
