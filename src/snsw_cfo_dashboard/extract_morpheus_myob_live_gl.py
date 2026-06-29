#!/usr/bin/env python3
"""Read-only live MYOB GL/account activity extract via Morpheus.

Purpose
-------
Build a current MYOB-backed source layer for CFO dashboards so Velixo workbooks
become fallback/reference exports rather than the operating source of truth.

Safety
------
- GET-only MYOB Advanced calls.
- Credentials stay on Morpheus; this script SSHes and runs the existing
  MYOBReader remotely.
- Writes confidential local snapshots under finance/myob-cache/live-gl/.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance' / 'myob-cache' / 'live-gl'
REMOTE = 'morpheus@192.168.233.220'
REMOTE_DIR = '/home/morpheus/benefits-tracker'

REMOTE_CODE = r'''
from myob_client import MYOBReader
import json, datetime, urllib.parse

FROM_DATE = "__FROM_DATE__"
TO_DATE = "__TO_DATE__"
JOURNAL_LIMIT = __JOURNAL_LIMIT__
BILL_LIMIT = __BILL_LIMIT__
INCLUDE_BILLS = __INCLUDE_BILLS__

EXPENSE_PREFIXES = ("6", "7")


def simp(x):
    if not isinstance(x, dict):
        return x
    out = {}
    for k, val in x.items():
        if k in {'custom', '_links', 'note'}:
            continue
        if isinstance(val, dict) and 'value' in val:
            out[k] = val.get('value')
        elif isinstance(val, (str, int, float, bool)) or val is None:
            out[k] = val
    return out


def pages(client, ep, top=500, limit=3000, expand=True):
    skip = 0
    while skip < limit:
        n = min(top, limit - skip)
        url = f"{client.base}/{ep}?$top={n}&$skip={skip}"
        if expand:
            url += "&$expand=Details"
        r = client.session.get(url, timeout=120)
        if r.status_code != 200:
            yield {'_error': {'endpoint': ep, 'status': r.status_code, 'body': r.text[:1000]}}
            return
        rows = r.json()
        if not isinstance(rows, list):
            yield {'_error': {'endpoint': ep, 'status': r.status_code, 'body': 'non-list response'}}
            return
        for row in rows:
            yield row
        if len(rows) < n:
            return
        skip += n


def value(d, key):
    v = d.get(key)
    if isinstance(v, dict) and 'value' in v:
        return v.get('value')
    return v


def line_record(kind, header, line):
    h = simp(header)
    l = simp(line)
    date = h.get('TransactionDate') or h.get('Date') or h.get('ApplicationDate')
    period = h.get('PostPeriod')
    acct = str(l.get('Account') or '')
    debit = float(l.get('DebitAmount') or l.get('Amount') or l.get('ExtendedCost') or 0)
    credit = float(l.get('CreditAmount') or 0)
    return {
        'kind': kind,
        'date': date,
        'period': period,
        'branch': h.get('BranchID') or h.get('Branch'),
        'module': h.get('Module'),
        'batch': h.get('BatchNbr') or h.get('ReferenceNbr'),
        'reference': l.get('ReferenceNbr') or h.get('ReferenceNbr'),
        'account': acct,
        'account_description': l.get('Description'),
        'subaccount': str(l.get('Subaccount') or ''),
        'project': l.get('Project'),
        'vendor_customer': l.get('VendorOrCustomer') or h.get('Vendor') or h.get('Customer'),
        'header_description': h.get('Description'),
        'line_description': l.get('TransactionDescription') or l.get('Description'),
        'debit': debit,
        'credit': credit,
        'net_debit': debit - credit,
        'source_endpoint': kind,
    }


result = {
    'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'source': 'MYOB Advanced via Morpheus MYOBReader, read-only GET JournalTransaction/Account/Bill',
    'from_date': FROM_DATE,
    'to_date': TO_DATE or None,
    'limits': {'journal_limit': JOURNAL_LIMIT, 'bill_limit': BILL_LIMIT, 'include_bills': INCLUDE_BILLS},
    'endpoint_status': {},
    'accounts': [],
    'journal_lines': [],
    'bill_lines': [],
    'errors': [],
}

with MYOBReader() as c:
    result['base_endpoint_family'] = c.base.rsplit('/entity/', 1)[-1]

    # Chart of accounts: needed for labels/reporting, not a financial total.
    accounts = []
    for row in pages(c, 'Account', limit=3000, expand=False):
        if '_error' in row:
            result['errors'].append(row['_error'])
            result['endpoint_status']['Account'] = row['_error']
            break
        accounts.append(simp(row))
    result['accounts'] = accounts
    result['endpoint_status']['Account'] = {'status': 200, 'count': len(accounts)}

    # Current GL/activity lines. Existing client method handles paging/date filter.
    scanned = 0
    latest_date = None
    earliest_date = None
    for jt in c.fetch_journals(FROM_DATE, TO_DATE or None, page_size=500):
        scanned += 1
        if scanned > JOURNAL_LIMIT:
            err = {'endpoint': 'JournalTransaction', 'status': 'sample_cap', 'body': f'stopped at journal_limit={JOURNAL_LIMIT}'}
            result['errors'].append(err)
            break
        details = jt.get('Details') or []
        for line in details:
            rec = line_record('JournalTransaction', jt, line)
            if rec['account'].startswith(EXPENSE_PREFIXES):
                result['journal_lines'].append(rec)
            d = rec.get('date')
            if d:
                earliest_date = d if earliest_date is None or d < earliest_date else earliest_date
                latest_date = d if latest_date is None or d > latest_date else latest_date
    result['endpoint_status']['JournalTransaction'] = {
        'status': 200,
        'journals_scanned': scanned,
        'expense_lines': len(result['journal_lines']),
        'earliest_date': earliest_date,
        'latest_date': latest_date,
    }

    # AP Bill detail is useful evidence, but journal lines are the accounting actuals.
    if INCLUDE_BILLS:
        bill_count = 0
        for bill in pages(c, 'Bill', limit=BILL_LIMIT, expand=True):
            if '_error' in bill:
                result['errors'].append(bill['_error'])
                result['endpoint_status']['Bill'] = bill['_error']
                break
            bill_count += 1
            for line in bill.get('Details') or []:
                rec = line_record('Bill', bill, line)
                if rec['account'].startswith(EXPENSE_PREFIXES):
                    result['bill_lines'].append(rec)
        result['endpoint_status']['Bill'] = {'status': 200, 'bills_scanned': bill_count, 'expense_lines': len(result['bill_lines'])}

print(json.dumps(result, ensure_ascii=False))
'''


def build_remote_code(args: argparse.Namespace) -> str:
    return (REMOTE_CODE
        .replace('__FROM_DATE__', args.from_date)
        .replace('__TO_DATE__', args.to_date or '')
        .replace('__JOURNAL_LIMIT__', str(args.journal_limit))
        .replace('__BILL_LIMIT__', str(args.bill_limit))
        .replace('__INCLUDE_BILLS__', 'True' if args.include_bills else 'False'))


def write_outputs(data: dict, label: str) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    cache_path = OUT / f'myob-live-gl-{label}.json'
    latest_path = OUT / 'myob-live-gl-latest.json'
    summary_path = OUT / 'myob-live-gl-summary.json'
    cache_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    latest_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    summary = {
        'generated_at': data.get('generated_at'),
        'source': data.get('source'),
        'from_date': data.get('from_date'),
        'to_date': data.get('to_date'),
        'base_endpoint_family': data.get('base_endpoint_family'),
        'endpoint_status': data.get('endpoint_status'),
        'line_counts': {
            'accounts': len(data.get('accounts', [])),
            'journal_lines': len(data.get('journal_lines', [])),
            'bill_lines': len(data.get('bill_lines', [])),
        },
        'errors': data.get('errors', []),
        'cache': str(cache_path),
        'latest': str(latest_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding='utf-8')
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--from-date', default='2026-01-01')
    ap.add_argument('--to-date', default='', help='Optional YYYY-MM-DD end date')
    ap.add_argument('--journal-limit', type=int, default=20000)
    ap.add_argument('--bill-limit', type=int, default=10000)
    ap.add_argument('--include-bills', action='store_true', help='Include AP Bill detail as evidence; journals remain accounting actual source')
    ap.add_argument('--label', default=datetime.now().strftime('%Y%m%d-%H%M%S'))
    args = ap.parse_args()

    code = build_remote_code(args)
    cmd = [
        'ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-o', 'HostKeyAlias=promaxgb10-6360.local', REMOTE,
        f"cd {REMOTE_DIR} && python3 - <<'PY'\n{code}\nPY",
    ]
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=900)
    if proc.returncode != 0:
        raise SystemExit(json.dumps({
            'error': 'Morpheus SSH/MYOB live extraction failed',
            'returncode': proc.returncode,
            'stderr': proc.stderr[-2000:],
            'stdout': proc.stdout[-1000:],
            'remote': REMOTE,
            'hint': 'Check Tailscale/VPN reachability to Morpheus, then rerun this extractor. No MYOB credentials were copied locally.'
        }, indent=2))
    data = json.loads(proc.stdout)
    summary = write_outputs(data, args.label)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
