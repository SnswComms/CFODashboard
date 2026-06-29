#!/usr/bin/env python3
"""Build MYOB-backed department budget/actual report data.

Inputs
------
- Approved department budgets from generate_department_budget_dashboard.py.
- MYOB live GL cache from extract_morpheus_myob_live_gl.py when available.
- Optional broad seed cache fallback for development/diagnostics only.

Output
------
briefings/dashboards/department-budget-myob-data.json

This is the reporting bridge that lets the dashboard replace stale Velixo workbook
actuals with current MYOB transaction-backed actuals once the live extractor can
reach Morpheus.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
DASH = ROOT / 'briefings' / 'dashboards'
LIVE_CACHE = ROOT / 'finance' / 'myob-cache' / 'live-gl' / 'myob-live-gl-latest.json'
BROAD_CACHE = ROOT / 'finance' / 'myob-cache' / 'morpheus-broad-readonly' / 'morpheus-broad-readonly-cache.json'
OUT = DASH / 'department-budget-myob-data.json'
GEN_PATH = ROOT / 'tools' / 'dashboard' / 'generate_department_budget_dashboard.py'

# Department mapping from MYOB Subaccount first segment.
# Subaccount examples: ADM===================, AAV======SNC004=======,
# FLDAFER01SNC045=======, YTH======YTH012=======.
PREFIX_TO_DEPT = {
    'ADM': 'ADMINISTRATION',
    'AAV': 'ADVENTIST ALPINE VILLAGE',
    'FLD': 'FIELD',
    'YTH': 'YOUTH MINISTRY',
    'FFM': 'FAITH FM ADMINISTRATION',
    'COM': 'COMMUNICATIONS',
    'MIN': 'MINISTERIAL',
    'EVA': 'EVANGELISM',
    'DEP': 'PERSONAL MINISTRIES / DEPARTMENT LIAISONS',
    'OTH': 'OTHER OPERATIONS',
    'BIG': 'BIG CAMP',
    'PRO': 'PROPERTIES',
    'PER': 'PERSONAL MINISTRIES / DEPARTMENT LIAISONS',
    # FAM is not an approved department in the current PDF control list; keep visible.
    'FAM': 'UNMAPPED / FAMILY MINISTRIES',
}

# Some approved budget departments may share generic ADM account/subaccount
# coding until MYOB budget/subaccount rights are improved. Keep them as budget
# rows with zero/unknown actuals rather than hiding them.
APPROVED_ONLY_DEPTS = {'PROPERTIES', 'BIG CAMP'}


def load_budget_constants() -> tuple[dict[str, float], dict[str, list[tuple[str, float]]], str]:
    spec = importlib.util.spec_from_file_location('dept_budget_gen', GEN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Cannot load {GEN_PATH}')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return dict(mod.APPROVED_DEPARTMENT_BUDGETS), dict(mod.APPROVED_DEPARTMENT_LINES), mod.APPROVED_BUDGET_BASIS


def money_num(v: Any) -> float:
    try:
        if v in (None, ''):
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def subaccount_prefix(sub: str) -> str:
    sub = (sub or '').strip().upper()
    if not sub or set(sub) <= {'='}:
        return 'UNMAPPED'
    m = re.match(r'([A-Z]{3})', sub)
    return m.group(1) if m else 'UNMAPPED'


def dept_for_line(line: dict[str, Any]) -> str:
    prefix = subaccount_prefix(str(line.get('subaccount') or ''))
    return PREFIX_TO_DEPT.get(prefix, 'UNMAPPED')


def normalize_broad_cache_to_lines(cache: dict[str, Any]) -> list[dict[str, Any]]:
    rows = cache.get('endpoints', {}).get('JournalTransaction_since_2025_07_01_sample', {}).get('rows', [])
    out = []
    for jt in rows:
        for line in jt.get('Details') or []:
            acct = str(line.get('Account') or '')
            if not acct.startswith(('6', '7')):
                continue
            out.append({
                'kind': 'JournalTransaction',
                'date': jt.get('TransactionDate'),
                'period': jt.get('PostPeriod'),
                'branch': jt.get('BranchID'),
                'module': jt.get('Module'),
                'batch': jt.get('BatchNbr'),
                'reference': line.get('ReferenceNbr'),
                'account': acct,
                'account_description': line.get('Description'),
                'subaccount': str(line.get('Subaccount') or ''),
                'project': line.get('Project'),
                'vendor_customer': line.get('VendorOrCustomer'),
                'header_description': jt.get('Description'),
                'line_description': line.get('TransactionDescription') or line.get('Description'),
                'debit': money_num(line.get('DebitAmount')),
                'credit': money_num(line.get('CreditAmount')),
                'net_debit': money_num(line.get('DebitAmount')) - money_num(line.get('CreditAmount')),
                'source_endpoint': 'JournalTransaction seed cache',
            })
    return out


def load_source(path: Path | None, allow_seed: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if path and path.exists():
        data = json.loads(path.read_text())
        accounts = {str(a.get('AccountCD')): a for a in data.get('accounts', [])}
        return list(data.get('journal_lines', [])), {
            'accounts': accounts,
            'source_path': str(path),
            'source': data.get('source'),
            'source_kind': 'myob_live_gl_cache',
            'generated_at': data.get('generated_at'),
            'from_date': data.get('from_date'),
            'to_date': data.get('to_date'),
            'endpoint_status': data.get('endpoint_status'),
            'errors': data.get('errors', []),
            'confidence': 'high if cache was generated from live MYOB for the requested period; check endpoint_status/latest_date',
        }
    if allow_seed and BROAD_CACHE.exists():
        data = json.loads(BROAD_CACHE.read_text())
        return normalize_broad_cache_to_lines(data), {
            'source_path': str(BROAD_CACHE),
            'source': data.get('source'),
            'source_kind': 'development_seed_cache_not_current',
            'generated_at': data.get('generated_at'),
            'from_date': '2025-07-01',
            'to_date': None,
            'endpoint_status': data.get('endpoints', {}).get('JournalTransaction_since_2025_07_01_sample', {}),
            'errors': [{'status': 'seed_cache', 'body': 'This broad cache is capped and not current; use only for development/testing when Morpheus is unavailable.'}],
            'confidence': 'low for current decisions; development fallback only',
        }
    return [], {
        'source_kind': 'missing_myob_cache',
        'errors': [{'status': 'missing', 'body': f'No live MYOB GL cache found at {LIVE_CACHE}'}],
        'confidence': 'none',
    }


def build_report(lines: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, Any]:
    budgets, budget_lines, budget_basis = load_budget_constants()
    by_dept: dict[str, dict[str, Any]] = defaultdict(lambda: {'spent': 0.0, 'lines': defaultdict(lambda: {'spent': 0.0, 'count': 0, 'evidence': []})})
    unmapped_prefixes = defaultdict(float)
    date_values = []
    period_values = []

    account_meta = meta.get('accounts') or {}
    excluded_account_type_totals = defaultdict(float)

    for line in lines:
        acct = str(line.get('account') or '')
        acct_info = account_meta.get(acct) or {}
        acct_type = str(acct_info.get('Type') or '').lower()
        # This dashboard is a department spend/budget report. MYOB income accounts
        # are intentionally excluded here and should be handled by a separate
        # income/net-result page.
        if acct_type and acct_type != 'expense':
            excluded_account_type_totals[f"{acct} {acct_info.get('Description') or line.get('account_description') or ''}".strip()] += money_num(line.get('net_debit'))
            continue
        # If account metadata is missing, keep only obvious expense accounts.
        if not acct_type and not acct.startswith('7'):
            excluded_account_type_totals[f"{acct} {line.get('account_description') or ''}".strip()] += money_num(line.get('net_debit'))
            continue
        dept = dept_for_line(line)
        net = money_num(line.get('net_debit'))
        if abs(net) < 0.005:
            continue
        date = line.get('date')
        if date:
            date_values.append(str(date))
        if line.get('period'):
            period_values.append(str(line.get('period')))
        label = f"{line.get('account') or ''} {line.get('account_description') or ''}".strip()
        by_dept[dept]['spent'] += net
        bucket = by_dept[dept]['lines'][label]
        bucket['spent'] += net
        bucket['count'] += 1
        if len(bucket['evidence']) < 8:
            bucket['evidence'].append({
                'date': line.get('date'),
                'period': line.get('period'),
                'reference': line.get('reference'),
                'batch': line.get('batch'),
                'account': line.get('account'),
                'subaccount': line.get('subaccount'),
                'vendor_customer': line.get('vendor_customer'),
                'description': line.get('line_description') or line.get('header_description'),
                'net_debit': net,
                'source_endpoint': line.get('source_endpoint'),
            })
        if dept == 'UNMAPPED' or dept.startswith('UNMAPPED'):
            unmapped_prefixes[subaccount_prefix(str(line.get('subaccount') or ''))] += net

    # Make rows for all approved departments plus any MYOB-only/unmapped lanes.
    all_names = set(budgets) | set(by_dept)
    departments = []
    for name in sorted(all_names, key=lambda n: budgets.get(n, 0), reverse=True):
        spent = by_dept.get(name, {}).get('spent', 0.0)
        budget = budgets.get(name, 0.0)
        remaining = budget - spent
        used = (spent / budget * 100.0) if budget else None
        status = 'over' if budget and remaining < 0 else 'tight' if used and used > 85 else 'ok'
        line_rows = []
        if name in by_dept:
            for label, item in by_dept[name]['lines'].items():
                line_rows.append({
                    'line': label,
                    'budget': 0.0,
                    'spent': round(item['spent'], 2),
                    'remaining': 0.0 - item['spent'],
                    'transaction_count': item['count'],
                    'source': 'MYOB JournalTransaction',
                    'evidence': item['evidence'],
                })
        if not line_rows and name in budget_lines:
            line_rows = [{'line': l, 'budget': b, 'spent': 0.0, 'remaining': b, 'source': 'Approved budget line; no MYOB actual mapped yet'} for l, b in budget_lines[name]]
        line_rows.sort(key=lambda x: abs(x.get('spent') or x.get('budget') or 0), reverse=True)
        departments.append({
            'name': name,
            'budget': round(budget, 2),
            'spent': round(spent, 2),
            'remaining': round(remaining, 2),
            'used_pct': used,
            'status': status,
            'income_budget': 0.0,
            'income_actual': 0.0,
            'lines': line_rows[:12],
            'source_basis': 'approved budget PDF + MYOB JournalTransaction actuals' if spent else 'approved budget PDF; no mapped MYOB actuals in current cache',
        })

    actual_period_label = 'MYOB current GL snapshot'
    if date_values:
        actual_period_label = f"MYOB actuals {min(date_values)[:10]} to {max(date_values)[:10]}"

    return {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'source': f"{budget_basis} + {meta.get('source_path', 'MYOB cache missing')}",
        'source_modified': None,
        'period_context': {
            'budget_year': '2026',
            'budget_period_label': budget_basis,
            'actual_period_label': actual_period_label,
            'summary_period_label': 'May 2026 operating summary',
            'as_of_date': max(date_values)[:10] if date_values else None,
            'budget_source_modified': None,
            'actual_source_modified': meta.get('generated_at'),
            'summary_source_modified': None,
            'period_note': 'Actuals use MYOB JournalTransaction lines via Morpheus read-only extractor. Velixo workbooks are now fallback/reference only.',
            'source_kind': meta.get('source_kind'),
            'confidence': meta.get('confidence'),
        },
        'departments': departments,
        'summary': {'income': 0, 'spend': round(sum(d['spent'] for d in departments if d['budget'] or d['spent']), 2), 'net': 0, 'cash': []},
        'myob_source_meta': meta,
        'mapping': {
            'subaccount_prefix_to_department': PREFIX_TO_DEPT,
            'unmapped_prefix_totals': {k: round(v, 2) for k, v in unmapped_prefixes.items()},
            'excluded_non_expense_account_totals': {k: round(v, 2) for k, v in sorted(excluded_account_type_totals.items(), key=lambda kv: abs(kv[1]), reverse=True)[:30]},
            'notes': [
                'Department mapping is from the first MYOB subaccount segment/prefix.',
                'JournalTransaction expense lines are the accounting actual source. AP Bill lines are evidence only unless explicitly enabled elsewhere.',
                'TrialBalance/Subaccount/Budget endpoint rights are still needed for a formal full financial-statement engine.',
            ],
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=str(LIVE_CACHE), help='MYOB live GL cache path')
    ap.add_argument('--allow-seed-cache', action='store_true', help='Use old capped broad cache for development if live cache missing')
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()

    source_path = Path(args.source) if args.source else None
    lines, meta = load_source(source_path, args.allow_seed_cache)
    report = build_report(lines, meta)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({
        'output': str(out),
        'departments': len(report['departments']),
        'source_kind': report['period_context']['source_kind'],
        'actual_period_label': report['period_context']['actual_period_label'],
        'errors': report['myob_source_meta'].get('errors', []),
    }, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
