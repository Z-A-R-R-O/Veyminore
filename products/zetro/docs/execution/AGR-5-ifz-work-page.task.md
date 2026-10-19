# AGR-5 task: IFZ Work page and master prompt composer

Read `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` first.

Build isolated source modules for the Work page. Do not integrate them into the live app in this wave.

Own only:

- `apps/control-center/src/ifz-work-page.jsx`
- `apps/control-center/src/ifz-prompt-bar.jsx`
- `apps/control-center/src/ifz-work-model.js`
- `apps/control-center/public/ifz-work.css`
- `apps/control-center/test/ifz-work-model.test.mjs`
- `docs/execution/AGR-5-ifz-work-page.md`

Do not edit current Orb or ThoughtLine component sources, live app integration files, build configuration, generated bundles, or AGR-4 paths.

Requirements:

- Follow the compact Codex composer pattern while keeping ZETRO's product identity.
- The main prompt always targets IFZ.
- Support Automatic, Manual, and Saved Workflow route modes.
- Manual selection constrains IFZ. It does not bypass IFZ.
- Show route chips and a public route preview before send.
- Provide attachment, preset, send, and stop controls.
- Model a unified conversation with user prompts, IFZ plans, worker status, results, verification, handoffs, questions, failures, and cancellation.
- Support expandable worker branches without exposing private reasoning.
- Preserve draft text across page-model transitions.
- Include honest empty, loading, disconnected, running, partial-failure, uncertain, cancelled, and complete fixtures.
- Do not send network requests or simulate successful dispatch.
- Use accessible names, keyboard operation, focus return, and reduced motion.
- Use no new dependencies.

Run the focused model test and a temporary esbuild syntax check that does not write tracked generated bundles. Record results and integration limits.

