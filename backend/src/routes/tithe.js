const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const titheController = require("../controllers/titheController");

const router = Router();

router.get("/dashboard", asyncHandler(titheController.getDashboard));
router.get("/churches/:churchId", asyncHandler(titheController.getChurch));
router.post("/monthly-email/trigger", asyncHandler(titheController.triggerMonthlyEmail));
router.post("/monthly-email/trigger-batch", asyncHandler(titheController.triggerMonthlyEmailBatch));

module.exports = router;
