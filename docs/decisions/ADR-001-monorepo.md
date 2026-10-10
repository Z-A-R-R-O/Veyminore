# ADR-001: Organize Veyminore as a product-centered monorepo

- Status: Accepted
- Date: 2026-10-06

## Context

Veyminore needs a durable home for shipped products, experiments, reusable
technology, company operations, and documentation without treating all work as
temporary projects.

## Decision

Use top-level `products`, `labs`, `packages`, `infrastructure`, `docs`,
`company`, `templates`, and `scripts` directories. Manage JavaScript/TypeScript
workspaces with pnpm and Turbo.

## Consequences

Products have clear ownership boundaries; experiments remain separate until they
graduate; and reusable technology has an intentional home. The repository gains
lightweight governance requirements for manifests and ADRs.

