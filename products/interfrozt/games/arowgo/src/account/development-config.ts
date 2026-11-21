/** Public development identifiers. Never put OAuth secrets or PlayFab keys here.
 * Console setup alone does not enable the account service or prove login works.
 */
export const developmentAccountConfig = Object.freeze({
  enabled: false,
  environment: "development",
  playFabTitleId: "116A87",
  googleProjectId: "arowgo-dev",
  googleWebClientId:
    "169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com",
  webOrigin: "http://localhost:4173",
  androidPackageName: "com.veyminore.arowgo",
} as const);
