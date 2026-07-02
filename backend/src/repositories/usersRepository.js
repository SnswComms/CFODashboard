// Read-only access to the Better Auth `user` collection following the existing
// repository convention (lib/mongo getDb() — usable only AFTER connectMongo()
// succeeded, like every other repository). Better Auth itself does NOT use
// this file; it manages the collection through its own adapter.
const { getDb } = require("../lib/mongo");

const USER_COLLECTION = "user";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mapping rule: expose `id` (String(_id)), never `_id`, to callers.
function mapUser(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}

// Promise<Array<{id,name,email,role,emailVerified,banned,createdAt}>>
async function listUsers() {
  const docs = await getDb()
    .collection(USER_COLLECTION)
    .find({}, { projection: { name: 1, email: 1, role: 1, emailVerified: 1, banned: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(mapUser);
}

// Promise<object|null> — full user doc mapped: _id -> id (string)
async function findByEmail(email) {
  const doc = await getDb()
    .collection(USER_COLLECTION)
    .findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
  return mapUser(doc);
}

// Promise<number> — used by seed script idempotency messaging
async function countAdmins() {
  return getDb().collection(USER_COLLECTION).countDocuments({ role: "admin" });
}

module.exports = { listUsers, findByEmail, countAdmins };
