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

## Spaced source replacement

Replaced all 30 portraits from the user's Spaced Fantasy Avatar Grid.png. The supplied RGB image had an opaque pastel backdrop. Used the built-in image_gen tool for background extraction with this prompt: "Background extraction only. Remove the pastel backdrop and top-left yellow light from this exact sprite sheet, replace all background with actual transparent alpha. Preserve exactly all 30 character portraits, appearance, order, scale, spacing, and the 6 columns by 5 rows layout. Do not add, redraw, rearrange, enlarge, merge or omit characters. Keep clean soft cutout edges and all ears/hats/accessories intact. Output single transparent PNG sprite sheet, same aspect ratio."

Cropped the transparent result into 6 x 5 equal cells and resized to 229px WebP, preserving the source padding instead of trimming or enlarging characters. Runtime files remain public/assets/avatars/adventure-01.webp through adventure-30.webp, preserving saved IDs. Removed the extra UI-gap override introduced by the earlier misunderstanding. Backgrounds, frames, currency and progress are unchanged.

## Spaced ring replacement

Replaced the thirty frame assets using the user's 30 Fantasy Frame Rings Collection.png. Source was RGB with white outside/inside the rings. Built-in image_gen background extraction prompt: "Background extraction only for this exact game asset sheet. Remove the white background outside every frame AND inside all thirty ring openings, replacing with genuine transparent alpha. Preserve all 30 frames, original artwork, colors, details, their exact order and 6-column x 5-row layout, scale and spacing. Preserve white feathers, fur, clouds, pearls and highlights belonging to the frames. No redrawing, rearranging, new objects, missing frames, shadows in openings or checkerboard. Output a transparent PNG with the same aspect ratio."

Runtime files stay public/assets/avatars/frames/frame-01.webp through frame-30.webp. Each 229px crop is centered on its ring rather than on the sheet's nominal grid, preserving saved IDs and the existing overlay component. No inventory, balance or profile-schema changes.

## Profile appearance layout audit

Replaced the accumulated picker overrides with a single bounded editor layout and shared category renderer. A live preview sits beside the name input; category tabs, a 12-slot grid, paging/Save footer and status each have defined space. Empty slots on the final page retain the same sizing as full pages. Framed portraits compensate for the padded source once (1.38x within the clipped circular opening); tile portraits use a restrained 1.22x presentation scale. Source assets are unchanged.

The same selection/save path serves all categories. Missing legacy avatar selections open the first character page. Added geometric browser checks for all categories at 320x568, 390x844, 844x390 and 1280x800, including visible preview, minimum tile size and footer bounds. Existing profile persistence, background and frame removal checks remain.

## Background removal and Settings shortcut

Removed Background from the editor, including all background previews. Saving appearance now sets avatarBackground to none; existing stored profile data is not silently rewritten on page load. Added a profile summary and accessible pencil button in Settings, linking to #profile/edit. The direct route opens the editor and survives reload. Old background assets/parsing remain for backward compatibility with existing saves.
