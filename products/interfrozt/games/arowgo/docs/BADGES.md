# Achievement badges

The 30 badges use the supplied `Colourful 3D Achievement Badge Collection.png` (1374 × 1145 RGBA), split row-major into a 6 × 5 grid of 229px WebP assets. Source transparency is retained. Names and requirements live in `src/storage/badges.ts` in sheet order.

Profile → Badges shows six items per page. Selecting an item reveals its requirement and current progress. Locked art is desaturated; earned art retains its color. The Journey overview uses matching artwork for First Bloom, Pathfinder and World Wanderer.

## Current behavior

24 badges derive their eligibility from existing saved campaign totals, world-specific clears, best stars, owned skins and the currently saved portrait frame. Existing progress qualifies automatically. These are derived achievements, not a separate permanent award ledger; Style Maker reflects the currently saved frame. No currency rewards or changes to save schemas are introduced.

Six badges remain explicitly marked Coming soon: Quick Thinker, Chain Reaction, Key Keeper, Lockbreaker, Treasure Finder and Comeback. Their required historical event counters are not available; the app does not invent retrospective awards. Chain Reaction additionally needs a defined supported mechanic before activation. Event tracking and permanent awards require a future versioned persistence/cloud-sync change.

Bloom Valley uses campaign slots 1–20 and Verdant Cove slots 21–40. Launch prestige targets remain fixed at 40 clears / 120 stars so adding future worlds does not move existing targets.

Validation covers threshold boundaries, world isolation, pending events, all 30 loaded assets, pagination, and four viewport sizes. No existing player save is modified by viewing badges.
