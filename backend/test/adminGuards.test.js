const { test } = require("node:test");
const assert = require("node:assert");

// Force synthetic auth mode (memory adapter, no Mongo) and mail dry-run BEFORE
// the app/config singletons load. Presence of the keys in process.env prevents
// dotenv from overriding them. node --test runs each file in its own process,
// so this cannot leak into other test files.
process.env.MONGODB_URI = "";
process.env.CFO_DATA_DIR = "";
process.env.EMAIL_DRY_RUN = "1";

// Module-level mail seam: src/auth/index.js captures ../lib/mailer.sendMail
// lazily at first send, so replacing the export on the shared module object
// BEFORE any mail fires lets the tests observe outbound mail without touching
// production code. (Own-process isolation makes this safe.)
const mailer = require("../src/lib/mailer");
const sentMail = [];
mailer.sendMail = async (message) => {
  sentMail.push(message);
  return { dryRun: true };
};

const { withServer } = require("./helper");
const { auth } = require("../src/auth");

// Public sign-up is disabled and admin create-user needs an existing admin
// session, so tests seed users straight through Better Auth's internal
// adapter (memory store) with a credential account they can sign in with.
async function seedUser({ email, name, role, password }) {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    role,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  return user;
}

// Better Auth's origin check rejects POSTs with a missing Origin header, so
// every request must present the trusted app origin (config.appOrigin).
const ORIGIN = require("../src/config").appOrigin;

async function signIn(base, email, password) {
  const res = await fetch(base + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(res.status, 200, `sign-in failed for ${email}: ${res.status}`);
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  assert.ok(setCookies.length > 0, "sign-in returned no session cookie");
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function adminPost(base, cookie, path, body) {
  const res = await fetch(base + "/api/auth" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// Fire-and-forget mail is dispatched with `void sendMail(...)`; yield to the
// microtask/immediate queue so the spy has definitely been invoked.
function settleMail() {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- Self-action guards (hooks.before) ---------------------------------------

test("POST /api/auth/admin/ban-user: self-ban rejected with 400", async () => {
  const admin = await seedUser({
    email: "guard.selfban@example.com",
    name: "Guard SelfBan",
    role: "admin",
    password: "correct-horse-battery",
  });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    const { status, body } = await adminPost(base, cookie, "/admin/ban-user", {
      userId: admin.id,
      banReason: "should never land",
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.code, "SELF_ACTION_NOT_ALLOWED");
  });
});

test("POST /api/auth/admin/remove-user: self-remove rejected with 400", async () => {
  const admin = await seedUser({
    email: "guard.selfremove@example.com",
    name: "Guard SelfRemove",
    role: "admin",
    password: "correct-horse-battery",
  });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    const { status, body } = await adminPost(base, cookie, "/admin/remove-user", {
      userId: admin.id,
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.code, "SELF_ACTION_NOT_ALLOWED");
    // The account must still exist and be usable.
    const ctx = await auth.$context;
    const stillThere = await ctx.internalAdapter.findUserById(admin.id);
    assert.ok(stillThere, "self-remove must not delete the account");
  });
});

test("POST /api/auth/admin/set-role: self-demote rejected with 400", async () => {
  const admin = await seedUser({
    email: "guard.selfrole@example.com",
    name: "Guard SelfRole",
    role: "admin",
    password: "correct-horse-battery",
  });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    const { status, body } = await adminPost(base, cookie, "/admin/set-role", {
      userId: admin.id,
      role: "user",
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.code, "SELF_ACTION_NOT_ALLOWED");
    const ctx = await auth.$context;
    const unchanged = await ctx.internalAdapter.findUserById(admin.id);
    assert.strictEqual(unchanged.role, "admin");
  });
});

test("self-action guard without a session falls through to the plugin's 401", async () => {
  await withServer(async (base) => {
    const { status } = await adminPost(base, "", "/admin/ban-user", {
      userId: "someone-else",
    });
    assert.strictEqual(status, 401);
  });
});

// --- Ban/unban notification emails (hooks.after) ------------------------------

test("banning another user succeeds and emails the affected user (suspended)", async () => {
  const admin = await seedUser({
    email: "guard.banner@example.com",
    name: "Guard Banner",
    role: "admin",
    password: "correct-horse-battery",
  });
  const target = await seedUser({
    email: "guard.banned@example.com",
    name: "Guard Banned",
    role: "user",
    password: "correct-horse-battery",
  });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    sentMail.length = 0;
    const { status, body } = await adminPost(base, cookie, "/admin/ban-user", {
      userId: target.id,
      banReason: "policy breach",
    });
    assert.strictEqual(status, 200);
    assert.ok(body.user, "ban-user should return the updated user");
    await settleMail();
    const mail = sentMail.find((m) => m.to === target.email);
    assert.ok(mail, "affected user should receive an account-status email");
    assert.match(mail.subject, /suspended/i);
    assert.match(mail.text, /policy breach/);
    // The email goes to the affected user, never the acting admin.
    assert.ok(!sentMail.some((m) => m.to === admin.email));
  });
});

test("unbanning a user emails the affected user (reinstated)", async () => {
  const admin = await seedUser({
    email: "guard.unbanner@example.com",
    name: "Guard Unbanner",
    role: "admin",
    password: "correct-horse-battery",
  });
  const target = await seedUser({
    email: "guard.unbanned@example.com",
    name: "Guard Unbanned",
    role: "user",
    password: "correct-horse-battery",
  });
  const ctx = await auth.$context;
  await ctx.internalAdapter.updateUser(target.id, { banned: true, banReason: "seeded ban" });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    sentMail.length = 0;
    const { status, body } = await adminPost(base, cookie, "/admin/unban-user", {
      userId: target.id,
    });
    assert.strictEqual(status, 200);
    assert.ok(body.user, "unban-user should return the updated user");
    await settleMail();
    const mail = sentMail.find((m) => m.to === target.email);
    assert.ok(mail, "affected user should receive an account-status email");
    assert.match(mail.subject, /reinstated/i);
  });
});

test("failed ban (unknown user) sends no account-status email", async () => {
  const admin = await seedUser({
    email: "guard.noop@example.com",
    name: "Guard Noop",
    role: "admin",
    password: "correct-horse-battery",
  });
  await withServer(async (base) => {
    const cookie = await signIn(base, admin.email, "correct-horse-battery");
    sentMail.length = 0;
    const { status } = await adminPost(base, cookie, "/admin/ban-user", {
      userId: "does-not-exist",
    });
    assert.ok(status >= 400, `expected failure, got ${status}`);
    await settleMail();
    assert.strictEqual(sentMail.length, 0);
  });
});
