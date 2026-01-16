const crypto = require("node:crypto");
const { envNumber, envString } = require("../config/env");

const userCache = new Map();
const channelCache = new Map();

function getSlackConfig() {
  return {
    botToken: envString("SLACK_BOT_TOKEN", ""),
    userToken: envString("SLACK_USER_TOKEN", ""),
    signingSecret: envString("SLACK_SIGNING_SECRET", ""),
    appId: envString("SLACK_APP_ID", ""),
    clientId: envString("SLACK_CLIENT_ID", ""),
    autoReplyEnabled: envString("SLACK_AUTO_REPLY_ENABLED", "") === "1",
    autoReplyConfidence: envNumber("SLACK_AUTO_REPLY_CONFIDENCE", 90),
    targetUserId: envString("SLACK_TARGET_USER_ID", ""),
    botUserId: envString("SLACK_BOT_USER_ID", ""),
  };
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifySlackSignature({ signingSecret, timestamp, body, signature }) {
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${body}`;
  const digest = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;
  return timingSafeEqual(expected, signature);
}

async function slackApiRequest({ token, method = "GET", path, body }) {
  if (!token) return { ok: false, error: "missing_token" };
  const url = `https://slack.com/api${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) return { ok: false, error: data?.error || "slack_error", data };
  return { ok: true, data };
}

async function getSlackUser({ token, userId }) {
  if (!userId) return null;
  if (userCache.has(userId)) return userCache.get(userId);
  const res = await slackApiRequest({ token, method: "GET", path: `/users.info?user=${encodeURIComponent(userId)}` });
  if (!res.ok) return null;
  const user = res.data?.user || null;
  if (user) userCache.set(userId, user);
  return user;
}

async function getSlackChannel({ token, channelId }) {
  if (!channelId) return null;
  if (channelCache.has(channelId)) return channelCache.get(channelId);
  const res = await slackApiRequest({ token, method: "GET", path: `/conversations.info?channel=${encodeURIComponent(channelId)}` });
  if (!res.ok) return null;
  const channel = res.data?.channel || null;
  if (channel) channelCache.set(channelId, channel);
  return channel;
}

async function getSlackPermalink({ token, channelId, messageTs }) {
  if (!channelId || !messageTs) return "";
  const res = await slackApiRequest({
    token,
    method: "GET",
    path: `/chat.getPermalink?channel=${encodeURIComponent(channelId)}&message_ts=${encodeURIComponent(messageTs)}`,
  });
  if (!res.ok) return "";
  return String(res.data?.permalink || "");
}

async function postSlackMessage({ token, channel, text, threadTs }) {
  return slackApiRequest({
    token,
    method: "POST",
    path: "/chat.postMessage",
    body: {
      channel,
      text,
      thread_ts: threadTs || undefined,
    },
  });
}

module.exports = {
  getSlackConfig,
  verifySlackSignature,
  slackApiRequest,
  getSlackUser,
  getSlackChannel,
  getSlackPermalink,
  postSlackMessage,
};
