# Adventure profile avatars

Added 2026-11-19 from the user-supplied `Thirty Whimsical 3D Adventure Avatars.png` (1374 x 1145 RGBA). The sheet has six columns and five rows of 229 x 229 pixels. Each cell was cropped without AI regeneration and encoded as WebP quality 90, preserving alpha. All 30 files total about 739 KiB.

Files: `public/assets/avatars/adventure-01.webp` through `adventure-30.webp`, in reading order. Names and stable IDs are defined in `src/storage/avatars.ts`. Avoid renaming these IDs once saves reference them.

The Profile editor displays six portraits per page plus the three legacy choices on the final page. Selection is previewed before Save. Existing world/modes/trophy selections remain valid; no automatic replacement or currency changes. Profile schema version stays 2, with expanded avatar validation. Account restores still treat name/avatar as device-local, as documented in SERVER-ECONOMY.md; this change does not introduce cross-device avatar sync.

Verification covers all avatar IDs round-tripping without changing gems or inventory, all image pages loading, first/last character persistence, and phone/landscape/desktop layout.
