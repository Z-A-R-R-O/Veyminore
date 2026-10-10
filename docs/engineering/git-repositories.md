# Repository publishing

`E:\Veyminore` is the only working Git repository and the source of truth. Its `origin` is `Z-A-R-R-O/Veyminore`. The `zetro` remote is a product-only mirror at `Z-A-R-R-O/zetro`; it contains the contents of `products/zetro` at its root, not a nested `.git` directory or a submodule.

After committing product changes to Veyminore, publish the parent first, then split and push the product:

```text
git push origin main
git subtree split --prefix=products/zetro
git push zetro <split-commit-sha>:main
```

Replace `<split-commit-sha>` with the SHA printed by `git subtree split`. Never force-push the product mirror. If its remote branch has diverged, inspect it before integrating anything; do not overwrite independent work. Changes made directly in the ZETRO GitHub repository do not automatically appear in Veyminore.

The product mirror has its own pnpm workspace and lockfile. After a ZETRO-only clone, run `pnpm install --frozen-lockfile`, `pnpm -r test`, and `pnpm typecheck` from its root. The parent monorepo retains its separate workspace and lockfile; run its commands from `E:\Veyminore`. CI workflows exist at both roots, so the subtree split carries ZETRO's standalone checks into its mirror.
