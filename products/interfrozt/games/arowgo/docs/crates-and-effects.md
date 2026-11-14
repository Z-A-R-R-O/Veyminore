# Crates, collection and arrow effects — 13 November 2026

This contract supersedes direct cosmetic purchases in `profile-shop-and-results.md`. The earlier shop screenshot is preserved at `references/2026-11-13-shop/before.png`.

## Player flow

Shop has Crates and Collection views. Each profile receives one free Bloom Crate. Paid crates consume earned game coins only; there are no cash purchases, trading, resale or cash-out. The five Story levels still award 25 coins on the first clear only (125 total). Replay and Practice do not farm coins. This finite prototype economy does not guarantee completion of the collection.

Select a crate, review its cost and rarity odds, then confirm. A horizontal reel moves beneath a fixed center pointer and decelerates over 5.2 seconds. It is inspired by the case-opening interaction requested by the user, with original AROWGO styling and assets. The winning arrow is fixed before the reel begins; visual neighbors have no influence on its outcome. There is no artificial near-miss placement. Skip animation and Escape reveal the already-saved reward immediately. Reduced motion skips the spin. Equip arrow applies the reward, or Keep in collection preserves the current equipment.

## Published odds

| Crate | Coins | Common | Rare | Epic | Legendary | Mythic | Duplicate refund |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bloom | 10 | 60% | 25% | 10% | 4% | 1% | 5 coins |
| Aurora | 20 | 30% | 40% | 20% | 8% | 2% | 10 coins |
| Celestial | 35 | 10% | 30% | 35% | 20% | 5% | 17 coins |

Rarity is selected first; items within the rarity are equally likely. Classic is the starter and never drops. Free-gift duplicates return zero coins. No pity counter or guaranteed rarity is implied. Odds appear in crate details and before confirmation.

## Collection (15 arrows)

| Rarity | Arrows | Visual effect |
| --- | --- | --- |
| Common | Classic, Mint, Coral, Moonstone | Classic is static; others have flowing highlights |
| Rare | Aurora, Blossom, Glacier | Flow plus coloured glow |
| Epic | Sunbeam, Nebula, Volt | Small moving spark highlights |
| Legendary | Phoenix, Starlight, Celestial Tide | Breathing aura and flowing light |
| Mythic | Eclipse, Prism | Colour-shifting spectral highlights |

Effects follow the actual SVG arrow paths, including curved snake movement. They do not alter collisions, hit areas, direction, damage, hints, rewards or level difficulty. Base colour remains fixed and readable. Hint colours remain distinguishable. Reduced Motion disables effect animations; Subtle effects disables glow/moving highlights. Collection supports rarity and owned filters; locked entries are preview-only and cannot be purchased directly.

## Persistence and migration

`src/storage/profile.ts` reads the existing `arowgo.profile.v1` storage key but writes version 2 records. The key stays stable so legacy profiles are discovered. A v1 record migrates its name, avatar, owned arrows and equipped arrow. The old fixed purchase costs (Classic 0, Aurora 25, Blossom 35, Sunbeam 50) become the initial `spent` ledger. A crate unlock never gets charged the old direct-purchase price.

V2 adds `spent`, `openings`, `welcomeClaimed` and `lastReward`. Balance is earned campaign coins minus `spent`. Opening calculates a reward using Web Crypto random samples and updates the ledger, ownership, opening count and receipt in one profile write. The animation starts only after the write succeeds. Failure leaves coins/ownership unchanged and the confirmation usable. Duplicate refunds reduce that transaction's cost. New arrows are not auto-equipped until requested.

Reloading or navigating away during a spin preserves the completed transaction; the Shop shows the last receipt. The reel cannot cause another charge. A synchronous opening guard prevents repeated confirmation clicks. This remains a local prototype: localStorage is not an authoritative server wallet, and multi-tab conflict resolution is not implemented. No paid currency is offered.

## Rendering and accessibility

`src/ui/Shop.tsx` owns crate art, previews, collection and reel presentation. Crates are original scalable SVG illustrations; existing scenery is preserved. The reel and generated preview strip are decorative. A native modal dialog provides focus containment and background inertness; semantic buttons, rarity labels and live status text support keyboard/screen-reader use. Reduced-motion users get immediate rewards. Dialog content and shop content can scroll inside their viewport on short screens; bottom navigation stays outside shop scrolling.

## Verification

Unit checks cover v1 migration, corrupt data, one free gift, affordability, duplicate math, published rarity boundaries and reachability of all 14 crate drops. Browser checks cover paid and free openings, saved rewards after refresh, storage failure, reel centering, collection filters, actual equipped arrow colours/effects, reduced motion, profile editing, stable completion and the five-level campaign. Final results and deployment are appended after verification.

Final local verification: 53 unit tests and all 16 affected browser cases passed across desktop and phone. All 15 arrows were rendered in gameplay in both browser projects. Additional 320×568 and 844×390 checks passed for modal bounds, reachable reward actions and Collection. Build, formatting and Android web-asset sync passed; native/physical-device testing remains separate. Captures: verification/crates-*.png.

Published at https://arowgo.vercel.app/#shop. Live phone verification completed a full crate reel, equipped Blossom, reloaded the saved reward and verified its glow effect in gameplay without page errors.
