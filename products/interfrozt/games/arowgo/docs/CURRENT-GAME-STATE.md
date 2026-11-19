# Current game state

> 18 November update: an isolated development Google backend and test page are implemented. [Current provider-spike status](ACCOUNT-BACKEND-DEV.md) supersedes earlier statements that no service code exists. Live provider success and production service gates remain open.

Audited 16 November 2026 against this checkout. This is the implementation inventory; [audit outcomes](AUDIT-2026-11-16.md) distinguish fresh verification from historical evidence. The package remains version 0.1.0; that version string does not mean the original five-level scope is current.

## Status at a glance

| Area          | Current state                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Game          | Playable browser prototype; 40 campaign levels, two worlds                                            |
| Movement      | Snake head-ray rules, keys, anchors and move-count deadlines                                          |
| Persistence   | Device/browser-local sessions and profile; no cloud account                                           |
| Economy       | Local coins/gems, three crates, 15 skins, Time Boost; no real-money purchases                         |
| Native        | Capacitor sync and Android debug build verified with Java 21; physical-device/release acceptance open |
| Next priority | Account/cloud/trusted-economy foundation, documented but not built                                    |
| World 3       | Frostfall Peaks placeholder and proposal only; no Levels 41–60                                        |
| Public launch | Not certified; device, operations, rights and player review remain open                               |

## Campaign, rules and authoring

Bloom Valley is Levels 1–20; Verdant Cove is 21–40. Each world has two ten-stop map sections. Unlocked markers launch directly; later worlds remain locked/clouded. Frostfall Peaks and Amber Dunes are non-playable placeholders.

All live campaign levels use rulesVersion 2. Content versions: Levels 1–4 use 5, Levels 5–9 use 8, Levels 10–40 use 9. Level IDs remain stable. Geometry generation is version 3; the offline planning pass is version 1. Shipped JSON is reviewed output, not generated at play time.

The head must have a clear forward ray; its body follows the existing path. Keys and anchors add prerequisites. Keys appear at 11, 14, 17, 19, 20, 22, 23, 25–30 and 32–40. Anchors start at 24. One barrel starts at 10; two start at 25. Successful removals, including Erase, consume one move; hints/blocked taps do not. Expired or stranded deadlines fail an attempt. Players can think without a real-time fuse. Hints and hold previews use the deadline-aware solver.

The first snake lesson teaches three movement cases. The first barrel lesson teaches clearing its blocker before the marked arrow. Keys have a first-encounter preview and separate Practice lesson; anchors have an interactive introduction. Lessons are separate from campaign rewards. See [Snake movement](SNAKE-MOVEMENT.md), [Planning difficulty](PLANNING-DIFFICULTY.md), [Keys](KEYS-AND-LOCKS.md) and [Cove](VERDANT-COVE.md).

## Scoring and rewards

Story has three mistake hearts; Practice allows unlimited mistakes but still enforces puzzle constraints and grants no stars/coins. Stars independently reward completion, no mistakes and meeting the speed target. Base target: eight seconds per arrow, minimum 60 seconds. Time starts on the first accepted action and includes time away/reloads. Hint and Erase mark assistance without capping new stars. First Story clear awards 25 coins once per level: 1,000 total campaign coins and 120 possible stars. Replays improve best stars without repeating the reward.

## Profile, collection and gems

Journey, Arrows and Edit profile are implemented locally. Journey derives progress and milestones; Arrows paginates owned/locked cosmetics; name/avatar and equipped skin persist. Fifteen skins span Common, Rare, Epic, Legendary and Mythic. Ethereal and the 100-skin catalog are planned only.

| Existing crate | Coins | Gems | Common / Rare / Epic / Legendary / Mythic odds |
| -------------- | ----: | ---: | ---------------------------------------------- |
| Bloom          |    10 |    1 | 60 / 25 / 10 / 4 / 1%                          |
| Aurora         |    20 |    2 | 30 / 40 / 20 / 8 / 2%                          |
| Celestial      |    35 |    4 | 10 / 30 / 35 / 20 / 5%                         |

A one-time welcome opening and one-time 20-gem starter gift exist. Crate payment and outcome are saved before the chest/reel/reveal animation; duplicates refund according to the current local contract. Time Boost costs 3 gems and adds 30 seconds to one current Story attempt. Hint/Erase remain free; extra hearts and paid gem packs are not implemented. All economy authority remains in the client. See [Gems](GEMS-AND-BOOSTERS.md); the [five-tier chest plan](CHEST-AND-SKIN-LAUNCH-PLAN.md) does not describe live odds.

## UI, art and accessibility

Home, Worlds, Modes, Shop, Profile, Settings and result/finale flows are implemented. Play has phone and desktop/landscape arrangements; longer settings content may scroll within its panel. Bloom and Cove have distinct scenery, with a separate Cove home illustration/background. The A-arrow monogram is the applied app icon. Generated reward titles, stars, chests, gem and feedback symbols are integrated. Move-feedback counts show categories earned in that attempt; unlock bubbles and snake/recoil/result transitions are present.

Matcha display/action fonts and Satoshi reading text are used. Matcha Squishy was excluded because its supplied license was personal-use only. Sound is optional and initially off: one supplied arrow-click clip plus victory/defeat clips and synthesized supporting cues. Reduced motion, keyboard controls and semantic labels exist. Physical-device sound, screen-reader behavior and release licensing are not certified by browser automation.

## Save compatibility

Session schema is 1; profile schema is 2, with additive gem/receipt fields. Storage keys include arowgo.slice.v1, per-level arowgo.level.<levelId>.v1, and arowgo.profile.v1. Save validation, backups and explicit error notices exist. Historical definitions cover prior rules/content editions, including pre-challenge and pre-planning archives.

Unchanged validated layouts can retain attempts. Replaced geometry or deadlines restart the attempt while keeping claimed rewards, coins, best stars and mode; raw old saves are archived by content version. Time Boost receipts bind to attempts and are reconciled after interrupted writes. These checks protect local consistency, not authenticity against a modified client. Account-based sync and trusted economic authority are absent.

## Technology and release state

Installed package declarations: React 19.3.1, Phaser 4.2.1, Vite 8.3.7, TypeScript 5.9.3, Capacitor 8.6.0, Vitest 4.1.12 and Playwright 1.65.0. Node requirement is >=22.12. Android app ID: com.veyminore.arowgo; checked-in compile/target SDK declarations are 36. Java is now available with JAVA_HOME set. ANDROID_HOME and android/local.properties are absent here; the standard SDK directory is present. Native sync and assembleDebug passed with Android Studio’s bundled Java 21. The default Java 17 failed with invalid source release: 21. Physical-device testing and release signing remain open.

No PlayFab/OAuth integration, server, billing SDK, analytics SDK, friends, leaderboard, daily/endless service or multiplayer implementation was found in the audited game source/dependencies. External accounts or hosting were not inspected. A previous deployment report is historical evidence, not a fresh production check.

## Next work

1. Follow [Backend/account plan](BACKEND-ACCOUNT-PLAN.md): protected guest/Google identity, safe import, cloud conflicts, server economy and recovery.
2. Resolve open checks in the [current audit](AUDIT-2026-11-16.md), including formatting and native verification.
3. Observe real players and tune difficulty/clarity; structural simulations are not human success rates.
4. Resume [Frostfall Peaks](FROSTFALL-PEAKS-PLAN.md) after the account foundation.
5. Review collection expansion, operating economy and release requirements before launch.

## Account foundation update after the audit

B01 has started: isolated session contracts, a disabled same-origin web adapter and read-only legacy snapshot capture are implemented and tested. They are not connected to game UI or a live service. Google/native provider proof, server sessions, account storage, import and cloud sync remain unfinished. See [implementation status](ACCOUNT-FOUNDATION.md).
