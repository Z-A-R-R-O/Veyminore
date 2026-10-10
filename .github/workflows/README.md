# Workflows

`zetro-ci.yml` runs the monorepo's pnpm workspace tests and ZETRO typecheck on pushes to `main` and pull requests. The ZETRO subtree has its own `.github/workflows/ci.yml` so its standalone mirror receives the same basic gate. Neither workflow needs a Groq key or a live Antigravity connection.
