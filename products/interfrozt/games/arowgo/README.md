# AROWGO

A mobile-first snake-arrow puzzle game. Current development status: **27 November 2026**, 140 campaign levels across six chapters. This is a development preview, not a production launch certification.

## Start here

- [Current game state](docs/CURRENT-GAME-STATE.md): shipped behavior and service boundaries.
- [Documentation index](docs/README.md): feature guides and historical records.
- [Build guide](docs/build-guide.md): commands and verification scope.
- [Open gaps](docs/GAME-EXPERIENCE-GAPS.md) and [delivery backlog](docs/execution-backlog.md).
- [Latest verification record](docs/AUDIT-2026-11-27.md).

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

Bloom Valley 1–20, Verdant Cove 21–40, Frostfall Peaks 41–60, Amber Dunes 61–80 , Amber Sanctum 81–100 and Clockwork Citadel 101–140. First clears award 25 coins once per level: 3,500 total and up to 420 stars. Stars independently reward completion, zero mistakes and meeting the time target.

Arrows exit head-first and their bodies follow like a snake. Keys, anchor prerequisites, ice, phase gates and removal-count deadlines add ordering decisions. Story has three hearts; Practice allows unlimited mistakes but still respects mechanic deadlines. Hold inspection explains the immediate board state without revealing a winning move.

## Save and service boundaries

Legacy gameplay saves remain local. Optional development Google/PlayFab sign-in and revision-checked cloud snapshots are implemented. A separate reviewed account-wallet preview uses a server SQLite ledger; it is not PlayFab Economy or a production deployment. Account-wallet mode pauses legacy snapshot uploads. See [account services](docs/ACCOUNT-SERVICES.md) and [server economy](docs/SERVER-ECONOMY.md).

**Open blocker:** realistic full-campaign histories exceed the cloud packer's 10,700-byte limit. Oversized uploads fail without trimming local progress or currency. Full-history cloud sync is not certified. Physical-device acceptance, production operations, rights review and human difficulty testing also remain open.
