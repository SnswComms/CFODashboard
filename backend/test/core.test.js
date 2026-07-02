const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert");

// Force synthetic data mode and point the dashboards dir at a temp fixture dir
// BEFORE the app (and its config singleton) is loaded. Presence of the keys in
// process.env prevents dotenv from overriding them.
process.env.CFO_DATA_DIR = "";
const dashboardsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfo-core-test-"));
fs.writeFileSync(
  path.join(dashboardsDir, "test-dash.html"),
  "<html><body class=\"stripe-cfo\">Test Dash</body></html>"
);
fs.writeFileSync(
  path.join(dashboardsDir, "test-dash-data.json"),
  JSON.stringify({ generated_at: "2026-01-01T00:00:00", source: "test artifact", rows: [1, 2, 3] })
);
fs.writeFileSync(path.join(dashboardsDir, "orphan-page.html"), "<html><body>Orphan</body></html>");
process.env.DASHBOARDS_DIR = dashboardsDir;

const { withServer, requestJson } = require("./helper");

after(() => {
  fs.rmSync(dashboardsDir, { recursive: true, force: true });
});

test("GET /health returns exact legacy body", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/health");
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body, { ok: true });
  });
});

test("GET /api/status returns exact frontend contract", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/status");
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(Object.keys(body).sort(), ["app", "status", "timestamp"]);
    assert.strictEqual(body.app, "CFO Dashboard API");
    assert.strictEqual(body.status, "ready");
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });
});

test("GET /api/config exposes non-secret config", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/config");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.dashboardsRoot, dashboardsDir);
    assert.strictEqual(body.data.workspaceRoot, null);
    assert.strictEqual(body.data.dataMode, "synthetic");
    assert.strictEqual(typeof body.data.port, "number");
    assert.ok(body.meta);
  });
});

test("GET /api/theme returns stripe-cfo tokens", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/theme");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.name, "stripe-cfo");
    assert.strictEqual(body.data.tokens.bg, "#f6f9fc");
    assert.strictEqual(body.data.tokens.purple, "#533afd");
    assert.strictEqual(body.data.tokens.heading, "#061b31");
    assert.strictEqual(body.data.tokens.amberSoft, "#fff7e6");
  });
});

test("GET /api/theme.css returns raw CSS with text/css content type", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/theme.css");
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/css/);
    const css = await response.text();
    assert.ok(css.includes("--stripe-purple:#533afd"));
    assert.ok(css.includes("body.stripe-cfo"));
    assert.ok(!css.includes("fonts.googleapis.com"));
  });
});

test("GET /api/summary returns synthetic fixture shape", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/summary");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "synthetic");
    assert.strictEqual(typeof body.data.generated_at, "string");
    assert.strictEqual(typeof body.data.source, "string");
    assert.ok(Array.isArray(body.data.entities));
    assert.ok(body.data.entities.length >= 1);
    for (const entity of body.data.entities) {
      assert.deepStrictEqual(Object.keys(entity).sort(), ["expense", "income", "name", "net"]);
      assert.strictEqual(typeof entity.income, "number");
    }
  });
});

test("GET /api/summary?entity= filters by slug or name", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/summary?entity=example-entity");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.entities.length, 1);
    assert.strictEqual(body.data.entities[0].name, "Example Entity");

    const none = await requestJson(base, "/api/summary?entity=no-such-entity");
    assert.strictEqual(none.status, 200);
    assert.deepStrictEqual(none.body.data.entities, []);
  });
});

test("GET /api/dashboards scans the dashboards dir", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.total, 2);
    assert.strictEqual(typeof body.data.limit, "number");
    assert.strictEqual(typeof body.data.offset, "number");
    const slugs = body.data.dashboards.map((d) => d.slug);
    assert.deepStrictEqual(slugs, ["orphan-page", "test-dash"]);
    const testDash = body.data.dashboards.find((d) => d.slug === "test-dash");
    assert.strictEqual(testDash.title, "Test Dash");
    assert.strictEqual(testDash.htmlFile, "test-dash.html");
    assert.strictEqual(testDash.jsonFile, "test-dash-data.json");
    assert.ok(!Number.isNaN(Date.parse(testDash.modifiedAt)));
    const orphan = body.data.dashboards.find((d) => d.slug === "orphan-page");
    assert.strictEqual(orphan.jsonFile, null);
  });
});

test("GET /api/dashboards supports limit/offset pagination", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards?limit=1&offset=1");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.total, 2);
    assert.strictEqual(body.data.limit, 1);
    assert.strictEqual(body.data.offset, 1);
    assert.strictEqual(body.data.dashboards.length, 1);
    assert.strictEqual(body.data.dashboards[0].slug, "test-dash");
  });
});

test("GET /api/dashboards rejects invalid pagination (400)", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards?limit=abc");
    assert.strictEqual(status, 400);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "BAD_REQUEST");
  });
});

test("GET /api/dashboards/:slug/data returns raw dashboard JSON", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards/test-dash/data");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "live-cache");
    assert.strictEqual(body.data.source, "test artifact");
    assert.deepStrictEqual(body.data.rows, [1, 2, 3]);
  });
});

test("GET /api/dashboards/summary/data falls back to the synthetic fixture", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards/summary/data");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.meta.dataSource, "synthetic");
    assert.ok(Array.isArray(body.data.entities));
  });
});

test("GET /api/dashboards/:slug/data 404s for unknown slug", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards/unknown-dash/data");
    assert.strictEqual(status, 404);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "NOT_FOUND");
  });
});

test("GET /api/dashboards/:slug/data rejects unsafe slugs (400)", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/dashboards/bad.slug/data");
    assert.strictEqual(status, 400);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "BAD_REQUEST");
  });
});

test("static /dashboards mount serves generated artifacts with no-store", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/dashboards/test-dash.html");
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.strictEqual(response.headers.get("cache-control"), "no-store, max-age=0");
    const html = await response.text();
    assert.ok(html.includes("Test Dash"));

    const missing = await fetch(base + "/dashboards/no-such-file.html");
    assert.strictEqual(missing.status, 404);
  });
});
