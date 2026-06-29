#!/usr/bin/env python3
"""Generate status dashboard for prior-year comparisons across the CFO portal."""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path('/Users/snswcommunications/Hermes-CFO')
OUT = ROOT / 'briefings' / 'dashboards'
OUT_HTML = OUT / 'history-comparison-status.html'
OUT_JSON = OUT / 'history-comparison-status-data.json'

def h(v): return html.escape('' if v is None else str(v), quote=True)
def money(v):
    try: x=float(v or 0)
    except Exception: return '—'
    s=f'${abs(x):,.0f}'
    return f'({s})' if x<0 else s

def load(name):
    p=OUT/name
    return json.loads(p.read_text()) if p.exists() else {}

def main():
    staff=load('staff-cost-dashboard-data.json')
    office=load('office-staff-modelling-map-data.json')
    field=load('field-pastoral-staffing-dashboard-data.json')
    dept=load('department-budget-dashboard-data.json')
    snc=load('snc-2026-budget-spend-dashboard-data.json')
    cfo=load('cfo-budget-decision-dashboard-data.json')
    rows=[]
    fy=staff.get('fy',[])
    if fy:
        rows.append({'area':'Whole staff cost / payroll','status':'Available','period':'FY2023-24, FY2024-25, FY2025-26','what':f"{len(fy)} FY totals; {staff.get('unique_staff','—')} unique staff in source",'link':'staff-cost-dashboard.html','source':staff.get('source','')})
    else:
        rows.append({'area':'Whole staff cost / payroll','status':'Missing','period':'—','what':'No FY trend data found in generated staff-cost JSON.','link':'staff-cost-dashboard.html','source':''})
    off_summary=office.get('summary',{})
    if office.get('trend_totals'):
        rows.append({'area':'Conference office staff cost','status':'Available','period':'FY2023-24 to FY2025-26','what':f"Office cost trend: {money(off_summary.get('trend_total_23_24'))} → {money(off_summary.get('trend_total_25_26'))}; current office people {off_summary.get('office_person_rows','—')}",'link':'office-staff-modelling-map.html','source':office.get('sources',{}).get('payroll_person_by_fy_csv','')})
    else:
        rows.append({'area':'Conference office staff cost','status':'Missing','period':'—','what':'No office trend totals found.','link':'office-staff-modelling-map.html','source':''})
    if field.get('historical_actual_trend'):
        rows.append({'area':'Field / pastoral historical actuals','status':'Available','period':field.get('periods',{}).get('history',''), 'what':f"{len(field.get('historical_actual_trend'))} historical points found",'link':'field-pastoral-staffing-dashboard.html','source':'See dashboard JSON'})
    else:
        rows.append({'area':'Field / pastoral historical actuals','status':'Not indexed yet','period':field.get('periods',{}).get('history','Historical actuals not indexed'), 'what':field.get('history_status',{}).get('next_action','Build historical field-staff-cost index with source workbook/account/function/FY/actual/confidence.'),'link':'field-pastoral-staffing-dashboard.html','source':'Legacy SUN/workbooks need indexing'})
    rows.append({'area':'Department budget vs actual by function','status':'Current year only','period':dept.get('period_context',{}).get('budget_period_label','FY2026 budget')+' vs '+dept.get('period_context',{}).get('actual_period_label','current actuals'), 'what':'FY2026 approved budget vs current actuals exists. Prior-year department/function budget and actual history not yet indexed.', 'link':'department-budget-dashboard.html','source':dept.get('source','')})
    rows.append({'area':'SNC operating / cash / summary','status':'Current year only','period':snc.get('period_note','FY2026/current operating summary'), 'what':'Current budget/spend and cash rows exist. Prior-year operating/cash trend needs indexed operating statement history.', 'link':'snc-2026-budget-spend-dashboard.html','source':snc.get('spend_source','')})
    rows.append({'area':'MYOB current-era account detail','status':'Available from 2025-07-01 sample','period':'MYOB era from 2025-07-01 seed cache','what':'Account, journal, AP/AR samples and selected account detail pages exist; not prior-year SUN history.', 'link':'myob-account-drilldown-dashboard.html','source':str(ROOT/'finance/myob-cache')})
    rows.append({'area':'SUN legacy finance history','status':'Inventory exists / parser needed','period':'Pre-MYOB historical years','what':'SUN/legacy source inventory exists, but repeatable parser/indexer still needed before charts should claim trends.', 'link':'finance-source-status.html','source':str(ROOT/'projects/cfo-second-brain/indexes/sun-legacy-finance-source-inventory-2026-06-20.md')})
    data={'generated_at':__import__('datetime').datetime.now().isoformat(timespec='seconds'),'rows':rows}
    OUT_JSON.write_text(json.dumps(data,indent=2),encoding='utf-8')
    cards=''.join(f"""
      <article class='card {('good' if r['status']=='Available' else 'warn' if 'not' in r['status'].lower() or 'only' in r['status'].lower() or 'parser' in r['status'].lower() else '')}'>
        <div class='label'>{h(r['status'])}</div><h2>{h(r['area'])}</h2><p class='sub'><b>Period:</b> {h(r['period'])}</p><p>{h(r['what'])}</p><p><a href='{h(r['link'])}'>Open related dashboard</a></p><details><summary>Source / next evidence</summary><code>{h(r['source'])}</code></details>
      </article>""" for r in rows)
    html_doc=f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>History / Prior-Year Comparison Status</title><link rel='stylesheet' href='stripe-cfo-theme.css'><style>.status-grid{{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))!important;gap:16px!important}}.card.good{{border-color:rgba(21,190,83,.35)!important}}.card.warn{{border-color:rgba(155,104,41,.35)!important}}details code{{display:block;white-space:pre-wrap;word-break:break-word;background:#f8fbff;border:1px solid #e5edf5;border-radius:6px;padding:10px;margin-top:8px;font-size:11px}}@media(max-width:900px){{.grid{{grid-template-columns:1fr}}}}</style></head><body class='stripe-cfo'><div class='wrap'><header><h1>History / prior-year comparison status</h1><p class='sub'>One page showing which prior-year comparisons already exist, which are current-year only, and which need SUN/legacy indexing before we should show trend claims.</p><p><a class='pill' href='cfo-command-centre.html'>Command centre</a><span class='pill'>Generated {h(data['generated_at'])}</span></p></header><section class='status-grid'>{cards}</section></div></body></html>"""
    OUT_HTML.write_text(html_doc,encoding='utf-8')
    print(OUT_HTML)

if __name__=='__main__': main()
