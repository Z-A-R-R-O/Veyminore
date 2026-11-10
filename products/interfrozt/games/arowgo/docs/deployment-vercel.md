# Vercel static deployment

AROWGO is a client-only Vite build. Deploy the compiled site using Vercel Build Output API version 3; source documents, Android files, tests and local settings are not uploaded with this package.

From this game directory:

```powershell
npx --yes vercel@65.14.0 login
npx --yes vercel@65.14.0 link
pnpm build
node scripts/prepare-vercel.mjs
npx --yes vercel@65.14.0 deploy --prebuilt --prod
```

Select the intended account/team and AROWGO project when linking. The preparation script replaces only this game's `.vercel/output`, retaining `.vercel/project.json`. `.vercel/` is ignored by Git. No server or environment variables are needed.

After deployment, check the public URL, font/scenery requests, arrow interaction, saved-progress reload and completion. Browser localStorage belongs to each origin: localhost saves do not automatically transfer to the public Vercel URL. Keep the production alias stable for future visits.

## Production record — 10 November 2026

- Live URL: https://arowgo.vercel.app
- Vercel project: `zarros-projects-e983b612/arowgo`.
- Deployment: `dpl_EKyVHtLzVXvRWrP8RArMUtjyC8sd`, production READY.
- Inspector: https://vercel.com/zarros-projects-e983b612/arowgo/EKyVHtLzVXvRWrP8RArMUtjyC8sd
- Source build: local tested game at commit `2e0fb84`; packaging commit `1cd8c80`.
- Anonymous browser verification: HTTP 200, game canvas ready, Satoshi loaded, blocked B costs one heart, A clears, reload retains nine arrows and two hearts, no page errors.
- [Live screenshot](verification/vercel-live.png).

Vercel linked `Z-A-R-R-O/Veyminore` automatically. Project build settings point to `products/interfrozt/games/arowgo`, `pnpm build`, output `dist`. This production release used the locally prepared static build; no Git push or Git-triggered build was performed or verified. Local account tokens and Vercel environment files remain ignored.

## Curved recoil / tools release — 10 November 2026

Production updated from commit `203f62c`; deployment `dpl_4d4G6hkHjyYG6SqU75YYKorjPCsY`. Public alias remains https://arowgo.vercel.app. Anonymous live smoke check passed: HTTP 200, Analyze absent, Hint spark present, blocked D costs one heart, confirmed Erase removes D and persists after reload, no page errors. Local validation: eight affected desktop/phone browser cases plus two dedicated curved-recoil cases passed; formatting, typecheck, production build and Android asset sync passed.

## Mobile viewport release — 10 November 2026

- Source commit: `4c66813`.
- Production deployment: `dpl_BVbKM9RBPEoDGgeZE2sBHJEoEjX2` (Ready).
- Live URL: https://arowgo.vercel.app
- Verified production HTTP 200 and no browser page errors in mobile emulation.
- Verified 390x844 portrait and rotation to 844x390 landscape: board, HUD, tools and mode controls remain within the viewport, without document scrolling.
- Local layout coverage also includes 320x568, 375x667 and 412x915; gameplay, retry and victory checks pass.
- Evidence: [Live mobile capture](verification/vercel-mobile-fit.png).
