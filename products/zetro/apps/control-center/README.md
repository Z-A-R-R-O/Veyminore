# ZETRO control center

A local, read-only front-end for ZETRO coordination evidence and live worker observations.
This is a working browser preview, not the packaged desktop app or an execution console.

From `products/zetro/apps/control-center`:

```powershell
node server.mjs
```

Open http://127.0.0.1:4317. No dependency installation is required.
Use Node.js 22.5 or later. Run `node --test test/*.test.mjs` for server boundary verification.

The preview reads four known dispatch/coordinator files. It refreshes every 10 seconds when visible. Concurrent requests share one cached status collection.
It does not read `.env`, load provider credentials, submit tasks, capture the screen, or modify worker assignments.
Worker rows show live observations separately from saved dispatch and review state.
AGR observations use the local read-only status database with exact conversation, project and workspace identity.
OCR observations use the existing authenticated loopback bridge. Its credentials stay inside that bridge.
Unavailable observations show Unavailable; failed refreshes retain the last view with a connection warning.
RCT-1 through RCT-5 are worker slots marked Not connected. No persistent RCT worker service is connected.
Running and idle are activity observations, not independent acceptance. Missing sources are reported through the API and never treated as success.
The RCT requirements view is an explicit planning assessment, not an automatically measured completion percentage.

Features: overview, 14 agent requirements, RCT/AGR/OCR worker filters and details, coordinator activity,
delivery sequence, responsive layout, keyboard navigation, reduced motion and preview appearance controls.
The Satoshi variable font was supplied by the user. Preserve its applicable license when redistributing the app.

The local service binds only to 127.0.0.1. It enforces host/origin checks, a same-site viewer cookie,
static route allowlisting, a restrictive content security policy and read-only methods.
This is a local viewer boundary, not the future authenticated execution authority API.

Plans: `docs/RCT-AGENT-REQUIREMENTS.md` and `docs/DESKTOP-FRONTEND-PLAN.md`.
Current AGR/OCR package ownership and product lockfiles are unchanged.
