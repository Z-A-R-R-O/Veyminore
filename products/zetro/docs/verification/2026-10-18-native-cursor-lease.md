# Native cursor presentation

The reference cursor is enlarged from approximately 22 x 24 to 27 x 29 pixels in native rendering and browser preview. A separate cursor lease hides standard Windows cursor shapes while the custom pointer is visible. It restores the configured cursor theme when the pointer leaves the admitted display or presentation ends. No registry settings are written. Applications with their own nonstandard cursor resources can still display those resources.

The lease monitors parent lifetime, a three-second heartbeat deadline and session expiry. EOF restores the cursor. Escape ends the overlay and its lease. A local mutex prevents concurrent cursor leases.

Independent native cursor-mask readback confirmed replacement while active and restoration after normal exit and forced overlay termination. No clicks, movement or keyboard events were sent. All 16 reactive tests and four renderer checks passed. See 2026-10-18-native-cursor-lease.json. Browser preview remains a simulation.
