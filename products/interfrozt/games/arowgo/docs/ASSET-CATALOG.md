# Asset catalog and provenance register

Current catalog and rights clearance status. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Generated art](assets/generated-art.md) · [Profile avatars](PROFILE-AVATARS.md).

## 1. Branding and identity

| Asset | Current Source Path | Status | Notes |
| --- | --- | --- | --- |
| **Purple Arrow v4** | `src/ui/assets/` / SVG | **Active canonical brand** | Sculpted purple arrow identity; primary game icon and launcher artwork. |
| **Blue "A" Monogram** | Archived in docs | **Decommissioned** | Historical v0.1 concept; replaced by Purple Arrow v4. |

---

## 2. In-game artwork and sprites

### Scenery and generated graphics

| Asset | Resolution / Format | Provenance Reference | Rights Status |
| --- | --- | --- | --- |
| **Hero Island** | Transparent PNG | [generated-art.md](assets/generated-art.md) | Grounded AI generation; rights review pending for commercial launch. |
| **Heart Containers** | Transparent PNG | [generated-art.md](assets/generated-art.md) | Full, empty, and breaking heart sprites. |
| **Victory Splash Art** | Transparent PNG | [generated-art.md](assets/generated-art.md) | Celebration reward background. |
| **Bloom Scenery Layer** | Multi-layer SVG | [bloom-valley.md](assets/bloom-valley.md) | Parallax scenery backdrop. |
| **Amber Scenery Layer** | Multi-layer SVG | `assets/amber/` | Dunes and Sanctum backdrop. |

### Player collection: 30 character avatars and 30 frames

- **Character Portraits (30)**: Stored in `src/storage/avatars.ts`. High-resolution, spaced, glossy adventure portraits with transparent backgrounds.
- **Avatar Frames (30)**: Stored in `src/storage/avatar-frames.ts`. Centered, spaced circular ring artwork (bronze, silver, gold, celestial, crystal).
- **Avatar Backgrounds (12)**: Stored in `src/storage/avatar-backgrounds.ts`. Background editor UI was removed from Profile; assets and schema parsing remain active for save compatibility.

### Arrow skins (15 active skins)

Available in the Shop via Common, Rare, and Epic crates:
1. `classic` (Default)
2. `blossom` (Bloom Valley floral theme)
3. `verdant` (Verdant Cove forest theme)
4. `frost` (Frostfall icy glow)
5. `amber` (Dunes warm glow)
6. `sanctum` (Sanctum regal glow)
7. `neon` (Cyberpunk vibrant stroke)
8. `obsidian` (Dark crystalline texture)
9. `aurora` (Phase-shifting color gradient)
10. `solar` (Radiant solar flares)
11. `amethyst` (Deep purple gemstone)
12. `celestial` (Starfield shimmer)
13. `phantom` (Translucent ethereal mist)
14. `magma` (Molten lava glow)
15. `chronos` (Golden gear clockwork)

*(Note: The 100-skin launch catalog in [CHEST-AND-SKIN-LAUNCH-PLAN.md](CHEST-AND-SKIN-LAUNCH-PLAN.md) remains a proposal. The current source of truth is these 15 skins).*

### Mechanic badges and visual glyphs

- **Key & Lock**: Padlock and key glyphs; unambiguous 1-pair matching.
- **Structural Anchor**: Inverted gold anchor symbol (`anchorRequires`).
- **Ice Seal**: Frosted overlay with numeric thaw countdown badge.
- **Aurora Phase Gate**: Pulsing chromatic shimmer.
- **Keg Bomb**: Explosive barrel with numeric removal deadline badge.

---

## 3. Typography

| Font Family | Usage | License / Foundry | Embedding Verification |
| --- | --- | --- | --- |
| **Satoshi** | Body text, UI labels, buttons, numerical counters | Fontshare (Indian Type Foundry) / Free Commercial | Verified web `@font-face` and native embedding. |
| **Matcha** | Chapter headers, level victory titles, hero branding | Commercial Display Font | Commercial clearance review required prior to retail store publishing. |

---

## 4. Audio

| Audio Event | Type | Provenance | Status |
| --- | --- | --- | --- |
| `arrow_tap` | SFX | Procedural / Synthesized Web Audio | Safe royalty-free |
| `snake_slither` | SFX | Synthesized audio glide | Safe royalty-free |
| `collision_shake` | SFX | Low-frequency thump | Safe royalty-free |
| `ice_shatter` | SFX | Crystalline break sample | Provenance clearance pending |
| `keg_tick` | SFX | Wooden click | Safe royalty-free |
| `victory_jingle` | SFX | Staged chime fanfare | Provenance clearance pending |
| `ambient_loop` | Music | Muted background drone | Provenance clearance pending |

---

## 5. Decommissioned / obsolete assets

1. **Blue Monogram "A"**: Replaced by Purple Arrow v4 in `494aab9`.
2. **Rigid Translation Sprites**: Superseded by vector-rendered Phaser snake meshes with curved corner joints.
3. **Square Avatar Frames**: Replaced by centered circular rings in `097d352`.
4. **4-Skin Guest Catalog**: Expanded to 15 skins and 3 crates in `78621e6`.
