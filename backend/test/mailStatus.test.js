const { test } = require("node:test");
const assert = require("node:assert");

// Force synthetic auth mode (memory adapter, no Mongo) and a fully degraded
// mailer (dry-run on, no Gmail creds) BEFORE the app/config singletons load.
// Presence of the keys in process.env prevents dotenv from overriding them.
// node --test runs each file in its own process, so this cannot leak into
// other test files.
process.env.MONGODB_URI = "";
process.env.CFO_DATA_DIR = "";
process.env.EMAIL_DRY_RUN = "1";
process.env.GOOGLE_USER = "";
process.env.GOOGLE_APP_PASS = "";
process.env.EMAIL_FROM = "";

const { withServer, requestJson } = require("./helper");
const { mailStatus } = require("../src/lib/mailer");
const { auth } = require("../src/auth");

// Patch auth.api endpoints for one test and always restore them, so the
// unauthenticated-gating tests in this file keep seeing the real
// (session-less) behavior. auth is a process-wide singleton; the middleware
// and service resolve auth.api.* at request time, so this takes effect
// without touching the app wiring.
async function withPatchedApi(patches, fn) {
  const originals = {};
  for (const key of Object.keys(patches)) {
    originals[key] = auth.api[key];
    auth.api[key] = patches[key];
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(originals)) {
      auth.api[key] = originals[key];
    }
  }
}

const adminSession = {
  user: { id: "admin1", role: "admin", name: "Admin", email: "admin@example.com" },
  session: { token: "t" },
};
const userSession = { user: { id: "user1", role: "user" }, session: { token: "t" } };

// --- mailStatus() unit ------------------------------------------------------

test("mailStatus(): dry-run + no creds => live=false snapshot, no network I/O", () => {
  assert.deepStrictEqual(mailStatus(), { live: false, dryRun: true, hasCreds: false, from: "" });
});

// --- GET /api/admin/mail-status gating + payload ------------------------------

test("GET /api/admin/mail-status without session => 401 envelope", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/admin/mail-status");
    assert.strictEqual(status, 401);
    assert.deepStrictEqual(body, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
  });
});

test("GET /api/admin/mail-status as non-admin => 403 envelope", async () => {
  await withPatchedApi({ getSession: async () => userSession }, async () => {
    await withServer(async (base) => {
      const { status, body } = await requestJson(base, "/api/admin/mail-status");
      assert.strictEqual(status, 403);
      assert.deepStrictEqual(body, { ok: false, error: "forbidden", code: "FORBIDDEN" });
    });
  });
});

test("GET /api/admin/mail-status as admin => 200 mailer envelope with live=false", async () => {
  await withPatchedApi({ getSession: async () => adminSession }, async () => {
    await withServer(async (base) => {
      const { status, body } = await requestJson(base, "/api/admin/mail-status");
      assert.strictEqual(status, 200);
      assert.strictEqual(body.meta.dataSource, "mailer");
      assert.deepStrictEqual(body.data, { live: false, dryRun: true, hasCreds: false, from: "" });
    });
  });
});

// --- POST /api/admin/users self-describes mail delivery -----------------------

test("POST /api/admin/users response includes mailLive (false in dry-run env)", async () => {
  await withPatchedApi(
    {
      getSession: async () => adminSession,
      createUser: async () => ({ user: { id: "u-new" } }),
      sendVerificationEmail: async () => ({}),
      requestPasswordReset: async () => ({}),
    },
    async () => {
      await withServer(async (base) => {
        const { status, body } = await requestJson(base, "/api/admin/users", {
          method: "POST",
          body: { email: "new.user@example.com", name: "New User", role: "user" },
        });
        assert.strictEqual(status, 201);
        assert.strictEqual(body.data.id, "u-new");
        assert.strictEqual(body.data.email, "new.user@example.com");
        assert.strictEqual(body.data.mailLive, false);
      });
    }
  );
});
