#!/usr/bin/env python3
"""Generate Stripe-style MYOB account detail/index pages from account drilldown JSON files."""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
SRC = ROOT / 'finance/myob-cache/account-drilldowns'
OUT = ROOT / 'briefings/dashboards'


def esc(x): return html.escape(str(x if x is not None else ''))
def money(v):
    try: n = float(v or 0)
    except Exception: return '—'
    return f"(${abs(n):,.2f})" if n < 0 else f"${n:,.2f}"
def val(row,*names):
    for name in names:
        if isinstance(row, dict) and name in row and row[name] not in (None,''):
            return row[name]
    return ''

CSS = """
:root{--bg:#f6f9fc;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--shadow:rgba(50,50,93,.18) 0 30px 60px -35px,rgba(0,0,0,.08) 0 18px 40px -24px;}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 0 0,rgba(83,58,253,.12),transparent 28%),linear-gradient(180deg,#fff,#f6f9fc 44%,#eef4fb);font:300 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text)}main{max-width:1400px;margin:0 auto;padding:34px}header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:24px}h1{font-size:48px;letter-spacing:-.065em;font-weight:300;color:var(--ink);margin:8px 0}h2{font-size:24px;color:var(--ink);letter-spacing:-.04em;font-weight:350;margin:0 0 14px}p{color:var(--muted)}.pill{display:inline-flex;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:999px;padding:7px 10px;box-shadow:rgba(23,23,23,.04) 0 2px 8px;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.card,section{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:18px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#718098;font-weight:650}.value{font-size:30px;color:var(--ink);letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:8px 0}section{margin-top:18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:9px 8px;border-bottom:1px solid var(--line)}th{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#718098}code{background:#f8fbff;border:1px solid var(--line);border-radius:6px;padding:2px 6px}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:18px}.link{color:var(--purple);text-decoration:none;font-weight:600}@media(max-width:900px){.grid,.tabs{grid-template-columns:1fr}header{display:block}}
"""

def render_detail(data: dict) -> str:
    account = data.get('account')
    d = data.get('derived', {})
    bill_rows = []
    for x in data.get('bill_lines', [])[:300]:
        b, l = x.get('bill', {}), x.get('line', {})
        bill_rows.append(f"<tr><td>{esc(val(b,'Date')[:10])}</td><td>{esc(val(b,'ReferenceNbr'))}</td><td>{esc(val(b,'Vendor'))}</td><td>{esc(val(b,'BranchID'))}</td><td>{esc(val(l,'Subaccount'))}</td><td>{esc(val(l,'TransactionDescription') or val(l,'Description') or val(b,'Description'))}</td><td>{money(val(l,'Amount','ExtendedCost'))}</td></tr>")
    journal_rows = []
    for x in data.get('journal_lines', [])[:500]:
        j, l = x.get('journal', {}), x.get('line', {})
        journal_rows.append(f"<tr><td>{esc(val(j,'TransactionDate')[:10])}</td><td>{esc(val(j,'BatchNbr'))}</td><td>{esc(val(j,'BranchID'))}</td><td>{esc(val(l,'Subaccount'))}</td><td>{esc(val(l,'Project'))}</td><td>{esc(val(l,'TransactionDescription') or val(j,'Description'))}</td><td>{money(val(l,'DebitAmount'))}</td><td>{money(val(l,'CreditAmount'))}</td></tr>")
    err_rows = ''.join(f"<li><code>{esc(e.get('endpoint'))}</code>: {esc(e.get('status'))} — {esc(e.get('body'))}</li>" for e in data.get('errors', [])) or '<li>No recorded endpoint errors.</li>'
    return f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>MYOB account {esc(account)}</title><style>{CSS}</style></head><body><main><header><div><div class='pill'>MYOB account source detail</div><h1>Account {esc(account)}</h1><p>Read-only Morpheus/MYOB account drilldown from <code>{esc(data.get('from_date'))}</code>. Shows exact AP bill lines and journal lines found for this account.</p></div><div class='pill'>{esc(data.get('generated_at'))}</div></header><div class='grid'><div class='card'><div class='label'>Bill lines</div><div class='value'>{d.get('bill_line_count',0)}</div></div><div class='card'><div class='label'>Bill total</div><div class='value'>{money(d.get('bill_line_total'))}</div></div><div class='card'><div class='label'>Journal lines</div><div class='value'>{d.get('journal_line_count',0)}</div></div><div class='card'><div class='label'>Journal debit</div><div class='value'>{money(d.get('journal_debit_total'))}</div></div><div class='card'><div class='label'>Journal net</div><div class='value'>{money(d.get('journal_net_debit'))}</div></div></div><section><h2>AP bill lines</h2><table><tr><th>Date</th><th>Ref</th><th>Vendor</th><th>Branch</th><th>Subaccount</th><th>Description</th><th>Amount</th></tr>{''.join(bill_rows)}</table></section><section><h2>Journal lines</h2><table><tr><th>Date</th><th>Batch</th><th>Branch</th><th>Subaccount</th><th>Project</th><th>Description</th><th>Debit</th><th>Credit</th></tr>{''.join(journal_rows)}</table></section><section><h2>Source and caveats</h2><p>Source: {esc(data.get('source'))}. Limits: <code>{esc(data.get('limits'))}</code>. Journal transactions scanned: <code>{esc(data.get('journals_scanned'))}</code>.</p><ul>{err_rows}</ul><p><a class='link' href='myob-account-drilldown-dashboard.html'>Back to account drilldown</a></p></section></main></body></html>"

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(SRC.glob('myob-account-*-drilldown.json')):
        data = json.loads(path.read_text())
        account = data.get('account') or path.stem.split('-')[2]
        target = OUT / f'myob-account-{account}-detail.html'
        target.write_text(render_detail(data), encoding='utf-8')
        d = data.get('derived', {})
        items.append({'account': account, 'url': target.name, 'bill_lines': d.get('bill_line_count',0), 'bill_total': d.get('bill_line_total',0), 'journal_lines': d.get('journal_line_count',0), 'journal_net': d.get('journal_net_debit',0), 'generated_at': data.get('generated_at')})
    rows = ''.join(f"<tr><td><a class='link' href='{esc(i['url'])}'>{esc(i['account'])}</a></td><td>{i['bill_lines']}</td><td>{money(i['bill_total'])}</td><td>{i['journal_lines']}</td><td>{money(i['journal_net'])}</td><td>{esc(i['generated_at'])}</td></tr>" for i in sorted(items, key=lambda x: (x['bill_lines']+x['journal_lines'], abs(x['journal_net'] or 0)), reverse=True))
    index = f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>MYOB account detail index</title><style>{CSS}</style></head><body><main><header><div><div class='pill'>Precomputed source detail</div><h1>MYOB account details</h1><p>Precomputed read-only account drilldowns. Use this as the bridge from dashboard cards to exact AP bill and journal source lines.</p></div></header><section><h2>Available account detail pages</h2><table><tr><th>Account</th><th>Bill lines</th><th>Bill total</th><th>Journal lines</th><th>Journal net</th><th>Generated</th></tr>{rows}</table></section></main></body></html>"
    (OUT / 'myob-account-detail-index.html').write_text(index, encoding='utf-8')
    (OUT / 'myob-account-detail-index-data.json').write_text(json.dumps(items, indent=2), encoding='utf-8')
    print(OUT / 'myob-account-detail-index.html')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
