const createApp = require("../src/app");

async function withServer(fn) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

module.exports = { withServer, requestJson };
