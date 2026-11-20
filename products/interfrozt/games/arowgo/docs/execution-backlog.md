# Execution backlog

Updated 20 November 2026. [Gap register](GAME-EXPERIENCE-GAPS.md) owns open acceptance criteria; [current state](CURRENT-GAME-STATE.md) owns implemented behavior.

## Next: production account and ledger infrastructure

See [production deployment guide](DEPLOYMENT-PRODUCTION.md) for live architecture, Vercel SPA packaging, and development backend boundaries.

1. Deploy production-grade account service (migrating from localhost-only HTTP on port 4174).
2. Provision managed persistence for server wallet, idempotent clear receipts, and session tokens (replacing local development SQLite).
3. Establish operational runbooks: automated backups, tested ledger recovery, rate limiting, and observability.
4. Add client retry policies and network resilience against live PlayFab / cloud outages.

## Following work

- Account continuity beyond completed-board restore, with explicit conflict policy and appearance sync.
- Human playtesting and physical-device release acceptance (touch targets, thermal stability, 60 FPS, safe areas).
- Release regression, performance, formatting and rights/privacy checks (audio provenance, generated art rights).
- Collection expansion after economy/design review (5 chest tiers, 100 skins); multiplayer remains later work.

## Delivered milestones

- **Full-history cloud capacity**: Multi-chunk PlayFab object envelope supporting realistic 100-level UUID transcripts, backups, and migration archives up to 150 KB packed / 512 KiB raw, with atomic commits under `ExpectedProfileVersion`, previous-generation rollback preservation, and corruption rejection. Verified in `tests/cloud-capacity.test.js` and `tests/sanctum.test.ts`. See [cloud recovery guide](CLOUD-SAVE-RECOVERY.md).
- **100-level campaign & dense late boards**: 100 levels across 5 worlds (Bloom Valley, Verdant Cove, Frostfall Peaks, Amber Dunes, Amber Sanctum); snake movement v2, keys & locks, anchors, ice seals, phase gates, removal-count countdowns.
- **Reviewed account wallet & restore**: SQLite server ledger, idempotent first-clear rewards (2,500 coins total), second-device completion reconstruction, Google OIDC token exchange (`google-web`), and isolated live PlayFab entity probes.
- **Hold preview & presentation**: 400ms neutral hold inspection, 30 avatars, 30 frames, 15 arrow skins, 3 crate tiers, Satoshi typography, and purple arrow-v4 branding.
- **Comprehensive documentation suite**: 10 new/updated guides covering cloud recovery, deployment, generator v4, mechanics, level register, currency flows, release checklist, asset catalog, test coverage, and changelog.
