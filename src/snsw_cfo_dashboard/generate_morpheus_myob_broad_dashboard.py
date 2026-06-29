#!/usr/bin/env python3
"""Generate broader Morpheus/MYOB read-only dashboard."""
from __future__ import annotations

import html, json
from collections import defaultdict
from pathlib import Path

ROOT=Path('/Users/snswcommunications/Hermes-CFO')
CACHE=ROOT/'finance/myob-cache/morpheus-broad-readonly/morpheus-broad-readonly-cache.json'
OUT=ROOT/'briefings/dashboards'

def esc(x): return html.escape(str(x if x is not None else ''))
def money(v):
    try: n=float(v or 0)
    except Exception: return '—'
    return f"(${abs(n):,.2f})" if n<0 else f"${n:,.2f}"

def val(row,*names):
    for n in names:
        if n in row and row[n] not in (None,''):
            return row[n]
    return ''

def render(data):
    eps=data['endpoints']
    counts={k: (v.get('count') or len(v.get('rows',[]))) for k,v in eps.items()}
    accounts=eps.get('Account',{}).get('rows',[])
    bills=eps.get('Bill',{}).get('rows',[])
    invoices=eps.get('Invoice',{}).get('rows',[])
    payments=eps.get('Payment',{}).get('rows',[])
    journals=eps.get('JournalTransaction_since_2025_07_01_sample',{}).get('rows',[])
    vendors=eps.get('Vendor',{}).get('rows',[])
    customers=eps.get('Customer',{}).get('rows',[])
    acct_active=sum(1 for a in accounts if a.get('Active') is True)
    bill_total=sum(float(b.get('Amount') or 0) for b in bills)
    invoice_total=sum(float(i.get('Amount') or 0) for i in invoices)
    payment_total=sum(float(p.get('PaymentAmount') or p.get('Amount') or 0) for p in payments)
    branches=defaultdict(int)
    journal_lines=0
    account_activity=defaultdict(lambda:{'debit':0.0,'credit':0.0,'lines':0})
    for j in journals:
        br=val(j,'BranchID','Branch')
        if br: branches[br]+=1
        for d in j.get('Details',[]) or []:
            journal_lines+=1
            acct=val(d,'Account','AccountID') or 'unknown'
            deb=float(val(d,'DebitAmount','DebitAmt') or 0)
            cre=float(val(d,'CreditAmount','CreditAmt') or 0)
            account_activity[acct]['debit']+=deb; account_activity[acct]['credit']+=cre; account_activity[acct]['lines']+=1
    acct_rows=''.join(f"<tr><td>{esc(val(a,'AccountCD'))}</td><td>{esc(val(a,'Description'))}</td><td>{esc(val(a,'AccountClass'))}</td><td>{esc(val(a,'Type'))}</td><td>{esc(val(a,'Active'))}</td></tr>" for a in accounts[:80])
    branch_rows=''.join(f"<tr><td>{esc(k)}</td><td>{v}</td></tr>" for k,v in sorted(branches.items(), key=lambda kv: kv[1], reverse=True))
    activity_rows=''.join(f"<tr><td>{esc(k)}</td><td>{v['lines']}</td><td>{money(v['debit'])}</td><td>{money(v['credit'])}</td></tr>" for k,v in sorted(account_activity.items(), key=lambda kv: kv[1]['lines'], reverse=True)[:40])
    endpoint_rows=''.join(f"<tr><td>{esc(k)}</td><td>{'ok' if v.get('ok') else 'check'}</td><td>{esc(v.get('count') or len(v.get('rows',[])))}</td><td>{esc(v.get('status'))}</td></tr>" for k,v in eps.items())
    bill_rows=''.join(f"<tr><td>{esc(val(b,'Date'))[:10]}</td><td>{esc(val(b,'Vendor'))}</td><td>{esc(val(b,'BranchID'))}</td><td>{esc(val(b,'Description'))}</td><td>{money(b.get('Amount'))}</td><td>{money(b.get('Balance'))}</td></tr>" for b in bills[:40])
    invoice_rows=''.join(f"<tr><td>{esc(val(i,'Date'))[:10]}</td><td>{esc(val(i,'Customer'))}</td><td>{esc(val(i,'BranchID'))}</td><td>{esc(val(i,'Description'))}</td><td>{money(i.get('Amount'))}</td><td>{money(i.get('Balance'))}</td></tr>" for i in invoices[:40])
    vendor_rows=''.join(f"<tr><td>{esc(val(v,'VendorID','AccountRef'))}</td><td>{esc(val(v,'VendorName','AccountName'))}</td><td>{esc(val(v,'APAccount'))}</td><td>{esc(val(v,'Status','Active'))}</td></tr>" for v in vendors[:40])
    customer_rows=''.join(f"<tr><td>{esc(val(c,'CustomerID','AccountRef'))}</td><td>{esc(val(c,'CustomerName','AccountName'))}</td><td>{esc(val(c,'Status','Active'))}</td></tr>" for c in customers[:40])
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Morpheus MYOB broad readonly</title><style>
:root{{--bg:#f6f9fc;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--shadow:rgba(50,50,93,.18) 0 30px 60px -35px,rgba(0,0,0,.08) 0 18px 40px -24px;}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 0 0,rgba(83,58,253,.12),transparent 28%),linear-gradient(180deg,#fff,#f6f9fc 44%,#eef4fb);font:300 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text)}}main{{max-width:1400px;margin:0 auto;padding:34px}}header{{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:24px}}h1{{font-size:48px;letter-spacing:-.065em;font-weight:300;color:var(--ink);margin:8px 0}}h2{{font-size:24px;color:var(--ink);letter-spacing:-.04em;font-weight:350;margin:0 0 14px}}p{{color:var(--muted)}}.pill{{display:inline-flex;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:999px;padding:7px 10px;box-shadow:rgba(23,23,23,.04) 0 2px 8px;white-space:nowrap}}.grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}.card,section{{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:18px}}.label{{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#718098;font-weight:650}}.value{{font-size:34px;color:var(--ink);letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:8px 0}}section{{margin-top:18px}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;vertical-align:top;padding:9px 8px;border-bottom:1px solid var(--line)}}th{{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#718098}}code{{background:#f8fbff;border:1px solid var(--line);border-radius:6px;padding:2px 6px}}.tabs{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}@media(max-width:900px){{.grid,.tabs{{grid-template-columns:1fr}}header{{display:block}}}}
</style></head><body><main><header><div><div class='pill'>Read-only MYOB Advanced via Morpheus</div><h1>Morpheus MYOB broad cache</h1><p>Broader current-MYOB seed cache. GET-only. No credentials stored locally. Some GL forms are still permission-blocked, but account, journal, AR/AP and payment endpoints are accessible.</p></div><div class='pill'>Generated {esc(data.get('generated_at'))}</div></header>
<div class='grid'><div class='card'><div class='label'>Accounts</div><div class='value'>{counts.get('Account',0)}</div><p>{acct_active} active</p></div><div class='card'><div class='label'>Journal sample</div><div class='value'>{counts.get('JournalTransaction_since_2025_07_01_sample',0)}</div><p>{journal_lines} journal detail lines since 2025-07-01 sample cap</p></div><div class='card'><div class='label'>Bills cached</div><div class='value'>{counts.get('Bill',0)}</div><p>{money(bill_total)} sampled amount</p></div><div class='card'><div class='label'>Invoices cached</div><div class='value'>{counts.get('Invoice',0)}</div><p>{money(invoice_total)} sampled amount</p></div></div>
<div class='grid' style='margin-top:14px'><div class='card'><div class='label'>Vendors</div><div class='value'>{counts.get('Vendor',0)}</div></div><div class='card'><div class='label'>Customers</div><div class='value'>{counts.get('Customer',0)}</div></div><div class='card'><div class='label'>Payments</div><div class='value'>{counts.get('Payment',0)}</div><p>{money(payment_total)} sampled amount</p></div><div class='card'><div class='label'>Endpoint family</div><div class='value' style='font-size:18px'>{esc(data.get('base_endpoint_family'))}</div></div></div>
<section><h2>Endpoint cache status</h2><table><tr><th>Endpoint</th><th>Status</th><th>Rows</th><th>HTTP</th></tr>{endpoint_rows}</table></section>
<div class='tabs'><section><h2>Journal branch sample</h2><table><tr><th>Branch</th><th>Journal txns</th></tr>{branch_rows}</table></section><section><h2>Top account activity in journal sample</h2><table><tr><th>Account</th><th>Lines</th><th>Debit</th><th>Credit</th></tr>{activity_rows}</table></section></div>
<section><h2>Chart of accounts sample</h2><table><tr><th>Account</th><th>Description</th><th>Class</th><th>Type</th><th>Active</th></tr>{acct_rows}</table></section>
<div class='tabs'><section><h2>Bills sample</h2><table><tr><th>Date</th><th>Vendor</th><th>Branch</th><th>Description</th><th>Amount</th><th>Balance</th></tr>{bill_rows}</table></section><section><h2>Invoices sample</h2><table><tr><th>Date</th><th>Customer</th><th>Branch</th><th>Description</th><th>Amount</th><th>Balance</th></tr>{invoice_rows}</table></section></div>
<div class='tabs'><section><h2>Vendors sample</h2><table><tr><th>ID/ref</th><th>Name</th><th>AP acct</th><th>Status</th></tr>{vendor_rows}</table></section><section><h2>Customers sample</h2><table><tr><th>ID/ref</th><th>Name</th><th>Status</th></tr>{customer_rows}</table></section></div>
<section><h2>Permission blockers</h2><p>Endpoint probes showed insufficient rights for Ledger, FinancialPeriod, Subaccount, TrialBalance, PurchaseOrder and SalesOrder. Branch/Company/CashAccount were not exposed in this endpoint family. This dashboard is therefore a broad seed cache, not a full financial statement engine yet.</p><p>Cache: <code>{esc(CACHE)}</code></p></section>
</main></body></html>"""

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data=json.loads(CACHE.read_text())
    (OUT/'morpheus-myob-broad-readonly-dashboard.html').write_text(render(data), encoding='utf-8')
    (OUT/'morpheus-myob-broad-readonly-dashboard-data.json').write_text(json.dumps({'generated_at':data.get('generated_at'),'source_cache':str(CACHE),'endpoint_counts':{k:(v.get('count') or len(v.get('rows',[]))) for k,v in data['endpoints'].items()}}, indent=2), encoding='utf-8')
    print(OUT/'morpheus-myob-broad-readonly-dashboard.html')
if __name__=='__main__': main()
