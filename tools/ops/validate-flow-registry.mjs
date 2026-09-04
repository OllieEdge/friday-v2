#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

function getArg(name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

const flowRegistryPath = path.resolve(ROOT, getArg("--flow", "data/ops/flow-registry.json"));
const aiRegistryPath = path.resolve(ROOT, getArg("--ai", "../ai/capabilities/ai-commands.json"));

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateRegistry(flowRegistry, aiCommandsSet) {
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

    const triggers = Array.isArray(flow?.triggers) ? flow.triggers.map((x) => normalizeText(x)).filter(Boolean) : [];
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
      ...diagnoseSteps.map((s) => ({ phase: "diagnose", step: s })),
      ...repairSteps.map((s) => ({ phase: "repair", step: s })),
      ...verifySteps.map((s) => ({ phase: "verify", step: s })),
    ];

    for (const item of allSteps) {
      const step = item.step || {};
      const stepId = String(step.id || "").trim();
      const kind = String(step.kind || "").trim();
      if (!stepId) errors.push(`Flow ${id} has ${item.phase} step without id.`);
      if (!["ai_cmd", "shell_cmd", "note"].includes(kind)) {
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
        if (!aiCommandsSet.has(command)) {
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

try {
  if (!fs.existsSync(flowRegistryPath)) throw new Error(`Missing flow registry: ${flowRegistryPath}`);
  if (!fs.existsSync(aiRegistryPath)) throw new Error(`Missing AI command registry: ${aiRegistryPath}`);

  const flowRegistry = readJson(flowRegistryPath);
  const aiRegistry = readJson(aiRegistryPath);
  const aiCommands = Array.isArray(aiRegistry?.commands) ? aiRegistry.commands.map((x) => String(x?.name || "").trim()).filter(Boolean) : [];
  const aiSet = new Set(aiCommands);

  const result = validateRegistry(flowRegistry, aiSet);
  const payload = {
    flowRegistryPath: path.relative(ROOT, flowRegistryPath),
    aiRegistryPath: path.relative(ROOT, aiRegistryPath),
    ...result,
  };

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`[flows] flowCount=${payload.stats.flowCount} triggers=${payload.stats.triggerCount} aiSteps=${payload.stats.aiStepCount}`);
    for (const w of payload.warnings) console.log(`[warn] ${w}`);
    for (const e of payload.errors) console.log(`[error] ${e}`);
  }

  if (!payload.ok) process.exit(1);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, errors: [msg], warnings: [] }, null, 2));
  } else {
    console.error(`[flows] ${msg}`);
  }
  process.exit(1);
}
