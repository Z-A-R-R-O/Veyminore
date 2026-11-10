# Visual design, navigation and screen contracts

Working revision 2.3 · Derived from masterplan 2.1 · Updated 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page revises source sections 2, 6, 16 under the working amendments. Original section numbers remain for traceability; consult the original reference for unchanged historical text. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 2. Product reference and visual direction

## 2.1 Authoritative visual references

The current AROWGO visual direction is represented by the user-provided screen set:

- **Home:** cherry-blossom fantasy environment, clear Play action, profile/level HUD, currency and heart counters, world/mode/event shortcuts, featured world banner, secondary shortcuts and bottom navigation.
- **Modes:** Story Mode hero card, Classic, Time Attack, Challenge and Daily cards; advanced modes are visibly locked and marked as coming later.
- **World:** a vertical floating-island level route, clear current-level focus, completed/locked states, stars, streak/reward shortcuts and a strong Play action.
- **Shop:** category tabs, featured offer, arrow-skin previews, crates, popular items and daily deals. Prices and random-reward mechanics shown in concept art are placeholders, not approved economy decisions.
- **Profile:** player identity, level/XP, stats, collection, achievements and a clear settings entry.
- **Gameplay:** compact level header, currency and heart state, central high-contrast board, and Hint / Analyze / Erase tools.

Preserve the overall visual language: soft lavender/pink atmosphere, fantasy floating islands, cherry blossoms, waterfalls, rounded translucent panels, playful 3D iconography and crisp dark-navy puzzle geometry. The game board must remain more legible than the decorative world art.

The Ranking destination is present in the navigation concept but a dedicated ranking screen was not included in the supplied reference set. Its functional specification is added in Section 16; visual design remains to be produced.

## 2.2 Design principle

**Crisp puzzle geometry + soft interface chrome.**

Do not make the paths themselves blurry or excessively glossy. The maze must be easy to read. Use the soft depth, gradients, shadows and highlights primarily on panels, buttons, counters and completion effects.

## 2.3 Visual design system

### Colour direction

| Token | Intended use | Starting value |
|---|---|---|
| `bg.primary` | Main app background | `#F7F5FF` |
| `bg.secondary` | Lavender ambient surface | `#EEEAFE` |
| `surface.card` | Board and panel surfaces | `#FFFFFF` |
| `path.default` | Main arrow paths | `#222944` |
| `path.blocked` | Temporary blocked feedback | `#E76B82` |
| `accent.purple` | Primary actions and active states | `#9169E8` |
| `accent.blue` | Analyze tool | `#65A9E8` |
| `accent.yellow` | Coins and hint tool | `#F3C64D` |
| `accent.pink` | Erase and selected cosmetics | `#ED91B8` |
| `text.primary` | Main text | `#20243A` |
| `text.secondary` | Supporting text | `#77768E` |

These are initial design tokens, not final colour values. Check contrast on real devices.

### Shape and depth

- Rounded main board, approximately 24–30 dp corner radius.
- Rounded status capsule with restrained ambient shadow.
- Buttons large enough for comfortable touch interaction.
- Path strokes use consistent widths and rounded joins.
- Arrowheads are distinct from path corners.
- Avoid excessive neumorphic shadows that reduce contrast.
- Use a small number of elevation levels consistently.

### Typography

Use a legible modern sans-serif. Prefer a clean geometric family with strong numerals. Level numbers, coin balance, tool counts and move counts must remain readable at common Android sizes.

### Motion principles

- Responsive input before decorative motion.
- Short, clear feedback.
- Smooth path withdrawal when an arrow is cleared.
- Minimal screen bounce.
- Reduced-motion setting must be respected.
- No animation may hide a puzzle state change.

## 2.4 Motion specification

| Interaction | Suggested motion | Purpose |
|---|---|---|
| Valid arrow exit | Entire path translates rigidly in the derived head direction; optional non-obscuring trail | Satisfying removal |
| Blocked selection | Brief path pulse and blocker highlight | Explain why the move failed |
| Hint | Soft highlight travels along the recommended arrow | Direct attention |
| Analyze | All currently clear arrows receive a temporary outline | Reveal available choices |
| Erase | Selected path fades and particles disperse | Confirm consumable action |
| Level completion | Board clears, star/score reveal, next action appears | Reward |
| Coin reward | Small coin movement toward HUD counter | Reinforce earning |
| Skin equip | Short material / colour transition | Confirm customization |
| World unlock | Path-node activation and gentle reveal | Progress feedback |

Do not lock the input system for long animation sequences. Gameplay state must be updated deterministically before or during the animation according to one documented rule.

## 2.5 UI consistency rules from the screen set

- **Three surface levels only:** (1) primary action / active selection with the strongest purple treatment, (2) translucent glass cards for secondary actions, and (3) simple flat surfaces for low-priority information. Do not give every element the same glow, blur and shadow.
- **Gameplay contrast wins:** arrow paths use a stable dark-navy treatment. Skins may add material, edge tint or a small trail, but may not reduce contrast or alter hitboxes.
- **One primary action per screen:** Play / Continue on Home, Continue on the Story card, Play on the selected level, Equip or Buy on an item detail, and one clear next action on Results.
- **Stable chrome:** profile HUD and bottom navigation should retain consistent sizing and placement across non-gameplay screens. Gameplay may use a compact HUD, but its counters and icon meanings must match the rest of the app.
- **Navigation:** Home, World, Mode, Shop, Ranking and Profile are the six primary destinations shown in the concept. On small devices, prevent the bottom bar from covering scrollable content or the gameplay board.
- **Use restrained motion:** reserve the strongest animated treatment for successful arrow exits, level completion, unlocks and important rewards. Ambient petals and background particles must not compete with text or taps.
- **Responsive composition:** design for a narrow Android portrait viewport first, then test larger phones and web widths. Never solve a layout overflow by shrinking touch targets or puzzle paths below readable sizes.
- **Asset hierarchy:** decorative world backgrounds may be rich and soft; buttons, text, icon silhouettes, path geometry and arrowheads must have crisp edges.
- **No UI copy baked into artwork:** all labels, counters, prices, badges and state messages must be real interface text so they can be localized and updated.

The screenshot set is a direction baseline. Do not copy accidental AI-rendered text artefacts, inconsistent numbers, duplicate items or decorative UI errors from a mockup.

# 6. Level pages, worlds and progression

## 6.1 Information architecture

Primary bottom navigation from the supplied Home concept:

```text
Home | World | Mode | Shop | Ranking | Profile
```

Primary routes:

```text
Home
├── Continue → current Story level
├── Events / Daily reward / Missions (when active)
└── Notifications (only when there is a real notification)

World
├── World map
├── World detail
└── Level list / selected level

Mode
├── Story
├── Classic (post-MVP)
├── Time Attack (post-MVP)
├── Challenge (post-MVP)
├── Daily (post-MVP)
└── Multiplayer / Tournament / Infinity (deferred)

Shop
├── Featured
├── Arrow skins / trails / effects
└── Earned reward bundles (directly disclosed)

Ranking
├── Personal best (offline MVP)
└── Daily / weekly / all-time leaderboard (online, later)

Profile
├── Player identity and progression
├── Statistics and achievements
├── Collection
└── Settings / support / data controls
```

The World and Mode concepts should not be duplicated as separate, confusing entry points. Home's World and Mode tabs open those destinations; the Home screen's shortcut cards may deep-link to the same routes.

## 6.2 Campaign world map

Each world card should show:

- World number and title.
- Visual theme.
- Completed levels.
- Total levels.
- Star progress.
- Unlock state.
- Best score or completion percentage.
- One obvious Continue action.

## 6.3 Level list page

Use both a visual path map and a compact numbered grid.

### Level tile states

| State | Visual |
|---|---|
| Locked | Muted surface and lock icon |
| Unplayed | Clear neutral tile and number |
| Current | Purple highlight and subtle glow |
| Completed | Completion mark and earned stars |
| Perfect | Special border or small crown/star |
| Daily | Distinct daily marker |
| Challenge | Competition badge |

### Level list requirements

- Levels are grouped by world.
- Page loads quickly.
- Current level is visible immediately.
- Completed level results are preserved.
- Players can replay unlocked levels.
- Locked levels explain the unlock requirement.
- The map must remain usable with hundreds of levels.
- Do not require players to scroll through thousands of nodes.

## 6.4 Progression and scoring

Potential score inputs:

- Completion.
- Blocked attempts and assists; successful removals equal the initial arrow count for a full clear.
- Mistakes.
- Hint usage.
- Erase usage.
- Time, where time is appropriate.

Use stars to communicate quality, not to punish players for taking time.

For casual campaign play, accessibility and enjoyment should matter more than speed.

For ranked modes, assisted actions should be treated consistently and transparently.

# 16. Screen inventory and functional specifications

The six supplied screen concepts establish the visual direction. Functional state, prices, rewards and exact copy remain controlled by this document and live configuration.

## 16.1 Home

Must show:

- AROWGO identity and one primary Play / Continue action.
- Player avatar, name, level and XP progress.
- Earned coin balance only if used. Hearts appear in-level as mistake allowance, not as a global refillable resource.
- Notification entry only when notifications exist and are useful.
- Worlds, Modes and Events shortcuts.
- Featured current world / Continue journey banner.
- Daily Reward, Missions, Shop, Ranking and Friends shortcuts when their systems exist.
- MVP bottom navigation: Home, World and Profile. Add other destinations only when functional; Story/practice can be reached from existing screens.

Do not display non-functional badges, fake notifications or empty feature entries. Hide or honestly mark unavailable features.

## 16.2 Modes

- Story Mode hero card with current campaign continuation.
- Classic, Time Attack, Challenge and Daily cards with one-sentence rule descriptions.
- Multiplayer, Tournament and Infinity may appear as locked / coming soon only if the team intends to build them; do not imply a release date.
- Every mode card must open a detail/rules state before the player commits to a run.
- Avoid duplicate mode concepts. Classic and Infinity must have distinct rules before both appear as separate destinations.

## 16.3 World page

- World name, number, theme and progress.
- Vertical island/path map matching the Bloom Valley concept.
- Completed, current, locked and perfect level states.
- Clear star count and current level marker.
- Shortcuts for daily rewards, ranking, friends, daily mode and shop only when functional.
- One Play / Continue action for the current level.
- The route must remain navigable with hundreds of levels; provide a world/level index rather than requiring endless scrolling.

## 16.4 Level-list page

- World title and chapter navigation.
- Compact level grid as an alternative to the scenic route map.
- Locked/current/completed/perfect states.
- Earned star count and unlock requirement.
- Quick jump to the current unlocked level.
- Preserve completed-level results and allow replay.

## 16.5 Gameplay — Level screen

Preserve the supplied reference hierarchy:

- Back / exit control.
- World and level title.
- Settings.
- Level progress indicator where useful.
- Coin balance and heart/mistake state.
- Home and restart controls.
- Large central rounded puzzle board.
- Hint, Analyze and Erase tools with visible remaining charges.

The board receives the strongest visual priority. HUD controls must not compete with it. Keep the playing surface stable when tool counts change. Support one-handed portrait use and safe areas.

## 16.6 Results page

Show:

- Level complete / run ended.
- Stars earned and whether the run was assisted.
- Moves, mistakes and tool usage.
- Coin reward and any unlocked item.
- Next level as the primary action.
- Replay and optional share result as secondary actions.

Grant all rewards once. Do not place a forced ad before the result can be seen.

## 16.7 Shop and Collection

- Category tabs for featured, coins, hearts, boosters, skins, crates and other items only if those categories contain real products.
- Arrow skin cards must show a gameplay preview, ownership/equipped state, rarity if used, and the exact unlock condition or price.
- Directly disclose contents and price before purchase.
- No paid randomized crates in v1. Earned reward chests may be deterministic or use a clearly disclosed free reward pool.
- Do not show countdowns unless the offer genuinely expires according to a server-controlled clock.
- Restore purchases where required and show ownership consistently.

## 16.8 Ranking screen — visual design still required

Initial v1 may be a local Personal Best screen. Online ranking is deferred until server validation exists.

When online ranking ships, show:

- Daily / weekly / all-time tabs only when each has a real data source.
- Player's own rank and score prominently.
- A clear tie-break explanation.
- Minimal public player data (display name, avatar and score only as needed).
- Loading, empty, offline and error states.
- No fabricated entries, bot-filled tables or misleading percentile claims.
- Report/block capability if social identity features create abuse risk.

Do not expose email, phone, private profile fields or exact location on leaderboards.

## 16.9 Profile

- Avatar, display name and editable player identity.
- Level, XP and progress to next level.
- Total stars, levels cleared, modes played and streak only when accurately computed.
- Collection summary: arrow skins, trails/effects and crates if implemented.
- Statistics with clear date windows and definitions.
- Achievements with locked/unlocked states and exact criteria.
- Settings entry.
- Account-link status and data/support controls only when online identity is enabled.

Profile statistics must come from the same progression record as the game; do not hard-code the attractive numbers used in mockups.

## 16.10 Missions, Daily Rewards and Events

- Explain the task, progress, reward and reset time.
- Use server time for online event windows.
- Do not reset a reward streak because of an app outage or local clock manipulation.
- Never promise a reward that cannot be delivered or recovered.
- Missions must reward normal play rather than encourage compulsive or excessive sessions.

## 16.11 Friends and Multiplayer

Initially show only available actions: share result, copy challenge code or view an accepted asynchronous challenge. No open chat in early releases. Live queues and tournament entry remain hidden until implemented and operationally supported.

## 16.12 Settings

- Sound and music separately.
- Haptics.
- Reduced motion.
- Language.
- Privacy policy and data controls.
- Support / report a problem.
- Credits.
- Account link / sign out / deletion request if an account exists.
- Version/build number and diagnostics copy action.

## 16.13 App lifecycle and navigation

- Android back button/gesture must navigate predictably; during a puzzle it should offer pause/exit rather than silently discard progress.
- Persist a safe state on background/suspend.
- Restore the same screen and puzzle state after an incoming call or OS process kill where feasible.
- Respect display cutouts, system bars, keyboard and safe-area insets.
- Avoid accidental double navigation from rapid taps.
