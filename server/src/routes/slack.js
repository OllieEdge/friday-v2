const { readBody } = require("../http/body");
const { sendJson, sendText } = require("../http/respond");
const { nowIso } = require("../utils/time");
const { getSlackConfig, getSlackUser, getSlackChannel, getSlackPermalink, verifySlackSignature } = require("../lib/slack");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isSlackBotEvent(event) {
  return Boolean(event?.bot_id) || event?.subtype === "bot_message";
}

function isMessageChange(event) {
  return event?.subtype === "message_changed" || event?.subtype === "message_deleted";
}

function isTargetMention(text, targetUserId) {
  if (!targetUserId) return false;
  return String(text || "").includes(`<@${targetUserId}>`);
}

async function buildSlackSummary({ token, event, kind, targetUserId }) {
  const userId = event?.user || event?.message?.user || "";
  const channelId = event?.channel || event?.channel_id || "";
  const text = normalizeText(event?.text || event?.message?.text || "");
  const threadTs = event?.thread_ts || event?.message?.thread_ts || "";
  const messageTs = event?.ts || event?.message?.ts || "";

  const [user, channel, permalink] = await Promise.all([
    getSlackUser({ token, userId }),
    getSlackChannel({ token, channelId }),
    getSlackPermalink({ token, channelId, messageTs }),
  ]);

  const userLabel =
    normalizeText(user?.profile?.display_name) ||
    normalizeText(user?.real_name) ||
    normalizeText(user?.name) ||
    (userId ? `Slack user ${userId}` : "Unknown user");
  const channelLabel = normalizeText(channel?.name) || (event?.channel_type === "im" ? "DM" : channelId);

  const title = kind === "mention" ? `Slack mention: #${channelLabel}` : `Slack DM: ${userLabel}`;
  const summaryMd = [
    `From: **${userLabel}**`,
    `Channel: **${channelLabel}**`,
    targetUserId && isTargetMention(text, targetUserId) ? `Mentions: <@${targetUserId}>` : "",
    permalink ? `Permalink: ${permalink}` : "",
    "",
    "Message:",
    "",
    text || "(no text)",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    summaryMd,
    source: {
      slack: {
        eventId: normalizeText(event?.event_id || ""),
        eventTime: event?.event_time || null,
        channelId,
        channelName: normalizeText(channel?.name) || null,
        channelType: normalizeText(event?.channel_type || ""),
        userId,
        userName: normalizeText(user?.profile?.display_name) || normalizeText(user?.real_name) || null,
        text,
        ts: messageTs,
        threadTs: threadTs || null,
        permalink,
      },
    },
  };
}

function registerSlack(router, { chats, triage, tasks } = {}) {
  router.add("POST", "/api/slack/events", async (req, res) => {
    const cfg = getSlackConfig();
    const bodyBuf = await readBody(req);
    const bodyText = bodyBuf.toString("utf8");
    const signature = String(req.headers["x-slack-signature"] || "");
    const timestamp = String(req.headers["x-slack-request-timestamp"] || "");

    if (!verifySlackSignature({ signingSecret: cfg.signingSecret, timestamp, body: bodyText, signature })) {
      return sendJson(res, 401, { ok: false, error: "invalid_signature" });
    }

    let payload = null;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
    if (!payload) return sendJson(res, 400, { ok: false, error: "invalid_json" });

    if (payload.type === "url_verification") {
      return sendText(res, 200, String(payload.challenge || ""), "text/plain; charset=utf-8");
    }

    if (payload.type !== "event_callback") return sendJson(res, 200, { ok: true });

    const event = payload.event || {};
    if (isSlackBotEvent(event) || isMessageChange(event)) return sendJson(res, 200, { ok: true });

    const eventType = normalizeText(event?.type);
    const channelType = normalizeText(event?.channel_type || "");
    const isIm = channelType === "im" || channelType === "mpim";
    const isMention = eventType === "app_mention";
    const isTargetedMention = !isIm && isTargetMention(event?.text || "", cfg.targetUserId);

    if (!(isIm || isMention || isTargetedMention)) return sendJson(res, 200, { ok: true });

    const token = cfg.botToken || cfg.userToken;
    if (!token) return sendJson(res, 500, { ok: false, error: "missing_slack_token" });

    const kind = isIm ? "dm" : "mention";
    const summary = await buildSlackSummary({ token, event: { ...event, event_id: payload.event_id, event_time: payload.event_time }, kind, targetUserId: cfg.targetUserId });

    const sourceKey = `slack:${normalizeText(payload.event_id || event.ts || "")}`;
    const triageChat = chats?.createChat ? chats.createChat({ title: `Triage: ${summary.title}`, hidden: true }) : null;

    const item = triage?.createItem
      ? triage.createItem({
          runbookId: "slack",
          kind: "quick_read",
          title: summary.title,
          summaryMd: summary.summaryMd,
          priority: 1,
          confidencePct: null,
          sourceKey,
          source: summary.source,
          chatId: triageChat?.id || null,
        })
      : null;

    if (cfg.autoReplyEnabled && tasks?.create) {
      tasks.create({
        kind: "slack_auto_reply",
        status: "queued",
        input: {
          triageItemId: item?.id || null,
          eventId: payload.event_id || null,
          channel: event.channel,
          channelType,
          userId: event.user || null,
          text: normalizeText(event.text || ""),
          threadTs: event.thread_ts || null,
          ts: event.ts || null,
          isMention: !isIm,
          createdAt: nowIso(),
        },
      });
    }

    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerSlack };
