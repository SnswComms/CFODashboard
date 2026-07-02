const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert");

// Force synthetic mode with an isolated (initially empty) MYOB cache dir so
// the UNAVAILABLE case can be exercised by dropping a summary-only cache in.
// Presence of the keys in process.env (even empty) prevents dotenv overrides.
const tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cash-test-myob-"));
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.PAYROLL_DIR = "";
process.env.REPORT_PACKS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MYOB_CACHE_DIR = tempCacheDir;

const { withServer, requestJson } = require("./helper");

test("GET /api/cash/position returns synthetic payload with masked targets", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/position");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "synthetic");
    assert.strictEqual(typeof body.meta.source_rule, "string");
    assert.strictEqual(typeof body.data.source_rule, "string");
    assert.strictEqual(typeof body.data.source_status, "string");
    assert.strictEqual(typeof body.data.cmf_status, "string");
    assert.ok(Array.isArray(body.data.cash_account_candidates));
    assert.strictEqual(body.data.recommended_myob_accounts.length, 5);
    const target = body.data.targets[0];
    assert.strictEqual(target.external_account, "•••• 1222");
    assert.strictEqual(target.myob_source, null);
    assert.strictEqual(target.myob_balance, null);
    assert.strictEqual(target.status, "awaiting MYOB endpoint match");
  });
});

test("GET /api/cash/position?unmasked=true reveals full external accounts", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/position?unmasked=true");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.targets[0].external_account, "032-000 111222");
  });
});

test("GET /api/cash/targets filters by system and validates the enum", async () => {
  await withServer(async (base) => {
    const cmf = await requestJson(base, "/api/cash/targets?system=CMF");
    assert.strictEqual(cmf.status, 200);
    assert.ok(cmf.body.data.targets.length > 0);
    assert.ok(cmf.body.data.targets.every((target) => target.system === "CMF"));

    const bad = await requestJson(base, "/api/cash/targets?system=NAB");
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.ok, false);
    assert.strictEqual(bad.body.code, "BAD_REQUEST");
  });
});

test("GET /api/cash/candidates coalesces account/description/balance fields", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/candidates");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.total, 4);
    assert.strictEqual(body.data.count, body.data.candidates.length);
    assert.strictEqual(body.data.limit, 30);
    const first = body.data.candidates[0];
    assert.strictEqual(first._endpoint, "CashAccount");
    assert.strictEqual(first.account, "111200");
    assert.strictEqual(typeof first.description, "string");
    assert.strictEqual(first.balance, 100000);
    assert.strictEqual(typeof first.raw, "object");

    const termDeposits = body.data.candidates.find((row) => row.account === "111500");
    assert.strictEqual(termDeposits.description, "Example Term deposits");
    assert.strictEqual(termDeposits.balance, 50000);

    const filtered = await requestJson(base, "/api/cash/candidates?endpoint=Account&limit=1");
    assert.strictEqual(filtered.status, 200);
    assert.strictEqual(filtered.body.data.total, 2);
    assert.strictEqual(filtered.body.data.candidates.length, 1);
    assert.ok(filtered.body.data.candidates.every((row) => row._endpoint === "Account"));
  });
});

test("GET /api/cash/cmf/summary strips lines and flags net movements", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/cmf/summary");
    assert.strictEqual(status, 200);
    assert.ok(!("lines" in body.data));
    assert.strictEqual(body.data.balances_by_account["111300"], 5000);
    assert.deepStrictEqual(body.data.target_accounts, ["111300"]);
    assert.ok(body.meta.warnings.some((warning) => warning.includes("net movements")));
  });
});

test("GET /api/cash/cmf/balances filters by account and validates groupBy", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/cmf/balances?account=111300");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.as_of, "2026-06-01T08:50:00+00:00");
    assert.deepStrictEqual(Object.keys(body.data.byAccount), ["111300"]);
    assert.ok(Array.isArray(body.data.byAccountSubaccount));
    assert.ok(body.data.byAccountSubaccount.every((row) => row.account === "111300"));

    const bad = await requestJson(base, "/api/cash/cmf/balances?groupBy=branch");
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.code, "BAD_REQUEST");
  });
});

test("GET /api/cash/cmf/lines paginates and filters journal lines", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/cash/cmf/lines");
    assert.strictEqual(all.status, 200);
    assert.strictEqual(all.body.data.total, 8);
    assert.strictEqual(all.body.data.limit, 100);
    assert.strictEqual(all.body.data.offset, 0);
    const line = all.body.data.lines[0];
    for (const key of ["date", "period", "batch", "reference", "account", "subaccount", "debit", "credit", "net_debit"]) {
      assert.ok(key in line, `line missing ${key}`);
    }

    const feb = await requestJson(base, "/api/cash/cmf/lines?account=111300&from=2026-02-01&to=2026-02-28");
    assert.strictEqual(feb.status, 200);
    assert.strictEqual(feb.body.data.total, 2);

    const paged = await requestJson(base, "/api/cash/cmf/lines?limit=3&offset=6");
    assert.strictEqual(paged.body.data.lines.length, 2);

    const badDate = await requestJson(base, "/api/cash/cmf/lines?from=notadate");
    assert.strictEqual(badDate.status, 400);
  });
});

test("GET /api/cash/movements/trend buckets lines by period", async () => {
  await withServer(async (base) => {
    const monthly = await requestJson(base, "/api/cash/movements/trend");
    assert.strictEqual(monthly.status, 200);
    assert.strictEqual(monthly.body.data.granularity, "month");
    assert.strictEqual(monthly.body.data.series.length, 3);
    const january = monthly.body.data.series[0];
    assert.deepStrictEqual(january, {
      period: "2026-01",
      net_debit: 6000,
      debit: 10000,
      credit: 4000,
      line_count: 2,
    });

    const daily = await requestJson(base, "/api/cash/movements/trend?granularity=day&from=2026-03-01");
    assert.strictEqual(daily.status, 200);
    assert.deepStrictEqual(
      daily.body.data.series.map((bucket) => bucket.period),
      ["2026-03-02", "2026-03-15", "2026-03-28"]
    );

    const weekly = await requestJson(base, "/api/cash/movements/trend?granularity=week");
    assert.strictEqual(weekly.status, 200);
    assert.ok(weekly.body.data.series.every((bucket) => /^\d{4}-W\d{2}$/.test(bucket.period)));

    const bad = await requestJson(base, "/api/cash/movements/trend?granularity=year");
    assert.strictEqual(bad.status, 400);
  });
});

test("GET /api/cash/probe serves a summary by default and full detail on request", async () => {
  await withServer(async (base) => {
    const summary = await requestJson(base, "/api/cash/probe");
    assert.strictEqual(summary.status, 200);
    assert.ok(summary.body.data.ok_endpoints.includes("CashAccount"));
    assert.strictEqual(summary.body.data.cash_account_candidate_count, 4);
    assert.ok(!("endpoints" in summary.body.data));

    const full = await requestJson(base, "/api/cash/probe?full=true");
    assert.strictEqual(full.status, 200);
    assert.strictEqual(typeof full.body.data.endpoints, "object");
    assert.strictEqual(full.body.data.endpoints.CashAccount.status, 200);
    assert.strictEqual(full.body.data.cash_account_candidates.length, 4);
  });
});

test("GET /api/cash/status rolls up source freshness", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/status");
    assert.strictEqual(status, 200);
    assert.ok(body.data.source_status.startsWith("MYOB cash endpoint probe"));
    assert.ok(body.data.cmf_status.startsWith("MYOB CMF cash extractor"));
    assert.strictEqual(body.data.probe.exists, true);
    assert.strictEqual(body.data.cmf.exists, true);
    assert.strictEqual(body.data.dataSource, "synthetic");
  });
});

test("GET /api/cash/nope returns 404", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/cash/nope");
    assert.strictEqual(status, 404);
    assert.strictEqual(body.code, "NOT_FOUND");
  });
});

test("GET /api/cash/cmf/lines is UNAVAILABLE when only the summary cache exists", async () => {
  const summaryDir = path.join(tempCacheDir, "cmf-cash");
  fs.mkdirSync(summaryDir, { recursive: true });
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "fixtures", "cash-cmf.json"), "utf8")
  );
  delete fixture.lines;
  fs.writeFileSync(path.join(summaryDir, "myob-cmf-cash-summary.json"), JSON.stringify(fixture));
  try {
    await withServer(async (base) => {
      const { status, body } = await requestJson(base, "/api/cash/cmf/lines");
      assert.strictEqual(status, 503);
      assert.strictEqual(body.code, "UNAVAILABLE");

      // Summary endpoint now serves the live cache instead of the fixture.
      const summary = await requestJson(base, "/api/cash/cmf/summary");
      assert.strictEqual(summary.status, 200);
      assert.strictEqual(summary.body.meta.dataSource, "live-cache");
    });
  } finally {
    fs.rmSync(summaryDir, { recursive: true, force: true });
  }
});
