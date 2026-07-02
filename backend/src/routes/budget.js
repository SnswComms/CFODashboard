const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/budgetController");

const router = Router();

router.get("/conference", asyncHandler(controller.getConference));
router.get("/conference/health", asyncHandler(controller.getConferenceHealth));
router.get("/conference/functions", asyncHandler(controller.getConferenceFunctions));
router.get("/conference/decision-cards", asyncHandler(controller.getConferenceDecisionCards));
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/approved", asyncHandler(controller.getApproved));
router.get("/departments", asyncHandler(controller.getDepartments));
// Literal department routes must precede the :slug matcher.
router.get("/departments/mapping", asyncHandler(controller.getDepartmentsMapping));
router.get("/departments/pace", asyncHandler(controller.getDepartmentsPace));
router.get("/departments/:slug", asyncHandler(controller.getDepartment));
router.get("/report-packs", asyncHandler(controller.getReportPacks));
router.get("/report-packs/:id/:file", asyncHandler(controller.getReportPackFile));
router.get("/projections/field", asyncHandler(controller.getFieldProjections));
router.post("/projections/field", asyncHandler(controller.saveFieldProjections));

module.exports = router;
