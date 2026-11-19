# Run interactively. This configures only development title 116A87.
$ErrorActionPreference = 'Stop'
Write-Host 'Creates the google-web OpenID connection in PlayFab development title 116A87.'
Write-Host 'Google tokens will be accepted for the configured Web client. Our backend validates the session nonce.'
Write-Host 'PlayFab IgnoreNonce is enabled for this brokered flow; the backend still requires a matching single-use nonce.'
if ((Read-Host 'Type CREATE to configure this development connection') -cne 'CREATE') { return }
$titleKeySecure = Read-Host 'PlayFab title secret key (hidden)' -AsSecureString
$googleSecretSecure = Read-Host 'Google Web OAuth client secret (hidden)' -AsSecureString
$titleKeyPlain = [System.Net.NetworkCredential]::new('', $titleKeySecure).Password
$googleSecretPlain = [System.Net.NetworkCredential]::new('', $googleSecretSecure).Password
try {
  $payload = @{
    ConnectionId = 'google-web'
    ClientId = '169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com'
    ClientSecret = $googleSecretPlain
    IssuerDiscoveryUrl = 'https://accounts.google.com/.well-known/openid-configuration'
    IgnoreNonce = $true
  } | ConvertTo-Json -Compress
  $result = Invoke-RestMethod -Method Post -Uri 'https://116A87.playfabapi.com/Admin/CreateOpenIdConnection' -Headers @{ 'X-SecretKey' = $titleKeyPlain } -ContentType 'application/json' -Body $payload
  if ($result.code -ne 200) { throw 'Connection was not confirmed.' }
  Write-Host 'Created google-web. Configuration succeeded; now test sign-in.'
} catch {
  Write-Host 'Setup was not confirmed. Check title permissions or whether google-web already exists. Existing connections are never overwritten by this script.'
  exit 1
} finally {
  $titleKeyPlain = $null; $googleSecretPlain = $null; $payload = $null; $result = $null
  $titleKeySecure.Dispose(); $googleSecretSecure.Dispose()
}
