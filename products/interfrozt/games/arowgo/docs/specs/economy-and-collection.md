# Economy, cosmetics and monetization

Imported baseline · Source masterplan 2.1 · Organized 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page preserves source sections 7, 11. Original section numbers are retained for traceability. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 7. Arrow skins and customization

## 7.1 Collection philosophy

Cosmetics should increase emotional attachment without changing puzzle difficulty.

A skin may change:

- Path material.
- Arrowhead style.
- Colour treatment.
- Exit trail.
- Clear animation particles.
- Optional sound accent.

A skin must never obscure the path, change hitboxes or give a competitive information advantage.

## 7.2 Collection categories

| Collection | Visual concept |
|---|---|
| Classic | Dark navy path |
| Candy | Soft pink and pastel |
| Neon | Controlled luminous outline |
| Gold | Warm metallic treatment |
| Crystal | Translucent glass material |
| Nature | Leaf-inspired accents |
| Galaxy | Starfield and violet accents |
| Seasonal | Festival, winter and limited-time themes |

## 7.3 Rarity

Suggested presentation labels:

- Common
- Uncommon
- Rare
- Epic
- Special

Rarity is a collection label, not a promise of value or resale.

Avoid paid random loot boxes. Use clear unlock conditions and direct purchase options where appropriate.

## 7.4 Unlock routes

- Campaign milestones.
- Star milestones.
- Daily challenge streaks.
- Achievement completion.
- Event participation.
- Earned coins.
- Direct cosmetic purchase.
- Optional rewarded ad for a clearly disclosed temporary trial, if testing shows value.

## 7.5 Collection screens

Collection screen should include:

- Category tabs.
- Owned / locked state.
- Preview before equipping.
- Equip button.
- Unlock condition.
- Cosmetic set completion.
- Search/filter only when the inventory becomes large.

A player must always be able to preview the skin in the actual gameplay board.

# 11. Monetization and economy

## 11.1 Revenue model

Potential revenue streams:

1. Rewarded video ads.
2. Conservative interstitial ads at natural breaks.
3. Optional ad-free purchase.
4. Direct cosmetic purchases.
5. Cosmetic bundles or theme packs.
6. Event cosmetics.

Do not launch all monetization at once. Introduce one system at a time and measure retention impact.

## 11.2 Advertising placement

### Rewarded ads

Possible rewards:

- One extra hint.
- A temporary cosmetic trial.
- A disclosed coin reward.
- A retry after a failed run, if testing supports it.

The user must opt in. Reward delivery must be clear and reliable.

### Interstitial ads

Only at natural breaks, such as after a completed level or result screen.

Never place a full-screen ad:

- At app launch.
- Before the level begins.
- During active puzzle solving.
- Immediately after a tap when the player expects an action.
- In a location that causes accidental clicks.

Start with conservative frequency and a cooldown. Reduce frequency if retention or satisfaction deteriorates.

Google Play's Ads policy prohibits unexpected disruptive full-screen ads and gives examples of disallowed placements during gameplay or at the start of a level.

Reference: https://support.google.com/googleplay/android-developer/answer/9857753

## 11.3 Digital purchases

If the Play-distributed app sells digital goods or in-app functionality, Google Play Billing generally applies unless a documented policy exception is relevant.

Reference: https://support.google.com/googleplay/android-developer/answer/9858738

Verify the current policy before implementing checkout. Do not hard-code assumptions about regional billing programmes.

## 11.4 Currency rules

- Coins are earned through gameplay and disclosed rewards.
- Paid currency, if ever introduced, must be handled through compliant billing.
- Wallet changes use a transaction ledger.
- No negative balances.
- Prevent duplicate reward claims.
- Avoid expiring paid currency.
- Do not make cosmetics or hints necessary to complete the campaign.
- Ranked mode must not be pay-to-win.

## 11.5 No paid random loot boxes

Use transparent purchases and earned unlocks. Avoid random paid reward mechanics in the first product.

## 11.6 Unit economics

Track:

- Daily active users.
- Ad impressions per active user.
- Realized eCPM.
- Rewarded-ad opt-in and completion.
- Revenue per DAU.
- Cosmetic conversion.
- Purchase refunds.
- Platform fees.
- Hosting and service costs.
- User acquisition cost, if paid acquisition is later used.
- Cohort retention.

Formula:

`Estimated ad revenue = (monetized impressions / 1,000) × realized eCPM`

Revenue estimates are not cash received. Keep actual payments, fees, taxes and refunds separate.
