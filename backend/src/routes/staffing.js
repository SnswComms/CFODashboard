const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/staffingController");

const router = Router();

router.get("/budget-app", asyncHandler(controller.getBudgetApp));
router.get("/pastor-load", asyncHandler(controller.getPastorLoad));
router.get("/payroll", asyncHandler(controller.getPayroll));
router.post("/scenario", asyncHandler(controller.postScenario));
router.get("/office-map", asyncHandler(controller.getOfficeMap));
router.get("/office-map/people", asyncHandler(controller.getOfficePeople));
router.get("/roles/health", asyncHandler(controller.getRolesHealth));
router.get("/roles", asyncHandler(controller.getRoles));
router.post("/roles", asyncHandler(controller.postRoles));
router.get("/allowance-emails/preview", asyncHandler(controller.getAllowancePreview));
router.post("/allowance-emails/send", asyncHandler(controller.postAllowanceSend));

module.exports = router;
