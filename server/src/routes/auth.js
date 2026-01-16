const { envString, envNumber } = require("../config/env");
const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { addDaysIso, isSecureRequest, parseCookies, randomId, setCookie, clearCookie } = require("../lib/auth");

function addMsIso(ms) {
  return new Date(Date.now() + Number(ms || 0)).toISOString();
}

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

function parseOrigins() {
  const raw = envString("PASSKEY_ORIGINS", "");
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [];
}

function getRpConfig() {
  const rpName = envString("PASSKEY_RP_NAME", "Friday v2");
  const rpID = envString("PASSKEY_RP_ID", "");
  const origins = parseOrigins();
  return { rpName, rpID, origins };
}

function pickExpectedOrigin({ req, origins }) {
  const rawOrigin = String(req.headers?.origin || "").trim();
  const origin = rawOrigin === "null" ? "" : rawOrigin;
  if (origin && origins.includes(origin)) return origin;

  const xfProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const proto = xfProto || (req.socket?.encrypted ? "https" : "http");
  const xfHost = String(req.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = xfHost || String(req.headers?.host || "").split(",")[0].trim();
  const computed = proto && host ? `${proto}://${host}` : "";
  if (computed && origins.includes(computed)) return computed;

  if (origins.length === 1) return origins[0];
  return origin || computed || origins[0] || "";
}

function getCookieName() {
  return envString("SESSION_COOKIE_NAME", "friday_session");
}

function getSessionTtlDays() {
  return envNumber("SESSION_TTL_DAYS", 30);
}


function normalizeText(value) {
  return String(value ?? "").trim();
}

function isTruthy(value) {
  const v = normalizeText(value).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getTestBypassToken() {
  return normalizeText(envString("FRIDAY_TEST_BYPASS_TOKEN", ""));
}

function testBypassEnabled() {
  return isTruthy(envString("FRIDAY_TEST_BYPASS_ENABLED", ""));
}

function testBypassUser({ req, auth }) {
  if (!testBypassEnabled()) return null;
  const token = normalizeText(req.headers?.["x-friday-test-bypass"] || "");
  const expected = getTestBypassToken();
  if (!token || !expected || token !== expected) return null;
  let user = auth.getFirstUser();
  if (!user) {
    user = auth.createUser({ id: randomId(), label: "Test User" });
  }
  if (!user) return null;
  return { session: { id: "test-bypass", userId: user.id }, user };
}

async function requireUser({ req, auth }) {
  const bypass = testBypassUser({ req, auth });
  if (bypass) return bypass;
  const cookies = parseCookies(req);
  const cookieName = getCookieName();
  const sid = cookies[cookieName];
  if (!sid) return null;
  const session = auth.getSessionById(sid);
  if (!session) return null;
  const user = auth.getUserById(session.userId);
  if (!user) return null;
  return { session, user };
}

function registerAuth(router, { auth }) {
  router.add("GET", "/api/auth/status", async (req, res) => {
    const ctx = await requireUser({ req, auth });
    return sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(ctx),
      hasAnyUsers: auth.countUsers() > 0,
      hasAnyPasskeys: auth.countPasskeys() > 0,
      user: ctx ? ctx.user : null,
    });
  });

  router.add("POST", "/api/auth/logout", async (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies[getCookieName()];
    if (sid) auth.deleteSessionById(sid);
    clearCookie(res, { name: getCookieName() });
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/auth/registration/options", async (req, res) => {
    const ctx = await requireUser({ req, auth });
    const hasUsers = auth.countUsers() > 0;
    const hasPasskeys = auth.countPasskeys() > 0;
    const bootstrap = !hasPasskeys;
    if (hasUsers && hasPasskeys && !ctx) return sendJson(res, 401, { ok: false, error: "unauthorized" });

    const body = (await readJson(req)) || {};
    const label = String(body?.label || "").trim();
    if (!ctx && !label && !hasUsers) return sendJson(res, 400, { ok: false, error: "missing_label" });

    const { rpName, rpID } = getRpConfig();
    if (!rpID) return sendJson(res, 500, { ok: false, error: "missing_rp_id" });

    let user = ctx?.user || null;
    if (!user) {
      if (hasUsers) {
        user = auth.getFirstUser();
      } else {
        user = auth.createUser({ id: randomId(), label });
      }
    }
    if (!user) return sendJson(res, 500, { ok: false, error: "user_create_failed" });
    const challengeId = randomId();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(String(user.id), "utf8"),
      userName: user.label,
      userDisplayName: user.label,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    options.excludeCredentials = auth
      .listPasskeysByUserId(user.id)
      .map((p) => ({ id: p.credentialId, type: "public-key" }));

    auth.createChallenge({
      id: challengeId,
      userId: user.id,
      type: "registration",
      challenge: options.challenge,
      expiresAt: addMsIso(60 * 60 * 1000),
    });

    return sendJson(res, 200, { ok: true, challengeId, user, options });
  });

  router.add("POST", "/api/auth/registration/verify", async (req, res) => {
    const body = (await readJson(req)) || {};
    const challenge = String(body?.challenge || "");
    const response = body?.response;
    if (!challenge || !response) return sendJson(res, 400, { ok: false, error: "missing_payload" });

    const { rpID, origins } = getRpConfig();
    if (!rpID) return sendJson(res, 500, { ok: false, error: "missing_rp_id" });
    const expectedOrigin = pickExpectedOrigin({ req, origins });
    if (!expectedOrigin) return sendJson(res, 500, { ok: false, error: "missing_expected_origin" });

    const ch = auth.getChallengeByValue({ type: "registration", challenge });
    if (!ch) return sendJson(res, 400, { ok: false, error: "challenge_not_found" });

    const user = auth.getUserById(ch.userId);
    if (!user) return sendJson(res, 400, { ok: false, error: "user_not_found" });

    let verification = null;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[auth] registration verify failed", {
        msg: String(e?.message || e),
        origin: String(req.headers?.origin || ""),
        rpID,
      });
      return sendJson(res, 400, { ok: false, error: "webauthn_verify_failed", message: String(e?.message || e) });
    }

    if (!verification.verified) return sendJson(res, 400, { ok: false, error: "registration_not_verified" });
    const { registrationInfo } = verification;
    if (!registrationInfo) return sendJson(res, 400, { ok: false, error: "missing_registration_info" });

    const credential = registrationInfo.credential;
    const credentialId = String(credential?.id || "");
    const publicKey = credential?.publicKey ? Buffer.from(credential.publicKey) : null;
    const counter = Number(credential?.counter) || 0;
    const transports = Array.isArray(credential?.transports) ? JSON.stringify(credential.transports) : null;

    if (!credentialId || !publicKey) {
      return sendJson(res, 400, { ok: false, error: "invalid_credential" });
    }

    auth.createPasskey({
      id: randomId(),
      userId: user.id,
      credentialId,
      publicKey,
      counter,
      transports,
    });

    auth.deleteChallengeById(ch.id);

    const sid = randomId();
    const expiresAt = addDaysIso(getSessionTtlDays());
    auth.createSession({ id: sid, userId: user.id, expiresAt });
    setCookie(res, {
      name: getCookieName(),
      value: sid,
      maxAgeSeconds: getSessionTtlDays() * 86400,
      secure: isSecureRequest(req),
      httpOnly: true,
      sameSite: "Lax",
    });

    return sendJson(res, 200, { ok: true, user });
  });

  router.add("POST", "/api/auth/authentication/options", async (req, res) => {
    const hasUsers = auth.countUsers() > 0;
    const hasPasskeys = auth.countPasskeys() > 0;
    if (!hasUsers) return sendJson(res, 400, { ok: false, error: "no_users" });
    if (!hasPasskeys) return sendJson(res, 400, { ok: false, error: "no_passkeys" });

    const { rpID } = getRpConfig();
    if (!rpID) return sendJson(res, 500, { ok: false, error: "missing_rp_id" });

    const users = auth.listUsers();
    const allowCredentials = [];
    for (const u of users) {
      for (const p of auth.listPasskeysByUserId(u.id)) {
        allowCredentials.push({ id: p.credentialId, type: "public-key" });
      }
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
    });
    options.allowCredentials = allowCredentials;

    const challengeId = randomId();
    auth.createChallenge({
      id: challengeId,
      userId: null,
      type: "authentication",
      challenge: options.challenge,
      expiresAt: addMsIso(60 * 60 * 1000),
    });

    return sendJson(res, 200, { ok: true, challengeId, options });
  });

  router.add("POST", "/api/auth/authentication/verify", async (req, res) => {
    const body = (await readJson(req)) || {};
    const challenge = String(body?.challenge || "");
    const response = body?.response;
    if (!challenge || !response) return sendJson(res, 400, { ok: false, error: "missing_payload" });

    const { rpID, origins } = getRpConfig();
    if (!rpID) return sendJson(res, 500, { ok: false, error: "missing_rp_id" });
    const expectedOrigin = pickExpectedOrigin({ req, origins });
    if (!expectedOrigin) return sendJson(res, 500, { ok: false, error: "missing_expected_origin" });

    const ch = auth.getChallengeByValue({ type: "authentication", challenge });
    if (!ch) return sendJson(res, 400, { ok: false, error: "challenge_not_found" });

    const credentialID = String(response?.id || "");
    if (!credentialID) return sendJson(res, 400, { ok: false, error: "missing_credential_id" });
    const passkey = auth.getPasskeyByCredentialId(credentialID);
    if (!passkey) return sendJson(res, 400, { ok: false, error: "passkey_not_found" });

    let verification = null;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: passkey.credentialId,
          publicKey: passkey.publicKey,
          counter: Number(passkey.counter) || 0,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[auth] authentication verify failed", {
        msg: String(e?.message || e),
        origin: String(req.headers?.origin || ""),
        rpID,
      });
      return sendJson(res, 400, { ok: false, error: "webauthn_verify_failed", message: String(e?.message || e) });
    }

    if (!verification.verified) return sendJson(res, 401, { ok: false, error: "authentication_not_verified" });

    const user = auth.getUserById(passkey.userId);
    if (!user) return sendJson(res, 400, { ok: false, error: "user_not_found" });

    auth.updatePasskeyCounter({ credentialId: passkey.credentialId, counter: verification.authenticationInfo.newCounter });
    auth.deleteChallengeById(ch.id);

    const sid = randomId();
    const expiresAt = addDaysIso(getSessionTtlDays());
    auth.createSession({ id: sid, userId: user.id, expiresAt });
    setCookie(res, {
      name: getCookieName(),
      value: sid,
      maxAgeSeconds: getSessionTtlDays() * 86400,
      secure: isSecureRequest(req),
      httpOnly: true,
      sameSite: "Lax",
    });

    return sendJson(res, 200, { ok: true, user });
  });

  router.add("GET", "/api/auth/passkeys", async (req, res) => {
    const ctx = await requireUser({ req, auth });
    if (!ctx) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    return sendJson(res, 200, { ok: true, user: ctx.user, passkeys: auth.listPasskeysByUserId(ctx.user.id) });
  });

  router.add("DELETE", "/api/auth/passkeys/:id", async (req, res, _url, params) => {
    const ctx = await requireUser({ req, auth });
    if (!ctx) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    auth.deletePasskeyById(params.id);
    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerAuth, requireUser };
