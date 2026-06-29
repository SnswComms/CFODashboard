#!/usr/bin/env python3
"""Generate the CFO Finance Source Status dashboard.

This page is the control tower for finance data lanes: MYOB/Morpheus current API,
legacy SUN historical data, Velixo/report workbooks, payroll, session reports, and
email evidence.
"""
from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from pathlib import Path
from cfo_stripe_theme import apply_stripe_theme, ensure_theme_file

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'briefings' / 'dashboards'

LANES = [
    {
        'id': 'myob_morpheus',
        'name': 'MYOB / Morpheus current finance API',
        'status': 'confirmed broader read-only connector / some GL forms permission-blocked',
        'coverage': 'Recent MYOB era; confirmed Account, JournalTransaction, Customer, Vendor, Bill, Invoice, Payment plus benefits-tracker account 312510',
        'role': 'Current MYOB Advanced read-only extraction can seed chart of accounts, journal samples, AR/AP objects and payments. Financial statement engine still needs TrialBalance/Ledger/FinancialPeriod/Subaccount rights or alternate report endpoints.',
        'next': 'Turn broad cache into entity cash/P&L source objects where possible; request/enable read-only rights for Ledger, TrialBalance, FinancialPeriod and Subaccount or locate equivalent report endpoints.',
        'source_truth': ['Morpheus app: benefits-tracker.service on morpheus@promaxgb10-6360.local / Tailscale 100.87.6.30', 'Broad cache: finance/myob-cache/morpheus-broad-readonly/morpheus-broad-readonly-cache.json', 'Accessible endpoints confirmed: Account, JournalTransaction, Customer, Vendor, Bill, Invoice, Payment', 'Benefits cache: finance/myob-cache/morpheus-benefits-312510/morpheus-benefits-312510-cache.json', 'Inventory: projects/cfo-second-brain/indexes/morpheus-myob-access-inventory-2026-06-20.md'],
        'risk': 'This proves broader MYOB read access, but Ledger/TrialBalance/FinancialPeriod/Subaccount are currently permission-blocked, so full financial statement extraction is not complete.',
        'confidence': 'medium',
    },
    {
        'id': 'sun_legacy',
        'name': 'SUN legacy finance history',
        'status': 'required / partially represented through exports',
        'coverage': 'Pre-MYOB historical finance; long-run GL and function history',
        'role': 'Older GL, field/function staff-cost history, entity results, budget-vs-actual history before MYOB.',
        'next': 'Locate or request complete SUN exports: chart/accounts, periods, entities, departments/functions, journals, budgets, trial balances, P&L/balance sheet outputs.',
        'source_truth': ['SUN 6 Budget Master / operating workbooks in Files - SNSW-Finance - Finance', 'SUN5 operating report extracts', 'Trial Balance / Caseware files across SNC/SNU/SNE/schools', 'SUN→MYOB migration/reconciliation files from 2025', 'Inventory: projects/cfo-second-brain/indexes/sun-legacy-finance-source-inventory-2026-06-20.md'],
        'risk': 'Without SUN, long-run trends will be stitched from reports rather than source ledger.',
        'confidence': 'medium',
    },
    {
        'id': 'velixo_workbooks',
        'name': 'Velixo / Excel management workbooks',
        'status': 'available locally',
        'coverage': 'Budget/spend dashboards, May 2026 operating graph, department workbooks',
        'role': 'Fast source for existing dashboards, budgets, February/May actuals, cash sections, department/function summaries.',
        'next': 'Create a workbook index that maps every dashboard metric to workbook/sheet/cell/period.',
        'source_truth': ['finance/excel-index metadata', 'briefings/dashboards generated outputs', 'tools/dashboard generators'],
        'risk': 'Workbook extracts can mix periods/bases unless every figure carries source metadata.',
        'confidence': 'high',
    },
    {
        'id': 'payroll',
        'name': 'Payroll / staff cost history',
        'status': 'available from FY2023-24 onward',
        'coverage': 'Payroll person-by-FY, current allocation overrides and staff-role mapping',
        'role': 'People cost, office/staffing models, Ministry Field Map cost layer, funding-offset checks.',
        'next': 'Add explicit funding-offset, remote-worker and entity-benefit fields; reconstruct older people history from SUN/session/email evidence.',
        'source_truth': ['finance/payroll-staff-costs/payroll_person_by_fy_sensitive.csv', 'current_25_26_staff_allocation_with_overrides.csv', 'staff-role-overrides.json'],
        'risk': 'FY2023-24+ only; older headcount must not be inferred without evidence.',
        'confidence': 'high',
    },
    {
        'id': 'session_reports',
        'name': 'Constituency/session published reports',
        'status': 'catalogued',
        'coverage': '2005, 2008, 2011, 2014, 2017, 2021, 2025 session packs',
        'role': 'Member-reportable historical trend spine and published-claims source lane.',
        'next': 'Targeted extraction of tithe, membership, entity finance, school, AAV, property/loan and staffing claims with page/slide references.',
        'source_truth': ['Files - SNSW-CFO - CFO/CFO/Session SNSW/', 'constituency-history-data.json'],
        'risk': 'Published claims are not ledger truth; use Investigations Layer to challenge where needed.',
        'confidence': 'high for catalogue, low/medium for extracted metrics until parsed',
    },
    {
        'id': 'email_intelligence',
        'name': 'Email intelligence / attachment text',
        'status': 'indexed locally',
        'coverage': '89,119 emails; 42,216 extracted attachment texts at last generation',
        'role': 'Investigations Layer, source citations, person/org history, contradictions, approvals and context behind financial decisions.',
        'next': 'Wire the Email Intelligence page into claim cards so every weak source can launch a targeted search packet.',
        'source_truth': ['email-knowledge/_state/smart_mail_index.sqlite', 'email-knowledge/_state/attachment_text.sqlite', 'tools/outlook-reader/smart_mail_lookup.py'],
        'risk': 'Email evidence is context/support, not automatically authoritative finance truth.',
        'confidence': 'high',
    },
]


def esc(x):
    return html.escape(str(x or ''))


def render() -> str:
    generated = datetime.now(timezone.utc).isoformat(timespec='seconds')
    quick = {
        'myob_morpheus': ('Current transactions', 'Not full financial statements yet', 'Enable Ledger/TrialBalance/Period rights'),
        'sun_legacy': ('Older trends', 'Not complete source ledger yet', 'Find complete SUN exports'),
        'velixo_workbooks': ('Fast budget/spend views', 'Can mix period/basis', 'Map workbook/sheet/cell for each metric'),
        'payroll': ('People cost from FY2023-24+', 'Older headcount not safe', 'Add funding-offset/entity-benefit fields'),
        'session_reports': ('Published history spine', 'Published ≠ ledger truth', 'Extract claims with page refs'),
        'email_intelligence': ('Context, approvals, contradictions', 'Not authority by itself', 'Link weak claims to targeted searches'),
    }
    cards = ''.join(f"""
      <button class="card source-card" data-evidence="{esc(l['id'])}">
        <div class="eyebrow">{esc(l['status'])}</div>
        <h2>{esc(l['name'])}</h2>
        <div class="answer-row"><b>Use</b><span>{esc(quick[l['id']][0])}</span><b>Risk</b><span>{esc(quick[l['id']][1])}</span><b>Next</b><span>{esc(quick[l['id']][2])}</span></div>
        <div class="meta"><span>{esc(l['confidence'])} confidence</span><span>Open drawer for source paths</span></div>
      </button>
    """ for l in LANES)
    queue_cards = ''.join(f"""
      <details class="queue-card">
        <summary><b>{esc(l['name'])}</b><span>{esc(quick[l['id']][2])}</span></summary>
        <div class="queue-body"><div><b>Coverage</b><p>{esc(l['coverage'])}</p></div><div><b>Main risk</b><p>{esc(l['risk'])}</p></div></div>
      </details>
    """ for l in LANES)
    evidence_json = json.dumps({l['id']: l for l in LANES})
    return f"""<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Finance Source Status</title>
<style>
:root{{--bg:#f6f9fc;--surface:#fff;--surface2:#f8fbff;--ink:#061b31;--text:#334155;--muted:#64748d;--line:#e5edf5;--purple:#533afd;--green:#0a8f43;--amber:#a66512;--pink:#ea2261;--shadow:rgba(50,50,93,.18) 0 30px 60px -35px,rgba(0,0,0,.08) 0 18px 40px -24px;}}
*{{box-sizing:border-box}} body{{margin:0;background:radial-gradient(circle at 0 0,rgba(83,58,253,.12),transparent 28%),linear-gradient(180deg,#fff,#f6f9fc 42%,#eef4fb);font:300 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text)}}
main{{max-width:1320px;margin:0 auto;padding:24px}} header{{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:18px}} h1{{font-size:42px;line-height:1;letter-spacing:-.055em;font-weight:300;color:var(--ink);margin:8px 0 8px}} p{{color:var(--muted)}} .pill{{display:inline-flex;border:1px solid #d6d9fc;background:#fff;color:var(--purple);border-radius:4px;padding:7px 10px;box-shadow:rgba(23,23,23,.04) 0 2px 8px}} .source-grid{{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important}} .card{{text-align:left;appearance:none;background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;padding:16px;box-shadow:var(--shadow);cursor:pointer;min-height:0}} .card:hover{{transform:translateY(-2px);border-color:#c7c7ff}} .card h2{{font-size:20px;line-height:1.1;letter-spacing:-.04em;font-weight:350;color:var(--ink);margin:8px 0 10px}} .eyebrow{{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#718098;font-weight:650;min-height:24px}} .answer-row{{display:grid;grid-template-columns:70px 1fr;gap:6px 10px;color:#64748d;font-size:13px;line-height:1.25}}.answer-row b{{color:#061b31;font-weight:500}} .meta{{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}} .meta span{{font-size:12px;border:1px solid var(--line);background:#f8fbff;border-radius:4px;padding:5px 8px;color:var(--muted)}} section{{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:18px;margin-top:18px}} h3{{font-size:22px;color:var(--ink);letter-spacing:-.04em;font-weight:350;margin:0 0 12px}} table{{width:100%;border-collapse:collapse}} th,td{{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid var(--line)}} th{{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#718098}} .drawer{{position:fixed;right:0;top:0;bottom:0;width:min(560px,92vw);background:#fff;border-left:1px solid var(--line);box-shadow:rgba(15,23,42,.22) -24px 0 80px;transform:translateX(105%);transition:.22s ease;z-index:5;padding:24px;overflow:auto}} .drawer.open{{transform:translateX(0)}} .drawer h2{{font-size:28px;color:var(--ink);font-weight:350;letter-spacing:-.05em}} .close{{float:right;border:1px solid var(--line);background:#fff;border-radius:6px;padding:8px 10px;color:var(--purple);cursor:pointer}} code{{font-size:12px;color:#334155}}@media(max-width:1050px){{.source-grid{{grid-template-columns:repeat(2,minmax(0,1fr))!important}}}}@media(max-width:720px){{.source-grid{{grid-template-columns:1fr!important}}}}
</style><style>.quick-grid,.metric-rule{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}}.quick,.metric-rule div{{background:#fff;border:1px solid #e5edf5;border-radius:8px;padding:12px;box-shadow:rgba(23,23,23,.05) 0 8px 20px -14px}}.metric-rule div{{background:#f8fbff}}.quick b,.metric-rule b{{display:block;color:#061b31;font-weight:500;margin-bottom:4px}}.quick span,.metric-rule span{{display:block;color:#64748d;font-size:13px;line-height:1.28}}.source-card{{min-height:190px}}.source-card .answer-row{{grid-template-columns:48px 1fr}}.queue-list{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}.queue-card{{border:1px solid #e5edf5;border-radius:8px;background:#fff;padding:0;overflow:hidden}}.queue-card summary{{cursor:pointer;list-style:none;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px 14px}}.queue-card summary::-webkit-details-marker{{display:none}}.queue-card summary b{{color:#061b31;font-weight:500}}.queue-card summary span{{color:#64748d;font-size:13px}}.queue-body{{display:grid;grid-template-columns:1fr 1fr;gap:10px;border-top:1px solid #e5edf5;background:#f8fbff;padding:12px 14px}}.queue-body b{{display:block;color:#061b31;margin-bottom:4px}}.queue-body p{{margin:0;color:#64748d;font-size:13px;line-height:1.32}}.drawer .metric-rule{{grid-template-columns:1fr 1fr}}@media(max-width:980px){{.quick-grid,.metric-rule,.drawer .metric-rule,.queue-list,.queue-body{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}@media(max-width:720px){{.quick-grid,.metric-rule,.drawer .metric-rule,.queue-list,.queue-body{{grid-template-columns:1fr}}}}</style></head><body><main>
<header><div><div class='pill'>Finance source control tower</div><h1>Finance source status</h1><p>Pick the source lane before trusting a number. The first screen should answer “can I use this yet?” without reading a memo.</p></div><div class='pill'>Generated {esc(generated)}</div></header>
<div class='quick-grid'><div class='quick'><b>Kyle / CFO</b><span>Use MYOB for current transaction evidence; use approved budget PDFs for authority.</span></div><div class='quick'><b>Budget owners</b><span>Start with department pages; come here only when the source basis is unclear.</span></div><div class='quick'><b>AUC / auditor</b><span>Open drawers for source paths, extraction method, confidence and blockers.</span></div><div class='quick'><b>Local users</b><span>Placeholders mean the source lane is not wired yet, not that the result is zero.</span></div></div>
<div class='source-grid'>{cards}</div>
<section><h3>Build queue</h3><div class='queue-list'>{queue_cards}</div></section>
<section><h3>Rule for every future metric</h3><div class='metric-rule'><div><b>Period</b><span>FY, month/YTD range, or as-of date.</span></div><div><b>Basis</b><span>Budget, actual, forecast, placeholder, or scenario.</span></div><div><b>Source</b><span>Workbook/API/cache/email path plus extraction method.</span></div><div><b>Confidence</b><span>What can be used now, and what source gap changes the answer.</span></div></div></section>
</main><aside id='drawer' class='drawer'><button class='close' onclick='drawer.classList.remove("open")'>Close</button><div id='drawerBody'></div></aside>
<script>
const evidence={evidence_json};
const drawer=document.getElementById('drawer'), body=document.getElementById('drawerBody');
function sourceList(x){{return (x.source_truth||[]).map(s=>`<li><code>${{s}}</code></li>`).join('')}}
document.addEventListener('click', e=>{{
  const c=e.target.closest('[data-evidence]'); if(!c) return;
  const x=evidence[c.dataset.evidence]; if(!x) return;
  body.innerHTML=`<h2>${{x.name}}</h2>
    <div class="metric-rule"><div><b>Use</b><span>${{x.coverage}}</span></div><div><b>Confidence</b><span>${{x.confidence}}</span></div><div><b>Risk</b><span>${{x.risk}}</span></div><div><b>Next</b><span>${{x.next}}</span></div></div>
    <div class="metric-rule"><div><b>Decision state</b><span>${{x.status}}</span></div><div><b>Meaning</b><span>${{x.role}}</span></div></div>
    <details open><summary style="cursor:pointer;color:#533afd;font-weight:500">Source truth / local paths</summary><ul>${{sourceList(x)}}</ul></details>`;
  drawer.classList.add('open');
}});
</script></body></html>"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ensure_theme_file(OUT)
    (OUT / 'finance-source-status.html').write_text(apply_stripe_theme(render()), encoding='utf-8')
    (OUT / 'finance-source-status-data.json').write_text(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(), 'lanes': LANES}, indent=2), encoding='utf-8')
    print(OUT / 'finance-source-status.html')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
