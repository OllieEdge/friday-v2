function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHead(res, status, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end();
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

function sendNoContent(res) {
  res.writeHead(204, { "cache-control": "no-store" });
  res.end();
}

module.exports = { sendJson, sendHead, sendText, sendNoContent };
