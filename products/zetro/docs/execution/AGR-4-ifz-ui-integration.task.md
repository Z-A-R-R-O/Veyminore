# AGR-4 IFZ UI integration

Integrate the accepted product shell and Work page into the live control center. Own only:
- apps/control-center/build.mjs
- apps/control-center/src/index.js and new integration entry modules if needed
- apps/control-center/public/index.html
- apps/control-center/server.mjs only for read-only GET/HEAD projection wiring
- apps/control-center/test/server.test.mjs and new integration tests
- docs/execution/AGR-4-ifz-ui-integration.md
Do not edit AGR-5 Work model/page/CSS or your already accepted shell source/CSS.

Requirements:
- Work is the default live route and mounts IfzWorkPage in ProductShell.
- Preserve current three docks and new side panels/top nav; import product-shell.css and ifz-work.css through build.
- Wire canonical hash/history/popstate/back/forward/refresh/copied-route behavior.
- Supply only real observed read-only status data; omitted evidence stays unknown. No invented counts/workspaces/connection/accepted/verified state.
- No mutation endpoint. Composer remains visibly dry-run until authenticated IFZ API exists.
- Preserve Computer page and orb/overlay routes without turning preview into native proof.
- Dev fixtures/tweaks hidden unless explicit development-lab flag.
- Build and run focused control-center tests. Browser integration remains coordinator gate.
Append exact receipt and limitations.
