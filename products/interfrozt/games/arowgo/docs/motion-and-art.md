# Bloom Valley motion and art

Implemented 10 November 2026. Scope: one playable level, existing Rule lab and local progress. The supplied image is visual direction, not an executable specification or a new level definition.

## Layered approach

1. **Environment:** original portrait/landscape raster scenery behind live UI. CSS petals, mist, rays and fireflies supply slow 2D motion. Keep the board opaque enough to protect arrow contrast.
2. **Interface:** React owns state and accessible controls; CSS supplies brief entrance, press, heart, coin and tool feedback. Icons and hearts are SVG, so they stay sharp at different screen sizes.
3. **Gameplay:** SVG draws resolution-independent paths and rounded arrowheads; Phaser drives snake exit timing, collision rings and hint glows. The pure domain commits and saves the result before presentation starts. No decorative randomness enters collision, rewards or saves.

No additional animation package or plugin is needed for this slice. Existing Phaser handles board effects; CSS handles ambient/interface effects. Add a new runtime only for a demonstrated requirement such as authored skeletal characters, after checking bundle and device costs.

## Motion budget and accessibility

| Effect | Implemented behavior |
| --- | --- |
| Arrow exit | Tail follows the original bends while the head extends forward; 620 ms sine ease-in-out |
| Erase | Confirm first, then 300 ms fade and pink burst |
| Blocked move | 200 ms cosmetic approach to contact, blocker pulse, then 360 ms return; no occupancy change |
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

## Vector/snake amendment — 10 November 2026

The user requested crisp arrows and snake-like exits. Live SVG replaces the fixed-resolution arrow raster; curves and rounded tips scale to display density and zoom, including 8K displays, without an 8K bitmap allocation. This is not a claim of measured 8K frame rate. The successful-exit presentation now advances a constant-length body along its original route, then off the board. Existing conservative whole-body swept collision validation remains unchanged; blocked arrows never use the snake exit. This explicitly supersedes earlier rigid-only animation guidance, not the domain rule. Input cooldown is 680 ms to cover the 620 ms animation. Reduced motion skips the successful tween.

Geometry tests cover constant length, corner traversal, full exit and nonmutation. Renderer verification covers one vector layer after remount, evolving bent-arrow path and removal cleanup. [DPR 2 capture](verification/vector-arrows.png) and [exit recording](verification/snake-exit.webm).

Validation: 43 unit tests passed; 10 existing desktop/phone browser cases plus two new vector lifecycle/animation cases passed. Typecheck, formatting, production build and Android asset sync passed. DPR 2 screenshot visually inspected. Native device/8K display performance has not been measured.

## Victory sequence — 10 November 2026

A fresh completion lets the 620 ms arrow exit finish, then reveals the result over 450 ms. A golden emblem blooms, earned stars arrive in order, and the existing first-clear reward counts from zero to 25. All presentation settles after 3.6 seconds. Reloading a completed save shows the settled result immediately. Reduced motion shows final values without the sequence. Rich mode retains the decorative burst; Subtle keeps the smaller result transitions.

The intent is to make completion legible and satisfying through anticipation, recognition and closure. This is a design hypothesis, not a claim of measured dopamine release or retention improvement. The mastery ribbon reflects the actual run: a clean unassisted solve, an assisted solve, practice or recovery from mistakes. Ten cleared paths are acknowledged. Rewards remain deterministic; no new currency, random payout, loss-aversion timer or forced replay was added. Replay stays voluntary and does not grant another first-clear reward.

Validation includes desktop/phone victory layout, final coin value, settled state on reload and unchanged existing gameplay flows. Native device performance remains pending.

Victory captures: [desktop](verification/victory-desktop.png) · [phone](verification/victory-phone.png).

## Blocked-move contact — 10 November 2026

The selected arrow translates toward its first swept blocker, stopping short by the visible head/stroke clearance. At contact the blocker pulses and a ring marks the collision; the selected arrow returns to its exact origin. Both render objects remain protected from redraw during the sequence. The 560 ms presentation fits inside the existing 680 ms input gate. Pure collision rules, saved positions and one-mistake accounting are unchanged. Reduced motion skips approach/recoil and retains text/heart feedback. Motion-setting changes cancel tweens and redraw the committed state.

Regression checks exercise approach direction and distance, return-to-origin, unchanged path and ten active arrows, blocker opacity recovery, one lost heart and reload persistence, plus existing rapid-tap and reduced-motion flows.

[Blocked contact animation recording](verification/blocked-contact.webm).
