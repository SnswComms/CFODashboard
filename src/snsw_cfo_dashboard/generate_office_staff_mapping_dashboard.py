#!/usr/bin/env python3
"""Generate the local Office Staff Modelling Map dashboard.

Reads only Hermes-CFO payroll/staff-cost CSV/JSON inputs and writes derived
HTML/JSON into briefings/dashboards. Does not mutate OneDrive/source files.
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
DATA_DIR = WORKSPACE / "finance" / "payroll-staff-costs"
DASHBOARD_DIR = WORKSPACE / "briefings" / "dashboards"
CURRENT_CSV = DATA_DIR / "current_25_26_staff_allocation_with_overrides.csv"
PAYROLL_FY_CSV = DATA_DIR / "payroll_person_by_fy_sensitive.csv"
OVERRIDES_JSON = DATA_DIR / "staff-role-overrides.json"
OUT_HTML = DASHBOARD_DIR / "office-staff-modelling-map.html"
OUT_JSON = DASHBOARD_DIR / "office-staff-modelling-map-data.json"

OFFICE_CATEGORIES = [
    "Admin / Executive",
    "Finance",
    "Department director",
    "Department support",
    "Other conference",
]
OFFICE_SET = set(OFFICE_CATEGORIES)
TREND_FYS = ["23-24", "24-25", "25-26"]


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def money_num(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
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


def fmt_num(value: Any, decimals: int = 0) -> str:
    x = money_num(value)
    return f"{x:,.{decimals}f}"




def clean_display_text(value: Any) -> str:
    text = '' if value is None else str(value)
    replacements = {
        'Cheif Financial Officer': 'Chief Financial Officer',
        'General Secratary': 'General Secretary',
        'Ministerial Secratary': 'Ministerial Secretary',
        'Payrol Clerk': 'Payroll Clerk',
        'Pr. Justin Lawnan': 'Pr. Justin Lawman',
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


def pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / previous


def trend_badge(current: float, previous: float) -> str:
    pct = pct_change(current, previous)
    if pct is None:
        return "n/a"
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct * 100:.1f}%"


def source_object(title: str, payload: Any, open_: bool = False) -> str:
    return (
        f"<details class='source-object' {'open' if open_ else ''}>"
        f"<summary>{esc(title)}</summary>"
        f"<pre>{esc(json.dumps(payload, indent=2, ensure_ascii=False))}</pre>"
        "</details>"
    )


def build_model() -> dict[str, Any]:
    current_rows = read_csv_rows(CURRENT_CSV)
    payroll_rows = read_csv_rows(PAYROLL_FY_CSV)
    overrides = json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))

    payroll_by_staff: dict[str, list[dict[str, Any]]] = defaultdict(list)
    payroll_by_staff_fy: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in payroll_rows:
        normalised = dict(row)
        normalised["total"] = money_num(row.get("total"))
        normalised["hours"] = money_num(row.get("hours"))
        payroll_by_staff[row.get("staff_id", "")].append(normalised)
        payroll_by_staff_fy[row.get("staff_id", "")][row.get("fy", "")] = normalised

    current_by_staff = {r.get("staff_id", ""): r for r in current_rows}
    office_rows: list[dict[str, Any]] = []
    unclassified_rows: list[dict[str, Any]] = []
    excluded_or_offset_rows: list[dict[str, Any]] = []

    for row in current_rows:
        staff_id = row.get("staff_id", "")
        category = row.get("final_category") or row.get("analysis_category") or row.get("category") or ""
        cost_25_26 = money_num(row.get("cost_25_26"))
        fy_values = {fy: money_num(payroll_by_staff_fy.get(staff_id, {}).get(fy, {}).get("total")) for fy in TREND_FYS}
        enriched = {
            **row,
            "cost_25_26": cost_25_26,
            "fy_totals": fy_values,
            "payroll_fy_rows": payroll_by_staff.get(staff_id, []),
            "override_object": overrides.get("roles", {}).get(staff_id, {}),
            "delta_24_25_to_25_26": fy_values["25-26"] - fy_values["24-25"],
            "pct_24_25_to_25_26": pct_change(fy_values["25-26"], fy_values["24-25"]),
        }
        if category in OFFICE_SET:
            office_rows.append(enriched)
        if (category or "").strip().lower() in {"", "unknown_needs_kyle", "unknown", "unclassified"}:
            unclassified_rows.append(enriched)
        if category not in OFFICE_SET:
            text = " ".join(str(row.get(k, "")) for k in ["final_category", "analysis_category", "category", "job_or_area", "role", "notes"]).lower()
            if any(term in text for term in ["school", "aav", "exclude", "national", "bible worker", "remote", "offset", "fund"]):
                excluded_or_offset_rows.append(enriched)

    office_rows.sort(key=lambda r: (-money_num(r.get("cost_25_26")), str(r.get("payroll_name", ""))))
    unclassified_rows.sort(key=lambda r: (-money_num(r.get("cost_25_26")), str(r.get("payroll_name", ""))))
    excluded_or_offset_rows.sort(key=lambda r: (-money_num(r.get("cost_25_26")), str(r.get("payroll_name", ""))))

    totals_by_category: dict[str, dict[str, Any]] = {}
    for category in OFFICE_CATEGORIES:
        people = [r for r in office_rows if r.get("final_category") == category]
        fy_totals = {fy: sum(money_num(r["fy_totals"].get(fy)) for r in people) for fy in TREND_FYS}
        totals_by_category[category] = {
            "category": category,
            "people_count": len(people),
            "cost_25_26": sum(money_num(r.get("cost_25_26")) for r in people),
            "fy_totals": fy_totals,
            "delta_24_25_to_25_26": fy_totals["25-26"] - fy_totals["24-25"],
            "pct_24_25_to_25_26": pct_change(fy_totals["25-26"], fy_totals["24-25"]),
        }

    trend_totals = {fy: sum(totals_by_category[c]["fy_totals"][fy] for c in OFFICE_CATEGORIES) for fy in TREND_FYS}
    all_current_total = sum(money_num(r.get("cost_25_26")) for r in current_rows)
    office_total = sum(money_num(r.get("cost_25_26")) for r in office_rows)
    unclassified_total = sum(money_num(r.get("cost_25_26")) for r in unclassified_rows)

    remote_funding_notes = []
    if not any("remote" in " ".join(str(v).lower() for v in r.values()) for r in current_rows):
        remote_funding_notes.append("No explicit remote-worker flag was found in the available CSV/JSON inputs.")
    if not any(any(term in " ".join(str(v).lower() for v in r.values()) for term in ["funding", "offset"]) for r in current_rows):
        remote_funding_notes.append("No explicit funding-offset field was found; offset/on-charge candidates below are inferred only from category, role, area, and notes text.")

    model = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "title": "Office Staff Modelling Map",
        "sources": {
            "current_staff_allocation_csv": str(CURRENT_CSV),
            "payroll_person_by_fy_csv": str(PAYROLL_FY_CSV),
            "staff_role_overrides_json": str(OVERRIDES_JSON),
        },
        "basis": {
            "office_categories": OFFICE_CATEGORIES,
            "trend_fys": TREND_FYS,
            "trend_method": "FY2023-24 to FY2025-26 payroll totals are joined by staff_id and grouped by the current final_category from current_25_26_staff_allocation_with_overrides.csv.",
            "remote_worker_funding_offset_basis": "Available data has no explicit remote-worker or funding-offset field. The dashboard therefore shows a warning and lists inferred excluded/on-charge candidates only where category/role/area/notes include school, AAV, exclude, national, Bible Worker, remote, offset, or funding terms.",
        },
        "summary": {
            "current_staff_rows": len(current_rows),
            "office_person_rows": len(office_rows),
            "office_cost_25_26": office_total,
            "all_current_staff_cost_25_26": all_current_total,
            "office_share_of_current_staff_cost": office_total / all_current_total if all_current_total else None,
            "unclassified_rows": len(unclassified_rows),
            "unclassified_cost_25_26": unclassified_total,
            "trend_total_23_24": trend_totals["23-24"],
            "trend_total_24_25": trend_totals["24-25"],
            "trend_total_25_26": trend_totals["25-26"],
            "trend_delta_23_24_to_25_26": trend_totals["25-26"] - trend_totals["23-24"],
            "trend_pct_23_24_to_25_26": pct_change(trend_totals["25-26"], trend_totals["23-24"]),
        },
        "category_totals": [totals_by_category[c] for c in OFFICE_CATEGORIES],
        "trend_totals": trend_totals,
        "office_people": office_rows,
        "unclassified_warnings": unclassified_rows,
        "remote_funding_offset": {
            "notes": remote_funding_notes,
            "candidate_rows": excluded_or_offset_rows,
        },
    }
    return model


def build_html(model: dict[str, Any]) -> str:
    summary = model["summary"]
    trend = model["trend_totals"]
    max_trend = max(trend.values()) if trend else 1

    category_cards = []
    for cat in model["category_totals"]:
        fy = cat["fy_totals"]
        category_cards.append(f"""
        <div class="card span4 category-card">
          <div class="label">{esc(cat['category'])}</div>
          <div class="value">{fmt_money(cat['cost_25_26'])}</div>
          <div class="small">{cat['people_count']} current person rows · FY24-25 to FY25-26 {trend_badge(fy['25-26'], fy['24-25'])}</div>
          <div class="mini-trend">
            {''.join(f'<div><span>{esc(fy_label)}</span><b>{fmt_money(fy[fy_label])}</b><i style="width:{(money_num(fy[fy_label]) / max(max(fy.values()), 1)) * 100:.1f}%"></i></div>' for fy_label in TREND_FYS)}
          </div>
        </div>
        """)

    people_rows = []
    for row in model["office_people"]:
        fy = row["fy_totals"]
        source_payload = {
            "current_allocation_row": {k: v for k, v in row.items() if k not in {"fy_totals", "payroll_fy_rows", "override_object", "delta_24_25_to_25_26", "pct_24_25_to_25_26"}},
            "payroll_fy_rows": row["payroll_fy_rows"],
            "staff_role_override": row["override_object"],
        }
        people_rows.append(f"""
        <tr>
          <td><b>{esc(row.get('payroll_name'))}</b><div class="small">{esc(row.get('staff_id'))}</div></td>
          <td>{esc(clean_display_text(row.get('final_category')))}</td>
          <td>{esc(clean_display_text(row.get('role') or row.get('job_or_area')))}<div class="small">{esc(clean_display_text(row.get('notes')))}</div></td>
          <td class="num">{fmt_money(fy['23-24'])}</td>
          <td class="num">{fmt_money(fy['24-25'])}</td>
          <td class="num strong">{fmt_money(row.get('cost_25_26'))}</td>
          <td class="num {('bad' if money_num(row.get('delta_24_25_to_25_26')) > 0 else 'good')}">{fmt_money(row.get('delta_24_25_to_25_26'))}</td>
          <td>{source_object('source rows', source_payload)}</td>
        </tr>
        """)

    unclassified_rows = []
    for row in model["unclassified_warnings"]:
        unclassified_rows.append(f"""
        <tr>
          <td><b>{esc(row.get('payroll_name'))}</b><div class="small">{esc(row.get('staff_id'))}</div></td>
          <td class="num">{fmt_money(row.get('cost_25_26'))}</td>
          <td>{esc(clean_display_text(row.get('category')))}</td>
          <td>{esc(row.get('job_or_area') or row.get('role') or row.get('notes'))}</td>
          <td>{source_object('source rows', {'current_allocation_row': {k: v for k, v in row.items() if k not in {'fy_totals','payroll_fy_rows','override_object','delta_24_25_to_25_26','pct_24_25_to_25_26'}}, 'payroll_fy_rows': row.get('payroll_fy_rows', []), 'override': row.get('override_object', {})})}</td>
        </tr>
        """)

    offset_rows = []
    for row in model["remote_funding_offset"]["candidate_rows"]:
        offset_rows.append(f"""
        <tr>
          <td><b>{esc(row.get('payroll_name'))}</b><div class="small">{esc(row.get('staff_id'))}</div></td>
          <td>{esc(clean_display_text(row.get('final_category')))}</td>
          <td class="num">{fmt_money(row.get('cost_25_26'))}</td>
          <td>{esc(clean_display_text(row.get('role') or row.get('job_or_area')))}<div class="small">{esc(clean_display_text(row.get('notes')))}</div></td>
          <td>{source_object('source rows', {'current_allocation_row': {k: v for k, v in row.items() if k not in {'fy_totals','payroll_fy_rows','override_object','delta_24_25_to_25_26','pct_24_25_to_25_26'}}, 'payroll_fy_rows': row.get('payroll_fy_rows', []), 'override': row.get('override_object', {})})}</td>
        </tr>
        """)

    trend_blocks = []
    for fy in TREND_FYS:
        w = (money_num(trend[fy]) / max_trend * 100) if max_trend else 0
        trend_blocks.append(f"""
        <div class="trend-row"><span>{esc('FY20' + fy)}</span><b>{fmt_money(trend[fy])}</b><div class="bar"><i style="width:{w:.1f}%"></i></div></div>
        """)

    source_links = "".join(
        f"<li><a href=\"file://{esc(path)}\">{esc(name)}</a><code>{esc(path)}</code></li>"
        for name, path in model["sources"].items()
    )
    notes = "".join(f"<li>{esc(n)}</li>" for n in model["remote_funding_offset"]["notes"])

    html_doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(model['title'])}</title>
<style>
  .hero{{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}}
  .hero p{{max-width:860px}}
  .summary-grid{{margin-bottom:20px}}
  .card .value.small-value{{font-size:28px!important}}
  .toolbar{{display:flex;gap:12px;align-items:center;margin:14px 0}}
  .toolbar input{{min-width:320px;padding:10px 12px}}
  .table-wrap{{overflow:auto;max-height:760px;border-radius:8px;border:1px solid #e5edf5}}
  td,th{{padding:10px 12px;vertical-align:top}}
  td.num,th.num{{text-align:right;white-space:nowrap}}
  .strong{{font-weight:500!important;color:#061b31!important}}
  .source-object summary{{cursor:pointer;color:#533afd;font-size:12px;font-weight:500}}
  .source-object pre{{white-space:pre-wrap;max-width:720px;max-height:360px;overflow:auto;background:#f8fbff;border:1px solid #e5edf5;border-radius:6px;padding:10px;font-size:11px;color:#273951}}
  .mini-trend{{display:grid;gap:8px;margin-top:14px}}
  .mini-trend div{{display:grid;grid-template-columns:58px 92px 1fr;gap:8px;align-items:center;font-size:12px}}
  .mini-trend i,.trend-row i{{display:block;height:8px;border-radius:999px;background:linear-gradient(90deg,#533afd,#7c6bff,#f96bee)}}
  .trend-row{{display:grid;grid-template-columns:90px 130px 1fr;gap:12px;align-items:center;margin:12px 0}}
  .warn-box{{background:#fff7e6;border:1px solid rgba(155,104,41,.24);border-radius:8px;padding:14px;color:#9b6829}}
  .source-list code{{display:block;color:#64748d;font-size:11px;margin-top:2px}}
  .section-head{{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-top:20px}}
  .question-grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 18px}}
  .question-card{{background:#fff;border:1px solid #e5edf5;border-radius:8px;padding:12px;box-shadow:rgba(23,23,23,.05) 0 8px 20px -14px}}
  .question-card b{{display:block;color:#061b31;font-weight:500;margin-bottom:4px}}
  .question-card span{{display:block;color:#64748d;font-size:13px;line-height:1.28}}
  .chip-list{{display:grid;gap:8px;margin-top:10px}}
  .chip-list div{{border:1px solid #e5edf5;background:#f8fbff;border-radius:6px;padding:9px 10px;color:#64748d;font-size:13px}}
  .chip-list b{{display:block;color:#061b31;font-weight:500;margin-bottom:2px}}
  details.compact-drawer{{border:1px solid #e5edf5;border-radius:8px;background:#fff;overflow:hidden;margin-top:12px}}
  details.compact-drawer>summary{{cursor:pointer;list-style:none;padding:12px 14px;color:#061b31;font-weight:500}}
  details.compact-drawer>summary::-webkit-details-marker{{display:none}}
  details.compact-drawer .drawer-body{{border-top:1px solid #e5edf5;padding:12px 14px;background:#f8fbff}}
  @media(max-width:1000px){{.question-grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
  @media(max-width:620px){{.question-grid{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div>
      <h1>Office Staff Modelling Map</h1>
      <p class="sub">Named office/shared-service staff costs, trend, and classification warnings. Generated {esc(model['generated_at'])}.</p>
    </div>
    <div class="header-meta">
      <span class="pill">Local only</span>
      <span class="pill warn">Sensitive payroll</span>
      <a class="pill" href="office-staff-modelling-map-data.json">Open JSON</a>
    </div>
  </div>

  <div class="question-grid">
    <div class="question-card"><b>Kyle / CFO</b><span>What office people cost is visible, and what classification warning changes the answer?</span></div>
    <div class="question-card"><b>Finance team</b><span>Search a person, then open their source rows.</span></div>
    <div class="question-card"><b>Budget owner</b><span>Do not add this page to department operating budgets without checking basis.</span></div>
    <div class="question-card"><b>AUC / auditor</b><span>Use the source drawer for current allocation, FY payroll rows, and override object.</span></div>
  </div>

  <div class="grid summary-grid">
    <div class="card span4"><div class="label">Answer</div><h2>People cost, not department authority</h2><div class="small">Use this for named office/shared-service role costs. Use Department Budget for ministry operating/program spend.</div></div>
    <div class="card span4"><div class="label">Risk</div><h2>Keep payroll and ministry spend separate</h2><div class="small">Faith FM, Communications and Youth can appear here as payroll cost and elsewhere as program budget.</div></div>
    <div class="card span4"><div class="label">Source lane</div><h2>Payroll extract + role overrides</h2><div class="small">Each person row opens source rows: current allocation, payroll-by-FY rows, and manual role/category override.</div></div>
    <div class="card span3"><div class="label">Office person rows</div><div class="value">{summary['office_person_rows']}</div><div class="small">of {summary['current_staff_rows']} current allocation rows</div></div>
    <div class="card span3"><div class="label">FY2025-26 office cost</div><div class="value small-value">{fmt_money(summary['office_cost_25_26'])}</div><div class="small">{summary['office_share_of_current_staff_cost']*100:.1f}% of current staff-cost allocation</div></div>
    <div class="card span3"><div class="label">FY2023-24 → FY2025-26</div><div class="value small-value">{fmt_money(summary['trend_delta_23_24_to_25_26'])}</div><div class="small">{trend_badge(summary['trend_total_25_26'], summary['trend_total_23_24'])} over the three-year view</div></div>
    <div class="card span3"><div class="label">Unclassified warning</div><div class="value warn">{summary['unclassified_rows']}</div><div class="small">{fmt_money(summary['unclassified_cost_25_26'])} needs Kyle classification</div></div>
  </div>

  <div class="grid">
    <div class="card span7">
      <h2>FY2023-24 to FY2025-26 office payroll trend</h2>
      <p class="small">Joined by staff_id and grouped by current final_category. This is a modelling view, not a formal audited payroll report.</p>
      {''.join(trend_blocks)}
    </div>
    <div class="card span5">
      <h2>Source chips</h2>
      <div class="chip-list">
        <div><b>Current allocation</b>Person/category/role rows behind the FY2025-26 view.</div>
        <div><b>Payroll by FY</b>FY2023-24 to FY2025-26 totals joined by staff_id.</div>
        <div><b>Manual overrides</b>Kyle-classified role/category corrections where present.</div>
      </div>
      <details class="compact-drawer"><summary>Open local source paths and basis object</summary><div class="drawer-body"><ul class="source-list">{source_links}</ul>{source_object('dashboard basis object', model['basis'], open_=False)}</div></details>
    </div>
  </div>

  <div class="grid" style="margin-top:18px">{''.join(category_cards)}</div>

  <div class="section-head">
    <div><h2>Current office person rows</h2><p class="small">Exact FY2025-26 figures from current_25_26_staff_allocation_with_overrides.csv; trend columns from payroll_person_by_fy_sensitive.csv.</p></div>
    <div class="toolbar"><input id="peopleSearch" placeholder="Filter people, category, role…"></div>
  </div>
  <div class="table-wrap card" style="padding:0!important"><table id="peopleTable"><thead><tr><th>Person</th><th>Office category</th><th>Role / area / note</th><th class="num">FY23-24</th><th class="num">FY24-25</th><th class="num">FY25-26</th><th class="num">Δ vs FY24-25</th><th>Source</th></tr></thead><tbody>{''.join(people_rows)}</tbody></table></div>

  <div class="section-head"><div><h2>Unclassified warnings</h2><p class="small">Decision risk only: open the table when cleaning categories.</p></div></div>
  <div class="warn-box">{summary['unclassified_rows']} unclassified current rows total {fmt_money(summary['unclassified_cost_25_26'])}. Classify these before relying on the office/non-office split.</div>
  <details class="compact-drawer"><summary>Open unclassified person rows</summary><div class="table-wrap card drawer-body" style="padding:0!important"><table><thead><tr><th>Person</th><th class="num">FY25-26 cost</th><th>Current category</th><th>Signal</th><th>Source</th></tr></thead><tbody>{''.join(unclassified_rows)}</tbody></table></div></details>

  <div class="section-head"><div><h2>Remote worker / funding-offset section</h2><p class="small">Conservative warning: no explicit remote-worker or funding-offset field exists in the current inputs.</p></div></div>
  <div class="warn-box"><ul>{notes}</ul></div>
  <details class="compact-drawer"><summary>Open inferred excluded / on-charge candidates</summary><div class="table-wrap card drawer-body" style="padding:0!important"><table><thead><tr><th>Person</th><th>Category</th><th class="num">FY25-26 cost</th><th>Signal</th><th>Source</th></tr></thead><tbody>{''.join(offset_rows)}</tbody></table></div></details>
</div>
<script>
const search = document.getElementById('peopleSearch');
const rows = Array.from(document.querySelectorAll('#peopleTable tbody tr'));
search.addEventListener('input', () => {{
  const q = search.value.toLowerCase();
  rows.forEach(r => r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none');
}});
</script>
</body>
</html>
"""
    return apply_stripe_theme(html_doc)


def main() -> None:
    DASHBOARD_DIR.mkdir(parents=True, exist_ok=True)
    ensure_theme_file(DASHBOARD_DIR)
    model = build_model()
    OUT_JSON.write_text(json.dumps(model, indent=2, ensure_ascii=False), encoding="utf-8")
    OUT_HTML.write_text(build_html(model), encoding="utf-8")
    print(f"Wrote {OUT_HTML}")
    print(f"Wrote {OUT_JSON}")
    print(f"Office rows: {model['summary']['office_person_rows']} · FY25-26 office cost: {fmt_money(model['summary']['office_cost_25_26'])} · unclassified: {model['summary']['unclassified_rows']}")


if __name__ == "__main__":
    main()
