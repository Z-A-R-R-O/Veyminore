# Astral difficulty hardening — 27 November 2026

## Acceptance contract

This revision keeps Levels 1–140 unchanged and replaces/reorders Astral's forty puzzles under content version 14. Every Astral structural score must exceed the previous campaign peak (856), with a minimum of 860, and scores must be nondecreasing across all forty levels. The earlier ten-level resets are removed. Already strong puzzles can move later without changing their mechanics.

Every source puzzle must retain or improve its frozen structural score and have no higher random-legal-play win probability. All candidates must remain solvable and have a witnessed wrong legal choice with a failure horizon of at least twelve moves. This failure horizon is not proof of required human lookahead, and neither score nor random-play probability measures IQ or predicts human success.

## Retuning

The author searches timing placements and deadlines while preserving key/anchor relationships. Some candidates retain their existing phase/pulse/ice placements; others retune them. It can add removal-count deadlines and fill unused board cells, but accepts a candidate only after exact planning checks. No new movement rule is introduced. Twenty-eight arrows remain on each 10×10 board. Timing attachments stay off key and anchor sources.

Opt-in scripts: `tests/author-astral-hardening.test.ts` stages resumable candidates under `tmp/astral-hardening`; `tests/promote-astral-hardening.test.ts` validates the entire set before promotion. Use `AROWGO_HARDEN_ASTRAL=1` and `AROWGO_PROMOTE_ASTRAL=1` respectively. Normal test runs never author or promote content. Regenerate offline ratings with `AROWGO_RATE=1` and `tests/export-difficulty.test.ts`.

## Save and reward compatibility

The original content-13 Astral puzzles are archived in `content/levels/astral-before-hardening.json`. Local load, cloud-restore validation and server reward verification recognize that archive. Migration keeps coins, best stars and the first-clear claim, preserves the original bytes under `.content-13`, and starts a fresh attempt for a changed board. It does not edit the profile or gem balance. Finishing an already claimed level does not award another 25 coins.

## Measurements and verification

The promoted curve is 862–951, averaging 879.95 (previous Astral: 802.475; Clockwork: 711.4). Every new score exceeds the highest score anywhere in Levels 1–140 (856). Occupancy is 89–97 of 100 cells. Scores are nondecreasing across the complete world. Reordering means a numbered slot may receive a different puzzle; comparisons below are against each source layout, not the former occupant of that slot.

| Current level | Score | Original source | Source score | Occupied / 100 | Failure horizon | Random legal win probability |
| --- | --- | --- | --- | --- | --- | --- |
| 141 | 862 | astral-146 | 796 | 89 | 24 | 6.11e-11 |
| 142 | 863 | astral-144 | 786 | 90 | 22 | 1.69e-11 |
| 143 | 863 | astral-158 | 835 | 93 | 25 | 4.58e-12 |
| 144 | 863 | astral-175 | 798 | 89 | 26 | 1.75e-12 |
| 145 | 864 | astral-167 | 802 | 89 | 17 | 5.88e-14 |
| 146 | 865 | astral-147 | 823 | 92 | 18 | 1.74e-10 |
| 147 | 865 | astral-164 | 798 | 90 | 17 | 2.92e-12 |
| 148 | 865 | astral-178 | 825 | 94 | 21 | 1.25e-11 |
| 149 | 867 | astral-145 | 796 | 89 | 26 | 6.71e-12 |
| 150 | 867 | astral-162 | 789 | 92 | 17 | 1.5e-13 |
| 151 | 868 | astral-151 | 733 | 93 | 19 | 1.46e-14 |
| 152 | 868 | astral-163 | 790 | 93 | 19 | 5.8e-12 |
| 153 | 869 | astral-160 | 856 | 92 | 18 | 5.78e-12 |
| 154 | 870 | astral-166 | 800 | 97 | 27 | 2.66e-11 |
| 155 | 870 | astral-174 | 794 | 94 | 18 | 4.88e-13 |
| 156 | 871 | astral-148 | 842 | 92 | 16 | 3.91e-13 |
| 157 | 871 | astral-153 | 748 | 93 | 19 | 2.44e-11 |
| 158 | 871 | astral-173 | 768 | 90 | 21 | 2.01e-12 |
| 159 | 872 | astral-176 | 816 | 92 | 27 | 6.86e-12 |
| 160 | 873 | astral-156 | 805 | 97 | 19 | 1.33e-10 |
| 161 | 874 | astral-171 | 760 | 89 | 15 | 8.19e-15 |
| 162 | 875 | astral-155 | 779 | 93 | 27 | 3.62e-12 |
| 163 | 877 | astral-165 | 798 | 91 | 18 | 2.94e-11 |
| 164 | 878 | astral-154 | 749 | 92 | 18 | 1.94e-11 |
| 165 | 878 | astral-169 | 834 | 92 | 18 | 8.75e-15 |
| 166 | 878 | astral-172 | 766 | 91 | 22 | 3.03e-13 |
| 167 | 881 | astral-141 | 706 | 90 | 27 | 2.67e-12 |
| 168 | 882 | astral-149 | 882 | 92 | 16 | 1.72e-10 |
| 169 | 883 | astral-142 | 725 | 89 | 24 | 2.41e-11 |
| 170 | 883 | astral-168 | 811 | 89 | 21 | 1.02e-12 |
| 171 | 886 | astral-177 | 820 | 89 | 19 | 6.88e-13 |
| 172 | 888 | astral-143 | 784 | 92 | 25 | 8.46e-11 |
| 173 | 892 | astral-152 | 736 | 90 | 18 | 3.01e-12 |
| 174 | 892 | astral-179 | 844 | 91 | 26 | 6.13e-12 |
| 175 | 897 | astral-170 | 897 | 89 | 20 | 1.23e-11 |
| 176 | 900 | astral-157 | 828 | 89 | 23 | 3.96e-12 |
| 177 | 905 | astral-150 | 905 | 89 | 22 | 2.72e-10 |
| 178 | 925 | astral-159 | 855 | 89 | 23 | 1.82e-11 |
| 179 | 926 | astral-161 | 776 | 90 | 24 | 2.37e-14 |
| 180 | 951 | astral-180 | 844 | 89 | 22 | 1.45e-11 |

Verification:

- 492 unit/integration tests across 68 files passed, including all 180 campaign solutions and all forty Astral migration/reward checks.
- Build and TypeScript passed; the pre-existing large-chunk warning remains.
- Responsive map checks and a browser migration of three old Astral completions passed, preserving stars, 3,575 coins, 73 gems and original recovery bytes in isolated test storage.
- Desktop Chrome keyboard and emulated Pixel 7 touch playthroughs passed for Levels 141, 150, 151, 160, 161, 170, 171 and 180. Non-DEV storage stayed unchanged. Mobile screenshots were inspected for legible arrows and mechanic badges.
- Levels 1–140 and the frozen scoring calibration are unchanged.
- Documentation links and index coverage passed.

No real account data or user browser saves were used for these tests.

Human playtesting, physical-device checks and the pre-existing cloud snapshot-size limit remain separate acceptance gaps.
