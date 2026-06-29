#!/usr/bin/env python3
"""Generate Kyle's local 2027 staffing/budget decision app.

Read-only against OneDrive-derived dashboard JSON and pastoral-map handoff data.
Writes derived HTML/JSON into the Hermes-CFO dashboard folder only.
"""
from __future__ import annotations

import csv
import html
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from cfo_stripe_theme import apply_stripe_theme, ensure_theme_file

WORKSPACE = Path("/Users/snswcommunications/Hermes-CFO")
DASHBOARD_DIR = WORKSPACE / "briefings" / "dashboards"
PASTORAL = WORKSPACE / "projects" / "pastoral-budget-map"
PASTORAL_JSON = PASTORAL / "current-data" / "app-data.canonical.json"
ASSIGNMENTS_CSV = PASTORAL / "source-data" / "sanitized-staffing" / "snsw_pastoral_assignments_current_corrected.csv"
OFFICE_CSV = PASTORAL / "source-data" / "sanitized-staffing" / "snsw_office_team_shared_services_only.csv"
DASHBOARD_JSON = DASHBOARD_DIR / "department-budget-dashboard-data.json"
OUT_HTML = DASHBOARD_DIR / "staffing-budget-app.html"
OUT_JSON = DASHBOARD_DIR / "staffing-budget-app-data.json"
DEPT_DASHBOARD_HTML = DASHBOARD_DIR / "department-budget-dashboard.html"
CFO_DASHBOARD_HTML = DASHBOARD_DIR / "cfo-budget-decision-dashboard.html"
PAYROLL_CSV = WORKSPACE / "finance" / "payroll-staff-costs" / "current_25_26_staff_allocation_with_overrides.csv"

STAFF_LINE_TERMS = (
    "salaries and wages",
    "superannuation",
    "allowance motor vehicle",
    "exempt benefit expense",
    "tithe expense",
    "payroll",
    "wages",
    "salary",
)
OFFICE_EXCLUDED_DEPTS = {"FIELD", "ADVENTIST ALPINE VILLAGE", "AAV"}


def money_num(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.0
        if isinstance(value, str):
            value = value.replace("$", "").replace(",", "").replace("(", "-").replace(")", "")
        if isinstance(value, float) and math.isnan(value):
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def fmt_money(value: Any) -> str:
    x = money_num(value)
    s = f"${abs(x):,.0f}"
    return f"({s})" if x < 0 else s


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value))




def clean_display_text(value: Any) -> str:
    text = '' if value is None else str(value)
    replacements = {
        'Cheif Financial Officer': 'Chief Financial Officer',
        'General Secratary': 'General Secretary',
        'Ministerial Secratary': 'Ministerial Secretary',
        'Payrol Clerk': 'Payroll Clerk',
        'Pr. Justin Lawnan': 'Pr. Justin Lawman',
        'Justin Lawnan': 'Justin Lawman',
        'Casual/AAV/random - low direct budget impact': 'Unclassified / casual / AAV / low direct budget impact',
        'Kyle role/category overrides': 'manual role/category corrections',
        'Kyle-classified role/category layer': 'manual role/category corrections',
        'source truth': 'source basis',
        'Source truth': 'Source basis',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text

def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def is_staff_cost_line(line_name: str) -> bool:
    text = (line_name or "").lower()
    return any(term in text for term in STAFF_LINE_TERMS)


def department_staff_budget(departments: list[dict[str, Any]], include_field: bool) -> tuple[float, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    total = 0.0
    for dept in departments:
        name = str(dept.get("name", "")).strip()
        is_field = name.upper() == "FIELD"
        if include_field != is_field:
            continue
        if not include_field and name.upper() in OFFICE_EXCLUDED_DEPTS:
            continue
        for line in dept.get("lines", []) or []:
            if not is_staff_cost_line(str(line.get("line", ""))):
                continue
            budget = money_num(line.get("budget"))
            spent = money_num(line.get("spent"))
            remaining = money_num(line.get("remaining", budget - spent))
            if budget == 0 and spent == 0:
                continue
            total += budget
            rows.append({
                "department": name,
                "line": str(line.get("line", "")),
                "budget": budget,
                "spent": spent,
                "remaining": remaining,
            })
    rows.sort(key=lambda r: abs(r["budget"]), reverse=True)
    return total, rows


def build_pastor_load(churches: list[dict[str, Any]], emerging_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    load = defaultdict(lambda: {"pastor": "", "churches": [], "emerging_groups": [], "attendance": 0.0})
    for church in churches:
        pastor = str(church.get("assigned_pastor") or church.get("current_pastor") or "Unassigned").strip() or "Unassigned"
        item = load[pastor]
        item["pastor"] = pastor
        item["churches"].append(str(church.get("short_name") or church.get("name") or "Unnamed church"))
        item["attendance"] += money_num(church.get("attendance"))
    for group in emerging_groups:
        pastor = str(group.get("assigned_pastor") or group.get("pastor_hint") or "Unassigned").strip() or "Unassigned"
        item = load[pastor]
        item["pastor"] = pastor
        item["emerging_groups"].append(str(group.get("group_name") or "Unnamed emerging group"))
    rows = []
    for item in load.values():
        church_count = len(item["churches"])
        emerging_count = len(item["emerging_groups"])
        rows.append({
            "pastor": item["pastor"],
            "church_count": church_count,
            "emerging_group_count": emerging_count,
            "total_entities": church_count + emerging_count,
            "attendance": item["attendance"],
            "churches": item["churches"],
            "emerging_groups": item["emerging_groups"],
            "is_vacant": "vacant" in item["pastor"].lower() or "tbd" in item["pastor"].lower(),
        })
    rows.sort(key=lambda r: (r["is_vacant"], r["total_entities"], r["attendance"]), reverse=True)
    return rows


def build_staffing_model(
    pastoral_json: Path = PASTORAL_JSON,
    dashboard_json: Path = DASHBOARD_JSON,
    assignments_csv: Path = ASSIGNMENTS_CSV,
    office_csv: Path = OFFICE_CSV,
) -> dict[str, Any]:
    pastoral = json.loads(pastoral_json.read_text(encoding="utf-8"))
    dashboard = json.loads(dashboard_json.read_text(encoding="utf-8"))
    assignments = read_csv_rows(assignments_csv)
    office = read_csv_rows(office_csv)

    cost_assumption = pastoral.get("metadata", {}).get("temporary_cost_assumption", {})
    package_cost = money_num(cost_assumption.get("full_time_pastor_or_office_staff_cost")) or 150000.0

    field_pastors = sorted({
        r.get("pastor_name", "").strip()
        for r in assignments
        if r.get("pastor_name", "").strip()
        and "vacant" not in r.get("pastor_name", "").lower()
        and "tbd" not in r.get("pastor_name", "").lower()
        and r.get("responsibility_type", "").strip() != "vacant_tbd"
    })
    vacant_posts = sorted({
        r.get("church_name_from_sheet", "").strip()
        for r in assignments
        if r.get("responsibility_type", "").strip() == "vacant_tbd"
        or "vacant" in r.get("pastor_name", "").lower()
        or "tbd" in r.get("pastor_name", "").lower()
    })
    office_staff = [r for r in office if r.get("status", "").strip().lower() == "current"]

    departments = dashboard.get("departments", [])
    field_staff_budget, field_staff_lines = department_staff_budget(departments, include_field=True)
    office_staff_budget, office_staff_lines = department_staff_budget(departments, include_field=False)

    pastor_load = build_pastor_load(pastoral.get("churches", []), pastoral.get("emerging_groups", []))
    total_attendance = sum(money_num(c.get("attendance")) for c in pastoral.get("churches", []))
    total_churches = len(pastoral.get("churches", []))
    total_emerging = len(pastoral.get("emerging_groups", []))

    field_placeholder_cost = len(field_pastors) * package_cost
    office_placeholder_cost = len(office_staff) * package_cost

    period_context = dashboard.get("period_context", {}) or {}
    budget_book_basis = period_context.get("budget_period_label") or "FY2026 budget basis not stated in department dashboard JSON"
    spend_basis = period_context.get("actual_period_label") or "actual spend period not stated in department dashboard JSON"

    model = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources": {
            "pastoral_json": str(pastoral_json),
            "dashboard_json": str(dashboard_json),
            "assignments_csv": str(assignments_csv),
            "office_csv": str(office_csv),
        },
        "periods": {
            "pastoral_data": f"Canonical pastoral-map snapshot created {pastoral.get('metadata', {}).get('created_at', 'date not stated')} in Hermes-CFO; attendance period: {pastoral.get('metadata', {}).get('attendance_import', {}).get('period', 'not stated')}",
            "assignments": "Sanitized pastoral assignments CSV in Hermes-CFO source-data; assignment sheet period not stated in file",
            "budget_book": f"{budget_book_basis}; spend/actual columns from {spend_basis}; source department dashboard JSON generated {dashboard.get('generated_at', 'generation time not stated')}",
            "budget_book_budget_basis": budget_book_basis,
            "budget_book_spend_basis": spend_basis,
            "scenario": "2027 planning scenario; user-entered tithe/package assumptions, not approved budget",
        },
        "assumptions": {
            "package_cost": package_cost,
            "package_cost_note": cost_assumption.get("note", "Temporary placeholder until exact FTE and employment-cost figures are supplied."),
            "target_staff_ratio": 0.75,
            "default_tithe_target": 5_200_000,
        },
        "counts": {
            "active_field_pastors": len(field_pastors),
            "vacant_field_posts": len(vacant_posts),
            "office_staff": len(office_staff),
            "formal_churches_companies": total_churches,
            "emerging_groups": total_emerging,
            "attendance_captured": total_attendance,
        },
        "costs": {
            "field_placeholder_cost": field_placeholder_cost,
            "office_placeholder_cost": office_placeholder_cost,
            "total_placeholder_staff_cost": field_placeholder_cost + office_placeholder_cost,
            "placeholder_pastoral_cost_from_handoff": money_num(cost_assumption.get("placeholder_pastoral_cost")),
            "placeholder_office_cost_from_handoff": money_num(cost_assumption.get("placeholder_office_shared_services_cost")),
        },
        "budget_book": {
            "field_staff_budget": field_staff_budget,
            "office_staff_budget": office_staff_budget,
            "visible_staff_budget_total": field_staff_budget + office_staff_budget,
            "field_staff_lines": field_staff_lines,
            "office_staff_lines": office_staff_lines,
        },
        "field_pastors": field_pastors,
        "vacant_posts": vacant_posts,
        "office_staff": office_staff,
        "pastor_load": pastor_load,
        "exact_payroll": read_exact_payroll(),
    }
    model["baseline_capacity"] = assess_staffing_capacity(
        model,
        tithe_target=model["assumptions"]["default_tithe_target"],
        target_staff_ratio=model["assumptions"]["target_staff_ratio"],
    )
    return model


def assess_staffing_capacity(model: dict[str, Any], tithe_target: float, target_staff_ratio: float) -> dict[str, Any]:
    package_cost = money_num(model.get("assumptions", {}).get("package_cost")) or 150000.0
    current_cost = money_num(model.get("costs", {}).get("total_placeholder_staff_cost"))
    max_staff_cost = round(money_num(tithe_target) * money_num(target_staff_ratio), 2)
    headroom = round(max_staff_cost - current_cost, 2)
    fte_headroom = round(headroom / package_cost, 1) if package_cost else 0.0
    if fte_headroom >= 0.5:
        recommendation = f"Can afford about {fte_headroom:.1f} more FTE at the placeholder package, before governance/cash checks."
    elif fte_headroom <= -0.5:
        recommendation = f"Scenario warning, not a staffing recommendation: over target by about {abs(fte_headroom):.1f} FTE at the placeholder package unless income rises, costs move, or restricted/offset funding is confirmed."
    else:
        recommendation = "No meaningful FTE headroom at the placeholder package; hold staffing unless offsetting savings/income are identified."
    return {
        "tithe_target": money_num(tithe_target),
        "target_staff_ratio": money_num(target_staff_ratio),
        "max_staff_cost_at_target": max_staff_cost,
        "current_placeholder_staff_cost": current_cost,
        "headroom": headroom,
        "fte_headroom": fte_headroom,
        "recommendation": recommendation,
    }


def rows_html(rows: list[dict[str, Any]], limit: int = 12) -> str:
    if not rows:
        return "<tr><td colspan='5'>No source rows found for the stated budget/spend period.</td></tr>"
    return "".join(
        f"<tr><td>{esc(r.get('department',''))}</td><td>{esc(r.get('line',''))}</td>"
        f"<td>{fmt_money(r.get('budget'))}</td><td>{fmt_money(r.get('spent'))}</td>"
        f"<td class='{('bad' if money_num(r.get('remaining')) < 0 else 'good')}'>{fmt_money(r.get('remaining'))}</td></tr>"
        for r in rows[:limit]
    )


def pastor_load_html(rows: list[dict[str, Any]]) -> str:
    return "".join(
        f"<tr class='{('vacant' if r['is_vacant'] else '')}'><td>{esc(r['pastor'])}</td>"
        f"<td>{r['church_count']}</td><td>{r['emerging_group_count']}</td><td>{fmt_money(r['attendance']).replace('$','')}</td>"
        f"<td>{esc(', '.join((r['churches'] + r['emerging_groups'])[:6]))}</td></tr>"
        for r in rows
    )


def office_staff_html(rows: list[dict[str, Any]]) -> str:
    return "".join(
        f"<tr><td>{esc(clean_display_text(r.get('team_member_name')))}</td><td>{esc(clean_display_text(r.get('shared_service_role')))}</td></tr>"
        for r in rows
    )


def read_exact_payroll(path: Path = PAYROLL_CSV) -> dict[str, Any]:
    """Read local exact staff-cost extract for person-level FY figures."""
    if not path.exists():
        return {"source": str(path), "period": "FY2025-26 payroll allocation extract not found", "by_category": [], "people": []}
    rows = read_csv_rows(path)
    by: dict[str, dict[str, Any]] = {}
    people: list[dict[str, Any]] = []
    for r in rows:
        category = r.get("analysis_category") or r.get("final_category") or r.get("category") or "Unclassified"
        cost = money_num(r.get("cost_25_26"))
        by.setdefault(category, {"category": category, "people": 0, "cost": 0.0})
        by[category]["people"] += 1
        by[category]["cost"] += cost
        people.append({
            "staff_id": r.get("staff_id") or "",
            "name": r.get("payroll_name") or r.get("name") or "",
            "category": category,
            "cost_25_26": cost,
            "role": r.get("job_or_area") or r.get("role") or "",
            "notes": r.get("notes") or "",
        })
    return {
        "source": str(path),
        "period": "FY2025-26 payroll allocation extract with manual role/category corrections",
        "by_category": sorted(by.values(), key=lambda x: x["cost"], reverse=True),
        "people": sorted(people, key=lambda x: x["cost_25_26"], reverse=True),
    }


def render_app(model: dict[str, Any]) -> str:
    data_json = json.dumps(model, ensure_ascii=False)
    baseline = model["baseline_capacity"]
    payroll = model.get("exact_payroll", {})
    payroll_categories = "".join(
        f"<option value=\"{esc(clean_display_text(x['category']))}\">{esc(clean_display_text(x['category']))} — {x['people']} people — {fmt_money(x['cost'])}</option>"
        for x in payroll.get("by_category", [])
    )
    payroll_people = "".join(
        f"<tr data-payroll-cat=\"{esc(clean_display_text(x['category']))}\"><td><b>{esc(clean_display_text(x['name']))}</b><br><span class='note'>{esc(x['staff_id'])}</span></td><td>{esc(clean_display_text(x['category']))}</td><td>{fmt_money(x['cost_25_26'])}</td><td>{esc(clean_display_text(x.get('role','')))}</td><td>{esc(clean_display_text(x.get('notes','')))}</td></tr>"
        for x in payroll.get("people", [])
    ) or "<tr><td colspan='5'>Exact payroll extract not found or not indexed.</td></tr>"
    budget_book_period = esc(model['periods']['budget_book'])
    budget_book_budget_basis = esc(model['periods'].get('budget_book_budget_basis','FY2026 budget basis not stated'))
    budget_book_spend_basis = esc(model['periods'].get('budget_book_spend_basis','spend period not stated'))
    payroll_period = esc(payroll.get('period','payroll period not available'))
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>SNSW Staffing Budget App</title>
<style>
:root{{--bg:#050816;--panel:#0e1830;--panel2:#142445;--text:#eef5ff;--muted:#9fb1cc;--line:#294260;--blue:#38bdf8;--violet:#a78bfa;--green:#34d399;--amber:#fbbf24;--red:#fb7185}}
*{{box-sizing:border-box}} body{{margin:0;background:radial-gradient(circle at top left,#172554,#050816 44%),linear-gradient(135deg,#050816,#111827);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}} .wrap{{max-width:1560px;margin:0 auto;padding:28px}} a{{color:#7dd3fc}} .hero{{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}} h1{{font-size:40px;margin:0 0 8px;letter-spacing:-.035em}} h2{{margin:0 0 12px}} .sub,.note{{color:var(--muted);line-height:1.45;font-size:14px}} .nav{{display:flex;gap:10px;flex-wrap:wrap}} .pill,.btn{{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);background:rgba(15,27,47,.85);padding:10px 14px;border-radius:999px;color:var(--text);font-size:13px;text-decoration:none}} .btn{{cursor:pointer;background:linear-gradient(90deg,#38bdf8,#a78bfa);color:#05111f;border:0;font-weight:850}} .grid{{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}} .card{{background:rgba(14,24,48,.88);border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.24);backdrop-filter:blur(14px)}} .span3{{grid-column:span 3}} .span4{{grid-column:span 4}} .span5{{grid-column:span 5}} .span6{{grid-column:span 6}} .span7{{grid-column:span 7}} .span12{{grid-column:span 12}} .label{{font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:.09em}} .value{{font-size:34px;font-weight:850;margin:8px 0}} .good{{color:var(--green)}} .bad{{color:var(--red)}} .amber{{color:var(--amber)}} table{{width:100%;border-collapse:collapse;font-size:13px}} th,td{{padding:10px;border-bottom:1px solid rgba(41,66,96,.75);text-align:left;vertical-align:top}} th{{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}} input,select{{width:100%;padding:11px 12px;background:#071226;border:1px solid #31537b;color:var(--text);border-radius:12px;font-size:15px}} .scenario{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;align-items:end}} .bigrec{{font-size:22px;font-weight:850;line-height:1.2}} canvas{{width:100%;height:320px}} .vacant td:first-child{{color:var(--amber);font-weight:800}} .sources{{font-size:12px;color:var(--muted);word-break:break-word}} @media(max-width:1000px){{.span3,.span4,.span5,.span6,.span7{{grid-column:span 12}}.scenario{{grid-template-columns:1fr}}.hero{{display:block}}}}
</style></head><body><div class='wrap'>
<header class='hero'><div><h1>2027 staffing affordability scenario</h1><div class='sub'>Supporting analysis for the pastoral budget map: field and office staffing, employment-coded budget lines, pastoral load, vacant districts, exact FY2025-26 payroll cross-checks, and a tithe-only staffing affordability scenario.</div><div class='sub'><b>Period / basis:</b> {esc(model['periods']['budget_book'])}; {esc(model['periods']['pastoral_data'])}; {esc(model['periods']['assignments'])}; {esc(payroll.get('period','payroll period not available'))}; {esc(model['periods']['scenario'])}.</div></div><div class='header-meta'><span class='pill'>Generated {esc(model['generated_at'])}</span></div></header>
<section class='grid'>
  <div class='card span12 warn'><div class='label'>Read before using</div><div class='note'><b>Scenario warning, not a staffing recommendation.</b> This page separates three lanes: <b>people cost</b> from payroll, <b>budget authority</b> from approved employment-coded budget lines, and <b>scenario-only</b> 2027 assumptions. A person’s payroll cost is not ministry spending money, and the placeholder FTE model should not drive staffing decisions without exact FTE, package, restricted-funding, cash and governance checks.</div></div>
  <div class='card span3'><div class='label'>Field staff — pastoral assignment snapshot</div><div class='value'>{model['counts']['active_field_pastors']}</div><div class='sub'>{model['counts']['vacant_field_posts']} vacant/TBD field locations flagged; {esc(model['periods']['assignments'])}</div></div>
  <div class='card span3'><div class='label'>Office/shared-service staff — sanitized list</div><div class='value'>{model['counts']['office_staff']}</div><div class='sub'>Names/roles only; {esc(model['periods']['assignments'])}</div></div>
  <div class='card span3'><div class='label'>Scenario estimate — not approved</div><div class='value'>{fmt_money(model['costs']['total_placeholder_staff_cost'])}</div><div class='sub'>At {fmt_money(model['assumptions']['package_cost'])} per FTE; {esc(model['assumptions']['package_cost_note'])}</div></div>
  <div class='card span3'><div class='label'>Approved employment-coded budget lines</div><div class='value'>{fmt_money(model['budget_book']['visible_staff_budget_total'])}</div><div class='sub'>{esc(model['periods']['budget_book'])}</div></div>
  <div class='card span4'><div class='label'>Approved field employment-cost budget</div><div class='value'>{fmt_money(model['budget_book']['field_staff_budget'])}</div><div class='sub'>FIELD salary, super, benefit, vehicle/tithe employment lines; {esc(model['periods']['budget_book'])}</div></div>
  <div class='card span4'><div class='label'>Approved office/shared-service employment-cost budget</div><div class='value'>{fmt_money(model['budget_book']['office_staff_budget'])}</div><div class='sub'>Visible staff lines outside FIELD/AAV from {esc(model['periods']['budget_book'])}; check payroll for exact FTE truth</div></div>
  <div class='card span4'><div class='label'>Tithe-only affordability test — scenario only</div><div class='bigrec'>{esc(baseline['recommendation'])}</div><div class='sub'>Assumes {baseline['target_staff_ratio']:.0%} staff-cost ceiling against {fmt_money(baseline['tithe_target'])} tithe target.</div></div>

  <div class='card span12'><h2>2027 staffing scenario</h2><div class='scenario'>
    <label><div class='label'>Tithe target</div><input id='tithe' type='number' value='{round(model['assumptions']['default_tithe_target'])}'></label>
    <label><div class='label'>Target staff-cost ratio</div><input id='ratio' type='number' step='0.01' value='{model['assumptions']['target_staff_ratio']}'></label>
    <label><div class='label'>Package cost / FTE</div><input id='package' type='number' value='{round(model['assumptions']['package_cost'])}'></label>
    <label><div class='label'>Extra field FTE</div><input id='extraField' type='number' step='0.1' value='0'></label>
    <label><div class='label'>Extra office FTE</div><input id='extraOffice' type='number' step='0.1' value='0'></label>
  </div><br><button class='btn' onclick='recalc()'>Recalculate</button> <button class='btn' onclick='downloadScenario()'>Download 2027 scenario JSON</button><br><br><div class='card' style='background:#091426'><div class='label'>Decision readout</div><div class='bigrec' id='readout'></div><div class='sub' id='readoutDetail'></div></div></div>

  <div class='card span7'><div class='label'>Three lanes: scenario, payroll, and budget authority</div><div class='note'>Scenario figures are planning placeholders. Budget-book lines are approved FY2026 employment-coded budget authority. Exact payroll rows are FY2025-26 people cost. Do not treat these as one combined staffing recommendation.</div><canvas id='costChart'></canvas></div>
  <div class='card span5'><div class='label'>Field load pressure</div><div class='note'>Pastoral entities from the canonical map snapshot; {esc(model['periods']['pastoral_data'])}; {esc(model['periods']['assignments'])}.</div><canvas id='loadChart'></canvas></div>

  <div class='card span12'><h2>Exact payroll staff-cost cross-check</h2><div class='note'>Person-level FY2025-26 figures from the local payroll allocation extract. Use this people-cost lane to challenge the placeholder scenario before any staffing recommendation becomes real.</div><div style='max-width:520px;margin:12px 0'><select id='payrollCat' onchange='filterPayrollCategory()'><option value=''>All categories</option>{payroll_categories}</select></div><table id='payrollDetail'><thead><tr><th>Name / staff ID</th><th>Category</th><th>FY2025-26 payroll cost</th><th>Role / area</th><th>Notes</th></tr></thead><tbody>{payroll_people}</tbody></table><div class='sources'>Payroll period/basis: {payroll_period}<br>Payroll source: {esc(payroll.get('source','not available'))}</div></div>

  <div class='card span6'><h2>Approved field employment-cost budget</h2><div class='note'>Budget basis: {budget_book_budget_basis}. Spend basis: {budget_book_spend_basis}. Source: department dashboard JSON.</div><table><thead><tr><th>Dept</th><th>Line</th><th>{budget_book_budget_basis}</th><th>Spend — {budget_book_spend_basis}</th><th>Remaining vs {budget_book_budget_basis}</th></tr></thead><tbody>{rows_html(model['budget_book']['field_staff_lines'])}</tbody></table></div>
  <div class='card span6'><h2>Employment-coded budget lines outside FIELD/AAV</h2><div class='note'>Budget basis: {budget_book_budget_basis}. Spend basis: {budget_book_spend_basis}. Source: department dashboard JSON.</div><table><thead><tr><th>Dept</th><th>Line</th><th>{budget_book_budget_basis}</th><th>Spend — {budget_book_spend_basis}</th><th>Remaining vs {budget_book_budget_basis}</th></tr></thead><tbody>{rows_html(model['budget_book']['office_staff_lines'])}</tbody></table></div>

  <div class='card span7'><h2>Pastoral load / field coverage</h2><table><thead><tr><th>Pastor / vacancy</th><th>Churches</th><th>Emerging</th><th>Attendance</th><th>Entities</th></tr></thead><tbody>{pastor_load_html(model['pastor_load'])}</tbody></table></div>
  <div class='card span5'><h2>Office/shared-service staff list</h2><table><thead><tr><th>Name</th><th>Role/scope</th></tr></thead><tbody>{office_staff_html(model['office_staff'])}</tbody></table><br><div class='note'>This app intentionally uses sanitized names/roles only. Exact staffing decisions still need approved payroll/FTE, employment-cost data, restricted funding, cash timing, and governance approval.</div></div>

  <div class='card span12'><div class='label'>Sources and limits</div><div class='sources'>Pastoral data: {esc(model['sources']['pastoral_json'])}<br>Dashboard data: {esc(model['sources']['dashboard_json'])}<br>Assignments: {esc(model['sources']['assignments_csv'])}<br>Office list: {esc(model['sources']['office_csv'])}</div><br><div class='note'>Recommendation discipline: this is a scenario tool only. It does not replace approval authority, restricted-funding rules, cash timing, strategic priority, or pastoral/mission judgment. Treat any reduce/add FTE message as a modelling warning, not a recommendation.</div></div>
</section></div>
<script>
const M={data_json};
function money(x){{x=Number(x||0);return (x<0?'(':'')+'$'+Math.round(Math.abs(x)).toLocaleString()+(x<0?')':'');}}
function num(id){{return Number(document.getElementById(id).value||0);}}
function recalc(){{
  const tithe=num('tithe'), ratio=num('ratio'), pkg=num('package'), extraF=num('extraField'), extraO=num('extraOffice');
  const base=Number(M.costs.total_placeholder_staff_cost||0);
  const projected=base+(extraF+extraO)*pkg;
  const max=tithe*ratio;
  const headroom=max-projected;
  const fte=pkg?headroom/pkg:0;
  let msg='';
  if(fte>=0.5) msg='Capacity exists: about '+fte.toFixed(1)+' FTE headroom remains.';
  else if(fte<=-0.5) msg='Scenario warning, not a staffing recommendation: over target by about '+Math.abs(fte).toFixed(1)+' FTE unless income/savings/funding offsets are confirmed.';
  else msg='No meaningful FTE headroom. Hold unless an offset is approved.';
  document.getElementById('readout').textContent=msg;
  document.getElementById('readoutDetail').textContent='Projected staff cost '+money(projected)+' against a maximum '+money(max)+' at '+Math.round(ratio*100)+'% of tithe. Headroom: '+money(headroom)+'.';
  drawCharts(projected,max);
}}
function drawBar(c, labels, values, colors){{const ctx=c.getContext('2d'); c.width=c.clientWidth*2; c.height=320*2; ctx.scale(2,2); const W=c.clientWidth,H=320,p=205; const max=Math.max(...values.map(Math.abs))*1.15||1; ctx.clearRect(0,0,W,H); ctx.font='12px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.textBaseline='middle'; labels.forEach((lab,i)=>{{const y=35+i*42,w=Math.abs(values[i])/max*(W-p-92); ctx.fillStyle='#273951'; ctx.textAlign='right'; ctx.fillText(lab,p-12,y+10); ctx.fillStyle='#e6edf7'; ctx.fillRect(p,y,W-p-92,20); ctx.fillStyle=colors[i]; ctx.fillRect(p,y,w,20); ctx.fillStyle='#061b31'; ctx.textAlign='left'; ctx.fillText(money(values[i]),Math.min(p+w+8,W-86),y+10);}})}}
function drawCharts(projected,maxStaff){{
  drawBar(document.getElementById('costChart'), ['Field placeholder','Office placeholder','Budget-book field staff','Budget-book office staff','Scenario staff cost','Max at ratio'], [M.costs.field_placeholder_cost,M.costs.office_placeholder_cost,M.budget_book.field_staff_budget,M.budget_book.office_staff_budget,projected,maxStaff], ['#533afd','#7c6bff','#334155','#64748d','#9b6829','#108c3d']);
  const top=M.pastor_load.slice(0,8); drawBar(document.getElementById('loadChart'), top.map(x=>x.pastor.slice(0,22)), top.map(x=>x.total_entities), top.map(x=>x.is_vacant?'#9b6829':'#533afd'));
}}
function downloadScenario(){{const tithe=num('tithe'), ratio=num('ratio'), pkg=num('package'), extraF=num('extraField'), extraO=num('extraOffice'); const obj={{createdAt:new Date().toISOString(), source:'staffing-budget-app', titheTarget:tithe, targetStaffRatio:ratio, packageCost:pkg, extraFieldFte:extraF, extraOfficeFte:extraO, currentPlaceholderStaffCost:M.costs.total_placeholder_staff_cost, projectedStaffCost:M.costs.total_placeholder_staff_cost+(extraF+extraO)*pkg}}; const blob=new Blob([JSON.stringify(obj,null,2)],{{type:'application/json'}}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='snsw-2027-staffing-scenario.json'; a.click();}}
function filterPayrollCategory(){{const v=document.getElementById('payrollCat').value;document.querySelectorAll('#payrollDetail tbody tr').forEach(tr=>tr.style.display=(!v||tr.dataset.payrollCat===v)?'':'none')}}
recalc();
</script></body></html>"""


def main() -> None:
    DASHBOARD_DIR.mkdir(parents=True, exist_ok=True)
    model = build_staffing_model()
    OUT_JSON.write_text(json.dumps(model, indent=2, ensure_ascii=False), encoding="utf-8")
    ensure_theme_file(DASHBOARD_DIR)
    OUT_HTML.write_text(apply_stripe_theme(render_app(model)), encoding="utf-8")
    # Navigation is handled by cfo-command-centre.html. Do not inject cross-page
    # buttons into child dashboards; they create duplicate UI inside the menu shell.
    linked = []
    print(OUT_HTML)
    print(OUT_JSON)
    if linked:
        print("Linked from: " + ", ".join(linked))


if __name__ == "__main__":
    main()
