// Force synthetic mode BEFORE the app/config load so the sync status/start
// endpoints see no configured cache dir. Presence of the keys in process.env
// prevents dotenv from overriding them. No test here ever touches the network:
// the builders are pure and startSync fails fast without MYOB_CACHE_DIR.
process.env.CFO_DATA_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";

const test = require("node:test");
const assert = require("node:assert");

const { withServer, requestJson } = require("./helper");
const { buildQuery } = require("../src/lib/myobClient");
const sync = require("../src/services/myobSyncService");
const repository = require("../src/repositories/myobCacheRepository");
const { KEY_ACCOUNT_LABELS } = require("../src/constants/keyAccounts");

// Flattened live-gl line factory (the shape flattenJournalLines emits) for
// the benefits/cash builder tests.
const flatLine = (overrides) => ({
  kind: "JournalTransaction", date: "2026-05-10", period: "112026", branch: "SNC", module: "GL",
  batch: "GJ-1", reference: "GJ-1", account: "312510", account_description: "Employee benefits",
  subaccount: "BEN-SMIT01", project: "", vendor_customer: "", header_description: "Benefits journal",
  line_description: "", debit: 0, credit: 0, net_debit: 0, source_endpoint: "JournalTransaction",
  ...overrides,
});

// Raw journal as MYOB returns it: every scalar {value}-wrapped, with the
// field-name variants seen across rows (Branch/DebitAmt/AccountID/Descr).
const RAW_JOURNALS = [
  {
    TransactionDate: { value: "2025-08-15T00:00:00+00:00" },
    BatchNbr: { value: "GJ-2001" },
    Branch: { value: "SNC" },
    Module: { value: "GL" },
    PostPeriod: { value: "022026" },
    Description: { value: "August payroll journal" },
    custom: {},
    _links: {},
    Details: [
      {
        AccountID: { value: "703430" },
        DebitAmt: { value: 120.5 },
        Subaccount: { value: "EVA-000" },
        TransactionDescription: { value: "Evangelism supplies" },
      },
      {
        Account: { value: "111300" },
        CreditAmount: { value: 120.5 },
        Subaccount: { value: "ADM-000" },
        Descr: { value: "CMF settlement" },
      },
    ],
  },
];

const CHART = [
  { AccountCD: "703430", Description: "Local church evangelism", Type: "Expense", AccountClass: "EXPENSE" },
  { AccountCD: "410100", Description: "Tithe income", Type: "Income", AccountClass: "INCOME" },
  { AccountCD: "111300", Description: "Cash Management Facility", Type: "Asset", AccountClass: "CASHASSET" },
];

test("buildQuery pre-encodes OData apostrophes as %27 exactly once", () => {
  const query = buildQuery({
    $top: 500,
    $expand: "Details",
    $filter: "TransactionDate ge datetimeoffset'2025-07-01'",
  });
  assert.equal(query, "?$top=500&$expand=Details&$filter=TransactionDate%20ge%20datetimeoffset%272025-07-01%27");
});

test("flattenJournalLines unwraps {value} wrappers and coalesces field variants", () => {
  const lines = sync.flattenJournalLines(RAW_JOURNALS, { 703430: "Local church evangelism" });
  assert.equal(lines.length, 2);

  const [debitLine, creditLine] = lines;
  assert.deepEqual(debitLine, {
    kind: "JournalTransaction",
    date: "2025-08-15",
    period: "022026",
    branch: "SNC",
    module: "GL",
    batch: "GJ-2001",
    reference: "GJ-2001",
    account: "703430",
    account_description: "Local church evangelism",
    subaccount: "EVA-000",
    project: "",
    vendor_customer: "",
    header_description: "August payroll journal",
    line_description: "Evangelism supplies",
    debit: 120.5,
    credit: 0,
    net_debit: 120.5,
    source_endpoint: "JournalTransaction",
  });
  assert.equal(creditLine.account, "111300");
  assert.equal(creditLine.credit, 120.5);
  assert.equal(creditLine.net_debit, -120.5);
  assert.equal(creditLine.line_description, "CMF settlement");
});

test("periodMMYYYY keeps MMYYYY and normalizes YYYYMM tenants", () => {
  assert.equal(sync.periodMMYYYY("022026"), "022026");
  assert.equal(sync.periodMMYYYY("202602"), "022026");
  assert.equal(sync.periodMMYYYY(""), "");
});

test("defaultFromDate is the previous July 1 (AU financial year start)", () => {
  assert.equal(sync.defaultFromDate(new Date("2026-07-02T00:00:00")), "2026-07-01");
  assert.equal(sync.defaultFromDate(new Date("2026-03-15T00:00:00")), "2025-07-01");
});

test("buildCmfDocument sums net movements per target account and subaccount", () => {
  const journalLines = [
    ...sync.flattenJournalLines(RAW_JOURNALS),
    {
      kind: "JournalTransaction", date: "2025-09-01", period: "032026", branch: "SNC", module: "GL",
      batch: "GJ-2002", reference: "GJ-2002", account: "111300", account_description: "",
      subaccount: "FLD-000", project: "", vendor_customer: "", header_description: "",
      line_description: "Deposit", debit: 1000, credit: 0, net_debit: 1000, source_endpoint: "JournalTransaction",
    },
  ];
  const doc = sync.buildCmfDocument(journalLines, {
    targetAccounts: ["111300"],
    accounts: CHART,
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2025-07-01",
    toDate: "2025-09-01",
    journalsScanned: 2,
  });
  assert.deepEqual(doc.target_accounts, ["111300"]);
  assert.equal(doc.line_count, 2);
  assert.equal(doc.journals_scanned, 2);
  assert.deepEqual(doc.balances_by_account, { 111300: 879.5 });
  assert.deepEqual(doc.balances_by_account_subaccount, [
    { account: "111300", subaccount: "ADM-000", net_debit: -120.5 },
    { account: "111300", subaccount: "FLD-000", net_debit: 1000 },
  ]);
  assert.equal(doc.accounts.length, 1);
  assert.equal(doc.accounts[0].AccountCD, "111300");
  // lines carry the CMF shape (no kind/account_description keys)
  assert.deepEqual(
    Object.keys(doc.lines[0]).sort(),
    ["account", "batch", "credit", "date", "debit", "header_description", "line_description", "net_debit", "period", "reference", "subaccount"]
  );
});

test("buildDepartmentReport groups expense lines by subaccount prefix", () => {
  const glLine = (overrides) => ({
    kind: "JournalTransaction", date: "2025-08-01", period: "022026", branch: "SNC", module: "GL",
    batch: "GJ-1", reference: "GJ-1", account: "703430", account_description: "Local church evangelism",
    subaccount: "EVA-000", project: "", vendor_customer: "", header_description: "",
    line_description: "", debit: 0, credit: 0, net_debit: 0, source_endpoint: "JournalTransaction",
    ...overrides,
  });
  const lines = [
    glLine({ debit: 100, net_debit: 100 }),                                             // EVA -> EVANGELISM
    glLine({ subaccount: "FLD-000", debit: 200, net_debit: 200 }),                      // FLD -> FIELD
    glLine({ subaccount: "XYZ-000", debit: 50, net_debit: 50 }),                        // unmapped prefix
    glLine({ account: "410100", subaccount: "ADM-000", credit: 500, net_debit: -500 }), // income
    glLine({ account: "111300", subaccount: "ADM-000", debit: 25, net_debit: 25 }),     // asset -> excluded
  ];
  const report = sync.buildDepartmentReport(lines, CHART, {
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2025-07-01",
    toDate: "2026-06-30",
  });

  assert.equal(report.period_context.source_kind, "myob_live_gl_cache");
  assert.equal(report.period_context.actual_period_label, "Jun 2026 actuals to date (MYOB live GL cache)");

  const byName = Object.fromEntries(report.departments.map((department) => [department.name, department]));
  // every approved department is present even with no activity
  assert.equal(report.departments.length, Object.keys(byName).length);
  assert.ok(byName["BIG CAMP"]);
  assert.equal(byName["BIG CAMP"].spent, 0);

  const evangelism = byName["EVANGELISM"];
  assert.equal(evangelism.budget, 62000);
  assert.equal(evangelism.spent, 100);
  assert.equal(evangelism.remaining, 61900);
  assert.equal(evangelism.status, "ok");
  assert.deepEqual(evangelism.lines, [
    { line: "703430 Local church evangelism", account: "703430", budget: null, spent: 100, remaining: null, line_count: 1 },
  ]);

  assert.equal(byName["FIELD"].spent, 200);
  assert.equal(byName["ADMINISTRATION"].income_actual, 500);

  assert.deepEqual(report.mapping.unmapped_prefix_totals, { XYZ: 50 });
  assert.deepEqual(report.mapping.excluded_non_expense_account_totals, { 111300: 25 });
  assert.deepEqual(report.mapping.subaccount_prefix_to_department, require("../src/constants/approvedBudget").PREFIX_TO_DEPT);
  assert.deepEqual(report.summary, { income: 500, spend: 350, net: 150, cash: [] });
});

test("buildBroadCache keeps rows raw and names the journal sample key from the from date", () => {
  const accountRecord = {
    ok: true,
    status: 200,
    count: 1,
    rows: [{ AccountCD: { value: "703430" }, Description: { value: "Local church evangelism" } }],
  };
  const doc = sync.buildBroadCache({
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2026-07-01",
    entityRecords: { Account: accountRecord },
    rawJournals: RAW_JOURNALS,
  });

  // rows are stored exactly as MYOB returned them ({value} wrappers intact)
  assert.equal(doc.endpoints.Account.rows[0].AccountCD.value, "703430");
  const sample = doc.endpoints.JournalTransaction_since_2026_07_01_sample;
  assert.deepEqual({ ok: sample.ok, status: sample.status, count: sample.count }, { ok: true, status: 200, count: 1 });
  assert.equal(sample.rows[0].BatchNbr.value, "GJ-2001");

  // sample cap applies
  const capped = sync.buildBroadCache({
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2026-07-01",
    entityRecords: {},
    rawJournals: [...RAW_JOURNALS, ...RAW_JOURNALS],
    journalSampleCap: 1,
  });
  assert.equal(capped.endpoints.JournalTransaction_since_2026_07_01_sample.count, 1);
});

test("loadBroad normalizer renames the journal sample key to the canonical one myobService matches", () => {
  const doc = sync.buildBroadCache({
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2026-07-01",
    entityRecords: {},
    rawJournals: RAW_JOURNALS,
  });
  const normalized = repository.normalizeBroadCache(doc);
  assert.equal(repository.CANONICAL_JOURNAL_SAMPLE_KEY, "JournalTransaction_since_2025_07_01_sample");
  assert.ok(normalized.endpoints[repository.CANONICAL_JOURNAL_SAMPLE_KEY]);
  assert.equal(normalized.endpoints[repository.CANONICAL_JOURNAL_SAMPLE_KEY].rows[0].BatchNbr.value, "GJ-2001");
  assert.equal(normalized.endpoints.JournalTransaction_since_2026_07_01_sample, undefined);

  // no-op when the canonical key is already present (fixture shape)
  const canonical = { endpoints: { [repository.CANONICAL_JOURNAL_SAMPLE_KEY]: { ok: true, rows: [] } } };
  assert.equal(repository.normalizeBroadCache(canonical), canonical);
});

test("buildBenefitsCache derives 312510 sums with the as-of cutoff but keeps raw transactions complete", () => {
  const lines = [
    flatLine({ date: "2026-05-10", vendor_customer: "Smith, John", line_description: "Book purchase", debit: 100, net_debit: 100 }),
    flatLine({ date: "2026-06-01", line_description: "Travel reimbursement", debit: 200, net_debit: 200 }),
    flatLine({ date: "2026-06-15", subaccount: "BEN-JONE02", vendor_customer: "Jones, Amy", line_description: "Monthly benefit contribution", credit: 250, net_debit: -250 }),
    // post-dated: stays in the raw transaction list but never in derived sums
    flatLine({ date: "2026-08-01", line_description: "Book purchase (post-dated)", debit: 40, net_debit: 40 }),
    // other account: not part of the benefits scope at all
    flatLine({ account: "703430", date: "2026-06-20", line_description: "Book purchase", debit: 999, net_debit: 999 }),
  ];
  const doc = sync.buildBenefitsCache(lines, {
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2025-07-01",
    baseUrl: "https://example/entity/Default/23.200.001",
  });

  assert.equal(doc.read_only_policy, "GET-only");

  // middleware artifact wrappers are constants around real data
  const summary = doc.endpoints.summary_full;
  assert.deepEqual(
    { ok: summary.ok, status: summary.status, elapsed_ms: summary.elapsed_ms },
    { ok: true, status: 200, elapsed_ms: 0 }
  );
  assert.ok(summary.url.startsWith("https://example/entity/"));

  // account rollup: balance = credit - debit (fixture sign convention),
  // future-dated debit 40 excluded everywhere in derived
  assert.deepEqual(summary.data.account, {
    balance: -50,
    total_credit: 250,
    total_debit: 300,
    ytd_credit: 250,
    ytd_debit: 300,
    transaction_count: 3,
    as_of: "2026-07-02",
  });

  // raw transactions stay complete (4 benefits lines incl. the post-dated one)
  const transactions = doc.endpoints.recent_transactions.data.transactions;
  assert.equal(transactions.length, 4);
  assert.deepEqual(transactions[0], {
    date: "2026-05-10",
    employee_code: "SMIT01",
    category: "Book allowance",
    journal_description: "Book purchase",
    debit: 100,
    credit: 0,
  });

  // employees keyed by the subaccount code; employee balance = debit - credit
  assert.deepEqual(Object.keys(doc.employees), ["JONE02", "SMIT01"]);
  const smith = doc.employees.SMIT01;
  assert.deepEqual(smith.identity, { code: "SMIT01", name: "Smith, John" });
  assert.deepEqual(smith.summary.data.totals, { balance: 300, ytd_debit: 300, ytd_credit: 0, transaction_count: 2 });
  assert.equal(smith.ledger.data.entries.length, 3); // ledger complete, incl. post-dated
  assert.equal(doc.employees.JONE02.summary.data.totals.balance, -250);
  assert.equal(doc.employees.JONE02.identity.name, "Jones, Amy");

  assert.deepEqual(doc.derived.recent_transaction_employee_codes, ["JONE02", "SMIT01"]);
  assert.equal(doc.derived.recent_transaction_count, 3);
  assert.equal(doc.derived.eligible_employee_count, 2);
  assert.deepEqual(doc.derived.recent_transaction_category_rollup, {
    "Book allowance": { count: 1, debit: 100, credit: 0 },
    Travel: { count: 1, debit: 200, credit: 0 },
    Uncategorised: { count: 1, debit: 0, credit: 250 },
  });
  assert.deepEqual(doc.derived.failed_endpoints, {});
  assert.equal(doc.derived.account_balance, -50);
});

test("buildKeyAccountDrilldowns filters raw journals per key account in the drilldown shape", () => {
  const { accounts, summary } = sync.buildKeyAccountDrilldowns(RAW_JOURNALS, {
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2025-07-01",
    journalLimit: 200000,
  });

  assert.deepEqual(Object.keys(accounts).sort(), Object.keys(KEY_ACCOUNT_LABELS).sort());

  const evangelism = accounts["703430"];
  assert.equal(evangelism.from_date, "2025-07-01");
  assert.deepEqual(evangelism.limits, { bill_limit: 0, journal_limit: 200000 });
  assert.deepEqual(evangelism.bill_lines, []);
  assert.equal(evangelism.journals_scanned, 1);
  assert.deepEqual(evangelism.journal_lines, [
    {
      journal: {
        TransactionDate: "2025-08-15T00:00:00+00:00",
        BatchNbr: "GJ-2001",
        BranchID: "SNC",
        Description: "August payroll journal",
      },
      line: {
        Account: "703430",
        DebitAmount: 120.5,
        CreditAmount: 0,
        Subaccount: "EVA-000",
        Project: "",
        TransactionDescription: "Evangelism supplies",
      },
    },
  ]);
  assert.deepEqual(evangelism.derived, {
    bill_line_count: 0,
    bill_line_total: 0,
    journal_line_count: 1,
    journal_debit_total: 120.5,
    journal_credit_total: 0,
    journal_net_debit: 120.5,
  });

  // key accounts without activity still get an (empty) drilldown
  assert.equal(accounts["703100"].derived.journal_line_count, 0);

  // summary index in the shape listDrilldowns consumes
  const item = summary.accounts.find((entry) => entry.account === "703430");
  assert.equal(item.label, "Local church evangelism");
  assert.ok(item.output.endsWith("myob-account-703430-drilldown.json"));
  assert.deepEqual(item.derived, evangelism.derived);
  assert.deepEqual(item.errors, []);
  assert.equal(summary.accounts.length, Object.keys(KEY_ACCOUNT_LABELS).length);
});

test("buildGlCashMovements sums 111xxx net movement (not balances) and excludes post-dated lines", () => {
  const journalLines = [
    ...sync.flattenJournalLines(RAW_JOURNALS), // includes 111300 credit 120.5 on 2025-08-15
    flatLine({ account: "111200", date: "2026-06-30", subaccount: "ADM-000", debit: 500, net_debit: 500 }),
    flatLine({ account: "111300", date: "2026-09-01", subaccount: "ADM-000", debit: 999, net_debit: 999 }), // post-dated
  ];
  const movements = sync.buildGlCashMovements(journalLines, {
    generatedAt: "2026-07-02T00:00:00",
    fromDate: "2025-07-01",
    toDate: "2026-09-01",
    accountDescriptions: { 111200: "Bank account (AUD)", 111300: "Cash Management Facility" },
  });

  assert.match(movements.warning, /net movement over the extract window, not statement balances/);
  assert.deepEqual(movements.future_dated_excluded, { lines: 1, net_debit: 999 });
  assert.deepEqual(
    movements.accounts.map(({ account, description, line_count, net_movement, myob_source }) => ({
      account, description, line_count, net_movement, myob_source,
    })),
    [
      {
        account: "111200",
        description: "Bank account (AUD)",
        line_count: 1,
        net_movement: 500,
        myob_source: "JournalTransaction net movement 2025-07-01..2026-09-01",
      },
      {
        account: "111300",
        description: "Cash Management Facility",
        line_count: 1,
        net_movement: -120.5,
        myob_source: "JournalTransaction net movement 2025-07-01..2026-09-01",
      },
    ]
  );

  // existing candidates gain myob_source/myob_balance; movement-only accounts
  // are appended so cash targets have something to map to
  const candidates = sync.enrichCashCandidates(
    [{ _endpoint: "Account", AccountCD: "111300", CashAccount: true }],
    movements
  );
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].myob_balance, -120.5);
  assert.match(candidates[0].myob_balance_basis, /not statement balances/);
  assert.deepEqual(
    { _endpoint: candidates[1]._endpoint, AccountCD: candidates[1].AccountCD, myob_balance: candidates[1].myob_balance },
    { _endpoint: "JournalTransaction", AccountCD: "111200", myob_balance: 500 }
  );
});

test("GET /api/myob/sync/status reports no run with the cache dir unset", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/sync/status");
    assert.equal(status, 200);
    assert.equal(body.data.running, false);
    assert.equal(body.data.current_run, null);
    assert.equal(body.data.last_run, null);
    assert.equal(body.meta.dataSource, "missing");
  });
});

test("POST /api/myob/sync is 503 without MYOB_CACHE_DIR and validates company", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/sync", { method: "POST" });
    assert.equal(status, 503);
    assert.equal(body.code, "UNAVAILABLE");

    const bad = await requestJson(base, "/api/myob/sync?company=prod", { method: "POST" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "BAD_REQUEST");
  });
});
