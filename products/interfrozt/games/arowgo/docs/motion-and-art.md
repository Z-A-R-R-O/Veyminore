# Bloom Valley motion and art

Implemented 10 November 2026. Scope: one playable level, existing Rule lab and local progress. The supplied image is visual direction, not an executable specification or a new level definition.

## Layered approach

1. **Environment:** original portrait/landscape raster scenery behind live UI. CSS petals, mist, rays and fireflies supply slow 2D motion. Keep the board opaque enough to protect arrow contrast.
2. **Interface:** React owns state and accessible controls; CSS supplies brief entrance, press, heart, coin and tool feedback. Icons and hearts are SVG, so they stay sharp at different screen sizes.
3. **Gameplay:** Phaser draws paths, rigid exit tweens, collision rings, hint glows and short particle trails. The pure domain commits and saves the result before presentation starts. No decorative randomness enters collision, rewards or saves.

No additional animation package or plugin is needed for this slice. Existing Phaser handles board effects; CSS handles ambient/interface effects. Add a new runtime only for a demonstrated requirement such as authored skeletal characters, after checking bundle and device costs.

## Motion budget and accessibility

| Effect | Implemented behavior |
| --- | --- |
| Arrow exit | Whole shape translates in 360 ms; never retracts around bends |
| Erase | Confirm first, then 300 ms fade and pink burst |
| Blocked move | Brief alpha feedback and collision ring; no illegal translation |
| Hint | Separate glow pulses over 750 ms; highlight expires after five seconds |
| Particles | Maximum 36 concurrent Phaser effects; short-lived and destroyed |
| Ambient petals | 14 Rich / 5 Subtle; slow 16–28 second cycles |
| Celebration | 22 decorative elements, two-second lifetime, only on completion transition |
| Background tab | CSS animations pause; Phaser loop sleeps and wakes |

Rich is the default. Subtle disables richer repeating light/board effects and decorative board bursts/trails; collision rings remain. Reduced motion stops CSS animation and Phaser tweens, shows committed states immediately, and hides ambient motion. The OS preference also forces reduced motion. Preferences persist separately from gameplay; changing them never resets progress. Keyboard controls, modal focus trapping and text feedback remain available.

The effects cap is an implementation bound, not a measured mobile FPS guarantee. Profile a real low-end Android device before raising particle counts or adding full-screen blur. Artwork currently uses approximately 1.9 MB per PNG; responsive source selection avoids loading both variants during normal initial presentation. Optimize delivery formats after visual comparison if download performance becomes a constraint.

## Tool and save amendment

Hint reveals one legal arrow. Analyze reveals all legal arrows. Erase selects an active arrow, requests confirmation, then removes it even if blocked. Cancel changes no board occupancy, hearts or reward. All tools are free prototype aids and mark the run assisted; UI infinity badges do not represent a paid inventory. Erase consumes no heart or coin. Assisted completion uses the existing assisted star policy; first Story clear still rewards 25 coins once.

The additive `erased: string[]` session field records bypass removals. Original version-1 saves without that field migrate to an empty list. Parsing rejects duplicate, unknown, active or unassisted erased entries. Normal removed arrows still undergo legality validation; only recorded erased arrows bypass it. Rules and content remain version 1, and no original saved level is replaced.

## Evidence and next work

- [Asset provenance and exact prompts](assets/bloom-valley.md)
- [Verification and screenshots](verification/bloom-motion.md)
- Next: physical Android profiling, sound/haptics with mute controls, then additional authored levels. Keep collision tests as the gate for any movement change.
