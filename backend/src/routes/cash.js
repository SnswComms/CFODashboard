const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const cashController = require("../controllers/cashController");

const router = Router();

router.get("/position", asyncHandler(cashController.getPosition));
router.get("/targets", asyncHandler(cashController.getTargets));
router.get("/candidates", asyncHandler(cashController.getCandidates));
router.get("/cmf/summary", asyncHandler(cashController.getCmfSummary));
router.get("/cmf/balances", asyncHandler(cashController.getCmfBalances));
router.get("/cmf/lines", asyncHandler(cashController.getCmfLines));
router.get("/movements/trend", asyncHandler(cashController.getMovementsTrend));
router.get("/probe", asyncHandler(cashController.getProbe));
router.get("/status", asyncHandler(cashController.getStatus));

module.exports = router;
