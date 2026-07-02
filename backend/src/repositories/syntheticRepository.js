const config = require("../config");
const { readJsonFile } = require("./jsonFileRepository");

function readFixture(fixtureFile) {
  return readJsonFile(config.resolve("synthetic", fixtureFile));
}

module.exports = { readFixture };
