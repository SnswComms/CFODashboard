const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const controller = require("../controllers/myobController");
const historyController = require("../controllers/myobHistoryController");
const syncController = require("../controllers/myobSyncController");
const metricPullController = require("../controllers/metricPullController");

const router = Router();

router.get("/sources", asyncHandler(controller.getSources));

// Read-only sync runs (GET-only against MYOB; refreshes the local caches).
router.post("/sync", asyncHandler(syncController.startSync));
router.get("/sync/status", asyncHandler(syncController.getStatus));

// Per-metric live pull (GET-only against MYOB; scoped to ONE figure, its own
// cache, no global sync lock). The literal /metrics catalog is registered
// before the :id param route. The pull is a POST — it triggers a MYOB read and
// a local cache write (a state change), so it must not be a cacheable/prefetchable
// GET; the catalog and last-value reads stay GET (side-effect free).
router.get("/metrics", asyncHandler(metricPullController.listMetrics));
router.post("/metrics/:id/pull", asyncHandler(metricPullController.pullMetric));
router.get("/metrics/:id", asyncHandler(metricPullController.getMetric));

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
