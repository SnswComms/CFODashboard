const { test } = require("node:test");
const assert = require("node:assert");

// Force dry-run BEFORE any module (config singleton included) is loaded, so no
// test can ever attempt real SMTP I/O regardless of creds in .env.
process.env.EMAIL_DRY_RUN = "1";

const emails = require("../src/emails");
const { sendMail } = require("../src/lib/mailer");

const NAME = "Kyle Morrison";
const URL = "http://localhost:3000/?screen=set-password&token=abc123";

function assertShape(result) {
  assert.strictEqual(typeof result.subject, "string");
  assert.strictEqual(typeof result.html, "string");
  assert.strictEqual(typeof result.text, "string");
  assert.ok(result.subject.length > 0);
  assert.ok(result.html.includes("<!DOCTYPE html>"));
}

test("renderVerificationEmail returns branded subject/html/text with name + url", () => {
  const r = emails.renderVerificationEmail({ name: NAME, url: URL });
  assertShape(r);
  assert.strictEqual(r.subject, "Confirm your email — CFO Dashboard");
  assert.ok(r.html.includes(NAME));
  assert.ok(r.html.includes(`href="${URL.replace(/&/g, "&amp;")}"`));
  assert.ok(r.text.includes(NAME));
  assert.ok(r.text.includes(URL));
  assert.ok(r.text.includes("expires in 60 minutes"));
});

test("renderPasswordResetEmail returns branded subject/html/text with name + url", () => {
  const r = emails.renderPasswordResetEmail({ name: NAME, url: URL });
  assertShape(r);
  assert.strictEqual(r.subject, "Reset your password — CFO Dashboard");
  assert.ok(r.html.includes(NAME));
  assert.ok(r.html.includes(`href="${URL.replace(/&/g, "&amp;")}"`));
  assert.ok(r.html.includes("expires in 60 minutes"));
  assert.ok(r.text.includes(NAME));
  assert.ok(r.text.includes(URL));
});

test("renderWelcomeEmail includes invitedBy when provided", () => {
  const r = emails.renderWelcomeEmail({ name: NAME, url: URL, invitedBy: "Admin Annie" });
  assertShape(r);
  assert.strictEqual(r.subject, "Welcome to CFO Dashboard");
  assert.ok(r.html.includes(NAME));
  assert.ok(r.html.includes("Admin Annie"));
  assert.ok(r.html.includes(`href="${URL.replace(/&/g, "&amp;")}"`));
  assert.ok(r.html.includes("Set your password"));
  assert.ok(r.text.includes("Admin Annie"));
  assert.ok(r.text.includes(URL));
});

test("renderWelcomeEmail degrades gracefully when invitedBy is empty", () => {
  const r = emails.renderWelcomeEmail({ name: NAME, url: URL, invitedBy: "" });
  assertShape(r);
  assert.ok(r.html.includes("An administrator has set up an account"));
  assert.ok(r.text.includes("An administrator has set up an account"));
  assert.ok(!r.html.includes("undefined"));
});

test("renderPasswordChangedEmail returns notice with name, no url required", () => {
  const r = emails.renderPasswordChangedEmail({ name: NAME });
  assertShape(r);
  assert.strictEqual(r.subject, "Your password was changed — CFO Dashboard");
  assert.ok(r.html.includes(NAME));
  assert.ok(r.text.includes(NAME));
  assert.ok(!r.html.includes("expires in 60 minutes"));
});

test("renderAccountStatusEmail switches subject and copy on banned + includes reason", () => {
  const banned = emails.renderAccountStatusEmail({ name: NAME, banned: true, reason: "Policy breach" });
  assertShape(banned);
  assert.strictEqual(banned.subject, "Your account has been suspended — CFO Dashboard");
  assert.ok(banned.html.includes("suspended"));
  assert.ok(banned.html.includes("Policy breach"));
  assert.ok(banned.html.includes("#A8443B"));
  assert.ok(banned.text.includes("Reason: Policy breach"));

  const reinstated = emails.renderAccountStatusEmail({ name: NAME, banned: false, reason: "" });
  assertShape(reinstated);
  assert.strictEqual(reinstated.subject, "Your account has been reinstated — CFO Dashboard");
  assert.ok(reinstated.html.includes("reinstated"));
  assert.ok(reinstated.html.includes("#3E7A55"));
  assert.ok(!reinstated.html.includes("Reason:"));
  assert.ok(!reinstated.html.includes("undefined"));
});

test("templates escape HTML in user-provided fields", () => {
  const r = emails.renderWelcomeEmail({
    name: '<script>alert("x")</script>',
    url: URL,
    invitedBy: "Bob <bob@example.com>",
  });
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes("&lt;script&gt;"));
  assert.ok(r.html.includes("Bob &lt;bob@example.com&gt;"));
});

test("sendMail in dry-run resolves { dryRun: true } and logs to/subject", async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const result = await sendMail({
      to: "user@example.com",
      subject: "Test subject",
      html: "<p>hi</p>",
      text: "hi",
    });
    assert.deepStrictEqual(result, { dryRun: true });
  } finally {
    console.log = origLog;
  }
  const line = logs.find((l) => l.includes("[mailer:dry-run]"));
  assert.ok(line, "expected a dry-run log line");
  assert.ok(line.includes("to=user@example.com"));
  assert.ok(line.includes("subject=Test subject"));
});

test("sendMail resolves { dryRun: true } when creds are missing (dry-run flag unset)", async () => {
  // Fresh module instances with a scrubbed environment.
  const savedEnv = { ...process.env };
  const savedCache = {};
  const ids = ["../src/lib/mailer", "../src/config"].map((p) => require.resolve(p));
  for (const id of ids) {
    savedCache[id] = require.cache[id];
    delete require.cache[id];
  }
  delete process.env.EMAIL_DRY_RUN;
  process.env.GOOGLE_USER = "";
  process.env.GOOGLE_APP_PASS = "";
  const origLog = console.log;
  console.log = () => {};
  try {
    const { sendMail: freshSendMail } = require("../src/lib/mailer");
    const result = await freshSendMail({ to: "x@y.z", subject: "s", html: "<p/>", text: "t" });
    assert.deepStrictEqual(result, { dryRun: true });
  } finally {
    console.log = origLog;
    for (const id of ids) {
      delete require.cache[id];
      if (savedCache[id]) require.cache[id] = savedCache[id];
    }
    process.env = savedEnv;
  }
});
