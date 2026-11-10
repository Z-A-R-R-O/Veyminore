# Guest profile, cosmetic shop and stable results

Implemented 10 November 2026. This amendment supersedes earlier v0.1 notes that excluded a shop or placed Settings in bottom navigation.

## Navigation and presentation

Bottom tabs: Home, Worlds, Modes, Shop, Profile. Settings is a labelled icon at the top right. Gameplay retains its top Settings icon and no bottom tabs. `#progress` remains an alias for `#profile`. The valley imagery, `Scenery.tsx`, ambient particles, drift animations and motion preferences are unchanged. Pale surfaces behind the level/world heading, top controls and feedback improve contrast over the existing scene.

## Guest profile

Every new device starts with **Guest**, the island avatar, Classic arrows and no purchases. Profile supports a trimmed display name up to 20 characters, three generated-art avatars, Save feedback, and real campaign statistics. A blank name saves as Guest. This is a local guest profile, not authentication: no passwords, signup, network account or cloud sync.

`arowgo.profile.v1` stores `{version:1,name,avatar,owned,equipped}`. Load validates version, name length, avatar, known/unique owned items, Classic ownership and equipped ownership. Invalid data falls back to Guest. Profile saves and purchases update the UI only after localStorage succeeds; errors are shown without spending coins.

## Cosmetic shop

| Item    |           Price | Arrow colour         |
| ------- | --------------: | -------------------- |
| Classic |            Free | Original dark violet |
| Aurora  | 25 earned coins | Deep teal            |
| Blossom | 35 earned coins | Berry pink           |
| Sunbeam | 50 earned coins | Warm amber           |

Buying requires confirmation; Cancel does nothing. Insufficient balances disable purchase with the missing amount. A successful purchase atomically saves ownership and equips the item. Owned items can be equipped freely. Duplicate purchases do not spend again. Colours change only the base SVG arrow body/head; Hint emphasis and mechanics are unchanged. The shop contains no real-money purchases, crates, chance rewards or boosts.

The campaign's validated per-level first-clear ledgers remain unchanged. Lifetime earned coins are their sum. Available balance is lifetime earned coins minus catalog prices of owned cosmetics. Thus there is no separately mutable wallet that can drift from purchases. The wallet is consistent on Home, Shop, Profile and gameplay. These local records are not anti-cheat or cross-device authoritative records. Multiple simultaneous tabs are not synchronized.

## Completion fix

Previously the result rendered immediately when logical completion was saved, then gained `fresh-win` in an effect. That class applied a delayed opacity animation, while the last arrow was still leaving the board. The initial count also rendered its final value before an effect reset it to zero.

Now gameplay settles for the existing input-gate duration (680 ms, 140 ms reduced motion) before presenting the result. Celebration state is set in the same interaction update. The result is rendered through a React portal into an independent full-viewport layer, so board layout and stacking contexts cannot resize it. The shell has no delayed opacity/class transition. The decorative stars/counter remain animated. CountUp initializes at its requested start value. Restored completed saves show settled results without replaying the celebration.

While results are open, the underlying header/game are inert. Focus moves to the primary result action, Tab cycles within the result actions, and next/replay removes the portal cleanly. The scenery itself is not changed.

## Verification

Unit checks cover Guest fallback, corrupted profile recovery, affordability, duplicate purchase prevention, spend totals and serialization. Browser checks cover profile name/avatar persistence, top-only Settings, cancellation, purchase/equip persistence, actual arrow colour and wallet deduction. The completion regression watches the last snake animation, asserts no result before the exit settles, then samples 30 animation frames to verify stable full-viewport bounds and opacity before proceeding to the next level. Existing phone sizes, campaign progression, rewards and retry tests are also run. Native-device testing remains separate.

Catalog prices are part of the profile-v1 persistence contract because spend is derived from ownership. Future price changes require a migration or an explicit stored purchase ledger; do not retroactively rebalance these prices without handling existing purchases.
