const os = require("node:os");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CONTEXT_DIR = path.join(ROOT_DIR, "ai-context");
const WEB_DIST_DIR = path.join(ROOT_DIR, "apps", "web", "dist");

const CODEX_PROFILES_DIR = path.join(os.homedir(), ".codex-friday-v2", "profiles");

module.exports = { ROOT_DIR, DATA_DIR, CONTEXT_DIR, WEB_DIST_DIR, CODEX_PROFILES_DIR };

