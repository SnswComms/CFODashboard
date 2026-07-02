const { test } = require("node:test");
const assert = require("node:assert");

// Force synthetic auth mode (memory adapter, no Mongo) and mail dry-run BEFORE
// the app/config singletons load. Presence of the keys in process.env prevents
// dotenv from overriding them. node --test runs each file in its own process,
// so this cannot leak into other test files.
process.env.MONGODB_URI = "";
process.env.CFO_DATA_DIR = "";
process.env.EMAIL_DRY_RUN = "1";

const { withServer, requestJson } = require("./helper");
const { createRequireAuth } = require("../src/middleware/requireAuth");

function mockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// --- App construction / mount smoke (boots with no MONGODB_URI) -------------

test("GET /health still responds after auth mount", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/health");
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body, { ok: true });
  });
});

test("data route smoke: GET /api/summary still responds after auth mount", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/summary");
    assert.strictEqual(status, 200);
    assert.ok(body.data !== undefined);
  });
});

// --- Better Auth mount + public sign-up disabled -----------------------------

test("POST /api/auth/sign-up/email is rejected (public registration disabled)", async () => {
  await withServer(async (base) => {
    const { status } = await requestJson(base, "/api/auth/sign-up/email", {
      method: "POST",
      body: { email: "intruder@example.com", password: "hunter2hunter2", name: "Intruder" },
    });
    assert.ok(status >= 400, `expected >= 400, got ${status}`);
  });
});

test("POST /api/auth/sign-in/email responds (express.json ordering regression)", async () => {
  await withServer(async (base) => {
    // Guards the "hangs forever" failure mode when express.json() runs before
    // the Better Auth handler, AND the synthetic-mode memoryAdapter({}) 500
    // regression ("Model user not found"): unknown credentials must yield a
    // clean 4xx (401 INVALID_EMAIL_OR_PASSWORD), never a 500.
    const { status } = await requestJson(base, "/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "nobody@example.com", password: "wrong-password" },
    });
    assert.ok(Number.isInteger(status), `expected a response, got ${status}`);
    assert.ok(status >= 400 && status < 500, `expected 4xx, got ${status}`);
  });
});

// --- requireAuth / requireRole unit tests (injectable getSession) ------------

test("requireAuth: null session => 401 UNAUTHORIZED envelope", async () => {
  const { requireAuth } = createRequireAuth(async () => null);
  const res = mockResponse();
  let nextCalled = false;
  await requireAuth({ headers: {} }, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
});

test("requireAuth: getSession throws (e.g. Mongo down) => 401, never 500", async () => {
  const { requireAuth } = createRequireAuth(async () => {
    throw new Error("mongo down");
  });
  const res = mockResponse();
  let nextCalled = false;
  await requireAuth({ headers: {} }, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
});

test("requireRole('admin'): role user => 403 FORBIDDEN envelope", async () => {
  const session = { user: { id: "u1", role: "user" }, session: {} };
  const { requireRole } = createRequireAuth(async () => session);
  const res = mockResponse();
  let nextCalled = false;
  await requireRole("admin")({ headers: {} }, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { ok: false, error: "forbidden", code: "FORBIDDEN" });
});

test("requireRole('admin'): admin => next() called and req.auth set", async () => {
  const session = { user: { id: "u1", role: "admin" }, session: { token: "t" } };
  const { requireRole } = createRequireAuth(async () => session);
  const res = mockResponse();
  const req = { headers: {} };
  let nextCalled = false;
  await requireRole("admin")(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.statusCode, null);
  assert.strictEqual(req.auth, session);
});

test("requireRole('admin'): no session => 401 UNAUTHORIZED", async () => {
  const { requireRole } = createRequireAuth(async () => null);
  const res = mockResponse();
  let nextCalled = false;
  await requireRole("admin")({ headers: {} }, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
});

// --- POST /api/admin/users gating against the real app ----------------------

test("POST /api/admin/users without session => 401 envelope", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/admin/users", {
      method: "POST",
      body: { email: "new.user@example.com", name: "New User", role: "user" },
    });
    assert.strictEqual(status, 401);
    assert.deepStrictEqual(body, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
  });
});
