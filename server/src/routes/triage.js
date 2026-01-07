const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");

function registerTriage(router, { triage }) {
  router.add("GET", "/api/triage/items", (req, res, url) => {
    const status = url.searchParams.get("status") || "open";
    const kind = url.searchParams.get("kind");
    const limit = url.searchParams.get("limit") || "200";
    const items = triage.listItems({ status, kind: kind || null, limit });
    return sendJson(res, 200, { ok: true, items });
  });

  router.add("POST", "/api/triage/items/:itemId/status", async (req, res, _url, params) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }
    const status = String(body?.status || "").trim();
    if (!status) return sendJson(res, 400, { ok: false, error: "missing_status" });
    const item = triage.setStatus({ id: params.itemId, status });
    if (!item) return sendJson(res, 404, { ok: false, error: "not_found" });

    const feedback = body?.feedback || null;
    if (feedback && typeof feedback === "object") {
      const kind = String(feedback.kind || "note").trim();
      const reason = feedback.reason ?? null;
      const outcome = feedback.outcome ?? null;
      const notes = feedback.notes ?? null;
      const meta = feedback.meta ?? null;
      try {
        triage.createFeedback({ itemId: params.itemId, kind, actor: "user", reason, outcome, notes, meta });
      } catch {
        // ignore feedback write failures
      }
    } else {
      // Record a minimal state transition event.
      const k = status === "dismissed" ? "dismissed" : status === "completed" ? "completed" : status === "open" ? "reopened" : "status_set";
      try {
        triage.createFeedback({ itemId: params.itemId, kind: k, actor: "user" });
      } catch {
        // ignore
      }
    }
    return sendJson(res, 200, { ok: true, item });
  });

  router.add("POST", "/api/triage/items/:itemId/priority", async (req, res, _url, params) => {
    const body = await readJson(req);
    const priority = body?.priority;
    if (priority == null) return sendJson(res, 400, { ok: false, error: "missing_priority" });
    const item = triage.setPriority({ id: params.itemId, priority });
    if (!item) return sendJson(res, 404, { ok: false, error: "not_found" });
    try {
      triage.createFeedback({ itemId: params.itemId, kind: "priority_set", actor: "user", meta: { priority: item.priority } });
    } catch {
      // ignore
    }
    return sendJson(res, 200, { ok: true, item });
  });

  router.add("GET", "/api/triage/feedback", (_req, res, url) => {
    const runbookId = url.searchParams.get("runbookId");
    const limit = url.searchParams.get("limit") || "200";
    const feedback = triage.listRecentFeedback({ runbookId: runbookId || null, limit });
    return sendJson(res, 200, { ok: true, feedback });
  });
}

module.exports = { registerTriage };
