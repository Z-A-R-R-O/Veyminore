# Veyminore

Veyminore is the engineering ecosystem for products we ship, ideas we explore, and technology we reuse.

## Mental model

| Area | Purpose |
| --- | --- |
| `products/` | Durable customer-facing products Veyminore owns and ships. |
| `labs/` | Experiments, research, and prototypes that have not yet become products. |
| `packages/` | Shared internal technology that can be consumed across products. |
| `infrastructure/` | Platform configuration for cloud, delivery, data, monitoring, and security. |
| `docs/` | Architecture, standards, decisions, and product knowledge. |
| `company/` | Brand, strategy, legal, operations, and shared company assets. |
| `templates/` | Starting points for consistent new work. |
| `scripts/` | Repository automation. |

## Lifecycle

`labs` → `products` and/or `packages` → `infrastructure`

An experiment graduates only when it has a clear owner, purpose, and support expectation. Promote reusable technology into `packages/`; promote a shippable offering into `products/`.

## Current product

- [ZETRO](products/zetro/README.md) — local computer execution and agent orchestration. Its Antigravity adapter is the first executable slice.

## Getting started

1. Install Node.js and pnpm versions compatible with the root `package.json`.
2. Run `pnpm install`.
3. Copy the closest template from `templates/` when starting new work.
4. Add a `veyminore.json` manifest to every product and package.

See [CONTRIBUTING.md](CONTRIBUTING.md) for naming, placement, and contribution rules.
