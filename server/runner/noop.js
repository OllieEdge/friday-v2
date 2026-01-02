async function runNoop({ contextFiles }) {
  return (
    "Runner not connected yet.\n\n" +
    "Loaded context files:\n" +
    (contextFiles || []).map((f) => `- ${f}`).join("\n") +
    "\n\nTo enable a real runner, set `FRIDAY_RUNNER=openai` and provide `OPENAI_API_KEY` in `.env`."
  );
}

module.exports = { runNoop };

