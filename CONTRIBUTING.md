# Contributing to Veyminore

## Placement rules

- Ship a maintained customer-facing offering in `products/<product-name>/`.
- Put unfinished or exploratory work in `labs/experiments/`, `labs/prototypes/`, or `labs/research/`.
- Put code reused by two or more products in `packages/<package-name>/`.
- Keep deployment and platform configuration in `infrastructure/`, not in product application code unless it is product-specific.
- Record durable technical choices as Architecture Decision Records in `docs/decisions/`.

Do not create a catch-all `projects/` directory.

## Naming

- Directories and package names use lowercase kebab-case.
- Workspace packages use the `@veyminore/` scope.
- Product manifests use a lowercase kebab-case `name`.
- Branch, commit, and pull-request conventions are documented in `docs/standards/`.

## Product contract

Every product must include:

- `README.md` — purpose, owner, local setup, and operating notes.
- `veyminore.json` — product metadata and lifecycle status.
- `package.json` when the product contains a Node.js workspace.
- `.env.example` when it depends on runtime configuration.

Use only the directories a product needs. A mature multi-app product may use `apps/`, `packages/`, `docs/`, `tests/`, and `scripts/`; a small product can remain a single application.

## Before opening a pull request

Run the relevant quality checks and update docs, manifests, and ADRs when the change affects public behavior, ownership, architecture, or operating procedures.

