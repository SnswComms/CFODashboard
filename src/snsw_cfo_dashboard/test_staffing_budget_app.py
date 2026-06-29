import csv
import json
import tempfile
import unittest
from pathlib import Path

import generate_staffing_budget_app as app


class StaffingBudgetAppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pastoral_json = self.root / "app-data.json"
        self.dashboard_json = self.root / "department-budget-dashboard-data.json"
        self.assignments_csv = self.root / "assignments.csv"
        self.office_csv = self.root / "office.csv"

        self.pastoral_json.write_text(json.dumps({
            "metadata": {
                "temporary_cost_assumption": {
                    "full_time_pastor_or_office_staff_cost": 150000,
                    "placeholder_pastoral_cost": 3000000,
                    "placeholder_office_shared_services_cost": 2400000,
                }
            },
            "churches": [
                {"name": "Bega Church", "assigned_pastor": "VACANT / TBD", "attendance": 50},
                {"name": "Albury Church", "assigned_pastor": "Tom Kent", "attendance": 179},
                {"name": "Wodonga Church", "assigned_pastor": "Toby Clare", "attendance": 80},
            ],
            "emerging_groups": [
                {"group_name": "Walwa", "assigned_pastor": "Toby Clare"},
            ],
        }), encoding="utf-8")

        self.dashboard_json.write_text(json.dumps({
            "departments": [
                {"name": "FIELD", "budget": 2900000, "spent": 500000, "remaining": 2400000, "lines": [
                    {"line": "Salaries and wages", "budget": 900000, "spent": 100000, "remaining": 800000},
                    {"line": "Superannuation", "budget": 200000, "spent": 20000, "remaining": 180000},
                    {"line": "Travel", "budget": 100000, "spent": 50000, "remaining": 50000},
                ]},
                {"name": "ADMINISTRATION", "budget": 1400000, "spent": 200000, "remaining": 1200000, "lines": [
                    {"line": "Salaries and wages", "budget": 700000, "spent": 90000, "remaining": 610000},
                    {"line": "Consultants", "budget": 100000, "spent": 10000, "remaining": 90000},
                ]},
                {"name": "YOUTH MINISTRY", "budget": 300000, "spent": 40000, "remaining": 260000, "lines": [
                    {"line": "Salaries and wages", "budget": 120000, "spent": 10000, "remaining": 110000},
                ]},
            ]
        }), encoding="utf-8")

        with self.assignments_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["pastor_name", "church_name_from_sheet", "responsibility_type"])
            w.writeheader()
            w.writerow({"pastor_name": "Tom Kent", "church_name_from_sheet": "Albury", "responsibility_type": "primary"})
            w.writerow({"pastor_name": "Toby Clare", "church_name_from_sheet": "Wodonga", "responsibility_type": "primary"})
            w.writerow({"pastor_name": "VACANT / TBD", "church_name_from_sheet": "Bega", "responsibility_type": "vacant_tbd"})
        with self.office_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["team_member_name", "shared_service_role", "status"])
            w.writeheader()
            w.writerow({"team_member_name": "Office One", "shared_service_role": "CFO", "status": "current"})
            w.writerow({"team_member_name": "Office Two", "shared_service_role": "Accountant", "status": "current"})

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_model_separates_field_and_office_staffing_costs(self):
        model = app.build_staffing_model(
            pastoral_json=self.pastoral_json,
            dashboard_json=self.dashboard_json,
            assignments_csv=self.assignments_csv,
            office_csv=self.office_csv,
        )
        self.assertEqual(model["counts"]["active_field_pastors"], 2)
        self.assertEqual(model["counts"]["vacant_field_posts"], 1)
        self.assertEqual(model["counts"]["office_staff"], 2)
        self.assertEqual(model["costs"]["field_placeholder_cost"], 300000)
        self.assertEqual(model["costs"]["office_placeholder_cost"], 300000)
        self.assertEqual(model["budget_book"]["field_staff_budget"], 1100000)
        self.assertEqual(model["budget_book"]["office_staff_budget"], 820000)

    def test_build_model_flags_hire_fire_capacity_against_tithe_only_target(self):
        model = app.build_staffing_model(
            pastoral_json=self.pastoral_json,
            dashboard_json=self.dashboard_json,
            assignments_csv=self.assignments_csv,
            office_csv=self.office_csv,
        )
        decision = app.assess_staffing_capacity(model, tithe_target=1_000_000, target_staff_ratio=0.75)
        self.assertEqual(decision["max_staff_cost_at_target"], 750000)
        self.assertEqual(decision["current_placeholder_staff_cost"], 600000)
        self.assertEqual(decision["headroom"], 150000)
        self.assertEqual(decision["fte_headroom"], 1.0)
        self.assertEqual(decision["recommendation"], "Can afford about 1.0 more FTE at the placeholder package, before governance/cash checks.")

    def test_render_uses_command_centre_navigation_and_scenario_controls(self):
        model = app.build_staffing_model(
            pastoral_json=self.pastoral_json,
            dashboard_json=self.dashboard_json,
            assignments_csv=self.assignments_csv,
            office_csv=self.office_csv,
        )
        html = app.render_app(model)
        self.assertNotIn("department-budget-dashboard.html", html)
        self.assertIn("2027 staffing scenario", html)
        self.assertIn("Field staff", html)
        self.assertIn("Office/shared-service staff", html)
        self.assertIn("Exact payroll staff-cost cross-check", html)


if __name__ == "__main__":
    unittest.main()
