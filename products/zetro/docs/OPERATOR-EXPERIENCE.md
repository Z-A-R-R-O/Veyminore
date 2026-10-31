# Operator experience and operations

**Status:** proposed UX and operations contract. Command examples are illustrative; they are not implemented yet.

## 1. First-run journey

1. Install ZETRO and run `zetro doctor`. The diagnostic reports runtime dependencies, OS permission status, data directory health, supported capabilities and any blocked features.
2. Run `zetro start`. The output shows daemon state, local connection method, current user, capability availability and a session count. It must not print a bearer token.
3. Connect an agent client through the documented MCP configuration or use `zetro session create` for CLI automation.
4. Grant a narrow read-only capability and inspect the first screen/window observation.
5. Preview a mutating request, approve its exact effect, run it, inspect its verification and revoke the grant.
6. Stop the runtime and confirm it releases held input state and closes local listeners.

Setup documentation must include screenshots or examples for the first supported OS, required OS permissions, what data is stored, and a way to remove local state safely. The first-run demo does not need a desktop app.

## 2. CLI design

| Command group | Purpose | Key behavior |
| --- | --- | --- |
| `start`, `stop`, `status`, `doctor` | Runtime lifecycle and diagnostics | Stable exit codes; JSON output option |
| `session create|list|show|revoke` | Agent sessions | Principal and expiry visible; no secret leakage |
| `grant list|request|revoke` | Capability control | Show exact scope and expiry |
| `action submit|show|cancel` | Finite actions | Print ID immediately; terminal status retrievable |
| `events tail` | Timeline | Cursor-based resume, redacted by default |
| `evidence show|export|purge` | Artifact review and retention | Preview export contents; log purge action |
| `project`, `agent`, `dispatch` | Phase 2 orchestration | Keep project selection explicit per invocation/session |

`zetro` with no arguments prints concise status and help. Noninteractive commands fail with `APPROVAL_REQUIRED` rather than waiting invisibly. `--json` output uses the protocol schema and never mixes progress text into stdout; diagnostics go to stderr. A command that starts work returns an action/dispatch ID and can optionally wait with a bounded `--wait` deadline.

## 3. Desktop control center

The Tauri control center is a supervisory client. Its first screen shows runtime/bridge health, active sessions and their grants, pending approvals, active desktop input lease, recent actions, and an emergency stop control. A live screen view is opt-in and visibly indicates capture. Each action detail shows request, target, approval, event timeline, effect, verification, and evidence. An operator can filter by session or project.

### Supervisory Navigation and Ergonomics

Historical design note: the floating side-card and top-menu details in this section describe an earlier Control Center layout. The current client uses three bottom docks, a left agent navigator, and a hideable right tool rail. Do not use this section as current UI verification.

The desktop control center operates with non-disturbing floating navigation surfaces designed for high-stakes supervision:

1. **Non-Disturbing Floating Side Cards (No Dark Scrim)**:
   - Full-screen modal drawers with dark dimming scrims have been replaced with floating side cards (`aside.left-side-card` at `width: 260px` matching Command Palette geometry; `aside.right-side-card` at `width: 420px`).
   - The backdrop click-away shield (`.left-nav-shield` and `.right-nav-shield`) is completely transparent.
   - Operators maintain continuous, unobscured visual contact with live terminal logs, agent execution graphs, and computer session feeds even while inspecting conversation history, workspaces, diffs, or route configurations.

2. **Keyboard Accessibility and Focus Control**:
   - Pressing `Escape` collapses any open floating card or top navigation megamenu, cleanly returning focus to the trigger icon or previous interactive target without focus trapping.
   - Global shortcuts (such as Command Palette activation) cleanly invoke modals without layout jumping or animation stutter.
   - Full support for `prefers-reduced-motion` suppresses spring transforms and replaces them with instant opacity fades.

3. **Persistent Operator State**:
   - Navigation preferences (`zetro_left_panel_collapsed`, `zetro_right_panel_collapsed`, `zetro_right_panel_tab`) are persisted in `localStorage`.
   - The workspace layout restores the operator's exact configuration across browser refreshes and route switches.

4. **Visual Telemetry and Accent Badge Reflection**:
   - Notification and status badges across docks and panels dynamically reflect the operator's active accent color (`mint`, `cyan`, `violet`, `amber`, `rose`, `silver`) via CSS variables (`--dock-badge`, `--dock-badge-ink`, `--accent`, `--mb-glow-rgb`).
   - Contrast is strictly enforced: bright accents such as `silver` automatically switch text ink to deep dark `#090a0c` to maintain WCAG AA readability.

5. **Collision Prevention and Responsive Smart Shrink**:
   - Mutual exclusivity ensures that expanding the top megamenu automatically collapses side cards, and expanding either side card dismisses the top menu.
   - Cards are vertically constrained to `max-height: calc(100vh - 112px)`, ensuring a permanent 8px floating clearance above bottom docks. Vertical compact docks automatically downscale item sizes and gaps on short viewports ($\le 650\text{px}$, $\le 520\text{px}$, $\le 440\text{px}$) to avoid overlapping critical stop controls.

6. **IFZ Prompt Bar and Master Prompt Governance**:
   - The primary supervisory workspace centers on the fixed floating IFZ Prompt Bar (integrated with React Bits morphing SVG send/stop tile and typing-energy canvas particle sparks at Max effort).
   - Prompts pass strictly through IFZ with truthful dry-run execution stream confirmation before committing any mutating actions.
   - Operators can inspect or switch across all 4 constitutional Master Prompt layers (Charter, Worker Knowledge, Project Context, Task Package) and 8 predefined governance presets (`ZETRO Standard`, `ECO Mode`, `Build Mode`, `Review Mode`, `Design Mode`, `Qualification Mode`, `Recovery Mode`, `Custom`) directly from the header pill or PromptBar model picker.
   - Active executions expose a dedicated stop control that immediately aborts worker branches and commits zero unverified effects.

## 4. Approval interaction

The operator sees a plain-language effect summary plus exact technical target. Example:

```text
Agent: Codex · Session zt_... · Action act_...
Request: Write E:\work\notes.txt (2.1 KB)
Scope: one file, one use, expires in 60 seconds
Expected check: file hash matches proposed content
[Approve once] [Deny] [Inspect diff]
```

For shell commands, show executable, arguments, cwd and environment variable names. For browser submissions, show destination and data category when determinable. For ambiguous GUI actions, show a fresh crop or screenshot and ask for explicit confirmation. Never summarize an unsafe effect merely as “click button.”

## 5. Failure and recovery experience

| Condition | Operator sees | Recovery path |
| --- | --- | --- |
| OS screen/input permission absent | Capability unavailable with OS-specific guidance | Grant OS permission, rerun doctor |
| Target moved or window closed | `TARGET_STALE` with old/new observation refs | Reobserve and resubmit |
| Another session owns input | Queue position or `INPUT_BUSY` | Wait, cancel, or stop owner session |
| Provider crashed | Degraded capability and uncertain in-flight effect | Restart bridge; inspect receipt; do not auto-repeat |
| Approval expired | Exact request remains visible but cannot execute | Refresh observation and request again |
| Storage full/corrupt | Runtime enters safe degraded/failed state | Export diagnostics, repair state with documented recovery tool |
| External worker disconnected | Dispatch remains running/unknown with last cursor | Reconnect adapter and reconcile external job ID |

Recovery tools must preserve evidence by default. Destructive cleanup commands require explicit target selection, preview and audit. Backups include the database plus referenced artifacts; restoring only one side reports missing evidence rather than silently treating receipts as complete.

## 6. Diagnostics, updates and support

`doctor` checks runtime version/protocol compatibility, database migration status, provider probes, permissions, loopback binding, artifact directory access and recent recovery anomalies. A support bundle redacts secrets, lists included files before export and is never uploaded automatically. Version upgrades run database migrations with backup and rollback guidance. A downgrade that cannot read the newer schema fails clearly rather than altering state.

Publish a compatibility matrix and change log for each release: OS/build, native bridge, browser engine, MCP client versions tested, known unavailable capabilities and migration steps. Treat a loss of policy enforcement or false verified result as a release blocker and incident-worthy defect.
