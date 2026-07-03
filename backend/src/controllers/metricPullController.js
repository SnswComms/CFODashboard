const { envelope } = require("../lib/envelope");
const metricPullService = require("../services/metricPullService");
const { METRICS, metricCatalogEntry } = require("../constants/metricRegistry");

// GET /api/myob/metrics — the per-metric pull catalog (every card that carries
// its own refresh control). Static registry, so no data source / timestamp.
async function listMetrics(request, response) {
  const data = { count: METRICS.length, metrics: METRICS.map(metricCatalogEntry) };
  response.json(envelope(data, { dataSource: "static", generated_at: null }));
}

// GET /api/myob/metrics/:id — the last per-metric pull for one card, WITHOUT
// hitting MYOB. Missing (data null) until the card has been refreshed at least
// once; the shared full-sync caches stay the default source everywhere else.
async function getMetric(request, response) {
  const { data, meta, running } = metricPullService.getMetricValue(request.params.id);
  response.json(envelope(data, { ...meta, extra: { running } }));
}

// GET /api/myob/metrics/:id/pull — trigger a scoped, read-only MYOB fetch for
// ONE figure, recompute it via the shared builders, persist its own cache file
// and return the fresh value inline. GET-only: this endpoint reads from MYOB and
// writes only the local per-metric cache — it never writes back to MYOB. Does
// not take the global sync lock; two different metrics can pull at once. 409
// when the SAME metric already has a pull in flight (served the last value).
async function pullMetric(request, response) {
  const result = await metricPullService.pullMetric(request.params.id);
  const { data, meta } = result;
  if (!result.started) {
    response
      .status(409)
      .json(envelope(data, { ...meta, warnings: ["a pull for this metric is already in progress"] }));
    return;
  }
  response.json(envelope(data, meta));
}

module.exports = { listMetrics, getMetric, pullMetric };
