#!/usr/bin/env python3
"""
Generate revised CFO overview and entity placeholder pages.

Read-only against existing derived dashboard JSON. Writes static HTML pages under
briefings/dashboards. Source workbooks are not mutated.
"""
from __future__ import annotations

import html
import json
from decimal import Decimal
from datetime import datetime
from pathlib import Path
from typing import Any

WORKSPACE = Path("/Users/snswcommunications/Hermes-CFO")
OUT_DIR = WORKSPACE / "briefings" / "dashboards"
BUDGET_JSON = OUT_DIR / "cfo-budget-decision-dashboard-data.json"
STAFF_JSON = OUT_DIR / "field-pastoral-staffing-dashboard-data.json"
STAFF_COST_JSON = OUT_DIR / "staff-cost-dashboard-data.json"
PASTORAL_MAP = "http://127.0.0.1:8094/"

PAGES = {
    "overview": OUT_DIR / "cfo-overview.html",
    "snc": OUT_DIR / "entity-snc-conference-churches.html",
    "sne_border": OUT_DIR / "entity-sne-border-bcc.html",
    "sne_mawson": OUT_DIR / "entity-sne-mawson-ccs.html",
    "sne_narromine": OUT_DIR / "entity-sne-narromine-ncs.html",
    "aav": OUT_DIR / "entity-aav-campground.html",
    "snu": OUT_DIR / "entity-snu-property-loans.html",
}


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def money(value: Any) -> str:
    try:
        x = float(value or 0)
    except Exception:
        return "—"
    s = f"${abs(x):,.0f}"
    return f"({s})" if x < 0 else s


def pct(value: Any) -> str:
    try:
        return f"{float(value):,.1f}%"
    except Exception:
        return "—"


def h(s: Any) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def source_text(label: str, source: str | None, detail: str) -> str:
    parts = [f"Source lane: {label}"]
    if source:
        parts.append(f"File: {source}")
    parts.append(detail)
    return "\n".join(parts)


def source_ref(label: str, locator: str | None, detail: str, kind: str = "source") -> dict[str, Any]:
    return {"label": label, "locator": locator or "", "detail": detail, "kind": kind}


def make_evidence(
    title: str,
    value: str,
    summary: str,
    *,
    period: str = "Not specified",
    basis: str = "Source-backed dashboard figure",
    breakdown: list[dict[str, Any]] | None = None,
    people: list[dict[str, Any]] | None = None,
    links: list[dict[str, str]] | None = None,
    sources: list[dict[str, Any]] | None = None,
    caveats: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "title": title,
        "value": value,
        "summary": summary,
        "period": period,
        "basis": basis,
        "breakdown": breakdown or [],
        "people": people or [],
        "links": links or [],
        "sources": sources or [],
        "caveats": caveats or [],
    }


def legacy_evidence(source: str) -> dict[str, Any]:
    lines = [x for x in str(source).splitlines() if x.strip()]
    title = lines[0].replace("Source lane: ", "") if lines else "Evidence"
    locator = ""
    detail = []
    for line in lines[1:]:
        if line.startswith("File: "):
            locator = line.replace("File: ", "", 1)
        else:
            detail.append(line)
    return make_evidence(
        title=title,
        value="Source lane",
        summary="The source lane is known; a transaction/person breakdown is not attached yet.",
        period="See source lane",
        basis="Source-lane reference",
        sources=[source_ref(title, locator, "\n".join(detail) or str(source))],
        caveats=["Attach detailed rows before treating this as decision-ready."]
    )


def evidence_attr(evidence: dict[str, Any] | str) -> str:
    if isinstance(evidence, str):
        evidence = legacy_evidence(evidence)
    return h(json.dumps(evidence, ensure_ascii=False))


def evidence_button(label: str, evidence: dict[str, Any] | str, cls: str = "pill") -> str:
    return f'<button class="{h(cls)} click" data-evidence="{evidence_attr(evidence)}">{h(label)}</button>'


def card(title: str, value: str, note: str, evidence: dict[str, Any] | str, tone: str = "") -> str:
    return f"""
    <button class="card click span3 {h(tone)}" data-evidence="{evidence_attr(evidence)}">
      <span class="label">{h(title)}</span>
      <strong class="value">{h(value)}</strong>
      <span class="note">{h(note)}</span>
      <span class="evidence">Evidence</span>
    </button>"""


def tile(title: str, body: str, evidence: dict[str, Any] | str, tone: str = "") -> str:
    return f"""
    <button class="tile click {h(tone)}" data-evidence="{evidence_attr(evidence)}">
      <strong>{h(title)}</strong>
      <span>{h(body)}</span>
      <em>Evidence</em>
    </button>"""


def table(rows: list[list[str]], headers: list[str]) -> str:
    head = "".join(f"<th>{h(x)}</th>" for x in headers)
    body = "".join("<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>" for r in rows)
    return f"<div class=\"table-wrap\"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"


def page(title: str, subtitle: str, body: str) -> str:
    generated = datetime.now().isoformat(timespec="seconds")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{h(title)}</title>
  <link rel="stylesheet" href="stripe-cfo-theme.css">
  <style>
    body{{min-height:100vh}} .wrap{{max-width:1500px}} .hero{{display:flex;justify-content:space-between;gap:22px;align-items:flex-start;margin-bottom:22px}}
    .hero p{{max-width:880px}} .meta{{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}} .grid{{align-items:stretch}}
    button.card,button.tile{{appearance:none;text-align:left;width:100%;font:inherit;cursor:pointer;color:inherit;background:rgba(255,255,255,.94)!important;border:1px solid var(--stripe-line)!important;border-radius:8px!important;box-shadow:var(--stripe-shadow)!important}}
    button.card{{padding:20px!important;min-height:156px;display:flex;flex-direction:column;gap:10px}} button.card:hover,button.tile:hover{{transform:translateY(-2px);border-color:#b9b9f9!important}}
    .label{{display:block}} .value{{display:block;font-size:34px!important}} .note{{color:var(--stripe-muted);font-size:13px;line-height:1.35}} .evidence{{margin-top:auto;color:var(--stripe-purple);font-size:12px;font-weight:500}}
    .section{{margin-top:22px}} .section h2{{margin:0 0 12px}} .tiles{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}} button.tile{{padding:16px!important;min-height:118px;display:flex;flex-direction:column;gap:8px}} .tile strong{{color:var(--stripe-heading);font-weight:400;font-size:17px}} .tile span{{color:var(--stripe-muted);font-size:13px;line-height:1.35}} .tile em{{margin-top:auto;color:var(--stripe-purple);font-style:normal;font-size:12px}}
    .good .value,.good strong{{color:var(--stripe-green-text)!important}} .bad .value,.bad strong{{color:var(--stripe-ruby)!important}} .warn .value,.warn strong{{color:var(--stripe-amber)!important}}
    .table-wrap{{background:#fff;border:1px solid var(--stripe-line);border-radius:8px;overflow:auto;box-shadow:var(--stripe-shadow)}} td,th{{padding:11px 12px;text-align:left}} td.mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}}
    .drawer{{position:fixed;inset:0;display:none;z-index:30}} .drawer.open{{display:block}} .shade{{position:absolute;inset:0;background:rgba(6,27,49,.38);backdrop-filter:blur(5px)}} .panel{{position:absolute;right:0;top:0;bottom:0;width:min(780px,96vw);background:#fff;border-left:1px solid var(--stripe-line);box-shadow:rgba(0,0,0,.18) -24px 0 60px;padding:24px;overflow:auto}} .panel h2{{margin-top:0}} .panel h3{{font-size:16px!important;margin:22px 0 8px!important}} .closex{{float:right;background:#fff!important;color:var(--stripe-purple)!important;border:1px solid var(--stripe-line)!important;box-shadow:none!important}} .ev-value{{font-size:32px;color:var(--stripe-heading);letter-spacing:-.4px;margin:4px 0 10px}} .ev-meta{{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}} .ev-meta div,.source-box{{background:var(--stripe-surface-2);border:1px solid var(--stripe-line);border-radius:7px;padding:10px}} .ev-table{{width:100%;border-collapse:collapse;font-size:13px}} .ev-table th,.ev-table td{{border-bottom:1px solid var(--stripe-line);padding:8px;text-align:left;vertical-align:top}} .link-list{{display:grid;gap:8px}} .link-list a{{display:block;border:1px solid var(--stripe-line);border-radius:7px;padding:10px;background:#fff}} .source-box code{{white-space:pre-wrap;word-break:break-word;font-size:11px;color:var(--stripe-muted)}}
    .source-footer{{margin-top:28px}} .quick-answer{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px}} .quick-answer div{{background:#fff;border:1px solid var(--stripe-line);border-radius:8px;padding:12px;box-shadow:rgba(23,23,23,.05) 0 8px 20px -14px}} .quick-answer b{{display:block;color:var(--stripe-heading);font-weight:500;margin-bottom:4px}} .quick-answer span{{display:block;color:var(--stripe-muted);font-size:13px;line-height:1.28}} .source-footer details summary{{cursor:pointer;color:var(--stripe-purple);font-weight:500}}
    @media(max-width:900px){{.hero{{display:block}}.tiles,.quick-answer{{grid-template-columns:1fr}}.span3,.span4,.span6,.span8,.span12{{grid-column:span 12!important}}}}
  </style>
</head>
<body class="stripe-cfo">
  <div class="wrap">
    <header class="hero">
      <div><h1>{h(title)}</h1><p class="sub">{h(subtitle)}</p></div>
      <div class="meta"><span class="pill">Generated {h(generated)}</span></div>
    </header>
    {body}
    <section class="source-footer card"><h2>Evidence rule</h2><div class="quick-answer"><div><b>Period</b><span>Every figure needs a month, FY, YTD range, or as-of date.</span></div><div><b>Basis</b><span>Budget, actual, forecast, placeholder, or scenario.</span></div><div><b>Breakdown</b><span>Show rows/people/accounts before file paths.</span></div><div><b>Decision state</b><span>Say whether the number is usable now or needs refresh.</span></div></div><details><summary>Source-drawer rule</summary><p class="sub">Evidence drawers should explain the figure first: period, basis, underlying line/person breakdown, and related dashboard links. Source file/API/cache references belong at the bottom.</p></details></section>
  </div>
  <div class="drawer" id="drawer"><div class="shade" data-close="1"></div><aside class="panel"><button class="closex" data-close="1">Close</button><div id="evidenceContent"></div></aside></div>
<script>
const drawer=document.getElementById('drawer'), evidenceContent=document.getElementById('evidenceContent');
function esc(v){{return String(v ?? '').replace(/[&<>"]/g,ch=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[ch]));}}
function tableFrom(rows, cols){{
  if(!rows || !rows.length) return '';
  return `<table class="ev-table"><thead><tr>${{cols.map(c=>`<th>${{esc(c.label)}}</th>`).join('')}}</tr></thead><tbody>${{rows.map(r=>`<tr>${{cols.map(c=>`<td>${{esc(r[c.key])}}</td>`).join('')}}</tr>`).join('')}}</tbody></table>`;
}}
function renderEvidence(ev){{
  let html=`<h2>${{esc(ev.title||'Evidence')}}</h2><div class="ev-value">${{esc(ev.value||'')}}</div><p class="sub">${{esc(ev.summary||'')}}</p>`;
  html+=`<div class="ev-meta"><div><span class="label">Period</span><br>${{esc(ev.period||'Not specified')}}</div><div><span class="label">Basis</span><br>${{esc(ev.basis||'Not specified')}}</div></div>`;
  if(ev.breakdown?.length) html+=`<h3>Breakdown behind this figure</h3>`+tableFrom(ev.breakdown,[{{key:'label',label:'Item'}},{{key:'budget',label:'Budget'}},{{key:'actual',label:'Actual / spend'}},{{key:'variance',label:'Variance'}},{{key:'used',label:'Used'}}]);
  if(ev.people?.length) html+=`<h3>People / payroll behind this figure</h3>`+tableFrom(ev.people,[{{key:'name',label:'Person'}},{{key:'staff_id',label:'Staff ID'}},{{key:'area',label:'Area / role'}},{{key:'cost',label:'Cost'}},{{key:'match',label:'Match'}}]);
  if(ev.links?.length) html+=`<h3>Where to see more</h3><div class="link-list">${{ev.links.map(l=>`<a href="${{esc(l.url)}}" target="_blank"><strong>${{esc(l.label)}}</strong><br><span class="sub">${{esc(l.note||l.url)}}</span></a>`).join('')}}</div>`;
  if(ev.caveats?.length) html+=`<h3>Caveats / open questions</h3><ul>${{ev.caveats.map(c=>`<li>${{esc(c)}}</li>`).join('')}}</ul>`;
  if(ev.sources?.length) html+=`<h3>Source references</h3>${{ev.sources.map(s=>`<div class="source-box"><strong>${{esc(s.label||s.kind||'Source')}}</strong><br><code>${{esc(s.locator||'')}}</code><p class="sub">${{esc(s.detail||'')}}</p></div>`).join('')}}`;
  evidenceContent.innerHTML=html;
}}
document.querySelectorAll('.click').forEach(el=>el.addEventListener('click',()=>{{
  let ev;
  try{{ ev=JSON.parse(el.dataset.evidence || '{{}}'); }}catch(e){{ ev={{title:'Evidence',summary:el.dataset.source||'No evidence attached.',sources:[{{label:'Legacy source',detail:el.dataset.source||''}}]}}; }}
  renderEvidence(ev);drawer.classList.add('open');
}}));
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>drawer.classList.remove('open')));
document.addEventListener('keydown',e=>{{if(e.key==='Escape')drawer.classList.remove('open')}});
</script>
</body></html>"""


def build() -> dict[str, Path]:
    budget = load_json(BUDGET_JSON)
    staff = load_json(STAFF_JSON)
    staff_cost = load_json(STAFF_COST_JSON)

    summary = budget.get("summary", {})
    actual = summary.get("actual", {})
    cash_rows = summary.get("cash_rows", [])
    detail = budget.get("detail", {})
    functions = {f.get("name"): f for f in detail.get("functions", [])}
    budget_src = budget.get("budget", {}).get("source")
    summary_src = summary.get("source")
    detail_src = detail.get("source")
    staff_src = staff.get("staff", {}).get("source") or staff.get("sources", [{}])[0].get("path") if staff.get("sources") else None
    staff_cost_src = staff_cost.get("source")

    aav_cash = sum(r.get("may", 0) for r in cash_rows if "Alpine" in r.get("account", ""))
    snc_cash = sum(r.get("may", 0) for r in cash_rows if "SDA Church" in r.get("account", "") or "Conference" in r.get("account", ""))
    aav = functions.get("ADVENTIST ALPINE VILLAGE", {})
    field = functions.get("FIELD", {})
    admin = functions.get("ADMINISTRATION", {})
    props = functions.get("PROPERTIES", {})
    categories = staff.get("staff", {}).get("by_category", [])
    cat = {c.get("category"): c for c in categories}
    field_staff_cost = cat.get("Field / pastoral", {}).get("cost")
    office_cost = sum(cat.get(k, {}).get("cost", 0) for k in ["Admin / Executive", "Department director", "Finance", "Department support", "Other conference"])
    aav_staff_cost = cat.get("AAV - exclude for now", {}).get("cost")
    school_staff_cost = cat.get("School - exclude", {}).get("cost")
    payroll_fy = staff_cost.get("fy", [])[-1] if staff_cost.get("fy") else {}

    period_budget_actual = "FY2026 budget; May/YTD 2026 actuals from current operating dashboard extract"
    period_payroll = "FY2025-26 payroll to current parsed pay-run range"

    def line_rows(function_name: str, limit: int = 14) -> list[dict[str, Any]]:
        rows = [r for r in detail.get("lines", []) if r.get("function") == function_name]
        rows = sorted(rows, key=lambda r: abs(float(r.get("actual") or 0)), reverse=True)[:limit]
        out = []
        for r in rows:
            budget_v = float(r.get("budget") or 0)
            actual_v = float(r.get("actual") or 0)
            used_v = (abs(actual_v) / abs(budget_v) * 100) if budget_v else None
            out.append({
                "label": r.get("line", ""),
                "budget": money(budget_v),
                "actual": money(actual_v),
                "variance": money(r.get("variance")),
                "used": pct(used_v) if used_v is not None else "—",
            })
        return out

    def people_rows(rows: list[dict[str, Any]], limit: int = 30) -> list[dict[str, Any]]:
        out = []
        for r in sorted(rows, key=lambda x: float(x.get("cost_25_26") or 0), reverse=True)[:limit]:
            out.append({
                "name": r.get("name", ""),
                "staff_id": r.get("staff_id", ""),
                "area": r.get("job_or_area") or r.get("role") or "",
                "cost": money(r.get("cost_25_26")),
                "match": f"{r.get('match_name','')} ({r.get('match_score','—')})",
            })
        return out

    common_finance_links = [
        {"label": "SNC 2026 Budget Spend", "url": "snc-2026-budget-spend-dashboard.html", "note": "Budget/spend dashboard this figure came from or reconciles to."},
        {"label": "CFO Operating Dashboard", "url": "cfo-budget-decision-dashboard.html", "note": "Operating statement / function dashboard with wider budget context."},
        {"label": "MYOB Account Drilldown", "url": "myob-account-drilldown-dashboard.html", "note": "Use for MYOB-era account/journal/AP detail when account mapping is known."},
    ]
    payroll_links = [
        {"label": "Field Pastoral Staffing", "url": "field-pastoral-staffing-dashboard.html", "note": "Pastoral/field people rows and funding context."},
        {"label": "Staff Cost Dashboard", "url": "staff-cost-dashboard.html", "note": "Full payroll/staff-cost dashboard and category mapping."},
        {"label": "Office Staff Map", "url": "office-staff-modelling-map.html", "note": "Conference staff role/category mapping where relevant."},
    ]

    def function_evidence(function_name: str) -> dict[str, Any]:
        f = functions.get(function_name, {})
        return make_evidence(
            title=f"{function_name.title()} function spend",
            value=f"{money(f.get('actual'))} actual / {money(f.get('budget'))} budget",
            summary=f"This explains the {function_name} row by showing the underlying Velixo function lines that roll into the displayed budget, actual and used percentage.",
            period=period_budget_actual,
            basis="Velixo Rpt B-Functions function-level budget vs actual extract",
            breakdown=line_rows(function_name),
            links=common_finance_links,
            sources=[source_ref("Velixo function detail", detail_src, "Rpt B-Functions lines grouped by function; current dashboard cache generated from the workbook.", "excel_workbook")],
            caveats=["This is a function-level accounting breakdown, not yet a MYOB invoice/AP drilldown unless account mapping has been attached."]
        )

    def field_spend_evidence() -> dict[str, Any]:
        f = functions.get("FIELD", {})
        return make_evidence(
            title="Field budget usage + separate pastoral payroll lane",
            value=f"{pct(f.get('used_pct'))} used — {money(f.get('actual'))} actual vs {money(f.get('budget'))} budget; separate payroll people-cost lane {money(field_staff_cost)}",
            summary="This explains two related but separate figures: the Field function budget/spend signal from Velixo, and the named pastoral people-cost lane from payroll. Use this as a bridge, not as one combined number.",
            period=period_budget_actual,
            basis="Function budget/actual from Velixo plus separate payroll/person cross-reference from staffing dashboard",
            breakdown=line_rows("FIELD"),
            people=people_rows(staff.get("staff", {}).get("field_people", [])),
            links=common_finance_links + payroll_links,
            sources=[
                source_ref("Velixo function detail", detail_src, "FIELD function lines: salaries, motor vehicle allowances, telephone allowances and other function-level costs.", "excel_workbook"),
                source_ref("Field/pastoral staffing dashboard cache", staff_src or staff_cost_src, "Mapped Field / pastoral people and FY25-26 payroll cost rows.", "payroll_csv"),
            ],
            caveats=["The function actual and the payroll category are related but not identical ledgers; use this as a bridge, not a final audit reconciliation.", "MYOB invoice-level drilldown requires account/subaccount mapping for the selected function line."]
        )

    def pastoral_payroll_evidence() -> dict[str, Any]:
        people = staff.get("staff", {}).get("field_people", [])
        return make_evidence(
            title="Pastoral payroll lane",
            value=f"{money(field_staff_cost)} across {len(people)} mapped Field / pastoral people",
            summary="Exact people currently mapped into the Field / pastoral payroll category behind the displayed payroll lane.",
            period=period_payroll,
            basis="Parsed payroll/staff allocation file with role/category overrides",
            people=people_rows(people, limit=40),
            links=payroll_links,
            sources=[source_ref("Payroll/staff allocation CSV", staff_src or staff_cost_src, "Current staff allocation file with overrides and field/pastoral category mapping.", "payroll_csv")],
            caveats=["Category mapping is operational and may need accountant review before board publication."]
        )

    def church_ministry_map_evidence() -> dict[str, Any]:
        people = staff.get("staff", {}).get("field_people", [])
        return make_evidence(
            title="Where to click for pastoral people and costs",
            value=f"{len(people)} mapped Field / pastoral people — {money(field_staff_cost)} FY2025-26 payroll lane",
            summary="For an executive or Conference President: use the field staffing dashboard for exact names/costs and the local ministers mapping app for pastoral/church assignment context. These are related views, not the same ledger as the approved Field department budget.",
            period=period_payroll,
            basis="Payroll/staff allocation extract plus local pastoral/ministers map link",
            people=people_rows(people, limit=40),
            links=[
                {"label": "Field Pastoral Staffing Dashboard", "url": "field-pastoral-staffing-dashboard.html", "note": "Open this first for exact people, FY2025-26 costs, and the difference between budget and named-person payroll."},
                {"label": "2027 Staffing Scenario App", "url": "staffing-budget-app.html", "note": "Scenario modelling linked to pastoral staffing assumptions."},
                {"label": "Pastoral / Ministers Mapping App", "url": PASTORAL_MAP, "note": "Local mapping app on port 8094; if it is not running, start the local app before using this link."},
            ],
            sources=[source_ref("Payroll/staff allocation CSV", staff_src or staff_cost_src, "Current staff allocation file with overrides and Field / pastoral category mapping.", "payroll_csv")],
            caveats=["The map app shows assignment/navigation context; the payroll dashboard is the source for exact cost rows.", "Do not combine department spend budget and payroll people cost without reconciling source basis."]
        )

    def conference_net_evidence() -> dict[str, Any]:
        return make_evidence(
            title="Conference net",
            value=money(actual.get("conference_net")),
            summary="Conference income less expense from the operating statement summary dashboard extract.",
            period="May 2026 operating statement summary extract",
            basis="Summary dashboard cells: conference income, conference expense, conference net",
            breakdown=[
                {"label": "Conference income", "budget": "—", "actual": money(actual.get("conference_income")), "variance": "—", "used": "—"},
                {"label": "Conference expense", "budget": "—", "actual": money(actual.get("conference_expense")), "variance": "—", "used": "—"},
                {"label": "Conference net", "budget": "—", "actual": money(actual.get("conference_net")), "variance": "—", "used": "—"},
            ],
            links=common_finance_links,
            sources=[source_ref("Operating statement summary / cash rows", summary_src, "Conference income, expense and net extracted from existing derived CFO operating dashboard JSON.", "excel_workbook")],
        )

    def cash_evidence(title: str, total: float, terms: list[str]) -> dict[str, Any]:
        matched = [r for r in cash_rows if any(t.lower() in str(r.get("account", "")).lower() for t in terms)]
        return make_evidence(
            title=title,
            value=money(total),
            summary="Cash-on-hand card built from the May operating summary cash rows matched to the named entity/account terms below.",
            period="May 2026 operating summary cash rows",
            basis="Operating summary cash table; rows matched by account/entity wording",
            breakdown=[{"label": r.get("account", ""), "budget": "—", "actual": money(r.get("may")), "variance": "—", "used": r.get("type", "")} for r in matched],
            links=common_finance_links,
            sources=[source_ref("Operating statement summary / cash rows", summary_src, "Cash balances extracted from the operating summary cash section; not a bank reconciliation or restricted-cash analysis.", "excel_workbook")],
            caveats=["This is a dashboard cash signal, not a final cash-control reconciliation.", "Restricted-purpose cash still needs separate policy/source confirmation before decisions."],
        )

    def staff_cost_pressure_evidence() -> dict[str, Any]:
        return make_evidence(
            title="Staff cost pressure",
            value=money(payroll_fy.get("total_cost")),
            summary="Whole payroll/staff-cost signal with the largest current category lanes and links to the exact people views.",
            period=period_payroll,
            basis="Parsed staff-cost dashboard JSON plus current staff allocation/category mapping",
            breakdown=[{"label": c.get("category", ""), "budget": "—", "actual": money(c.get("cost")), "variance": f"{c.get('people', '—')} people", "used": "payroll lane"} for c in categories[:10]],
            people=people_rows(staff.get("staff", {}).get("all_people", []), limit=20),
            links=payroll_links + [{"label": "History / prior-year status", "url": "history-comparison-status.html", "note": "Shows which staff/office prior-year comparisons are indexed."}],
            sources=[source_ref("Staff cost dashboard cache", staff_cost_src, "FY payroll totals and unique staff count from generated staff-cost dashboard data.", "payroll_csv"), source_ref("Current staff allocation CSV", staff_src, "Current person/category mapping with overrides.", "payroll_csv")],
            caveats=["Staff category mapping is operational and may need accountant review before board publication."]
        )

    src_summary = source_text("Operating statement summary / cash rows", summary_src, "Extracted from existing derived CFO operating dashboard JSON. Cash is May row where present; basis remains source-labelled, not reinterpreted.")
    src_detail = source_text("Velixo function detail", detail_src, "Extracted from Rpt B-Functions in selected Velixo workbook via existing CFO dashboard generator.")
    src_staff = source_text("Payroll and staff category mapping", staff_src or staff_cost_src, "Derived from current parsed payroll/staffing dashboards. Category mapping is operational and may need accountant review before board use.")
    src_school_placeholder = source_text("SNE school financial lane needed", None, "Placeholder. Needs school-location source pack: enrolments, operating result, staffing/FTE, funding, cash/liquidity, and inter-entity charges for Border/BCC, Mawson/CCS, and Narromine/NCS.")
    src_snu_placeholder = source_text("SNU property/loan lane needed", None, "Placeholder. Needs property register, rental/property usage charge basis, recovery/payment status, loan register, securities, and inter-entity agreements. Current SNC budget source includes a property usage expense line only; it is not enough for SNU economics.")

    radar_tiles = "".join([
        tile("SNC church/ministry", f"Field budget-spend signal {pct(field.get('used_pct'))} used. Separate pastoral people-cost lane: {money(field_staff_cost)}.", field_spend_evidence(), "warn" if (field.get('used_pct') or 0) > 90 else ""),
        tile("SNE schools", "Location split not extracted yet. Treat as missing-data lane, not a zero or safe result.", src_school_placeholder, "warn"),
        tile("AAV campground", f"Function actual net {money(aav.get('actual'))}; cash rows total {money(aav_cash)}.", function_evidence("ADVENTIST ALPINE VILLAGE"), "good" if (aav.get('actual') or 0) > 0 else "warn"),
        tile("SNU property/loans", f"Properties function actual {money(props.get('actual'))}; property usage budget line exists but SNU register is not extracted.", src_snu_placeholder, "warn"),
        tile("Staff cost pressure", f"FY25-26 parsed payroll {money(payroll_fy.get('total_cost'))}; office mapped cost {money(office_cost)}.", staff_cost_pressure_evidence(), "warn"),
        tile("Missing evidence", "Cash-on-hand for SNE/SNU and school-location results are placeholders until source lanes are indexed.", source_text("Assumptions register", None, "Do not present missing values as zero. Use the drawer/source-lane pattern until extraction is complete."), "bad"),
    ])

    overview_table = table([
        ['SNC Conference & Churches', money(actual.get('conference_net')), money(snc_cash), money(field_staff_cost), '<span class="pill warn">watch</span>'],
        ['SNE Border / BCC', 'Placeholder', 'Placeholder', 'Placeholder', '<span class="pill warn">source lane needed</span>'],
        ['SNE Mawson / CCS', 'Placeholder', 'Placeholder', 'Placeholder', '<span class="pill warn">source lane needed</span>'],
        ['SNE Narromine / NCS', 'Placeholder', 'Placeholder', 'Placeholder', '<span class="pill warn">source lane needed</span>'],
        ['AAV Campground', money(actual.get('aav_net')), money(aav_cash), money(aav_staff_cost), '<span class="pill good">partial evidence</span>'],
        ['SNU Property & Loans', money(props.get('actual')), 'Placeholder', 'n/a', '<span class="pill warn">register needed</span>'],
    ], ['Entity', 'Operating signal', 'Cash-on-hand', 'Staff-cost signal', 'Status'])
    staff_pressure_note = f"FY25-26 parsed payroll, {payroll_fy.get('unique_staff','—')} unique staff to date."
    entity_health_source = src_detail + '\n\n' + src_school_placeholder + '\n\n' + src_snu_placeholder
    overview_body = f"""
    <section class="quick-answer">
      <div><b>Kyle / CFO</b><span>Start with cash, operating result, staff cost, and missing source lanes.</span></div>
      <div><b>President / ADCOM</b><span>Growth / shrink radar shows pressure points before the detail table.</span></div>
      <div><b>AUC / auditor</b><span>Click Evidence for period, basis, breakdown, and source references.</span></div>
      <div><b>Exec / local member</b><span>Placeholder means “not extracted yet”, not zero and not safe.</span></div>
    </section>
    <section class="section start-questions"><h2>Start with the question</h2><div class="tiles">
      {tile('Are we liquid?', 'Use entity cash cards, then open Cash / CMF / Westpac for source-backed status.', cash_evidence('SNC cash on hand', snc_cash, ['SDA Church', 'Conference']), 'warn')}
      {tile('What needs a decision?', 'Check Growth / shrink radar and any warning/red evidence cards.', entity_health_source, 'warn')}
      {tile('What is staff pressure?', f"Payroll lane {money(payroll_fy.get('total_cost'))}; click for named people and categories.", staff_cost_pressure_evidence(), 'warn')}
    </div></section>
    <section class="grid">
      {card('SNC cash on hand', money(snc_cash), 'SDA Church SNSW Ltd CMF + Conference Inc Westpac rows where present.', cash_evidence('SNC cash on hand', snc_cash, ['SDA Church', 'Conference']), 'good' if snc_cash else 'warn')}
      {card('SNE cash on hand', 'Placeholder', 'School cash not extracted by location yet.', src_school_placeholder, 'warn')}
      {card('AAV cash on hand', money(aav_cash), 'AAV CMF + Westpac rows from May dashboard cash section.', cash_evidence('AAV cash on hand', aav_cash, ['Alpine', 'AAV']), 'good')}
      {card('SNU cash on hand', 'Placeholder', 'Property/loan entity liquidity not extracted yet.', src_snu_placeholder, 'warn')}
      {card('Entity health', 'Mixed', 'SNC/AAV have partial operating evidence; SNE/SNU still source-lane placeholders.', entity_health_source, 'warn')}
      {card('Staff cost pressure', money(payroll_fy.get('total_cost')), staff_pressure_note, staff_cost_pressure_evidence(), 'warn')}
      {card('SNC operating result', money(actual.get('conference_net')), 'Conference net from summary dashboard cells.', src_summary, 'bad' if (actual.get('conference_net') or 0) < 0 else 'good')}
      {card('AAV operating result', money(actual.get('aav_net')), 'AAV net from summary dashboard cells.', src_summary, 'good' if (actual.get('aav_net') or 0) > 0 else 'bad')}
    </section>
    <section class="section"><h2>Growth / shrink radar</h2><div class="tiles">{radar_tiles}</div></section>
    <section class="section"><h2>Entity health strip</h2>{overview_table}</section>
    """
    PAGES["overview"].write_text(page("CFO Overview", "Cash, operating pressure, staff cost, and missing source lanes — with evidence one click away.", overview_body))

    snc_rows = []
    for name in ["FIELD", "ADMINISTRATION", "OTHER OPERATIONS", "YOUTH MINISTRY", "MINISTERIAL", "EVANGELISM", "PROPERTIES"]:
        f = functions.get(name, {})
        snc_rows.append([h(name), money(f.get("budget")), money(f.get("actual")), pct(f.get("used_pct")), evidence_button('Evidence', function_evidence(name))])
    snc_body = f"""
    <section class="grid">
      {card('Conference net', money(actual.get('conference_net')), 'Summary dashboard conference income less expense.', conference_net_evidence(), 'bad')}
      {card('Field spend used', pct(field.get('used_pct')), 'Function-level spend signal; high usage by current point in year.', field_spend_evidence(), 'warn')}
      {card('Pastoral payroll lane', money(field_staff_cost), 'Mapped Field / pastoral FY25-26 payroll cost.', pastoral_payroll_evidence(), 'warn')}
      {card('Church/ministry map', 'Linked', 'Click for exact pastoral people/costs and the local map link.', church_ministry_map_evidence(), '')}
    </section>
    <section class="section"><h2>Function pressure</h2>{table(snc_rows, ['Function','Budget','Actual','Used','Evidence'])}</section>
    <section class="section"><h2>Church/source placeholders</h2><div class="tiles">{tile('Tithe + attendance trend','Needs church-level trend extraction before growth/shrink claims by congregation.', source_text('Church trend lane', None, 'Use church financials + attendance survey normalized source. Do not infer congregation growth from staffing alone.'), 'warn')}{tile('Pastoral load','Existing map has pastor/church assignments; next step is load scoring tied to attendance/tithe.', src_staff, 'warn')}{tile('Restricted/direct tithe','Treatment should remain explicit; no unrestricted-cash assumption.', source_text('Restricted tithe policy lane', None, 'Needs finance policy/source confirmation before board-facing statements.'), 'warn')}</div></section>
    """
    PAGES["snc"].write_text(page("SNC Conference & Churches", "Conference/church operating entity view with current real signals and honest placeholders for church-level trends.", snc_body))

    school_specs = [
        ("sne_border", "SNE Border / BCC", "Border Christian College", "Border/BCC"),
        ("sne_mawson", "SNE Mawson / CCS", "Canberra Christian School / Mawson", "Mawson/CCS"),
        ("sne_narromine", "SNE Narromine / NCS", "Narromine Christian School", "Narromine/NCS"),
    ]
    for key, title, school_name, lane in school_specs:
        body = f"""
        <section class="grid">
          {card('Cash on hand', 'Placeholder', f'{lane} cash/liquidity not extracted yet.', src_school_placeholder, 'warn')}
          {card('Enrolment trend', 'Placeholder', f'{lane} enrolment trend source lane required.', src_school_placeholder, 'warn')}
          {card('Staff cost', 'Placeholder', f'{lane} staff cost/FTE split not extracted; one generic school-exclude payroll signal exists only.', src_staff, 'warn')}
          {card('Operating result', 'Placeholder', f'{lane} budget vs actual not extracted by school location.', src_school_placeholder, 'warn')}
        </section>
        <section class="section"><h2>Location source checklist</h2><div class="tiles">
          {tile('Finance pack', 'Budget, actuals, YTD result, cash, funding and inter-entity charges for this location.', src_school_placeholder, 'warn')}
          {tile('Operational pack', 'Enrolment, staffing/FTE, student-staff ratio, occupancy/campus constraints.', src_school_placeholder, 'warn')}
          {tile('Governance caution', 'Education funds are not assumed transferable to church operations.', source_text('Entity boundary lane', None, 'SNE school economics should stay separated from SNC conference/church cash decisions unless confirmed by governance/accounting advice.'), 'warn')}
        </div></section>
        <section class="section"><h2>Placeholder table</h2>{table([[h(school_name),'Placeholder','Placeholder','Placeholder','Source lane not indexed']], ['Location','Income/funding','Staff cost','Net result','Status'])}</section>
        """
        PAGES[key].write_text(page(title, f"Entity placeholder page for {school_name}. It is deliberately not pretending school-location data has been extracted.", body))

    aav_body = f"""
    <section class="grid">
      {card('Cash on hand', money(aav_cash), 'AAV CMF + Westpac May cash rows.', src_summary, 'good')}
      {card('Operating result', money(actual.get('aav_net')), 'AAV result from operating statement summary dashboard.', src_summary, 'good' if (actual.get('aav_net') or 0) > 0 else 'bad')}
      {card('Function actual', money(aav.get('actual')), 'Velixo function-level actual; basis differs from summary and should be reconciled.', src_detail, 'good' if (aav.get('actual') or 0) > 0 else 'warn')}
      {card('Staff cost lane', money(aav_staff_cost), 'Current payroll category: AAV - exclude for now.', src_staff, 'warn')}
    </section>
    <section class="section"><h2>AAV evidence + placeholders</h2><div class="tiles">
      {tile('Revenue / cost trend', f"Function income actual {money(aav.get('income_actual'))}; expense actual {money(aav.get('expense_actual'))}.", src_detail, 'warn')}
      {tile('Occupancy / booking trend', 'Not extracted yet. Needed before interpreting campground demand.', source_text('AAV bookings lane', None, 'Needs booking/occupancy/usage source, if available.'), 'warn')}
      {tile('Maintenance / capex pressure', 'Not extracted yet. Keep visible because campground profit can be overstated if maintenance backlog is ignored.', source_text('AAV capex-maintenance lane', None, 'Needs asset/capex/maintenance source and any commitments.'), 'warn')}
    </div></section>
    """
    PAGES["aav"].write_text(page("AAV Campground", "Campground/commercial-ministry page with cash/result evidence and visible gaps for occupancy and maintenance.", aav_body))

    snu_body = f"""
    <section class="grid">
      {card('Cash on hand', 'Placeholder', 'SNU liquidity not extracted yet.', src_snu_placeholder, 'warn')}
      {card('Property usage signal', money(props.get('actual')), 'SNC Properties function actual only; not a full SNU result.', src_detail, 'warn')}
      {card('Loan register', 'Placeholder', 'Loan balances/securities not indexed yet.', src_snu_placeholder, 'warn')}
      {card('Recovery status', 'Placeholder', 'Rental/property usage charge recovery not extracted yet.', src_snu_placeholder, 'warn')}
    </section>
    <section class="section"><h2>Required SNU register</h2><div class="tiles">
      {tile('Property register', 'Property, owner/entity, occupant/ministry, rental basis, agreement status.', src_snu_placeholder, 'warn')}
      {tile('Loan register', 'Loan, lender, secured property, repayment terms, guarantee/support links.', src_snu_placeholder, 'warn')}
      {tile('Under-recovery flags', 'Compare charged, paid, recovered, waived, and missing agreements.', src_snu_placeholder, 'warn')}
    </div></section>
    <section class="section"><h2>Current extracted property-related line</h2>{table([['Properties function', money(props.get('budget')), money(props.get('actual')), pct(props.get('used_pct')), 'Partial SNC signal only']], ['Lane','Budget','Actual','Used','Caution'])}</section>
    """
    PAGES["snu"].write_text(page("SNU Property & Loans", "Property/rent/loan placeholder page. It names the registers needed and avoids pretending the SNU economics are already known.", snu_body))

    return PAGES


if __name__ == "__main__":
    paths = build()
    print("Generated CFO overview/entity pages:")
    for p in paths.values():
        print(f"- {p}")
