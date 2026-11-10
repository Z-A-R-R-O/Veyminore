# InterFrozt

InterFrozt is Veyminore's games initiative. This directory is reserved for games and their product, design, engineering, content and release documentation. It is part of Veyminore, not a separate company.

**Owner:** Veyminore. Individual development and release owners are not assigned yet.\
**Status:** Planning; no game implementation or release is claimed here.

## Games

| Game | Direction | Status |
| --- | --- | --- |
| [AROWGO](games/arowgo/README.md) | Calm bent-arrow extraction puzzle; Android target, web prototype | Pre-production; mechanic needs validation |

## Structure and operation

Each game lives in `games/<game-name>/` with its own README, metadata, Markdown masterplan, focused specifications, decisions and references. Shared game technology should be extracted only after actual reuse is demonstrated.

Start with the [AROWGO documentation index](games/arowgo/docs/README.md). There is no installation, environment configuration or runnable workspace for InterFrozt yet. Add runtime manifests and setup instructions when implementation begins. The existing root pnpm globs do not discover nested game workspaces; update them deliberately when code is introduced.

The existing InterFrozt website is outside this documentation change. This games-only repository scope does not claim that its content or private source has been changed.
