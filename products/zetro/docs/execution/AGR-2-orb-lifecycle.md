# Desktop Overlay Child Lifecycle Invariants & Intent Forwarding

- **Task**: Desktop Overlay Child Lifecycle Invariants & Intent Forwarding
- **Worker**: AGR-2
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Files**:
  - [`packages/computer-agent/src/desktop-overlay.js`](file:///E:/Veyminore/products/zetro/packages/computer-agent/src/desktop-overlay.js)
  - [`packages/computer-agent/test/desktop-lifecycle.test.js`](file:///E:/Veyminore/products/zetro/packages/computer-agent/test/desktop-lifecycle.test.js)
  - [`docs/execution/AGR-2-orb-lifecycle.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-2-orb-lifecycle.md)
- **Status**: `ready_for_review`
- **Budget**: Finite 15 minutes / focused reads and tests only

---

## 1. Concrete Failures Corrected

1. **Write Exceptions Cancel Host Rather than Silently Close & Fencing across Pause/Resume**:
   - *Previous behavior*: `send()` used `catch { stopChild(); }`, which silently terminated the child process without invoking `requestStop()` or notifying `onStopRequested`. The host remained running blind without an overlay or cancellation. Furthermore, asynchronous write callbacks were not fenced to the specific child instance written to; a delayed write error from an old child closed during `paused` could erroneously abort a newly resumed child.
   - *Corrected behavior*: `send()` captures `const writing = child;`. It checks `writing.stdin.writable`, catches synchronous write throws, and listens for write callback errors with an explicit fence `if (child !== writing) return;`. Stale write errors from a child closed on pause are safely discarded, while current child write exceptions immediately call `requestStop(err?.message || 'Native overlay write failed')`, notifying `onStopRequested(reason)` and cancelling the host reactive session cleanly.

2. **Native Disconnect/Stop Never Respawns Overlay on Later Events**:
   - *Previous behavior*: After child disconnect or stop, `child` was set to `null`. If a later event arrived with `event.auraActive === true`, `!child` evaluated to `true`, causing `spawnImpl` to spawn a second, unauthorized overlay child.
   - *Corrected behavior*: Tracked `stopped` and `noRespawn` flags. Once an overlay disconnects, requests stop, or is terminated/closed, `noRespawn = true; stopped = true;`. Any subsequent events arriving on the bridge will never re-invoke `spawnImpl`.

3. **Callback At Most Once**:
   - *Previous behavior*: Re-entrant or cascading events (e.g. child error followed by exit followed by broken pipe) could potentially trigger multiple callbacks.
   - *Corrected behavior*: Guarded `notifyStop(reason)` with `callbackFired = true`. `onStopRequested` is guaranteed to be executed strictly at most once under all circumstances.

4. **Clean Normal Stop Must Not Report False Disconnect**:
   - *Previous behavior*: `launched.once('exit', disconnected)` called `requestStop('Native overlay disconnected')` whenever `exit` fired, even on normal exit (code 0) or after the host intentionally ended the session via `bridge.close()`.
   - *Corrected behavior*: Tracked `intentionalStop`. When the host closes the bridge via `bridge.close()` or transitions to terminal states (`stopped`, `expired`, `disconnected`), `intentionalStop = true; stopChild();`. The child exit and error listeners check `if (intentionalStop || stopped) return;`, ensuring normal clean stops never falsely report `'Native overlay disconnected'`.

5. **Additional Integration Handoff (AGR-3 Intent Forwarding)**:
   - Added optional `intent = null` to `createDesktopOverlay` options.
   - Forwarded `intent` into `new AuthoritativeOverlayBridge({ sessionId, expiresAt, intent, ... })`.
   - Ensured `bridge.intent` reflects the passed intent for forward/backward compatibility without editing AGR-3's `overlay-bridge.js`.

6. **Preserved Invariants**:
   - Finite future expiry enforcement (`expiresAt`).
   - 1000ms heartbeat timer with `.unref?.()`.
   - Default disabled native spawn (`enabled = false`).
   - Escape cancellation (`stop_requested`).
   - Display bounds validation (`validateDisplay`).
   - No UI/CSS/HTML or visual modifications made.

---

## 2. Verification Evidence

1. **Focused Deterministic Fake-Child Tests ([`packages/computer-agent/test/desktop-lifecycle.test.js`](file:///E:/Veyminore/products/zetro/packages/computer-agent/test/desktop-lifecycle.test.js))**:
   - **Command**: `node --test test/desktop-lifecycle.test.js`
   - **Result**: `15 passed, 0 failed, duration: ~36ms`
   - Test breakdown:
     - `1. write exception (synchronous throw) cancels host rather than silently closing`
     - `2. write exception (async callback error) cancels host rather than silently closing`
     - `3. non-writable stdin cancels host rather than silently closing`
     - `4. pause -> resume newchild -> oldwritecallback(error) ignores stale callback and keeps new child active`
     - `5. native disconnect must never respawn overlay on subsequent aura events`
     - `6. native stop request (Escape) must never respawn overlay on subsequent events`
     - `7. clean close must never respawn overlay on subsequent events`
     - `8. callback at most once: multiple error and exit triggers fire callback strictly once`
     - `9. clean normal stop via bridge.close() does not report false disconnect`
     - `10. clean normal stop via transition("stopped") does not report false disconnect`
     - `11. native stop request followed by normal child exit reports escape exactly once and no disconnect`
     - `12. forwards optional intent into AuthoritativeOverlayBridge`
     - `13. defaults intent to null when omitted`
     - `14. preserves finite expiry validation`
     - `15. default disabled: does not spawn native child when enabled is omitted`

2. **Existing Reactive & Orb Activity Tests ([`packages/computer-agent/test/reactive.test.js`](file:///E:/Veyminore/products/zetro/packages/computer-agent/test/reactive.test.js) & [`orb-activity.test.js`](file:///E:/Veyminore/products/zetro/packages/computer-agent/test/orb-activity.test.js))**:
   - **Command**: `node --test test/reactive.test.js test/orb-activity.test.js`
   - **Result**: `21 passed, 0 failed, duration: ~242ms`

3. **Full Package Test Suite (`npm test` in `packages/computer-agent`)**:
   - **Result**: `94 passed, 0 failed across 15 test suites`

4. **Whitespace & Diff Cleanliness**:
   - `git diff --check packages/computer-agent` -> Clean, 0 whitespace issues.

---

## 3. Honest Native Limitations

1. **Drawing-Only Process**:
   - The native overlay process (`ZetroAccessOverlay.exe`) is strictly presentation-only. It cannot capture the desktop or inject input.
2. **Deterministic Fake-Child Testing**:
   - Unit tests use deterministic EventEmitter-based fake child subprocesses to exercise stdin write errors, disconnects, clean exits, and Escape hotkey messages without live native presentation.
3. **Parent Review**:
   - Worker self-reports and receipts do not constitute final acceptance; parent coordinator (Codex) reviews and accepts.
