const config = require("./config");
const createApp = require("./app");
const { connectMongo, closeMongo } = require("./lib/mongo");
const { startScheduler } = require("./services/myobSyncService");
const { startMonthlyEmailScheduler } = require("./services/titheService");

async function main() {
  try {
    await connectMongo();
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`);
    console.error("If running locally, start the SSH tunnel first: npm run db:tunnel");
    process.exit(1);
  }

  const server = createApp().listen(config.port, () => {
    console.log(`Backend API listening on http://localhost:${config.port} (data mode: ${config.dataMode()})`);
  });

  startScheduler();
  startMonthlyEmailScheduler();

  const shutdown = () => {
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
