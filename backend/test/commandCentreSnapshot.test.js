// Locks the synthetic fallback byte-for-byte: with no live cache configured,
// every command-centre response must be identical to the pre-live-cache
// contract captured in fixtures/command-centre-synthetic.snapshot.json.

// Force synthetic mode regardless of local .env contents. Keys must be SET to
// empty strings (not deleted): dotenv only skips keys that are present, so a
// deleted key would be repopulated from .env when config loads. The copilot
// LLM is pinned off too so the snapshot answers stay deterministic and the
// suite never touches the network.
process.env.CFO_DATA_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.COPILOT_LLM_DISABLED = "1";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { withServer } = require("./helper");

const snapshot = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "command-centre-synthetic.snapshot.json"), "utf8"),
);

test("synthetic command-centre GET responses are byte-identical to the snapshot", async () => {
  await withServer(async (base) => {
    for (const [route, expected] of Object.entries(snapshot.gets)) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), expected, route);
    }
  });
});

test("synthetic copilot answers are byte-identical to the snapshot", async () => {
  await withServer(async (base) => {
    for (const [question, expected] of Object.entries(snapshot.copilot)) {
      const response = await fetch(base + "/api/command-centre/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
      });
      assert.equal(response.status, 200, question);
      assert.equal(await response.text(), expected, question);
    }
  });
});
