const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/staffingController");

// Root-mounted legacy aliases sharing the canonical staffing controller:
// - staff-role API (was 127.0.0.1:8767): GET/POST /roles, GET /roles/health
// - allowance-email API (was 127.0.0.1:8791): /api/allowance-emails/*
const router = Router();

router.get("/roles/health", asyncHandler(controller.getRolesHealth));
router.get("/roles", asyncHandler(controller.getRoles));
router.post("/roles", asyncHandler(controller.postRoles));
router.get("/api/allowance-emails/preview", asyncHandler(controller.getAllowancePreview));
router.post("/api/allowance-emails/send", asyncHandler(controller.postAllowanceSend));

module.exports = router;
