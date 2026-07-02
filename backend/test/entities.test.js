// Force synthetic mode BEFORE the app/config load (DASHBOARDS_DIR is now set
// in .env). Presence of the keys prevents dotenv overrides.
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.MYOB_CACHE_DIR = "";

const test = require("node:test");
const assert = require("node:assert/strict");

const { withServer, requestJson } = require("./helper");

const ENTITY_IDS = ["overview", "snc", "sne_border", "sne_mawson", "sne_narromine", "aav", "snu"];

test("GET /api/entities lists the seven entity pages with signal fields", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/entities");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "synthetic");
    assert.equal(body.data.total, 7);
    assert.deepEqual(body.data.entities.map((entity) => entity.id), ENTITY_IDS);
    for (const entity of body.data.entities) {
      for (const key of ["id", "title", "operating_signal", "cash_on_hand", "staff_cost_signal", "status", "data_state"]) {
        assert.ok(key in entity, `entity ${entity.id} missing ${key}`);
      }
    }
    const border = body.data.entities.find((entity) => entity.id === "sne_border");
    assert.equal(border.operating_signal, null);
    assert.equal(border.cash_on_hand, null);
    assert.equal(border.staff_cost_signal, null);
    assert.equal(border.data_state, "placeholder");
    const snc = body.data.entities.find((entity) => entity.id === "snc");
    assert.equal(typeof snc.operating_signal, "number");
    assert.equal(snc.data_state, "partial");
  });
});

test("GET /api/entities respects limit/offset", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/entities?limit=2&offset=1");
    assert.equal(status, 200);
    assert.equal(body.data.total, 7);
    assert.equal(body.data.entities.length, 2);
    assert.equal(body.data.entities[0].id, "snc");
  });
});

test("GET /api/entities/:entityId returns cards with EvidenceObject payloads", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/entities/snc");
    assert.equal(status, 200);
    assert.equal(body.data.id, "snc");
    assert.equal(typeof body.data.title, "string");
    assert.equal(typeof body.data.subtitle, "string");
    assert.ok(Array.isArray(body.data.cards) && body.data.cards.length > 0);
    assert.ok(Array.isArray(body.data.tiles));
    assert.ok(Array.isArray(body.data.tables));
    for (const card of body.data.cards) {
      const evidence = card.evidence;
      for (const key of ["title", "value", "summary", "period", "basis", "breakdown", "people", "links", "sources", "caveats"]) {
        assert.ok(key in evidence, `card ${card.title} evidence missing ${key}`);
      }
    }
    const pastoral = body.data.cards.find((card) => card.title === "Pastoral payroll lane");
    assert.equal(typeof pastoral.value, "number");
    assert.ok(pastoral.evidence.people.length > 0);
    assert.equal(typeof pastoral.evidence.people[0].cost, "number");
  });
});

test("GET /api/entities/:entityId keeps placeholder values as explicit nulls", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/entities/sne_border");
    assert.equal(status, 200);
    for (const card of body.data.cards) {
      assert.equal(card.value, null, `${card.title} should be a null placeholder, never zero`);
    }
    assert.deepEqual(body.data.tables[0].rows[0].slice(1, 4), [null, null, null]);
  });
});

test("GET /api/entities/:entityId 404s on unknown ids", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/entities/unknown");
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.code, "NOT_FOUND");
  });
});

test("GET /api/constituency-history trims all_files by default", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/constituency-history");
    assert.equal(status, 200);
    assert.equal(body.data.years.length, 7);
    assert.ok(!("all_files" in body.data.years[0]));
    assert.ok(Array.isArray(body.data.claims));
    assert.equal(typeof body.data.all_evidence_count, "number");
  });
});

test("GET /api/constituency-history?include=years returns full year catalogues", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/constituency-history?include=years");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data.years[0].all_files));
    assert.ok(!("claims" in body.data));
  });
});

test("GET /api/constituency-history rejects a bad include value", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/constituency-history?include=everything");
    assert.equal(status, 400);
    assert.equal(body.code, "BAD_REQUEST");
  });
});

test("GET /api/constituency-history/years/:year preserves null published counts", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/constituency-history/years/2005");
    assert.equal(status, 200);
    assert.equal(body.data.year, "2005");
    assert.equal(body.data.trend_point.published_member_count, null);
    assert.equal(body.data.trend_point.published_delegate_count, null);
  });
});

test("GET /api/constituency-history/years/:year 404s outside the fixed year set", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/constituency-history/years/2006");
    assert.equal(status, 404);
    assert.equal(body.code, "NOT_FOUND");
  });
});

test("GET /api/constituency-history/claims scores claims against ?q terms", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(
      base,
      `/api/constituency-history/claims?q=${encodeURIComponent("membership delegate counts")}`
    );
    assert.equal(status, 200);
    assert.ok(body.data.claims.length > 0);
    assert.ok(body.data.claims.length <= 4);
    for (const claim of body.data.claims) {
      assert.equal(typeof claim.score, "number");
      assert.ok(claim.score > 0);
    }
    assert.equal(body.data.claims[0].id, "membership-delegate-spine");
    const scores = body.data.claims.map((claim) => claim.score);
    assert.deepEqual(scores, scores.slice().sort((a, b) => b - a));
  });
});

test("GET /api/constituency-history/claims filters by priority and rejects bad values", async () => {
  await withServer(async (base) => {
    const ok = await requestJson(base, "/api/constituency-history/claims?priority=high");
    assert.equal(ok.status, 200);
    assert.ok(ok.body.data.claims.every((claim) => claim.priority === "high"));

    const bad = await requestJson(base, "/api/constituency-history/claims?priority=urgent");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "BAD_REQUEST");
  });
});

test("GET /api/field-pastoral serves the generator-shaped payload", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/field-pastoral");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "synthetic");
    assert.equal(body.data.history_status.status, "not yet indexed");
    assert.ok(body.data.budget_2026.status.length > 0);
    assert.ok(Array.isArray(body.data.historical_actual_trend));
    assert.ok("budget_reconciliation" in body.data);
    assert.ok("david" in body.data);
  });
});

test("GET /api/field-pastoral/staff filters by category", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(
      base,
      `/api/field-pastoral/staff?category=${encodeURIComponent("Field / pastoral")}&limit=2`
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data.by_category));
    assert.equal(body.data.people.length, 2);
    assert.ok(body.data.people.every((person) => person.category === "Field / pastoral"));
    assert.equal(typeof body.data.direct_conference_total, "number");
    assert.equal(body.data.limit, 2);
  });
});

test("GET /api/field-pastoral/staff rejects an unknown category", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/field-pastoral/staff?category=Nonexistent");
    assert.equal(status, 400);
    assert.equal(body.code, "BAD_REQUEST");
  });
});

test("GET /api/history-comparison returns status rows", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/history-comparison");
    assert.equal(status, 200);
    assert.ok(body.data.rows.length > 0);
    for (const row of body.data.rows) {
      for (const key of ["area", "status", "period", "what", "link", "source"]) {
        assert.ok(key in row, `history row missing ${key}`);
      }
    }
  });
});

test("GET /api/evidence-registry supports confidence filtering", async () => {
  await withServer(async (base) => {
    const all = await requestJson(base, "/api/evidence-registry");
    assert.equal(all.status, 200);
    assert.equal(all.body.data.schema, "evidence-object.schema.json");
    assert.equal(all.body.data.metrics.length, 4);

    const high = await requestJson(base, "/api/evidence-registry?confidence=high");
    assert.equal(high.status, 200);
    assert.ok(high.body.data.metrics.length > 0);
    assert.ok(high.body.data.metrics.every((metric) => metric.confidence === "high"));

    const bad = await requestJson(base, "/api/evidence-registry?confidence=absolute");
    assert.equal(bad.status, 400);
  });
});

test("GET /api/evidence-registry/:metricId returns one metric or 404", async () => {
  await withServer(async (base) => {
    const found = await requestJson(base, "/api/evidence-registry/myob_312510_balance");
    assert.equal(found.status, 200);
    assert.equal(found.body.data.metric_id, "myob_312510_balance");
    assert.equal(found.body.data.account, "312510");

    const missing = await requestJson(base, "/api/evidence-registry/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");
  });
});

test("GET /api/email-intelligence serves the cached JSON shape", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/email-intelligence");
    assert.equal(status, 200);
    assert.equal(typeof body.data.mail_count, "number");
    assert.ok(Array.isArray(body.data.top_senders));
    assert.ok(Array.isArray(body.data.top_domains));
    assert.ok("paths" in body.data);
  });
});

test("GET /api/finance-sources lists the six lanes", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/finance-sources");
    assert.equal(status, 200);
    assert.equal(body.data.lanes.length, 6);
    assert.deepEqual(
      body.data.lanes.map((lane) => lane.id),
      ["myob_morpheus", "sun_legacy", "velixo_workbooks", "payroll", "session_reports", "email_intelligence"]
    );
  });
});

test("GET /api/finance-sources/:laneId returns one lane or 404", async () => {
  await withServer(async (base) => {
    const found = await requestJson(base, "/api/finance-sources/payroll");
    assert.equal(found.status, 200);
    assert.equal(found.body.data.id, "payroll");
    assert.ok(Array.isArray(found.body.data.source_truth));

    const missing = await requestJson(base, "/api/finance-sources/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");
  });
});
