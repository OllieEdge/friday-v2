const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const { stripAnsi } = require("../utils/ansi");

function resolveCodexPath() {
  const fromEnv = String(process.env.CODEX_PATH || "").trim();
  if (fromEnv) return fromEnv;
  const candidates = ["/Users/ollie/bin/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  try {
    const extDir = path.join(os.homedir(), ".vscode", "extensions");
    if (fs.existsSync(extDir) && fs.statSync(extDir).isDirectory()) {
      const entries = fs
        .readdirSync(extDir)
        .filter((n) => n.startsWith("openai.chatgpt-"))
        .sort((a, b) => b.localeCompare(a, "en"));
      for (const e of entries) {
        const maybe = path.join(extDir, e, "bin");
        if (!fs.existsSync(maybe)) continue;
        const bins = fs.readdirSync(maybe, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        for (const b of bins) {
          const candidate = path.join(maybe, b, "codex");
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  } catch {
    // ignore
  }
  return "codex";
}

function runCodexLoginStatus({ codexPath, codexHomePath }) {
  return new Promise((resolve) => {
    const child = spawn(codexPath, ["login", "status"], {
      env: { ...process.env, CODEX_HOME: codexHomePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (out += d.toString("utf8")));
    child.on("close", (code) => {
      const text = stripAnsi(out).trim();
      const loggedIn = code === 0 && !/not logged in/i.test(text);
      const authMode = /api key/i.test(text) ? "api_key" : loggedIn ? "device" : "unknown";
      resolve({ ok: code === 0, exitCode: code ?? null, loggedIn, authMode, text });
    });
  });
}

function runCodexLogout({ codexPath, codexHomePath }) {
  return new Promise((resolve) => {
    const child = spawn(codexPath, ["logout"], {
      env: { ...process.env, CODEX_HOME: codexHomePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (out += d.toString("utf8")));
    child.on("close", (code) => resolve({ ok: code === 0, exitCode: code ?? null, text: stripAnsi(out).trim() }));
  });
}

function startDeviceLogin({ codexPath, codexHomePath, onLine }) {
  const child = spawn(codexPath, ["login", "--device-auth"], {
    env: { ...process.env, CODEX_HOME: codexHomePath },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });
  rlOut.on("line", (line) => onLine({ stream: "stdout", line: stripAnsi(line) }));
  rlErr.on("line", (line) => onLine({ stream: "stderr", line: stripAnsi(line) }));

  return child;
}

function buildPrompt({ contextText, chatMessages }, { mode } = {}) {
  const m = String(mode || "").trim().toLowerCase();
  const policy =
    m === "runbook"
      ? "You are running a scheduled runbook/background job.\n" +
        "- You MUST run any commands included in the runbook instructions (do not just describe them).\n" +
        "- You may run shell commands as needed to query data.\n" +
        "- Avoid side-effect actions unless the runbook explicitly asks (and sandbox may prevent writes).\n"
      : "Do not run shell commands or modify files unless explicitly asked.\n";

  const sys =
    "You are Friday v2, Oliver’s personal assistant.\n" +
    "You must follow the context below (ordered, deterministic).\n" +
    "Be dry-witted but useful (FRIDAY-ish), and do not overpromise.\n" +
    "If the user asks for a state-changing action, treat it as explicit intent and explain what you will do.\n" +
    policy +
    "\nContext:\n\n" +
    contextText +
    "\n\n---\n\nConversation:\n";

  const convo = (chatMessages || [])
    .map((m) => `${m.role.toUpperCase()}: ${String(m.content || "")}`)
    .join("\n\n");
  return sys + convo + "\n\nASSISTANT:";
}

async function runCodexExec({
  codexPath,
  codexHomePath,
  repoRoot,
  promptText,
  model,
  sandboxMode,
  configOverrides,
  onJsonEvent,
}) {
  return new Promise((resolve, reject) => {
    const sandbox = String(sandboxMode || "").trim() || "read-only";
    const args = ["exec", "-", "--json", "--sandbox", sandbox, "--color", "never", "--cd", repoRoot];

    const modelName = String(model || "").trim();
    if (modelName) args.splice(2, 0, "--model", modelName);

    const overrides = Array.isArray(configOverrides) ? configOverrides : [];
    for (const o of overrides) {
      const ov = String(o || "").trim();
      if (!ov) continue;
      args.splice(2, 0, "-c", ov);
    }

    const child = spawn(codexPath, args, {
      env: { ...process.env, CODEX_HOME: codexHomePath },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let lastText = "";
    let usage = null;
    let err = "";
    let lastCodexError = "";
    let nonJsonLines = [];

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;
      try {
        const ev = JSON.parse(trimmed);
        if (typeof onJsonEvent === "function") onJsonEvent(ev);
        if (ev?.type === "item.completed" && ev?.item?.type === "agent_message") {
          lastText = String(ev?.item?.text || "");
        }
        if (ev?.type === "error" && typeof ev?.message === "string" && ev.message.trim()) {
          lastCodexError = ev.message.trim();
        }
        if (ev?.type === "turn.failed" && typeof ev?.error?.message === "string" && ev.error.message.trim()) {
          lastCodexError = ev.error.message.trim();
        }
        if (ev?.type === "turn.completed" && ev?.usage) {
          usage = {
            inputTokens: Number(ev.usage.input_tokens) || 0,
            cachedInputTokens: Number(ev.usage.cached_input_tokens) || 0,
            outputTokens: Number(ev.usage.output_tokens) || 0,
          };
        }
      } catch {
        // Keep a short tail of non-JSON output for better error messages.
        nonJsonLines.push(trimmed);
        if (nonJsonLines.length > 20) nonJsonLines.splice(0, nonJsonLines.length - 20);
      }
    });

    child.stderr.on("data", (d) => (err += d.toString("utf8")));

    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      rl.close();
      if (code !== 0) {
        const stderr = stripAnsi(err).trim();
        const stdoutTail = stripAnsi(nonJsonLines.join("\n")).trim();
        const msg = stderr || lastCodexError || stdoutTail || `codex exec failed (${code})`;
        return reject(new Error(msg));
      }
      return resolve({ content: String(lastText || "").trim(), usage });
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function parseDeviceInfo(lines) {
  const joined = lines.join("\n");
  const urlMatch = joined.match(/https?:\/\/[^\s]+/);
  const codeMatch = joined.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/);
  if (!urlMatch || !codeMatch) return null;
  return { url: urlMatch[0], code: codeMatch[0] };
}

module.exports = {
  resolveCodexPath,
  runCodexLoginStatus,
  runCodexLogout,
  startDeviceLogin,
  parseDeviceInfo,
  buildPrompt,
  runCodexExec,
};
