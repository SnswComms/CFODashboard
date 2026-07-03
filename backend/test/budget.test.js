const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Point writable/live dirs at a temp workspace BEFORE the app (and config) load.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "budget-test-"));
const dashboardsDir = path.join(tempRoot, "dashboards");
const reportPacksDir = path.join(tempRoot, "report-packs");
fs.mkdirSync(dashboardsDir, { recursive: true });
process.env.DASHBOARDS_DIR = dashboardsDir;
process.env.REPORT_PACKS_DIR = reportPacksDir;

// Seed one synthetic report pack so listing/download paths are exercised.
const packId = "20260101-120000";
const packDir = path.join(reportPacksDir, "department-budget", packId);
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(
  path.join(packDir, "department-summary.csv"),
  "department,budget,actual_spend,remaining,used_pct,status,source_basis\nFIELD,3177120,0,3177120,,ok,synthetic\n"
);
fs.writeFileSync(
  path.join(packDir, "department-lines.csv"),
  "department,line,budget,actual_spend,remaining,transaction_count,source,line_id\n"
);
fs.writeFileSync(
  path.join(packDir, "department-evidence-sample.csv"),
  "line_id,department,line,date,period,reference,batch,account,subaccount,vendor_customer,description,net_debit,source_endpoint\n"
);
fs.writeFileSync(
  path.join(packDir, "source-manifest.json"),
  JSON.stringify({
    generated_at: "2026-01-01T12:00:00",
    period_context: { source_kind: "myob_live_gl_cache" },
    files: { department_summary_csv: "department-summary.csv" },
  })
);

const { withServer, requestJson } = require("./helper");

test("GET /api/budget/approved returns the approved constants", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/approved");
    assert.equal(status, 200);
    assert.equal(body.data.totals.income, 8032932);
    assert.equal(body.data.totals.expense, 7896544);
    assert.equal(body.data.totals.net, 136388);
    assert.ok(Array.isArray(body.data.top_expense_budget));
    assert.deepEqual(body.data.top_expense_budget[0], ["Field Expense", 3177120]);
    assert.deepEqual(body.data.top_income_budget[0], ["Tithe available for use", 4086524]);
    assert.equal(body.data.function_budgets.FIELD, 3177120);
    assert.equal(body.data.department_budgets["PERSONAL MINISTRIES / DEPARTMENT LIAISONS"], 52750);
    assert.deepEqual(body.data.department_lines.EVANGELISM, [{ line: "Pastoral & Lay Outreach", budget: 62000 }]);
    assert.equal(body.data.lane_budgets.president_discretionary, 20000);
    assert.equal(typeof body.data.basis, "string");
  });
});

test("GET /api/budget/conference returns the full dashboard envelope", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/conference");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "synthetic");
    for (const key of ["generated_at", "budget", "summary", "detail", "decision_cards", "health"]) {
      assert.ok(key in body.data, `missing ${key}`);
    }
    assert.equal(body.data.budget.annual.income, 8032932);
    assert.ok(Array.isArray(body.data.budget.top_expense_budget[0]));
    assert.equal(body.data.budget.top_expense_budget[0].length, 2);
    assert.ok(Array.isArray(body.data.detail.functions));
    assert.equal(body.data.decision_cards.length, 4);
  });
});

test("GET /api/budget/conference/health returns the health envelope", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/conference/health");
    assert.equal(status, 200);
    assert.ok(["OK", "WARN", "ERROR"].includes(body.data.status));
    assert.ok(Array.isArray(body.data.warnings));
    assert.ok(Array.isArray(body.data.errors));
  });
});

test("GET /api/budget/conference/functions supports status filter and pagination", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/budget/conference/functions");
    assert.equal(all.status, 200);
    assert.ok(all.body.data.functions.length > 0);
    assert.equal(typeof all.body.data.total, "number");

    const over = await requestJson(base, "/api/budget/conference/functions?status=over");
    assert.equal(over.status, 200);
    assert.ok(over.body.data.functions.every((f) => f.expense_remaining < 0));
    assert.ok(over.body.data.functions.some((f) => f.name === "EVANGELISM"));

    const tight = await requestJson(base, "/api/budget/conference/functions?status=tight&sort=used_pct");
    assert.equal(tight.status, 200);
    assert.ok(tight.body.data.functions.every((f) => (f.used_pct ?? 0) >= 85));

    const limited = await requestJson(base, "/api/budget/conference/functions?limit=2&offset=1");
    assert.equal(limited.body.data.functions.length, 2);
    assert.equal(limited.body.data.offset, 1);
  });
});

test("GET /api/budget/conference/functions rejects bad status", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/conference/functions?status=bogus");
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "BAD_REQUEST");
  });
});

test("GET /api/budget/conference/decision-cards recomputes with ?request", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/budget/conference/decision-cards");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.length, 4);

    const one = await requestJson(base, "/api/budget/conference/decision-cards?id=youth&request=200000");
    assert.equal(one.status, 200);
    assert.equal(one.body.data.length, 1);
    const card = one.body.data[0];
    assert.equal(card.id, "youth");
    assert.equal(card.example_request, 200000);
    assert.equal(card.after_request, card.remaining - 200000);
    assert.equal(card.status, "Not affordable in lane");
    assert.equal(card.status_class, "bad");

    const missing = await requestJson(base, "/api/budget/conference/decision-cards?id=nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");

    const badRequest = await requestJson(base, "/api/budget/conference/decision-cards?request=abc");
    assert.equal(badRequest.status, 400);
  });
});

test("GET /api/budget/summary returns the 9-key actual block", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/summary");
    assert.equal(status, 200);
    const keys = [
      "conference_income", "conference_expense", "conference_net",
      "aav_income", "aav_expense", "aav_net",
      "overall_income", "overall_expense", "overall_net",
    ];
    for (const key of keys) assert.equal(typeof body.data.actual[key], "number");
    assert.ok(Array.isArray(body.data.cash_rows));
    assert.ok("source" in body.data && "modified" in body.data);
  });
});

test("GET /api/budget/departments falls back to approved-constant synthetic seed", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/departments");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "synthetic");
    assert.equal(body.data.departments.length, 12);
    const field = body.data.departments.find((d) => d.name === "FIELD");
    assert.equal(field.budget, 3177120);
    assert.equal(field.spent, 0);
    assert.equal(field.used_pct, null);
    assert.equal(field.status, "ok");
    assert.ok(body.data.period_context.budget_year === "2026");

    const filtered = await requestJson(base, "/api/budget/departments?q=faith");
    assert.equal(filtered.body.data.departments.length, 1);
    assert.equal(filtered.body.data.departments[0].name, "FAITH FM ADMINISTRATION");

    const okOnly = await requestJson(base, "/api/budget/departments?status=over");
    assert.equal(okOnly.body.data.departments.length, 0);

    const badSource = await requestJson(base, "/api/budget/departments?source=bogus");
    assert.equal(badSource.status, 400);
  });
});

test("GET /api/budget/departments prefers a current MYOB report in auto mode", async () => {
  const myobFile = path.join(dashboardsDir, "department-budget-myob-data.json");
  fs.writeFileSync(
    myobFile,
    JSON.stringify({
      generated_at: "2026-06-30T10:00:00",
      source: "test myob",
      source_modified: null,
      period_context: {
        budget_year: "2026",
        source_kind: "myob_live_gl_cache",
        actual_period_label: "MYOB actuals 2026-01-01 to 2026-06-30",
      },
      departments: [
        {
          name: "FIELD", budget: 3177120, spent: 1500000, remaining: 1677120,
          used_pct: 47.2, status: "ok", income_budget: 0, income_actual: 0, lines: [],
        },
      ],
      summary: { income: 0, spend: 1500000, net: 0, cash: [] },
      mapping: {
        subaccount_prefix_to_department: { FLD: "FIELD" },
        unmapped_prefix_totals: { ZZZ: 12.5 },
        excluded_non_expense_account_totals: {},
        notes: ["test"],
      },
    })
  );
  try {
    await withServer(async (base) => {
      const auto = await requestJson(base, "/api/budget/departments");
      assert.equal(auto.status, 200);
      assert.equal(auto.body.meta.dataSource, "live-cache");
      assert.equal(auto.body.data.departments.length, 1);
      assert.equal(auto.body.data.departments[0].spent, 1500000);

      const velixo = await requestJson(base, "/api/budget/departments?source=velixo");
      assert.equal(velixo.body.meta.dataSource, "synthetic");
      assert.equal(velixo.body.data.departments.length, 12);

      const mapping = await requestJson(base, "/api/budget/departments/mapping");
      assert.equal(mapping.status, 200);
      assert.equal(mapping.body.data.subaccount_prefix_to_department.FLD, "FIELD");
      assert.equal(mapping.body.data.unmapped_prefix_totals.ZZZ, 12.5);
    });
  } finally {
    fs.unlinkSync(myobFile);
  }
});

test("GET /api/budget/departments skips a degraded MYOB report in auto mode", async () => {
  const myobFile = path.join(dashboardsDir, "department-budget-myob-data.json");
  fs.writeFileSync(
    myobFile,
    JSON.stringify({
      generated_at: "2026-06-30T10:00:00",
      source: "test myob",
      source_modified: null,
      period_context: {
        budget_year: "2026",
        source_kind: "myob_live_gl_cache",
        source_errors: ["JournalTransaction: HTTP 500"],
        confidence: "degraded",
        actual_period_label: "MYOB actuals 2026-01-01 to 2026-06-30",
      },
      departments: [
        {
          name: "FIELD", budget: 3177120, spent: 1, remaining: 3177119,
          used_pct: 0, status: "ok", income_budget: 0, income_actual: 0, lines: [],
        },
      ],
      summary: { income: 0, spend: 1, net: 0, cash: [] },
    })
  );
  try {
    await withServer(async (base) => {
      // embedded sync errors mark the report not-current: auto falls back
      const auto = await requestJson(base, "/api/budget/departments");
      assert.equal(auto.status, 200);
      assert.equal(auto.body.meta.dataSource, "synthetic");
      assert.equal(auto.body.data.departments.length, 12);

      // explicit ?source=myob still serves the degraded file for inspection
      const explicit = await requestJson(base, "/api/budget/departments?source=myob");
      assert.equal(explicit.body.meta.dataSource, "live-cache");
      assert.equal(explicit.body.data.departments[0].spent, 1);
      assert.equal(explicit.body.data.period_context.confidence, "degraded");
    });
  } finally {
    fs.unlinkSync(myobFile);
  }
});

test("GET /api/budget/departments/mapping falls back to constants", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/departments/mapping");
    assert.equal(status, 200);
    assert.equal(body.data.subaccount_prefix_to_department.FLD, "FIELD");
    assert.equal(body.data.subaccount_prefix_to_department.DEP, "PERSONAL MINISTRIES / DEPARTMENT LIAISONS");
    assert.deepEqual(body.data.unmapped_prefix_totals, {});
    assert.ok(Array.isArray(body.data.notes));
  });
});

test("GET /api/budget/departments/pace computes elapsed-year pace", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/departments/pace?month=6");
    assert.equal(status, 200);
    const field = body.data.find((row) => row.name === "FIELD");
    assert.equal(field.expected_at_elapsed, 3177120 * 0.5);
    assert.equal(field.pace_variance, 3177120 * 0.5);
    assert.match(field.pace_label, /under elapsed-year pace/);
    assert.equal(typeof field.current_pace_target, "number");

    const defaulted = await requestJson(base, "/api/budget/departments/pace");
    assert.equal(defaulted.status, 200);
    // Fixture actual_period_label mentions May => 5/12 elapsed.
    const fieldDefault = defaulted.body.data.find((row) => row.name === "FIELD");
    assert.equal(fieldDefault.expected_at_elapsed, (3177120 * 5) / 12);

    const bad = await requestJson(base, "/api/budget/departments/pace?month=13");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/budget/departments/:slug matches slug or encoded name", async () => {
  await withServer(async (base) => {
    const bySlug = await requestJson(base, "/api/budget/departments/personal-ministries-department-liaisons");
    assert.equal(bySlug.status, 200);
    assert.equal(bySlug.body.data.name, "PERSONAL MINISTRIES / DEPARTMENT LIAISONS");
    assert.ok(Array.isArray(bySlug.body.data.lines));

    const byName = await requestJson(base, "/api/budget/departments/" + encodeURIComponent("FAITH FM ADMINISTRATION"));
    assert.equal(byName.status, 200);
    assert.equal(byName.body.data.name, "FAITH FM ADMINISTRATION");

    const missing = await requestJson(base, "/api/budget/departments/nonexistent-department");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");
  });
});

test("GET /api/budget/report-packs lists packs newest first", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/budget/report-packs");
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, packId);
    assert.equal(body.data[0].generated_at, "2026-01-01T12:00:00");
    assert.equal(body.data[0].source_kind, "myob_live_gl_cache");
  });
});

test("GET /api/budget/report-packs/:id/:file streams whitelisted files", async () => {
  await withServer(async (base) => {
    const direct = await fetch(`${base}/api/budget/report-packs/${packId}/department-summary.csv`);
    assert.equal(direct.status, 200);
    assert.match(direct.headers.get("content-type"), /text\/csv/);
    const text = await direct.text();
    assert.match(text, /^department,budget/);

    const latest = await fetch(`${base}/api/budget/report-packs/latest/source-manifest.json`);
    assert.equal(latest.status, 200);
    assert.match(latest.headers.get("content-type"), /application\/json/);

    const badFile = await requestJson(base, `/api/budget/report-packs/${packId}/..%2Fsecret.txt`);
    assert.equal(badFile.status, 400);

    const badId = await requestJson(base, "/api/budget/report-packs/not-an-id/department-summary.csv");
    assert.equal(badId.status, 400);

    const missingPack = await requestJson(base, "/api/budget/report-packs/19990101-000000/department-summary.csv");
    assert.equal(missingPack.status, 404);
  });
});

test("GET/POST /api/budget/projections/field persists projections", async () => {
  await withServer(async (base) => {
    const empty = await requestJson(base, "/api/budget/projections/field");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data.savedAt, null);
    assert.deepEqual(empty.body.data.field, {});

    const saved = await requestJson(base, "/api/budget/projections/field", {
      method: "POST",
      body: { field: { "Wages Taxable": 1064871, "Removal": 70000 } },
    });
    assert.equal(saved.status, 200);
    assert.ok(saved.body.data.savedAt);
    assert.equal(saved.body.data.field["Wages Taxable"], 1064871);

    const fetched = await requestJson(base, "/api/budget/projections/field");
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.field["Removal"], 70000);
    assert.equal(fetched.body.data.savedAt, saved.body.data.savedAt);

    const invalid = await requestJson(base, "/api/budget/projections/field", {
      method: "POST",
      body: { field: { "Wages Taxable": "lots" } },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "BAD_REQUEST");

    const noField = await requestJson(base, "/api/budget/projections/field", {
      method: "POST",
      body: { other: 1 },
    });
    assert.equal(noField.status, 400);
  });
});
