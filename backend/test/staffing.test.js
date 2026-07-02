const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point the roles store at a throwaway dir so tests never mutate the fixture.
// Presence of the keys in process.env (even empty) prevents dotenv overrides.
process.env.PAYROLL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "staffing-roles-test-"));
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SNSW_ALLOWANCE_EMAIL_LIVE_SEND = "";

const test = require("node:test");
const assert = require("node:assert");
const { withServer, requestJson } = require("./helper");

test("GET /api/staffing/budget-app returns the synthetic model in an envelope", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/budget-app");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "synthetic");
    assert.strictEqual(body.data.budget_book.field_staff_budget, 1100000);
    assert.strictEqual(body.data.budget_book.office_staff_budget, 820000);
    assert.strictEqual(body.data.counts.active_field_pastors, 2);
    assert.strictEqual(body.data.costs.total_placeholder_staff_cost, 600000);
    assert.ok(Array.isArray(body.data.pastor_load));
    assert.strictEqual(body.data.baseline_capacity.fte_headroom, 22.0);
  });
});

test("GET /api/staffing/pastor-load returns paginated rows, vacancies first", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/pastor-load");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data[0].is_vacant, true);
    assert.strictEqual(body.meta.total, 3);
    const limited = await requestJson(base, "/api/staffing/pastor-load?limit=1&offset=1");
    assert.strictEqual(limited.status, 200);
    assert.strictEqual(limited.body.data.length, 1);
    assert.strictEqual(limited.body.data[0].pastor, "Example Pastor B");
  });
});

test("GET /api/staffing/payroll returns the exact_payroll block and filters by category", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/payroll");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.period, "FY2025-26 payroll allocation extract with manual role/category corrections");
    assert.strictEqual(body.data.by_category.length, 2);
    assert.strictEqual(body.data.people.length, 2);

    const filtered = await requestJson(base, "/api/staffing/payroll?category=Finance");
    assert.strictEqual(filtered.status, 200);
    assert.strictEqual(filtered.body.data.people.length, 1);
    assert.strictEqual(filtered.body.data.people[0].name, "Example Officer B");
    assert.strictEqual(filtered.body.data.by_category.length, 1);
  });
});

test("GET /api/staffing/payroll rejects an unknown category with 400", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/payroll?category=Bogus");
    assert.strictEqual(status, 400);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "BAD_REQUEST");
  });
});

test("POST /api/staffing/scenario matches test_staffing_budget_app.py math (snake_case)", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/scenario", {
      method: "POST",
      body: { tithe_target: 1000000, target_staff_ratio: 0.75 },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.max_staff_cost_at_target, 750000);
    assert.strictEqual(body.data.current_placeholder_staff_cost, 600000);
    assert.strictEqual(body.data.headroom, 150000);
    assert.strictEqual(body.data.fte_headroom, 1.0);
    assert.strictEqual(
      body.data.recommendation,
      "Can afford about 1.0 more FTE at the placeholder package, before governance/cash checks.");
  });
});

test("POST /api/staffing/scenario accepts camelCase keys and extra FTE inputs", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/scenario", {
      method: "POST",
      body: { titheTarget: 1000000, targetStaffRatio: 0.75, extraFieldFte: 2 },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.tithe_target, 1000000);
    assert.strictEqual(body.data.package_cost, 150000);
    assert.strictEqual(body.data.extra_field_fte, 2);
    assert.strictEqual(body.data.projected_staff_cost, 900000);
    assert.strictEqual(body.data.headroom, -150000);
    assert.strictEqual(body.data.fte_headroom, -1.0);
    assert.strictEqual(
      body.data.recommendation,
      "Scenario warning, not a staffing recommendation: over target by about 1.0 FTE at the placeholder package unless income rises, costs move, or restricted/offset funding is confirmed.");
  });
});

test("POST /api/staffing/scenario rejects non-numeric inputs with 400", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/scenario", {
      method: "POST",
      body: { titheTarget: "not-a-number" },
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "BAD_REQUEST");
  });
});

test("GET /api/staffing/office-map returns the full model", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/office-map");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.title, "Office Staff Modelling Map");
    assert.strictEqual(body.data.summary.office_person_rows, 2);
    assert.strictEqual(body.data.trend_totals["25-26"], 350000);
    assert.strictEqual(body.meta.dataSource, "synthetic");
  });
});

test("GET /api/staffing/office-map/people filters by q and category", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/staffing/office-map/people");
    assert.strictEqual(all.status, 200);
    assert.strictEqual(all.body.data.length, 2);

    const byQuery = await requestJson(base, "/api/staffing/office-map/people?q=officer%20b");
    assert.strictEqual(byQuery.status, 200);
    assert.strictEqual(byQuery.body.data.length, 1);
    assert.strictEqual(byQuery.body.data[0].payroll_name, "Example Officer B");

    const byCategory = await requestJson(base, "/api/staffing/office-map/people?category=Finance");
    assert.strictEqual(byCategory.status, 200);
    assert.strictEqual(byCategory.body.data.length, 1);
    assert.strictEqual(byCategory.body.data[0].staff_id, "STF-002");

    const bad = await requestJson(base, "/api/staffing/office-map/people?category=NotACategory");
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.code, "BAD_REQUEST");
  });
});

test("legacy roles API round-trip is byte-compatible with staff_role_api.py", async () => {
  await withServer(async (base) => {
    const initial = await requestJson(base, "/roles");
    assert.strictEqual(initial.status, 200);
    assert.deepStrictEqual(Object.keys(initial.body).sort(), ["roles", "updated_at"]);
    assert.strictEqual(initial.body.updated_at, null);

    // Bare map body (no "roles" wrapper) is accepted.
    const bare = await requestJson(base, "/roles", {
      method: "POST",
      body: { "STF-900": { role: "Test Role", category: "Finance", comment: "" } },
    });
    assert.strictEqual(bare.status, 200);
    assert.strictEqual(bare.body.ok, true);
    assert.strictEqual(bare.body.saved, 1);
    assert.strictEqual(typeof bare.body.file, "string");

    // Wrapped body; non-object values counted in saved but not persisted.
    const wrapped = await requestJson(base, "/roles", {
      method: "POST",
      body: { roles: { "STF-901": { role: "Another" }, "STF-902": "not-an-object" } },
    });
    assert.strictEqual(wrapped.status, 200);
    assert.strictEqual(wrapped.body.saved, 2);

    const after = await requestJson(base, "/roles");
    assert.strictEqual(after.status, 200);
    assert.strictEqual(typeof after.body.updated_at, "string");
    assert.deepStrictEqual(after.body.roles["STF-900"], { role: "Test Role", category: "Finance", comment: "" });
    assert.deepStrictEqual(after.body.roles["STF-901"], { role: "Another" });
    assert.strictEqual("STF-902" in after.body.roles, false);

    // Canonical alias shares the same document and legacy body shape.
    const canonical = await requestJson(base, "/api/staffing/roles");
    assert.strictEqual(canonical.status, 200);
    assert.deepStrictEqual(canonical.body, after.body);
  });
});

test("POST /roles rejects non-object roles with legacy 400 body", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/roles", {
      method: "POST",
      body: { roles: [1, 2, 3] },
    });
    assert.strictEqual(status, 400);
    assert.deepStrictEqual(body, { ok: false, error: "roles must be an object" });
  });
});

test("GET /roles/health reports the overrides file on both paths", async () => {
  await withServer(async (base) => {
    const legacy = await requestJson(base, "/roles/health");
    assert.strictEqual(legacy.status, 200);
    assert.strictEqual(legacy.body.ok, true);
    assert.ok(legacy.body.file.includes("staff-role-overrides.json"));
    const canonical = await requestJson(base, "/api/staffing/roles/health");
    assert.strictEqual(canonical.status, 200);
    assert.deepStrictEqual(canonical.body, legacy.body);
  });
});

test("OPTIONS /roles responds 204 (CORS preflight compat)", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/roles`, { method: "OPTIONS" });
    assert.strictEqual(response.status, 204);
  });
});

test("GET /api/allowance-emails/preview returns the legacy unwrapped body", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/allowance-emails/preview");
    assert.strictEqual(status, 200);
    assert.strictEqual("data" in body, false);
    assert.strictEqual(typeof body.generated_at, "string");
    assert.strictEqual(body.targets.length, 2);
    assert.strictEqual(body.targets[0].pde_allowance_2026, 1800);
    assert.strictEqual(body.targets[1].ftb_balance, null);
    assert.deepStrictEqual(Object.keys(body.sources).sort(), ["book_2025", "morpheus", "pathways", "pde_policy"]);

    const alias = await requestJson(base, "/api/staffing/allowance-emails/preview");
    assert.strictEqual(alias.status, 200);
    assert.deepStrictEqual(alias.body.targets, body.targets);
  });
});

test("POST /api/allowance-emails/send defaults to dry_run previews", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/allowance-emails/send", {
      method: "POST",
      body: {},
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.dry_run, true);
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.sent, 0);
    const preview = body.results.find((result) => result.code === "PAS-001");
    assert.strictEqual(preview.status, "preview");
    assert.ok(preview.html.includes("Hi Example"));
    const skipped = body.results.find((result) => result.code === "PAS-002");
    assert.strictEqual(skipped.status, "skipped");
    assert.strictEqual(skipped.reason, "no email matched");
  });
});

test("POST /api/allowance-emails/send honours only_codes and test_to", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/allowance-emails/send", {
      method: "POST",
      body: { only_codes: ["PAS-002"], test_to: "test@example.org", subject: "Test subject" },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.results[0].status, "preview");
    assert.deepStrictEqual(body.results[0].to, ["test@example.org"]);
    assert.strictEqual(body.results[0].subject, "Test subject");
  });
});

test("POST /api/allowance-emails/send blocks live sends with legacy 500 {error}", async () => {
  await withServer(async (base) => {
    const gate1 = await requestJson(base, "/api/allowance-emails/send", {
      method: "POST",
      body: { dry_run: false },
    });
    assert.strictEqual(gate1.status, 500);
    assert.ok(gate1.body.error.includes("Live send disabled"));
    assert.strictEqual("code" in gate1.body, false);

    // Confirm token alone is not enough while the env gate is off.
    const gate2 = await requestJson(base, "/api/allowance-emails/send", {
      method: "POST",
      body: { dry_run: false, confirm: "SEND_PASTOR_ALLOWANCES" },
    });
    assert.strictEqual(gate2.status, 500);
    assert.ok(gate2.body.error.includes("Live send disabled"));
  });
});

test("unknown staffing route returns 404", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/staffing/does-not-exist");
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error, "not found");
  });
});
