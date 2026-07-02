const { envelope } = require("../lib/envelope");
const adminUsersService = require("../services/adminUsersService");

async function createUser(request, response) {
  const user = await adminUsersService.createUser(request);
  response.status(201).json(envelope(user, { dataSource: "better-auth" }));
}

module.exports = { createUser };
