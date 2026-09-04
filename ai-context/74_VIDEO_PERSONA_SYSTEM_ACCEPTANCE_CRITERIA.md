# Video-Derived Acceptance Criteria (YRhGtHfs1Lw)

Source intent: translate the interview setup into concrete, testable requirements for Friday + OpenClaw.

## 1) Persona Gateway

- Friday exposes a single gateway that can route to multiple personas/agents without switching products.
- Each persona has an explicit scope (`work`, `personal`, `ops`, `finance`, etc.) and a default tool allowlist.
- Messages from each channel (`iMessage`, `WhatsApp`, `Slack`) are bound to the same persona identity for that sender.
- A user can ask: "use persona X for this thread" and routing updates immediately for future turns.

## 2) Channel-Native Operating Model

- Friday can ingest from channel threads and run actions without requiring dashboard-only interaction.
- Friday can keep a main thread per domain and spawn sub-threads/subtasks for individual items.
- Friday can summarize many sub-threads back into one control thread with a single command.
- Thread summaries include status, blockers, and the next action owner.

## 3) Subagent Specialization

- Friday can delegate coding tasks to a coding-specialist subagent automatically.
- Friday can delegate triage and drafting tasks to non-coding subagents.
- Subagent runs produce structured artifacts (`result`, `reason`, `confidence`, `follow-up`).
- Parent agent can merge subagent outputs into one user-facing action plan.

## 4) Email Safety And Triage

- Email processing defaults to scheduled pull (`cron`) and not immediate webhook execution.
- Raw email content is treated as untrusted input and cannot trigger privileged tool execution directly.
- Prompt-injection detection is applied to inbound email before any side-effect proposal is generated.
- Friday can classify email into action buckets and surface only reviewed/filtered tasks.
- "Interface with email through chat" is supported: chat queries can retrieve/summarize mailbox state on demand.

## 5) Tool And Privilege Guardrails

- Friday supports least-privilege tool profiles per persona and per channel.
- High-risk actions require explicit user intent or policy-level pre-approval.
- Sensitive connectors (email, repo, credentials) can be disabled independently per agent.
- Every side-effect action is logged with command/tool, timestamp, and result.

## 6) Personal Memory + Context Injection

- Friday stores durable memory for user preferences, routines, and trusted behavior patterns.
- Contextual signals (location/time/activity/device) can be injected into prompts as structured context.
- Context injection is policy-controlled and can be toggled per flow/node.
- Memory updates are attributable (what changed, why, by which run).

## 7) Home/Device Automation Integration

- Friday can call local/home APIs via tools (Home Assistant, NAS/Plex-like workflows, local services).
- Device actions are represented as explicit flow nodes with observable execution status.
- Failures on device actions are captured and surfaced in Ops with retry guidance.

## 8) Flow Builder Must Be Executable

- Node links in `/flows` are not visual-only: execution order is derived from graph edges.
- Each node has an `actionKey`; runtime behavior changes when node action or links change.
- Flows can be saved, reloaded, and executed via API.
- Execution returns per-step results (`ok`, `action`, `detail`) and is shown in UI.
- Flow execution can start from a selected node (partial-run support).

## 9) Cost + Model Strategy

- Friday supports model routing policy: local-first for low-risk/low-complexity tasks, cloud fallback for harder tasks.
- Routing decisions are logged with reason codes (cost, latency, capability, safety).
- Sensitive workflows can pin to stronger models by policy.

## 10) Observability And Operator UX

- Ops shows health from runbooks, channels, triage queues, and flow execution outcomes.
- System can send mobile notification summaries when runbooks/flows fail.
- Daily digest includes: urgent items, pending actions, runbook failures, and top recommended next steps.
