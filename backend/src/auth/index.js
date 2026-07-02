const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { memoryAdapter } = require("better-auth/adapters/memory");
const { admin } = require("better-auth/plugins");

const config = require("../config");
const { getAuthDb } = require("./mongo");

// FROZEN cross-agent interface: sendMail({ to, subject, html, text }) from
// ../lib/mailer and the render* functions from ../emails (owned by the email
// agent, delivered in parallel). Required lazily at send time — never at
// module load — so the app boots even if those files have not landed yet;
// until they exist, outbound mail degrades to a logged no-op.
let mail = null;
function getMail() {
  if (!mail) {
    try {
      mail = { sendMail: require("../lib/mailer").sendMail, emails: require("../emails") };
    } catch (err) {
      console.warn(`[auth] email module unavailable (${err.code || err.message}); mail suppressed`);
      return {
        sendMail: async () => ({ dryRun: true }),
        emails: new Proxy({}, { get: () => () => ({ subject: "", html: "", text: "" }) }),
      };
    }
  }
  return mail;
}

// Admin-create coordination (see AUTH-CONTRACT section 3): when the admin
// create-user flow requests a password reset for a brand-new user, the
// sendResetPassword hook sends the branded WELCOME email (whose CTA is the
// set-password link) instead of the password-reset email.
const welcomePending = new Map(); // email(lowercase) -> { invitedBy: string, markedAt: number }
// If the admin-create flow marks an email but its requestPasswordReset call
// fails (swallowed upstream), the mark would otherwise live for the process
// lifetime and turn a future genuine forgot-password into a welcome email.
// Entries older than this are treated as stale and discarded.
const WELCOME_PENDING_TTL_MS = 10 * 60 * 1000;

function markWelcomePending(email, invitedBy) {
  welcomePending.set(String(email).toLowerCase(), {
    invitedBy: invitedBy || "",
    markedAt: Date.now(),
  });
}

// Called when the admin-create flow fails to request the password reset, so a
// stale mark can't turn a future genuine forgot-password into a welcome email.
function clearWelcomePending(email) {
  welcomePending.delete(String(email).toLowerCase());
}

const handle = getAuthDb(); // { db, client } | null (null in synthetic mode)

const auth = betterAuth({
  secret: config.betterAuthSecret || undefined,
  baseURL: config.appOrigin, // http://localhost:3000
  basePath: "/api/auth",
  trustedOrigins: [config.appOrigin],
  // Synthetic/test mode (no MONGODB_URI): ephemeral in-memory adapter.
  // DEVIATION from AUTH-CONTRACT section 2.1 (which specified memoryAdapter({})):
  // the 1.6.x memory adapter throws "Model user not found" for lookups against
  // undeclared models, turning e.g. sign-in into a 500 instead of a clean 401,
  // so the backing store must pre-declare the Better Auth core models.
  // DEVIATION from AUTH-CONTRACT section 2.2 (ratified by integrator 2026-07-02):
  // `transaction: false` added — the VPS MongoDB is a standalone instance (no
  // replica set), and the adapter defaults to transactions whenever `client`
  // is passed, which makes multi-write flows (e.g. reset-password) fail with
  // "Transaction numbers are only allowed on a replica set member or mongos".
  database: handle
    ? mongodbAdapter(handle.db, { client: handle.client, transaction: false })
    : memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // HARD REQUIREMENT: no public registration
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 3600, // 1 h — email copy says "expires in 60 minutes"
    sendResetPassword: async ({ user, url }) => {
      const { sendMail, emails } = getMail();
      const key = String(user.email).toLowerCase();
      const entry = welcomePending.get(key);
      if (entry) welcomePending.delete(key); // stale or not, it is consumed
      const pending = entry && Date.now() - entry.markedAt <= WELCOME_PENDING_TTL_MS ? entry : null;
      if (pending) {
        void sendMail({
          to: user.email,
          ...emails.renderWelcomeEmail({ name: user.name, url, invitedBy: pending.invitedBy }),
        });
      } else {
        void sendMail({ to: user.email, ...emails.renderPasswordResetEmail({ name: user.name, url }) });
      }
    },
    onPasswordReset: async ({ user }) => {
      const { sendMail, emails } = getMail();
      void sendMail({ to: user.email, ...emails.renderPasswordChangedEmail({ name: user.name }) });
    },
  },
  emailVerification: {
    sendOnSignUp: true, // fires for admin-created users too
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendMail, emails } = getMail();
      void sendMail({ to: user.email, ...emails.renderVerificationEmail({ name: user.name, url }) });
    },
  },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
});

module.exports = { auth, markWelcomePending, clearWelcomePending };
