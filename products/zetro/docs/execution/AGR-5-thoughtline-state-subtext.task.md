User refinement after accepted minimal layout.

Keep the 120px MagicRings, Details/history behavior, and exact upstream React Bits component files unchanged.

Change only the control-center wrapper/presentation so the hierarchy is:

1. Primary line: lifecycle state only. Use calm product language such as `Working…`, `Paused`, `Done`, `Stopped`, or `Needs attention`. While active it must not repeat the task-specific action or target.
2. Secondary line: smart, task-specific public status derived from the existing safe snapshot text, such as `Locating Downloads`, `Checking the folder`, or `‘hello’ is ready.` It may include the subtle elapsed time. Do not expose private reasoning, raw prompts, typed content, fake progress, or ETA.
3. Details: optional verified/current activity history as already implemented.

Make the primary state 15–16px medium weight. Make the smart subtext 12–13px muted, centered, max two visual lines, with restrained transition. Terminal and Escape states must update immediately. Ensure screen readers announce a single current state plus the current public subtext without stale or tripled announcements. Avoid duplicate live regions.

Do not change smart-status core semantics, providers, native input, dependencies, server routes, or unrelated files. Run `node build.mjs` and the focused control-center server test. Add a concise receipt at `docs/execution/AGR-5-thoughtline-state-subtext.md`.
