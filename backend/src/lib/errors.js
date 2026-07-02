class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class BadRequestError extends HttpError {
  constructor(message = "bad request") {
    super(400, "BAD_REQUEST", message);
  }
}

class NotFoundError extends HttpError {
  constructor(message = "not found") {
    super(404, "NOT_FOUND", message);
  }
}

class UnavailableError extends HttpError {
  constructor(message = "data source unavailable") {
    super(503, "UNAVAILABLE", message);
  }
}

module.exports = { HttpError, BadRequestError, NotFoundError, UnavailableError };
