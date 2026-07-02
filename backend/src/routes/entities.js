const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/entitiesController");

// Mounted at the app root: full /api/... paths are defined here.
const router = Router();

// Static/literal routes are registered before their ":param" siblings.
router.get("/api/entities", asyncHandler(controller.listEntities));
router.get("/api/entities/:entityId", asyncHandler(controller.getEntity));

router.get("/api/constituency-history", asyncHandler(controller.getConstituencyHistory));
router.get("/api/constituency-history/claims", asyncHandler(controller.getConstituencyClaims));
router.get("/api/constituency-history/years/:year", asyncHandler(controller.getConstituencyYear));

router.get("/api/field-pastoral", asyncHandler(controller.getFieldPastoral));
router.get("/api/field-pastoral/staff", asyncHandler(controller.getFieldPastoralStaff));

router.get("/api/history-comparison", asyncHandler(controller.getHistoryComparison));

router.get("/api/evidence-registry", asyncHandler(controller.getEvidenceRegistry));
router.get("/api/evidence-registry/:metricId", asyncHandler(controller.getEvidenceMetric));

router.get("/api/email-intelligence", asyncHandler(controller.getEmailIntelligence));

router.get("/api/finance-sources", asyncHandler(controller.getFinanceSources));
router.get("/api/finance-sources/:laneId", asyncHandler(controller.getFinanceLane));

module.exports = router;
