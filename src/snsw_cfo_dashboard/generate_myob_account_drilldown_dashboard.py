#!/usr/bin/env python3
"""Generate MYOB Account / Budget Drilldown dashboard.

Uses the broad Morpheus/MYOB read-only cache as a local source-truth explorer.
No live API calls here; regenerate the cache first to refresh data.
"""
from __future__ import annotations

import html
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
CACHE = ROOT / 'finance/myob-cache/morpheus-broad-readonly/morpheus-broad-readonly-cache.json'
OUT = ROOT / 'briefings/dashboards'


def esc(x):
    return html.escape(str(x if x is not None else ''))


def money(v):
    try:
        n = float(v or 0)
    except Exception:
        return '—'
    return f"(${abs(n):,.2f})" if n < 0 else f"${n:,.2f}"


def val(row, *names):
    for name in names:
        if name in row and row[name] not in (None, ''):
            return row[name]
    return ''


def build_model(data: dict) -> dict:
    eps = data.get('endpoints', {})
    accounts = eps.get('Account', {}).get('rows', [])
    bills = eps.get('Bill', {}).get('rows', [])
    invoices = eps.get('Invoice', {}).get('rows', [])
    payments = eps.get('Payment', {}).get('rows', [])
    journals = eps.get('JournalTransaction_since_2025_07_01_sample', {}).get('rows', [])

    account_meta = {}
    for a in accounts:
        cd = str(val(a, 'AccountCD'))
        if cd:
            account_meta[cd] = {
                'account': cd,
                'description': val(a, 'Description'),
                'class': val(a, 'AccountClass'),
                'type': val(a, 'Type'),
                'active': val(a, 'Active'),
            }

    activity = defaultdict(lambda: {
        'account': '', 'description': '', 'type': '', 'class': '',
        'journal_lines': 0, 'journal_debit': 0.0, 'journal_credit': 0.0,
        'bill_lines': 0, 'bill_amount': 0.0,
        'invoice_lines': 0, 'invoice_amount': 0.0,
        'examples': [],
    })

    def ensure(acct):
        row = activity[str(acct)]
        row['account'] = str(acct)
        meta = account_meta.get(str(acct), {})
        row['description'] = meta.get('description', '')
        row['type'] = meta.get('type', '')
        row['class'] = meta.get('class', '')
        return row

    for j in journals:
        for line in j.get('Details', []) or []:
            acct = str(val(line, 'Account', 'AccountID') or 'unknown')
            row = ensure(acct)
            debit = float(val(line, 'DebitAmount', 'DebitAmt') or 0)
            credit = float(val(line, 'CreditAmount', 'CreditAmt') or 0)
            row['journal_lines'] += 1
            row['journal_debit'] += debit
            row['journal_credit'] += credit
            if len(row['examples']) < 6:
                row['examples'].append({
                    'kind': 'journal',
                    'date': val(j, 'TransactionDate')[:10],
                    'reference': val(j, 'BatchNbr'),
                    'party': '',
                    'branch': val(j, 'BranchID'),
                    'description': val(line, 'TransactionDescription') or val(j, 'Description'),
                    'debit': debit,
                    'credit': credit,
                    'amount': debit - credit,
                    'subaccount': val(line, 'Subaccount'),
                    'project': val(line, 'Project'),
                })

    # Broad cache bills/invoices were not expanded in the first seed cache; still show document-level evidence.
    for b in bills:
        # If future cache includes Details, roll line accounts; otherwise document-level only under AP control/cash account if present.
        details = b.get('Details') or []
        if details:
            for line in details:
                acct = str(val(line, 'Account') or 'unknown')
                row = ensure(acct)
                amount = float(val(line, 'Amount', 'ExtendedCost') or 0)
                row['bill_lines'] += 1
                row['bill_amount'] += amount
                if len(row['examples']) < 6:
                    row['examples'].append({'kind': 'bill', 'date': val(b, 'Date')[:10], 'reference': val(b, 'ReferenceNbr'), 'party': val(b, 'Vendor'), 'branch': val(b, 'BranchID'), 'description': val(line, 'TransactionDescription') or val(b, 'Description'), 'debit': amount, 'credit': 0, 'amount': amount, 'subaccount': val(line, 'Subaccount'), 'project': val(line, 'Project')})
        else:
            # Searchable document evidence, not account-allocated.
            pass

    # Include every account, even when the current journal sample has no activity, so searches like
    # 'evangelism' still reveal the account and show that no MYOB-era source lines were found yet.
    for acct in account_meta:
        ensure(acct)
    rows = sorted(activity.values(), key=lambda r: (r['journal_lines'] + r['bill_lines'] + r['invoice_lines'], abs(r['journal_debit']) + abs(r['journal_credit']) + abs(r['bill_amount'])), reverse=True)
    return {
        'generated_at': data.get('generated_at'),
        'source_cache': str(CACHE),
        'endpoint_family': data.get('base_endpoint_family'),
        'counts': {
            'accounts': len(accounts),
            'journals': len(journals),
            'bills': len(bills),
            'invoices': len(invoices),
            'payments': len(payments),
            'activity_accounts': len(rows),
        },
        'accounts': rows,
        'account_meta': account_meta,
        'bills_sample': bills[:120],
        'invoices_sample': invoices[:120],
        'payments_sample': payments[:120],
    }


def render(model: dict) -> str:
    counts = model['counts']
    account_rows = ''.join(
        f"<tr data-search='{esc((r['account']+' '+r['description']+' '+r['type']+' '+r['class']).lower())}' data-account='{esc(r['account'])}'>"
        f"<td><button class='linkbtn' data-account='{esc(r['account'])}'>{esc(r['account'])}</button></td>"
        f"<td>{esc(r['description'])}</td><td>{esc(r['type'])}</td><td>{r['journal_lines']}</td>"
        f"<td>{money(r['journal_debit'])}</td><td>{money(r['journal_credit'])}</td><td>{money(r['journal_debit']-r['journal_credit'])}</td></tr>"
        for r in model['accounts'][:220]
    )
    account_json = json.dumps({r['account']: r for r in model['accounts']})
    detail_links = {path.stem.split('-')[2]: path.name for path in OUT.glob('myob-account-*-detail.html')}
    detail_json = json.dumps(detail_links)
    bill_rows = ''.join(
        f"<tr data-search='{esc(str(b).lower())}'><td>{esc(val(b,'Date')[:10])}</td><td>{esc(val(b,'ReferenceNbr'))}</td><td>{esc(val(b,'Vendor'))}</td><td>{esc(val(b,'BranchID'))}</td><td>{esc(val(b,'Description'))}</td><td>{money(b.get('Amount'))}</td><td>{money(b.get('Balance'))}</td></tr>"
        for b in model['bills_sample']
    )
    invoice_rows = ''.join(
        f"<tr data-search='{esc(str(i).lower())}'><td>{esc(val(i,'Date')[:10])}</td><td>{esc(val(i,'ReferenceNbr'))}</td><td>{esc(val(i,'Customer'))}</td><td>{esc(val(i,'BranchID'))}</td><td>{esc(val(i,'Description'))}</td><td>{money(i.get('Amount'))}</td><td>{money(i.get('Balance'))}</td></tr>"
        for i in model['invoices_sample']
    )
    return f"""<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>MYOB Account Drilldown</title><style>
:root{{--bg:#f6f9fc;--surface:#fff;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--green:#0a8f43;--amber:#a66512;--shadow:rgba(50,50,93,.18) 0 30px 60px -35px,rgba(0,0,0,.08) 0 18px 40px -24px;}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 0 0,rgba(83,58,253,.12),transparent 28%),radial-gradient(circle at 90% 0,rgba(249,107,238,.10),transparent 24%),linear-gradient(180deg,#fff,#f6f9fc 44%,#eef4fb);font:300 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text)}}main{{max-width:1400px;margin:0 auto;padding:34px}}header{{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:24px}}h1{{font-size:48px;letter-spacing:-.065em;font-weight:300;color:var(--ink);margin:8px 0}}h2{{font-size:24px;color:var(--ink);letter-spacing:-.04em;font-weight:350;margin:0 0 14px}}p{{color:var(--muted)}}.pill{{display:inline-flex;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:999px;padding:7px 10px;box-shadow:rgba(23,23,23,.04) 0 2px 8px;white-space:nowrap}}.grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}.card,section{{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:18px}}.label{{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#718098;font-weight:650}}.value{{font-size:34px;color:var(--ink);letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:8px 0}}section{{margin-top:18px}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;vertical-align:top;padding:9px 8px;border-bottom:1px solid var(--line)}}th{{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#718098}}code{{background:#f8fbff;border:1px solid var(--line);border-radius:6px;padding:2px 6px}}input{{width:100%;border:1px solid var(--line);border-radius:9px;padding:12px 14px;font:inherit;background:#fff;box-shadow:rgba(23,23,23,.04) 0 2px 8px}}.linkbtn{{appearance:none;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:7px;padding:5px 8px;cursor:pointer}}.drawer{{position:fixed;right:0;top:0;bottom:0;width:min(600px,94vw);background:#fff;border-left:1px solid var(--line);box-shadow:rgba(15,23,42,.22) -24px 0 80px;transform:translateX(105%);transition:.22s ease;z-index:5;padding:24px;overflow:auto}}.drawer.open{{transform:translateX(0)}}.close{{float:right}}.tabs{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}@media(max-width:900px){{.grid,.tabs{{grid-template-columns:1fr}}header{{display:block}}}}
</style></head><body><main>
<header><div><div class='pill'>Budget-to-source drilldown</div><h1>MYOB Account Drilldown</h1><p>Search accounts and source records from the current Morpheus/MYOB read-only cache. Click an account to see example journal lines and source metadata. This is the pattern every budget card should use.</p></div><div class='pill'>Generated {esc(model['generated_at'])}</div></header>
<div class='grid'><div class='card'><div class='label'>Accounts</div><div class='value'>{counts['accounts']}</div></div><div class='card'><div class='label'>Journal txns</div><div class='value'>{counts['journals']}</div></div><div class='card'><div class='label'>Activity accounts</div><div class='value'>{counts['activity_accounts']}</div></div><div class='card'><div class='label'>AP/AR docs</div><div class='value'>{counts['bills']+counts['invoices']}</div><p>{counts['bills']} bills / {counts['invoices']} invoices cached</p></div></div>
<section><h2>Find a budget/account source</h2><input id='search' placeholder='Search account, description, evangelism, rent, travel, AAV, school, vendor, invoice...' autocomplete='off'><p>Example: search <code>703430</code> or <code>evangelism</code>. If the account has current MYOB activity in the sample, click the account number for source examples.</p></section>
<section><h2>Account activity from journal sample</h2><table id='accounts'><tr><th>Account</th><th>Description</th><th>Type</th><th>Journal lines</th><th>Debit</th><th>Credit</th><th>Net debit</th></tr>{account_rows}</table></section>
<div class='tabs'><section><h2>Bills sample</h2><table id='bills'><tr><th>Date</th><th>Ref</th><th>Vendor</th><th>Branch</th><th>Description</th><th>Amount</th><th>Balance</th></tr>{bill_rows}</table></section><section><h2>Invoices sample</h2><table id='invoices'><tr><th>Date</th><th>Ref</th><th>Customer</th><th>Branch</th><th>Description</th><th>Amount</th><th>Balance</th></tr>{invoice_rows}</table></section></div>
<section><h2>Known limitation</h2><p>The broad cache currently samples bills and invoices at document level. The account-specific extractor can pull <code>Bill?$expand=Details</code> for line-level AP invoice detail when you drill a specific account. Full P&L/Budget-vs-actual still needs either TrialBalance/Ledger/Subaccount permissions or an alternate report endpoint.</p><p>Source cache: <code>{esc(model['source_cache'])}</code></p></section>
</main><aside class='drawer' id='drawer'><button class='linkbtn close' onclick='drawer.classList.remove("open")'>Close</button><div id='drawerBody'></div></aside>
<script>
const accountData={account_json};
const detailLinks={detail_json};
const drawer=document.getElementById('drawer'), drawerBody=document.getElementById('drawerBody');
document.addEventListener('click',e=>{{const b=e.target.closest('[data-account]'); if(!b) return; const r=accountData[b.dataset.account]; if(!r) return; drawerBody.innerHTML=`<h2>${{r.account}} — ${{r.description||'No description'}}</h2><p><b>Type:</b> ${{r.type||''}} &nbsp; <b>Class:</b> ${{r.class||''}}</p><p><b>Journal lines:</b> ${{r.journal_lines}} &nbsp; <b>Debit:</b> ${{Number(r.journal_debit).toLocaleString(undefined,{{style:'currency',currency:'AUD'}})}} &nbsp; <b>Credit:</b> ${{Number(r.journal_credit).toLocaleString(undefined,{{style:'currency',currency:'AUD'}})}}</p><h3>Source examples</h3><table><tr><th>Kind</th><th>Date</th><th>Ref</th><th>Description</th><th>Debit</th><th>Credit</th><th>Subaccount</th></tr>${{(r.examples||[]).map(x=>`<tr><td>${{x.kind}}</td><td>${{x.date||''}}</td><td>${{x.reference||''}}</td><td>${{x.description||''}}</td><td>${{Number(x.debit||0).toLocaleString(undefined,{{style:'currency',currency:'AUD'}})}}</td><td>${{Number(x.credit||0).toLocaleString(undefined,{{style:'currency',currency:'AUD'}})}}</td><td><code>${{x.subaccount||''}}</code></td></tr>`).join('')}}</table><p>${{detailLinks[r.account] ? `<a class='linkbtn' href='${{detailLinks[r.account]}}'>Open precomputed AP/journal source detail</a>` : `For full AP line extraction on this account, run <code>extract_myob_account_drilldown.py --account ${{r.account}}</code>.`}}</p>`; drawer.classList.add('open');}});
const search=document.getElementById('search');
search.addEventListener('input',()=>{{const q=search.value.toLowerCase().trim(); for(const tr of document.querySelectorAll('tr[data-search]')){{tr.style.display=!q||tr.dataset.search.includes(q)?'':'none';}} }});
</script></body></html>"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.loads(CACHE.read_text())
    model = build_model(data)
    (OUT / 'myob-account-drilldown-dashboard.html').write_text(render(model), encoding='utf-8')
    (OUT / 'myob-account-drilldown-dashboard-data.json').write_text(json.dumps(model, indent=2), encoding='utf-8')
    print(OUT / 'myob-account-drilldown-dashboard.html')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
