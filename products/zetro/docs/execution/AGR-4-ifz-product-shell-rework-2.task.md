# AGR-4 IFZ product shell rework 2

Correct only your isolated product shell/navigation/CSS/tests. Do not integrate shared build/server/app or AGR-5 Work files.

Acceptance:
- Closed side panels must not expose focusable controls: unmount them or use inert with reliable tab exclusion.
- On open, focus a meaningful first control. Trap focus in modal menu/tweak dialogs; Escape closes and returns focus to the opener.
- Add pure canonical URL/hash/history state helpers and tests for route load, navigation, back/forward, refresh, and copied route. Keep side-effect wiring isolated for the integration owner.
- Keep truthful defaults already fixed: no invented connection, workspace, worker count, IFZ status, acceptance, or verification.
- Preserve current dock identity, exact destinations, responsive projections, and no header Orb CTA.
- Run focused product-navigation tests and append exact results to docs/execution/AGR-4-ifz-product-shell.md.
