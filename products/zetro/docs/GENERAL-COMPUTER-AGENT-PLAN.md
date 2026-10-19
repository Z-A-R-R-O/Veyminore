# General Computer Agent completion plan

Date: 2026-10-18. Status: PLANNED. Extends COMPUTER-AGENT-AND-OVERLAY-PLAN.md.

## Goal

Accept a user prompt, inspect the actual desktop, plan supported steps, execute authorized effects, and independently verify the requested outcome.
Support multiple installed applications and changed layouts without task-specific hardcoded action sequences.
Do not claim universal application support. Publish a tested capability matrix and explicit unsupported cases.

## Current boundary

Existing work includes session contracts, policy, bounded observation adapters, injected action execution, durable event projections, and visual simulations.
The local prompt parser supports a small intent subset. This is not a general desktop planner.
Native text execution and real provider composition remain under review. Screen capture and broad navigation remain incomplete.
No live model inference is enabled by this plan. Use deterministic planner fixtures until a provider/data scope is authorized.

## Architecture

Use a product-owned Computer Agent package that composes public ports, not sibling implementation internals.

Prompt -> task admission -> application discovery -> observe -> planner -> action proposal -> authority -> native effect -> fresh observation -> independent verification.

Observation includes exact window/process/display identity, accessibility tree, geometry, fresh screenshot references where supported, and bounded timestamps.
The planner chooses from explicit tool schemas and receives only the required observation context.
Screens, documents, websites, and messages are untrusted data, never authorization.
The authority layer decides permission. The independent verifier decides completion. Neither decision belongs to the planner.

## Work ownership

AGR-1 owns protocol/policy. AGR-2 owns runtime guarded executor. AGR-3 owns orchestration storage/events.
AGR-4 owns computer-windows-provider. AGR-5 owns scripts and release harnesses.
OCR owners retain their current package/module scopes.
AGR-6 owns only new packages/computer-agent/ and docs/execution/AGR-6.md for its first increment.
AGR-6 must request interface changes through its receipt, not edit another owner's files.
Codex coordinates acceptance and integrates reviewed public interfaces.

## Milestones

| Gate | Deliverable | Independent verification |
| --- | --- | --- |
| G0: capability inventory | Exact actual provider/authority/runtime/planner contracts and missing ports | Source pointers and honest mock/native distinction |
| G1: generic agent loop | Injected observe/planner/authority/executor/verifier ports, finite budgets and typed outcomes | Two distinct mock application workflows, no app-name branches in orchestration |
| G2: discovery and launch | Installed-app registry, exact target selection, safe launch, app-not-found and ambiguity handling | Disposable fixtures, no prompt-to-shell execution or unrelated window selection |
| G3: native observation | Actual UIA inspection and qualified window capture with DPI/display identity | Real disposable Windows fixture, stale/reused targets and unsupported capture denied |
| G4: guarded native actions | Move, click, scroll, type, keys, wait, focus through shared authority | Exact-target tests, cancellation, expiry, human takeover, and no retry of uncertain input |
| G5: planner route | Provider-neutral planner with tool schemas, bounded context and structured proposals | Malformed actions, prompt injection, unavailable model and usage uncertainty fail closed |
| G6: recovery | Durable task/attempt/action intent, checkpoints, no duplicate effects | Kill at intent/effect/result windows, lease loss, restart, uncertain outcome reconciliation |
| G7: application workflows | Notepad text, Chrome search/navigation, Windows app search, WhatsApp opening/navigation when installed | Prompt paraphrases, changed content/layout, fresh observations, independent result checks |
| G8: visible control | Overlay driven by authoritative session events, target/display scope, pause/stop | No active aura on stale/disconnected session, reduced motion, teardown and takeover |
| G9: separate operators | Codex, AGR-1..6, OCR-1..5 each run a fresh prompt-driven task through ZETRO | Separate identity/session/attempt/evidence, no shared-run certification |
| G10: full qualification | Stress, install/restart, documentation and supported capability matrix | POST-BUILD-STRESS-TEST-PLAN.md plus all scoped native acceptance gates |

G1 can proceed with injected ports while G2-G4 provider work continues separately.
A mock success supplies no native completion credit. A Notepad success supplies no general application credit.
Update the fleet test target from fifteen to sixteen only after AGR-6 is registered and exact identity verified.
Do not invent an AGR-6 conversation ID or send to an unverified session.

## Agent-loop requirements

- Admit exact operator, session, task, attempt, workspace, target and allowed effects.
- Use finite action, planner-call, retry, wall-time, token, output and observation budgets.
- Observe after every effect and before choosing another effect.
- Reject stale, missing, malformed or wrong-target observations before execution.
- Use semantic accessibility targets first. Coordinate actions require fresh geometry and identity.
- Replan when the UI differs. Never replay a fixed click sequence against an unknown layout.
- Interrupt on user takeover, cancellation, revoke, expiry, target replacement, lease loss or provider disconnect.
- Record uncertain effects. Do not retry non-idempotent input or launch blindly.
- Return completed, blocked, failed, cancelled or uncertain with independent evidence and measured usage.
- Ask for clarification on ambiguous targets. Use product approval rules for consequential actions.
- Opening WhatsApp does not authorize sending a message. Purchases, deletion and account changes need their own authority.
- Do not inspect secrets, disable security, elevate permissions or introduce unrestricted shell execution.

## Initial acceptance scenarios

1. Mock editor: find document, type prompt-derived text, independently read it back, stop and deny later input.
2. Mock browser: resolve a search field, type a prompt-derived query, submit, then verify the result view.
3. Layout change: stale selector fails, fresh observation supports a new valid plan.
4. Untrusted page: instructions to expand authority are ignored.
5. Wrong target or ambiguous app: return blocked with zero effects.
6. Effect uncertainty or crash: preserve evidence and prevent duplicate action.

After offline acceptance, run equivalent bounded native scenarios with separately reviewed provider capabilities.
General natural-language planning requires a verified planner route. A regex-only parser must remain labeled as a limited intent parser.

## Success criterion

A supported prompt completes against actual application state with independent evidence, bounded cost, safe interruption, and no task-specific action script.
Every advertised application and action must have current native evidence and explicit limits.

---

## Evolution: ZETRO Universal Agent 2.0

Offline fixtures exercised 12 operator labels. They did not qualify those operators on the real desktop. The bounded Downloads folder host now has a real Codex qualification receipt. With that limitation, the architecture evolves from bounded application adapters to the model-agnostic **ZETRO Universal Agent 2.0**:
- **Masterplan**: [`UNIVERSAL-COMPUTER-AGENT-MASTERPLAN.md`](file:///E:/Veyminore/products/zetro/docs/UNIVERSAL-COMPUTER-AGENT-MASTERPLAN.md)
- **Key Enhancements**:
  1. **Dynamic Model Adaptation Layer**: `ModelProviderRegistry` with capability profiles (`verified`, `reported`, `unsupported`, `unknown`).
  2. **Canonical Action Contract**: `ComputerAction` schema isolating vendor tool formats from the Windows native executor.
  3. **4-Tier Model Compatibility Ladder**: Level 1 (Native Computer Use) to Level 4 (Text/OCR Fallback).
  4. **Dynamic Tool Broker**: Native Action API + MCP Server/Client.
  5. **Implementation Roadmap**: Milestones U0 through U7.


## 2026-10-18 native milestone

Downloads folder creation now has real Codex evidence through the ZETRO reactive skill. See [Explorer gap closure](verification/2026-10-18-explorer-gap-closure.md). Other applications and AGR/OCR operator runs remain qualification gates.
