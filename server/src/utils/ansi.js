function stripAnsi(input) {
  return String(input || "").replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    "",
  );
}

module.exports = { stripAnsi };

