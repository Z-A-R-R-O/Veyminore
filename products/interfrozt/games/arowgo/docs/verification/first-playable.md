# First playable — engineering evidence

Date: 10 November 2026. Build: `@veyminore/arowgo@0.1.0`. Rules/schema/content: version 1. [Game README](../../README.md) · [Rule proof](../rule-proof.md)

## What exists

One original 8×8 level with ten arrows, rigid translation, blocked-arrow feedback, three-mistake Story, unlimited-mistake Practice, a free assisted Hint, restart confirmation, results, first-clear coins, local save/resume and reduced-motion controls. An interactive Rule lab exposes nine small mechanic examples without changing campaign progress.

The UI uses React/CSS around a Phaser board. All puzzle legality is pure TypeScript. DOM pointer events are mapped to Phaser scene coordinates and continuous path segments; this avoids a dropped first click during engine boot. Keyboard users can Tab to labeled arrow controls and press Enter. Canvas animation displays an already committed transition.

## Verification

| Check | Result / scope |
| --- | --- |
| TypeScript | Passed strict typecheck |
| Rules and state tests | 33 passing tests across two suites |
| Independent collision comparison | All 1,023 nonempty active-arrow subsets of the first level; 5,120 candidate-arrow comparisons |
| Original content solution | `A B C D E F G H I J`, replayed through the swept checker |
| Production web build | Passed; standalone Phaser chunk about 1.37 MB uncompressed / 357 KB gzip |
| Formatting | Prettier check covers source, tests, content and configuration; not the immutable reference source |
| Browser integration | See final recorded run below; desktop Chromium and Pixel 7 viewport/touch emulation |
| Android generation and asset sync | Passed with Capacitor 8.6.0 |
| Android compile | Blocked: Gradle reports no `JAVA_HOME` and no `java` on PATH |
| Physical Android testing | Not performed; no SDK/device available in the checked environment |

Final browser run: **6 passed** (three scenarios on each of desktop Chromium and Pixel 7 browser emulation). Covered blocked feedback, full completion, saved reload, no duplicate replay reward, pointer/touch body selection, restart cancellation, practice, Rule lab isolation, rapid-tap deduplication, failure/resume, keyboard dialog dismissal and continued play with the browser offline. Phone browser emulation is not native Android evidence.

## Persistence behavior

The primary localStorage record contains the committed attempt, active arrows, mistake/assist state, first-clear ledger, best stars and coin balance. One key replacement commits them together. A separately preserved previous valid checkpoint can recover corrupted primary data; recovery explicitly reports that recent progress may need replaying. Invalid saves are not silently treated as verified progress. A write failure allows memory-only play and displays a warning.

Completion is committed before exit/result animation. Duplicate command IDs and stale attempt IDs are ignored. Selecting an already removed arrow is harmless. UI input is briefly gated during movement/feedback, so a rapid double tap is one action. Restart preserves first-clear progress but creates a new attempt ID. Replays cannot farm the 25-coin prototype reward. This is local progression, not tamper-resistant online authority.

## Dependency and environment evidence

Registry metadata was queried before installation; exact selected versions are in `package.json` and the root `pnpm-lock.yaml`. Runtime used: Node 25.1.0, pnpm 11.25.0. Vitest 4.1.12 was selected because the current Vitest 5 release excludes Node 25 in its supported engine range. Phaser 4.2.1, React 19.3.1, Vite 8.3.7 and Capacitor 8.6.0 passed this web build; native compatibility remains unverified.

Official capabilities consulted: [Phaser project templates](https://www.phaser.io/oss/docs/phaser/getting-started/project-templates), [Capacitor installation](https://capacitorjs.com/docs/getting-started), [Android environment setup](https://capacitorjs.com/docs/getting-started/environment-setup). No store-readiness or publishing-policy claim is made.

The root workspace install reported an unrelated missing ZETRO generated CLI binary. No ZETRO source was changed; AROWGO validation runs through its own package scripts.

## Known limits and next gate

- Rigid translation is proved internally against the written rule; the user still needs to judge whether this is the intended feel of the supplied still reference.
- The first-level art is original CSS scenery and vector geometry. The reference screenshots are not embedded in the game, and the UI is not a final art-production pass.
- Hint is unlimited for this prototype and marks Story results assisted. Analyze, Erase, world navigation, collections, backend services, audio and publishing are not implemented.
- Settings currently last for the page session. Unsupported save versions show recovery guidance; there is no older released schema requiring migration yet.
- The web page needs the server for an initial load; no PWA offline cold-start cache is claimed. Once loaded, gameplay makes no network requests. The native project bundles web assets, but native offline startup is untested.
- The Phaser bundle-size warning remains visible. Measure startup, input latency, frame times and repeated-load memory on the target phone before accepting performance or adding richer effects.
- Native Back/pause behavior, process-kill recovery, safe areas and real-device touch still require Android testing. Install the compatible JDK/SDK, build the generated project, and test on an actual phone before closing A04–A06 or Gate A in full.

No external player playtest or native release gate has passed. The delivered milestone is a tested browser mechanic proof and first playable, plus an Android project ready for toolchain setup.

## Visual inspection

Captured and inspected the first playable at 1440 px desktop width and 390 px phone width. The board and controls fit without horizontal overflow. These are browser captures, not Android device screenshots.

[Desktop capture](desktop.png) · [Phone capture](mobile.png)
