const { Router } = require("express");

const router = Router();

// requireAuth/requireRole available in ../middleware/requireAuth for future gating of data routes.
router.use(require("./core"));
router.use(require("./adminUsers"));
router.use("/api/budget", require("./budget"));
router.use("/api/cash", require("./cash"));
router.use("/api/command-centre", require("./commandCentre"));
router.use("/api/myob", require("./myob"));
router.use("/api/staffing", require("./staffing"));
router.use("/api/tithe", require("./tithe"));
router.use(require("./entities"));
router.use(require("./compat"));

module.exports = router;
