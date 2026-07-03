const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const backendRoot = path.resolve(__dirname, "..", "..");
const cfoDataDir = process.env.CFO_DATA_DIR || null;

function underDataDir(...segments) {
  return cfoDataDir ? path.join(cfoDataDir, ...segments) : null;
}

const dirs = {
  dashboards: process.env.DASHBOARDS_DIR || underDataDir("briefings", "dashboards"),
  myobCache: process.env.MYOB_CACHE_DIR || underDataDir("finance", "myob-cache"),
  payroll: process.env.PAYROLL_DIR || underDataDir("finance", "payroll-staff-costs"),
  reportPacks: process.env.REPORT_PACKS_DIR || underDataDir("briefings", "report-packs"),
  synthetic: process.env.SYNTHETIC_DIR || path.join(backendRoot, "fixtures"),
};

function resolve(dirKey, ...segments) {
  const dir = dirs[dirKey];
  if (!dir) return null;
  return path.join(dir, ...segments);
}

function dataMode() {
  return cfoDataDir ? "live-cache" : "synthetic";
}

// Read-only MYOB Advanced API access (the sync layer only ever GETs).
const myob = {
  url: process.env.MYOB_URL || null,
  username: process.env.MYOB_USERNAME || null,
  password: process.env.MYOB_PASSWORD || null,
  company: process.env.MYOB_COMPANY || "Church",
  companyTest: process.env.MYOB_COMPANY_TEST || "Test",
  branch: process.env.MYOB_BRANCH || "",
  endpointFamily: process.env.MYOB_ENDPOINT_FAMILY || "Default/23.200.001",
  // Sync window start; when unset the sync derives the previous July 1
  // (start of the current Australian financial year).
  syncFromDate: process.env.MYOB_SYNC_FROM_DATE || null,
  cmfTargetAccounts: (process.env.MYOB_CMF_TARGET_ACCOUNTS || "111300")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean),
  journalLimit: Number(process.env.MYOB_SYNC_JOURNAL_LIMIT || 200000),
  // Per-run journal cap for the historical Mongo backfill (parallels
  // journalLimit above; falls back to it when unset).
  historyJournalLimit: Number(
    process.env.MYOB_HISTORY_JOURNAL_LIMIT || process.env.MYOB_SYNC_JOURNAL_LIMIT || 200000
  ),
  timeoutMs: Number(process.env.MYOB_TIMEOUT_MS || 120000),
  // In-process refresh cadence for server.js; 0 disables the scheduler.
  syncIntervalHours: Number(process.env.MYOB_SYNC_INTERVAL_HOURS ?? 6),
  // Live GL cache age past which command-centre responses carry a staleness
  // warning (the sync runs 6-hourly, so 48h means several missed runs).
  // 0 warns immediately; negative or non-numeric values fall back to 48h so a
  // bad env var can never silently disable staleness detection.
  staleAfterHours:
    Number.isFinite(Number(process.env.MYOB_STALE_AFTER_HOURS ?? 48)) &&
    Number(process.env.MYOB_STALE_AFTER_HOURS ?? 48) >= 0
      ? Number(process.env.MYOB_STALE_AFTER_HOURS ?? 48)
      : 48,
};

// Decision copilot LLM — Qwen served by vLLM on morpheus (Tailscale peer,
// OpenAI-compatible, no auth; local-only rule holds). llmEnabled gates the
// network path: COPILOT_LLM_DISABLED=1 turns it off, and NODE_ENV=test
// auto-disables so the suite stays hermetic (tests also pin the flag before
// requiring config, matching the synthetic-mode pattern in test files).
const copilot = {
  llmUrl: process.env.COPILOT_LLM_URL || "http://100.87.6.30:8000/v1",
  llmModel: process.env.COPILOT_LLM_MODEL || "qwen3.6-27b-awq",
  llmTimeoutMs: Number(process.env.COPILOT_LLM_TIMEOUT_MS || 45000),
  llmMaxTokens: Number(process.env.COPILOT_LLM_MAX_TOKENS || 2000),
  llmEnabled: process.env.COPILOT_LLM_DISABLED !== "1" && process.env.NODE_ENV !== "test",
};

// The VPS mongod runs with `--tlsMode requireTLS` and a client-CA, so every
// connection must speak mutual TLS: present a CA-signed client cert and trust
// the server via the same CA. Cert paths are resolved relative to backendRoot
// so a relative .env value (e.g. ./certs/client.pem) works regardless of cwd.
// TLS engages only when both files are configured; unset = plaintext (local
// mongo / synthetic mode). Shared by lib/mongo.js and auth/mongo.js.
const mongoTlsCaFile = process.env.MONGODB_TLS_CA_FILE
  ? path.resolve(backendRoot, process.env.MONGODB_TLS_CA_FILE)
  : null;
const mongoTlsCertKeyFile = process.env.MONGODB_TLS_CERT_KEY_FILE
  ? path.resolve(backendRoot, process.env.MONGODB_TLS_CERT_KEY_FILE)
  : null;

const mongoClientOptions = {
  // Fail requests in ~5s when the tunnel is down instead of the driver's 30s
  // default, keeping API/auth endpoints responsive.
  serverSelectionTimeoutMS: 5000,
};
if (mongoTlsCaFile && mongoTlsCertKeyFile) {
  mongoClientOptions.tls = true;
  mongoClientOptions.tlsCAFile = mongoTlsCaFile;
  mongoClientOptions.tlsCertificateKeyFile = mongoTlsCertKeyFile;
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  mongoUri: process.env.MONGODB_URI || null,
  mongoDb: process.env.MONGODB_DB || "cfodashboard",
  mongoClientOptions,
  cfoDataDir,
  dirs,
  resolve,
  dataMode,
  myob,
  copilot,
  allowanceLiveSendEnabled: process.env.SNSW_ALLOWANCE_EMAIL_LIVE_SEND === "1",
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || "",
  appOrigin: process.env.APP_ORIGIN || "http://localhost:3000",
  emailFrom: process.env.EMAIL_FROM || "",
  googleUser: process.env.GOOGLE_USER || "",
  googleAppPass: process.env.GOOGLE_APP_PASS || "",
  emailDryRun: process.env.EMAIL_DRY_RUN === "1",
};
