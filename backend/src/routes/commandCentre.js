const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/commandCentreController");

const router = Router();

router.get("/overview", asyncHandler(controller.getOverview));
router.get("/functions", asyncHandler(controller.getFunctions));
router.get("/departments", asyncHandler(controller.getDepartments));
router.get("/lanes", asyncHandler(controller.getLanes));
router.post("/copilot", asyncHandler(controller.postCopilot));
router.get("/staffing-baseline", asyncHandler(controller.getStaffingBaseline));
router.get("/field", asyncHandler(controller.getField));
router.get("/entities", asyncHandler(controller.getEntities));
router.get("/sources", asyncHandler(controller.getSources));

module.exports = router;
