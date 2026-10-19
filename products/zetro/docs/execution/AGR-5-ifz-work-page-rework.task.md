# AGR-5 IFZ Work page rework

Correct only your isolated Work page/model/CSS slice. Do not integrate shared app/server/navigation files.

Acceptance:
- Default model is empty/unknown and never running, connected, accepted, verified, or populated without supplied evidence.
- Replace emoji/text-symbol controls (attachment, stop, send and similar) with accessible Hugeicons or clean inline SVG. Every icon-only control needs a tooltip and aria-label.
- Hide fixture/developer controls by default. Expose them only through an explicit development-lab option; they must not appear in product UI.
- Keep live submit disabled/dry-run and visibly truthful until an authenticated mutation API exists.
- Inject clock and ID generation into the model; remove Date.now/Math.random nondeterminism from domain behavior.
- Ensure IFZ is the stable recipient, manual route is a constraint, and route suggestions never auto-send.
- Add focused tests for truthful defaults, dev-only fixtures, deterministic IDs/time, and keyboard/accessibility semantics.
- Append an honest receipt to docs/execution/AGR-5-ifz-work-page.md.
