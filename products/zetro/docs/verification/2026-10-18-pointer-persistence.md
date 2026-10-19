# Persistent computing pointer — 2026-10-18

## Fixed

The overlay previously cleared its pointer whenever the agent changed from acting to observing. Each native action displayed the pointer briefly, then the next observation hid it.

The bridge now retains the pointer across active observation and action states for the same target. A target change, pause, stop, disconnect or expiry clears it. The native overlay reads the actual OS pointer position on each animation tick. It no longer depends on action proposals for position or visibility. The label follows that position inside the admitted display.

## Verified

- 21 focused reactive and universal tests passed.
- Four native renderer checks passed.
- A native visual probe presented observing, acting and observing states. The pointer remained visible in all three states, despite absent pointer telemetry. Expiry cleared the surface. The process exited normally.
- The probe sent no mouse or keyboard input and changed no OS cursor settings.
- Evidence: `2026-10-18-pointer-persistence.json`.

## Native cursor replacement

Windows exposes ShowCursor for visibility and SetSystemCursor for system-wide cursor replacement. SetCursor alone is constrained by the owning window and its class cursor. A cross-application replacement needs an explicit session mode, saved cursor state and an independent restoration path for exit, expiry and crashes. This mode is not enabled by this update.

References:
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showcursor
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setsystemcursor
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursor

## Previous movement session

The requested five-minute movement session stopped after 15.218 seconds with an uncertain native action result. It performed 11 completed movement actions, no clicks and no typing. It did not complete five minutes. It was not automatically replayed while this pointer issue was fixed.
