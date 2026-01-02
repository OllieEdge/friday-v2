const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");

function registerChats(router, { chats, runAssistant, loadContext }) {
  router.add("GET", "/api/chats", (_req, res) => {
    const list = chats.listChats();
    return sendJson(res, 200, { ok: true, chats: list });
  });

  router.add("POST", "/api/chats", async (req, res) => {
    const body = await readJson(req);
    const chat = chats.createChat({ title: body?.title });
    return sendJson(res, 201, { ok: true, chat });
  });

  router.add("GET", "/api/chats/:chatId", (_req, res, _url, params) => {
    const chat = chats.getChat(params.chatId);
    if (!chat) return sendJson(res, 404, { ok: false, error: "not_found" });
    return sendJson(res, 200, { ok: true, chat });
  });

  router.add("POST", "/api/chats/:chatId/messages", async (req, res, _url, params) => {
    const body = await readJson(req);
    const userMsg = chats.appendMessage({ chatId: params.chatId, role: "user", content: body?.content ?? "" });
    if (!userMsg) return sendJson(res, 404, { ok: false, error: "not_found" });

    const context = loadContext();
    const chat = chats.getChat(params.chatId);

    let assistantContent = "";
    try {
      assistantContent = await runAssistant({ context, chat });
    } catch (e) {
      assistantContent = `Runner error: ${String(e?.message || e)}`;
    }
    const assistantMsg = chats.appendMessage({ chatId: params.chatId, role: "assistant", content: assistantContent });

    return sendJson(res, 201, { ok: true, messages: [userMsg, assistantMsg] });
  });
}

module.exports = { registerChats };

