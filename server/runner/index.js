const { runNoop } = require("./noop");
const { runOpenAI } = require("./openai");

function getRunnerKind() {
  return String(process.env.FRIDAY_RUNNER || "noop")
    .trim()
    .toLowerCase();
}

async function runAssistant({ context, chat }) {
  const kind = getRunnerKind();
  if (kind === "openai") return runOpenAI({ context, chat });
  return runNoop({ contextFiles: context?.files || [] });
}

module.exports = { runAssistant, getRunnerKind };

