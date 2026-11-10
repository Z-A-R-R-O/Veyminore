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

Deployment status: package prepared; Vercel authentication is required before publishing. No live URL has been created by this workflow yet.
