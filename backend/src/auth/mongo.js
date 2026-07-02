const { MongoClient } = require("mongodb");

const config = require("../config");

// Lazy client, SEPARATE from lib/mongo.js singletons — does NOT call
// connectMongo/getDb. `new MongoClient(uri)` never connects until the first
// operation, so app boot works with Mongo down (Better Auth requirement).
let client = null;

function getAuthDb() {
  if (!config.mongoUri) return null; // synthetic mode: no auth persistence
  if (!client) {
    client = new MongoClient(config.mongoUri, {
      // Match lib/mongo.js so a downed tunnel fails requests in ~5s instead
      // of the driver's 30s default (keeps auth endpoints responsive).
      serverSelectionTimeoutMS: 5000,
    });
  }
  return { db: client.db(config.mongoDb || undefined), client };
}

module.exports = { getAuthDb };
