# AROWGO

A mobile-first snake-arrow puzzle game. Current development status: **20 November 2026**, 100 campaign levels across five chapters. This is a development preview, not a production launch certification.

## Start here

- [Current game state](docs/CURRENT-GAME-STATE.md): shipped behavior and service boundaries.
- [Documentation index](docs/README.md): feature guides and historical records.
- [Build guide](docs/build-guide.md): commands and verification scope.
- [Open gaps](docs/GAME-EXPERIENCE-GAPS.md) and [delivery backlog](docs/execution-backlog.md).
- [Latest verification record](docs/AUDIT-2026-11-20.md).

## Run locally

Use Node 24 or newer and the workspace pnpm lockfile. From this game directory:

```powershell
pnpm dev --port 4173
```

Open http://127.0.0.1:4173 for local gameplay. For account testing, run `pnpm account:server` and `pnpm account:web` in separate terminals and use http://localhost:4173. See [account setup](docs/ACCOUNT-SETUP.md). These origins have separate browser saves; keep the same origin when checking existing progress.

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright test
```

## Campaign and rules

Bloom Valley 1–20, Verdant Cove 21–40, Frostfall Peaks 41–60, Amber Dunes 61–80 and Amber Sanctum 81–100. First clears award 25 coins once per level: 2,500 total and up to 300 stars. Stars independently reward completion, zero mistakes and meeting the time target.

Arrows exit head-first and their bodies follow like a snake. Keys, anchor prerequisites, ice, phase gates and removal-count deadlines add ordering decisions. Story has three hearts; Practice allows unlimited mistakes but still respects mechanic deadlines. Hold inspection explains the immediate board state without revealing a winning move.

## Save and service boundaries

Legacy gameplay saves remain local. Optional development Google/PlayFab sign-in, multi-chunk cloud snapshot sync (supporting full 100-level histories up to 150 KB packed / 512 KiB raw), and server-wallet persistence are implemented. Production account infrastructure provides durable SQLite session management, sliding-window rate limiting, automated ledger backups, invariant verification, and health probes. See [account services](docs/ACCOUNT-SERVICES.md), [account continuity](docs/ACCOUNT-CONTINUITY-AND-CONFLICTS.md), [production infrastructure](docs/PRODUCTION-ACCOUNT-INFRASTRUCTURE.md), [cloud recovery guide](docs/CLOUD-SAVE-RECOVERY.md), [production deployment guide](docs/DEPLOYMENT-PRODUCTION.md) and [server economy](docs/SERVER-ECONOMY.md).

**Open gates:** Physical-device hardware testing (touch targets, thermal stability, 60 FPS), production hosting provisioning, asset rights review, and human playtest difficulty calibration remain open launch gates. See [open gaps](docs/GAME-EXPERIENCE-GAPS.md).
