const { MongoClient } = require("mongodb");

const config = require("../config");

let client = null;
let db = null;

async function connectMongo() {
  if (!config.mongoUri) {
    console.warn("MONGODB_URI not set; MongoDB features are disabled.");
    return null;
  }
  if (db) return db;
  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db(config.mongoDb);
  await db.command({ ping: 1 });
  console.log(`Connected to MongoDB database "${config.mongoDb}"`);
  return db;
}

function getDb() {
  if (!db) throw new Error("MongoDB is not connected. Call connectMongo() at startup.");
  return db;
}

async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connectMongo, getDb, closeMongo };
