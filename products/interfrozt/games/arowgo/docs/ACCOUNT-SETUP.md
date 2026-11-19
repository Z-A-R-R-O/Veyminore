# PlayFab and Google development setup

> Current web implementation now uses verified Google ID tokens and PlayFab OpenID Connect. The earlier authorization-code contract below is superseded for web. See [refactor and required setup](ACCOUNT-BACKEND-DEV.md).

Status updated 18 November 2026: PlayFab title 116A87 and Google project arowgo-dev are visible in the owner's supplied screenshots. The owner reports the Web OAuth client was created and the Google add-on installed in PlayFab. The supplied Web client ID is recorded in src/account/development-config.ts. The owner reports Android client creation and test-user registration are complete. Actual provider login/linking is not yet verified. Game sign-in remains disabled.

Web client ID (public identifier):

    169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com

## Proposed development values

| Setting                     | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| PlayFab studio              | InterFrozt (use the existing owned studio if present)   |
| PlayFab title               | AROWGO Dev                                              |
| Google project display name | AROWGO Dev                                              |
| Google app display name     | AROWGO Dev                                              |
| Audience                    | External, testing; add the owner's chosen test accounts |
| Web OAuth client name       | AROWGO Dev Web                                          |
| Android OAuth client name   | AROWGO Dev Android Debug                                |
| Android package             | com.veyminore.arowgo                                    |
| Local web testing origin    | http://localhost:4173                                   |
| Additional localhost origin | http://localhost                                        |

Use localhost consistently for the provider spike, rather than mixing localhost and 127.0.0.1 sessions. These hostnames have separate localStorage, so existing progress at 127.0.0.1 will not automatically appear at localhost. Do not clear or migrate it during the sign-in spike.

The project's Google project ID must be globally available; record the actual ID after creation. App support/developer email must be chosen by the owner. Do not guess legal entity, organization, billing or domain ownership.

## Console sequence

1. Sign in to https://developer.playfab.com/ with the intended owner account. Create/select the InterFrozt studio and a separate AROWGO Dev title; record its non-secret title ID. Keep this development-only.
2. Sign in to https://console.cloud.google.com/ with the intended project owner. Create/select AROWGO Dev. Do not enable unrelated APIs or paid services for this identity setup.
3. In Google Auth Platform, configure branding/contact information and the testing audience. Add the explicitly chosen test users. Production privacy policy, terms and domain verification are later release requirements, not invented placeholder URLs.
4. Create the Web application OAuth client. Add http://localhost and http://localhost:4173 as JavaScript origins. A callback URI must match the actual chosen code exchange flow; do not put #profile, #home, a wildcard, or an invented callback in the redirect field. Finalize this field during the provider spike.
5. Configure the PlayFab title's Google add-on with that web client ID and its client secret. The secret belongs in the intended provider/backend configuration only, never a VITE variable, source file, screenshot or chat. Creating credentials and enabling their access must be reviewed at the console step.
6. Create the Android OAuth client using the package and verified debug SHA-1 below. Native code acquisition will target the web/server client ID; Android client ID alone is not the backend code audience.
7. Record non-secret IDs in the implementation setup record. Keep secrets in the chosen secret manager. No developer secret is needed inside the game client.
8. Prove Google credential acquisition, PlayFab login, guest linking, already-linked conflict, cancellation and logout in the isolated development flow before enabling game UI. Never force-link identities or infer ownership from an email/display name.

## Verified local Android debug identity

Read from :app:signingReport using the existing Android Studio Java 21 installation on 16 November 2026. This identifies this machine's debug keystore, not the production app-signing certificate.

Package: com.veyminore.arowgo

SHA-1:

    7F:51:8C:F4:9E:C3:C3:E8:FE:76:D7:84:34:B3:FF:A2:18:AC:50:CC

SHA-256:

    B7:FC:5D:14:1A:20:23:70:65:2A:EE:66:17:DD:C2:D3:FB:D6:47:2F:6E:45:99:FE:C1:07:3C:A0:5B:97:25:92

Release signing is not configured. Later Play-distributed builds require the actual Play app-signing certificate and corresponding OAuth registration. Do not substitute the debug certificate or upload-key fingerprint for the app-signing fingerprint.

## Credential-flow gate

The current PlayFab LoginWithGoogleAccount REST schema accepts ServerAuthCode. Older HTML5 examples use legacy Google libraries/access-token patterns; do not copy those snippets into the current client. The Google Identity Services web code flow and native Android code flow must be tested for compatibility with the selected PlayFab exchange before treating the spike as complete. If a brokered OpenID Connect design is required, document the change explicitly instead of silently accepting an arbitrary token.

Provider console setup alone does not implement the trusted API, HttpOnly sessions, CSRF enforcement, guest provisioning, durable receipts or cloud migration. Those remain the account plan's B01/B02 gates.

## Official references checked

- [PlayFab Google title/add-on setup](https://learn.microsoft.com/en-us/gaming/playfab/identity/player-identity/platform-specific-authentication/google-html5) — console configuration reference; its older code examples are not the current integration plan.
- [PlayFab LoginWithGoogleAccount](https://learn.microsoft.com/en-us/rest/api/playfab/client/authentication/login-with-google-account?view=playfab-rest) — current credential contract.
- [Google web client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) — localhost origins and client configuration.
- [Google code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model) — popup/redirect and server exchange requirements.

See [B01 implementation](ACCOUNT-FOUNDATION.md) and [account architecture](BACKEND-ACCOUNT-PLAN.md).
