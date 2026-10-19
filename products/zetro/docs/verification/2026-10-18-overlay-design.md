# ZETRO overlay design update — 2026-10-18

The native computing overlay and browser preview now use the same monochrome design language.

- The edge uses a soft breathing aura and drifting pearl light. It has no rotating border or solid frame.
- The cursor uses the earlier angular silhouette, circular hub and fine white details at approximately 22 by 24 pixels.
- The compact ZETRO label uses Satoshi, a dark capsule, subtle edge highlights and a 125 ms following response. Its first position starts next to the cursor. It stays inside the admitted display.
- Reduced motion freezes the aura and removes label lag. Stop, expiry and disconnect clear the visuals.
- The native surface uses per-pixel alpha composition instead of a magenta color key. The interior stays transparent. The overlay remains click-through and does not activate itself.

## Verification

The local native build passed. Four renderer checks passed: transparent interior, translucent aura, legible label and distinct animation frames. Thirteen reactive lifecycle checks passed.

A visual-only native probe exercised the Windows alpha compositor. Two positions were presented successfully. Expiry cleared the surface, and the process exited normally. The probe sent no computer input. See `2026-10-18-overlay-v2-native.json`.

Light and dark render images were inspected. The browser action preview was inspected with the actual interface. Preview controls remain above the floating status capsule. The browser remains explicitly labeled a simulation.

The native composition follows Microsoft's UpdateLayeredWindow alpha contract: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-updatelayeredwindow.

This update changes presentation. It does not expand computing permissions or qualify additional applications.
