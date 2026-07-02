const express = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const { requireRole } = require("../middleware/requireAuth");
const adminUsersController = require("../controllers/adminUsersController");

const router = express.Router();

// Admin-only user creation (AUTH-CONTRACT section 3). All other admin actions
// (list, setRole, ban, unban, remove, revoke sessions, send reset link) go
// straight to Better Auth's own /api/auth/admin/* endpoints.
router.post("/api/admin/users", requireRole("admin"), asyncHandler(adminUsersController.createUser));

module.exports = router;
