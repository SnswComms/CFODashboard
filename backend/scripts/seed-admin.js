#!/usr/bin/env node
// Seed (or promote) the first admin user.
//
//   Usage: node scripts/seed-admin.js --email you@example.com --name "Your Name"
//
// Requires MONGODB_URI (start the tunnel first: npm run db:tunnel).
// Idempotent: re-running for an existing email prints a notice (promoting the
// role to admin if needed) and exits 0. Sends NO email.

// Force dry-run before any module loads so hook-fired mail (e.g. the
// verification email from sendOnSignUp) can never leave the machine.
process.env.EMAIL_DRY_RUN = "1";

const crypto = require("crypto");

const { MongoClient } = require("mongodb");

const config = require("../src/config");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--email") args.email = argv[i + 1];
    if (argv[i] === "--name") args.name = argv[i + 1];
  }
  return args;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const { email, name } = parseArgs(process.argv.slice(2));
  if (!email || !name) {
    console.error('Usage: node scripts/seed-admin.js --email you@example.com --name "Your Name"');
    process.exit(1);
  }
  if (!config.mongoUri) {
    console.error("MONGODB_URI is not set. Configure backend/.env and start the tunnel: npm run db:tunnel");
    process.exit(1);
  }

  const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(config.mongoDb).command({ ping: 1 });
  } catch (err) {
    console.error(`MongoDB is unreachable: ${err.message}`);
    console.error("Start the SSH tunnel first: npm run db:tunnel");
    process.exit(1);
  }

  const users = client.db(config.mongoDb).collection("user");
  const existing = await users.findOne({
    email: { $regex: `^${escapeRegex(email)}$`, $options: "i" },
  });

  if (existing) {
    if (existing.role !== "admin") {
      await users.updateOne({ _id: existing._id }, { $set: { role: "admin", updatedAt: new Date() } });
      console.log(`Admin already exists: ${existing.email} (role updated: ${existing.role || "user"} -> admin)`);
    } else {
      console.log(`Admin already exists: ${existing.email} (role=admin)`);
    }
    await client.close();
    process.exit(0);
  }

  const password = crypto.randomBytes(18).toString("base64url"); // 24 chars
  const { auth } = require("../src/auth");

  try {
    // Server-side call without headers acts as a trusted server call.
    await auth.api.createUser({ body: { email, password, name, role: "admin" } });
  } catch (err) {
    // Fallback per contract: create through better-auth's internal adapter.
    console.warn(`auth.api.createUser rejected headerless call (${err.message}); using internal adapter.`);
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      email,
      name,
      role: "admin",
      emailVerified: true,
    });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
  }

  // The seed admin should not need the email round-trip.
  await users.updateOne(
    { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );

  console.log(`Admin created: ${email}`);
  console.log(`Password: ${password}`);
  console.log("Store it now; it will not be shown again.");

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
