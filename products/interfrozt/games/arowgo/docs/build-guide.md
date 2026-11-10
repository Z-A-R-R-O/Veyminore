# AROWGO build guide

> Current implemented scope: [v0.1 prototype](v0.1-prototype.md). The one-level steps below describe the original foundation; five-level campaign persistence and routing are now implemented.

Working implementation plan · 10 November 2026 · [Masterplan](../MASTERPLAN.md) · [Backlog](execution-backlog.md)

## Outcome first

The first deliverable is one original level that runs on an Android phone, explains a blocked move, clears correctly, resumes after interruption and grants completion exactly once. A web prototype makes iteration easy; an Android build is part of the first slice, not a late porting exercise.

## Candidate stack and boundaries

| Area | Starting candidate | Responsibility |
| --- | --- | --- |
| Rules | Pure TypeScript | Integer geometry, collision, move resolution and solution validation |
| Gameplay | Phaser | Render domain state, hit testing, feedback and animation |
| Screens | React + CSS | Menus, navigation, accessible controls and results |
| Tooling | Vite | Development server and production web build |
| Android | Capacitor | Native project, lifecycle and device integration |
| Persistence | Local storage adapter; evaluate IndexedDB transactions | Versioned snapshots, progression and reward receipts |
| Verification | Vitest and Playwright candidates | Domain cases and browser interaction flows; physical Android checks remain separate |

Phaser provides official framework templates including React/Vite; Capacitor supports web applications on native platforms. Official documentation reviewed for these capabilities on 10 November 2026: [Phaser templates](https://www.phaser.io/oss/docs/phaser/getting-started/project-templates), [Phaser project creator](https://phaser.io/tutorials/create-game-app), [Capacitor overview](https://capacitorjs.com/docs). This review does not certify any exact dependency version, compatibility combination or phone performance. Resolve versions and engine prerequisites during A04 and commit the lockfile.

Keep React and Phaser behind one application controller. React owns navigation; Phaser owns the gameplay scene. Neither directly edits saved progress. Domain functions receive plain data and return plain results without framework imports. If the React/canvas bridge introduces unacceptable lifecycle or performance problems, document a Phaser-only shell decision before adding more screens.

## Small initial structure

```text
games/arowgo/
  package.json          # Add when scaffolding starts
  src/
    domain/             # Geometry, checker, moves, solver
    application/        # Commands and state transitions
    game/               # Phaser scene, input, renderer
    ui/                 # React screens and navigation
    storage/            # Versioned local persistence adapter
  content/levels/       # Authored data and known solutions
  public/assets/        # Original/cleared production assets
  tests/
  android/              # Add during first device spike
  docs/
  references/           # Evidence only, excluded from runtime assets
```

This layout is now implemented for the first playable, including the generated Android project. See the game README for actual commands and the verification report for remaining gates. Start with one game package; extract reusable packages only when a concrete dependency needs them. Do not create the source plan's entire apps/packages/backend tree in advance.

## Repository integration when implementation begins

Use the existing Veyminore repository and root pnpm lockfile. The `products/interfrozt/games/*` glob is now present in `pnpm-workspace.yaml`. Use a private package such as `@veyminore/arowgo`; retain the root package-manager convention. Check runtime versions against all selected build tools before installation rather than assuming the root minimum is sufficient.

Scaffold into the existing game directory carefully: preserve documentation and references, review generated files before replacing any file, and do not initialize a nested Git repository. Add game `dev`, `build`, `test`, `typecheck` and `lint` scripts when there is code to run. Actual commands are documented in the game README. Keep the game build independent of unrelated product failures while reporting root-workspace failures accurately.

## Build sequence and gates

1. **Rule proof (A01–A03):** draw 5–10 tiny boards; write expected outcomes; implement a slow independent swept-footprint checker; demonstrate clear and blocked movement. Include a body-only obstruction with a clear head ray. Agree rigid translation versus an alternative before content expansion.
2. **One-level slice (A04–A06):** select/pin compatible dependencies, render one original level, add restart/results and transactional local save. Run on Android and record device/build/version. Rapid taps and interrupted animations cannot duplicate actions or rewards.
3. **Visual pass:** apply blossom scenery, lavender surfaces, crisp paths and controlled motion to that working level. Use separate backgrounds, icons and live text. Do not ship screenshot-sized images as functional UI. Record asset provenance and measure device performance after adding effects.
4. **Tutorial alpha (A07–A10):** define hearts/tools/scoring, build about 10 reviewed levels and functional Home/World/Profile/Results/Settings screens. Add a minimal level previewer. Observe new players without coaching.
5. **Campaign MVP (A11–A12):** expand to 30–40 levels only after validation. Review every board's no-assist solution, small-screen readability, save behavior and difficulty. Fix blockers before public-release work.
6. **Evidence-led expansion (A13+):** earned cosmetics, additional content, bounded procedural generation and later daily/async systems. Each online or paid feature needs its own operating and release evidence.

## First-slice acceptance contract

- All four directions and bent paths are represented in rule fixtures; geometry errors are rejected.
- Renderer movement and collision use the same rule version.
- Legal removal changes state once; blocked input preserves occupancy and changes the permitted counters once.
- Restart creates a new attempt ID. Resume restores the committed active-arrow set and counters.
- Completion persists its result/reward receipt atomically; animation and duplicate input cannot grant it again.
- Tests cover closing the app before, during and after completion persistence. Keep a known-good snapshot; corrupted or incompatible data produces a recoverable message instead of a silent wipe.
- Android back, background/resume, resize/insets and offline cold start are exercised on a real phone.
- Record launch time, input feedback, frame times and repeated-load memory with the device/build. Set budgets from the measured baseline before the visual pass; a desktop run cannot satisfy the Android gate.

## Save and reward semantics to specify before A06

Persist schema/rules/content versions, attempt ID, active arrows, mistakes, tool use, completion state and reward receipt IDs. Commit attempt and progression changes in one transaction where supported. Otherwise design and test an explicit recovery protocol. Do not distribute one logical reward across unrelated storage writes.

Proposed default: campaign completion coins are a first-clear reward per level; replays can improve best stars without repeating that reward. A result receipt deduplicates retries within an attempt, and a first-clear ledger prevents replay farming across attempts. Practice grants neither campaign rewards nor campaign stars. Amounts, tool allowances and any later replay rewards remain balancing decisions. Device-local saves are not authoritative ranked or purchase records.

## Art and interaction checklist

Use original level geometry. Preserve the visual mood, not accidental numbers or mockup defects. Keep arrowheads and hit regions readable on the smallest target device. Test glow, blur, particle density, text scaling and reduced motion. Add empty, failure, pause, tool-confirmation and save-recovery states alongside the happy path.

## Git and delivery

Git is already initialized at the Veyminore root. InterFrozt and AROWGO are tracked inside that repository. Make focused branches and commits; exclude secrets, dependencies, build outputs and local device caches. Commit authored content and provenance records. Once tooling exists, run the changed game's relevant checks and record actual results before merging. Remote publication and branch protection are separate setup actions, not established by a local commit.
