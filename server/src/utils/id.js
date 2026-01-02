const crypto = require("node:crypto");

function newId() {
  return crypto.randomUUID();
}

module.exports = { newId };

