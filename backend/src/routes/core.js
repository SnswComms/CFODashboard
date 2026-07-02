const express = require("express");

const config = require("../config");
const asyncHandler = require("../middleware/asyncHandler");
const coreController = require("../controllers/coreController");

const router = express.Router();

router.get("/health", asyncHandler(coreController.health));
router.get("/api/status", asyncHandler(coreController.status));
router.get("/api/config", asyncHandler(coreController.getConfig));
router.get("/api/theme.css", asyncHandler(coreController.getThemeCss));
router.get("/api/theme", asyncHandler(coreController.getTheme));
router.get("/api/summary", asyncHandler(coreController.getSummary));
router.get("/api/dashboards", asyncHandler(coreController.listDashboards));
router.get("/api/dashboards/:slug/data", asyncHandler(coreController.getDashboardData));

// Node replacement for serve_cfo_dashboards.py (:8770): static mount of the
// generated dashboards dir. cacheControl:false keeps the app-level
// "no-store, max-age=0" header intact. Skipped gracefully when unset —
// requests then fall through to the global 404 handler.
if (config.dirs.dashboards) {
  router.use("/dashboards", express.static(config.dirs.dashboards, { cacheControl: false }));
}

module.exports = router;
