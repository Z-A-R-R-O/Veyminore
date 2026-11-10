# Masterplan review and recommendations

Reviewed 10 November 2026 against the supplied Markdown and six images. This is a consistency/design review, not an SDK, legal, market or platform-policy audit. [Index](README.md)

## Assessment

The strongest parts are the pure game-domain boundary, independent solution verification, offline-first campaign, phased online services and explicit acceptance gates. Keep these. The main weakness is that some beautiful screen concepts still imply systems deliberately excluded from the MVP, and some rule descriptions disagree.

## Prioritized changes

| ID | Priority | Evidence / issue | Recommended change | Completion evidence |
| --- | --- | --- | --- | --- |
| R01 | P0 | Source §§2.4 and 3.1: retraction animation versus rigid translation | Use rigid visual translation in the prototype; compare extraction alternatives before locking rules | Recorded example with body-only blocker and agreed rule |
| R02 | P0 | §§3.1, 3.9 and Gate A: blocked move “unchanged” versus lost heart | Define occupancy unchanged, attempt/mistake state updated once; zero hearts ends attempt | State snapshots before/after blocked action and duplicate input |
| R03 | P0 | §3.8 permits any selected arrow; D-10 says blocked arrow | Provisional Erase may remove any active arrow after confirmation, spending one charge and marking assisted | Eligible/empty/cancel/no-charge/final-arrow tests |
| R04 | P0 | §3.9 / §5.6 score optimization by removal count | Under removal-only rules, every full clear removes exactly N arrows; successful move count is invariant | Define attempts separately; score mistakes/assists, not a fictitious shorter solution |
| R05 | P1 | HUD shows 5/5 hearts with plus; gameplay shows 3 slots | Keep per-level mistake hearts; remove app-wide heart refill and paid-heart UI | Same meaning on tutorial, gameplay and results |
| R06 | P1 | Six-tab navigation and many shortcuts imply later systems | Ship functional destinations only; Home, World, Profile baseline; Story/practice reachable without a large modes catalog | No dead tabs, fake badges or unexplained locks |
| R07 | P1 | World image duplicates level 24; Play 23 and progression can be ambiguous | Use unique IDs and one explicit selected/current-level model | Map, title and Play target agree after selection and resume |
| R08 | P1 | Shop prices, crates and deal timers are illustration content | Start with earned, explicitly described cosmetics; defer cash store and random paid rewards | No placeholder price, synthetic countdown or nonfunctional buy action |
| R09 | P1 | Profile shows 3,892 stars and 146 clears | Define stars as sum of per-level bests; with 3 max each, 146 levels imply at most 438 campaign stars | Derived stats from fixtures, clear labels if other totals exist |
| R10 | P1 | Gameplay screenshot is dense and double exit/home controls consume space | Prototype board hit testing and one pause/exit path on narrow phones; add readable focus states | Device capture plus successful uncoached selection of bent paths |
| R11 | P1 | Slice targets differ across §§4, 15, 22 | One-level slice → ~10-level tutorial alpha → 30–40-level MVP | Milestone evidence, not calendar promises |
| R12 | P1 | Save safety named but recovery details incomplete | Atomic snapshot with schema/rules/content versions, attempt ID and reward ledger; preserve last valid snapshot | Kill/resume during action/result and migration/corruption checks |
| R13 | P1 | Broad analytics taxonomy before product validation | Start with tutorial, level start/complete/restart and aggregate mistakes/assists; define consent, retention and deletion before transmission | Event dictionary and sample payload review; no unneeded identity data |
| R14 | P2 | Classic/Infinity overlap and expensive future systems | One untimed repeat-play mode first; keep Infinity, tournaments and live mode off the MVP roadmap | Distinct player need and operating owner before promotion |
| R15 | P0 before dependency installation | Exact engine versions and policy verification dates are source claims | Perform a fresh dependency/device spike and record authoritative dated evidence; do not inherit “latest” claims | Selected versions, lockfile and spike ADR |

## Recommended scoring experiment

Proposed only: one star for any completed Story attempt; two for an unassisted completion with at most one mistake; three for an unassisted zero-mistake completion. Hint, Analyze and Erase all mark the run assisted. Practice does not update campaign stars or rewards. No timer affects Story stars. Publish the rule before play, then test whether assist penalties discourage learning; a completion-only star model is a valid alternative if that happens.

Define `successfulRemovals`, `blockedAttempts`, `assistsUsed` and `attempts` independently. Do not count a tool preview or canceled Erase as a move. Score proposals must be versioned before content/rewards depend on them.

## Recommended balance and performance work

Compare unlimited-mistake practice with the three-heart Story rule before introducing any energy system. Record first-session confusion, retries and willingness to continue. Replace vague “fast” performance goals with measured budgets after selecting a representative device; record launch time, input-to-feedback latency, frame times and memory over repeated level loads. Avoid fabricated thresholds before a baseline exists.

## Remaining unknowns

The still images cannot verify the movement rule, solution to the pictured board, animation timing or actual usability. Named team members, capacity, licenses, name clearance, publisher eligibility and verified SDK versions are not established. These are recorded as open evidence tasks rather than assumed facts.
