# Development mode and bug reports

Available only under the Vite development server (`pnpm dev`). The game entry imports the development shell inside `import.meta.env.DEV`; production builds exclude the shell, stylesheet, sandbox launcher and report UI. There is no query-string override or server cheat endpoint.

## Use

The purple floating bug button marked DEV appears across game pages. Drag it with mouse or touch. Keyboard users can focus it and move it with arrow keys (12px), or Shift + arrow keys (40px). Enter/Space opens the panel. Position is remembered in `arowgo.dev.dock.v1`, clamped to the viewport on resize/reload, and can be reset from Tools. Dragging does not also open the panel.

Tools provides:
- A Development mode toggle, remembered locally. Turning it off exits the sandbox and clears layout outlines; local bug reporting remains available.
- A level picker for all sixty levels, including normally locked levels.
- An isolated Practice sandbox, with a permanent SANDBOX/Exit indicator.
- Show safe moves while in the sandbox.
- Layout outlines for inspecting hit targets and containers.

The regular campaign is unmounted while sandbox play is active and returns on exit. Sandbox Controllers use a memory-only SaveStore and suppress local-save/completion events, so they cannot trigger cloud synchronization or reward submission. Practice mode awards no coins/stars. Sandbox mechanic guides do not change tutorial-seen flags. Other explicitly changed settings, such as sound, retain normal behavior.

## Reports

Choose Bug report, enter a summary, severity and reproduction steps/expected behavior, then Copy report or Download report. Clipboard failures offer the download fallback. Nothing is sent to GitHub, a backend or another person automatically.

The JSON contains a timestamp, sanitized known game route, viewport and pixel ratio, reduced-motion setting, runtime-error count, and known level ID/content version. In sandbox mode it also includes the active arrow IDs and sandbox level. It does not inspect account data, balances, cookies, tokens, saved-game contents or console messages. Full URLs/query strings and error messages/stacks are deliberately excluded. User-written report text is included as entered, subject to length limits. Downloaded reports can be shared manually with the developer.

Dev preference keys are outside the cloud backup allowlist. The panel does not modify account/economy settings. Existing progression locks remain in force outside the sandbox.

## Verification

Unit coverage checks clamping (including malformed coordinates), sanitized reports and reward-free memory-only sandbox play. Phone and desktop browser checks cover keyboard/pointer movement, position persistence, drag-versus-click behavior, JSON download content, opening locked Level 60 in the sandbox, rule guide behavior, safe-move inspection, unchanged campaign storage on exit, viewport clamping and disabling development mode. The 320px panel was visually inspected. Production artifact checks confirm no development shell/UI/CSS is emitted.

Bug-report email: `interfrozt.vym@gmail.com`. Add one PNG/JPEG/WebP screenshot (maximum 5 MB), preview or remove it, then download an `.eml` draft containing the report JSON and screenshot. Open the draft in a compatible mail application, review and send; clients that open EML read-only can forward it to the displayed address. The separate Open email app action uses mailto (text only, screenshots require manual attachment). No SMTP service or automatic delivery is configured. Attachments are held in memory, object URLs are revoked, and no account credentials or save data are collected automatically. User-selected screenshots may contain private information; review before sending.

## Numeric difficulty - 21 November 2026

The level selector shows an offline structural rating with a detailed component breakdown. Sandbox also shows its rating in the exit strip. Missing measurements are explicitly unmeasured. Candidate Levels 101-105 are isolated DEV previews; they grant no campaign progress or rewards. See [rating model and chapter plan](CHAPTER-SIX-PLAN.md). Ratings are not IQ or human difficulty measurements.
