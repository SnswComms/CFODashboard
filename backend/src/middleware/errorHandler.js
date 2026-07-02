const { HttpError } = require("../lib/errors");

function notFoundHandler(_request, response) {
  response.status(404).json({ ok: false, error: "not found", code: "NOT_FOUND" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, _request, response, _next) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ ok: false, error: error.message, code: error.code });
    return;
  }
  if (error.type === "entity.parse.failed") {
    response.status(400).json({ ok: false, error: "invalid JSON body", code: "BAD_REQUEST" });
    return;
  }
  console.error(error);
  response.status(500).json({ ok: false, error: "internal server error", code: "INTERNAL" });
}

module.exports = { notFoundHandler, errorHandler };
