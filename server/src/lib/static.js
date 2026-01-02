const fs = require("node:fs");
const path = require("node:path");

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".map") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeJoinStatic(baseDir, urlPath) {
  const cleaned = urlPath.replace(/\0/g, "");
  const rel = cleaned === "/" ? "/index.html" : cleaned;
  const abs = path.resolve(baseDir, `.${rel}`);
  if (!abs.startsWith(baseDir)) return null;
  return abs;
}

function serveStatic({ baseDir, urlPath, res }) {
  const filePath = safeJoinStatic(baseDir, urlPath);
  if (!filePath) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "content-length": body.length,
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=60",
  });
  res.end(body);
  return true;
}

function serveSpaFallback({ baseDir, res }) {
  const indexPath = path.join(baseDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;
  const body = fs.readFileSync(indexPath);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
  return true;
}

module.exports = { serveStatic, serveSpaFallback };

