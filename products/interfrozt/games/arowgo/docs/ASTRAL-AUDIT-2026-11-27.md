# Astral Observatory audit — 27 November 2026

This is the original content-13 audit. The current revision is documented in [Astral hardening](ASTRAL-HARDENING.md).

## Scope

World 7 adds Levels 141–180, following the forty-level world policy. Campaign totals are 180 levels, 540 stars and 4,500 first-clear coins. Existing Levels 1–140 retain their IDs and content. Astral unlocks after Level 140 and has four ten-stop map pages.

## Level findings

All forty authored puzzles have a legal complete solution, 28 arrows and at least 89 occupied cells. Each has a witnessed legal decision with both a winning and a losing continuation. Generation rejects candidates whose random-legal-play success probability exceeds the fixed Clockwork Level 130 baseline. This probability is not a human success rate or IQ measurement.

Each ten-level block is sorted by the frozen version-one structural score, with floors of 700, 720, 740 and 760. Scores may fall at block boundaries; the complete forty-level sequence is not monotonically harder. The timing combinations become tighter, but actual difficulty and enjoyment still require human playtesting.

| Level | Rating | Occupied / 100 | Dependency depth | Random legal win probability | Pulse / window gates |
| --- | --- | --- | --- | --- | --- |
| 141 | 706 | 90 | 10 | 4.63e-11 | 4 / 3 |
| 142 | 725 | 89 | 10 | 1.46e-10 | 4 / 3 |
| 143 | 784 | 92 | 11 | 1.32e-10 | 4 / 3 |
| 144 | 786 | 90 | 10 | 9.67e-11 | 4 / 3 |
| 145 | 796 | 89 | 11 | 2.01e-10 | 4 / 3 |
| 146 | 796 | 89 | 10 | 1.97e-10 | 4 / 3 |
| 147 | 823 | 92 | 11 | 2.66e-10 | 4 / 3 |
| 148 | 842 | 92 | 10 | 1.08e-10 | 4 / 3 |
| 149 | 882 | 92 | 11 | 1.72e-10 | 4 / 3 |
| 150 | 905 | 89 | 10 | 2.72e-10 | 4 / 3 |
| 151 | 733 | 93 | 10 | 1.88e-13 | 4 / 4 |
| 152 | 736 | 90 | 10 | 1.16e-11 | 4 / 4 |
| 153 | 748 | 93 | 12 | 2.37e-10 | 4 / 4 |
| 154 | 749 | 92 | 9 | 7.05e-11 | 4 / 4 |
| 155 | 779 | 93 | 9 | 8.15e-12 | 4 / 4 |
| 156 | 805 | 93 | 12 | 1.95e-10 | 4 / 4 |
| 157 | 828 | 89 | 10 | 4.56e-12 | 4 / 4 |
| 158 | 835 | 93 | 9 | 1.81e-11 | 4 / 4 |
| 159 | 855 | 89 | 9 | 1.16e-10 | 4 / 4 |
| 160 | 856 | 92 | 9 | 1.49e-11 | 4 / 4 |
| 161 | 776 | 90 | 9 | 3.34e-14 | 5 / 4 |
| 162 | 789 | 92 | 9 | 1.93e-10 | 5 / 4 |
| 163 | 790 | 93 | 9 | 5.15e-11 | 5 / 4 |
| 164 | 798 | 90 | 9 | 3.79e-12 | 5 / 4 |
| 165 | 798 | 91 | 9 | 2.06e-10 | 5 / 4 |
| 166 | 800 | 94 | 9 | 6.87e-11 | 5 / 4 |
| 167 | 802 | 89 | 9 | 1.95e-12 | 5 / 4 |
| 168 | 811 | 89 | 9 | 7.03e-12 | 5 / 4 |
| 169 | 834 | 92 | 9 | 1.45e-14 | 5 / 4 |
| 170 | 897 | 89 | 9 | 1.23e-11 | 5 / 4 |
| 171 | 760 | 89 | 11 | 5.76e-11 | 5 / 4 |
| 172 | 766 | 91 | 9 | 4.51e-13 | 5 / 4 |
| 173 | 768 | 90 | 9 | 2.04e-11 | 5 / 4 |
| 174 | 794 | 94 | 9 | 1.8e-11 | 5 / 4 |
| 175 | 798 | 89 | 9 | 2.14e-11 | 5 / 4 |
| 176 | 816 | 92 | 10 | 2.52e-11 | 5 / 4 |
| 177 | 820 | 89 | 9 | 1.24e-10 | 5 / 4 |
| 178 | 825 | 94 | 10 | 2.78e-11 | 5 / 4 |
| 179 | 844 | 91 | 10 | 8.63e-12 | 5 / 4 |
| 180 | 844 | 89 | 11 | 3.29e-11 | 5 / 4 |

## Verification

- All 487 unit/integration tests across 65 files passed. This includes all 180 stored solutions, every Astral move restored through the save parser, replay reward protection, and server-owned completion validation.
- Production build and TypeScript passed; the existing large-chunk warning remains.
- All forty offline difficulty exports reproduce the frozen scoring model.
- Responsive map/home checks passed at 320×568, 390×844 and 1280×800, including all four map pages and unchanged seeded legacy saves. Screenshots were inspected; heading contrast, short-phone spacing and the home background were corrected.
- Pixel 7 emulation completed Levels 141, 150, 151, 160, 161, 170, 171 and 180 using touch, with unchanged non-DEV storage. The clean Desktop Chrome rerun completed the same eight samples using keyboard input, also preserving non-DEV storage.
- Original level JSON was compared with HEAD: no existing content changed.
- Documentation link/index check passed.

An initial simultaneous Playwright run collided in its shared trace-output folder during desktop teardown. Follow-up runs use separate artifact directories. These are isolated browser contexts; no user progress was seeded or modified.

## Remaining limits

Physical-device performance and human playtesting remain outstanding. The production build still reports a large JavaScript chunk. Existing legacy cloud snapshot size limits and production account deployment are separate gaps: this expansion does not trim history, alter currency, or enable cloud features. No real account data was used in automated testing.

See [world design and artwork](ASTRAL-OBSERVATORY.md) and [current game state](CURRENT-GAME-STATE.md).
