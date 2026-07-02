const { BadRequestError } = require("./errors");

function enumParam(value, allowed, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!allowed.includes(value)) {
    throw new BadRequestError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function dateParam(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${name} must be formatted YYYY-MM-DD`);
  }
  return value;
}

function digitsParam(value, name) {
  if (!/^[0-9]+$/.test(String(value))) {
    throw new BadRequestError(`${name} must contain only digits`);
  }
  return String(value);
}

function boolParam(value) {
  return value === "true" || value === "1";
}

module.exports = { enumParam, dateParam, digitsParam, boolParam };
