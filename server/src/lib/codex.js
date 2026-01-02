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
      resolve({ ok: code === 0, exitCode: code ?? null, loggedIn, text });
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

function buildPrompt({ contextText, chatMessages }) {
  const sys =
    "You are Friday v2, Oliver’s personal assistant.\n" +
    "You must follow the context below (ordered, deterministic).\n" +
    "Be dry-witted but useful (FRIDAY-ish), and do not overpromise.\n" +
    "If the user asks for a state-changing action, treat it as explicit intent and explain what you will do.\n" +
    "Do not run shell commands or modify files unless explicitly asked.\n\n" +
    "Context:\n\n" +
    contextText +
    "\n\n---\n\nConversation:\n";

  const convo = (chatMessages || [])
    .map((m) => `${m.role.toUpperCase()}: ${String(m.content || "")}`)
    .join("\n\n");
  return sys + convo + "\n\nASSISTANT:";
}

async function runCodexExec({ codexPath, codexHomePath, repoRoot, promptText, model, sandboxMode, configOverrides }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-v2-"));
  const outPath = path.join(tmpDir, "last.txt");

  try {
    await new Promise((resolve, reject) => {
      const sandbox = String(sandboxMode || "").trim() || "read-only";
      const args = [
        "exec",
        "-",
        "--output-last-message",
        outPath,
        "--sandbox",
        sandbox,
        "--color",
        "never",
        "--cd",
        repoRoot,
      ];

      const modelName = String(model || "").trim();
      if (modelName) args.splice(2, 0, "--model", modelName);

      const overrides = Array.isArray(configOverrides) ? configOverrides : [];
      for (const o of overrides) {
        const ov = String(o || "").trim();
        if (!ov) continue;
        args.splice(2, 0, "-c", ov);
      }

      const child = spawn(
        codexPath,
        args,
        {
          env: { ...process.env, CODEX_HOME: codexHomePath },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stdin.write(promptText);
      child.stdin.end();
      let err = "";
      child.stderr.on("data", (d) => (err += d.toString("utf8")));
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stripAnsi(err).trim() || `codex exec failed (${code})`));
        else resolve();
      });
    });
    const txt = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
    return String(txt || "").trim();
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
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
