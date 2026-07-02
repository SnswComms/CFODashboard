const { BadRequestError } = require("./errors");

function parseNonNegativeInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parsePagination(query, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const limit = query.limit === undefined ? defaultLimit : parseNonNegativeInt(query.limit, "limit");
  const offset = query.offset === undefined ? 0 : parseNonNegativeInt(query.offset, "offset");
  return { limit: Math.min(limit, maxLimit), offset };
}

function paginate(rows, { limit, offset }) {
  return {
    total: rows.length,
    limit,
    offset,
    rows: rows.slice(offset, offset + limit),
  };
}

module.exports = { parsePagination, paginate };
