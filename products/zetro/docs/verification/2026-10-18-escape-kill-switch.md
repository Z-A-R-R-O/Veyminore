# Escape kill switch

The native overlay registers Escape only while a computing session is active. Escape clears the overlay and requests cancellation of the whole reactive session, including a pending native action. Normal shutdown unregisters the hotkey. A registration conflict or unexpected overlay disconnect cancels the session. Native cursor settings remain unchanged.

Verification: both native helpers compiled; all 16 reactive tests passed, including fragmented Escape event handling, single cancellation, and cancellation without subsequent effects. Native hotkey registration was checked independently without injecting a keyboard event. A physical Escape press was not exercised.

The requested five-minute movement-only rerun began and stopped after 30.112 seconds, with 22 moves, zero clicks and zero typed characters. Independent pointer readback did not match the requested endpoint, so the agent blocked further input. This is not a completed five-minute qualification. The cause of the position mismatch is unconfirmed; no automatic replay was attempted.

Receipt: 2026-10-18-five-minute-motion-1792341905165.json.
