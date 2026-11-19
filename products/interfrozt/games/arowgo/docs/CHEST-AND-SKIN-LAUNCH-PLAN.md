# Chest tiers, rarity and 100-skin launch plan

Decision record: 14 November 2026.
Status: planned, except the current three-crate implementation and chest presentation described below. This document records the latest conversation decisions; it does not change live odds, prices or inventory. The final limited-pool table supersedes all earlier all-tier probability proposals. Astral's minimum drop is Epic, per the final correction.

## Product direction

Make every opening feel worthwhile through attractive skins, clear chest upgrades and useful duplicate outcomes. Common drops should dominate entry-tier openings, while higher chests improve both the minimum rarity and the chance of high-tier rewards. Use distinctive chest names rather than Common Chest or Rare Chest. Skin rarity names remain Common, Rare, Epic, Legendary, Mythic and Ethereal, in that order.

Ethereal is the new highest rarity above Mythic. It should be exceptionally scarce. Scarcity is separate from visual quality: every skin needs deliberate art direction, and expensive tiers must justify their cost through their eligible pool and probabilities.

## Final planned chest odds

Percentages are per opening for the rarity tier, not for each individual skin. A dash is a zero-probability, excluded tier. Each row totals 100%.

| Chest | Common | Rare | Epic | Legendary | Mythic | Ethereal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Glimmer | 85% | 13% | 2% | — | — | — |
| Radiant | 60% | 32% | 7.5% | 0.5% | — | — |
| Prismatic | — | 75% | 22% | 2.9% | 0.1% | — |
| Sovereign | — | — | 90% | 9% | 0.99% | 0.01% |
| Astral | — | — | 80% | 18% | 1.9% | 0.1% |

- Glimmer: entry chest, Common through Epic only.
- Radiant: Common through Legendary, with a better Rare/Epic rate.
- Prismatic: guarantees Rare or better, reaching Mythic.
- Sovereign: guarantees Epic or better; first access to Ethereal.
- Astral: also guarantees Epic or better, with stronger Legendary/Mythic/Ethereal odds than Sovereign. It does not guarantee Legendary.
- Ethereal is exclusive to Sovereign and Astral in this plan.
- All eligible skins within a selected rarity have equal probability unless a later explicit decision changes that rule. Classic remains the starter and is excluded from drops.

At these rates, an Ethereal tier drop averages one per 10,000 Sovereign openings or 1,000 Astral openings over many independent trials. These are expectations, not guarantees or a pity schedule. With two equally likely Ethereal skins, a particular one has a 0.005% Sovereign or 0.05% Astral chance per opening. No pity system has been approved.

## Chest appearance and opening language

All chest artwork should be front-facing, symmetrical and centered, with the clasp as the focal point. Produce matching closed and open states. Preserve the readable, polished mobile-game style and avoid flowers on universal reward assets.

| Chest | Proposed appearance | Proposed signature opening |
| --- | --- | --- |
| Glimmer | Polished copper with amber clasp | Clasp release and warm light |
| Radiant | Silver frame with blue crystal | Crystal pulse and clean light burst |
| Prismatic | Violet glass with shifting facets | Refracted light through the lid |
| Sovereign | Black enamel with heavy gold trim | Weighty vault unlock |
| Astral | Midnight shell with orbiting light | Floating shell separation |

Proposed background change: midnight navy with a soft blue spotlight, champagne-gold center pointer and high-contrast reward cards. The final reveal can adopt the winning rarity's accent. This replaces the dark purple opening panel shown in the reference. Final color tokens and five distinct chest assets still need implementation and visual review.

Preserve the case-opening rhythm: anticipation, chest opening, fast reel, smooth deceleration, exact landing, then a larger reward reveal. Do not invent a near-miss outcome independent of the saved reward. Keep Skip, keyboard access and reduced-motion behavior. Show the exact drop pool and odds before spending coins. Keep all rewards cosmetic and preserve puzzle readability.

## 100-skin launch catalog

Working allocation: 100 total skins including the existing Classic starter, giving 99 droppable skins. Retain current skin IDs and ownership; improve existing designs where appropriate rather than adding 100 on top of the current 15.

| Rarity | Total skins | Droppable skins | Quality direction |
| --- | ---: | ---: | --- |
| Common | 35 | 34 | Distinct palettes, patterns and polished finishes |
| Rare | 25 | 25 | Recognizable material treatments and edge details |
| Epic | 20 | 20 | Animated textures and restrained trails |
| Legendary | 12 | 12 | Signature motion and clear effects |
| Mythic | 6 | 6 | Elaborate coordinated effects |
| Ethereal | 2 | 2 | Bespoke animated materials and reveal sequences |
| Total | 100 | 99 | Every design requires gameplay review |

This allocation is the working proposal, not a completed asset list. Names, individual concepts and final art are not yet authored. A proper skin must have a documented concept, stable ID, rarity, palette/material, behavior at rest and during movement, and reduced-motion appearance. Cosmetic effects must not hide direction, bends, blockers, key/lock badges or focus indicators. Test on the smallest supported phone and dense late-game boards. Distinguish skins through material, pattern and motion rather than filling the catalog with superficial recolors. Maintain the same collision geometry for every skin.

Approve a representative batch across all six tiers before producing the full catalog. Review inventory previews, reel cards and actual gameplay together. Establish performance budgets for particles, texture sizes and simultaneous animations before expanding production.

## Economy and opening value

The current campaign provides 500 first-clear coins total, at 25 per Story clear. Current coins are earned in-game; there are no cash purchases. This finite supply is insufficient for a long-term 100-skin collection with very rare top-tier drops. Resolve repeatable earning before launch, such as daily puzzles or defined mastery rewards. The source, frequency, caps and reward values remain undecided.

Proposals requiring balancing:

- Keep a duplicate coin refund and add collection shards toward a chosen Common–Epic skin.
- Give fixed collection milestone rewards so opening progress is useful even when the drop is familiar.
- Set chest prices alongside earning rates, not in isolation. No prices for the five new tiers are agreed yet.
- Simulate sessions-to-first-opening, saving time for each tier, new-skin rates as ownership grows, duplicate returns and expected collection progress.
- Compare the higher chest's guaranteed pool and increased odds with its additional cost. Higher tier names alone must not imply better value.

Do not change refunds, add shards or promise a guaranteed rare drop until the exact rules are chosen and documented. The approved odds above are the planning baseline; any later balancing change should be explicit and versioned.

## Current implementation versus planned work

Already implemented:

- 15 skins including Classic, five rarity tiers through Mythic.
- Bloom, Aurora and Celestial crates at 10, 20 and 35 coins.
- Current live tier odds: Bloom 60/25/10/4/1; Aurora 30/40/20/8/2; Celestial 10/30/35/20/5, ordered Common through Mythic.
- A free welcome Bloom opening; paid duplicates refund half the crate price, rounded down. Welcome duplicates refund no coins.
- Generated front-facing purple/gold closed and open chest assets, recolored for the three existing themes.
- A 1.2-second chest sequence, 5.2-second decelerating reel and large reward preview; dark-purple opening panel.
- Outcome saved before animation, exact reel landing, Skip, reduced motion and collection/equip actions.

Planned, not implemented by this document:

- The five uniquely named chest tiers and restricted pools above.
- Ethereal rarity, 100-skin catalog, midnight-navy opening background and five distinct chest designs.
- New earning sources, shards, milestone rewards and revised pricing.

Implementation references: `src/storage/profile.ts`, `src/ui/Shop.tsx`, `src/ui/chests.css`, and `public/assets/chests/README.md` (generated artwork prompts and provenance).

## Migration and data requirements

Preserve owned skins, equipped skin, coin accounting, opening count, welcome-claim status and last saved reward. Existing profile versions and historical crate IDs must remain readable. Do not reinterpret an old purchase using a new price or drop table. Decide the mapping or retirement policy for Bloom/Aurora/Celestial before changing their IDs.

Use a versioned catalog and chest configuration. Display probabilities from the same source used by the draw. Represent the final table in integer units (10,000 units per 100% accommodates the smallest 0.01% chance). Select a rarity first, then an eligible skin; zero-weight tiers must never be selected. Reject invalid sums, negative weights and positive-weight empty pools. A partial art rollout must not silently substitute lower-tier drops for unavailable higher-tier content.

Reward persistence remains atomic and precedes presentation. Double-clicks, Skip, reload and closing the dialog must not spend twice, reroll, lose the reward or duplicate a refund. Preserve previously saved outcomes through catalog updates.

## Implementation sequence and acceptance

1. Foundation: add the six-tier model, five versioned chest configurations, exact odds display and profile migration. Validate boundary draws, sums and eligible pools. Keep unfinished content out of the live catalog.
2. Visual approval: midnight-navy background, one representative chest and a small skin batch spanning all tiers. Approve phone, landscape and desktop presentation.
3. Catalog production: expand to 100 reviewed skins and all five matching chest designs. Remove hard-coded collection counts. Audit IDs, assets and descriptions.
4. Economy: choose repeatable earnings, chest prices, duplicate/shard rules and milestone rewards; simulate progression before enabling the new economy.
5. Release checks: save migration fixtures, reward persistence, probability boundaries and distribution sanity checks, exact reel alignment, input/focus behavior, reduced motion, readable dense puzzles and device performance.

Rare outcomes need deterministic boundary tests; a short random simulation cannot prove a 0.01% probability is implemented correctly. Simulations supplement those tests and evaluate player progression, not just drop frequency.

## Earlier ideas retained for later consideration

Themed chests previously explored: Bloom (jade/lacquer), Aurora (ice/light), Celestial (stars), Forge (metal/obsidian), Abyss (ocean/bioluminescence), Arcade (neon/circuitry), Relic (runes/stone), and an Ethereal Vault. These are concept references for future themed collections, not the agreed launch chest-tier lineup. An Ethereal-themed chest name would not itself promise an Ethereal drop.

Other proposed reward formats: Discovery Chest (unowned Common or Rare), Choice Chest (choose one of three revealed skins), Mastery Chest (fixed objective reward), and seasonal collections with a visible return schedule. These are optional future concepts; costs, selection rules, pool-exhaustion behavior and implementation are not approved.

Superseded proposals: allowing every rarity in every chest, the early 0.001% Glimmer Ethereal chance, and Astral guaranteeing Legendary. The final table in this document is authoritative for the current plan.

## Subsequent gem currency implementation

The user subsequently requested gems for both chests and gameplay boosters. See GEMS-AND-BOOSTERS.md for the implemented starter wallet, current three-crate gem prices and Time Boost. This supersedes the cosmetic-only scope for currency spending, while chest drops themselves remain cosmetic. The five planned chest tiers and 100-skin expansion remain unimplemented. No real-money checkout is active.
