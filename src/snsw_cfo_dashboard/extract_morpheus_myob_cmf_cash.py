#!/usr/bin/env python3
"""Read-only MYOB CMF/cash account extractor via Morpheus.

This is separate from the department-spend extractor because CMF balances live in
asset/cash GL accounts, not expense accounts.

Primary MYOB target from chart of accounts:
- 111300 Cash Management Facility (AUD)

The CMF portal screenshot account numbers (e.g. 10292800) are not MYOB GL account
codes. They are CMF member/account numbers; this extractor prepares MYOB-side
cash balances by GL account + subaccount/entity for reconciliation.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance' / 'myob-cache' / 'cmf-cash'
REMOTE = 'morpheus@192.168.233.220'
REMOTE_DIR = '/home/morpheus/benefits-tracker'
HOST_ALIAS = 'promaxgb10-6360.local'

REMOTE_CODE = r'''
from myob_client import MYOBReader
import datetime, json, collections, sys

FROM_DATE = __FROM_DATE__
TO_DATE = __TO_DATE__
LIMIT = __LIMIT__
TARGET_ACCOUNTS = set(__TARGET_ACCOUNTS__)

def val(x):
    if isinstance(x, dict) and 'value' in x:
        return x.get('value')
    return x

def as_float(x):
    x = val(x)
    if x in (None, ''):
        return 0.0
    try:
        return float(x)
    except Exception:
        return 0.0

def simplify_detail(jt, d):
    account = val(d.get('Account')) or val(d.get('AccountID')) or ''
    # MYOB sometimes exposes Account as {'value':'111300'} or a nested display object.
    if isinstance(d.get('Account'), dict):
        account = d['Account'].get('value') or d['Account'].get('name') or account
    sub = val(d.get('Subaccount')) or val(d.get('SubaccountID')) or ''
    if isinstance(d.get('Subaccount'), dict):
        sub = d['Subaccount'].get('value') or d['Subaccount'].get('name') or sub
    debit = as_float(d.get('DebitAmount') or d.get('Debit'))
    credit = as_float(d.get('CreditAmount') or d.get('Credit'))
    net = debit - credit
    return {
        'date': val(jt.get('TransactionDate')),
        'period': val(jt.get('PostPeriod') or jt.get('FinancialPeriod')),
        'batch': val(jt.get('BatchNbr') or jt.get('BatchNumber')),
        'reference': val(jt.get('ReferenceNbr') or jt.get('ReferenceNumber')),
        'account': str(account).strip(),
        'subaccount': str(sub).strip(),
        'debit': debit,
        'credit': credit,
        'net_debit': net,
        'line_description': val(d.get('TransactionDescription') or d.get('Description')),
        'header_description': val(jt.get('Description')),
    }

with MYOBReader() as c:
    accounts = []
    r = c.session.get(f"{c.base}/Account?$top=1000", timeout=120)
    r.raise_for_status()
    for a in r.json():
        acct = val(a.get('AccountCD')) or ''
        desc = val(a.get('Description')) or ''
        typ = val(a.get('Type')) or ''
        cash = val(a.get('CashAccount'))
        if acct in TARGET_ACCOUNTS or 'Cash Management Facility' in desc or cash is True:
            accounts.append({
                'AccountCD': acct,
                'Description': desc,
                'Type': typ,
                'AccountClass': val(a.get('AccountClass')),
                'CashAccount': cash,
                'AccountID': val(a.get('AccountID')),
            })
    lines=[]
    scanned=0
    for jt in c.fetch_journals(FROM_DATE, TO_DATE, page_size=500):
        scanned += 1
        for d in jt.get('Details') or []:
            line=simplify_detail(jt,d)
            if line['account'] in TARGET_ACCOUNTS:
                lines.append(line)
        if scanned >= LIMIT:
            break
    by_account = collections.defaultdict(float)
    by_account_sub = collections.defaultdict(float)
    for line in lines:
        by_account[line['account']] += line['net_debit']
        by_account_sub[(line['account'], line['subaccount'])] += line['net_debit']
    summary = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'source': 'MYOB Advanced via Morpheus MYOBReader, read-only GET JournalTransaction/Account for CMF cash',
        'from_date': FROM_DATE,
        'to_date': TO_DATE,
        'base_endpoint_family': c.base.rsplit('/entity/',1)[-1],
        'target_accounts': sorted(TARGET_ACCOUNTS),
        'journals_scanned': scanned,
        'line_count': len(lines),
        'accounts': accounts,
        'balances_by_account': {k: round(v,2) for k,v in by_account.items()},
        'balances_by_account_subaccount': [
            {'account': a, 'subaccount': s, 'net_debit': round(v,2)}
            for (a,s),v in sorted(by_account_sub.items(), key=lambda kv: abs(kv[1]), reverse=True)
        ],
        'lines': lines,
    }
    print(json.dumps(summary, ensure_ascii=False))
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--from-date', default='2026-01-01')
    ap.add_argument('--to-date', default=None)
    ap.add_argument('--journal-limit', type=int, default=50000)
    ap.add_argument('--account', action='append', default=['111300'])
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    code = REMOTE_CODE.replace('__FROM_DATE__', repr(args.from_date))
    code = code.replace('__TO_DATE__', repr(args.to_date))
    code = code.replace('__LIMIT__', repr(args.journal_limit))
    code = code.replace('__TARGET_ACCOUNTS__', repr(args.account))
    remote = f"cd {REMOTE_DIR} && python3 - <<'PY'\n{code}\nPY"
    cmd = ['ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-o', f'HostKeyAlias={HOST_ALIAS}', REMOTE, remote]
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=900)
    if proc.returncode != 0:
        raise SystemExit(json.dumps({'error':'Morpheus SSH/MYOB CMF extraction failed','returncode':proc.returncode,'stderr':proc.stderr[-2000:]}))
    data = json.loads(proc.stdout)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    cache = OUT / f'myob-cmf-cash-{stamp}.json'
    latest = OUT / 'myob-cmf-cash-latest.json'
    summary = OUT / 'myob-cmf-cash-summary.json'
    cache.write_text(json.dumps(data, indent=2), encoding='utf-8')
    latest.write_text(json.dumps(data, indent=2), encoding='utf-8')
    summary.write_text(json.dumps({k:v for k,v in data.items() if k != 'lines'}, indent=2), encoding='utf-8')
    print(json.dumps({
        'generated_at': data.get('generated_at'),
        'target_accounts': data.get('target_accounts'),
        'journals_scanned': data.get('journals_scanned'),
        'line_count': data.get('line_count'),
        'balances_by_account': data.get('balances_by_account'),
        'latest': str(latest),
    }, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
