// Force synthetic mode regardless of local .env contents. Presence of the
// keys in process.env (even empty) prevents dotenv from overriding them.
process.env.CFO_DATA_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";

const test = require("node:test");
const assert = require("node:assert");

const { withServer, requestJson } = require("./helper");

test("GET /api/myob/sources lists all four caches in synthetic mode", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/sources");
    assert.equal(status, 200);
    const keys = body.data.sources.map((source) => source.key).sort();
    assert.deepEqual(keys, ["benefits", "broad", "drilldowns", "live-gl"]);
    for (const source of body.data.sources) {
      assert.equal(source.exists, false);
      assert.equal(source.synthetic, true);
      assert.ok(source.generated_at);
    }
    assert.equal(body.meta.dataSource, "synthetic");
  });
});

test("GET /api/myob/accounts returns rollups, counts, and supports q filter", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/accounts");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "synthetic");
    assert.equal(body.data.limit, 220);
    assert.equal(body.data.counts.accounts, 3);
    assert.equal(body.data.counts.journals, 2);
    assert.ok(Array.isArray(body.data.accounts));
    const first = body.data.accounts[0];
    assert.equal(first.account, "703430");
    assert.equal(first.journal_lines, 2);
    assert.equal(first.journal_debit, 100);
    assert.equal(first.journal_credit, 40);
    assert.ok(first.examples.length <= 6);

    const filtered = await requestJson(base, "/api/myob/accounts?q=evangelism");
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.total, 1);
    assert.equal(filtered.body.data.accounts[0].account, "703430");

    const active = await requestJson(base, "/api/myob/accounts?activeOnly=true&hasActivity=true");
    assert.equal(active.status, 200);
    assert.deepEqual(
      active.body.data.accounts.map((row) => row.account).sort(),
      ["703100", "703430"]);
  });
});

test("GET /api/myob/accounts rejects a bad sort value", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/accounts?sort=bogus");
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "BAD_REQUEST");
  });
});

test("GET /api/myob/accounts/:code returns meta, rollup, and hasDrilldown", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/accounts/703430");
    assert.equal(status, 200);
    assert.equal(body.data.account, "703430");
    assert.equal(body.data.description, "Local church evangelism");
    assert.equal(body.data.hasDrilldown, true);
    assert.ok(body.data.examples.length <= 6);

    const noDrill = await requestJson(base, "/api/myob/accounts/101000");
    assert.equal(noDrill.status, 200);
    assert.equal(noDrill.body.data.hasDrilldown, false);
  });
});

test("GET /api/myob/accounts/:code validates digits and 404s on unknown accounts", async () => {
  await withServer(async (base) => {
    const bad = await requestJson(base, "/api/myob/accounts/abc123x");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "BAD_REQUEST");

    const missing = await requestJson(base, "/api/myob/accounts/999999");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");
  });
});

test("GET /api/myob/accounts/:code/drilldown returns the full drilldown or 404", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/accounts/703430/drilldown");
    assert.equal(status, 200);
    assert.equal(body.data.account, "703430");
    assert.equal(body.data.derived.bill_line_count, 1);
    assert.equal(body.data.derived.journal_net_debit, 60);
    assert.equal(body.data.journal_lines.length, 2);
    assert.equal(body.data.bill_lines[0].line.Account, "703430");

    const limited = await requestJson(base, "/api/myob/accounts/703430/drilldown?journalLimit=1");
    assert.equal(limited.status, 200);
    assert.equal(limited.body.data.journal_lines.length, 1);

    const missing = await requestJson(base, "/api/myob/accounts/999999/drilldown");
    assert.equal(missing.status, 404);

    const bad = await requestJson(base, "/api/myob/accounts/703430/drilldown?billLimit=-2");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/myob/accounts/:code/transactions flattens bill and journal rows", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/accounts/703430/transactions");
    assert.equal(status, 200);
    assert.equal(body.data.account, "703430");
    assert.equal(body.data.total, 3);
    for (const row of body.data.rows) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ["amount", "branch", "credit", "date", "debit", "description", "kind", "party", "project", "reference", "subaccount"]);
    }

    const journals = await requestJson(base, "/api/myob/accounts/703430/transactions?kind=journal");
    assert.equal(journals.status, 200);
    assert.equal(journals.body.data.total, 2);
    assert.ok(journals.body.data.rows.every((row) => row.kind === "journal"));

    const ranged = await requestJson(base, "/api/myob/accounts/703430/transactions?from=2025-08-01&to=2025-08-31");
    assert.equal(ranged.status, 200);
    assert.equal(ranged.body.data.total, 2);

    const bad = await requestJson(base, "/api/myob/accounts/703430/transactions?kind=bogus");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/myob/drilldowns merges key-account labels across both writer shapes", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/drilldowns");
    assert.equal(status, 200);
    assert.equal(body.data.items.length, 2);
    const evangelism = body.data.items.find((item) => item.account === "703430");
    assert.equal(evangelism.label, "Local church evangelism");
    assert.equal(evangelism.journal_net, 60);
    // Fast-writer shaped item (no label field) still gets the ported constant label.
    const catering = body.data.items.find((item) => item.account === "703100");
    assert.equal(catering.label, "Catering");
    assert.equal(catering.bill_total, 500);
  });
});

test("GET /api/myob/entities/:entity normalizes alt-key fallbacks", async () => {
  await withServer(async (base) => {
    const vendors = await requestJson(base, "/api/myob/entities/vendor");
    assert.equal(vendors.status, 200);
    assert.equal(vendors.body.data.entity, "vendor");
    assert.equal(vendors.body.data.ok, true);
    assert.equal(vendors.body.data.total, 2);
    const altVendor = vendors.body.data.rows.find((row) => row.VendorID === "V-0002");
    assert.equal(altVendor.VendorName, "Example Vendor B");
    assert.equal(altVendor.Status, true);

    const journals = await requestJson(base, "/api/myob/entities/journal");
    assert.equal(journals.status, 200);
    const second = journals.body.data.rows.find((row) => row.BatchNbr === "GJ-0002");
    assert.equal(second.BranchID, "SOUTH");
    const altLine = journals.body.data.rows
      .find((row) => row.BatchNbr === "GJ-0001")
      .Details.find((line) => line.Account === "703100");
    assert.equal(altLine.DebitAmount, 60);

    const bills = await requestJson(base, "/api/myob/entities/bill?vendor=vendor%20b");
    assert.equal(bills.status, 200);
    assert.equal(bills.body.data.total, 1);
    assert.equal(bills.body.data.rows[0].ReferenceNbr, "BILL-0002");

    const bad = await requestJson(base, "/api/myob/entities/bogus");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/myob/broad/summary and /broad/branches compute broad KPIs", async () => {
  await withServer(async (base) => {
    const summary = await requestJson(base, "/api/myob/broad/summary");
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.base_endpoint_family, "Default/20.200.001");
    assert.equal(summary.body.data.endpoint_counts.Account.count, 3);
    assert.equal(summary.body.data.kpis.accounts_active, 2);
    assert.equal(summary.body.data.kpis.journal_lines, 3);
    assert.equal(summary.body.data.kpis.bill_total, 750);
    assert.equal(summary.body.data.kpis.payment_total, 500);

    const branches = await requestJson(base, "/api/myob/broad/branches");
    assert.equal(branches.status, 200);
    assert.deepEqual(branches.body.data.branches, [
      { branch: "MAIN", journal_txns: 1 },
      { branch: "SOUTH", journal_txns: 1 },
    ]);
  });
});

test("GET /api/myob/gl/summary derives line counts from the cache", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/gl/summary");
    assert.equal(status, 200);
    assert.equal(body.data.from_date, "2026-01-01");
    assert.deepEqual(body.data.line_counts, { accounts: 3, journal_lines: 4, bill_lines: 2 });
    assert.equal(body.data.endpoint_status.JournalTransaction.journals_scanned, 4);
  });
});

test("GET /api/myob/gl/accounts filters by search, class, and active", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/myob/gl/accounts");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.count, 3);
    assert.equal(all.body.data.accounts[0].AccountCD, "703430");

    const inactive = await requestJson(base, "/api/myob/gl/accounts?active=false");
    assert.equal(inactive.status, 200);
    assert.equal(inactive.body.data.count, 1);
    assert.equal(inactive.body.data.accounts[0].AccountCD, "707100");

    const bad = await requestJson(base, "/api/myob/gl/accounts?active=maybe");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/myob/gl/lines filters and totals line records", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/myob/gl/lines");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.count, 6);
    assert.deepEqual(all.body.data.totals, { debit: 990, credit: 40, net_debit: 950 });

    const account = await requestJson(base, "/api/myob/gl/lines?account=703430&kind=journal");
    assert.equal(account.status, 200);
    assert.equal(account.body.data.count, 2);
    assert.deepEqual(account.body.data.totals, { debit: 100, credit: 40, net_debit: 60 });

    const prefix = await requestJson(base, "/api/myob/gl/lines?accountPrefix=707");
    assert.equal(prefix.status, 200);
    assert.equal(prefix.body.data.count, 1);

    const period = await requestJson(base, "/api/myob/gl/lines?period=012026&branch=MAIN");
    assert.equal(period.status, 200);
    assert.equal(period.body.data.count, 3);

    const bad = await requestJson(base, "/api/myob/gl/lines?kind=bogus");
    assert.equal(bad.status, 400);

    const badDate = await requestJson(base, "/api/myob/gl/lines?from=01-01-2026");
    assert.equal(badDate.status, 400);
  });
});

test("GET /api/myob/gl/periods groups by PostPeriod", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/gl/periods");
    assert.equal(status, 200);
    assert.equal(body.data.periods.length, 2);
    const january = body.data.periods.find((period) => period.period === "012026");
    assert.equal(january.lines, 3);
    assert.equal(january.net_debit, 660);
    assert.equal(january.earliest_date, "2026-01-10");
    assert.equal(january.latest_date, "2026-01-25");
  });
});

test("GET /api/myob/gl/activity groups by account, branch, or period", async () => {
  await withServer(async (base) => {
    const byAccount = await requestJson(base, "/api/myob/gl/activity");
    assert.equal(byAccount.status, 200);
    const evangelism = byAccount.body.data.groups.find((group) => group.key === "703430");
    assert.equal(evangelism.lines, 3);
    assert.equal(evangelism.net_debit, 310);
    assert.equal(evangelism.account_description, "Local church evangelism");

    const byBranch = await requestJson(base, "/api/myob/gl/activity?groupBy=branch");
    assert.equal(byBranch.status, 200);
    const main = byBranch.body.data.groups.find((group) => group.key === "MAIN");
    assert.equal(main.lines, 4);

    const bad = await requestJson(base, "/api/myob/gl/activity?groupBy=bogus");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/myob/benefits/summary returns the derived block", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/benefits/summary");
    assert.equal(status, 200);
    assert.equal(body.data.read_only_policy, "GET-only");
    assert.equal(body.data.derived.account_balance, 5000);
    assert.equal(body.data.derived.recent_transaction_count, 4);
  });
});

test("GET /api/myob/benefits/employees lists and searches employees", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/myob/benefits/employees");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.count, 2);
    const first = all.body.data.employees.find((employee) => employee.code === "E001");
    assert.equal(first.name, "Example Pastor A");
    assert.equal(first.role_or_church, "Example Church North");
    assert.equal(first.totals.balance, 300);
    assert.equal(first.ledger_ok, true);
    const second = all.body.data.employees.find((employee) => employee.code === "E002");
    assert.equal(second.ledger_ok, false);

    const searched = await requestJson(base, "/api/myob/benefits/employees?search=pastor%20b");
    assert.equal(searched.status, 200);
    assert.equal(searched.body.data.count, 1);
    assert.equal(searched.body.data.employees[0].code, "E002");
  });
});

test("GET /api/myob/benefits/employees/:code returns the drilldown or 404", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/benefits/employees/E001");
    assert.equal(status, 200);
    assert.equal(body.data.identity.name, "Example Pastor A");
    assert.equal(body.data.summary.totals.transaction_count, 2);
    assert.equal(body.data.ledger.entries.length, 2);

    const missing = await requestJson(base, "/api/myob/benefits/employees/E999");
    assert.equal(missing.status, 404);
  });
});

test("GET /api/myob/benefits/transactions filters and totals", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/myob/benefits/transactions");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.count, 4);
    assert.equal(all.body.data.total_debit, 350);
    assert.equal(all.body.data.total_credit, 75);

    const filtered = await requestJson(base, "/api/myob/benefits/transactions?employee_code=E001");
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.count, 2);
    assert.equal(filtered.body.data.total_debit, 300);

    const byCategory = await requestJson(base, "/api/myob/benefits/transactions?category=Adjustment");
    assert.equal(byCategory.status, 200);
    assert.equal(byCategory.body.data.count, 1);
    assert.equal(byCategory.body.data.total_credit, 75);

    const paged = await requestJson(base, "/api/myob/benefits/transactions?limit=2&offset=2");
    assert.equal(paged.status, 200);
    assert.equal(paged.body.data.transactions.length, 2);
    assert.equal(paged.body.data.total, 4);
  });
});

test("GET /api/myob/benefits/categories returns the rollup sorted by count", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/benefits/categories");
    assert.equal(status, 200);
    assert.equal(body.data.categories.length, 3);
    assert.equal(body.data.categories[0].category, "Book allowance");
    assert.equal(body.data.categories[0].count, 2);
    assert.equal(body.data.categories[0].debit, 150);
  });
});
