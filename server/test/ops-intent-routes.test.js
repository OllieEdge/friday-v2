const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { URL } = require("node:url");

const { createRouter } = require("../src/http/router");
const { registerOps } = require("../src/routes/ops");

function buildReq({ method = "GET", path = "/", body = null, headers = {} } = {}) {
  const payload = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = String(method || "GET").toUpperCase();
  req.url = String(path || "/");
  req.headers = payload
    ? {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        ...headers,
      }
    : { ...headers };
  return req;
}

function buildRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    writeHead(status, headers = {}) {
      this.statusCode = Number(status || 200);
      this.headers = { ...headers };
    },
    end(chunk = "") {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks).toString("utf8");
      this.ended = true;
    },
    body: "",
    ended: false,
  };
}

async function hit(router, { method, path, body, headers } = {}) {
  const req = buildReq({ method, path, body, headers });
  const res = buildRes();
  const url = new URL(String(path || "/"), "http://127.0.0.1:3333");
  const handled = await router.handle(req, res, url);
  const parsed = res.body ? JSON.parse(res.body) : null;
  return { handled, status: res.statusCode, headers: res.headers, body: parsed };
}

function withPatchedFs(testFn) {
  return async () => {
    const originalAppend = fs.appendFileSync;
    fs.appendFileSync = () => {};
    try {
      await testFn();
    } finally {
      fs.appendFileSync = originalAppend;
    }
  };
}

function setupOpsRouter() {
  const router = createRouter();
  registerOps(router, {});
  return router;
}

test(
  "GET /api/ops/flows returns validated deterministic flow registry",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, { method: "GET", path: "/api/ops/flows" });
    assert.notEqual(res.handled, false);
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.validation?.ok, true);
    assert.ok(Number(res.body?.validation?.stats?.flowCount || 0) >= 1);
    assert.ok(Number(res.body?.validation?.stats?.triggerCount || 0) >= 1);
  }),
);

test(
  "POST /api/ops/resolve-intent matches sonarr phrase and reports missing inputs",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, {
      method: "POST",
      path: "/api/ops/resolve-intent",
      body: { text: "can you see why Geordie Shore hasnt downloaded on sonarr" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.resolution?.match?.id, "sonarr_missing_download");
    assert.equal(res.body?.resolution?.fixIntent?.value, false);
    assert.ok(Array.isArray(res.body?.resolution?.missingInputs));
    assert.ok(res.body.resolution.missingInputs.includes("title"));
    assert.equal(res.body?.resolution?.plan?.repair?.enabled, false);
  }),
);

test(
  "POST /api/ops/resolve-intent auto-detects fix intent for zigbee repair phrase",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, {
      method: "POST",
      path: "/api/ops/resolve-intent",
      body: { text: "the zigbee infra checks are failing please can you fix" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.resolution?.match?.id, "zigbee_bridge_health");
    assert.equal(res.body?.resolution?.fixIntent?.value, true);
    assert.equal(res.body?.resolution?.plan?.repair?.enabled, true);
  }),
);

test(
  "POST /api/ops/resolve-intent rejects missing text",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, {
      method: "POST",
      path: "/api/ops/resolve-intent",
      body: { text: "  " },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body?.ok, false);
    assert.equal(res.body?.error, "missing_text");
  }),
);

test(
  "POST /api/ops/resolve-intent/execute handles unmatched requests",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, {
      method: "POST",
      path: "/api/ops/resolve-intent/execute",
      body: { text: "what colour are bananas" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.resolution?.match, null);
    assert.equal(res.body?.execution?.error, "no_flow_match");
    assert.match(String(res.body?.response?.diagnosis || ""), /No deterministic flow matched/i);
  }),
);

test(
  "POST /api/ops/resolve-intent/execute preserves diagnose-before-repair via missing-input gating",
  withPatchedFs(async () => {
    const router = setupOpsRouter();
    const res = await hit(router, {
      method: "POST",
      path: "/api/ops/resolve-intent/execute",
      body: {
        text: "please fix sonarr hasnt downloaded geordie shore",
        runRepair: true,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.resolution?.match?.id, "sonarr_missing_download");
    assert.equal(res.body?.execution?.runRepairRequested, true);
    assert.equal(res.body?.execution?.runVerify, true);
    assert.ok(Array.isArray(res.body?.resolution?.missingInputs));
    assert.ok(res.body.resolution.missingInputs.includes("title"));
    assert.ok(res.body.resolution.missingInputs.includes("seriesId"));
    const diagnoseStatuses = (res.body?.execution?.phases?.diagnose || []).map((x) => x?.status);
    const repairStatuses = (res.body?.execution?.phases?.repair || []).map((x) => x?.status);
    assert.ok(diagnoseStatuses.every((s) => s === "skipped"));
    assert.ok(repairStatuses.every((s) => s === "skipped"));
    assert.match(String(res.body?.response?.nextAction || ""), /Provide missing inputs/i);
  }),
);
