# Development account setup

Updated 20 November 2026. [Current flow and limits](ACCOUNT-SERVICES.md). The web flow uses Google ID tokens and PlayFab OIDC, not the retired authorization-code spike.

1. Use Node >=24. Keep secrets in the ignored `.env.development.local`; never add them to browser variables, screenshots or Git.
2. Google Web client configuration is recorded in `src/account/development-config.ts`. Use the authorized local origin `http://localhost:4173`. PlayFab title is `116A87`; the OIDC connection name is `google-web`.
3. For a fresh provider setup, inspect and run `server/account/setup-oidc.ps1` interactively. It prompts for required secrets without echoing them. Existing connections should be inspected rather than blindly recreated. The original workstation already reported successful connection creation and live login.
4. Start `pnpm account:server` and `pnpm account:web` in separate terminals. The server loads the optional local environment file and binds the local account port; the web origin is `http://localhost:4173`.
5. Open Profile > Account, sign in and verify the connected state. Google consent alone is not proof of a successful PlayFab session. Server restart may require signing in again.

`localhost` and `127.0.0.1` have different browser saves. Keep the existing origin when checking progress; do not clear storage or copy currency manually between accounts.

Cloud sync requires `AROWGO_CLOUD_SYNC=1` and `VITE_AROWGO_CLOUD_SYNC=1`; automatic completion uploads additionally require `VITE_AROWGO_AUTO_SYNC=1` and a confirmed account/revision anchor. The isolated real-provider probe uses `AROWGO_CLOUD_PROBE=1`. Flags are gates, not proof of capacity or permission to overwrite data. Full-history capacity remains unresolved; see [gaps](GAME-EXPERIENCE-GAPS.md).

Account-wallet activation is separate: follow the reviewed migration/restore workflow in [server economy](SERVER-ECONOMY.md). It is not enabled simply by signing in. Production and native provider acceptance remain open.
