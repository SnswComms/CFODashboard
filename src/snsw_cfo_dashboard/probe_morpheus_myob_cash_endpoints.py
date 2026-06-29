#!/usr/bin/env python3
"""Probe MYOB cash/bank endpoints and build cash-position raw cache.

Screenshots of Westpac/CMF balances are reconciliation targets only. This script
must obtain source balances from MYOB API endpoints or MYOB GL data.

Expected MYOB sources to test:
- CashAccount / BankAccount style endpoint for current balance and external account number.
- Account endpoint identifies GL cash accounts, including 111300 Cash Management Facility (AUD).
- JournalTransaction can provide movement evidence but not opening/current balance by itself.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance' / 'myob-cache' / 'cash-position'
REMOTE = 'morpheus@192.168.233.220'
HOST_ALIAS = 'promaxgb10-6360.local'
REMOTE_DIR = '/home/morpheus/benefits-tracker'

REMOTE_CODE = r'''
from myob_client import MYOBReader
import json, datetime

CANDIDATES = [
  'CashAccount', 'CashAccountDetails', 'BankAccount', 'BankAccounts',
  'Account', 'Subaccount', 'Branch', 'Company',
  'CashTransaction', 'BankTransaction', 'Payment', 'JournalTransaction',
  'GeneralLedgerBalance', 'GLBalance', 'AccountByPeriod', 'AccountHistory',
  'TrialBalance', 'Ledger', 'FinancialPeriod',
]

BANK_TERMS = ['westpac','032-','032719','032713','032646','032775','cash management facility','cmf']

def simple(v):
    if isinstance(v, dict) and 'value' in v:
        return v.get('value')
    return v

def simplify(rec):
    if not isinstance(rec, dict): return rec
    out = {}
    for k,v in rec.items():
        if k in {'custom','_links','note'}: continue
        if isinstance(v, dict) and 'value' in v:
            out[k]=v.get('value')
        elif isinstance(v,(str,int,float,bool)) or v is None:
            out[k]=v
        elif isinstance(v, list):
            out[k]=f'list[{len(v)}]'
        elif isinstance(v, dict):
            out[k]='dict'
    return out

with MYOBReader() as c:
    result={'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'base': c.base, 'endpoints': {}, 'cash_account_candidates': []}
    for ep in CANDIDATES:
        url=f"{c.base}/{ep}?$top=25"
        try:
            r=c.session.get(url, timeout=90)
            info={'status': r.status_code}
            if r.status_code == 200:
                try:
                    js=r.json()
                    info['kind']=type(js).__name__
                    if isinstance(js,list):
                        info['count_sample']=len(js)
                        info['sample']=[simplify(x) for x in js[:5]]
                        if ep in {'CashAccount','CashAccountDetails','BankAccount','BankAccounts','Account'}:
                            for x in js:
                                text=json.dumps(x, default=str).lower()
                                if any(t in text for t in BANK_TERMS) or ('CashAccount' in x and simple(x.get('CashAccount')) is True):
                                    row=simplify(x); row['_endpoint']=ep; result['cash_account_candidates'].append(row)
                    else:
                        info['sample']=simplify(js)
                except Exception as e:
                    info['json_error']=str(e); info['body']=r.text[:1000]
            else:
                info['body']=r.text[:1000]
            result['endpoints'][ep]=info
        except Exception as e:
            result['endpoints'][ep]={'error': str(e)}
    print(json.dumps(result, ensure_ascii=False))
'''


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = ['ssh','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=15','-o',f'HostKeyAlias={HOST_ALIAS}',REMOTE, f"cd {REMOTE_DIR} && python3 - <<'PY'\n{REMOTE_CODE}\nPY"]
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=600)
    if proc.returncode != 0:
        err = {'error': 'Morpheus SSH/MYOB cash endpoint probe failed', 'returncode': proc.returncode, 'stderr': proc.stderr[-2000:], 'generated_at': datetime.now().isoformat(timespec='seconds')}
        (OUT / 'cash-position-probe-error.json').write_text(json.dumps(err, indent=2))
        raise SystemExit(json.dumps(err))
    data=json.loads(proc.stdout)
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    cache=OUT / f'myob-cash-endpoint-probe-{stamp}.json'
    latest=OUT / 'myob-cash-endpoint-probe-latest.json'
    cache.write_text(json.dumps(data, indent=2), encoding='utf-8')
    latest.write_text(json.dumps(data, indent=2), encoding='utf-8')
    summary={
        'generated_at': data.get('generated_at'),
        'base': data.get('base'),
        'ok_endpoints': [k for k,v in data.get('endpoints',{}).items() if v.get('status')==200],
        'cash_account_candidate_count': len(data.get('cash_account_candidates') or []),
        'latest': str(latest),
    }
    (OUT / 'myob-cash-endpoint-probe-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
