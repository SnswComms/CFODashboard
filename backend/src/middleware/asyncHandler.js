function asyncHandler(fn) {
  return (request, response, next) => {
    Promise.resolve(fn(request, response, next)).catch(next);
  };
}

module.exports = asyncHandler;
