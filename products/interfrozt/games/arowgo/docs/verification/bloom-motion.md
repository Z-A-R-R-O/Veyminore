# Bloom motion verification

Date: 10 November 2026. Scope: AROWGO package, one original level. Supersedes the visual/tool scope of the [first-playable baseline](first-playable.md), not its historical results.

| Check | Result |
| --- | --- |
| Strict TypeScript | Passed |
| Unit/state tests | 38 passed across three files |
| Formatting | Prettier check passed |
| Browser integration | 10 passed: desktop Chromium and Pixel 7 emulation |
| Production build | Passed; existing Phaser chunk-size warning remains |
| Capacitor Android sync | Passed; updated web assets copied |
| Native compile/device performance | Still pending; previous environment lacked Java and Android SDK |
| Visual review | Desktop and portrait screenshots inspected; scenery covers full page and tools remain readable |

Browser cases cover the original complete/replay/reward flow, real pointer input, rapid taps, restart cancellation, Practice, Rule lab, failure recovery and keyboard dismissal. New cases cover Analyze, confirmed/cancelled Erase, reload persistence, persistent Subtle/reduced settings, OS reduced-motion enforcement and no horizontal overflow. Reduced mode reports zero running DOM animations. State tests also cover legacy-save migration, invalid erased records and exactly-once completion rewards.

This is browser emulation, not physical-device acceptance. No measured mobile FPS, battery or GPU claim is made. Artwork is approximately 1.9 MB per variant; production Phaser remains approximately 1.37 MB uncompressed / 357 KB gzip. Profile loading, background/resume and sustained Rich effects on real low-end Android hardware before release.

## Captures

- [Desktop](bloom-motion-desktop.png)
- [Phone](bloom-motion-mobile.png)
- [Motion architecture and timings](../motion-and-art.md)
- [Original artwork and prompts](../assets/bloom-valley.md)

Captures show an untouched level. The sparse ten-arrow board is the proven original level; the reference image's denser puzzle was not substituted without rule validation.
