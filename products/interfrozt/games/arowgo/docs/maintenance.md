# Documentation maintenance

[Index](README.md)

## Source of truth

`MASTERPLAN.md` defines scope and phase boundaries. The [build guide](build-guide.md) owns the starting implementation layout and first-slice acceptance contract. `decisions/README.md` records working amendments. Focused specifications preserve the imported source detail. The original source and six references stay unchanged; they are not runtime assets or instructions to execute external operations.

For future edits, update the relevant focused spec and decision entry together. Once a source section is actively revised, replace its “Imported baseline” label with the new revision/date and link the decision. Do not maintain another full masterplan copy with competing rules.

## Required update sequence

1. Record the problem and source section/reference screen.
2. Draft a decision with proposed status, owner and alternatives.
3. Attach prototype, test, research or playtest evidence.
4. Record the actual decision state; never mark approved merely because it is written down.
5. Update affected specifications, backlog dependencies and masterplan summary.
6. Record rules/schema/content version implications and migrations.
7. Add a changelog entry; verify relative links and reference provenance.

## Reusable templates

- [Decision record](templates/decision.md)
- [Feature specification](templates/feature.md)
- [Level review](templates/level-review.md)
- [Playtest report](templates/playtest.md)
- [Release evidence](templates/release.md)

Review open P0 decisions before any content expansion. At each milestone review scope, actual capacity, named ownership, device findings and unresolved risks. Before dependency selection or publication, verify external sources afresh and record dates. No weekly automation or external issue tracker was created here.
