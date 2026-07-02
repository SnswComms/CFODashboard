const cors = require("cors");
const express = require("express");
const { toNodeHandler } = require("better-auth/node");

const config = require("./config");
const noStore = require("./middleware/noStore");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const routes = require("./routes");
const { auth } = require("./auth");

function createApp() {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  // Scoped no-store for auth responses (the global noStore middleware runs
  // after the Better Auth handler, which ends the response itself).
  app.use("/api/auth", (request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  // Better Auth handles its own body parsing — this mount MUST come before
  // express.json() or auth requests hang. `{*any}` is the Express 5 wildcard.
  app.all("/api/auth/{*any}", toNodeHandler(auth));
  app.use(express.json());
  app.use(noStore);
  app.use(routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
