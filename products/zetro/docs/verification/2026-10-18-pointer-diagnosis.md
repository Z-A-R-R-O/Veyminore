# Pointer movement verification diagnosis — 2026-10-18

## 1. Executive Summary

Two consecutive five-minute pointer movement sessions stopped after approximately 30 seconds due to independent post-step endpoint verification failures:
- **Run 1**: `docs/verification/2026-10-18-five-minute-motion-1792341905165.json`
  - Elapsed: 30.112s, moves: 22, status: `blocked`, summary: `"Effect requires independent verification before continuing"`.
  - Blocked at step index 65.
- **Run 2**: `docs/verification/2026-10-18-five-minute-motion-1792342122660.json`
  - Elapsed: 29.944s, moves: 23, status: `blocked`, summary: `"Effect requires independent verification before continuing"`.
  - Blocked at step index 68.

In both runs:
1. Native execution succeeded (`runner.mouseAction` returned exit code 0, journal recorded `executionResult: { success: true, durationMs: 0 }`).
2. The failure occurred entirely within post-dispatch endpoint verification (`Math.hypot(after.pointer.x - action.target.x, after.pointer.y - action.target.y) <= 3` evaluated to `false`).
3. Both failures occurred on the **exact same coordinate target**: `{ x: 1634, y: 424 }`.

---

## 2. Forensic Analysis of Motion Trajectory

### Admitted Window & Display Geometry
- Display: Primary screen `{ x: 0, y: 0, width: 1920, height: 1080 }` (96 DPI).
- Admitted target: File Explorer `hwnd = 920714`, bounds `{ x: -8, y: -8, width: 1936, height: 1048 }`.
- Inset bounds computed by `scripts/zetro-pointer-motion.mjs`:
  - `left = Math.max(0 + 70, -8 + 70) = 70`
  - `right = Math.min(1920 - 70, 1928 - 70) = 1850`
  - `top = Math.max(0 + 90, -8 + 90) = 90`
  - `bottom = Math.min(1080 - 90, 1040 - 70) = 970`
  - `midX = Math.round((70 + 1850) / 2) = 960`
  - `midY = Math.round((90 + 970) / 2) = 530`

### Motion Waypoints & Failure Point
The motion sequence alternates through four perimeter midpoints:
- Point 0: `{ x: 70, y: 530 }` (left edge)
- Point 1: `{ x: 1850, y: 530 }` (right edge)
- Point 2: `{ x: 960, y: 90 }` (top edge)
- Point 3: `{ x: 960, y: 970 }` (bottom edge)

1. **Leg 1 (Point 0 -> Point 1)**: Horizontal transit along `y = 530` from `x = 70` to `x = 1850` in ~120px increments. All 15 horizontal intermediate steps were executed and independently verified without issue.
2. **Leg 2 (Point 1 -> Point 2)**: Diagonal transit from `{ x: 1850, y: 530 }` towards `{ x: 960, y: 90 }`.
   - Vector: `dx = -890`, `dy = -440`, `distance ≈ 992.8px`.
   - Step 1: Intermediate target `{ x: 1742, y: 477 }` — **Succeeded and verified**.
   - Step 2: Intermediate target `{ x: 1634, y: 424 }` — **Native dispatch succeeded, but verification failed**.

---

## 3. Telemetry Blindspot & Formal Root Cause Status

### Why Root Cause of the Live Mismatch Remains Unproven
In the previous implementation of `scripts/zetro-pointer-motion.mjs`:
```javascript
verifier: {
  async verifyStep({ action, after }) {
    return {
      verified: action.type === 'wait' ||
        Math.hypot(after.pointer.x - action.target.x, after.pointer.y - action.target.y) <= 3
    };
  }
}
```
When this returned `{ verified: false }`, `universal-loop.js` and `execution-journal.js` recorded:
```json
"verificationResult": {
  "verified": false,
  "method": "visual",
  "details": null
}
```
Because `details` was `null`, the exact observed pointer coordinates (`after.pointer`) and the calculated distance were discarded before the receipt was written to disk.

Furthermore, **new telemetry alone cannot definitively attribute OS clamp vs external pointer movement**:
- Observing an endpoint offset (e.g. observed `{ x: 1630, y: 424 }` vs target `{ x: 1634, y: 424 }`) captures the spatial symptom, but does not identify the underlying mechanism.
- Telemetry cannot distinguish whether the displacement was caused by:
  - Windows OS cursor clipping or display subpixel clamping,
  - Win32 mouse acceleration ballistics,
  - External physical mouse touch/vibration, or
  - An external process moving or snapping the cursor.
- Attributing causality between these factors requires deeper low-level instrumentation (such as WH_MOUSE_LL hooks or physical device event correlation).

Per strict verification discipline, **root cause cannot be assumed without evidence**. It is formally classified as **UNPROVEN / UNKNOWN**.

---

## 4. Technical Hypotheses for the Discrepancy

Four plausible hypotheses account for the failure at `{ x: 1634, y: 424 }`:

1. **Subpixel & DPI Rounding in Win32 `SetCursorPos`**:
   The native helper (`ZetroWindowHelper.cs` `RunMouseAction`) interpolates mouse motion across time and executes `SetCursorPos(endX, endY)`. If Windows display scaling, cursor acceleration ("Enhance pointer precision"), or fractional coordinate mapping truncates coordinates, `GetCursorPos` in `RunExplorerState` can report a coordinate 1–4 pixels away from the requested integer value.
2. **Process Invocation Latency Gap**:
   `runner.mouseAction` and `runner.explorerState` run as two separate OS process invocations. Between the exit of `ZetroWindowHelper.exe mouse-action` and the execution of `ZetroWindowHelper.exe explorer-state`, there is an inter-process scheduling gap of ~600–800ms. If physical input, an OS message loop update, or background window focus occurred during that window, the observed cursor position would diverge.
3. **Explorer Window Hit-Testing / Control Capture at (1634, 424)**:
   In File Explorer on Windows 11 at 1920x1080, coordinates `{ x: 1634, y: 424 }` correspond to the right pane boundary near the vertical scrollbar or column header splitters. Hovering over a window control boundary can trigger Win32 cursor snapping or resize grip cursor transitions that report adjusted coordinates through `GetCursorPos`.
4. **Diagonal Step Rounding Accumulation**:
   The diagonal target `{ x: 1634, y: 424 }` is calculated via `Math.round(current.x + dx * fraction)`. If `current.x` (the observed position from step 1) had a small 1px deviation from step 1's requested target, the subsequent calculation could target an integer coordinate that compounds discrepancy against integer screen bounds.

---

## 5. Implemented Bounded Telemetry & Diagnostic Solution

To eliminate the telemetry blindspot without relaxing verification authority or introducing unverified retries, the following changes were implemented:

### 1. Strict Raw Distance Verification (`scripts/zetro-pointer-motion.mjs`)
- Extracted and exported pure `verifyPointerStep({ action, after, tolerance = 3 })`.
- **Raw Distance Comparison**: Verification evaluates `rawDistance <= tolerance` directly against unrounded floating-point Euclidean distance (`Math.hypot`).
  - *Correction addressed*: Rounding `Math.hypot(...).toFixed(3)` before comparison would relax the threshold (e.g. target `(0, 0)` and observed `(3.0004, 0)` produces rounded `3.000 <= 3`, which improperly passes). The decision is strictly made on raw distance.
  - Telemetry distance is rounded to 3 decimal places for bounded reporting, alongside `rawDistance`.
- **Fail-Closed Guarantees**:
  - `NaN`, `Infinity`, `-Infinity`, and missing coordinates in target or observation fail closed (`verified: false`, `expected`/`observed: null`, `rawDistance: null`, `distance: null`).
- Captures and records:
  - `expected`: `{ x, y }` from `action.target`.
  - `observed`: `{ x, y }` from `after.pointer`.
  - `rawDistance`: Exact unrounded distance.
  - `distance`: Bounded telemetry distance rounded to 3 decimal places.
  - `tolerance`: Strictly fixed at `3` pixels.
- The return value includes `details`, which `execution-journal.js` automatically persists to the chained journal entry.
- The script records `lastVerification` on the top level of the final session receipt JSON.
- **Constraints preserved**:
  - Verification tolerance was **NOT** relaxed (remains strict 3px).
  - Authority gates were **NOT** relaxed.
  - Automatic replay was **NOT** added.
  - The script does **NOT** run native movement when imported.

### 2. Pure Unit Test Suite (`scripts/zetro-pointer-verification.test.mjs`)
Standalone Node.js test suite with 11 focused test cases:
- Exact coordinate match (distance = 0, verified = true).
- In-tolerance movement (distance = 2, verified = true).
- Exact tolerance boundary (distance = 3.0, verified = true).
- Out-of-tolerance movement (distance = 4, verified = false).
- **Negative just-over-boundary**: Target `(0, 0)`, observed `(3.0004, 0)` with raw distance `3.0004 > 3` fails closed, even though rounded telemetry is `3`.
- **Negative diagonal just-over-boundary**: Target `(0, 0)`, observed `(2.1215, 2.1215)` with raw distance `3.000254... > 3` fails closed, even though rounded telemetry is `3`.
- Diagonal Euclidean distance precision calculation within tolerance.
- Direct reproduction of the blocked target `{ x: 1634, y: 424 }` under both passing and failing observed positions.
- Wait action verification telemetry.
- **Fail-closed on NaN, Infinity, and missing coordinates**: Comprehensive tests for NaN observed, Infinity observed, -Infinity target, missing pointer, null observation, and missing target.
- Tolerance parameter compliance.

**Test Execution**:
```
node --test scripts/zetro-pointer-verification.test.mjs
✔ verifyPointerStep returns verified=true when pointer matches target exactly (dist=0) (1.744ms)
✔ verifyPointerStep returns verified=true when pointer is within 3px tolerance (0.1597ms)
✔ verifyPointerStep returns verified=true on exact boundary (dist=3.0) (0.1414ms)
✔ verifyPointerStep returns verified=false when pointer exceeds 3px tolerance (0.1471ms)
✔ negative just-over-boundary: rawDistance > 3 but rounded to 3 decimal places is 3.000 fails closed (0.1856ms)
✔ negative diagonal just-over-boundary: rawDistance > 3 but rounded = 3 fails closed (0.2445ms)
✔ verifyPointerStep calculates diagonal Euclidean distance correctly within tolerance (0.2137ms)
✔ verifyPointerStep accurately captures telemetry for the blocked target (1634, 424) (0.2944ms)
✔ verifyPointerStep verifies wait actions unconditionally with wait telemetry (0.2755ms)
✔ fail closed on NaN, Infinity, and missing coordinates (0.4831ms)
✔ verifyPointerStep respects tolerance argument while defaulting to 3 (0.1732ms)
ℹ tests 11, pass 11, fail 0, duration_ms 113.88
```

---

## 6. Concrete Next Diagnostic Step

When the coordinator or operator authorizes the next diagnostic run (`--allow-native-movement`):
1. Execute `scripts/zetro-pointer-motion.mjs`.
2. If verification succeeds across the diagonal transit, the session continues toward its 5-minute goal.
3. If verification fails at `{ x: 1634, y: 424 }` or any other step, the journal and receipt will immediately record:
   ```json
   "verificationResult": {
     "verified": false,
     "method": "coordinate",
     "details": {
       "expected": { "x": 1634, "y": 424 },
       "observed": { "x": 1630, "y": 424 },
       "rawDistance": 4.0,
       "distance": 4.0,
       "tolerance": 3
     }
   }
   ```
4. While this telemetry will establish the exact spatial offset at the moment of inspection, attributing causality between OS display/cursor clamping, cursor acceleration ballistics, physical input, or background process interference remains unproven until correlated with lower-level input subsystem event tracing.
