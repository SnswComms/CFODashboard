#!/usr/bin/env python3
"""Generate CFO Cash Position dashboard.

Source rule:
- Do not hard-code screenshot balances as actuals.
- MYOB API/cache is the source of truth once cash/bank endpoint data is available.
- Screenshot values can be stored only as reconciliation targets, never as dashboard actuals.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from html import escape as esc
from cfo_stripe_theme import apply_stripe_theme, ensure_theme_file

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'briefings' / 'dashboards'
PROBE = ROOT / 'finance' / 'myob-cache' / 'cash-position' / 'myob-cash-endpoint-probe-latest.json'
CMF = ROOT / 'finance' / 'myob-cache' / 'cmf-cash' / 'myob-cmf-cash-summary.json'
OUT_HTML = OUT / 'cash-position-dashboard.html'
OUT_JSON = OUT / 'cash-position-dashboard-data.json'

# Reconciliation target account identifiers from screenshots. No balances stored here.
WESTPAC_TARGETS = [
    {'system': 'Westpac', 'name': 'Narromine', 'external_account': '032-646 275114'},
    {'system': 'Westpac', 'name': 'Canberra CS', 'external_account': '032-713 222830'},
    {'system': 'Westpac', 'name': 'SNU', 'external_account': '032-719 000024'},
    {'system': 'Westpac', 'name': 'SNSW Education', 'external_account': '032-719 273567'},
    {'system': 'Westpac', 'name': 'SNC - Conference', 'external_account': '032-719 273575'},
    {'system': 'Westpac', 'name': 'AAV', 'external_account': '032-719 486300'},
    {'system': 'Westpac', 'name': 'ELC', 'external_account': '032-719 543635'},
    {'system': 'Westpac', 'name': 'AdventistMerch.com', 'external_account': '032-719 716639'},
    {'system': 'Westpac', 'name': 'Wodonga Op Shop', 'external_account': '032-719 718458'},
    {'system': 'Westpac', 'name': 'Fyshwick Op Shop', 'external_account': '032-719 718466'},
    {'system': 'Westpac', 'name': 'Op Shop 3', 'external_account': '032-719 718474'},
    {'system': 'Westpac', 'name': 'Border CS', 'external_account': '032-775 143070'},
]
CMF_TARGETS = [
    {'system': 'CMF', 'name': 'ADVENTIST ALPINE VILLAGE', 'external_account': '10292800'},
    {'system': 'CMF', 'name': 'SDA CHURCH (SNSW) LTD', 'external_account': '10243200'},
    {'system': 'CMF', 'name': 'SNSW SDA SS BLDG & MAINT FUND', 'external_account': '10007500'},
    {'system': 'CMF', 'name': 'SOUTH N.S.W. CONFERENCE', 'external_account': '10033000'},
    {'system': 'CMF', 'name': 'STH NSW CONF - ADCARE', 'external_account': '10023400'},
    {'system': 'CMF', 'name': 'STH.NSW CONF.EDUC.BLDG & MAINT', 'external_account': '10030000'},
    {'system': 'CMF', 'name': 'STH.NSW CONF.RESOURCE', 'external_account': '10000700'},
    {'system': 'CMF', 'name': 'STH.NSW SCHOOLS-LIBRARY FUND', 'external_account': '10039600'},
]

def money(x):
    if x is None: return '—'
    return f"${x:,.2f}"


def mask_account(identifier: str) -> str:
    """Keep reconciliation identifiers available locally without making the table a bank-account dump."""
    raw = ''.join(ch for ch in str(identifier or '') if ch.isalnum())
    if len(raw) <= 4:
        return '••••'
    return f"•••• {raw[-4:]}"

def load_probe():
    if not PROBE.exists(): return None
    return json.loads(PROBE.read_text())

def load_cmf():
    if not CMF.exists(): return None
    return json.loads(CMF.read_text())

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    probe=load_probe()
    cmf=load_cmf()
    cash_candidates=(probe or {}).get('cash_account_candidates') or []
    source_status='MYOB cash endpoints not yet refreshed'
    if probe:
        source_status=f"MYOB cash endpoint probe {probe.get('generated_at')}"
    cmf_status='MYOB CMF cash extractor not yet refreshed'
    if cmf:
        cmf_status=f"MYOB CMF cash extractor {cmf.get('generated_at')}"
    rows=[]
    for t in WESTPAC_TARGETS + CMF_TARGETS:
        rows.append({**t, 'myob_source': None, 'myob_balance': None, 'status': 'awaiting MYOB endpoint match'})
    data={
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'source_rule': 'MYOB API/cache only for actual balances; screenshot account numbers are reconciliation targets only.',
        'source_status': source_status,
        'cmf_status': cmf_status,
        'cash_account_candidates': cash_candidates,
        'targets': rows,
        'recommended_myob_accounts': [
            {'AccountCD':'111200','Description':'Bank account (AUD)'},
            {'AccountCD':'111300','Description':'Cash Management Facility (AUD)'},
            {'AccountCD':'111100','Description':'Cash on hand'},
            {'AccountCD':'111400','Description':'Cash held for agency'},
            {'AccountCD':'111500','Description':'Term deposits'},
        ],
    }
    OUT_JSON.write_text(json.dumps(data, indent=2), encoding='utf-8')
    candidate_rows=''.join(f"<tr><td>{esc(str(c.get('_endpoint','')))}</td><td>{esc(str(c.get('CashAccountCD') or c.get('AccountCD') or c.get('AccountID') or ''))}</td><td>{esc(str(c.get('Description') or c.get('Descr') or c.get('Name') or ''))}</td><td>{esc(str(c.get('Balance') or c.get('CurrentBalance') or c.get('AvailableBalance') or ''))}</td></tr>" for c in cash_candidates[:30])
    target_rows=''.join(f"<tr><td>{esc(r['system'])}</td><td>{esc(r['name'])}</td><td><details><summary>{esc(mask_account(r['external_account']))}</summary><code>{esc(r['external_account'])}</code></details></td><td class='muted'>Awaiting MYOB endpoint match</td><td>—</td></tr>" for r in rows)
    html=f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>SNSW Cash Position</title><style>
.hero{{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:20px}}.answer-grid{{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:14px!important;margin:18px 0!important}}.answer-card{{min-height:132px}}.answer-card .value{{font-size:24px!important;line-height:1.08!important}}.path-grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 16px}}.path-grid div,.quick-grid div{{background:#fff;border:1px solid #e5edf5;border-radius:8px;padding:12px;box-shadow:rgba(23,23,23,.05) 0 8px 20px -14px}}.path-grid b,.quick-grid b{{display:block;color:#061b31;font-weight:500;margin-bottom:4px}}.path-grid span,.quick-grid span{{display:block;color:#64748d;font-size:13px;line-height:1.3}}.status-line{{display:grid;grid-template-columns:130px 1fr;gap:8px 12px;margin-top:10px;color:#64748d;font-size:13px}}.status-line b{{color:#061b31;font-weight:500}}.table-card{{overflow:auto}}.compact-note{{margin:10px 0 0;color:#64748d;font-size:13px;line-height:1.35}}.quick-grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 16px}}details summary{{cursor:pointer;color:#533afd}}details.source-table{{background:#fff;border:1px solid #e5edf5;border-radius:8px;box-shadow:rgba(50,50,93,.12) 0 18px 35px -28px;margin-top:14px;overflow:hidden}}details.source-table>summary{{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;font-weight:500}}details.source-table>summary span{{color:#64748d;font-size:13px;font-weight:300}}details.source-table .table-card{{border:0!important;box-shadow:none!important;margin:0!important;border-top:1px solid #e5edf5!important;border-radius:0!important}}code{{background:#f8fbff;border:1px solid #e5edf5;border-radius:4px;padding:1px 5px}}@media(max-width:1000px){{.answer-grid,.quick-grid,.path-grid{{grid-template-columns:repeat(2,minmax(0,1fr))!important}}.hero{{display:block}}}}@media(max-width:620px){{.answer-grid,.quick-grid,.path-grid{{grid-template-columns:1fr!important}}}}
</style></head><body><div class='wrap'>
<header class='hero'><div><div class='pill'>Cash source lane</div><h1>SNSW Cash Position</h1><div class='sub'>Use this page to see what is source-backed now, what is only a reconciliation target, and what endpoint is needed next.</div></div><div class='header-meta'><span class='pill'>Generated: {esc(data['generated_at'])}</span><span class='pill warn'>Screenshots ≠ source balances</span></div></header>
<div class='quick-grid'><div><b>CFO / President</b><span>No live cash-on-hand answer yet; do not make liquidity claims from screenshots.</span></div><div><b>Finance team</b><span>Probe MYOB balance endpoints, then match masked Westpac/CMF reconciliation targets.</span></div><div><b>Auditor / AUC</b><span>Source balance must come from MYOB/API/cache; screenshot rows are match targets only.</span></div></div>
<div class='path-grid'><div><b>1. Confirm endpoint</b><span>Find a balance-capable MYOB/Morpheus endpoint.</span></div><div><b>2. Match accounts</b><span>Map GL/account rows to masked Westpac and CMF targets.</span></div><div><b>3. Publish cash</b><span>Show balances only after source + reconciliation agree.</span></div></div>
<section class='answer-grid'>
  <div class='card answer-card'><div class='label'>Answer</div><div class='value'>No live cash balance yet</div><p class='compact-note'>This page intentionally does not publish Westpac/CMF screenshot balances as actual cash.</p></div>
  <div class='card answer-card'><div class='label'>Source now</div><div class='value'>{esc(source_status)}</div><p class='compact-note'>MYOB endpoint probe / cache status.</p></div>
  <div class='card answer-card'><div class='label'>CMF lane</div><div class='value'>{esc(cmf_status)}</div><p class='compact-note'>CMF extractor status; still needs balance match.</p></div>
  <div class='card answer-card'><div class='label'>Primary GL candidates</div><div class='value'><code>111200</code> / <code>111300</code></div><p class='compact-note'>Bank and Cash Management Facility accounts.</p></div>
</section>
<section class='card'><div class='label'>Next action</div><h2>Find a balance endpoint before showing cash-on-hand.</h2><div class='status-line'><b>Probe</b><span><code>CashAccount</code>, <code>BankAccount</code>, GL balance, and subaccount endpoints via Morpheus.</span><b>Use</b><span>JournalTransaction movements only as evidence until a balance endpoint or opening-balance reconstruction is confirmed.</span><b>Rule</b><span>Westpac/CMF screenshots remain reconciliation targets only.</span></div></section>
<details class='source-table'><summary>Westpac / CMF reconciliation targets <span>{len(rows)} masked accounts; full identifiers remain behind local-only details</span></summary><section class='card table-card'><div class='label'>Reconciliation targets — not source balances</div><h2>Accounts to match</h2><table><thead><tr><th>System</th><th>Name</th><th>External account</th><th>MYOB match</th><th>MYOB balance</th></tr></thead><tbody>{target_rows}</tbody></table></section></details>
<details class='source-table' open><summary>MYOB cash account candidates <span>{len(cash_candidates[:30]) or 0} candidates from latest probe</span></summary><section class='card table-card'><div class='label'>MYOB candidates</div><h2>Cash account candidates from probe</h2><table><thead><tr><th>Endpoint</th><th>Account</th><th>Description</th><th>Balance field</th></tr></thead><tbody>{candidate_rows or '<tr><td colspan=4 class=muted>No MYOB cash endpoint probe available yet.</td></tr>'}</tbody></table></section></details>
</div></body></html>"""
    ensure_theme_file(OUT)
    OUT_HTML.write_text(apply_stripe_theme(html), encoding='utf-8')
    print(OUT_HTML)

if __name__ == '__main__': main()
