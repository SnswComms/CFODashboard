// Session-gating middleware built on Better Auth.
//
// TEST HOOK (documented per AUTH-CONTRACT section 7): `createRequireAuth(getSessionFn)`
// is exported for unit tests — it returns { requireAuth, requireRole } bound to an
// injectable `getSession(req) => Promise<{ user, session } | null>`. The default
// export pair is bound to Better Auth's real auth.api.getSession.
const { fromNodeHeaders } = require("better-auth/node");

const { auth } = require("../auth");

function defaultGetSession(request) {
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}

function unauthorized(response) {
  response.status(401).json({ ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
}

function forbidden(response) {
  response.status(403).json({ ok: false, error: "forbidden", code: "FORBIDDEN" });
}

function hasRole(user, role) {
  // The admin plugin stores role as a string, possibly comma-separated.
  return String(user?.role || "")
    .split(",")
    .map((value) => value.trim())
    .includes(role);
}

function createRequireAuth(getSession = defaultGetSession) {
  // Resolves the session and attaches it as req.auth; any failure (including
  // Mongo down) yields 401 — never a 500.
  async function resolveSession(request) {
    try {
      const session = await getSession(request);
      if (session && session.user) return session;
    } catch {
      // fall through to null
    }
    return null;
  }

  async function requireAuth(request, response, next) {
    const session = await resolveSession(request);
    if (!session) return unauthorized(response);
    request.auth = session;
    next();
  }

  function requireRole(role) {
    return async function requireRoleMiddleware(request, response, next) {
      if (!request.auth) {
        const session = await resolveSession(request);
        if (!session) return unauthorized(response);
        request.auth = session;
      }
      if (!hasRole(request.auth.user, role)) return forbidden(response);
      next();
    };
  }

  return { requireAuth, requireRole };
}

const { requireAuth, requireRole } = createRequireAuth();

module.exports = { requireAuth, requireRole, createRequireAuth };
