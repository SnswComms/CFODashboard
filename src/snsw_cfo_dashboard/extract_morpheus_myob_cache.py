#!/usr/bin/env python3
"""Read-only Morpheus/MYOB benefits tracker cache extractor.

Scope: confirmed Morpheus FastAPI benefits tracker for MYOB Advanced account 312510.
Only calls GET endpoints. No sync, email, notes, mutation, recategorize or POST endpoints.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance' / 'myob-cache' / 'morpheus-benefits-312510'
BASE = 'http://100.87.6.30:8011'
TIMEOUT = 30


def fetch(path: str) -> dict[str, Any]:
    url = BASE + path
    started = time.time()
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
            return {'ok': True, 'url': url, 'status': r.status, 'elapsed_ms': int((time.time() - started) * 1000), 'data': data}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')[:2000]
        return {'ok': False, 'url': url, 'status': e.code, 'elapsed_ms': int((time.time() - started) * 1000), 'error': body}
    except Exception as e:
        return {'ok': False, 'url': url, 'status': None, 'elapsed_ms': int((time.time() - started) * 1000), 'error': f'{type(e).__name__}: {e}'}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    cache: dict[str, Any] = {
        'generated_at': generated_at,
        'base_url': BASE,
        'scope': 'Morpheus benefits tracker / MYOB Advanced account 312510 only',
        'read_only_policy': 'Only GET endpoints called by this extractor.',
        'endpoints': {},
        'employees': {},
    }

    endpoints = {
        'openapi': '/openapi.json',
        'summary': '/api/summary',
        'summary_full': '/api/summary/full',
        'rules': '/api/rules',
        'email_eligible': '/api/employees/email-eligible',
        'employees_index_attempt': '/api/employees',
        'recent_transactions': '/api/search?' + urllib.parse.urlencode({'q': '', 'limit': 250}),
    }
    for key, path in endpoints.items():
        cache['endpoints'][key] = fetch(path)

    employees = []
    eligible = cache['endpoints'].get('email_eligible', {})
    if eligible.get('ok'):
        employees = eligible.get('data', {}).get('employees', []) or []

    for emp in employees:
        code = emp.get('code')
        if not code:
            continue
        code_q = urllib.parse.quote(code)
        cache['employees'][code] = {
            'identity': emp,
            'summary': fetch(f'/api/employees/{code_q}/summary'),
            'profile': fetch(f'/api/employee/{code_q}'),
            'ledger': fetch(f'/api/employee/{code_q}/ledger'),
        }

    # Derived rollups for dashboard use.
    tx = cache['endpoints'].get('recent_transactions', {}).get('data', {}).get('transactions', []) if cache['endpoints'].get('recent_transactions', {}).get('ok') else []
    total_debit = sum(float(t.get('debit') or 0) for t in tx)
    total_credit = sum(float(t.get('credit') or 0) for t in tx)
    employee_codes = sorted({t.get('employee_code') for t in tx if t.get('employee_code')})
    categories = {}
    for t in tx:
        cat = t.get('category') or 'uncategorised'
        categories.setdefault(cat, {'count': 0, 'debit': 0.0, 'credit': 0.0})
        categories[cat]['count'] += 1
        categories[cat]['debit'] += float(t.get('debit') or 0)
        categories[cat]['credit'] += float(t.get('credit') or 0)

    account = cache['endpoints'].get('summary_full', {}).get('data', {}).get('account', {}) if cache['endpoints'].get('summary_full', {}).get('ok') else {}
    cache['derived'] = {
        'account_balance': account.get('balance'),
        'account_total_credit': account.get('total_credit'),
        'account_total_debit': account.get('total_debit'),
        'account_ytd_credit': account.get('ytd_credit'),
        'account_ytd_debit': account.get('ytd_debit'),
        'account_transaction_count': account.get('transaction_count'),
        'account_as_of': account.get('as_of'),
        'eligible_employee_count': len(employees),
        'employee_detail_count': len(cache['employees']),
        'recent_transaction_count': len(tx),
        'recent_transaction_total_debit': round(total_debit, 2),
        'recent_transaction_total_credit': round(total_credit, 2),
        'recent_transaction_employee_codes': employee_codes,
        'recent_transaction_category_rollup': categories,
        'failed_endpoints': {k: v for k, v in cache['endpoints'].items() if not v.get('ok')},
    }

    out_json = OUT / 'morpheus-benefits-312510-cache.json'
    out_json.write_text(json.dumps(cache, indent=2), encoding='utf-8')
    # A smaller summary for dashboards.
    summary = {
        'generated_at': generated_at,
        'base_url': BASE,
        'scope': cache['scope'],
        'read_only_policy': cache['read_only_policy'],
        'derived': cache['derived'],
        'cache_file': str(out_json),
    }
    (OUT / 'morpheus-benefits-312510-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
