# Telegraph project awareness (high level)

Friday v2 should be able to talk coherently about these projects and help plan work, without hardcoding their internal logic.

## Arthur / Particles CMS (`dit-particles-cms`)

- Configuration-driven collaborative editor (React + Yjs).
- Key invariants:
  - configuration over code,
  - server-authoritative dirty/modified state,
  - observability-first debugging (trace stream).
- Preferred debugging loop: “live E2E + trace recording” (see `dit-particles-cms/e2e/AI_ASSISTED_DEV.md`).

## Socket server (`eip-socket-api`)

- Hosts Yjs collab WS and trace stream (`/observability/trace`).
- Owns baseline/diff/modified checks; clients shouldn’t invent dirty state.

## Particle API (`particles-api`)

- File-based routing (`routes/` maps directly to URLs).
- v2 is production-stable: avoid “cleanup” changes unless explicitly required.

## Trace dashboard (`trace-dashboard`)

- Small React app that connects to the trace stream and renders events.

