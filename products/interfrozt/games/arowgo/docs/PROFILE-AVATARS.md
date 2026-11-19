# Adventure profile avatars

Added 2026-11-19 from the user-supplied `Thirty Whimsical 3D Adventure Avatars.png` (1374 x 1145 RGBA). The sheet has six columns and five rows of 229 x 229 pixels. Each cell was cropped without AI regeneration and encoded as WebP quality 90, preserving alpha. All 30 files total about 739 KiB.

Files: `public/assets/avatars/adventure-01.webp` through `adventure-30.webp`, in reading order. Names and stable IDs are defined in `src/storage/avatars.ts`. Avoid renaming these IDs once saves reference them.

The Profile editor displays six portraits per page plus the three legacy choices on the final page. Selection is previewed before Save. Existing world/modes/trophy selections remain valid; no automatic replacement or currency changes. Profile schema version stays 2, with expanded avatar validation. Account restores still treat name/avatar as device-local, as documented in SERVER-ECONOMY.md; this change does not introduce cross-device avatar sync.

Verification covers all avatar IDs round-tripping without changing gems or inventory, all image pages loading, first/last character persistence, and phone/landscape/desktop layout.

## Avatar backgrounds

Added the user-supplied Fantasy Gradient Background Grid.png (1448 x 1086), split into 4 x 3 cells of 362 pixels. Each tile is downsampled to 256 x 256 and encoded as WebP quality 88 under public/assets/avatars/backgrounds. Names and stable IDs live in src/storage/avatar-backgrounds.ts.

Edit profile now has Avatar and Background categories with composited previews. All 12 backgrounds plus Original are available without currency charges. Save commits both selections together; previewing does not write. Existing version-1/version-2 profiles default the new avatarBackground field to none. Unknown background IDs fall back to none without discarding balances or inventory. Frames will be integrated separately when supplied. Name, avatar and background remain device-local for account-wallet users.

## Avatar frames

Added all 30 frames from the user-supplied Ornate Fantasy Avatar Frame Collection.png (1374 x 1145 RGBA). Cropped the six-column, five-row sheet into 229px square cells and encoded as WebP quality 90 with alpha preserved. No generated replacement artwork was used.

Stable IDs and names: src/storage/avatar-frames.ts. Assets: public/assets/avatars/frames/frame-01.webp through frame-30.webp. Frame overlays render above a circular portrait/background inset by 18% to fit inside the opening. The Frame category previews six at a time; No frame is available on the final page. Save writes avatar, background and frame together. All options are free; no economy changes.

Old saves and unknown frame IDs safely default avatarFrame to none without resetting other fields. Frames remain device-local alongside the other profile appearance selections. Tests cover every frame ID, all image loads, save/reload, background coexistence and frame removal.

## Multi-row picker update

Appearance categories now show twelve options per page: four columns and three rows on taller phones, six columns and two rows on desktop and compact screens. Avatar/Background/Frame use equal-width segmented controls, a purple active state, and selection checkmarks on tiles. Paging and explicit Save remain; no save format or economy changes.

Portrait positioning correction: recropped the source using artwork row boundaries 0/242/466/694/914/1145 instead of nominal 229px rows, inset horizontal edges by 8px, and centered each cutout on a 229px transparent canvas with padding. This removes neighboring-row fragments. Tiles use grid centering; paging and Save share a consistent footer baseline.
