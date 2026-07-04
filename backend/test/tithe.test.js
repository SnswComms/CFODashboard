const test = require("node:test");
const assert = require("node:assert");

process.env.EMAIL_DRY_RUN = "1";
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.PAYROLL_DIR = "";
process.env.REPORT_PACKS_DIR = "";
process.env.SYNTHETIC_DIR = "";

const { withServer, requestJson } = require("./helper");
const emails = require("../src/emails");
const titheService = require("../src/services/titheService");

test("GET /api/tithe/dashboard returns church, monthly, conference and automation data", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/tithe/dashboard");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "synthetic");
    assert.strictEqual(body.data.default_church_id, "wagga-wagga");
    assert.strictEqual(body.data.conference.name, "South NSW Conference");
    assert.strictEqual(body.data.email_automation.cadence, "monthly");
    assert.strictEqual(body.data.email_automation.endpoint, "/api/tithe/monthly-email/trigger");
    assert.strictEqual(body.data.email_automation.batch_endpoint, "/api/tithe/monthly-email/trigger-batch");
    assert.strictEqual(body.data.email_automation.scheduler_enabled, false);
    assert.ok(body.data.churches.length >= 2);

    const church = body.data.churches[0];
    assert.strictEqual(church.monthly.length, 12);
    assert.strictEqual(church.metrics.months_reported, 6);
    assert.strictEqual(church.metrics.current_ytd, 264080);
    assert.strictEqual(church.metrics.prior_ytd, 251180);
    assert.strictEqual(church.metrics.yoy_delta, 12900);
    assert.strictEqual(church.metrics.yoy_pct, 5.1);
    assert.strictEqual(church.metrics.conference_share_pct, 10.1);
  });
});

test("buildTitheDashboardFromMyob aggregates account 610100 by SNU church Customer AccountRef", () => {
  const liveGl = {
    generated_at: "2026-03-31T00:00:00+00:00",
    journal_lines: [
      {
        date: "2026-01-31",
        account: "610100",
        subaccount: "OTH======OFF279CHALB01",
        credit: 100,
        debit: 0,
        net_debit: -100,
      },
      {
        date: "2026-01-31",
        account: "610100",
        subaccount: "OTH======OFF279CHWAG01",
        credit: 250,
        debit: 20,
        net_debit: -230,
      },
      {
        date: "2026-02-28",
        account: "610100",
        subaccount: "OTH======OFF279CHALB01",
        credit: 150,
        debit: 0,
        net_debit: -150,
      },
      {
        date: "2026-02-28",
        account: "630100",
        subaccount: "OTH======OFF279CHALB01",
        credit: 999,
        debit: 0,
        net_debit: -999,
      },
    ],
  };
  const broad = {
    endpoints: {
      Customer: {
        rows: [
          {
            CustomerClass: { value: "AUCHURCH" },
            RestrictVisibilityTo: { value: "SNU" },
            AccountRef: { value: "SNUCHALB01" },
            CustomerID: { value: "BA1" },
            CustomerName: { value: "Albury church" },
            Email: { value: "albury@example.org" },
          },
          {
            CustomerClass: { value: "AUCHURCH" },
            RestrictVisibilityTo: { value: "SNU" },
            AccountRef: { value: "SNUCHWAG01" },
            CustomerID: { value: "BA2" },
            CustomerName: { value: "Wagga Wagga church" },
          },
          {
            CustomerClass: { value: "AUCHURCH" },
            RestrictVisibilityTo: { value: "SNE" },
            AccountRef: { value: "SNECHCAN01" },
            CustomerName: { value: "Canberra school" },
          },
        ],
      },
    },
  };

  const dashboard = titheService.buildTitheDashboardFromMyob(liveGl, broad, { generated_at: liveGl.generated_at });
  assert.strictEqual(dashboard.conference.churches_total, 2);
  assert.strictEqual(dashboard.conference.churches_reporting, 2);
  assert.strictEqual(dashboard.conference.as_of, "Feb 2026");
  assert.strictEqual(dashboard.source_detail.tithe_line_count, 3);
  assert.strictEqual(dashboard.source_detail.unmapped_tithe_line_count, 0);
  assert.strictEqual(dashboard.source_detail.unmapped_tithe_total, 0);
  assert.deepStrictEqual(dashboard.source_detail.unmapped_church_codes, []);

  const albury = dashboard.churches.find((church) => church.name === "Albury church");
  const wagga = dashboard.churches.find((church) => church.name === "Wagga Wagga church");
  assert.strictEqual(albury.monthly[0].current, 100);
  assert.strictEqual(albury.monthly[1].current, 150);
  assert.strictEqual(albury.monthly[0].conference, 330);
  assert.strictEqual(wagga.monthly[0].current, 230);
  assert.strictEqual(wagga.monthly[1].conference, 150);
});

test("buildTitheDashboardFromMyob reports non-SNU church tithe codes without adding a church row", () => {
  const liveGl = {
    generated_at: "2026-03-31T00:00:00+00:00",
    journal_lines: [
      {
        date: "2026-01-31",
        account: "610100",
        subaccount: "OTH======OFF279CHALB01",
        credit: 100,
        debit: 0,
      },
      {
        date: "2026-01-31",
        account: "610100",
        subaccount: "OTH======OFF279CHSNC01",
        credit: 500,
        debit: 0,
      },
    ],
  };
  const broad = {
    endpoints: {
      Customer: {
        rows: [
          {
            CustomerClass: { value: "AUCHURCH" },
            RestrictVisibilityTo: { value: "SNU" },
            AccountRef: { value: "SNUCHALB01" },
            CustomerName: { value: "Albury church" },
          },
          {
            CustomerClass: { value: "AUDENINT" },
            ShippingBranch: { value: "SNC" },
            AccountRef: { value: "SNC" },
            CustomerName: { value: "SNC - SDA Church (South NSW Conference) Limited" },
          },
        ],
      },
    },
  };

  const dashboard = titheService.buildTitheDashboardFromMyob(liveGl, broad, { generated_at: liveGl.generated_at });
  assert.strictEqual(dashboard.conference.churches_total, 1);
  assert.strictEqual(dashboard.conference.churches_reporting, 1);
  assert.deepStrictEqual(
    dashboard.churches.map((church) => church.name),
    ["Albury church"]
  );
  assert.strictEqual(dashboard.churches[0].monthly[0].conference, 100);
  assert.strictEqual(dashboard.source_detail.tithe_line_count, 1);
  assert.strictEqual(dashboard.source_detail.unmapped_tithe_line_count, 1);
  assert.strictEqual(dashboard.source_detail.unmapped_tithe_total, 500);
  assert.deepStrictEqual(dashboard.source_detail.unmapped_church_codes, ["CHSNC01"]);
});

test("GET /api/tithe/churches/:churchId selects a church and includes conference context", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/tithe/churches/canberra-national");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.church.id, "canberra-national");
    assert.strictEqual(body.data.church.metrics.current_ytd, 455300);
    assert.strictEqual(body.data.conference.as_of, "June 2026");
  });
});

test("POST /api/tithe/monthly-email/trigger renders and dry-runs a one-page email", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/tithe/monthly-email/trigger", {
      method: "POST",
      body: { churchId: "wagga-wagga", previewOnly: true },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.church_id, "wagga-wagga");
    assert.strictEqual(body.data.to, "treasurer.wagga@example.org");
    assert.ok(body.data.subject.includes("Wagga Wagga Church tithe faithfulness"));
    assert.deepStrictEqual(body.data.send_result, { dryRun: true, previewOnly: true });
    assert.ok(body.data.preview.html.includes("Month by month"));
    assert.ok(body.data.preview.text.includes("Conference share"));
  });
});

test("POST /api/tithe/monthly-email/trigger-batch previews all church one-pagers", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/tithe/monthly-email/trigger-batch", {
      method: "POST",
      body: { previewOnly: true },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.preview_only, true);
    assert.strictEqual(body.data.count, 2);
    assert.ok(body.data.results.every((row) => row.send_result.previewOnly === true));
    assert.ok(body.data.results.every((row) => !("preview" in row)));
  });
});

test("monthly scheduler decision waits for configured day/hour and runs once per month", async () => {
  assert.strictEqual(
    titheService.shouldRunMonthlyEmail({
      now: new Date("2026-07-04T10:00:00+10:00"),
      lastRunMonth: null,
      dayOfMonth: 5,
      checkHour: 9,
    }),
    false
  );
  assert.strictEqual(
    titheService.shouldRunMonthlyEmail({
      now: new Date(2026, 6, 5, 8, 59),
      lastRunMonth: null,
      dayOfMonth: 5,
      checkHour: 9,
    }),
    false
  );
  assert.strictEqual(
    titheService.shouldRunMonthlyEmail({
      now: new Date(2026, 6, 5, 9, 0),
      lastRunMonth: null,
      dayOfMonth: 5,
      checkHour: 9,
    }),
    true
  );
  assert.strictEqual(
    titheService.shouldRunMonthlyEmail({
      now: new Date(2026, 6, 15, 9, 0),
      lastRunMonth: "2026-07",
      dayOfMonth: 5,
      checkHour: 9,
    }),
    false
  );
});

test("runScheduledMonthlyEmail previews the batch and suppresses repeat same-month runs", async () => {
  titheService.resetMonthlyEmailSchedulerState();
  const first = await titheService.runScheduledMonthlyEmail({ now: new Date(2026, 6, 5, 9, 0) });
  assert.strictEqual(first.started, true);
  assert.strictEqual(first.result.preview_only, true);
  assert.strictEqual(first.result.count, 2);

  const repeat = await titheService.runScheduledMonthlyEmail({ now: new Date(2026, 6, 15, 9, 0) });
  assert.deepStrictEqual(repeat, { started: false, reason: "not due" });

  const nextMonth = await titheService.runScheduledMonthlyEmail({ now: new Date(2026, 7, 5, 9, 0) });
  assert.strictEqual(nextMonth.started, true);
  assert.strictEqual(nextMonth.result.preview_only, true);
  titheService.resetMonthlyEmailSchedulerState();
});

test("renderTitheOnePagerEmail returns branded html/text with core metrics", () => {
  const church = {
    name: "Sample Church",
    monthly: [{ month: "Jan", current: 100, prior: 80, conference: 1000 }],
    metrics: {
      months_reported: 1,
      current_ytd: 100,
      prior_ytd: 80,
      yoy_delta: 20,
      yoy_pct: 25,
      conference_share_pct: 10,
      projected_full_year: 1200,
      projected_vs_prior_pct: 25,
    },
  };
  const result = emails.renderTitheOnePagerEmail({
    church,
    conference: { name: "South NSW Conference", as_of: "January 2026", churches_reporting: 70, churches_total: 78 },
  });
  assert.strictEqual(result.subject, "Sample Church tithe faithfulness — January 2026");
  assert.ok(result.html.includes("<!DOCTYPE html>"));
  assert.ok(result.html.includes("Local tithe"));
  assert.ok(result.html.includes("Conference share"));
  assert.ok(result.text.includes("Sample Church represents 10.0%"));
});
