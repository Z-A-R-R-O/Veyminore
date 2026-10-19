# AGR-4 task: IFZ product shell modules

Read `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` first.

Build isolated source modules for the product shell. Do not integrate them into the live app in this wave.

Own only:

- `apps/control-center/src/product-shell.jsx`
- `apps/control-center/src/product-navigation.js`
- `apps/control-center/public/product-shell.css`
- `apps/control-center/test/product-navigation.test.mjs`
- `docs/execution/AGR-4-ifz-product-shell.md`

Do not edit `src/nav-island.jsx`, `src/dock-island.jsx`, `public/app.js`, `public/style.css`, `build.mjs`, generated bundles, or AGR-5 paths.

Requirements:

- Define one route registry for Work, Workers, Runs, Computer, Evidence, and Settings.
- Provide projections for the top menu, center dock, left utility dock, right utility dock, and responsive navigation.
- Preserve the existing three-dock identity, Satoshi typography, black/white/graphite direction, active indicator, and dock magnification.
- Model optional left Conversations panel and right Route, Context, and Inspector panel.
- The top menu groups Product, IFZ, and System.
- Remove RCT Readiness, Roadmap, and Orb Preview from primary product routes.
- Use semantic buttons and navigation landmarks with keyboard focus and Escape behavior.
- Include reduced-motion and narrow-screen rules.
- Keep development Tweak controls clearly scoped from product authority.
- Use no new dependencies.

Run the focused navigation test and a temporary esbuild syntax check that does not write tracked generated bundles. Record results and integration limits.

