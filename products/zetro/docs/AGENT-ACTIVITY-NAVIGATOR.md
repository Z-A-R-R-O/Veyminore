# Agent activity navigator

## Goal

Replace the Control Center's left placeholder with a quiet, project-like agent tree inspired by the supplied references. Keep the three bottom docks as primary route navigation and the right tool rail independently hideable.

## Layout

- Show the current workspace heading, followed by collapsible AGR, OCR, and RCT groups. Do not invent other projects or agents.
- Each agent row has a fixed name lane, an optional one-line assignment, and a trailing status marker. The selected row uses a restrained rounded highlight.
- Long groups initially show a small stable subset and an accessible Show more/Show less action. Preserve expansion and selection through ordinary data refreshes.
- A compact filter offers All, Observed active, and Needs attention. Show counts only when supported by the current projection.
- Selecting a row opens the existing worker detail UI, including latest observation, assigned task, and evidence already available there. Keyboard activation and focus return must work.
- On narrow screens, use a compact rail or overlay without covering the Work composer or bottom dock. The right tool rail remains hideable.

## State and truthfulness

- Derive rows from `/api/status` worker data. Treat saved assignments, worker claims, and live observations as distinct facts.
- Active requires an explicit fresh observed running/busy/working state. Missing, unavailable, stale, or malformed observations show a neutral unknown state.
- Needs attention includes explicit failure, timeout, reconciliation, or review-required evidence. Never infer completion from idle, a worker claim, or a blue dot.
- Time labels use a real timestamp when present; otherwise omit them. Label stale observations explicitly.
- Sort by needs attention, then observed active, then remaining agents; preserve stable identity order within each bucket to prevent refresh jumps.
- Empty and unavailable data show a truthful quiet state, not sample workers or a fabricated connected state.

## Acceptance

- Existing worker detail and bottom docks still work. No new dispatch or provider calls.
- Desktop and narrow viewport checks show no overlap or horizontal overflow.
- Filter, collapse, show-more, keyboard access, and status mapping have focused tests where behavior is nontrivial.
- Respect reduced motion and avoid replaying entry animation on each 10-second refresh.
