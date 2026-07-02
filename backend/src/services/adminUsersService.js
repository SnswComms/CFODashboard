const crypto = require("crypto");

const { fromNodeHeaders } = require("better-auth/node");

const { auth, markWelcomePending } = require("../auth");
const { HttpError, BadRequestError } = require("../lib/errors");

const VALID_ROLES = new Set(["admin", "user"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapAuthError(error) {
  if (error instanceof HttpError) return error;
  const status = Number(error?.statusCode ?? (typeof error?.status === "number" ? error.status : NaN));
  const message = error?.body?.message || error?.message || "";
  if (/exist/i.test(message)) return new BadRequestError("user already exists");
  if (status === 401) return new HttpError(401, "UNAUTHORIZED", "unauthorized");
  if (status === 403) return new HttpError(403, "FORBIDDEN", "forbidden");
  if (status >= 400 && status < 500) return new BadRequestError(message || "bad request");
  return error;
}

// Admin-only creation flow (AUTH-CONTRACT section 3):
//  1. Create the user with a throwaway password (never shown, never emailed).
//     DEVIATION from the contract (ratified by integrator 2026-07-02):
//     emailVerification.sendOnSignUp does NOT fire for the admin plugin's
//     createUser in better-auth 1.6.23 (only for the public sign-up route),
//     so the branded verification email is sent explicitly via
//     auth.api.sendVerificationEmail below — same mail, deterministic call.
//  2. Mark the email welcome-pending, then request a password reset so the
//     sendResetPassword hook sends the branded WELCOME email whose CTA is the
//     set-password link. Temp passwords NEVER travel by email.
async function createUser(request) {
  const { email, name, role } = request.body || {};
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestError("a valid email is required");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new BadRequestError("name is required");
  }
  if (!VALID_ROLES.has(role)) {
    throw new BadRequestError('role must be "admin" or "user"');
  }

  let created;
  try {
    created = await auth.api.createUser({
      body: {
        email,
        password: crypto.randomBytes(32).toString("base64url"),
        name: name.trim(),
        role,
      },
      headers: fromNodeHeaders(request.headers),
    });
  } catch (error) {
    throw mapAuthError(error);
  }

  try {
    // Mail 1: confirm-mailbox verification (sendOnSignUp does not cover
    // admin-created users — see DEVIATION note above). The callbackURL matches
    // the frontend contract: verification links land on /?verified=1.
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: "/?verified=1" } });
  } catch (error) {
    // Non-fatal: the confirm screen's "Resend link" covers a failed send.
    console.error(`[adminUsers] sendVerificationEmail failed for ${email}:`, error?.message || error);
  }

  const inviter = request.auth?.user;
  markWelcomePending(email, inviter ? inviter.name || inviter.email || "" : "");
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/?screen=set-password" } });
  } catch (error) {
    // The user exists; the admin can re-send the set-password link from the
    // Admin view, so a failed welcome mail must not fail the 201.
    console.error(`[adminUsers] requestPasswordReset failed for ${email}:`, error?.message || error);
  }

  return {
    id: created?.user ? String(created.user.id) : null,
    email,
    name: name.trim(),
    role,
    emailVerified: false,
  };
}

module.exports = { createUser };
