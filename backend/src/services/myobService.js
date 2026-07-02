const { BadRequestError, NotFoundError } = require("../lib/errors");
const { parsePagination, paginate } = require("../lib/pagination");
const { enumParam, dateParam, boolParam } = require("../lib/validate");
const { KEY_ACCOUNT_LABELS } = require("../constants/keyAccounts");
const repository = require("../repositories/myobCacheRepository");

const { flattenRecord, pickField } = repository;

const JOURNAL_SAMPLE_KEY = "JournalTransaction_since_2025_07_01_sample";
const ENTITY_ENDPOINTS = {
  account: "Account",
  customer: "Customer",
  vendor: "Vendor",
  bill: "Bill",
  invoice: "Invoice",
  payment: "Payment",
  journal: JOURNAL_SAMPLE_KEY,
};
const ACCOUNT_SORTS = ["activity", "account", "debit", "credit", "net_debit"];
const EXAMPLES_CAP = 6;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function isActiveFlag(value) {
  return value === true || value === "true" || value === "True" || value === 1;
}

function intQuery(value, name, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function inDateRange(date, from, to) {
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Unified transaction rows — the single definition of the flattened row shape
// shared by broad-cache activity examples and the drilldown transaction feed
// (fallback chains per the Python val() helpers).
// ---------------------------------------------------------------------------

function journalRow(journal, line) {
  const debit = toNumber(pickField(line, "DebitAmount", "DebitAmt"));
  const credit = toNumber(pickField(line, "CreditAmount", "CreditAmt"));
  return {
    kind: "journal",
    date: dateOnly(pickField(journal, "TransactionDate")),
    reference: pickField(journal, "BatchNbr"),
    party: "",
    branch: pickField(journal, "BranchID", "Branch"),
    subaccount: pickField(line, "Subaccount"),
    project: pickField(line, "Project"),
    description: pickField(line, "TransactionDescription") || pickField(journal, "Description"),
    debit,
    credit,
    amount: debit - credit,
  };
}

function billRow(bill, line) {
  const amount = toNumber(pickField(line, "Amount", "ExtendedCost"));
  return {
    kind: "bill",
    date: dateOnly(pickField(bill, "Date")),
    reference: pickField(bill, "ReferenceNbr"),
    party: pickField(bill, "Vendor"),
    branch: pickField(bill, "BranchID", "Branch"),
    subaccount: pickField(line, "Subaccount"),
    project: pickField(line, "Project"),
    description:
      pickField(line, "TransactionDescription") || pickField(line, "Description") || pickField(bill, "Description"),
    debit: amount,
    credit: 0,
    amount,
  };
}

// ---------------------------------------------------------------------------
// Broad-cache drilldown dashboard model (port of build_model in
// generate_myob_account_drilldown_dashboard.py).
// ---------------------------------------------------------------------------

function endpointRows(cache, key) {
  const endpoints = (cache && cache.endpoints) || {};
  return ((endpoints[key] && endpoints[key].rows) || []).map(flattenRecord);
}

function buildDrilldownModel(cache) {
  const accounts = endpointRows(cache, "Account");
  const bills = endpointRows(cache, "Bill");
  const invoices = endpointRows(cache, "Invoice");
  const payments = endpointRows(cache, "Payment");
  const journals = endpointRows(cache, JOURNAL_SAMPLE_KEY);

  const accountMeta = {};
  for (const account of accounts) {
    const code = String(pickField(account, "AccountCD"));
    if (!code) continue;
    accountMeta[code] = {
      account: code,
      description: pickField(account, "Description"),
      class: pickField(account, "AccountClass"),
      type: pickField(account, "Type"),
      active: pickField(account, "Active"),
    };
  }

  const activity = new Map();
  const ensure = (code) => {
    const key = String(code);
    if (!activity.has(key)) {
      const meta = accountMeta[key] || {};
      activity.set(key, {
        account: key,
        description: meta.description || "",
        type: meta.type || "",
        class: meta.class || "",
        journal_lines: 0,
        journal_debit: 0,
        journal_credit: 0,
        bill_lines: 0,
        bill_amount: 0,
        invoice_lines: 0,
        invoice_amount: 0,
        examples: [],
      });
    }
    return activity.get(key);
  };

  for (const journal of journals) {
    for (const line of journal.Details || []) {
      const row = ensure(String(pickField(line, "Account", "AccountID") || "unknown"));
      const example = journalRow(journal, line);
      row.journal_lines += 1;
      row.journal_debit += example.debit;
      row.journal_credit += example.credit;
      if (row.examples.length < EXAMPLES_CAP) row.examples.push(example);
    }
  }

  for (const bill of bills) {
    for (const line of bill.Details || []) {
      const row = ensure(String(pickField(line, "Account") || "unknown"));
      const example = billRow(bill, line);
      row.bill_lines += 1;
      row.bill_amount += example.amount;
      if (row.examples.length < EXAMPLES_CAP) row.examples.push(example);
    }
  }

  // Include every chart account so searches reveal zero-activity accounts too.
  for (const code of Object.keys(accountMeta)) ensure(code);

  const rows = [...activity.values()].sort((a, b) => {
    const countA = a.journal_lines + a.bill_lines + a.invoice_lines;
    const countB = b.journal_lines + b.bill_lines + b.invoice_lines;
    if (countA !== countB) return countB - countA;
    const magnitudeA = Math.abs(a.journal_debit) + Math.abs(a.journal_credit) + Math.abs(a.bill_amount);
    const magnitudeB = Math.abs(b.journal_debit) + Math.abs(b.journal_credit) + Math.abs(b.bill_amount);
    return magnitudeB - magnitudeA;
  });

  return {
    generated_at: (cache && cache.generated_at) ?? null,
    endpoint_family: (cache && cache.base_endpoint_family) ?? null,
    counts: {
      accounts: accounts.length,
      journals: journals.length,
      bills: bills.length,
      invoices: invoices.length,
      payments: payments.length,
      activity_accounts: rows.length,
    },
    accounts: rows,
    account_meta: accountMeta,
    bills_sample: bills.slice(0, 120),
    invoices_sample: invoices.slice(0, 120),
    payments_sample: payments.slice(0, 120),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function getSources() {
  const sources = repository.describeSources();
  const dataSource = sources.some((source) => source.exists) ? "live-cache" : "synthetic";
  return { payload: { sources }, meta: { dataSource, generated_at: null } };
}

// ---------------------------------------------------------------------------
// Accounts (broad-cache activity rollups)
// ---------------------------------------------------------------------------

function listAccounts(query) {
  const sort = enumParam(query.sort, ACCOUNT_SORTS, "sort") ?? "activity";
  const { data, meta } = repository.loadBroad();
  const model = buildDrilldownModel(data);

  let rows = model.accounts;
  const q = String(query.q || "").toLowerCase().trim();
  if (q) {
    rows = rows.filter((row) =>
      `${row.account} ${row.description} ${row.type} ${row.class}`.toLowerCase().includes(q));
  }
  if (query.type) {
    rows = rows.filter((row) => String(row.type).toLowerCase() === String(query.type).toLowerCase());
  }
  if (query.class) {
    rows = rows.filter((row) => String(row.class).toLowerCase() === String(query.class).toLowerCase());
  }
  if (boolParam(query.activeOnly)) {
    rows = rows.filter((row) => {
      const accountMeta = model.account_meta[row.account];
      return accountMeta && isActiveFlag(accountMeta.active);
    });
  }
  if (boolParam(query.hasActivity)) {
    rows = rows.filter((row) => row.journal_lines + row.bill_lines + row.invoice_lines > 0);
  }

  if (sort === "account") {
    rows = [...rows].sort((a, b) => a.account.localeCompare(b.account));
  } else if (sort === "debit") {
    rows = [...rows].sort((a, b) => Math.abs(b.journal_debit) - Math.abs(a.journal_debit));
  } else if (sort === "credit") {
    rows = [...rows].sort((a, b) => Math.abs(b.journal_credit) - Math.abs(a.journal_credit));
  } else if (sort === "net_debit") {
    rows = [...rows].sort((a, b) =>
      (b.journal_debit - b.journal_credit) - (a.journal_debit - a.journal_credit));
  }

  const page = paginate(rows, parsePagination(query, { defaultLimit: 220, maxLimit: 220 }));
  return {
    payload: {
      generated_at: model.generated_at,
      endpoint_family: model.endpoint_family,
      counts: data ? model.counts : null,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      accounts: page.rows,
    },
    meta,
  };
}

function getAccount(code) {
  const { data, meta } = repository.loadBroad();
  const model = buildDrilldownModel(data);
  const row = model.accounts.find((account) => account.account === code);
  if (!row) throw new NotFoundError(`account ${code} not found in the MYOB cache`);
  const accountMeta = model.account_meta[code] || null;
  return {
    payload: {
      ...row,
      active: accountMeta ? accountMeta.active : null,
      hasDrilldown: repository.drilldownExists(code),
    },
    meta,
  };
}

// ---------------------------------------------------------------------------
// Per-account drilldowns
// ---------------------------------------------------------------------------

function getAccountDrilldown(code, query) {
  const billLimit = intQuery(query.billLimit, "billLimit", 300);
  const journalLimit = intQuery(query.journalLimit, "journalLimit", 500);
  const { data, meta } = repository.loadDrilldown(code);
  if (!data) {
    throw new NotFoundError(
      `no precomputed drilldown for account ${code}; run extract_myob_account_drilldown.py --account ${code}`);
  }
  return {
    payload: {
      ...data,
      bill_lines: (data.bill_lines || []).slice(0, billLimit),
      journal_lines: (data.journal_lines || []).slice(0, journalLimit),
    },
    meta,
  };
}

// Drilldown files store {bill|journal, line} entry pairs; flatten both halves
// and reuse the unified row builders.
function flattenBillLine(entry) {
  return billRow(flattenRecord(entry.bill || {}), flattenRecord(entry.line || {}));
}

function flattenJournalLine(entry) {
  return journalRow(flattenRecord(entry.journal || {}), flattenRecord(entry.line || {}));
}

function listAccountTransactions(code, query) {
  const kind = enumParam(query.kind, ["bill", "journal", "all"], "kind") ?? "all";
  const from = dateParam(query.from, "from");
  const to = dateParam(query.to, "to");
  const drilldown = repository.loadDrilldown(code);

  let rows = [];
  let meta = drilldown.meta;
  const warnings = [];
  if (drilldown.data) {
    if (kind !== "journal") rows.push(...(drilldown.data.bill_lines || []).map(flattenBillLine));
    if (kind !== "bill") rows.push(...(drilldown.data.journal_lines || []).map(flattenJournalLine));
  } else {
    // No precomputed drilldown: fall back to the broad-cache activity examples,
    // which are built by the same unified row builders.
    const broad = repository.loadBroad();
    const model = buildDrilldownModel(broad.data);
    const account = model.accounts.find((row) => row.account === code);
    if (!account) throw new NotFoundError(`account ${code} not found in the MYOB cache`);
    rows = [...account.examples];
    if (kind !== "all") rows = rows.filter((row) => row.kind === kind);
    meta = broad.meta;
    warnings.push(`no precomputed drilldown for account ${code}; rows limited to broad-cache examples`);
  }

  rows = rows.filter((row) => inDateRange(row.date, from, to));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const page = paginate(rows, parsePagination(query, { defaultLimit: 100, maxLimit: 500 }));
  return {
    payload: { account: code, total: page.total, limit: page.limit, offset: page.offset, rows: page.rows },
    meta: { ...meta, warnings },
  };
}

// One index item per drilldown, tolerant of both summary-writer shapes and of
// raw drilldown files (which carry derived/generated_at but never a label).
function drilldownIndexItem(account, source) {
  const derived = source.derived || {};
  return {
    account,
    label: source.label ?? KEY_ACCOUNT_LABELS[account] ?? null,
    bill_lines: derived.bill_line_count ?? 0,
    bill_total: derived.bill_line_total ?? 0,
    journal_lines: derived.journal_line_count ?? 0,
    journal_net: derived.journal_net_debit ?? 0,
    generated_at: source.generated_at ?? null,
  };
}

function listDrilldowns() {
  const summary = repository.loadDrilldownSummary();
  let items = [];
  let meta = summary.meta;

  if (summary.data && Array.isArray(summary.data.accounts)) {
    items = summary.data.accounts.map((item) => drilldownIndexItem(String(item.account || ""), item));
  } else {
    // No summary file — index the drilldown files directly.
    const { codes } = repository.listDrilldownCodes();
    for (const code of codes) {
      const { data, meta: drilldownMeta } = repository.loadDrilldown(code);
      if (!data) continue;
      items.push(drilldownIndexItem(code, data));
      meta = drilldownMeta;
    }
  }

  items.sort((a, b) => {
    const countA = a.bill_lines + a.journal_lines;
    const countB = b.bill_lines + b.journal_lines;
    if (countA !== countB) return countB - countA;
    return Math.abs(b.journal_net || 0) - Math.abs(a.journal_net || 0);
  });

  return { payload: { items }, meta };
}

// ---------------------------------------------------------------------------
// Broad-cache entities
// ---------------------------------------------------------------------------

function normalizeEntityRow(entity, row) {
  switch (entity) {
    case "account":
      return {
        AccountCD: pickField(row, "AccountCD"),
        Description: pickField(row, "Description"),
        AccountClass: pickField(row, "AccountClass"),
        Type: pickField(row, "Type"),
        Active: row.Active ?? null,
      };
    case "customer":
      return {
        CustomerID: pickField(row, "CustomerID", "AccountRef"),
        CustomerName: pickField(row, "CustomerName", "AccountName"),
        Status: pickField(row, "Status", "Active"),
      };
    case "vendor":
      return {
        VendorID: pickField(row, "VendorID", "AccountRef"),
        VendorName: pickField(row, "VendorName", "AccountName"),
        APAccount: pickField(row, "APAccount"),
        Status: pickField(row, "Status", "Active"),
      };
    case "bill":
      return {
        Date: pickField(row, "Date"),
        ReferenceNbr: pickField(row, "ReferenceNbr"),
        Vendor: pickField(row, "Vendor"),
        BranchID: pickField(row, "BranchID", "Branch"),
        Description: pickField(row, "Description"),
        Amount: row.Amount ?? null,
        Balance: row.Balance ?? null,
      };
    case "invoice":
      return {
        Date: pickField(row, "Date"),
        ReferenceNbr: pickField(row, "ReferenceNbr"),
        Customer: pickField(row, "Customer"),
        BranchID: pickField(row, "BranchID", "Branch"),
        Description: pickField(row, "Description"),
        Amount: row.Amount ?? null,
        Balance: row.Balance ?? null,
      };
    case "payment":
      return { ...row, PaymentAmount: toNumber(pickField(row, "PaymentAmount", "Amount")) };
    case "journal":
      return {
        TransactionDate: pickField(row, "TransactionDate"),
        BatchNbr: pickField(row, "BatchNbr"),
        BranchID: pickField(row, "BranchID", "Branch"),
        Description: pickField(row, "Description"),
        Details: (row.Details || []).map((line) => ({
          Account: pickField(line, "Account", "AccountID"),
          DebitAmount: toNumber(pickField(line, "DebitAmount", "DebitAmt")),
          CreditAmount: toNumber(pickField(line, "CreditAmount", "CreditAmt")),
          Subaccount: pickField(line, "Subaccount"),
          Project: pickField(line, "Project"),
          TransactionDescription: pickField(line, "TransactionDescription"),
        })),
      };
    default:
      return row;
  }
}

function entityRowDate(row) {
  return dateOnly(row.Date || row.TransactionDate || "");
}

function listEntityRows(entityParam, query) {
  const entity = enumParam(entityParam, Object.keys(ENTITY_ENDPOINTS), "entity");
  const from = dateParam(query.from, "from");
  const to = dateParam(query.to, "to");
  const { data, meta } = repository.loadBroad();
  const endpoints = (data && data.endpoints) || {};
  const record = endpoints[ENTITY_ENDPOINTS[entity]] || {};
  const rawRows = (record.rows || []).map(flattenRecord);
  let rows = rawRows.map((row) => normalizeEntityRow(entity, row));

  const q = String(query.q || "").toLowerCase().trim();
  if (q) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  if (query.vendor) {
    const vendor = String(query.vendor).toLowerCase();
    rows = rows.filter((row) => String(row.Vendor || row.VendorName || "").toLowerCase().includes(vendor));
  }
  if (query.customer) {
    const customer = String(query.customer).toLowerCase();
    rows = rows.filter((row) => String(row.Customer || row.CustomerName || "").toLowerCase().includes(customer));
  }
  if (query.branch) {
    rows = rows.filter((row) => String(row.BranchID || "") === String(query.branch));
  }
  if (from || to) rows = rows.filter((row) => inDateRange(entityRowDate(row), from, to));

  const page = paginate(rows, parsePagination(query, { defaultLimit: 100, maxLimit: 500 }));
  return {
    payload: {
      entity,
      ok: record.ok ?? null,
      status: record.status ?? null,
      count: record.count ?? rawRows.length,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      rows: page.rows,
    },
    meta,
  };
}

// ---------------------------------------------------------------------------
// Broad summary / branches
// ---------------------------------------------------------------------------

function getBroadSummary() {
  const { data, meta } = repository.loadBroad();
  const endpoints = (data && data.endpoints) || {};

  const endpointCounts = {};
  for (const [key, record] of Object.entries(endpoints)) {
    endpointCounts[key] = {
      ok: record.ok ?? null,
      count: record.count ?? (record.rows || []).length,
      status: record.status ?? null,
    };
  }

  const accounts = endpointRows(data, "Account");
  const bills = endpointRows(data, "Bill");
  const invoices = endpointRows(data, "Invoice");
  const payments = endpointRows(data, "Payment");
  const vendors = endpointRows(data, "Vendor");
  const customers = endpointRows(data, "Customer");
  const journals = endpointRows(data, JOURNAL_SAMPLE_KEY);
  let journalLines = 0;
  for (const journal of journals) journalLines += (journal.Details || []).length;

  return {
    payload: {
      generated_at: (data && data.generated_at) ?? null,
      base_endpoint_family: (data && data.base_endpoint_family) ?? null,
      endpoint_counts: endpointCounts,
      kpis: data
        ? {
            accounts: accounts.length,
            accounts_active: accounts.filter((account) => account.Active === true).length,
            journal_txns: journals.length,
            journal_lines: journalLines,
            bill_total: round2(bills.reduce((sum, bill) => sum + toNumber(bill.Amount), 0)),
            invoice_total: round2(invoices.reduce((sum, invoice) => sum + toNumber(invoice.Amount), 0)),
            payment_total: round2(
              payments.reduce((sum, payment) => sum + toNumber(pickField(payment, "PaymentAmount", "Amount")), 0)),
            vendors: vendors.length,
            customers: customers.length,
            payments: payments.length,
          }
        : null,
    },
    meta,
  };
}

function getBroadBranches() {
  const { data, meta } = repository.loadBroad();
  const journals = endpointRows(data, JOURNAL_SAMPLE_KEY);
  const counts = new Map();
  for (const journal of journals) {
    const branch = pickField(journal, "BranchID", "Branch");
    if (!branch) continue;
    counts.set(branch, (counts.get(branch) || 0) + 1);
  }
  const branches = [...counts.entries()]
    .map(([branch, journalTxns]) => ({ branch, journal_txns: journalTxns }))
    .sort((a, b) => b.journal_txns - a.journal_txns);
  return { payload: { branches }, meta };
}

// ---------------------------------------------------------------------------
// Live GL
// ---------------------------------------------------------------------------

function glLinesPool(cache, kind) {
  const journalLines = (cache && cache.journal_lines) || [];
  const billLines = (cache && cache.bill_lines) || [];
  if (kind === "JournalTransaction") return [...journalLines];
  if (kind === "Bill") return [...billLines];
  return [...journalLines, ...billLines];
}

function normalizeGlKind(value) {
  const kind = enumParam(value, ["JournalTransaction", "Bill", "journal", "bill"], "kind");
  if (kind === "journal") return "JournalTransaction";
  if (kind === "bill") return "Bill";
  return kind;
}

function getGlSummary() {
  const summary = repository.loadLiveGlSummary();
  if (summary.data) return { payload: summary.data, meta: summary.meta };

  const { data, meta } = repository.loadLiveGl();
  return {
    payload: {
      generated_at: (data && data.generated_at) ?? null,
      source: (data && data.source) ?? null,
      from_date: (data && data.from_date) ?? null,
      to_date: (data && data.to_date) ?? null,
      base_endpoint_family: (data && data.base_endpoint_family) ?? null,
      endpoint_status: (data && data.endpoint_status) ?? null,
      line_counts: data
        ? {
            accounts: (data.accounts || []).length,
            journal_lines: (data.journal_lines || []).length,
            bill_lines: (data.bill_lines || []).length,
          }
        : null,
      errors: (data && data.errors) || [],
    },
    meta: { ...meta, warnings: data ? ["summary derived from the latest live-gl cache"] : [] },
  };
}

function listGlAccounts(query) {
  const active = enumParam(query.active, ["true", "false"], "active");
  const { data, meta } = repository.loadLiveGl();
  let rows = ((data && data.accounts) || []).map(flattenRecord);

  const search = String(query.search || "").toLowerCase().trim();
  if (search) {
    rows = rows.filter((row) =>
      `${pickField(row, "AccountCD")} ${pickField(row, "Description")} ${pickField(row, "AccountClass")} ${pickField(row, "Type")}`
        .toLowerCase()
        .includes(search));
  }
  if (query.class) {
    rows = rows.filter(
      (row) => String(pickField(row, "AccountClass")).toLowerCase() === String(query.class).toLowerCase());
  }
  if (active !== undefined) {
    const wantActive = active === "true";
    rows = rows.filter((row) => isActiveFlag(row.Active) === wantActive);
  }

  const page = paginate(rows, parsePagination(query, { defaultLimit: 100, maxLimit: 500 }));
  return {
    payload: { count: page.total, total: page.total, limit: page.limit, offset: page.offset, accounts: page.rows },
    meta,
  };
}

function filterGlLines(lines, { from, to, period, account, accountPrefix, branch, q }) {
  return lines.filter((line) => {
    if (!inDateRange(dateOnly(line.date), from, to)) return false;
    if (period && String(line.period || "") !== String(period)) return false;
    if (account && String(line.account || "") !== String(account)) return false;
    if (accountPrefix && !String(line.account || "").startsWith(String(accountPrefix))) return false;
    if (branch && String(line.branch || "") !== String(branch)) return false;
    if (q) {
      const haystack = [
        line.account,
        line.account_description,
        line.subaccount,
        line.project,
        line.vendor_customer,
        line.header_description,
        line.line_description,
        line.batch,
        line.reference,
        line.branch,
      ]
        .map((value) => String(value ?? ""))
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function listGlLines(query) {
  const kind = normalizeGlKind(query.kind);
  const from = dateParam(query.from, "from");
  const to = dateParam(query.to, "to");
  const q = String(query.q || "").toLowerCase().trim();
  const { data, meta } = repository.loadLiveGl();

  const lines = filterGlLines(glLinesPool(data, kind), {
    from,
    to,
    period: query.period,
    account: query.account,
    accountPrefix: query.accountPrefix,
    branch: query.branch,
    q,
  });

  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += toNumber(line.debit);
    credit += toNumber(line.credit);
  }

  const page = paginate(lines, parsePagination(query, { defaultLimit: 100, maxLimit: 500 }));
  return {
    payload: {
      count: page.total,
      totals: { debit: round2(debit), credit: round2(credit), net_debit: round2(debit - credit) },
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      lines: page.rows,
    },
    meta,
  };
}

function listGlPeriods() {
  const { data, meta } = repository.loadLiveGl();
  const groups = new Map();
  for (const line of glLinesPool(data, undefined)) {
    const period = String(line.period || "");
    if (!groups.has(period)) {
      groups.set(period, { period, lines: 0, debit: 0, credit: 0, net_debit: 0, earliest_date: null, latest_date: null });
    }
    const group = groups.get(period);
    group.lines += 1;
    group.debit += toNumber(line.debit);
    group.credit += toNumber(line.credit);
    const date = dateOnly(line.date);
    if (date) {
      if (group.earliest_date === null || date < group.earliest_date) group.earliest_date = date;
      if (group.latest_date === null || date > group.latest_date) group.latest_date = date;
    }
  }
  const periods = [...groups.values()]
    .map((group) => ({
      ...group,
      debit: round2(group.debit),
      credit: round2(group.credit),
      net_debit: round2(group.debit - group.credit),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
  return { payload: { periods }, meta };
}

function listGlActivity(query) {
  const groupBy = enumParam(query.groupBy, ["account", "branch", "period"], "groupBy") ?? "account";
  const from = dateParam(query.from, "from");
  const to = dateParam(query.to, "to");
  const limit = intQuery(query.limit, "limit", 100);
  const { data, meta } = repository.loadLiveGl();

  const lines = filterGlLines(glLinesPool(data, undefined), {
    from,
    to,
    period: query.period,
    branch: query.branch,
  });

  const descriptions = {};
  if (groupBy === "account") {
    for (const account of (data && data.accounts) || []) {
      const flattened = flattenRecord(account);
      const code = String(pickField(flattened, "AccountCD"));
      if (code) descriptions[code] = pickField(flattened, "Description");
    }
  }

  const groups = new Map();
  for (const line of lines) {
    const key = String(line[groupBy] || "");
    if (!groups.has(key)) {
      const group = { key, lines: 0, debit: 0, credit: 0, net_debit: 0 };
      if (groupBy === "account") {
        group.account_description = descriptions[key] || line.account_description || "";
      }
      groups.set(key, group);
    }
    const group = groups.get(key);
    group.lines += 1;
    group.debit += toNumber(line.debit);
    group.credit += toNumber(line.credit);
  }

  const rows = [...groups.values()]
    .map((group) => ({
      ...group,
      debit: round2(group.debit),
      credit: round2(group.credit),
      net_debit: round2(group.debit - group.credit),
    }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, limit);

  return { payload: { groups: rows }, meta };
}

// ---------------------------------------------------------------------------
// Benefits (account 312510)
// ---------------------------------------------------------------------------

function getBenefitsSummary() {
  const { data, meta } = repository.loadBenefits();
  return {
    payload: {
      generated_at: (data && data.generated_at) ?? null,
      scope: (data && data.scope) ?? null,
      read_only_policy: (data && data.read_only_policy) ?? null,
      derived: (data && data.derived) ?? null,
    },
    meta,
  };
}

function benefitsEmployeeRow(code, employee) {
  const summary = employee.summary || {};
  const summaryData = summary.ok && summary.data && typeof summary.data === "object" ? summary.data : {};
  const totals = summaryData.totals ?? null;
  const role = (summaryData.employee && summaryData.employee.role_or_church) || "";
  return {
    code,
    name: (employee.identity && employee.identity.name) || "",
    role_or_church: role,
    totals,
    summary_ok: summary.ok ?? false,
    ledger_ok: (employee.ledger && employee.ledger.ok) ?? false,
  };
}

function listBenefitsEmployees(query) {
  const { data, meta } = repository.loadBenefits();
  const employees = (data && data.employees) || {};
  let rows = Object.entries(employees).map(([code, employee]) => benefitsEmployeeRow(code, employee));
  const search = String(query.search || "").toLowerCase().trim();
  if (search) {
    rows = rows.filter((row) => `${row.code} ${row.name} ${row.role_or_church}`.toLowerCase().includes(search));
  }
  return { payload: { count: rows.length, employees: rows }, meta };
}

function getBenefitsEmployee(codeParam) {
  const code = String(codeParam);
  if (!/^[A-Za-z0-9._-]+$/.test(code)) {
    throw new BadRequestError("code must contain only letters, digits, dots, hyphens, or underscores");
  }
  const { data, meta } = repository.loadBenefits();
  const employee = ((data && data.employees) || {})[code];
  if (!employee) throw new NotFoundError(`employee ${code} not found in the benefits cache`);
  return {
    payload: {
      code,
      identity: employee.identity ?? null,
      summary: (employee.summary && employee.summary.data) ?? null,
      profile: (employee.profile && employee.profile.data) ?? null,
      ledger: (employee.ledger && employee.ledger.data) ?? null,
    },
    meta,
  };
}

function listBenefitsTransactions(query) {
  const { data, meta } = repository.loadBenefits();
  const record = ((data && data.endpoints) || {}).recent_transactions || {};
  const transactions = (record.ok && record.data && record.data.transactions) || [];

  let rows = transactions;
  if (query.employee_code) rows = rows.filter((tx) => String(tx.employee_code || "") === String(query.employee_code));
  if (query.category) {
    rows = rows.filter((tx) => String(tx.category || "").toLowerCase() === String(query.category).toLowerCase());
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const tx of rows) {
    totalDebit += toNumber(tx.debit);
    totalCredit += toNumber(tx.credit);
  }

  const page = paginate(rows, parsePagination(query, { defaultLimit: 100, maxLimit: 500 }));
  return {
    payload: {
      count: page.total,
      total_debit: round2(totalDebit),
      total_credit: round2(totalCredit),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      transactions: page.rows,
    },
    meta,
  };
}

function listBenefitsCategories() {
  const { data, meta } = repository.loadBenefits();
  const rollup = ((data && data.derived) || {}).recent_transaction_category_rollup || {};
  const categories = Object.entries(rollup)
    .map(([category, value]) => ({
      category,
      count: value.count ?? 0,
      debit: value.debit ?? 0,
      credit: value.credit ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { payload: { categories }, meta };
}

module.exports = {
  getSources,
  listAccounts,
  getAccount,
  getAccountDrilldown,
  listAccountTransactions,
  listDrilldowns,
  listEntityRows,
  getBroadSummary,
  getBroadBranches,
  getGlSummary,
  listGlAccounts,
  listGlLines,
  listGlPeriods,
  listGlActivity,
  getBenefitsSummary,
  listBenefitsEmployees,
  getBenefitsEmployee,
  listBenefitsTransactions,
  listBenefitsCategories,
};
