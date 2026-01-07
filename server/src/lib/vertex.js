const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { envString } = require("../config/env");
const { exchangeRefreshTokenForAccessToken, requireGoogleConfig } = require("./google");

function normalizeString(value) {
  return String(value ?? "").trim();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function signJwt({ header, payload, privateKeyPem }) {
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${data}.${base64Url(signature)}`;
}

function parseServiceAccountJson(jsonText) {
  const parsed = JSON.parse(String(jsonText || ""));
  const clientEmail = normalizeString(parsed?.client_email);
  const privateKey = normalizeString(parsed?.private_key);
  if (!clientEmail || !privateKey) throw new Error("Vertex service account JSON missing client_email/private_key");
  return { client_email: clientEmail, private_key: privateKey };
}

function resolveServiceAccountFromEnv() {
  const filePath = envString("VERTEX_SERVICE_ACCOUNT_FILE", "");
  if (filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    return parseServiceAccountJson(text);
  }

  const inlineJson = envString("VERTEX_SERVICE_ACCOUNT_JSON", "");
  if (inlineJson) return parseServiceAccountJson(inlineJson);

  return null;
}

function resolveAwsBin() {
  const candidates = ["/opt/homebrew/bin/aws", "/usr/local/bin/aws", "aws"];
  for (const c of candidates) {
    try {
      if (c === "aws") return c;
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return "aws";
}

function runAwsJson(args, { awsProfile } = {}) {
  return new Promise((resolve, reject) => {
    const bin = resolveAwsBin();
    const env = { ...process.env };
    const profile = normalizeString(awsProfile);
    if (profile) env.AWS_PROFILE = profile;

    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const msg = String(stderr || stdout || "").trim() || `aws exited ${code}`;
        return reject(new Error(msg));
      }
      try {
        const parsed = JSON.parse(String(stdout || ""));
        resolve(parsed);
      } catch (e) {
        reject(new Error(`aws returned non-JSON: ${String(e?.message || e)}`));
      }
    });
  });
}

async function resolveServiceAccountFromAwsSecret() {
  const secretId = envString("VERTEX_AWS_SECRET_ID", "");
  if (!secretId) return null;
  const awsRegion = envString("VERTEX_AWS_REGION", envString("AWS_REGION", envString("AWS_DEFAULT_REGION", "eu-west-1")));
  const awsProfile = envString("VERTEX_AWS_PROFILE", "");

  const json = await runAwsJson(
    ["secretsmanager", "get-secret-value", "--secret-id", secretId, "--region", awsRegion, "--output", "json"],
    { awsProfile },
  );
  const secretString = normalizeString(json?.SecretString);
  if (!secretString) throw new Error("Vertex AWS secret returned empty SecretString");
  return parseServiceAccountJson(secretString);
}

let cachedServiceAccountAccessToken = null; // { token: string, expiresAtMs: number }
const cachedGoogleOAuthAccessTokens = new Map(); // accountKey => { token: string, expiresAtMs: number }

function normalizeVertexAuthMode(value) {
  const v = normalizeString(value).toLowerCase();
  if (v === "google_oauth" || v === "oauth" || v === "google") return "google_oauth";
  return "aws_secret";
}

function normalizeGoogleAccountKey(value) {
  const v = normalizeString(value).toLowerCase();
  if (v === "personal") return "personal";
  return "work";
}

async function getVertexAccessToken({ authMode, googleAccounts, googleAccountKey } = {}) {
  const mode = normalizeVertexAuthMode(authMode || envString("VERTEX_AUTH_MODE", ""));

  const direct = envString("VERTEX_ACCESS_TOKEN", "");
  if (direct) return direct;

  const now = Date.now();

  if (mode === "google_oauth") {
    const key = normalizeGoogleAccountKey(googleAccountKey || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work"));
    const cached = cachedGoogleOAuthAccessTokens.get(key);
    if (cached?.token && cached?.expiresAtMs && cached.expiresAtMs - now > 60_000) return cached.token;

    if (!googleAccounts || typeof googleAccounts.get !== "function") {
      throw new Error("Vertex google_oauth selected but googleAccounts DB not available");
    }

    const row = googleAccounts.get(key);
    const refreshToken = normalizeString(row?.refreshToken);
    if (!refreshToken) {
      throw new Error(`Google account '${key}' not connected (connect in Settings → Accounts → Google)`);
    }

    const cfg = requireGoogleConfig();
    const tokens = await exchangeRefreshTokenForAccessToken({
      refreshToken,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });

    const accessToken = normalizeString(tokens?.access_token);
    const expiresIn = Number(tokens?.expires_in || 0);
    if (!accessToken) throw new Error("token exchange returned no access_token");

    const expiresAtMs = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000);
    cachedGoogleOAuthAccessTokens.set(key, { token: accessToken, expiresAtMs });
    return accessToken;
  }

  if (
    cachedServiceAccountAccessToken?.token &&
    cachedServiceAccountAccessToken?.expiresAtMs &&
    cachedServiceAccountAccessToken.expiresAtMs - now > 60_000
  ) {
    return cachedServiceAccountAccessToken.token;
  }

  const serviceAccount = resolveServiceAccountFromEnv() || (await resolveServiceAccountFromAwsSecret());
  if (!serviceAccount) {
    throw new Error(
      "Vertex auth not configured (set VERTEX_SERVICE_ACCOUNT_FILE/JSON, VERTEX_AWS_SECRET_ID, or VERTEX_ACCESS_TOKEN)",
    );
  }

  const tokenUri = "https://oauth2.googleapis.com/token";
  const scope = "https://www.googleapis.com/auth/cloud-platform";
  const iat = nowSeconds();

  const assertion = signJwt({
    header: { alg: "RS256", typ: "JWT" },
    payload: {
      iss: serviceAccount.client_email,
      scope,
      aud: tokenUri,
      iat,
      exp: iat + 3600,
    },
    privateKeyPem: serviceAccount.private_key,
  });

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", assertion);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error_description || json?.error || `token exchange failed (HTTP ${res.status})`);
  const accessToken = normalizeString(json?.access_token);
  const expiresIn = Number(json?.expires_in || 0);
  if (!accessToken) throw new Error("token exchange returned no access_token");

  const expiresAtMs = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000);
  cachedServiceAccountAccessToken = { token: accessToken, expiresAtMs };
  return accessToken;
}

function buildConversationPrompt({ system, messages }) {
  const sys = normalizeString(system);
  const lines = [];
  if (sys) lines.push(sys);

  for (const m of messages || []) {
    if (!m || !m.role) continue;
    const role = String(m.role || "").toLowerCase();
    const content = normalizeString(m.content);
    if (!content) continue;
    if (role === "assistant") lines.push(`Assistant: ${content}`);
    else lines.push(`User: ${content}`);
  }

  return lines.join("\n\n").trim();
}

function normalizeBoolean(value) {
  const v = normalizeString(value).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function resolveCacheTtlSeconds() {
  const raw = Number(envString("VERTEX_CONTEXT_CACHE_TTL_S", ""));
  if (Number.isFinite(raw) && raw > 0) return Math.min(86_400, Math.max(60, Math.floor(raw)));
  return 3600;
}

const cachedContextByKey = new Map(); // key -> { name, expiresAtMs }

function buildContextCacheKey({ projectId, location, model, systemText }) {
  const hash = crypto.createHash("sha256").update(systemText).digest("hex");
  return `${projectId}|${location}|${model}|${hash}`;
}

async function createVertexCachedContent({ projectId, location, model, systemText, accessToken, ttlSeconds }) {
  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/locations/${encodeURIComponent(location)}/cachedContents`;
  const modelPath =
    `projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}` +
    `/publishers/google/models/${encodeURIComponent(model)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: modelPath,
      contents: [{ role: "user", parts: [{ text: normalizeString(systemText) }] }],
      ttl: `${ttlSeconds}s`,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error?.message || json?.message || text || `HTTP ${res.status}`);

  const name = normalizeString(json?.name);
  if (!name) throw new Error("Vertex cachedContent response missing name");

  let expiresAtMs = Date.now() + ttlSeconds * 1000;
  if (json?.expireTime) {
    const parsed = Date.parse(String(json.expireTime));
    if (!Number.isNaN(parsed)) expiresAtMs = parsed;
  }
  return { name, expiresAtMs };
}

async function getVertexContextCache({
  projectId,
  location,
  model,
  systemText,
  accessToken,
  authMode,
  googleAccounts,
  googleAccountKey,
}) {
  if (!normalizeBoolean(envString("VERTEX_CONTEXT_CACHE", ""))) return null;
  const sys = normalizeString(systemText);
  if (!sys) return null;

  const key = buildContextCacheKey({ projectId, location, model, systemText: sys });
  const cached = cachedContextByKey.get(key);
  if (cached?.name && cached?.expiresAtMs && cached.expiresAtMs - Date.now() > 60_000) return cached.name;

  const token =
    normalizeString(accessToken) || (await getVertexAccessToken({ authMode, googleAccounts, googleAccountKey }));
  const ttlSeconds = resolveCacheTtlSeconds();
  const created = await createVertexCachedContent({
    projectId,
    location,
    model,
    systemText: sys,
    accessToken: token,
    ttlSeconds,
  });
  cachedContextByKey.set(key, created);
  return created.name;
}

async function vertexGenerateText({
  projectId,
  location,
  model,
  prompt,
  temperature = 0.2,
  maxOutputTokens = 1024,
  cachedContent,
  authMode,
  googleAccounts,
  googleAccountKey,
  accessToken: accessTokenOverride,
}) {
  const resolvedProjectId = normalizeString(projectId) || envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod");
  const resolvedLocation = normalizeString(location) || envString("VERTEX_LOCATION", "europe-west2");
  const resolvedModel = normalizeString(model) || envString("VERTEX_MODEL", "gemini-2.0-flash");
  if (!resolvedProjectId) throw new Error("Vertex project not set");

  const accessToken = normalizeString(accessTokenOverride) || (await getVertexAccessToken({ authMode, googleAccounts, googleAccountKey }));

  const url =
    `https://${resolvedLocation}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(resolvedProjectId)}` +
    `/locations/${encodeURIComponent(resolvedLocation)}/publishers/google/models/${encodeURIComponent(resolvedModel)}:generateContent`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: normalizeString(prompt) }] }],
    generationConfig: {
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
      maxOutputTokens: Math.max(64, Math.min(8192, Number(maxOutputTokens) || 1024)),
    },
  };
  const cached = normalizeString(cachedContent);
  if (cached) payload.cachedContent = cached;

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error?.message || json?.message || text || `HTTP ${res.status}`);

  const parts = json?.candidates?.[0]?.content?.parts;
  const out = Array.isArray(parts) ? parts.map((p) => normalizeString(p?.text)).filter(Boolean).join("\n") : "";
  const usage = json?.usageMetadata
    ? {
        inputTokens: Number(json.usageMetadata.promptTokenCount) || 0,
        cachedInputTokens:
          Number(json.usageMetadata.cachedContentTokenCount) ||
          Number(json.usageMetadata.cachedInputTokenCount) ||
          Number(json.usageMetadata.cachedTokenCount) ||
          0,
        outputTokens: Number(json.usageMetadata.candidatesTokenCount) || 0,
      }
    : null;

  return { content: normalizeString(out), usage };
}

async function runVertexChat({ system, messages, projectId, location, model, authMode, googleAccounts, googleAccountKey }) {
  const systemText = normalizeString(system);
  const messagePrompt = buildConversationPrompt({ system: "", messages });
  const fullPrompt = buildConversationPrompt({ system: systemText, messages });
  if (!fullPrompt) return { content: "", usage: null };

  let cachedContent = null;
  if (systemText && messagePrompt) {
    try {
      cachedContent = await getVertexContextCache({
        projectId,
        location,
        model,
        systemText,
        authMode,
        googleAccounts,
        googleAccountKey,
      });
    } catch (err) {
      console.warn("[vertex] context cache create failed", err instanceof Error ? err.message : String(err));
      cachedContent = null;
    }
  }

  if (cachedContent) {
    return vertexGenerateText({
      projectId,
      location,
      model,
      prompt: messagePrompt,
      cachedContent,
      authMode,
      googleAccounts,
      googleAccountKey,
    });
  }

  return vertexGenerateText({ projectId, location, model, prompt: fullPrompt, authMode, googleAccounts, googleAccountKey });
}

async function vertexProbeModelIds({ projectId, location, modelIds, authMode, googleAccounts, googleAccountKey, accessToken: accessTokenOverride }) {
  const resolvedProjectId = normalizeString(projectId) || envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod");
  const resolvedLocation = normalizeString(location) || envString("VERTEX_LOCATION", "europe-west2");
  const ids = Array.isArray(modelIds) ? modelIds.map((x) => String(x || "").trim()).filter(Boolean) : [];

  const out = [];
  const accessToken = normalizeString(accessTokenOverride) || (await getVertexAccessToken({ authMode, googleAccounts, googleAccountKey }));

  for (const id of ids) {
    const url =
      `https://${resolvedLocation}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(resolvedProjectId)}` +
      `/locations/${encodeURIComponent(resolvedLocation)}/publishers/google/models/${encodeURIComponent(id)}:generateContent`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "OK" }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 16 },
        }),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) throw new Error(json?.error?.message || json?.message || text || `HTTP ${res.status}`);
      out.push({ id, ok: true });
    } catch (err) {
      out.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { projectId: resolvedProjectId, location: resolvedLocation, results: out };
}

module.exports = { runVertexChat, vertexProbeModelIds };
