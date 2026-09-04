const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const { ROOT_DIR, RUNBOOKS_DIR } = require("../config/paths");
const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { loadRunbooksFromDir } = require("../lib/runbooks");
const { getPersonaById } = require("../lib/personas");

const OPS_DIR = path.join(ROOT_DIR, "data", "ops");
const DIGEST_TOOL = path.join(ROOT_DIR, "tools", "ops", "openclaw_digest.mjs");
const AUDIT_TOOL = path.join(ROOT_DIR, "tools", "ops", "openclaw_capability_audit.mjs");
const CONTROL_TOWER_TOOL = path.join(ROOT_DIR, "tools", "ops", "control_tower_snapshot.mjs");
const WORKSTREAM_TOOL = path.join(ROOT_DIR, "tools", "ops", "workstream_snapshot.mjs");
const ACTIONS_TOOL = path.join(ROOT_DIR, "tools", "message-automation", "actions.mjs");
const GOOGLE_HTTP_TOOL = path.join(ROOT_DIR, "tools", "google", "google_http_request.mjs");
const MICROSOFT_HTTP_TOOL = path.join(ROOT_DIR, "tools", "microsoft", "microsoft_http_request.mjs");

const DIGEST_JSON = path.join(OPS_DIR, "latest-openclaw-digest.json");
const DIGEST_MD = path.join(OPS_DIR, "latest-openclaw-digest.md");
const AUDIT_JSON = path.join(OPS_DIR, "latest-capability-audit.json");
const CONTROL_TOWER_JSON = path.join(OPS_DIR, "latest-control-tower-snapshot.json");
const WORKSTREAM_JSON = path.join(OPS_DIR, "latest-workstream-snapshot.json");
const FLOW_JSON = path.join(OPS_DIR, "flow-layout.json");
const FLOW_REGISTRY_JSON = path.join(OPS_DIR, "flow-registry.json");
const AI_COMMANDS_REGISTRY_JSON = path.resolve(ROOT_DIR, "..", "ai", "capabilities", "ai-commands.json");
const OPS_EVENTS_JSONL = path.join(OPS_DIR, "ops-events.jsonl");

const MESSAGE_AUTOMATION_DIR = path.join(ROOT_DIR, "data", "message-automation");
const ACTIONS_JSON = path.join(MESSAGE_AUTOMATION_DIR, "actions.json");
const ACTIONS_EVENTS_JSONL = path.join(MESSAGE_AUTOMATION_DIR, "events.jsonl");
const DB_PATH = path.join(ROOT_DIR, "data", "friday.sqlite");

const NODE_BIN = "/opt/homebrew/bin/node";
const NPM_BIN = "/opt/homebrew/bin/npm";
const SHELL_BIN = "/bin/zsh";
const AI_ROOT_DIR = path.resolve(ROOT_DIR, "..", "ai");

function normalizeFlowKind(kind) {
  const k = String(kind || "").trim().toLowerCase();
  const allowed = new Set(["input", "process", "agent", "storage", "output", "tool", "memory", "decision"]);
  return allowed.has(k) ? k : "process";
}

function normalizeFlowNode(raw) {
  const id = String(raw?.id || "").trim();
  if (!id) return null;
  return {
    id,
    label: String(raw?.label || id).trim() || id,
    kind: normalizeFlowKind(raw?.kind),
    x: Number(raw?.x) || 0,
    y: Number(raw?.y) || 0,
    detail: raw?.detail == null ? "" : String(raw.detail),
    status: raw?.status == null ? "info" : String(raw.status),
    actionKey: raw?.actionKey == null ? "" : String(raw.actionKey),
    config: raw?.config && typeof raw.config === "object" ? raw.config : {},
  };
}

function normalizeFlowEdge(raw) {
  const from = String(raw?.from || "").trim();
  const to = String(raw?.to || "").trim();
  if (!from || !to) return null;
  return {
    id: String(raw?.id || `${from}__${to}`),
    from,
    to,
  };
}

function normalizeFlowPayload(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes.map(normalizeFlowNode).filter(Boolean) : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(payload?.edges)
    ? payload.edges.map(normalizeFlowEdge).filter((e) => e && nodeIds.has(e.from) && nodeIds.has(e.to))
    : [];

  return {
    version: 1,
    updatedAt: nowIso(),
    nodes,
    edges,
  };
}

function loadFlowPayload(fallback = { version: 1, updatedAt: null, nodes: [], edges: [] }) {
  const payload = readJsonFile(FLOW_JSON, null);
  if (!payload || typeof payload !== "object") return fallback;
  const normalized = normalizeFlowPayload(payload);
  if (!normalized.updatedAt && payload.updatedAt) normalized.updatedAt = String(payload.updatedAt);
  return normalized;
}

function saveFlowPayload(payload) {
  const normalized = normalizeFlowPayload(payload);
  writeJsonFile(FLOW_JSON, normalized);
  return normalized;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function safeDateMs(v) {
  const n = Date.parse(String(v || ""));
  return Number.isFinite(n) ? n : null;
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readTextFile(filePath, fallback = "") {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function readJsonLines(filePath, limit = 100) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = String(raw)
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
    const out = [];
    for (const line of lines) {
      const obj = parseJson(line, null);
      if (obj && typeof obj === "object") out.push(obj);
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeIntentText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toUniqueStringList(value, limit = 100) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const item = String(raw || "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function loadAiCommandSet() {
  const registry = readJsonFile(AI_COMMANDS_REGISTRY_JSON, null);
  const commands = Array.isArray(registry?.commands)
    ? registry.commands.map((x) => String(x?.name || "").trim()).filter(Boolean)
    : [];
  return {
    found: commands.length > 0,
    commands: new Set(commands),
  };
}

function validateFlowRegistryPayload(flowRegistry, aiCommandsSet = new Set(), { checkAiCommands = true } = {}) {
  const errors = [];
  const warnings = [];

  if (!flowRegistry || typeof flowRegistry !== "object") {
    errors.push("Flow registry must be a JSON object.");
    return { ok: false, errors, warnings, stats: {} };
  }

  if (Number(flowRegistry.schemaVersion) !== 1) {
    errors.push(`Unsupported schemaVersion: ${flowRegistry.schemaVersion}`);
  }

  const responseContract = Array.isArray(flowRegistry.responseContract) ? flowRegistry.responseContract : [];
  if (!responseContract.length) warnings.push("responseContract is empty.");

  const flows = Array.isArray(flowRegistry.flows) ? flowRegistry.flows : [];
  if (!flows.length) errors.push("flows must be a non-empty array.");

  const flowIds = new Set();
  const triggerToFlow = new Map();
  const allowedKinds = new Set(["ai_cmd", "shell_cmd", "note"]);

  let aiStepCount = 0;
  let shellStepCount = 0;
  let noteStepCount = 0;

  for (const flow of flows) {
    const id = String(flow?.id || "").trim();
    const title = String(flow?.title || "").trim();
    if (!id) {
      errors.push("Flow missing id.");
      continue;
    }
    if (flowIds.has(id)) errors.push(`Duplicate flow id: ${id}`);
    flowIds.add(id);
    if (!title) errors.push(`Flow ${id} missing title.`);

    const triggers = toUniqueStringList(flow?.triggers, 100).map(normalizeIntentText).filter(Boolean);
    if (!triggers.length) errors.push(`Flow ${id} must include at least one trigger.`);
    for (const trigger of triggers) {
      if (triggerToFlow.has(trigger)) {
        errors.push(`Duplicate trigger phrase: "${trigger}" used by ${triggerToFlow.get(trigger)} and ${id}`);
      } else {
        triggerToFlow.set(trigger, id);
      }
    }

    const diagnoseSteps = Array.isArray(flow?.diagnoseSteps) ? flow.diagnoseSteps : [];
    const repairSteps = Array.isArray(flow?.repairSteps) ? flow.repairSteps : [];
    const verifySteps = Array.isArray(flow?.verifySteps) ? flow.verifySteps : [];
    if (!diagnoseSteps.length) errors.push(`Flow ${id} must include at least one diagnose step.`);
    if (repairSteps.length && !diagnoseSteps.length) errors.push(`Flow ${id} has repair steps without diagnose steps.`);

    const allSteps = [
      ...diagnoseSteps.map((step) => ({ phase: "diagnose", step })),
      ...repairSteps.map((step) => ({ phase: "repair", step })),
      ...verifySteps.map((step) => ({ phase: "verify", step })),
    ];

    for (const item of allSteps) {
      const step = item.step || {};
      const stepId = String(step.id || "").trim();
      const kind = String(step.kind || "").trim();
      if (!stepId) errors.push(`Flow ${id} has ${item.phase} step without id.`);
      if (!allowedKinds.has(kind)) {
        errors.push(`Flow ${id} step ${stepId || "<missing>"} has invalid kind: ${kind}`);
        continue;
      }

      if (kind === "ai_cmd") {
        aiStepCount += 1;
        const command = String(step.command || "").trim();
        if (!command) {
          errors.push(`Flow ${id} step ${stepId || "<missing>"} missing ai command.`);
          continue;
        }
        if (/\s/.test(command)) {
          errors.push(`Flow ${id} step ${stepId} command must not include args: "${command}"`);
        }
        if (checkAiCommands && aiCommandsSet.size > 0 && !aiCommandsSet.has(command)) {
          errors.push(`Flow ${id} step ${stepId} references unknown ai command: ${command}`);
        }
        const argsTemplate = String(step.argsTemplate || "");
        if (/npm\s+run\s+ai/i.test(argsTemplate)) {
          errors.push(`Flow ${id} step ${stepId} argsTemplate must not include npm wrapper.`);
        }
      } else if (kind === "shell_cmd") {
        shellStepCount += 1;
        const template = String(step.template || "").trim();
        if (!template) errors.push(`Flow ${id} shell step ${stepId || "<missing>"} missing template.`);
      } else if (kind === "note") {
        noteStepCount += 1;
        const template = String(step.template || "").trim();
        if (!template) errors.push(`Flow ${id} note step ${stepId || "<missing>"} missing template.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      flowCount: flows.length,
      triggerCount: triggerToFlow.size,
      aiStepCount,
      shellStepCount,
      noteStepCount,
      aiCommandCount: aiCommandsSet.size,
    },
  };
}

function loadFlowRegistryWithValidation() {
  const flowRegistry = readJsonFile(FLOW_REGISTRY_JSON, null);
  const aiRegistry = loadAiCommandSet();
  const validation = validateFlowRegistryPayload(flowRegistry, aiRegistry.commands, { checkAiCommands: aiRegistry.found });
  if (!aiRegistry.found) {
    validation.warnings.push(`AI command registry unavailable at ${AI_COMMANDS_REGISTRY_JSON}`);
  }
  return {
    registry: flowRegistry,
    validation,
    sources: {
      flowRegistryPath: FLOW_REGISTRY_JSON,
      aiRegistryPath: AI_COMMANDS_REGISTRY_JSON,
    },
  };
}

function normalizeInputIndex(rawInputs) {
  const out = new Map();
  const source = rawInputs && typeof rawInputs === "object" && !Array.isArray(rawInputs) ? rawInputs : {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey || "").trim();
    if (!key || rawValue == null) continue;
    const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
    if (!value) continue;
    out.set(key, value);
    out.set(key.toLowerCase(), value);
  }
  return out;
}

function getInputValue(inputIndex, key) {
  const clean = String(key || "").trim();
  if (!clean) return "";
  return String(inputIndex.get(clean) || inputIndex.get(clean.toLowerCase()) || "");
}

function renderTemplateWithInputs(template, inputIndex) {
  const source = String(template || "");
  if (!source.trim()) return "";
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key) => {
    const value = getInputValue(inputIndex, key);
    return value || `{${key}}`;
  });
}

function toNormalizedTokenSet(normalizedText) {
  return new Set(
    String(normalizedText || "")
      .split(" ")
      .map((x) => String(x || "").trim())
      .filter(Boolean),
  );
}

function scoreTriggerMatch(normalizedText, tokenSet, trigger) {
  const t = normalizeIntentText(trigger);
  if (!t) return { matched: false, score: 0, trigger: "", mode: "none" };
  if (!normalizedText) return { matched: false, score: 0, trigger: t, mode: "none" };

  const tokenCount = t.split(" ").filter(Boolean).length || 1;
  if (normalizedText === t) {
    return { matched: true, score: 320 + tokenCount * 20, trigger: t, mode: "exact" };
  }
  if (normalizedText.includes(t)) {
    return { matched: true, score: 220 + tokenCount * 14, trigger: t, mode: "phrase" };
  }

  const triggerTokens = t.split(" ").filter(Boolean);
  if (triggerTokens.length > 0 && triggerTokens.every((tok) => tokenSet.has(tok))) {
    return { matched: true, score: 140 + tokenCount * 10, trigger: t, mode: "token_set" };
  }
  return { matched: false, score: 0, trigger: t, mode: "none" };
}

function resolveFixIntent({ textNormalized, fixIntentPatterns = [], explicitFixIntent } = {}) {
  if (typeof explicitFixIntent === "boolean") {
    return { value: explicitFixIntent, source: "explicit", pattern: null };
  }

  const patterns = toUniqueStringList(fixIntentPatterns, 100).map(normalizeIntentText).filter(Boolean);
  for (const pattern of patterns) {
    if (pattern && String(textNormalized || "").includes(pattern)) {
      return { value: true, source: "pattern", pattern };
    }
  }
  return { value: false, source: "pattern", pattern: null };
}

function dedupeStrings(values, limit = 100) {
  return toUniqueStringList(values, limit);
}

function buildPlanStep(step, inputIndex, { phase = "diagnose", fixIntentEnabled = false } = {}) {
  const raw = step && typeof step === "object" ? step : {};
  const id = String(raw.id || "").trim();
  const kind = String(raw.kind || "").trim();
  const requiredInputs = toUniqueStringList(raw.requiredInputs, 30);
  const missingInputs = requiredInputs.filter((name) => !getInputValue(inputIndex, name));
  const requiresFixIntent = raw.requiresFixIntent === true;
  const blockedByFixIntent = phase === "repair" && requiresFixIntent && !fixIntentEnabled;

  const base = {
    id,
    kind,
    requiredInputs,
    missingInputs,
    requiresFixIntent,
    condition: raw.condition ? String(raw.condition) : null,
    blockedByFixIntent,
    runnable: missingInputs.length === 0 && !blockedByFixIntent,
  };

  if (kind === "ai_cmd") {
    const command = String(raw.command || "").trim();
    const args = renderTemplateWithInputs(raw.argsTemplate || "", inputIndex).trim();
    return {
      ...base,
      command,
      argsTemplate: String(raw.argsTemplate || ""),
      args,
      run: command ? `${NPM_BIN} run ai -- ${command}${args ? ` ${args}` : ""}` : "",
    };
  }

  if (kind === "shell_cmd") {
    const template = String(raw.template || "");
    const rendered = renderTemplateWithInputs(template, inputIndex).trim();
    return {
      ...base,
      template,
      run: rendered,
    };
  }

  if (kind === "note") {
    const template = String(raw.template || "");
    return {
      ...base,
      template,
      note: renderTemplateWithInputs(template, inputIndex),
    };
  }

  return base;
}

function resolveFlowIntentPlan({ text = "", inputs = {}, fixIntent = null, registry = null } = {}) {
  const normalizedText = normalizeIntentText(text);
  const flows = Array.isArray(registry?.flows) ? registry.flows : [];
  const tokenSet = toNormalizedTokenSet(normalizedText);
  const ranked = [];

  for (const flow of flows) {
    const flowId = String(flow?.id || "").trim();
    if (!flowId) continue;
    const triggers = toUniqueStringList(flow?.triggers, 100).map(normalizeIntentText).filter(Boolean);
    const matches = [];
    let triggerScore = 0;
    for (const trigger of triggers) {
      const match = scoreTriggerMatch(normalizedText, tokenSet, trigger);
      if (!match.matched) continue;
      matches.push(match);
      triggerScore += match.score;
    }
    if (!matches.length) continue;

    const priority = Number(flow?.priority) || 0;
    const matchScore = triggerScore * 100 + priority;
    ranked.push({
      flow,
      flowId,
      priority,
      score: matchScore,
      matchedTriggers: matches.sort((a, b) => Number(b.score) - Number(a.score)),
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.flowId.localeCompare(b.flowId);
  });

  const selected = ranked[0] || null;
  const resolvedFixIntent = resolveFixIntent({
    textNormalized: normalizedText,
    fixIntentPatterns: registry?.fixIntentPatterns,
    explicitFixIntent: fixIntent,
  });

  if (!selected) {
    return {
      ok: true,
      text,
      normalizedText,
      fixIntent: resolvedFixIntent,
      match: null,
      candidates: [],
      plan: null,
      missingInputs: [],
    };
  }

  const inputIndex = normalizeInputIndex(inputs);
  const diagnose = (Array.isArray(selected.flow?.diagnoseSteps) ? selected.flow.diagnoseSteps : []).map((step) =>
    buildPlanStep(step, inputIndex, { phase: "diagnose", fixIntentEnabled: resolvedFixIntent.value }),
  );
  const repair = (Array.isArray(selected.flow?.repairSteps) ? selected.flow.repairSteps : []).map((step) =>
    buildPlanStep(step, inputIndex, { phase: "repair", fixIntentEnabled: resolvedFixIntent.value }),
  );
  const verify = (Array.isArray(selected.flow?.verifySteps) ? selected.flow.verifySteps : []).map((step) =>
    buildPlanStep(step, inputIndex, { phase: "verify", fixIntentEnabled: resolvedFixIntent.value }),
  );

  const diagnoseMissing = dedupeStrings(diagnose.flatMap((step) => step.missingInputs || []));
  const repairMissing = dedupeStrings(repair.flatMap((step) => step.missingInputs || []));
  const verifyMissing = dedupeStrings(verify.flatMap((step) => step.missingInputs || []));
  const activeRepairMissing = resolvedFixIntent.value ? repairMissing : [];
  const missingInputs = dedupeStrings([...diagnoseMissing, ...activeRepairMissing, ...verifyMissing]);

  return {
    ok: true,
    text,
    normalizedText,
    fixIntent: resolvedFixIntent,
    match: {
      id: selected.flowId,
      title: String(selected.flow?.title || selected.flowId),
      priority: selected.priority,
      score: selected.score,
      matchedTriggers: selected.matchedTriggers,
    },
    candidates: ranked.slice(0, 3).map((item) => ({
      id: item.flowId,
      title: String(item.flow?.title || item.flowId),
      priority: item.priority,
      score: item.score,
      matchedTriggers: item.matchedTriggers,
    })),
    plan: {
      diagnose: {
        ready: diagnose.every((step) => step.runnable),
        missingInputs: diagnoseMissing,
        steps: diagnose,
      },
      repair: {
        enabled: resolvedFixIntent.value,
        reason: resolvedFixIntent.value ? null : "repair requires explicit fix intent",
        ready: resolvedFixIntent.value && repair.every((step) => step.runnable),
        missingInputs: repairMissing,
        steps: repair,
      },
      verify: {
        ready: verify.every((step) => step.runnable),
        missingInputs: verifyMissing,
        steps: verify,
      },
    },
    missingInputs,
  };
}

function truncateText(value, max = 1600) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...(truncated)`;
}

function runShellCommand(command, { cwd = ROOT_DIR, timeoutMs = 90000 } = {}) {
  const r = spawnSync(SHELL_BIN, ["-lc", String(command || "")], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function normalizeFactValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function recordFactsFromObject(target, value, prefix = "", depth = 0) {
  if (!target || typeof target !== "object" || depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    if (prefix && value.length > 0 && value.length <= 6) {
      const primitives = value.every((item) => item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean");
      if (primitives) target[prefix] = value.map((x) => normalizeFactValue(x));
    }
    return;
  }
  if (typeof value === "object") {
    for (const [rawKey, next] of Object.entries(value)) {
      const key = String(rawKey || "").trim();
      if (!key) continue;
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      recordFactsFromObject(target, next, nextPrefix, depth + 1);
    }
    return;
  }

  const key = String(prefix || "").trim();
  if (!key) return;
  const normalized = normalizeFactValue(value);
  target[key] = normalized;
  const leaf = key.includes(".") ? key.split(".").slice(-1)[0] : key;
  if (leaf) target[leaf] = normalized;
}

function extractFactsFromCommandOutput(text) {
  const out = {};
  const parsed = parseJsonFromText(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    recordFactsFromObject(out, parsed);
  }

  const raw = String(text || "");
  const regex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]\s*(true|false|-?\d+(?:\.\d+)?|healthy|degraded|down|up|ok|failed|failing)/gi;
  for (const match of raw.matchAll(regex)) {
    const key = String(match[1] || "").trim();
    const value = normalizeFactValue(match[2]);
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function parseConditionRequirements(condition) {
  const text = String(condition || "");
  const requirements = [];
  const regex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(true|false|-?\d+(?:\.\d+)?|[a-zA-Z0-9_.-]+)/g;
  for (const match of text.matchAll(regex)) {
    const key = String(match[1] || "").trim();
    const expectedRaw = String(match[2] || "").trim();
    if (!key || !expectedRaw) continue;
    requirements.push({ key, expected: normalizeFactValue(expectedRaw), expectedRaw });
  }
  return requirements;
}

function evaluateStepCondition(condition, facts) {
  const requirements = parseConditionRequirements(condition);
  if (!requirements.length) return { shouldRun: true, reason: null, requirements: [] };

  let unknown = false;
  for (const req of requirements) {
    if (!Object.prototype.hasOwnProperty.call(facts, req.key)) {
      unknown = true;
      continue;
    }
    const actual = normalizeFactValue(facts[req.key]);
    if (actual !== req.expected) {
      return {
        shouldRun: false,
        reason: `condition_not_met:${req.key}=${String(actual)} expected ${String(req.expectedRaw)}`,
        requirements,
      };
    }
  }

  if (unknown) {
    return { shouldRun: false, reason: "condition_data_missing", requirements };
  }
  return { shouldRun: true, reason: null, requirements };
}

function buildSkippedStepResult(step, phase, reason) {
  return {
    id: String(step?.id || ""),
    phase,
    kind: String(step?.kind || ""),
    status: "skipped",
    ok: true,
    reason: String(reason || "skipped"),
    command: String(step?.run || ""),
    note: step?.kind === "note" ? String(step?.note || step?.template || "") : "",
    code: null,
    durationMs: 0,
    stdout: "",
    stderr: "",
    facts: {},
  };
}

function executeResolvedPlanStep(step, phase, { facts = {}, timeoutMs = 90000 } = {}) {
  if (!step || typeof step !== "object") {
    return buildSkippedStepResult({}, phase, "invalid_step");
  }

  if (step.runnable !== true) {
    if (step.blockedByFixIntent) return buildSkippedStepResult(step, phase, "fix_intent_required");
    if (Array.isArray(step.missingInputs) && step.missingInputs.length) {
      return buildSkippedStepResult(step, phase, `missing_inputs:${step.missingInputs.join(",")}`);
    }
    return buildSkippedStepResult(step, phase, "not_runnable");
  }

  if (step.condition) {
    const evalResult = evaluateStepCondition(step.condition, facts);
    if (!evalResult.shouldRun) {
      return buildSkippedStepResult(step, phase, evalResult.reason || "condition_not_met");
    }
  }

  if (step.kind === "note") {
    return {
      id: String(step.id || ""),
      phase,
      kind: "note",
      status: "noted",
      ok: true,
      reason: null,
      command: "",
      note: String(step.note || step.template || ""),
      code: null,
      durationMs: 0,
      stdout: "",
      stderr: "",
      facts: {},
    };
  }

  const command = String(step.run || "").trim();
  if (!command) {
    return {
      id: String(step.id || ""),
      phase,
      kind: String(step.kind || ""),
      status: "failed",
      ok: false,
      reason: "missing_command",
      command: "",
      note: "",
      code: null,
      durationMs: 0,
      stdout: "",
      stderr: "",
      facts: {},
    };
  }

  const cwd = step.kind === "ai_cmd" ? AI_ROOT_DIR : ROOT_DIR;
  const started = Date.now();
  const result = runShellCommand(command, { cwd, timeoutMs });
  const durationMs = Date.now() - started;
  const parsedFacts = extractFactsFromCommandOutput(result.stdout);
  Object.assign(facts, parsedFacts);

  return {
    id: String(step.id || ""),
    phase,
    kind: String(step.kind || ""),
    status: result.ok ? "ok" : "failed",
    ok: result.ok,
    reason: result.ok ? null : `exit_code_${String(result.code ?? "unknown")}`,
    command,
    note: "",
    cwd,
    code: result.code,
    durationMs,
    stdout: truncateText(result.stdout, 3000),
    stderr: truncateText(result.stderr, 2000),
    facts: parsedFacts,
  };
}

function summarizeExecutionPhase(steps) {
  const rows = Array.isArray(steps) ? steps : [];
  const summary = {
    total: rows.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    noted: 0,
    durationMs: 0,
  };
  for (const row of rows) {
    summary.durationMs += Number(row?.durationMs || 0);
    if (row?.status === "ok") summary.ok += 1;
    else if (row?.status === "failed") summary.failed += 1;
    else if (row?.status === "skipped") summary.skipped += 1;
    else if (row?.status === "noted") summary.noted += 1;
  }
  return summary;
}

function inferDeterministicOpsStatus({ facts = {}, diagnoseSummary, repairSummary, verifySummary, repairAttempted = false } = {}) {
  const diag = diagnoseSummary || { failed: 0, ok: 0 };
  const rep = repairSummary || { failed: 0, ok: 0 };
  const ver = verifySummary || { failed: 0, ok: 0 };
  if (diag.failed > 0 || rep.failed > 0 || ver.failed > 0) return "still failing";

  const hintRaw = facts.status ?? facts.health ?? facts.overall_status ?? facts.state ?? facts.ok ?? null;
  const hint = normalizeFactValue(hintRaw);
  if (hint === true || hint === "healthy" || hint === "ok" || hint === "up" || hint === "pass") return "healthy";
  if (hint === false || hint === "unhealthy" || hint === "failed" || hint === "failing" || hint === "down") return "still failing";
  if (hint === "degraded") return "degraded";

  if (repairAttempted && (ver.ok > 0 || rep.ok > 0)) return "healthy";
  if (diag.ok > 0) return "degraded";
  return "still failing";
}

function buildDeterministicContractResponse({ resolution, execution, registry }) {
  const diagnoseSummary = execution?.summaries?.diagnose || {};
  const repairSummary = execution?.summaries?.repair || {};
  const verifySummary = execution?.summaries?.verify || {};
  const status = inferDeterministicOpsStatus({
    facts: execution?.facts || {},
    diagnoseSummary,
    repairSummary,
    verifySummary,
    repairAttempted: execution?.repairAttempted === true,
  });

  const title = String(resolution?.match?.title || resolution?.match?.id || "Request");
  let diagnosis = `${title}: diagnosis completed; repair not executed.`;
  if (!resolution?.match?.id) diagnosis = "No deterministic flow matched the request.";
  else if (status === "healthy" && execution?.repairAttempted) diagnosis = `${title}: repair completed and checks recovered.`;
  else if (status === "healthy") diagnosis = `${title}: diagnostic checks are healthy.`;
  else if (execution?.repairAttempted) diagnosis = `${title}: repair attempted but issue is still failing.`;

  const evidence = [];
  if (resolution?.match?.id) evidence.push(`Matched flow: ${resolution.match.id}`);
  const topTrigger = resolution?.match?.matchedTriggers?.[0];
  if (topTrigger?.trigger) evidence.push(`Matched trigger: "${topTrigger.trigger}" (${topTrigger.mode}).`);
  evidence.push(
    `Diagnose steps: ${diagnoseSummary.ok || 0} ok, ${diagnoseSummary.failed || 0} failed, ${diagnoseSummary.skipped || 0} skipped.`,
  );
  if (execution?.runRepairRequested) {
    evidence.push(
      `Repair steps: ${repairSummary.ok || 0} ok, ${repairSummary.failed || 0} failed, ${repairSummary.skipped || 0} skipped.`,
    );
  }
  if (execution?.runVerify) {
    evidence.push(
      `Verify steps: ${verifySummary.ok || 0} ok, ${verifySummary.failed || 0} failed, ${verifySummary.skipped || 0} skipped.`,
    );
  }
  if (Array.isArray(resolution?.missingInputs) && resolution.missingInputs.length) {
    evidence.push(`Missing inputs: ${resolution.missingInputs.join(", ")}.`);
  }
  const firstFailure = [...(execution?.phases?.diagnose || []), ...(execution?.phases?.repair || []), ...(execution?.phases?.verify || [])].find(
    (step) => step?.status === "failed",
  );
  if (firstFailure) {
    evidence.push(`First failure: ${firstFailure.id} (${firstFailure.reason || "failed"}).`);
  }

  const actions = [...(execution?.phases?.diagnose || []), ...(execution?.phases?.repair || []), ...(execution?.phases?.verify || [])].map((step) => {
    if (step?.kind === "note") return `[${step.phase}] [noted] ${String(step.note || "").trim()}`;
    const cmd = String(step?.command || "").trim();
    const detail = cmd || step?.reason || "no-op";
    return `[${step?.phase || "phase"}] [${step?.status || "unknown"}] ${detail}`;
  });

  let nextAction = "No immediate action needed.";
  if (Array.isArray(resolution?.missingInputs) && resolution.missingInputs.length) {
    nextAction = `Provide missing inputs: ${resolution.missingInputs.join(", ")}.`;
  } else if (status === "still failing" && !execution?.repairAttempted && Array.isArray(resolution?.plan?.repair?.steps) && resolution.plan.repair.steps.length) {
    nextAction = "Reply with fix intent to run repair steps.";
  } else if (status === "still failing") {
    nextAction = `Escalate using the manual runbook for flow ${String(resolution?.match?.id || "unknown")}.`;
  } else if (status === "degraded" && !execution?.repairAttempted && Array.isArray(resolution?.plan?.repair?.steps) && resolution.plan.repair.steps.length) {
    nextAction = "Run repair mode, then re-run verification.";
  }

  return {
    diagnosis,
    evidence,
    actions: actions.length ? actions : ["No commands executed."],
    status,
    nextAction,
    contractTemplate: Array.isArray(registry?.responseContract) ? registry.responseContract : [],
  };
}

function executeResolvedFlowPlan({ resolution, runRepair = false, runVerify = false, timeoutMs = 90000 } = {}) {
  if (!resolution?.match?.id || !resolution?.plan) {
    return {
      ok: false,
      error: "no_flow_match",
      phases: { diagnose: [], repair: [], verify: [] },
      summaries: { diagnose: summarizeExecutionPhase([]), repair: summarizeExecutionPhase([]), verify: summarizeExecutionPhase([]) },
      runRepairRequested: false,
      runVerify: false,
      repairAttempted: false,
      facts: {},
    };
  }

  const facts = {};
  const diagnoseSteps = Array.isArray(resolution?.plan?.diagnose?.steps) ? resolution.plan.diagnose.steps : [];
  const repairSteps = Array.isArray(resolution?.plan?.repair?.steps) ? resolution.plan.repair.steps : [];
  const verifySteps = Array.isArray(resolution?.plan?.verify?.steps) ? resolution.plan.verify.steps : [];

  const diagnose = diagnoseSteps.map((step) => executeResolvedPlanStep(step, "diagnose", { facts, timeoutMs }));
  const runRepairRequested = Boolean(runRepair);
  const repair = runRepairRequested
    ? repairSteps.map((step) => executeResolvedPlanStep(step, "repair", { facts, timeoutMs }))
    : [];
  const repairAttempted = runRepairRequested && repair.length > 0;

  const verifyRequested = Boolean(runVerify || repairAttempted);
  const verify = verifyRequested ? verifySteps.map((step) => executeResolvedPlanStep(step, "verify", { facts, timeoutMs })) : [];

  const summaries = {
    diagnose: summarizeExecutionPhase(diagnose),
    repair: summarizeExecutionPhase(repair),
    verify: summarizeExecutionPhase(verify),
  };

  return {
    ok: summaries.diagnose.failed === 0 && summaries.repair.failed === 0 && summaries.verify.failed === 0,
    phases: { diagnose, repair, verify },
    summaries,
    runRepairRequested,
    runVerify: verifyRequested,
    repairAttempted,
    facts,
  };
}

function runTool(scriptPath, args = [], { cwd = ROOT_DIR, timeoutMs = 30000 } = {}) {
  const r = spawnSync(NODE_BIN, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function runBin(binPath, args = [], { cwd = ROOT_DIR, timeoutMs = 10000 } = {}) {
  const r = spawnSync(binPath, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
  };
}

function buildMicrosoftPreflight({ deps = {} } = {}) {
  const node = runBin(NODE_BIN, ["-v"], { timeoutMs: 8000 });
  const toolExists = fs.existsSync(MICROSOFT_HTTP_TOOL);
  const listed = deps?.microsoftAccounts && typeof deps.microsoftAccounts.list === "function" ? deps.microsoftAccounts.list() : [];
  const accounts = Array.isArray(listed)
    ? listed.map((a) => ({
        accountKey: String(a?.accountKey || ""),
        label: String(a?.label || ""),
        kind: String(a?.kind || ""),
        email: String(a?.email || ""),
        scopes: String(a?.scopes || ""),
        updatedAt: String(a?.updatedAt || ""),
      }))
    : [];

  const probes = [];
  if (toolExists && node.ok) {
    for (const acct of accounts.slice(0, 3)) {
      const accountKey = String(acct.accountKey || "").trim();
      if (!accountKey) continue;
      const probe = runTool(
        MICROSOFT_HTTP_TOOL,
        [
          "--account",
          accountKey,
          "--method",
          "GET",
          "--url",
          "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
        ],
        { timeoutMs: 30000 },
      );
      const parsed = probe.ok ? parseJson(probe.stdout, null) : null;
      probes.push({
        accountKey,
        ok: probe.ok,
        code: probe.code,
        stderr: probe.stderr ? String(probe.stderr).slice(0, 400) : "",
        profile: parsed && typeof parsed === "object"
          ? {
              id: String(parsed.id || ""),
              displayName: String(parsed.displayName || ""),
              mail: String(parsed.mail || parsed.userPrincipalName || ""),
            }
          : null,
      });
    }
  }

  return {
    generatedAt: nowIso(),
    node: {
      ok: node.ok,
      version: node.stdout || "",
      stderr: node.stderr || "",
      path: NODE_BIN,
    },
    tool: {
      exists: toolExists,
      path: MICROSOFT_HTTP_TOOL,
    },
    accounts,
    probes,
  };
}

function appendOpsEvent(type, payload = {}) {
  try {
    ensureDir(OPS_EVENTS_JSONL);
    const evt = { ts: nowIso(), type, payload };
    fs.appendFileSync(OPS_EVENTS_JSONL, `${JSON.stringify(evt)}\n`, "utf8");
  } catch {
    // best effort
  }
}

function hasTable(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;")
    .get(String(name));
  return Boolean(row?.name);
}

function normalizeActionStatus(status) {
  const s = String(status || "all").trim().toLowerCase();
  const allowed = new Set(["all", "pending", "confirmed", "cancelled", "completed"]);
  return allowed.has(s) ? s : "all";
}

function loadActionStore({ status = "all", limit = 200 } = {}) {
  const actions = readJsonFile(ACTIONS_JSON, []);
  const arr = Array.isArray(actions) ? actions : [];

  const counts = {
    total: arr.length,
    pending: arr.filter((a) => String(a?.status || "") === "pending").length,
    confirmed: arr.filter((a) => String(a?.status || "") === "confirmed").length,
    cancelled: arr.filter((a) => String(a?.status || "") === "cancelled").length,
    completed: arr.filter((a) => String(a?.status || "") === "completed").length,
  };

  const filtered = arr
    .filter((a) => (status === "all" ? true : String(a?.status || "") === status))
    .sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));

  return { counts, actions: filtered };
}

function loadDbStats() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      triage: { open: 0, completed: 0, dismissed: 0, nextActionOpen: 0, quickReadOpen: 0, urgentOpen: 0 },
      triageOpenItems: [],
      triageFeedback: [],
      runbookStateRows: [],
      runbookRuns: [],
    };
  }

  const db = new DatabaseSync(DB_PATH, { readonly: true });
  try {
    const triageCounts = { open: 0, completed: 0, dismissed: 0, nextActionOpen: 0, quickReadOpen: 0, urgentOpen: 0 };
    const triageOpenItems = [];
    const triageFeedback = [];
    const runbookStateRows = [];
    const runbookRuns = [];

    if (hasTable(db, "triage_items")) {
      const byStatus = db.prepare("SELECT status, COUNT(*) AS c FROM triage_items GROUP BY status;").all();
      for (const row of byStatus) {
        const k = String(row.status || "");
        if (k in triageCounts) triageCounts[k] = Number(row.c || 0);
      }

      const byKind = db
        .prepare("SELECT kind, COUNT(*) AS c FROM triage_items WHERE status='open' GROUP BY kind;")
        .all();
      for (const row of byKind) {
        const k = String(row.kind || "");
        if (k === "next_action") triageCounts.nextActionOpen = Number(row.c || 0);
        if (k === "quick_read") triageCounts.quickReadOpen = Number(row.c || 0);
      }

      const urgent = db
        .prepare("SELECT COUNT(*) AS c FROM triage_items WHERE status='open' AND priority >= 2;")
        .get();
      triageCounts.urgentOpen = Number(urgent?.c || 0);

      triageOpenItems.push(
        ...db
          .prepare(
            "SELECT id, runbook_id AS runbookId, kind, status, title, summary_md AS summaryMd, priority, confidence_pct AS confidencePct, source_key AS sourceKey, source_json AS sourceJson, chat_id AS chatId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM triage_items WHERE status='open' ORDER BY priority DESC, updated_at DESC LIMIT 80;",
          )
          .all()
          .map((row) => ({ ...row, source: parseJson(row.sourceJson, null) }))
      );

      if (hasTable(db, "triage_feedback")) {
        triageFeedback.push(
          ...db
            .prepare(
              "SELECT f.id, f.item_id AS itemId, f.kind, f.actor, f.reason, f.outcome, f.notes, f.meta_json AS metaJson, f.created_at AS createdAt, t.title AS itemTitle FROM triage_feedback f LEFT JOIN triage_items t ON t.id = f.item_id ORDER BY f.created_at DESC LIMIT 100;",
            )
            .all()
            .map((row) => ({ ...row, meta: parseJson(row.metaJson, null) }))
        );
      }
    }

    if (hasTable(db, "runbook_state")) {
      runbookStateRows.push(
        ...db
          .prepare(
            "SELECT runbook_id AS runbookId, chat_id AS chatId, last_run_at AS lastRunAt, last_status AS lastStatus, last_error AS lastError, updated_at AS updatedAt FROM runbook_state ORDER BY runbook_id ASC;",
          )
          .all(),
      );
    }

    if (hasTable(db, "runbook_runs")) {
      runbookRuns.push(
        ...db
          .prepare(
            "SELECT id, runbook_id AS runbookId, task_id AS taskId, status, started_at AS startedAt, finished_at AS finishedAt, error, created_at AS createdAt FROM runbook_runs ORDER BY started_at DESC LIMIT 120;",
          )
          .all(),
      );
    }

    return {
      triage: triageCounts,
      triageOpenItems,
      triageFeedback,
      runbookStateRows,
      runbookRuns,
    };
  } finally {
    db.close();
  }
}

function buildRunbookRows(runbookStateRows = []) {
  const defs = loadRunbooksFromDir(RUNBOOKS_DIR);
  const stateById = new Map((Array.isArray(runbookStateRows) ? runbookStateRows : []).map((r) => [String(r.runbookId), r]));

  const rows = defs.map((rb) => {
    const st = stateById.get(String(rb.id)) || null;
    const enabled = Boolean(rb.meta?.enabled);
    const everyMinutes = rb.meta?.everyMinutes != null ? Number(rb.meta.everyMinutes) || null : null;
    const lastRunAt = st?.lastRunAt || null;
    const lastRunMs = safeDateMs(lastRunAt);

    const nextRunAt =
      enabled && everyMinutes && Number.isFinite(lastRunMs)
        ? new Date(lastRunMs + everyMinutes * 60 * 1000).toISOString()
        : enabled && everyMinutes
          ? new Date(Date.now() + everyMinutes * 60 * 1000).toISOString()
          : null;

    const stale =
      Boolean(enabled && everyMinutes && Number.isFinite(lastRunMs) && Date.now() - lastRunMs > everyMinutes * 60 * 1000 * 2.2);

    return {
      runbookId: rb.id,
      title: rb.meta?.title || rb.id,
      enabled,
      everyMinutes,
      timezone: rb.meta?.timezone || "Europe/London",
      accounts: Array.isArray(rb.meta?.accounts) ? rb.meta.accounts : [],
      path: rb.path,
      lastStatus: st?.lastStatus || "never",
      lastRunAt,
      lastError: st?.lastError || null,
      nextRunAt,
      stale,
    };
  });

  for (const row of runbookStateRows) {
    if (rows.some((r) => r.runbookId === row.runbookId)) continue;
    rows.push({
      runbookId: row.runbookId,
      title: row.runbookId,
      enabled: false,
      everyMinutes: null,
      timezone: "Europe/London",
      accounts: [],
      path: null,
      lastStatus: row.lastStatus || "unknown",
      lastRunAt: row.lastRunAt || null,
      lastError: row.lastError || null,
      nextRunAt: null,
      stale: false,
    });
  }

  return rows.sort((a, b) => String(a.runbookId).localeCompare(String(b.runbookId), "en"));
}

function buildChannels(digestJson) {
  const accounts = digestJson?.channels?.channelAccounts || {};
  const rows = [];

  for (const [channel, channelRows] of Object.entries(accounts)) {
    if (!Array.isArray(channelRows)) continue;
    for (const row of channelRows) {
      const configured = Boolean(row?.configured);
      const running = Boolean(row?.running);
      const connected = Boolean(row?.connected);

      let state = "missing";
      if (channel === "whatsapp") {
        state = configured && running && connected ? "ok" : configured ? "degraded" : "missing";
      } else if (channel === "imessage") {
        state = configured && running ? "ok" : configured ? "degraded" : "missing";
      } else if (channel === "slack") {
        state = configured && running ? "ok" : configured ? "degraded" : "missing";
      } else {
        state = configured && running ? "ok" : configured ? "degraded" : "missing";
      }

      rows.push({
        channel,
        accountId: row?.accountId || "default",
        name: row?.name || row?.accountId || "default",
        enabled: Boolean(row?.enabled),
        configured,
        running,
        connected,
        state,
        lastError: row?.lastError || null,
        lastInboundAt: row?.lastInboundAt || null,
        lastOutboundAt: row?.lastOutboundAt || null,
      });
    }
  }

  return rows.sort((a, b) => `${a.channel}:${a.accountId}`.localeCompare(`${b.channel}:${b.accountId}`, "en"));
}

function buildHealth({ capabilities, channels, runbooks, actionCounts, controlFindings }) {
  const missingCapabilities = Array.isArray(capabilities?.missing) ? capabilities.missing : [];
  const blockingCapabilityMissing = missingCapabilities.filter((cap) => {
    const id = String(cap?.id || "");
    return id !== "channel.slack" && id !== "binding.slack.default";
  });
  const capabilityMissing = blockingCapabilityMissing.length;
  const capabilityDegraded = Number(capabilities?.summary?.degraded || 0);

  const degradedChannels = channels.filter((c) => c.state === "degraded").length;
  const missingChannels = channels.filter((c) => c.state === "missing").length;

  const runbookErrors = runbooks.filter((r) => r.enabled && r.lastStatus === "error").length;
  const staleRunbooks = runbooks.filter((r) => r.enabled && r.stale).length;

  // Missing channels (e.g. optional Slack) should not hard-fail overall health.
  let blockers = capabilityMissing + runbookErrors;
  let warnings = capabilityDegraded + degradedChannels + missingChannels + staleRunbooks;

  if (Number(actionCounts?.pending || 0) > 0) warnings += 1;
  if ((controlFindings || []).length > 0) warnings += 1;

  const level = blockers > 0 ? "critical" : warnings > 0 ? "warn" : "ok";
  const summary =
    level === "critical"
      ? `${blockers} blocker(s), ${warnings} warning(s)`
      : level === "warn"
        ? `${warnings} warning(s)`
        : "All systems nominal";

  return { level, blockers, warnings, summary };
}

function buildTimeline({ actionEvents, opsEvents, runbookRuns, triageFeedback, limit = 120 }) {
  const items = [];

  for (const ev of actionEvents || []) {
    const id = `action:${ev.ts || ""}:${ev.type || "unknown"}:${ev.payload?.id || ""}`;
    const type = String(ev.type || "event");
    const actionId = String(ev.payload?.id || "");
    const severity = type === "cancel" ? "warn" : "info";
    const title = actionId ? `Action ${type}: ${actionId}` : `Action ${type}`;
    const detail = [ev.payload?.channel, ev.payload?.contact, ev.payload?.intent].filter(Boolean).join(" / ") || null;
    items.push({ id, ts: ev.ts || null, source: "actions", kind: type, severity, title, detail });
  }

  for (const ev of opsEvents || []) {
    const type = String(ev.type || "ops_event");
    const id = `ops:${ev.ts || ""}:${type}`;
    const title = type === "ops_refresh" ? "Ops refresh completed" : `Ops event: ${type}`;
    const severity = ev.payload?.ok === false ? "error" : "info";
    let detail = null;
    if (type === "ops_refresh") {
      const status = [
        `digest=${ev.payload?.digestOk ? "ok" : "fail"}`,
        `audit=${ev.payload?.auditOk ? "ok" : "fail"}`,
        `control=${ev.payload?.controlTowerOk ? "ok" : "fail"}`,
        `workstream=${ev.payload?.workstreamOk ? "ok" : "fail"}`,
      ].join(" ");
      detail = status;
    }
    items.push({ id, ts: ev.ts || null, source: "ops", kind: type, severity, title, detail });
  }

  for (const run of runbookRuns || []) {
    const ts = run.finishedAt || run.startedAt || run.createdAt || null;
    const id = `runbook:${run.id}`;
    const severity = run.status === "error" ? "error" : run.status === "canceled" ? "warn" : "info";
    const title = `Runbook ${run.status}: ${run.runbookId}`;
    const detail = run.error ? String(run.error).slice(0, 240) : run.taskId ? `task ${run.taskId}` : null;
    items.push({ id, ts, source: "runbook", kind: run.status, severity, title, detail });
  }

  for (const fb of triageFeedback || []) {
    const id = `triage-feedback:${fb.id}`;
    const ts = fb.createdAt || null;
    const kind = String(fb.kind || "note");
    const severity = kind === "dismissed" ? "warn" : kind === "completed" ? "ok" : "info";
    const title = `Triage ${kind}: ${fb.itemTitle || fb.itemId}`;
    const detail = fb.notes || fb.reason || fb.outcome || null;
    items.push({ id, ts, source: "triage", kind, severity, title, detail });
  }

  return items
    .sort((a, b) => {
      const am = safeDateMs(a.ts);
      const bm = safeDateMs(b.ts);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return bm - am;
    })
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 120)));
}

function buildByAccountPipeline({ actionRows = [], triageOpenItems = [] } = {}) {
  const byKey = new Map();

  function ensure(accountKey) {
    const key = normalizeAccountKey(accountKey, "unassigned");
    if (!byKey.has(key)) {
      byKey.set(key, {
        accountKey: key,
        triageOpen: 0,
        triageUrgent: 0,
        triageNextAction: 0,
        triageQuickRead: 0,
        actionsPending: 0,
        actionsConfirmed: 0,
        actionsCompleted: 0,
        actionsCancelled: 0,
        draftPending: 0,
        draftConfirmed: 0,
        draftCompleted: 0,
        draftCancelled: 0,
      });
    }
    return byKey.get(key);
  }

  for (const item of Array.isArray(triageOpenItems) ? triageOpenItems : []) {
    const account = item?.source?.gmail?.account || item?.source?.gmail?.accountKey || "";
    const row = ensure(account);
    row.triageOpen += 1;
    if (Number(item?.priority || 0) >= 2) row.triageUrgent += 1;
    if (String(item?.kind || "") === "next_action") row.triageNextAction += 1;
    if (String(item?.kind || "") === "quick_read") row.triageQuickRead += 1;
  }

  for (const action of Array.isArray(actionRows) ? actionRows : []) {
    const account = action?.meta?.accountKey || "";
    const status = String(action?.status || "").trim().toLowerCase();
    const intent = String(action?.intent || "").trim().toLowerCase();
    const row = ensure(account);
    if (status === "pending") row.actionsPending += 1;
    if (status === "confirmed") row.actionsConfirmed += 1;
    if (status === "completed") row.actionsCompleted += 1;
    if (status === "cancelled") row.actionsCancelled += 1;
    if (intent === "draft_reply") {
      if (status === "pending") row.draftPending += 1;
      if (status === "confirmed") row.draftConfirmed += 1;
      if (status === "completed") row.draftCompleted += 1;
      if (status === "cancelled") row.draftCancelled += 1;
    }
  }

  const rows = [...byKey.values()].sort((a, b) => {
    const ax = a.triageOpen + a.actionsPending + a.actionsConfirmed;
    const bx = b.triageOpen + b.actionsPending + b.actionsConfirmed;
    if (bx !== ax) return bx - ax;
    return String(a.accountKey).localeCompare(String(b.accountKey), "en");
  });

  const summary = {
    accounts: rows.length,
    triageOpen: rows.reduce((sum, r) => sum + r.triageOpen, 0),
    actionsPending: rows.reduce((sum, r) => sum + r.actionsPending, 0),
    actionsConfirmed: rows.reduce((sum, r) => sum + r.actionsConfirmed, 0),
    draftPending: rows.reduce((sum, r) => sum + r.draftPending, 0),
    draftConfirmed: rows.reduce((sum, r) => sum + r.draftConfirmed, 0),
  };

  return { summary, rows };
}

function buildOverview({ timelineLimit = 120 } = {}) {
  const generatedAt = nowIso();

  const digestJson = readJsonFile(DIGEST_JSON, null);
  const digestMarkdown = readTextFile(DIGEST_MD, "");
  const auditJson = readJsonFile(AUDIT_JSON, null);
  const controlTower = readJsonFile(CONTROL_TOWER_JSON, null);
  const workstream = readJsonFile(WORKSTREAM_JSON, null);

  const channels = buildChannels(digestJson);
  const capabilities = {
    summary: auditJson?.summary || { total: 0, configured: 0, healthy: 0, missing: 0, degraded: 0 },
    items: Array.isArray(auditJson?.capabilities) ? auditJson.capabilities : [],
    checks: auditJson?.checks || {},
  };
  capabilities.missing = capabilities.items.filter((c) => c.status === "missing");
  capabilities.degraded = capabilities.items.filter((c) => c.status === "degraded");

  const actionStore = loadActionStore({ status: "all", limit: 300 });
  const allActionRows = readJsonFile(ACTIONS_JSON, []);
  const actionEvents = readJsonLines(ACTIONS_EVENTS_JSONL, 200);
  const opsEvents = readJsonLines(OPS_EVENTS_JSONL, 200);
  const dbStats = loadDbStats();
  const runbooks = buildRunbookRows(dbStats.runbookStateRows);
  const byAccount = buildByAccountPipeline({ actionRows: allActionRows, triageOpenItems: dbStats.triageOpenItems });

  const queue = {
    actions: actionStore.counts,
    triage: dbStats.triage,
    runbooks: {
      total: runbooks.length,
      enabled: runbooks.filter((r) => r.enabled).length,
      ok: runbooks.filter((r) => r.enabled && r.lastStatus === "ok").length,
      error: runbooks.filter((r) => r.enabled && r.lastStatus === "error").length,
      running: runbooks.filter((r) => r.enabled && r.lastStatus === "running").length,
      stale: runbooks.filter((r) => r.enabled && r.stale).length,
    },
  };

  const health = buildHealth({
    capabilities,
    channels,
    runbooks,
    actionCounts: actionStore.counts,
    controlFindings: controlTower?.findings || [],
  });

  const timeline = buildTimeline({
    actionEvents,
    opsEvents,
    runbookRuns: dbStats.runbookRuns,
    triageFeedback: dbStats.triageFeedback,
    limit: timelineLimit,
  });

  return {
    generatedAt,
    health,
    queue,
    channels,
    capabilities,
    actions: actionStore.actions,
    triage: dbStats.triageOpenItems,
    runbooks,
    byAccount,
    findings: {
      controlTower: controlTower || { ok: false, summary: null, findings: [] },
      workstream: workstream || { ok: false, summary: null, findings: [] },
    },
    timeline,
    digestMarkdown,
    files: {
      digestJson: DIGEST_JSON,
      digestMarkdown: DIGEST_MD,
      auditJson: AUDIT_JSON,
      controlTowerJson: CONTROL_TOWER_JSON,
      workstreamJson: WORKSTREAM_JSON,
      actionsJson: ACTIONS_JSON,
      actionsEvents: ACTIONS_EVENTS_JSONL,
      opsEvents: OPS_EVENTS_JSONL,
      dbPath: DB_PATH,
    },
  };
}

function persistSnapshotIfJson(result, outPath) {
  if (!result.ok) return false;
  const parsed = parseJson(result.stdout, null);
  if (!parsed || typeof parsed !== "object") return false;
  writeJsonFile(outPath, parsed);
  return true;
}

function runOpsRefresh({ notifyTarget = "" } = {}) {
  const digestArgs = ["--json"];
  if (notifyTarget) digestArgs.push("--send-imessage", notifyTarget);

  const digestRun = runTool(DIGEST_TOOL, digestArgs, { timeoutMs: 60000 });
  const auditRun = runTool(AUDIT_TOOL, ["--run-tests"], { timeoutMs: 60000 });
  const controlTowerRun = runTool(CONTROL_TOWER_TOOL, ["--json"], { timeoutMs: 45000 });
  const workstreamRun = runTool(WORKSTREAM_TOOL, ["--json"], { timeoutMs: 45000 });

  const controlTowerPersisted = persistSnapshotIfJson(controlTowerRun, CONTROL_TOWER_JSON);
  const workstreamPersisted = persistSnapshotIfJson(workstreamRun, WORKSTREAM_JSON);

  appendOpsEvent("ops_refresh", {
    ok: digestRun.ok && auditRun.ok && controlTowerRun.ok && workstreamRun.ok,
    digestOk: digestRun.ok,
    auditOk: auditRun.ok,
    controlTowerOk: controlTowerRun.ok,
    workstreamOk: workstreamRun.ok,
    controlTowerPersisted,
    workstreamPersisted,
    notifyTarget: notifyTarget || null,
  });

  return {
    digest: { ok: digestRun.ok, code: digestRun.code, stderr: digestRun.stderr || null },
    audit: { ok: auditRun.ok, code: auditRun.code, stderr: auditRun.stderr || null },
    controlTower: { ok: controlTowerRun.ok, code: controlTowerRun.code, stderr: controlTowerRun.stderr || null, persisted: controlTowerPersisted },
    workstream: { ok: workstreamRun.ok, code: workstreamRun.code, stderr: workstreamRun.stderr || null, persisted: workstreamPersisted },
  };
}

function safePositiveInt(value, fallback, min = 1, max = 1000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeAccountKey(value, fallback = "work") {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!key) return String(fallback || "work");
  return key;
}

function normalizeAccountKeys(values, fallback = ["work"]) {
  function parse(rawValues) {
    const list = Array.isArray(rawValues)
      ? rawValues
      : String(rawValues || "")
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      const key = normalizeAccountKey(raw, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  const primary = parse(values);
  if (primary.length) return primary;
  return parse(fallback);
}

function resolveFlowAccounts({ config, state, deps }) {
  const cfg = safeObj(config);
  const st = loadFlowRuntimeState(state);

  const explicitAccounts = normalizeAccountKeys(cfg.accounts, []);
  if (explicitAccounts.length) return explicitAccounts;

  const explicitOne = normalizeAccountKey(cfg.accountKey, "");
  if (explicitOne) return [explicitOne];

  const stateAccounts = normalizeAccountKeys(st.gmail.accountKeys, []);
  if (stateAccounts.length) return stateAccounts;

  const stateOne = normalizeAccountKey(st.gmail.accountKey, "");
  if (stateOne) return [stateOne];

  if (cfg.autoDetectAccounts !== false && deps?.googleAccounts?.list) {
    try {
      const connected = deps.googleAccounts.list();
      const keys = normalizeAccountKeys(
        (Array.isArray(connected) ? connected : []).map((row) => row?.accountKey),
        [],
      );
      if (keys.length) return keys;
    } catch {
      // ignore account listing failures
    }
  }

  const fallbackAccounts = normalizeAccountKeys(cfg.fallbackAccounts, ["work"]);
  return fallbackAccounts.length ? fallbackAccounts : ["work"];
}

function countByAccount(items, field = "accountKey") {
  const out = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeAccountKey(item?.[field] || "", "");
    if (!key) continue;
    out[key] = Number(out[key] || 0) + 1;
  }
  return out;
}

function normalizeEmailAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  const candidate = m ? m[1] : raw;
  const email = String(candidate || "").trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return email ? String(email[0]).toLowerCase() : "";
}

function stripReplyPrefix(subject) {
  const s = String(subject || "").trim();
  if (!s) return "";
  return s.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
}

function ensureReplySubject(subject) {
  const s = String(subject || "").trim();
  if (!s) return "Re: Quick follow-up";
  if (/^re\s*:/i.test(s)) return s;
  return `Re: ${s}`;
}

function toBase64UrlUtf8(text) {
  return Buffer.from(String(text || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseJsonFromText(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const fenced = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : s;
  try {
    const parsed = JSON.parse(raw.trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        const parsed = JSON.parse(raw.slice(a, b + 1));
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function safeObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toList(value, limit = 20) {
  return Array.isArray(value)
    ? value
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function normalizeNodeConfig(node) {
  return safeObj(node?.config);
}

function headerMap(headers) {
  const map = {};
  for (const h of Array.isArray(headers) ? headers : []) {
    const k = String(h?.name || "").trim().toLowerCase();
    if (!k) continue;
    map[k] = String(h?.value || "").trim();
  }
  return map;
}

function buildDraftTemplate({ to, subject, triageTitle, summaryMd }) {
  const cleanSubject = stripReplyPrefix(subject) || "your message";
  const cleanTo = to || "there";
  const summary = String(summaryMd || "").trim().replace(/\s+/g, " ");
  return (
    `Hi ${cleanTo},\n\n` +
    `Thanks for your message about "${cleanSubject}".\n` +
    (triageTitle ? `I noted the key action as: ${triageTitle}.\n` : "") +
    (summary ? `Context: ${summary.slice(0, 300)}\n` : "") +
    `\nI will get back to you with a full response shortly.\n\nBest,\nOliver`
  );
}

function buildReplyMime({ to, subject, body, inReplyTo, references }) {
  const lines = [];
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${subject}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(body);
  return lines.join("\r\n");
}

function runGoogleHttpRequest({ accountKey, method = "GET", url, body = null, timeoutMs = 45000 }) {
  if (!fs.existsSync(GOOGLE_HTTP_TOOL)) {
    return { ok: false, error: "google_http_tool_missing", response: null, stderr: "" };
  }

  const args = ["--account", normalizeAccountKey(accountKey), "--method", String(method || "GET").toUpperCase(), "--url", String(url || "")];
  if (body != null) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    args.push("--body", raw);
  }
  const run = runTool(GOOGLE_HTTP_TOOL, args, { timeoutMs });
  if (!run.ok) {
    return { ok: false, error: String(run.stderr || run.stdout || `http_request_failed:${run.code}`), response: null, stderr: run.stderr || "" };
  }
  const parsed = parseJson(run.stdout, null);
  return { ok: true, error: null, response: parsed, stderr: run.stderr || "" };
}

function gmailMessageFromResponse(res, fallbackMessageId = "") {
  const payload = safeObj(res?.payload);
  const headers = headerMap(payload.headers);
  return {
    messageId: String(res?.id || fallbackMessageId || "").trim(),
    threadId: String(res?.threadId || "").trim(),
    snippet: String(res?.snippet || "").trim(),
    from: headers.from || "",
    fromEmail: normalizeEmailAddress(headers.from || ""),
    to: headers.to || "",
    subject: headers.subject || "",
    date: headers.date || "",
    internetMessageId: headers["message-id"] || "",
    inReplyTo: headers["in-reply-to"] || "",
    references: headers.references || "",
  };
}

function runActionProposal({ action }) {
  const args = [
    "propose",
    "--channel",
    String(action.channel || "gmail"),
    "--contact",
    String(action.contact || "unknown"),
    "--intent",
    String(action.intent || "draft_reply"),
    "--summary",
    String(action.summary || "Draft reply"),
    "--source-text",
    String(action.sourceText || action.summary || "draft"),
  ];
  if (action.dueAt) args.push("--due-at", String(action.dueAt));
  if (action.meta && typeof action.meta === "object") args.push("--meta-json", JSON.stringify(action.meta));

  const run = runTool(ACTIONS_TOOL, args, { timeoutMs: 25000 });
  const payload = parseJson(run.stdout, null);
  return { ok: run.ok && Boolean(payload?.ok), payload, code: run.code, stderr: run.stderr || null };
}

function loadAllActionsFromStore() {
  const rows = readJsonFile(ACTIONS_JSON, []);
  return Array.isArray(rows) ? rows : [];
}

function findActionByIdFromStore(actionId) {
  const id = String(actionId || "").trim();
  if (!id) return null;
  return loadAllActionsFromStore().find((row) => String(row?.id || "").trim() === id) || null;
}

function findActionBySourceKeyFromStore(sourceKey) {
  const key = String(sourceKey || "").trim();
  if (!key) return null;
  const match = loadAllActionsFromStore()
    .filter((row) => String(row?.meta?.sourceKey || "").trim() === key)
    .sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
  return match[0] || null;
}

function summarizeActionForSource(action) {
  if (!action || typeof action !== "object") return null;
  return {
    id: String(action.id || "").trim(),
    status: String(action.status || "").trim() || "pending",
    channel: String(action.channel || "").trim() || "gmail",
    intent: String(action.intent || "").trim() || "draft_reply",
    summary: String(action.summary || "").trim(),
    contact: String(action.contact || "").trim(),
    createdAt: action.createdAt || null,
    confirmedAt: action.confirmedAt || null,
    completedAt: action.completedAt || null,
    cancelledAt: action.cancelledAt || null,
    updatedAt: nowIso(),
  };
}

function draftSourceFromItem(item) {
  const source = safeObj(item?.source);
  const gmail = safeObj(source.gmail);
  const raw = safeObj(source.suggestedDraft);

  const accountKey = normalizeAccountKey(raw.accountKey || gmail.account || "work");
  const sourceMessageId = String(raw.sourceMessageId || gmail.messageId || "").trim();
  const threadId = String(raw.threadId || gmail.threadId || "").trim();
  const sourceKey = String(raw.sourceKey || `flow:gmail:${accountKey}:${sourceMessageId || item?.id || "triage"}:draft`).trim();
  const to = normalizeEmailAddress(raw.to || raw.recipient || "");
  const subject = String(raw.subject || "").trim();
  const body = String(raw.body || "").trim();
  const inReplyTo = String(raw.inReplyTo || "").trim();
  const references = String(raw.references || "").trim();
  const confidence = raw.confidence == null ? null : clampConfidence(raw.confidence);

  if (!body) return null;
  return {
    sourceKey,
    triageItemId: String(item?.id || "").trim(),
    accountKey,
    to,
    subject: ensureReplySubject(subject || item?.title || ""),
    body,
    threadId,
    sourceMessageId,
    inReplyTo,
    references,
    confidence,
    title: String(item?.title || "").trim(),
    summaryMd: String(item?.summaryMd || "").trim(),
  };
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function renderDraftMessage({ draft, action = null, note = "" }) {
  const bits = [];
  bits.push("Suggested email draft ready for review.");
  if (note) bits.push(String(note).trim());
  bits.push(`To: ${draft.to || "(missing recipient)"}`);
  bits.push(`Subject: ${draft.subject || "(missing subject)"}`);
  bits.push(`Account: ${draft.accountKey}`);
  if (draft.confidence != null) bits.push(`Confidence: ${draft.confidence}%`);
  if (action?.status) bits.push(`Queue status: ${String(action.status)}`);
  bits.push("");
  bits.push("```text");
  bits.push(String(draft.body || "").trim());
  bits.push("```");
  return bits.join("\n");
}

function appendTriageNote({ deps, item, content, meta = null }) {
  if (!deps?.chats?.appendMessage || !item?.chatId || !content) return;
  deps.chats.appendMessage({
    chatId: item.chatId,
    role: "assistant",
    content: String(content).trim(),
    meta: meta && typeof meta === "object" ? meta : null,
  });
}

function buildProposalFromDraft(draft, config = {}) {
  const channel = String(config.channel || "gmail").trim() || "gmail";
  const intent = String(config.intent || "draft_reply").trim() || "draft_reply";
  return {
    channel,
    contact: draft.to || "unknown",
    intent,
    summary: `[${draft.accountKey}] Draft reply: ${stripReplyPrefix(draft.subject) || "email response"}`,
    sourceText: draft.summaryMd || draft.title || "Draft reply generated by flow",
    meta: {
      sourceKey: draft.sourceKey,
      accountKey: draft.accountKey,
      threadId: draft.threadId,
      sourceMessageId: draft.sourceMessageId,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      to: draft.to,
      subject: draft.subject,
      draftBody: draft.body,
      triageItemId: draft.triageItemId,
      createdBy: "ops-flow",
    },
  };
}

function runActionStatusChange({ actionId, status }) {
  const id = String(actionId || "").trim();
  const desired = String(status || "").trim().toLowerCase();
  const cmdByStatus = {
    confirmed: ["confirm", "--id", id],
    cancelled: ["cancel", "--id", id],
    completed: ["complete", "--id", id],
  };
  const cmd = cmdByStatus[desired];
  if (!id) return { ok: false, error: "missing_action_id", action: null };
  if (!cmd) return { ok: false, error: "invalid_status", action: null };
  const run = runTool(ACTIONS_TOOL, cmd, { timeoutMs: 20000 });
  const payload = parseJson(run.stdout, null);
  if (!run.ok || !payload?.ok) {
    return {
      ok: false,
      error: String(payload?.error || run.stderr || `action_status_failed:${run.code}`),
      code: run.code,
      stderr: run.stderr || null,
      payload,
      action: null,
    };
  }
  return { ok: true, action: payload.action || null, code: run.code, stderr: run.stderr || null, payload };
}

function persistDraftOnTriageItem({ deps, triageItem, draft, action = null, note = "" }) {
  if (!deps?.triage?.updateSource || !triageItem?.id) return null;
  const current = deps?.triage?.getItem ? deps.triage.getItem(triageItem.id) : triageItem;
  const source = safeObj(current?.source);
  const previous = safeObj(source.suggestedDraft);
  const suggestedDraft = {
    sourceKey: draft.sourceKey,
    accountKey: draft.accountKey,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    threadId: draft.threadId,
    sourceMessageId: draft.sourceMessageId,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    confidence: draft.confidence == null ? null : clampConfidence(draft.confidence),
    generatedAt: previous.generatedAt || nowIso(),
    updatedAt: nowIso(),
  };
  source.suggestedDraft = suggestedDraft;

  const linkedAction = action || findActionBySourceKeyFromStore(draft.sourceKey);
  if (linkedAction) source.draftAction = summarizeActionForSource(linkedAction);

  const updated = deps.triage.updateSource({ id: current.id, source });

  const changed =
    String(previous.subject || "") !== String(suggestedDraft.subject || "") ||
    String(previous.body || "") !== String(suggestedDraft.body || "") ||
    String(previous.to || "") !== String(suggestedDraft.to || "");
  if (changed && deps?.chats?.appendMessage && updated?.chatId) {
    deps.chats.appendMessage({
      chatId: updated.chatId,
      role: "assistant",
      content: renderDraftMessage({ draft: suggestedDraft, action: source.draftAction || null, note }),
      meta: { triageDraft: true, sourceKey: draft.sourceKey },
    });
  }
  return updated;
}

function syncTriageFromAction({ deps, action, send = null, error = "" }) {
  const triageItemId = String(action?.meta?.triageItemId || "").trim();
  if (!triageItemId || !deps?.triage?.getItem || !deps?.triage?.updateSource) return null;
  const item = deps.triage.getItem(triageItemId);
  if (!item) return null;
  const source = safeObj(item.source);
  const draft = safeObj(source.suggestedDraft);
  const meta = safeObj(action?.meta);

  source.suggestedDraft = {
    sourceKey: String(draft.sourceKey || meta.sourceKey || "").trim(),
    accountKey: normalizeAccountKey(draft.accountKey || meta.accountKey || "work"),
    to: normalizeEmailAddress(draft.to || meta.to || ""),
    subject: ensureReplySubject(draft.subject || meta.subject || item.title || ""),
    body: String(draft.body || meta.draftBody || "").trim(),
    threadId: String(draft.threadId || meta.threadId || "").trim(),
    sourceMessageId: String(draft.sourceMessageId || meta.sourceMessageId || "").trim(),
    inReplyTo: String(draft.inReplyTo || meta.inReplyTo || "").trim(),
    references: String(draft.references || meta.references || "").trim(),
    confidence: draft.confidence == null ? null : clampConfidence(draft.confidence),
    generatedAt: draft.generatedAt || nowIso(),
    updatedAt: nowIso(),
  };
  source.draftAction = summarizeActionForSource(action);

  if (send && typeof send === "object") {
    source.lastSend = {
      at: send.sentAt || nowIso(),
      actionId: send.actionId || action?.id || null,
      gmailMessageId: send.gmailMessageId || null,
      accountKey: send.accountKey || meta.accountKey || null,
      to: send.to || meta.to || null,
      subject: send.subject || meta.subject || null,
    };
    delete source.lastSendError;
  } else if (error) {
    source.lastSendError = {
      at: nowIso(),
      actionId: action?.id || null,
      message: String(error).trim(),
    };
  }

  return deps.triage.updateSource({ id: triageItemId, source });
}

function sendDraftReplyAction({ actionRow }) {
  const row = safeObj(actionRow);
  const meta = safeObj(row.meta);
  const actionId = String(row.id || "").trim();
  const accountKey = normalizeAccountKey(meta.accountKey || "work");
  const to = normalizeEmailAddress(meta.to || "");
  const subject = ensureReplySubject(meta.subject || "");
  const body = String(meta.draftBody || "").trim();
  if (!actionId) return { ok: false, error: "missing_action_id", action: row, sent: null };
  if (!to || !body) return { ok: false, error: "missing_recipient_or_body", action: row, sent: null };

  const mime = buildReplyMime({
    to,
    subject,
    body,
    inReplyTo: String(meta.inReplyTo || "").trim(),
    references: String(meta.references || "").trim(),
  });
  const sendUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
  const payload = {
    raw: toBase64UrlUtf8(mime),
    threadId: String(meta.threadId || "").trim() || undefined,
  };
  const sentResp = runGoogleHttpRequest({ accountKey, method: "POST", url: sendUrl, body: payload });
  if (!sentResp.ok) return { ok: false, error: sentResp.error || "gmail_send_failed", action: row, sent: null };

  let action = row;
  if (String(row.status || "") !== "completed") {
    const done = runActionStatusChange({ actionId, status: "completed" });
    if (!done.ok) {
      return { ok: false, error: done.error || "action_complete_failed", action: row, sent: null };
    }
    action = done.action || row;
  }

  const sent = {
    actionId,
    accountKey,
    to,
    subject,
    gmailMessageId: sentResp.response?.id || null,
    sentAt: nowIso(),
  };
  return { ok: true, error: null, action, sent };
}

function resolveFlowAction(node) {
  const explicit = String(node?.actionKey || "").trim();
  if (explicit) return explicit;
  const id = String(node?.id || "");
  if (id === "queue_actions") return "actions.pending";
  if (id === "queue_triage") return "triage.open";
  if (id === "gmail_accounts_detect") return "gmail.accounts.detect";
  if (id === "gmail_pull") return "gmail.pull";
  if (id === "gmail_triage_runbook") return "triage.gmail.runbook";
  if (id === "triage_select") return "triage.select";
  if (id === "draft_generate") return "draft.generate";
  if (id === "approval_queue") return "approval.actions.propose";
  if (id === "approval_gate") return "approval.wait_confirmed";
  if (id === "gmail_send") return "gmail.send.confirmed";
  if (id.startsWith("runbook_")) return `runbook:${id.slice("runbook_".length).replace(/_/g, "-")}`;
  return "noop";
}

async function executeRunbookNode(action, deps, opts = {}) {
  const runbookId = String(action || "").replace(/^runbook:/, "").trim();
  if (!runbookId) return { ok: false, action, detail: "missing runbook id", result: null };
  if (!deps?.runRunbookOnce) return { ok: false, action, detail: "runbook execution deps not wired", result: null };

  const defs = loadRunbooksFromDir(deps.runbooksDir || RUNBOOKS_DIR);
  const rb = defs.find((x) => x.id === runbookId);
  if (!rb) return { ok: false, action, detail: `runbook not found: ${runbookId}`, result: null };

  const overrideKeys = Array.isArray(opts.accountKeys) ? opts.accountKeys.map((k) => normalizeAccountKey(k)).filter(Boolean) : [];
  const accountKeys = overrideKeys.length
    ? overrideKeys
    : Array.isArray(rb.meta?.accounts) && rb.meta.accounts.length
      ? rb.meta.accounts
      : ["work"];
  const results = [];
  for (const accountKey of accountKeys) {
    try {
      const run = await deps.runRunbookOnce({
        runbook: rb,
        accountKey,
        chats: deps.chats,
        triage: deps.triage,
        runbooksDb: deps.runbooksDb,
        loadContext: deps.loadContext,
        runAssistant: deps.runAssistant,
        tasks: deps.tasks,
        codexProfiles: deps.codexProfiles,
        getActiveCodexProfile: deps.getActiveCodexProfile,
        getCodexRunnerPrefs: deps.getCodexRunnerPrefs,
        getAssistantRunnerPrefs: deps.getAssistantRunnerPrefs,
        googleAccounts: deps.googleAccounts,
      });
      results.push({ accountKey, ...(run || {}) });
    } catch (err) {
      results.push({ accountKey, ok: false, error: String(err?.message || err) });
    }
  }

  return {
    ok: results.every((x) => x.ok),
    action,
    detail: `runbook ${runbookId} on ${results.length} account(s)`,
    result: { runbookId, results },
  };
}

function loadFlowRuntimeState(initialState = {}) {
  const value = safeObj(initialState);
  return {
    gmail: safeObj(value.gmail),
    triage: safeObj(value.triage),
    drafts: safeObj(value.drafts),
    approvals: safeObj(value.approvals),
    send: safeObj(value.send),
    meta: safeObj(value.meta),
  };
}

function summarizeDraft(draft) {
  return {
    sourceKey: draft.sourceKey,
    to: draft.to,
    subject: draft.subject,
    accountKey: draft.accountKey,
    triageItemId: draft.triageItemId,
  };
}

function buildPersonaPromptAddendum(persona) {
  if (!persona || typeof persona !== "object") return "";
  const lines = [];
  const label = String(persona.label || persona.id || "").trim();
  if (label) lines.push(`Persona: ${label}`);
  if (persona.description) lines.push(`Description: ${String(persona.description).trim()}`);
  const traits = toList(persona.traits, 16);
  if (traits.length) lines.push(`Traits: ${traits.join(", ")}`);
  const responsibilities = toList(persona.responsibilities, 20);
  if (responsibilities.length) lines.push(`Responsibilities: ${responsibilities.join(", ")}`);
  const tone = safeObj(persona.tone);
  const toneBits = [tone.voice, tone.formality, tone.verbosity].map((x) => String(x || "").trim()).filter(Boolean);
  if (toneBits.length) lines.push(`Tone: ${toneBits.join(" / ")}`);
  const boundaries = toList(persona.boundaries, 16);
  if (boundaries.length) lines.push(`Boundaries: ${boundaries.join("; ")}`);
  const addendum = String(persona.promptAddendum || "").trim();
  if (addendum) lines.push(`Prompt addendum: ${addendum}`);
  return lines.join("\n");
}

async function generateDraftWithAssistant({ deps, prompt, personaId = "", lane = "triage" }) {
  if (!deps?.runAssistant) return null;
  try {
    const result = await deps.runAssistant({
      context: {
        dir: "flow",
        files: ["flow-draft-agent.md"],
        items: [
          {
            filename: "flow-draft-agent.md",
            content:
              "You write concise professional email reply drafts. Output strict JSON: " +
              '{"subject":"...","body":"...","confidence":0-100}. No markdown.',
          },
        ],
      },
      chat: {
        id: `flow-draft-${Date.now()}`,
        messages: [{ role: "user", content: prompt }],
      },
      mode: "runbook",
      routingHint: {
        lane: String(lane || "triage").trim() || "triage",
        personaId: String(personaId || "").trim(),
      },
      getActiveCodexProfile: deps.getActiveCodexProfile,
      getCodexRunnerPrefs: deps.getCodexRunnerPrefs,
      getAssistantRunnerPrefs: deps.getAssistantRunnerPrefs,
      googleAccounts: deps.googleAccounts,
    });
    const parsed = parseJsonFromText(result?.content || "");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function executeFlowAction(node, deps, runtime) {
  const action = resolveFlowAction(node);
  const config = normalizeNodeConfig(node);
  const state = loadFlowRuntimeState(runtime?.state);

  if (action === "noop") return { ok: true, action, detail: "no-op", result: null };
  if (action === "ops.refresh") {
    const refresh = runOpsRefresh();
    const ok = refresh.digest.ok && refresh.audit.ok && refresh.controlTower.ok && refresh.workstream.ok;
    return {
      ok,
      action,
      detail: "refreshed ops snapshots",
      result: refresh,
      statePatch: { meta: { ...state.meta, lastOpsRefreshAt: nowIso() } },
    };
  }
  if (action === "digest.generate") {
    const run = runTool(DIGEST_TOOL, ["--json"], { timeoutMs: 60000 });
    return { ok: run.ok, action, detail: "openclaw digest", result: { code: run.code, stderr: run.stderr || null } };
  }
  if (action === "audit.capabilities") {
    const run = runTool(AUDIT_TOOL, ["--run-tests"], { timeoutMs: 60000 });
    return { ok: run.ok, action, detail: "capability audit", result: { code: run.code, stderr: run.stderr || null } };
  }
  if (action === "snapshot.control_tower") {
    const run = runTool(CONTROL_TOWER_TOOL, ["--json"], { timeoutMs: 45000 });
    const persisted = persistSnapshotIfJson(run, CONTROL_TOWER_JSON);
    return { ok: run.ok, action, detail: "control tower snapshot", result: { code: run.code, persisted, stderr: run.stderr || null } };
  }
  if (action === "snapshot.workstream") {
    const run = runTool(WORKSTREAM_TOOL, ["--json"], { timeoutMs: 45000 });
    const persisted = persistSnapshotIfJson(run, WORKSTREAM_JSON);
    return { ok: run.ok, action, detail: "workstream snapshot", result: { code: run.code, persisted, stderr: run.stderr || null } };
  }
  if (action === "actions.pending") {
    const store = loadActionStore({ status: "pending", limit: 50 });
    return { ok: true, action, detail: `${store.counts.pending} pending action(s)`, result: store };
  }
  if (action === "triage.open") {
    const stats = loadDbStats();
    return { ok: true, action, detail: `${stats.triage.open} open triage item(s)`, result: stats.triage };
  }
  if (action === "gmail.accounts.detect") {
    const accounts = resolveFlowAccounts({ config, state, deps });
    let connected = [];
    if (deps?.googleAccounts?.list) {
      try {
        const listed = deps.googleAccounts.list();
        connected = (Array.isArray(listed) ? listed : [])
          .map((row) => ({
            accountKey: normalizeAccountKey(row?.accountKey, ""),
            email: String(row?.email || "").trim(),
            connectedAt: String(row?.connectedAt || "").trim() || null,
          }))
          .filter((row) => row.accountKey);
      } catch {
        connected = [];
      }
    }
    const connectedKeys = normalizeAccountKeys(
      connected.map((row) => row.accountKey),
      [],
    );
    return {
      ok: accounts.length > 0,
      action,
      detail: `resolved ${accounts.length} account(s): ${accounts.join(", ")}`,
      result: {
        accounts,
        connectedAccounts: connected,
        connectedKeys,
      },
      statePatch: {
        gmail: {
          ...state.gmail,
          accountKeys: accounts,
          connectedAccounts: connected,
          detectedAt: nowIso(),
        },
      },
    };
  }
  if (action === "gmail.pull") {
    const accountKeys = resolveFlowAccounts({ config, state, deps });
    const maxResults = safePositiveInt(config.maxResults, 12, 1, 50);
    const onlyUnread = Boolean(config.onlyUnread);
    const queryBase = String(config.query || "in:inbox newer_than:2d -category:promotions -category:social").trim();
    const query = [queryBase, onlyUnread ? "is:unread" : ""].filter(Boolean).join(" ").trim();
    const messages = [];
    const failures = [];
    const pulledByAccount = {};
    for (const accountKey of accountKeys) {
      const listUrl =
        "https://gmail.googleapis.com/gmail/v1/users/me/messages" +
        `?maxResults=${maxResults}` +
        (query ? `&q=${encodeURIComponent(query)}` : "");
      const listed = runGoogleHttpRequest({ accountKey, method: "GET", url: listUrl });
      if (!listed.ok) {
        failures.push({ accountKey, stage: "list", error: listed.error });
        continue;
      }
      const refs = Array.isArray(listed.response?.messages) ? listed.response.messages : [];
      let localCount = 0;
      for (const ref of refs.slice(0, maxResults)) {
        const messageId = String(ref?.id || "").trim();
        if (!messageId) continue;
        const messageUrl =
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
          encodeURIComponent(messageId) +
          "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-Id&metadataHeaders=In-Reply-To&metadataHeaders=References";
        const fetched = runGoogleHttpRequest({ accountKey, method: "GET", url: messageUrl });
        if (!fetched.ok || !fetched.response) continue;
        messages.push({ ...gmailMessageFromResponse(fetched.response, messageId), accountKey });
        localCount += 1;
      }
      pulledByAccount[accountKey] = localCount;
    }

    const preview = messages.slice(0, 12).map((m) => ({
      messageId: m.messageId,
      accountKey: m.accountKey,
      from: m.fromEmail || m.from,
      subject: m.subject,
      date: m.date,
    }));

    const ok = messages.length > 0 || failures.length === 0;
    return {
      ok,
      action,
      detail: `pulled ${messages.length} Gmail message(s) across ${accountKeys.length} account(s)`,
      result: { accountKeys, query, count: messages.length, pulledByAccount, failures, preview },
      statePatch: {
        gmail: {
          ...state.gmail,
          accountKeys,
          accountKey: accountKeys[0] || "work",
          query,
          pulledAt: nowIso(),
          messages,
          pulledByAccount,
          pullFailures: failures,
        },
      },
    };
  }
  if (action === "triage.gmail.runbook") {
    const runbookId = String(config.runbookId || "gmail-hourly-triage").trim();
    const accountKeys = resolveFlowAccounts({ config, state, deps });
    const run = await executeRunbookNode(`runbook:${runbookId}`, deps, { accountKeys });
    const stats = loadDbStats();
    const failedAccounts = (run?.result?.results || []).filter((x) => !x.ok).map((x) => x.accountKey);
    return {
      ok: run.ok,
      action,
      detail: run.ok
        ? `runbook ${runbookId} completed for ${accountKeys.length} account(s)`
        : `runbook ${runbookId} failed on ${failedAccounts.length} account(s)`,
      result: { runbook: run.result, triageOpen: stats.triage.open, accountKeys, failedAccounts },
      statePatch: {
        triage: {
          ...state.triage,
          accountKeys,
          accountKey: accountKeys[0] || "work",
          runbookId,
          lastRunAt: nowIso(),
          openCount: stats.triage.open,
          failedAccounts,
        },
      },
    };
  }
  if (action === "triage.select") {
    const status = String(config.status || "open").trim() || "open";
    const kind = String(config.kind || "next_action").trim() || null;
    const runbookId = String(config.runbookId || "gmail-hourly-triage").trim();
    const accountKeys = resolveFlowAccounts({ config, state, deps });
    const accountSet = new Set(accountKeys);
    const minPriority = safePositiveInt(config.minPriority, 1, 0, 10);
    const minConfidencePct = safePositiveInt(config.minConfidencePct, 65, 0, 100);
    const limit = safePositiveInt(config.limit, 6, 1, 40);
    const list = deps?.triage?.listItems ? deps.triage.listItems({ status, kind, limit: Math.max(30, limit * 3) }) : [];

    const selected = (Array.isArray(list) ? list : [])
      .filter((item) => (runbookId ? String(item.runbookId || "") === runbookId : true))
      .filter((item) => Number(item.priority || 0) >= minPriority)
      .filter((item) => {
        const c = item.confidencePct == null ? 0 : Number(item.confidencePct || 0);
        return c >= minConfidencePct;
      })
      .filter((item) => {
        const srcAccount = normalizeAccountKey(item?.source?.gmail?.account || "", "");
        return srcAccount ? accountSet.has(srcAccount) : true;
      })
      .sort((a, b) => {
        const p = Number(b.priority || 0) - Number(a.priority || 0);
        if (p !== 0) return p;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      })
      .slice(0, limit);

    const selectedSummaries = selected.map((item) => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      confidencePct: item.confidencePct,
      accountKey: normalizeAccountKey(item?.source?.gmail?.account || "", ""),
      source: item.source?.gmail || null,
    }));
    const selectedByAccount = countByAccount(selectedSummaries, "accountKey");

    return {
      ok: true,
      action,
      detail: `selected ${selected.length} triage item(s) from ${accountKeys.length} account(s)`,
      result: { count: selected.length, selectedByAccount, selected: selectedSummaries },
      statePatch: {
        triage: {
          ...state.triage,
          accountKeys,
          selectedAt: nowIso(),
          selectedItems: selected,
          selectedCount: selected.length,
          selectedByAccount,
        },
      },
    };
  }
  if (action === "draft.generate") {
    const items = Array.isArray(state.triage.selectedItems) ? state.triage.selectedItems : [];
    const limit = safePositiveInt(config.limit, items.length || 5, 1, 20);
    const useAssistant = config.useAssistant !== false;
    const tone = String(config.tone || "friendly, concise, and professional").trim();
    const personaId = String(config.personaId || state?.meta?.personaId || "friday-core").trim();
    const personaLookup = getPersonaById(personaId);
    const persona = personaLookup.persona || null;
    const personaPrompt = buildPersonaPromptAddendum(persona);

    const drafts = [];
    for (const item of items.slice(0, limit)) {
      const gmailSource = safeObj(item?.source?.gmail);
      const accountKey = normalizeAccountKey(gmailSource.account || state.gmail.accountKey || "work");
      const sourceMessageId = String(gmailSource.messageId || "").trim();

      let metadata = null;
      const cached = Array.isArray(state.gmail.messages)
        ? state.gmail.messages.find((m) => String(m.messageId || "") === sourceMessageId && normalizeAccountKey(m?.accountKey || "") === accountKey)
        : null;
      if (cached) metadata = cached;
      if (!metadata && sourceMessageId) {
        const messageUrl =
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
          encodeURIComponent(sourceMessageId) +
          "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-Id&metadataHeaders=In-Reply-To&metadataHeaders=References";
        const fetched = runGoogleHttpRequest({ accountKey, method: "GET", url: messageUrl });
        if (fetched.ok && fetched.response) metadata = gmailMessageFromResponse(fetched.response, sourceMessageId);
      }

      const to = normalizeEmailAddress(metadata?.fromEmail || metadata?.from || "");
      const subject = ensureReplySubject(metadata?.subject || item?.title || "");
      let body = buildDraftTemplate({
        to: to || "there",
        subject,
        triageTitle: item?.title || "",
        summaryMd: item?.summaryMd || "",
      });
      let confidence = 62;

      if (useAssistant) {
        const prompt =
          "Draft a short email reply in JSON format.\n" +
          (personaPrompt ? `Persona profile:\n${personaPrompt}\n` : "") +
          `Tone: ${tone}\n` +
          `Recipient: ${to || "(unknown)"}\n` +
          `Subject context: ${metadata?.subject || item?.title || "(none)"}\n` +
          `Action summary: ${item?.summaryMd || item?.title || "(none)"}\n` +
          'Output JSON only: {"subject":"...","body":"...","confidence":0-100}';
        const llmDraft = await generateDraftWithAssistant({
          deps,
          prompt,
          personaId: persona?.id || personaId,
          lane: "triage",
        });
        if (llmDraft) {
          if (String(llmDraft.subject || "").trim()) {
            body = String(llmDraft.body || body).trim() || body;
          } else if (String(llmDraft.body || "").trim()) {
            body = String(llmDraft.body).trim();
          }
          if (String(llmDraft.subject || "").trim()) {
            confidence = safePositiveInt(llmDraft.confidence, 70, 0, 100);
          }
        }
      }

      const draft = {
        sourceKey: `flow:gmail:${accountKey}:${sourceMessageId || item.id}:draft`,
        triageItemId: item.id,
        accountKey,
        to,
        subject,
        body,
        threadId: String(gmailSource.threadId || metadata?.threadId || "").trim(),
        sourceMessageId,
        inReplyTo: String(metadata?.internetMessageId || metadata?.inReplyTo || "").trim(),
        references: String(metadata?.references || metadata?.internetMessageId || "").trim(),
        title: String(item?.title || "").trim(),
        summaryMd: String(item?.summaryMd || "").trim(),
        confidence,
      };
      drafts.push(draft);
      persistDraftOnTriageItem({
        deps,
        triageItem: item,
        draft,
        note: "Generated from flow run.",
      });
    }
    const draftByAccount = countByAccount(drafts, "accountKey");

    return {
      ok: true,
      action,
      detail: `generated ${drafts.length} draft reply(s) across ${Object.keys(draftByAccount).length || 1} account(s)`,
      result: { count: drafts.length, byAccount: draftByAccount, personaId: persona?.id || null, drafts: drafts.map(summarizeDraft) },
      statePatch: {
        drafts: {
          generatedAt: nowIso(),
          items: drafts,
          count: drafts.length,
          byAccount: draftByAccount,
          personaId: persona?.id || null,
        },
      },
    };
  }
  if (action === "approval.actions.propose") {
    const accountsFilter = new Set(resolveFlowAccounts({ config, state, deps }));
    const drafts = (Array.isArray(state.drafts.items) ? state.drafts.items : []).filter((d) => {
      const key = normalizeAccountKey(d?.accountKey || "", "");
      return key ? accountsFilter.has(key) : true;
    });
    if (!drafts.length) {
      return { ok: true, action, detail: "no drafts to enqueue", result: { created: 0, skipped: 0 } };
    }

    const allActions = loadAllActionsFromStore();
    const existingBySource = new Map(
      allActions
        .map((a) => [String(a?.meta?.sourceKey || "").trim(), a])
        .filter((row) => row[0]),
    );

    const created = [];
    let skipped = 0;
    const failures = [];
    const channel = String(config.channel || "gmail").trim() || "gmail";
    const intent = String(config.intent || "draft_reply").trim() || "draft_reply";
    const dryRun = config.dryRun === true;
    const byAccount = {};

    for (const draft of drafts) {
      const existing = existingBySource.get(draft.sourceKey);
      if (existing) {
        skipped += 1;
        if (!dryRun) syncTriageFromAction({ deps, action: existing });
        continue;
      }
      const proposal = buildProposalFromDraft(draft, { channel, intent });
      if (dryRun) {
        created.push({
          id: `DRYRUN-${draft.sourceKey}`,
          accountKey: draft.accountKey,
          summary: proposal.summary,
          to: draft.to,
        });
        byAccount[draft.accountKey] = Number(byAccount[draft.accountKey] || 0) + 1;
        continue;
      }
      const proposed = runActionProposal({ action: proposal });
      if (!proposed.ok) {
        failures.push({ sourceKey: draft.sourceKey, error: proposed.payload?.error || proposed.stderr || "proposal_failed" });
        continue;
      }
      const createdAction = proposed.payload?.action || null;
      created.push(createdAction);
      byAccount[draft.accountKey] = Number(byAccount[draft.accountKey] || 0) + 1;
      existingBySource.set(draft.sourceKey, createdAction);
      if (createdAction) syncTriageFromAction({ deps, action: createdAction });
    }

    return {
      ok: failures.length === 0,
      action,
      detail: `${dryRun ? "dry-run queued" : "queued"} ${created.length} approval action(s), skipped ${skipped}`,
      result: { dryRun, created: created.length, skipped, byAccount, failures },
      statePatch: {
        approvals: {
          queuedAt: nowIso(),
          createdActions: created.filter(Boolean),
          createdCount: created.length,
          skippedCount: skipped,
          byAccount,
          dryRun,
          failures,
        },
      },
    };
  }
  if (action === "approval.wait_confirmed") {
    const limit = safePositiveInt(config.limit, 400, 1, 5000);
    const channel = String(config.channel || "gmail").trim() || "gmail";
    const intent = String(config.intent || "draft_reply").trim() || "draft_reply";
    const requiredCount = safePositiveInt(config.requiredCount, 1, 0, 5000);
    const accountKeys = resolveFlowAccounts({ config, state, deps });
    const accountSet = new Set(accountKeys);
    const confirmed = loadActionStore({ status: "confirmed", limit }).actions || [];

    const createdIds = Array.isArray(state?.approvals?.createdActions)
      ? state.approvals.createdActions.map((x) => String(x?.id || "").trim()).filter(Boolean)
      : [];
    const createdIdSet = new Set(createdIds);
    const matchCreatedOnly = config.useCreatedActions !== false && createdIdSet.size > 0;

    const candidates = confirmed
      .filter((a) => String(a?.channel || "") === channel)
      .filter((a) => String(a?.intent || "") === intent)
      .filter((a) => {
        const key = normalizeAccountKey(a?.meta?.accountKey || "", "");
        return key ? accountSet.has(key) : true;
      })
      .filter((a) => (matchCreatedOnly ? createdIdSet.has(String(a?.id || "")) : true));

    const byAccount = countByAccount(
      candidates.map((a) => ({ accountKey: a?.meta?.accountKey || "" })),
      "accountKey",
    );

    if (candidates.length < requiredCount) {
      return {
        ok: true,
        halt: true,
        action,
        detail: `waiting for confirmations (${candidates.length}/${requiredCount})`,
        result: {
          ready: false,
          requiredCount,
          confirmedCount: candidates.length,
          accountKeys,
          byAccount,
          useCreatedActions: matchCreatedOnly,
        },
        statePatch: {
          approvals: {
            ...state.approvals,
            gateCheckedAt: nowIso(),
            gateReady: false,
            gateRequiredCount: requiredCount,
            gateConfirmedCount: candidates.length,
            gateByAccount: byAccount,
          },
        },
      };
    }

    return {
      ok: true,
      action,
      detail: `approval gate passed with ${candidates.length} confirmed action(s)`,
      result: {
        ready: true,
        requiredCount,
        confirmedCount: candidates.length,
        accountKeys,
        byAccount,
        confirmedActionIds: candidates.map((a) => a.id),
      },
      statePatch: {
        approvals: {
          ...state.approvals,
          gateCheckedAt: nowIso(),
          gateReady: true,
          gateRequiredCount: requiredCount,
          gateConfirmedCount: candidates.length,
          gateByAccount: byAccount,
          confirmedActionIds: candidates.map((a) => a.id),
        },
      },
    };
  }
  if (action === "gmail.send.confirmed") {
    const dryRun = config.dryRun === true;
    const limit = safePositiveInt(config.limit, 5, 1, 30);
    const intent = String(config.intent || "draft_reply").trim();
    const channel = String(config.channel || "gmail").trim();
    const accountKeys = resolveFlowAccounts({ config, state, deps });
    const accountSet = new Set(accountKeys);
    const confirmed = loadActionStore({ status: "confirmed", limit: 400 }).actions || [];
    const candidates = confirmed
      .filter((a) => String(a?.intent || "") === intent)
      .filter((a) => String(a?.channel || "") === channel)
      .map((a) => ({ action: a, meta: safeObj(a?.meta) }))
      .filter((x) => x.meta.draftBody && x.meta.to)
      .filter((x) => {
        const key = normalizeAccountKey(x.meta.accountKey || "", "");
        return key ? accountSet.has(key) : true;
      })
      .slice(0, limit);

    if (dryRun) {
      return {
        ok: true,
        action,
        detail: `dry-run: ${candidates.length} confirmed draft action(s) ready to send across ${accountKeys.length} account(s)`,
        result: {
          dryRun: true,
          accountKeys,
          candidates: candidates.map((x) => ({
            actionId: x.action.id,
            to: x.meta.to,
            subject: x.meta.subject,
            accountKey: x.meta.accountKey,
          })),
        },
        statePatch: {
          send: {
            lastDryRunAt: nowIso(),
            dryRunCount: candidates.length,
            accountKeys,
          },
        },
      };
    }

    const sent = [];
    const failed = [];
    for (const candidate of candidates) {
      const actionRow = candidate.action;
      const outcome = sendDraftReplyAction({ actionRow });
      if (!outcome.ok) {
        failed.push({ actionId: actionRow.id, error: outcome.error || "send_failed" });
        syncTriageFromAction({ deps, action: actionRow, error: outcome.error || "send_failed" });
        continue;
      }
      sent.push(outcome.sent);
      syncTriageFromAction({ deps, action: outcome.action, send: outcome.sent });
      const triageItemId = String(outcome.action?.meta?.triageItemId || "").trim();
      if (triageItemId && deps?.triage?.setStatus) {
        deps.triage.setStatus({ id: triageItemId, status: "completed" });
      }
    }

    return {
      ok: failed.length === 0,
      action,
      detail: `sent ${sent.length} email reply(s) across ${accountKeys.length} account(s); ${failed.length} failed`,
      result: { accountKeys, sent, failed },
      statePatch: {
        send: {
          lastSentAt: nowIso(),
          sentCount: sent.length,
          failedCount: failed.length,
          sent,
          failed,
        },
      },
    };
  }
  if (action.startsWith("runbook:")) {
    return executeRunbookNode(action, deps);
  }
  return { ok: false, action, detail: "unknown action", result: null };
}

async function executeFlowGraph(flow, deps = {}, { startNodeId = "", initialState = {} } = {}) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes.map(normalizeFlowNode).filter(Boolean) : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges.map(normalizeFlowEdge).filter(Boolean) : [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  const incomingCount = new Map(nodes.map((n) => [n.id, 0]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    const list = outgoing.get(edge.from) || [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
    incomingCount.set(edge.to, Number(incomingCount.get(edge.to) || 0) + 1);
  }

  const runtime = { state: loadFlowRuntimeState(initialState) };
  const queue = [];
  const start = String(startNodeId || "").trim();
  if (start && nodeMap.has(start)) {
    queue.push(start);
  } else {
    for (const node of nodes) {
      if (Number(incomingCount.get(node.id) || 0) === 0) queue.push(node.id);
    }
    if (!queue.length && nodes[0]) queue.push(nodes[0].id);
  }

  const visited = new Set();
  const steps = [];

  while (queue.length) {
    const nodeId = String(queue.shift() || "");
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const ts = nowIso();
    let result = null;
    let step;
    try {
      result = await executeFlowAction(node, deps, runtime);
      const patch = safeObj(result?.statePatch);
      runtime.state = {
        ...runtime.state,
        ...patch,
      };
      step = {
        ts,
        nodeId,
        label: node.label,
        kind: node.kind,
        action: resolveFlowAction(node),
        ok: Boolean(result?.ok),
        detail: result?.detail || null,
        result: result?.result || null,
        stateKeys: Object.keys(patch),
      };
    } catch (err) {
      step = {
        ts,
        nodeId,
        label: node.label,
        kind: node.kind,
        action: resolveFlowAction(node),
        ok: false,
        detail: String(err?.message || err),
        result: null,
        stateKeys: [],
      };
    }
    steps.push(step);

    const stopOnFailure = safeObj(node?.config).stopOnFailure !== false;
    const shouldHalt = Boolean(result?.halt);
    if ((!step.ok && stopOnFailure) || shouldHalt) continue;

    const next = outgoing.get(nodeId) || [];
    for (const to of next) {
      if (!visited.has(to)) queue.push(to);
    }
  }

  return {
    ok: steps.every((s) => s.ok),
    startedAt: steps[0]?.ts || nowIso(),
    completedAt: nowIso(),
    stepCount: steps.length,
    steps,
    state: runtime.state,
  };
}

function registerOps(router, deps = {}) {
  router.add("GET", "/api/ops/overview", (_req, res, url) => {
    const timelineLimit = Number(url.searchParams.get("timelineLimit") || 120);
    return sendJson(res, 200, { ok: true, overview: buildOverview({ timelineLimit }) });
  });

  router.add("POST", "/api/ops/refresh", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const notifyTarget = body?.notifyIMessageTarget ? String(body.notifyIMessageTarget).trim() : "";
    const refresh = runOpsRefresh({ notifyTarget });

    const overview = buildOverview();

    return sendJson(res, 200, {
      ok: true,
      refresh,
      overview,
    });
  });

  router.add("GET", "/api/ops/microsoft/preflight", (_req, res) => {
    const preflight = buildMicrosoftPreflight({ deps });
    return sendJson(res, 200, { ok: true, preflight });
  });

  router.add("GET", "/api/ops/actions", (_req, res, url) => {
    const status = normalizeActionStatus(url.searchParams.get("status") || "all");
    const limit = Number(url.searchParams.get("limit") || 100);
    const data = loadActionStore({ status, limit });
    const events = readJsonLines(ACTIONS_EVENTS_JSONL, 120);
    return sendJson(res, 200, { ok: true, status, counts: data.counts, actions: data.actions, events });
  });

  router.add("POST", "/api/ops/actions/:actionId/status", async (req, res, _url, params) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const desired = String(body?.status || "").trim().toLowerCase();
    const sendNow = body?.sendNow === true;
    const actionId = String(params.actionId || "").trim();
    if (!actionId) return sendJson(res, 400, { ok: false, error: "missing_action_id" });

    if (!new Set(["confirmed", "cancelled", "completed"]).has(desired)) {
      return sendJson(res, 400, { ok: false, error: "invalid_status", allowed: ["confirmed", "cancelled", "completed"] });
    }

    const changed = runActionStatusChange({ actionId, status: desired });
    if (!changed.ok || !changed.action) {
      appendOpsEvent("action_status_failed", {
        actionId,
        requestedStatus: desired,
        code: changed.code || null,
        stderr: changed.stderr || null,
      });
      return sendJson(res, 400, {
        ok: false,
        error: "action_status_failed",
        code: changed.code || null,
        stderr: changed.stderr || null,
        detail: changed.error || null,
        payload: changed.payload || null,
      });
    }

    let action = changed.action;
    let sent = null;
    if (sendNow && desired === "confirmed") {
      const sendOutcome = sendDraftReplyAction({ actionRow: action });
      if (!sendOutcome.ok) {
        const triageItem = syncTriageFromAction({ deps, action, error: sendOutcome.error || "send_failed" });
        appendOpsEvent("action_send_failed", { actionId, error: sendOutcome.error || "send_failed" });
        return sendJson(res, 400, {
          ok: false,
          error: "send_failed",
          detail: sendOutcome.error || "send_failed",
          action,
          triageItem: triageItem || null,
          overview: buildOverview({ timelineLimit: 80 }),
        });
      }
      action = sendOutcome.action || action;
      sent = sendOutcome.sent;
      if (String(action?.meta?.triageItemId || "").trim() && deps?.triage?.setStatus) {
        deps.triage.setStatus({ id: String(action.meta.triageItemId), status: "completed" });
      }
      appendOpsEvent("action_sent", { actionId, gmailMessageId: sent?.gmailMessageId || null });
    }

    const triageItem = syncTriageFromAction({ deps, action, send: sent });
    appendOpsEvent("action_status_updated", { actionId, status: desired, sendNow: sendNow && desired === "confirmed" });

    return sendJson(res, 200, {
      ok: true,
      action,
      triageItem: triageItem || null,
      sent,
      overview: buildOverview({ timelineLimit: 80 }),
    });
  });

  router.add("POST", "/api/ops/triage/items/:itemId/draft/queue", async (req, res, _url, params) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const itemId = String(params.itemId || "").trim();
    if (!itemId) return sendJson(res, 400, { ok: false, error: "missing_item_id" });
    if (!deps?.triage?.getItem) return sendJson(res, 500, { ok: false, error: "triage_not_available" });

    const item = deps.triage.getItem(itemId);
    if (!item) return sendJson(res, 404, { ok: false, error: "not_found" });

    const draft = draftSourceFromItem(item);
    const confirm = body?.confirm === true;
    const sendNow = body?.sendNow === true;
    const channel = String(body?.channel || "gmail").trim() || "gmail";
    const intent = String(body?.intent || "draft_reply").trim() || "draft_reply";

    const sourceActionId = String(item?.source?.draftAction?.id || "").trim();
    let action = sourceActionId ? findActionByIdFromStore(sourceActionId) : null;
    if (!action && draft?.sourceKey) action = findActionBySourceKeyFromStore(draft.sourceKey);
    const existed = Boolean(action);

    if (!action) {
      if (!draft) {
        return sendJson(res, 400, { ok: false, error: "missing_suggested_draft", detail: "Generate a draft before queueing." });
      }
      if (!draft.to || !draft.body) {
        return sendJson(res, 400, { ok: false, error: "draft_missing_fields", detail: "Draft must include recipient and body." });
      }
      const proposal = buildProposalFromDraft(draft, { channel, intent });
      const proposed = runActionProposal({ action: proposal });
      if (!proposed.ok || !proposed.payload?.action) {
        return sendJson(res, 400, {
          ok: false,
          error: "action_proposal_failed",
          detail: proposed.payload?.error || proposed.stderr || "proposal_failed",
        });
      }
      action = proposed.payload.action;
      appendOpsEvent("triage_draft_queued", { itemId, actionId: action.id });
    }

    if (confirm && String(action.status || "") === "pending") {
      const confirmed = runActionStatusChange({ actionId: action.id, status: "confirmed" });
      if (!confirmed.ok || !confirmed.action) {
        return sendJson(res, 400, {
          ok: false,
          error: "action_confirm_failed",
          detail: confirmed.error || null,
          action,
        });
      }
      action = confirmed.action;
      appendOpsEvent("triage_draft_confirmed", { itemId, actionId: action.id });
    }

    let sent = null;
    if (sendNow) {
      if (String(action.status || "") === "pending") {
        const autoConfirm = runActionStatusChange({ actionId: action.id, status: "confirmed" });
        if (!autoConfirm.ok || !autoConfirm.action) {
          return sendJson(res, 400, {
            ok: false,
            error: "action_confirm_failed",
            detail: autoConfirm.error || null,
            action,
          });
        }
        action = autoConfirm.action;
      }
      if (String(action.status || "") !== "confirmed" && String(action.status || "") !== "completed") {
        return sendJson(res, 400, { ok: false, error: "action_not_confirmed", action });
      }
      if (String(action.status || "") !== "completed") {
        const sendOutcome = sendDraftReplyAction({ actionRow: action });
        if (!sendOutcome.ok) {
          const triageWithError = syncTriageFromAction({ deps, action, error: sendOutcome.error || "send_failed" });
          return sendJson(res, 400, {
            ok: false,
            error: "send_failed",
            detail: sendOutcome.error || "send_failed",
            action,
            item: triageWithError || item,
          });
        }
        action = sendOutcome.action || action;
        sent = sendOutcome.sent;
        if (String(action?.meta?.triageItemId || "").trim() && deps?.triage?.setStatus) {
          deps.triage.setStatus({ id: String(action.meta.triageItemId), status: "completed" });
        }
        appendOpsEvent("triage_draft_sent", { itemId, actionId: action.id, gmailMessageId: sent?.gmailMessageId || null });
      }
    }

    const updated = syncTriageFromAction({ deps, action, send: sent });
    if (updated) {
      const statusLabel = sent ? "sent" : String(action.status || "pending");
      appendTriageNote({
        deps,
        item: updated,
        content: `Draft queue update: ${statusLabel} (${action.id}).`,
        meta: { triageDraft: true, actionId: action.id, status: statusLabel },
      });
    }

    return sendJson(res, 200, {
      ok: true,
      existed,
      action,
      sent,
      item: updated || item,
      overview: buildOverview({ timelineLimit: 80 }),
    });
  });

  router.add("GET", "/api/ops/flow", (_req, res) => {
    const flow = loadFlowPayload();
    return sendJson(res, 200, { ok: true, flow });
  });

  router.add("GET", "/api/ops/flows", (_req, res) => {
    const payload = loadFlowRegistryWithValidation();
    appendOpsEvent("flow_registry_read", {
      ok: payload.validation.ok,
      flowCount: Number(payload.validation?.stats?.flowCount || 0),
    });
    const status = payload.validation.ok ? 200 : 500;
    return sendJson(res, status, {
      ok: payload.validation.ok,
      registry: payload.registry,
      validation: payload.validation,
      sources: payload.sources,
    });
  });

  router.add("POST", "/api/ops/resolve-intent", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const text = String(body?.text || "").trim();
    if (!text) {
      return sendJson(res, 400, { ok: false, error: "missing_text", detail: "Provide body.text for intent resolution." });
    }

    const payload = loadFlowRegistryWithValidation();
    if (!payload.validation.ok) {
      return sendJson(res, 500, {
        ok: false,
        error: "flow_registry_invalid",
        validation: payload.validation,
        sources: payload.sources,
      });
    }

    const resolved = resolveFlowIntentPlan({
      text,
      inputs: body?.inputs,
      fixIntent: typeof body?.fixIntent === "boolean" ? body.fixIntent : null,
      registry: payload.registry,
    });

    appendOpsEvent("flow_intent_resolved", {
      text: text.slice(0, 200),
      flowId: resolved?.match?.id || null,
      fixIntent: resolved?.fixIntent?.value === true,
      missingInputs: Array.isArray(resolved?.missingInputs) ? resolved.missingInputs.length : 0,
    });

    return sendJson(res, 200, {
      ok: true,
      resolution: resolved,
      validation: payload.validation,
    });
  });

  router.add("POST", "/api/ops/resolve-intent/execute", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const text = String(body?.text || "").trim();
    if (!text) {
      return sendJson(res, 400, { ok: false, error: "missing_text", detail: "Provide body.text for intent resolution." });
    }

    const payload = loadFlowRegistryWithValidation();
    if (!payload.validation.ok) {
      return sendJson(res, 500, {
        ok: false,
        error: "flow_registry_invalid",
        validation: payload.validation,
        sources: payload.sources,
      });
    }

    const explicitFixIntent =
      typeof body?.fixIntent === "boolean" ? body.fixIntent : body?.runRepair === true ? true : null;
    const resolution = resolveFlowIntentPlan({
      text,
      inputs: body?.inputs,
      fixIntent: explicitFixIntent,
      registry: payload.registry,
    });

    if (!resolution?.match?.id) {
      appendOpsEvent("flow_intent_execute_unmatched", { text: text.slice(0, 200) });
      return sendJson(res, 200, {
        ok: true,
        resolution,
        execution: {
          ok: false,
          error: "no_flow_match",
          phases: { diagnose: [], repair: [], verify: [] },
          summaries: {
            diagnose: summarizeExecutionPhase([]),
            repair: summarizeExecutionPhase([]),
            verify: summarizeExecutionPhase([]),
          },
          runRepairRequested: false,
          runVerify: false,
          repairAttempted: false,
          facts: {},
        },
        response: buildDeterministicContractResponse({
          resolution,
          execution: {
            ok: false,
            phases: { diagnose: [], repair: [], verify: [] },
            summaries: {
              diagnose: summarizeExecutionPhase([]),
              repair: summarizeExecutionPhase([]),
              verify: summarizeExecutionPhase([]),
            },
            runRepairRequested: false,
            runVerify: false,
            repairAttempted: false,
            facts: {},
          },
          registry: payload.registry,
        }),
        validation: payload.validation,
      });
    }

    const timeoutMs = Math.max(5000, Math.min(240000, Number(body?.timeoutMs) || 90000));
    const runRepair = typeof body?.runRepair === "boolean" ? body.runRepair : resolution?.fixIntent?.value === true;
    const runVerify = typeof body?.runVerify === "boolean" ? body.runVerify : false;
    const execution = executeResolvedFlowPlan({
      resolution,
      runRepair,
      runVerify,
      timeoutMs,
    });
    const response = buildDeterministicContractResponse({ resolution, execution, registry: payload.registry });

    appendOpsEvent("flow_intent_executed", {
      text: text.slice(0, 200),
      flowId: resolution?.match?.id || null,
      runRepairRequested: execution.runRepairRequested,
      runVerify: execution.runVerify,
      status: response.status,
      ok: execution.ok,
    });

    return sendJson(res, 200, {
      ok: true,
      resolution,
      execution,
      response,
      validation: payload.validation,
    });
  });

  router.add("PUT", "/api/ops/flow", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }
    const saved = saveFlowPayload(body?.flow || body || {});
    appendOpsEvent("flow_saved", { nodes: saved.nodes.length, edges: saved.edges.length });
    return sendJson(res, 200, { ok: true, flow: saved });
  });

  router.add("POST", "/api/ops/flow/execute", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    const flow = body?.flow ? normalizeFlowPayload(body.flow) : loadFlowPayload();
    const startNodeId = body?.startNodeId ? String(body.startNodeId) : "";
    const initialState = body?.state && typeof body.state === "object" ? body.state : {};
    const execution = await executeFlowGraph(flow, deps, { startNodeId, initialState });
    appendOpsEvent("flow_executed", {
      ok: execution.ok,
      stepCount: execution.stepCount,
      startNodeId: startNodeId || null,
    });
    return sendJson(res, 200, { ok: true, execution, overview: buildOverview({ timelineLimit: 80 }) });
  });

  router.add("GET", "/api/ops/timeline", (_req, res, url) => {
    const limit = Number(url.searchParams.get("limit") || 120);
    const overview = buildOverview({ timelineLimit: limit });
    return sendJson(res, 200, { ok: true, generatedAt: overview.generatedAt, timeline: overview.timeline });
  });
}

module.exports = { registerOps };
