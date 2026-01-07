const { envString } = require("../config/env");

function envUsdPer1k(key) {
  const raw = envString(key, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function estimateCostUsd({ inputTokens, cachedInputTokens, outputTokens }) {
  const inRate = envUsdPer1k("METERED_USD_PER_1K_INPUT");
  const outRate = envUsdPer1k("METERED_USD_PER_1K_OUTPUT");
  const cachedRate = envUsdPer1k("METERED_USD_PER_1K_CACHED_INPUT");

  if (inRate == null && outRate == null && cachedRate == null) return null;

  const inTok = Number(inputTokens) || 0;
  const cachedTok = Number(cachedInputTokens) || 0;
  const outTok = Number(outputTokens) || 0;

  const uncachedTok = Math.max(0, inTok - cachedTok);
  const costIn =
    (inRate == null ? 0 : (uncachedTok / 1000) * inRate) + (cachedRate == null ? 0 : (cachedTok / 1000) * cachedRate);
  const costOut = outRate == null ? 0 : (outTok / 1000) * outRate;

  const total = costIn + costOut;
  return Number.isFinite(total) ? total : null;
}

module.exports = { estimateCostUsd };
