# Veyminore

**A technology venture in planning and development.**

Veyminore is the technology venture I’m building toward: a home for software products, experiments, reusable technology, and the engineering systems around them.

The ambition is long-term. The company and its products still have to earn their place through execution. This repository is an engineering workspace, not a claim that every planned product or company function is already launched.

## What this repository is

The public workspace gives projects a shared structure for decisions, standards, experiments, and reusable implementation. Its current organization separates product work from research and supporting technology.

| Area | Purpose |
| --- | --- |
| products/ | Product code and documentation with a defined direction |
| labs/ | Experiments, research, and prototypes not yet promoted to products |
| packages/ | Reusable technology shared across projects |
| infrastructure/ | Delivery, data, monitoring, and security configuration |
| docs/ | Architecture, standards, and engineering decisions |
| company/ | Brand, strategy, operations, and shared company material |
| templates/ | Repeatable starting points |
| scripts/ | Repository automation |

A folder is a boundary, not proof that everything inside it is complete.

## Current initiatives

### [ZETRO](products/zetro/README.md)

ZETRO explores controlled computer execution and agent-runtime infrastructure. Its documented executable slice is an Antigravity adapter plus a synthetic RCT pilot, both still in development. The generic computer runtime and dispatcher remain planned.

[Public repository](https://github.com/Z-A-R-R-O/zetro)

### InterFrozt

InterFrozt is an initiative under Veyminore focused on software products and startup-building. Its [public-facing site](https://interfrozt.vercel.app) is available; its source repository is private.

**Veyminore is the umbrella. InterFrozt belongs within it.** It is not a separate company.

## How work moves

The intended lifecycle is:

**Labs → Products and/or Packages → Infrastructure**

An experiment should graduate only when it has a clear purpose, an owner, evidence that it works, and an explicit support expectation. Reusable implementation belongs in packages; a shippable customer-facing offering belongs in products.

## Local development

Requirements: Node.js 20+ and pnpm 11+.

- Install: **pnpm install**
- Develop: **pnpm dev**
- Build: **pnpm build**
- Lint: **pnpm lint**
- Test: **pnpm test**
- Type-check: **pnpm typecheck**

These workspace commands are entry points, not a guarantee that every project passes every check. Evaluate each workspace on its own current implementation and verification evidence.

See [CONTRIBUTING.md](CONTRIBUTING.md) for repository conventions.

## Operating principle

Build the structure only as fast as the work can support it. A roadmap is not a release; a folder is not a product; a successful command is not a verified outcome.
