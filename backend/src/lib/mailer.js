/**
 * Mailer — Gmail SMTP via nodemailer, with a hard dry-run mode.
 *
 * sendMail({ to, subject, html, text }) => Promise<{ dryRun: boolean, messageId?: string }>
 *  - Transport is created lazily on first real send; the module loads fine with no creds.
 *  - If EMAIL_DRY_RUN=1 (config.emailDryRun) OR Gmail creds are missing, logs
 *    `[mailer:dry-run] to=<to> subject=<subject>` and resolves { dryRun: true }
 *    without any network I/O.
 *  - Transport errors never throw: they are logged and resolve { dryRun: false }
 *    so auth flows never 500 because Gmail hiccuped (callers fire-and-forget).
 */
const nodemailer = require("nodemailer");
const config = require("../config");

// Fallbacks keep this module functional even if config has not (yet) been
// extended with the auth/email keys — values converge once config exports them.
function settings() {
  return {
    dryRun: config.emailDryRun !== undefined ? config.emailDryRun : process.env.EMAIL_DRY_RUN === "1",
    user: config.googleUser !== undefined ? config.googleUser : process.env.GOOGLE_USER || "",
    pass: config.googleAppPass !== undefined ? config.googleAppPass : process.env.GOOGLE_APP_PASS || "",
    from: config.emailFrom !== undefined ? config.emailFrom : process.env.EMAIL_FROM || "",
  };
}

let transport = null;

function getTransport(user, pass) {
  if (!transport) {
    transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return transport;
}

// Snapshot of the mailer's effective mode — no network I/O. `live` means a
// sendMail() call right now would attempt a real SMTP delivery (i.e. not
// dry-run and Gmail creds are present); callers surface this so admins are
// not told "sent" while sends silently degrade to logged dry-runs.
function mailStatus() {
  const { dryRun, user, pass, from } = settings();
  const hasCreds = Boolean(user && pass);
  return {
    live: !dryRun && hasCreds,
    dryRun,
    hasCreds,
    from: from || user,
  };
}

async function sendMail({ to, subject, html, text }) {
  const { dryRun, user, pass, from } = settings();
  if (dryRun || !user || !pass) {
    console.log(`[mailer:dry-run] to=${to} subject=${subject}`);
    return { dryRun: true };
  }
  try {
    const info = await getTransport(user, pass).sendMail({
      from: from || user,
      to,
      subject,
      html,
      text,
    });
    return { dryRun: false, messageId: info.messageId };
  } catch (err) {
    console.error(`[mailer] send failed to=${to}:`, err && err.message ? err.message : err);
    return { dryRun: false };
  }
}

module.exports = { sendMail, mailStatus };
