const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/myobController");
const historyController = require("../controllers/myobHistoryController");
const syncController = require("../controllers/myobSyncController");

const router = Router();

router.get("/sources", asyncHandler(controller.getSources));

// Read-only sync runs (GET-only against MYOB; refreshes the local caches).
router.post("/sync", asyncHandler(syncController.startSync));
router.get("/sync/status", asyncHandler(syncController.getStatus));

// Historical Mongo store (parallel layer): chart-of-accounts drift for one
// backfilled FY, and the human mapping approval that gates its visibility.
router.get("/history/drift", asyncHandler(historyController.getDrift));
router.post("/history/approve", asyncHandler(historyController.approveFy));

router.get("/accounts", asyncHandler(controller.listAccounts));
router.get("/accounts/:code", asyncHandler(controller.getAccount));
router.get("/accounts/:code/drilldown", asyncHandler(controller.getAccountDrilldown));
router.get("/accounts/:code/transactions", asyncHandler(controller.listAccountTransactions));

router.get("/drilldowns", asyncHandler(controller.listDrilldowns));

router.get("/entities/:entity", asyncHandler(controller.listEntityRows));

router.get("/broad/summary", asyncHandler(controller.getBroadSummary));
router.get("/broad/branches", asyncHandler(controller.getBroadBranches));

router.get("/gl/summary", asyncHandler(controller.getGlSummary));
router.get("/gl/accounts", asyncHandler(controller.listGlAccounts));
router.get("/gl/lines", asyncHandler(controller.listGlLines));
router.get("/gl/periods", asyncHandler(controller.listGlPeriods));
router.get("/gl/activity", asyncHandler(controller.listGlActivity));

// Literal benefits routes registered before the :code param route.
router.get("/benefits/summary", asyncHandler(controller.getBenefitsSummary));
router.get("/benefits/employees", asyncHandler(controller.listBenefitsEmployees));
router.get("/benefits/transactions", asyncHandler(controller.listBenefitsTransactions));
router.get("/benefits/categories", asyncHandler(controller.listBenefitsCategories));
router.get("/benefits/employees/:code", asyncHandler(controller.getBenefitsEmployee));

module.exports = router;
