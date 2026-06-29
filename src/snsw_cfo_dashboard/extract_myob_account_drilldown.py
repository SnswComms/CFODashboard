#!/usr/bin/env python3
"""Read-only MYOB account drilldown via Morpheus.

Pulls AP Bill lines and JournalTransaction lines with expanded details where
Account matches a supplied account code. No credentials copied locally; GET-only
via remote MYOBReader.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance/myob-cache/account-drilldowns'
REMOTE = 'morpheus@192.168.233.220'
REMOTE_DIR = '/home/morpheus/benefits-tracker'

REMOTE_CODE = r'''
from myob_client import MYOBReader
import json, datetime
ACCOUNT = "__ACCOUNT__"
FROM_DATE = "__FROM_DATE__"
BILL_LIMIT = __BILL_LIMIT__
JOURNAL_LIMIT = __JOURNAL_LIMIT__

def simp(x):
    if not isinstance(x, dict): return x
    out={}
    for k,val in x.items():
        if k in {'custom','_links','note'}: continue
        if isinstance(val, dict) and 'value' in val: out[k]=val.get('value')
        elif isinstance(val,(str,int,float,bool)) or val is None: out[k]=val
    return out

def pages(client, ep, top=500, limit=3000, expand=True):
    skip=0
    while skip < limit:
        n=min(top, limit-skip)
        url=f"{client.base}/{ep}?$top={n}&$skip={skip}"
        if expand: url += "&$expand=Details"
        r=client.session.get(url, timeout=120)
        if r.status_code!=200:
            yield {'_error': {'endpoint':ep,'status':r.status_code,'body':r.text[:800]}}
            return
        rows=r.json()
        if not isinstance(rows, list): return
        for row in rows: yield row
        if len(rows)<n: return
        skip += n

result={
    'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'account':ACCOUNT,
    'from_date':FROM_DATE,
    'source':'MYOB Advanced via Morpheus MYOBReader, GET-only',
    'limits': {'bill_limit': BILL_LIMIT, 'journal_limit': JOURNAL_LIMIT},
    'bill_lines':[],
    'journal_lines':[],
    'errors':[]
}
with MYOBReader() as c:
    for bill in pages(c,'Bill',limit=BILL_LIMIT,expand=True):
        if '_error' in bill: result['errors'].append(bill['_error']); continue
        b=simp(bill)
        for line in bill.get('Details') or []:
            s=simp(line)
            if str(s.get('Account'))==ACCOUNT:
                result['bill_lines'].append({'bill':b,'line':s})
    scanned=0
    for jt in c.fetch_journals(FROM_DATE, None, page_size=500):
        scanned += 1
        if scanned > JOURNAL_LIMIT:
            result['errors'].append({'endpoint':'JournalTransaction','status':'sample_cap','body':f'stopped at journal_limit={JOURNAL_LIMIT}'})
            break
        j=simp(jt)
        for line in jt.get('Details') or []:
            s=simp(line)
            if str(s.get('Account'))==ACCOUNT:
                result['journal_lines'].append({'journal':j,'line':s})
    result['journals_scanned'] = scanned
print(json.dumps(result, ensure_ascii=False))
'''

def build_remote_code(account: str, from_date: str, bill_limit: int, journal_limit: int) -> str:
    return (REMOTE_CODE
            .replace('__ACCOUNT__', account)
            .replace('__FROM_DATE__', from_date)
            .replace('__BILL_LIMIT__', str(bill_limit))
            .replace('__JOURNAL_LIMIT__', str(journal_limit)))

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--account', default='703430', help='MYOB account code, e.g. 703430')
    ap.add_argument('--from-date', default='2025-07-01', help='Journal pull start date YYYY-MM-DD')
    ap.add_argument('--bill-limit', type=int, default=4000)
    ap.add_argument('--journal-limit', type=int, default=3000)
    args = ap.parse_args()

    account = ''.join(ch for ch in args.account if ch.isdigit())
    if not account:
        raise SystemExit('account must contain digits')
    OUT.mkdir(parents=True, exist_ok=True)
    code = build_remote_code(account, args.from_date, args.bill_limit, args.journal_limit)
    cmd = ['ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlias=promaxgb10-6360.local', REMOTE,
           f"cd {REMOTE_DIR} && python3 - <<'PY'\n{code}\nPY"]
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=600, check=True)
    data = json.loads(proc.stdout)
    bill_total = sum(float(x['line'].get('Amount') or x['line'].get('ExtendedCost') or 0) for x in data['bill_lines'])
    journal_debit = sum(float(x['line'].get('DebitAmount') or 0) for x in data['journal_lines'])
    journal_credit = sum(float(x['line'].get('CreditAmount') or 0) for x in data['journal_lines'])
    data['derived'] = {
        'bill_line_count': len(data['bill_lines']),
        'bill_line_total': round(bill_total, 2),
        'journal_line_count': len(data['journal_lines']),
        'journal_debit_total': round(journal_debit, 2),
        'journal_credit_total': round(journal_credit, 2),
        'journal_net_debit': round(journal_debit - journal_credit, 2),
    }
    out = OUT / f'myob-account-{account}-drilldown.json'
    out.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(out), 'derived': data['derived'], 'errors': data.get('errors')}, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
