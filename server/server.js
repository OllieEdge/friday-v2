const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { URL } = require("node:url");

const { createStore } = require("./storage");
const { loadContextBundle } = require("./context-loader");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const CONTEXT_DIR = path.join(ROOT, "ai-context");

const store = createStore({ dataDir: DATA_DIR });

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  const body = String(text ?? "");
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => (buf += d));
    req.on("end", () => {
      if (!buf) return resolve(null);
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function safeJoinPublic(urlPath) {
  const cleaned = urlPath.replace(/\0/g, "");
  const rel = cleaned === "/" ? "/index.html" : cleaned;
  const abs = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  return abs;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function notFound(res) {
  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/context") {
    const bundle = loadContextBundle({ contextDir: CONTEXT_DIR });
    return sendJson(res, 200, { ok: true, context: bundle });
  }

  if (req.method === "GET" && url.pathname === "/api/chats") {
    return sendJson(res, 200, { ok: true, chats: store.listChats().map(({ messages, ...c }) => c) });
  }

  if (req.method === "POST" && url.pathname === "/api/chats") {
    const body = await parseJsonBody(req).catch(() => null);
    const chat = store.createChat({ title: body?.title });
    return sendJson(res, 201, { ok: true, chat });
  }

  const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === "GET" && chatMatch) {
    const chat = store.getChat(chatMatch[1]);
    if (!chat) return notFound(res);
    return sendJson(res, 200, { ok: true, chat });
  }

  const msgMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (req.method === "POST" && msgMatch) {
    const chatId = msgMatch[1];
    const body = await parseJsonBody(req).catch(() => null);
    const userMsg = store.appendMessage({ chatId, role: "user", content: body?.content ?? "" });
    if (!userMsg) return notFound(res);

    // Placeholder: v2 will invoke a runner (Codex CLI etc). For now, echo back context + message.
    const context = loadContextBundle({ contextDir: CONTEXT_DIR });
    const assistantContent =
      "Runner not connected yet.\n\n" +
      "Loaded context files:\n" +
      context.files.map((f) => `- ${f}`).join("\n") +
      "\n\nYour message:\n" +
      (body?.content ?? "");

    const assistantMsg = store.appendMessage({ chatId, role: "assistant", content: assistantContent });
    return sendJson(res, 201, { ok: true, messages: [userMsg, assistantMsg] });
  }

  return notFound(res);
}

function serveStatic(req, res, url) {
  const filePath = safeJoinPublic(url.pathname);
  if (!filePath) return notFound(res);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return notFound(res);
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "content-length": body.length,
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=60",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) });
  }
});

const PORT = Number(process.env.PORT || 3333);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Friday v2 listening on http://localhost:${PORT}`);
});

