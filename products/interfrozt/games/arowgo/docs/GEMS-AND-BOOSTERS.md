# Gems and gameplay boosters

Implemented 14 November 2026 as a local prototype currency. Gems buy existing cosmetic chests and the first gameplay advantage, Time Boost. Real-money gem purchases are not implemented. Before enabling payments, authoritative balances, verified receipts, idempotent fulfillment and account recovery must replace browser-only currency authority.

## Current values

- New and migrated profiles begin with zero gems.
- Shop offers a one-time 20-gem starter gift, saved with a claim flag.
- Existing Bloom / Aurora / Celestial crates can use either their original coin price or 1 / 2 / 4 gems. These are provisional prototype prices, not the prices for the five planned launch chest tiers.
- Duplicate gem purchases refund half the gem price rounded down, in gems. Coin spending is untouched by gem purchases. The saved reward records its payment currency; historical rewards default to coins.
- Time Boost costs 3 gems and adds 30 seconds to the current Story attempt's speed-star target. Buy it in puzzle Settings. It is available once per attempt, only for playing attempts using the current scoring system. Restarting creates a new attempt without the boost. Mistakes and elapsed time are retained; the attempt is marked assisted. Current scoring still allows assisted attempts to earn the speed star.
- Hint and Erase remain free. Extra hearts and other boosters have not been implemented.

## Persistence

Profile schema version 2 is extended additively with `gems`, `gemGiftClaimed` and `timeBoosts`. Old profiles missing these fields default to zero gems, an unclaimed gift and an empty receipt list. Existing inventory, equipped skin, coin spend, opening count and historical reward are preserved. Invalid gem balances and malformed/duplicate receipt IDs are rejected.

Crate spending and outcome are saved in the same profile update before animation. Skip, reload and failed writes follow the existing safe opening contract. The gift is only acknowledged when saved.

Time Boost purchases save the gem deduction and attempt-ID receipt together before applying the session change. Reapplying a receipt is idempotent. On profile load the app reconciles receipts with current campaign controllers, allowing recovery if the profile write succeeded but the session write failed. The session records `timeBoost` and validates the target as the base target plus exactly 30 seconds. An old receipt cannot boost a new attempt. A replaced campaign layout starts a new attempt under the existing migration policy.

## Verification and release work

Tests cover old-profile defaults, one-time gift, isolated gem spending/refunds, insufficient balances, one purchase per attempt, boost reload and restart behavior. Browser coverage claims gems, buys a gem chest, uses Time Boost, reloads, and checks balances. Launch still requires pricing/earning balance, further booster design, server authority and payment integration if gems become purchasable.

## Generated asset

`public/assets/currency/gem.png`, generated with built-in image_gen, preserving transparency. Shared by hub balance, Shop wallet, chest purchase buttons and Time Boost.

Exact prompt:
"One premium currency gem icon for a polished mobile puzzle game: luminous cyan aquamarine faceted gemstone, symmetrical front-facing hexagonal jewel with pointed lower tip, rich teal edges and icy white highlights, thick readable silhouette, soft rounded bevels, playful luxurious 3D game render matching glossy gold coins and violet chests. Single gem centered with generous margin. True transparent background, no text, no coin frame, no scenery, no particles outside silhouette. Crisp readable at 24 pixels."
