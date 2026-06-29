#!/usr/bin/env python3
"""Fast multi-account MYOB drilldown via one Morpheus/MYOB session.

GET-only. Pulls expanded Bill and JournalTransaction records once, then splits lines
into per-account JSON files locally.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance/myob-cache/account-drilldowns'
REMOTE = 'morpheus@192.168.233.220'
REMOTE_DIR = '/home/morpheus/benefits-tracker'
ACCOUNTS = ['703100','703080','703090','703850','703460','707701','703420','707100','703020','703430']
FROM_DATE = '2025-07-01'
BILL_LIMIT = 4000
JOURNAL_LIMIT = 1500

REMOTE_CODE = r'''
from myob_client import MYOBReader
import json, datetime
ACCOUNTS = set(__ACCOUNTS__)
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

def blank(acct):
    return {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'account': acct, 'from_date': FROM_DATE, 'source': 'MYOB Advanced via Morpheus MYOBReader, GET-only multi-account extractor', 'limits': {'bill_limit': BILL_LIMIT, 'journal_limit': JOURNAL_LIMIT}, 'bill_lines': [], 'journal_lines': [], 'errors': []}

result={acct: blank(acct) for acct in ACCOUNTS}
with MYOBReader() as c:
    for bill in pages(c,'Bill',limit=BILL_LIMIT,expand=True):
        if '_error' in bill:
            for r in result.values(): r['errors'].append(bill['_error'])
            continue
        b=simp(bill)
        for line in bill.get('Details') or []:
            s=simp(line); acct=str(s.get('Account'))
            if acct in result: result[acct]['bill_lines'].append({'bill':b,'line':s})
    scanned=0
    for jt in c.fetch_journals(FROM_DATE, None, page_size=500):
        scanned+=1
        if scanned > JOURNAL_LIMIT:
            err={'endpoint':'JournalTransaction','status':'sample_cap','body':f'stopped at journal_limit={JOURNAL_LIMIT}'}
            for r in result.values(): r['errors'].append(err)
            break
        j=simp(jt)
        for line in jt.get('Details') or []:
            s=simp(line); acct=str(s.get('Account'))
            if acct in result: result[acct]['journal_lines'].append({'journal':j,'line':s})
    for r in result.values(): r['journals_scanned']=scanned
print(json.dumps(result, ensure_ascii=False))
'''

def add_derived(data: dict) -> dict:
    for acct, item in data.items():
        bill_total = sum(float(x['line'].get('Amount') or x['line'].get('ExtendedCost') or 0) for x in item['bill_lines'])
        journal_debit = sum(float(x['line'].get('DebitAmount') or 0) for x in item['journal_lines'])
        journal_credit = sum(float(x['line'].get('CreditAmount') or 0) for x in item['journal_lines'])
        item['derived'] = {'bill_line_count': len(item['bill_lines']), 'bill_line_total': round(bill_total,2), 'journal_line_count': len(item['journal_lines']), 'journal_debit_total': round(journal_debit,2), 'journal_credit_total': round(journal_credit,2), 'journal_net_debit': round(journal_debit-journal_credit,2)}
    return data

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    code = (REMOTE_CODE
            .replace('__ACCOUNTS__', json.dumps(ACCOUNTS))
            .replace('__FROM_DATE__', FROM_DATE)
            .replace('__BILL_LIMIT__', str(BILL_LIMIT))
            .replace('__JOURNAL_LIMIT__', str(JOURNAL_LIMIT)))
    cmd=['ssh','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10','-o','HostKeyAlias=promaxgb10-6360.local',REMOTE,f"cd {REMOTE_DIR} && python3 - <<'PY'\n{code}\nPY"]
    proc=subprocess.run(cmd, text=True, capture_output=True, timeout=600, check=True)
    data=add_derived(json.loads(proc.stdout))
    summary=[]
    for acct,item in data.items():
        path=OUT/f'myob-account-{acct}-drilldown.json'
        path.write_text(json.dumps(item, indent=2), encoding='utf-8')
        summary.append({'account':acct,'output':str(path),'derived':item['derived'],'errors':item.get('errors',[])})
    (OUT/'key-account-drilldown-summary.json').write_text(json.dumps({'accounts':summary}, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
