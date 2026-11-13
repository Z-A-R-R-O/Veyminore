# AROWGO — First Bloom

A playable bent-arrow puzzle under **Veyminore → InterFrozt**. Five playable levels, Home/Worlds/Modes/Shop/Profile pages and top-icon Settings, a focused puzzle view, and a nine-example Rule lab.

**Status:** Browser prototype implemented. Android project generated and synced; native build and physical-device validation pending. AROWGO remains a working name.

## Run locally

From the Veyminore repository root, with a compatible Node runtime and pnpm 11.25.0:

```powershell
pnpm install
pnpm --filter @veyminore/arowgo dev --port 4173
```

Open [AROWGO locally](http://127.0.0.1:4173). The tested host is Node 25.1.0; use a runtime that satisfies the pinned tooling's engine requirements. This game requires Node 22.12 or newer, which is stricter than the repository's historical Node 20 minimum.

## Play

Tap anywhere along an arrow to send it out with a flowing snake animation. Legality still checks the entire rigid swept path; another arrow anywhere in that path blocks the move. Clear every path. Story has three mistake hearts; Practice has unlimited mistakes. Hint reveals one legal arrow with a gentle breathing ring. Erase wipes a chosen arrow after confirmation. Both tools are free in this prototype and mark the result assisted. Restart asks before resetting your current run.

Keyboard: Tab to an arrow, then Enter. Open **Settings → Rule lab** to explore small clear/blocked examples, especially the bent-body obstruction. Settings includes persistent Rich/Subtle effects and reduced motion, respecting the system preference. Progress saves on this browser/device. The first Story clear of each level grants 25 prototype coins and unlocks the next level; replay does not repeat that reward.

## Checks

```powershell
pnpm --filter @veyminore/arowgo typecheck
pnpm --filter @veyminore/arowgo test
pnpm --filter @veyminore/arowgo lint
pnpm --filter @veyminore/arowgo exec playwright install chromium
pnpm --filter @veyminore/arowgo test:e2e
pnpm --filter @veyminore/arowgo build
```

`lint` currently checks formatting with Prettier; strict TypeScript provides static checking. Browser tests exercise desktop and emulated phone contexts. They do not replace real-device tests. No root-workspace-wide pass is claimed.

## Android preparation

```powershell
pnpm --filter @veyminore/arowgo android:sync
pnpm --filter @veyminore/arowgo exec cap open android
```

The native project is in `android/`. Install the compatible JDK and Android SDK/Studio before compiling. The current environment's Gradle attempt stopped because Java and `JAVA_HOME` were absent. Do not mark Android tested from successful asset sync alone. Follow the [verification report](docs/verification/first-playable.md) for the remaining device checks.

## Documentation

- [Current v0.1 prototype contract](docs/v0.1-prototype.md) — pages, all five levels, saves, animation and acceptance scope.

- [Motion and art approach](docs/motion-and-art.md)
- [Bloom motion verification](docs/verification/bloom-motion.md)

- [Rule proof and examples](docs/rule-proof.md)
- [First-playable evidence and limitations](docs/verification/first-playable.md)
- [Implementation decision](docs/decisions/0001-first-playable.md)
- [Masterplan](MASTERPLAN.md) and [documentation index](docs/README.md)
- [Build guide](docs/build-guide.md) and [execution backlog](docs/execution-backlog.md)
- [Original references](references/README.md)

**Owner:** Veyminore; product acceptance and named release ownership remain to be assigned. No network account, ads, real-money purchases, analytics SDK or server is implemented. The original reference images remain evidence; runtime scenery is original generated artwork; paths, icons and effects are drawn from code.

[Guest profile, shop and stable completion screens](docs/profile-shop-and-results.md).

[Crate shop and animated arrow collection](docs/crates-and-effects.md): current shop contract, 15 arrows, rarity odds and v2 profile migration.
