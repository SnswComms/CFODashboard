function noStore(_request, response, next) {
  response.set("Cache-Control", "no-store, max-age=0");
  next();
}

module.exports = noStore;
