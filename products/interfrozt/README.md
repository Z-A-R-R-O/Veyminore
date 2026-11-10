# InterFrozt

InterFrozt is Veyminore's games initiative. This directory is reserved for games and their product, design, engineering, content and release documentation. It is part of Veyminore, not a separate company.

**Owner:** Veyminore. Individual development and release owners are not assigned yet.\
**Status:** In development; AROWGO has a tested browser prototype. No production release is claimed.

## Games

| Game | Direction | Status |
| --- | --- | --- |
| [AROWGO](games/arowgo/README.md) | Calm bent-arrow extraction puzzle; Android target, web prototype | First browser playable; native/device validation pending |

## Structure and operation

Each game lives in `games/<game-name>/` with its own README, metadata, Markdown masterplan, focused specifications, decisions and references. Shared game technology should be extracted only after actual reuse is demonstrated.

Start with the [AROWGO documentation index](games/arowgo/docs/README.md). AROWGO is a runnable pnpm workspace under `games/arowgo`; see its README for setup and checks. The root workspace configuration includes nested InterFrozt games.

The existing InterFrozt website is outside this documentation change. This games-only repository scope does not claim that its content or private source has been changed.
