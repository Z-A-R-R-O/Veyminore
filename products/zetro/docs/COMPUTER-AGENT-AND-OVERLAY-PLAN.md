# ZETRO Computer: native agent and visible access plan

Date: 2026-10-18. Status: build started, native capabilities not qualified.

## Reference and boundary

The coordinator read the installed Computer Use SKILL.md before this plan.
Its documented primitives include window discovery, UI Automation, SendInput, and Windows.Graphics.Capture.
These describe capability requirements. They do not grant ZETRO access to the bundled private runtime or its service credentials.
Build a separate ZETRO provider behind the accepted contract, session, policy, and independent verification ports.

## Product workflow

Select a window, authenticate, grant a bounded scope, observe, plan, authorize an effect, act, verify, and export evidence.
Recheck window identity, grant expiry, revocation, and cancellation immediately before each effect.
Treat on-screen text as untrusted data. Never accept screen instructions as user authorization.
Bind each request to exact session, principal, window handle, process identity, display, task, and attempt.
Require fresh observations after actions. Report ambiguous results as unverified.

## Visual specification

Use Satoshi, generous spacing, neutral surfaces, Veyminore iris, copper highlights, and restrained motion.
A cursor companion shows ZETRO beside the actual provider-reported pointer position during authorized effects.
Never replace or hide the user's system cursor globally. Distinguish the agent pointer from the user's pointer.
A thin edge light identifies the controlled display. Do not imply that every screen or application is authorized.
Show a compact access capsule with state, selected target, expiry, pause, and emergency stop.
Keep overlays click-through except the capsule controls. Prevent overlays from appearing in captured evidence where supported.

| State | Indicator | Effect behavior |
| --- | --- | --- |
| Off | No access glow | No observation or input |
| Observing | Slow iris perimeter | Authorized read-only capture only |
| Requesting control | Static copper accent and approval text | No input before approval |
| Acting | Iris edge with short copper action pulse | Scoped authorized input only |
| Paused | Static muted capsule | No new effects |
| Stopped or expired | Glow removed, clear stopped label | Abort queued and in-flight work where possible |
| Disconnected or unknown | Amber status, no acting pointer | Fail closed, do not infer active access |

Respect reduced motion and offer subtle/quiet appearance modes. Never use motion as the sole state indicator.
A visual-only preview must display SIMULATION and must not claim native access.

## Milestones and verification

1. C0: Visual simulation. Deliver edge lights, labeled pointer, state capsule, and responsive preview.
   Verify honest simulation labels, pause/stop cleanup, keyboard operation, contrast, reduced motion, and no native or network effects.
2. C1: Shared authority integration. Replace boundary mock with accepted policy adapter in the actual Computer integration suite.
   Verify wrong identity, exact expiry, revoke during awaits, one-use quotas, and zero effects after stop.
3. C2: Native read-only provider. Enumerate Windows targets and capture a selected window with fresh identity evidence.
   Verify real capture, DPI, multiple displays, minimized/closed targets, target replacement, and exclusion of unauthorized windows.
4. C3: Visible native overlay. Run an isolated local desktop overlay driven by authenticated session events.
   Verify per-display geometry, click-through behavior, stale event rejection, provider disconnect, capture exclusion, and teardown.
5. C4: Controlled input. Add bounded pointer movement, click, scroll, keys, and text through the same authority path.
   Verify disposable application fixtures, focus changes, human takeover, wrong target denial, cancellation, and independent post-action observations.
6. C5: User workflow. Connect task planning, approval, evidence, restart, and the dashboard.
   Verify a complete local synthetic task before any real user application workflow.
7. C6: Post-build stress gate. Follow POST-BUILD-STRESS-TEST-PLAN.md after individual capabilities pass.

Do not add arbitrary shell execution, privileged desktop access, remote administration, or automatic inference through this feature.
Record each native limitation and unavailable permission. Never classify visual simulation as a native pass.

## Ownership

Coordinator owns this plan and control-center integration.
OCR builds isolated visual modules first. AGR keeps current backend package ownership.
Native work receives separate bounded assignments after its provider contract and verification fixtures are reviewed.

## General agent extension

The user requires a general prompt-driven Computer agent, not a Notepad-only workflow.
Follow [General Computer Agent completion plan](GENERAL-COMPUTER-AGENT-PLAN.md).
AGR-6 initially owns only the new computer-agent package and its receipt. Native and live gates remain explicit.
