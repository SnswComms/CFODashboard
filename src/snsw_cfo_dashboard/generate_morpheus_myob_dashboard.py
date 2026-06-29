#!/usr/bin/env python3
"""Generate Morpheus/MYOB read-only source dashboard from local cache."""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
CACHE_DIR = ROOT / 'finance' / 'myob-cache' / 'morpheus-benefits-312510'
CACHE = CACHE_DIR / 'morpheus-benefits-312510-cache.json'
OUT = ROOT / 'briefings' / 'dashboards'

def money(v):
    try:
        n=float(v)
    except Exception:
        return '—'
    return f"(${abs(n):,.2f})" if n < 0 else f"${n:,.2f}"

def esc(x):
    return html.escape(str(x or ''))

def render(cache: dict) -> str:
    d=cache.get('derived', {})
    failed=d.get('failed_endpoints', {})
    categories=d.get('recent_transaction_category_rollup', {})
    cat_rows=''.join(f"<tr><td>{esc(k)}</td><td>{v.get('count',0)}</td><td>{money(v.get('debit'))}</td><td>{money(v.get('credit'))}</td></tr>" for k,v in sorted(categories.items(), key=lambda kv: kv[1].get('count',0), reverse=True))
    employees=cache.get('employees', {})
    emp_rows=[]
    for code, e in employees.items():
        ident=e.get('identity', {})
        summ=e.get('summary', {}).get('data', {}) if e.get('summary', {}).get('ok') else {}
        totals=summ.get('totals', {}) if isinstance(summ, dict) else {}
        role=(summ.get('employee', {}) or {}).get('role_or_church') if isinstance(summ, dict) else ''
        emp_rows.append(f"<tr><td><button data-ev='{esc(code)}'>{esc(code)}</button></td><td>{esc(ident.get('name'))}</td><td>{esc(role)}</td><td>{money(totals.get('balance'))}</td><td>{money(totals.get('ytd_debit'))}</td><td>{money(totals.get('ytd_credit'))}</td><td>{esc(totals.get('transaction_count') or '')}</td><td>{'ok' if e.get('ledger',{}).get('ok') else 'check'}</td></tr>")
    emp_html=''.join(emp_rows)
    tx=cache.get('endpoints',{}).get('recent_transactions',{}).get('data',{}).get('transactions',[]) if cache.get('endpoints',{}).get('recent_transactions',{}).get('ok') else []
    tx_rows=''.join(f"<tr><td>{esc(t.get('date'))}</td><td>{esc(t.get('employee_code'))}</td><td>{esc(t.get('category'))}</td><td>{esc(t.get('journal_description'))}</td><td>{money(t.get('debit'))}</td><td>{money(t.get('credit'))}</td></tr>" for t in tx[:40])
    employee_json=json.dumps({k:{'identity':v.get('identity'), 'summary_ok':v.get('summary',{}).get('ok'), 'ledger_ok':v.get('ledger',{}).get('ok'), 'summary':v.get('summary',{}).get('data')} for k,v in employees.items()})
    failed_html=''.join(f"<li><code>{esc(k)}</code>: HTTP/status {esc(v.get('status'))} — {esc(v.get('error'))}</li>" for k,v in failed.items()) or '<li>None</li>'
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Morpheus MYOB 312510</title>
<style>
:root{{--bg:#f6f9fc;--surface:#fff;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--green:#0a8f43;--amber:#a66512;--pink:#ea2261;--shadow:rgba(50,50,93,.18) 0 30px 60px -35px,rgba(0,0,0,.08) 0 18px 40px -24px;}}
*{{box-sizing:border-box}} body{{margin:0;background:radial-gradient(circle at 0 0,rgba(83,58,253,.12),transparent 28%),radial-gradient(circle at 92% 0,rgba(249,107,238,.1),transparent 25%),linear-gradient(180deg,#fff,#f6f9fc 44%,#eef4fb);font:300 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text)}} main{{max-width:1380px;margin:0 auto;padding:34px}} header{{display:flex;justify-content:space-between;gap:18px;margin-bottom:24px;align-items:flex-start}} h1{{font-size:48px;letter-spacing:-.065em;font-weight:300;color:var(--ink);margin:8px 0}} h2{{font-size:24px;color:var(--ink);letter-spacing:-.04em;font-weight:350;margin:0 0 14px}} p{{color:var(--muted)}} .pill{{display:inline-flex;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:999px;padding:7px 10px;box-shadow:rgba(23,23,23,.04) 0 2px 8px;white-space:nowrap;max-width:100%;align-items:center}} .grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}} .card,section{{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:18px}} .label{{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#718098;font-weight:650}} .value{{font-size:34px;color:var(--ink);letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:8px 0}} section{{margin-top:18px}} table{{width:100%;border-collapse:collapse}} th,td{{text-align:left;vertical-align:top;padding:9px 8px;border-bottom:1px solid var(--line)}} th{{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#718098}} code{{background:#f8fbff;border:1px solid var(--line);border-radius:6px;padding:2px 6px}} .warn{{color:var(--amber)}} .bad{{color:var(--pink)}} button{{appearance:none;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:7px;padding:5px 8px;cursor:pointer}} .drawer{{position:fixed;right:0;top:0;bottom:0;width:min(520px,92vw);background:#fff;border-left:1px solid var(--line);box-shadow:rgba(15,23,42,.22) -24px 0 80px;transform:translateX(105%);transition:.22s ease;z-index:5;padding:24px;overflow:auto}} .drawer.open{{transform:translateX(0)}} @media(max-width:900px){{.grid{{grid-template-columns:1fr}} header{{display:block}}}}
</style></head><body><main>
<header><div><div class='pill'>Read-only Morpheus / MYOB Advanced cache</div><h1>Morpheus MYOB 312510</h1><p>Confirmed live connector scope: Benefits Tracker for MYOB Advanced account <code>312510</code>. This is not yet full general-ledger access. Extractor called GET endpoints only.</p></div><div class='pill'>Generated {esc(cache.get('generated_at'))}</div></header>
<div class='grid'>
  <div class='card'><div class='label'>Account balance</div><div class='value'>{money(d.get('account_balance'))}</div><p>As of {esc(d.get('account_as_of'))}</p></div>
  <div class='card'><div class='label'>Total debit</div><div class='value'>{money(d.get('account_total_debit'))}</div><p>Account 312510 lifetime/cache summary</p></div>
  <div class='card'><div class='label'>Total credit</div><div class='value'>{money(d.get('account_total_credit'))}</div><p>Account 312510 lifetime/cache summary</p></div>
  <div class='card'><div class='label'>Transactions</div><div class='value'>{esc(d.get('account_transaction_count'))}</div><p>MYOB-backed transaction count from summary/full</p></div>
</div>
<div class='grid' style='margin-top:14px'>
  <div class='card'><div class='label'>YTD debit</div><div class='value'>{money(d.get('account_ytd_debit'))}</div><p>YTD account 312510</p></div>
  <div class='card'><div class='label'>YTD credit</div><div class='value'>{money(d.get('account_ytd_credit'))}</div><p>YTD account 312510</p></div>
  <div class='card'><div class='label'>Eligible employees</div><div class='value'>{esc(d.get('eligible_employee_count'))}</div><p>Employee details/ledger fetched for {esc(d.get('employee_detail_count'))}</p></div>
  <div class='card'><div class='label'>Recent sample</div><div class='value'>{esc(d.get('recent_transaction_count'))}</div><p>{money(d.get('recent_transaction_total_debit'))} debit / {money(d.get('recent_transaction_total_credit'))} credit</p></div>
</div>
<section><h2>Scope and failed endpoint warnings</h2><p><b>Scope:</b> {esc(cache.get('scope'))}. <b>Policy:</b> {esc(cache.get('read_only_policy'))}</p><ul>{failed_html}</ul></section>
<section><h2>Recent transaction category rollup</h2><table><tr><th>Category</th><th>Lines</th><th>Debit</th><th>Credit</th></tr>{cat_rows}</table></section>
<section><h2>Eligible employees / ledger checks</h2><table><tr><th>Code</th><th>Name</th><th>Role/church</th><th>Balance</th><th>YTD debit</th><th>YTD credit</th><th>Txns</th><th>Ledger</th></tr>{emp_html}</table></section>
<section><h2>Recent MYOB transaction sample</h2><table><tr><th>Date</th><th>Employee</th><th>Category</th><th>Description</th><th>Debit</th><th>Credit</th></tr>{tx_rows}</table></section>
<section><h2>Next extractor step</h2><p>Use this confirmed connector as the pattern for a broader read-only MYOB extractor, but do not assume general GL/P&L/balance-sheet access until Morpheus endpoints and auth scope are extended beyond account 312510.</p><p>Cache file: <code>{esc(CACHE)}</code></p></section>
</main><aside id='drawer' class='drawer'><button onclick='drawer.classList.remove("open")'>Close</button><div id='body'></div></aside>
<script>const employees={employee_json}; const drawer=document.getElementById('drawer'), body=document.getElementById('body'); document.addEventListener('click',e=>{{const b=e.target.closest('[data-ev]'); if(!b) return; const x=employees[b.dataset.ev]; body.innerHTML='<h2>'+b.dataset.ev+'</h2><pre>'+JSON.stringify(x,null,2)+'</pre>'; drawer.classList.add('open');}});</script></body></html>"""

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cache=json.loads(CACHE.read_text())
    (OUT/'morpheus-myob-312510-dashboard.html').write_text(render(cache), encoding='utf-8')
    (OUT/'morpheus-myob-312510-dashboard-data.json').write_text(json.dumps({'source_cache': str(CACHE), 'derived': cache.get('derived'), 'generated_at': cache.get('generated_at')}, indent=2), encoding='utf-8')
    print(OUT/'morpheus-myob-312510-dashboard.html')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
