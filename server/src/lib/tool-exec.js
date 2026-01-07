const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { envNumber, envString } = require("../config/env");

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeBoolean(value) {
  const v = normalizeString(value).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const recentNonces = new Map(); // nonce -> expiresAtMs

function cleanupNonces(nowMs) {
  for (const [nonce, expiresAt] of recentNonces.entries()) {
    if (expiresAt <= nowMs) recentNonces.delete(nonce);
  }
}

function buildSignature({ secret, timestamp, nonce, method, path, body }) {
  const payload = [timestamp, nonce, method.toUpperCase(), path, body].join("\n");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function verifyToolRequest({ req, bodyText }) {
  const secret = envString("FRIDAY_TOOL_HMAC_SECRET", "");
  if (!secret) return { ok: false, error: "tool_auth_not_configured" };

  const timestampRaw = normalizeString(req.headers["x-friday-tool-timestamp"] || req.headers["x-friday-tool-ts"]);
  const nonce = normalizeString(req.headers["x-friday-tool-nonce"]);
  const signature = normalizeString(req.headers["x-friday-tool-signature"]);
  if (!timestampRaw || !nonce || !signature) return { ok: false, error: "tool_auth_missing" };

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return { ok: false, error: "tool_auth_timestamp_invalid" };

  const ttlSeconds = normalizeNumber(envString("FRIDAY_TOOL_HMAC_TTL_S", ""), 300);
  const nowMs = Date.now();
  const deltaMs = Math.abs(nowMs - timestamp);
  if (deltaMs > ttlSeconds * 1000) return { ok: false, error: "tool_auth_expired" };

  cleanupNonces(nowMs);
  if (recentNonces.has(nonce)) return { ok: false, error: "tool_auth_replay" };
  recentNonces.set(nonce, nowMs + ttlSeconds * 1000);

  const expected = buildSignature({
    secret,
    timestamp: timestampRaw,
    nonce,
    method: req.method || "POST",
    path: req.url || "",
    body: bodyText,
  });

  if (!timingSafeEqualHex(expected, signature)) return { ok: false, error: "tool_auth_bad_signature" };

  return { ok: true };
}

async function execCommand({ command, args, cwd, timeoutMs, confirm }) {
  if (!normalizeBoolean(confirm)) return { ok: false, error: "confirm_required" };
  if (!normalizeBoolean(envString("FRIDAY_TOOL_ALLOW_ALL", ""))) return { ok: false, error: "tool_exec_disabled" };

  const cmd = normalizeString(command);
  if (!cmd) return { ok: false, error: "command_required" };

  const argv = Array.isArray(args) ? args.map((a) => String(a)) : [];
  const resolvedCwd = normalizeString(cwd) || process.cwd();
  const resolvedTimeoutMs = Math.max(1000, normalizeNumber(timeoutMs, envNumber("FRIDAY_TOOL_TIMEOUT_MS", 60000)));
  const maxBytes = Math.max(1024, envNumber("FRIDAY_TOOL_MAX_OUTPUT_BYTES", 200000));

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(cmd, argv, { cwd: resolvedCwd, env: process.env });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (chunk, current, truncatedFlag) => {
      if (truncatedFlag.value) return current;
      const next = current + chunk;
      if (next.length > maxBytes) {
        truncatedFlag.value = true;
        return next.slice(0, maxBytes);
      }
      return next;
    };

    const stdoutFlag = { value: false };
    const stderrFlag = { value: false };

    child.stdout.on("data", (d) => {
      stdout = append(String(d), stdout, stdoutFlag);
    });
    child.stderr.on("data", (d) => {
      stderr = append(String(d), stderr, stderrFlag);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, resolvedTimeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: `spawn_failed: ${String(err?.message || err)}`,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        stdoutTruncated: stdoutFlag.value,
        stderrTruncated: stderrFlag.value,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal: signal || null,
        stdout,
        stderr,
        stdoutTruncated: stdoutFlag.value,
        stderrTruncated: stderrFlag.value,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

module.exports = { verifyToolRequest, execCommand };
