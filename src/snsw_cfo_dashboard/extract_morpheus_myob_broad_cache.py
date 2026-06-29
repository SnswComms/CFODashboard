#!/usr/bin/env python3
"""Read-only broader MYOB Advanced cache via Morpheus SSH.

Does not copy credentials locally. Runs on Morpheus using the existing MYOBReader
and writes returned business records into a local cache.
"""
from __future__ import annotations

import json
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'finance' / 'myob-cache' / 'morpheus-broad-readonly'
REMOTE = 'morpheus@192.168.233.220'
REMOTE_DIR = '/home/morpheus/benefits-tracker'

REMOTE_CODE = r'''
from myob_client import MYOBReader
import json, datetime, urllib.parse

ENDPOINTS = {
    # Endpoint: max rows. Conservative caps for dashboard seed cache.
    'Account': 2000,
    'Customer': 1000,
    'Vendor': 1000,
    'Bill': 1000,
    'Invoice': 1000,
    'Payment': 1000,
}

def get_value(x):
    if isinstance(x, dict) and 'value' in x:
        return x.get('value')
    return x

def simplify_record(rec):
    out = {}
    if not isinstance(rec, dict):
        return rec
    for k, v in rec.items():
        if k in {'note', 'custom', '_links'}:
            continue
        if isinstance(v, dict) and 'value' in v:
            out[k] = v.get('value')
        elif isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, dict) and not v:
            out[k] = None
    return out

def fetch_endpoint(client, ep, top):
    rows=[]; skip=0; page=500
    while skip < top:
        n=min(page, top-skip)
        url=f"{client.base}/{ep}?$top={n}&$skip={skip}"
        r=client.session.get(url, timeout=120)
        if r.status_code != 200:
            return {'ok': False, 'status': r.status_code, 'error': r.text[:800], 'rows': rows}
        batch=r.json()
        if not isinstance(batch, list):
            return {'ok': False, 'status': r.status_code, 'error': 'non-list response', 'rows': rows}
        rows.extend(simplify_record(x) for x in batch)
        if len(batch) < n:
            break
        skip += n
    return {'ok': True, 'status': 200, 'count': len(rows), 'rows': rows}

def fetch_journals(client):
    # Seed current MYOB era journal sample. Avoid huge backfill here.
    rows=[]
    for jt in client.fetch_journals('2025-07-01', None, page_size=500):
        simple=simplify_record(jt)
        details=jt.get('Details') or []
        if isinstance(details, list):
            simple['Details']=[simplify_record(d) for d in details]
        rows.append(simple)
        if len(rows) >= 750:
            break
    return {'ok': True, 'count': len(rows), 'rows': rows}

with MYOBReader() as c:
    result = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'source': 'MYOB Advanced via Morpheus existing MYOBReader, read-only GET calls',
        'base_endpoint_family': c.base.rsplit('/entity/', 1)[-1],
        'endpoints': {},
    }
    for ep, top in ENDPOINTS.items():
        result['endpoints'][ep] = fetch_endpoint(c, ep, top)
    result['endpoints']['JournalTransaction_since_2025_07_01_sample'] = fetch_journals(c)
    print(json.dumps(result, ensure_ascii=False))
'''


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlias=promaxgb10-6360.local',
        REMOTE,
        f"cd {REMOTE_DIR} && python3 - <<'PY'\n{REMOTE_CODE}\nPY",
    ]
    proc = subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=600)
    data = json.loads(proc.stdout)
    # Derived summary for quick dashboard use.
    summary = {
        'generated_at': data.get('generated_at') or datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': data.get('source'),
        'base_endpoint_family': data.get('base_endpoint_family'),
        'endpoint_counts': {k: {'ok': v.get('ok'), 'count': v.get('count', len(v.get('rows', []))), 'status': v.get('status')} for k, v in data.get('endpoints', {}).items()},
        'local_cache': str(OUT / 'morpheus-broad-readonly-cache.json'),
    }
    (OUT / 'morpheus-broad-readonly-cache.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
    (OUT / 'morpheus-broad-readonly-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
