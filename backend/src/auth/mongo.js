const { MongoClient } = require("mongodb");

const config = require("../config");

// Lazy client, SEPARATE from lib/mongo.js singletons — does NOT call
// connectMongo/getDb. `new MongoClient(uri)` never connects until the first
// operation, so app boot works with Mongo down (Better Auth requirement).
let client = null;

function getAuthDb() {
  if (!config.mongoUri) return null; // synthetic mode: no auth persistence
  if (!client) {
    // Shared options (5s server-selection timeout + mutual-TLS certs) match
    // lib/mongo.js so auth and app share one Mongo connection policy.
    client = new MongoClient(config.mongoUri, config.mongoClientOptions);
  }
  return { db: client.db(config.mongoDb || undefined), client };
}

module.exports = { getAuthDb };
