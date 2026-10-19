# Native Explorer gap closure — 2026-10-18

## Result

The bounded Downloads folder workflow now works through ZETRO's native Windows provider and reactive skill. The host derives the folder name from the prompt. It does not use a filesystem create operation for the task.

The existing `Downloads\hello` directory was present before execution. ZETRO reported `already_exists` and did not recreate, replace or delete it.

The final live qualification used a unique disposable folder. ZETRO opened Downloads, bound one exact Explorer window, created the folder with native keyboard input, and read back the result. An independent filesystem check confirmed the new directory. The test removed only its new empty folder after verification.

Final receipt: [native Explorer qualification](2026-10-18-native-explorer-1792340323787.json).

## Fixed gaps

- Removed the Explorer verifier that always returned success. Verification now requires matching native identity, a fresh observation, the approved parent path, an absent-folder baseline and a real directory.
- Added a native host that composes the five reactive ports. The input sequence is New folder, enter the requested name, then confirm. Every transition requires a fresh observation.
- Bound native keyboard and foreground text input to HWND, process ID, process-start token, session and finite expiry.
- Added effect-time Downloads location and focused-control checks. Typing requires the observed rename control class inside the admitted window.
- Used actual Explorer rename metadata. The first attempt stopped because Windows exposes the rename editor directly under `UIItemsView`. The observer now recognizes `UIRenameTextElement` in that target view. The initial empty fixture was independently identified by its creation time and removed. The failed attempt and observer probe remain recorded.
- Fixed enumeration identity tokens. Per-window tokens now use the actual HWND, PID and process start instead of an enumeration timestamp.
- Restricted native host discovery to visible Explorer candidates. Large unrelated window inventories are not printed or fetched for this workflow.
- Attached the native monochrome aura and cursor presentation to the reactive session. The pointer uses observed coordinates when available. It does not use a demonstration orbit.
- Recorded intent and execution before post-effect verification. Observation failure after input produces an uncertain result and preserves the audit record.
- Removed the CLI's silent mock fallback and unqualified default host. Other workflows cannot claim desktop success through this CLI.

## Checks

87 regression checks passed before the final focus/location guard changes. The changed subset then passed 47 focused checks. The host and CLI tests passed after guard integration. After the last changes, 22 focused host, CLI, reactive and argument checks passed. Another 24 provider compatibility checks passed. Final native checks rejected a foreign PID, an expired grant, a wrong directory and a wrong focus class. The final receipt contains source and executable hashes.

The native overlay process was absent after the completed run. No model endpoint, paid fallback or source transmission was used.

## Use

From the repository root:

```powershell
node products/zetro/packages/computer-agent/src/cli.js --native --allow-input --prompt 'Create a folder named "example" in Downloads' --json
```

Input remains disabled without `--allow-input`. Existing folders return `already_exists`. Ctrl+C cancels the run. Unknown results stop without retry.

The reusable live qualification is `products/zetro/scripts/qualify-explorer-native.mjs --allow-native`. It creates one unique folder in Downloads and removes only that empty fixture. It requires explicit native opt-in and writes a separate receipt for each run.

## Remaining scope

This qualifies the bounded Explorer workflow through Codex. It does not qualify arbitrary applications, all mouse gestures, multi-display scaling or separate AGR/OCR operators. General app hosts, model-driven planning and their independent outcome verifiers remain release gates. The browser preview remains a simulation.
