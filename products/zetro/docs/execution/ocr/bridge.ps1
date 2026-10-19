param(
  [ValidateSet('create','status','send','messages','permissions','abort')][string]$Action = 'status',
  [string]$Worker,
  [string]$PromptFile
)
$ErrorActionPreference = 'Stop'
$workspace = 'E:\Veyminore\products\zetro'
$baseUri = 'http://127.0.0.1:4097'
$statePath = Join-Path $PSScriptRoot 'DISPATCH.json'
$secretPath = Join-Path $env:LOCALAPPDATA 'Zetro\ocr-bridge\server-password.dpapi'
$secure = Get-Content -LiteralPath $secretPath | ConvertTo-SecureString
$credential = [pscredential]::new('opencode', $secure)
$headers = @{ Authorization = 'Basic ' + [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes('opencode:' + $credential.GetNetworkCredential().Password)) }

function Invoke-OcrApi([string]$Method, [string]$Route, $Body) {
  $separator = if ($Route.Contains('?')) { '&' } else { '?' }
  $uri = $baseUri + $Route + $separator + 'directory=' + [Uri]::EscapeDataString($workspace)
  $args = @{ Method=$Method; Uri=$uri; Headers=$headers; TimeoutSec=20 }
  if ($null -ne $Body) {
    $args.ContentType = 'application/json'
    $args.Body = $Body | ConvertTo-Json -Depth 20 -Compress
  }
  Invoke-RestMethod @args
}
function Save-State {
  $state | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $statePath -Encoding utf8
}
function Assert-Session($Entry) {
  $session = Invoke-OcrApi GET ('/session/' + $Entry.sessionId) $null
  if ($session.id -ne $Entry.sessionId -or $session.projectID -ne $state.projectId -or
      $session.directory.TrimEnd('\','/') -ine $workspace) {
    throw 'OCR session identity mismatch'
  }
  $session
}
function New-Rule($Permission, $Pattern, $Decision) {
  @{ permission=$Permission; pattern=$Pattern; action=$Decision }
}
$project = Invoke-OcrApi GET '/project/current' $null
$path = Invoke-OcrApi GET '/path' $null
if ($path.directory.TrimEnd('\','/') -ine $workspace -or $path.worktree -ine 'E:\Veyminore') {
  throw 'OCR project path mismatch'
}
$state = if (Test-Path -LiteralPath $statePath) {
  Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
} else {
  @{ projectId=$project.id; workspace=$workspace; server=$baseUri;
     model=@{providerID='opencode';modelID='mimo-v2.6-flash-free'}; workers=@{} }
}
if ($state.projectId -ne $project.id) { throw 'OCR project identity changed' }

if ($Action -eq 'create') {
  $packages = @('computer-contract','computer-runtime','computer-observer','opencode-adapter','computer-conformance')
  for ($i=1; $i -le 5; $i++) {
    $name = 'OCR-' + $i
    if ($state.workers.ContainsKey($name)) { continue }
    $owned = 'packages/' + $packages[$i-1]
    New-Item -ItemType Directory -Force -Path (Join-Path $workspace $owned) | Out-Null
    $rules = @((New-Rule '*' '*' 'deny'))
    foreach ($scope in @($owned,'packages/protocol','packages/policy')) {
      foreach ($prefix in @($scope, ($workspace.Replace('\','/') + '/' + $scope), ($workspace + '\' + $scope.Replace('/','\')))) {
        $rules += New-Rule 'read' ($prefix + '/*') 'allow'
        $rules += New-Rule 'read' ($prefix + '\*') 'allow'
      }
    }
    foreach ($prefix in @($owned, ($workspace.Replace('\','/') + '/' + $owned), ($workspace + '\' + $owned.Replace('/','\')))) {
      $rules += New-Rule 'edit' ($prefix + '/*') 'allow'
      $rules += New-Rule 'edit' ($prefix + '\*') 'allow'
    }
    $receipt = 'docs/execution/ocr/' + $name + '.md'
    foreach ($file in @($receipt,'docs/COMPLETION-PLAN.md','docs/RCT-EXPANSION-PLAN.md')) {
      $rules += New-Rule 'read' ('*' + $file) 'allow'
      $rules += New-Rule 'read' ('*' + $file.Replace('/','\')) 'allow'
    }
    $rules += New-Rule 'edit' ('*' + $receipt) 'allow'
    $rules += New-Rule 'edit' ('*' + $receipt.Replace('/','\')) 'allow'
    if ($entry.frontendScope) {
      $rules += New-Rule 'read' '*apps*control-center*public*' 'allow'
      $rules += New-Rule 'edit' ('*apps*control-center*public*' + $entry.frontendScope + '*') 'allow'
    }
    $rules += New-Rule 'read' '*.env*' 'deny'
    $rules += New-Rule 'edit' '*.env*' 'deny'
    $state.workers[$name] = @{ name=$name; ownedPath=$owned; receipt=$receipt;
      status='create_intent'; intentAt=[DateTime]::UtcNow.ToString('o') }
    Save-State
    try {
      $session = Invoke-OcrApi POST '/session' @{
        title=$name; agent='build'; model=@{providerID='opencode';id=$state.model.modelID}; permission=$rules
      }
      $state.workers[$name].sessionId = $session.id
      $state.workers[$name].status = 'created'
      Save-State
      Assert-Session $state.workers[$name] | Out-Null
      Write-Output ($name + ' created and identity verified')
    } catch {
      $state.workers[$name].status = 'creation_unknown'
      Save-State
      throw 'OCR creation failed or delivery unknown; inspect existing sessions before retry'
    }
  }
} elseif ($Action -eq 'permissions') {
  foreach ($entry in $state.workers.Values) {
    if ($Worker -and $entry.name -ne $Worker) { continue }
    Assert-Session $entry | Out-Null
    $package = $entry.ownedPath.Split('/')[-1]
    $rules = @((New-Rule '*' '*' 'deny'))
    $readScopes = @($package,'protocol','policy')
    if ($entry.name -in @('OCR-2','OCR-3','OCR-5')) {
      $readScopes += @('computer-contract','computer-runtime','computer-observer')
    }
    foreach ($scope in $readScopes) {
      $rules += New-Rule 'read' ('*packages*' + $scope + '*') 'allow'
    }
    $rules += New-Rule 'edit' ('*packages*' + $package + '*') 'allow'
    $rules += New-Rule 'read' ('*' + $entry.name + '.md') 'allow'
    $rules += New-Rule 'edit' ('*' + $entry.name + '.md') 'allow'
    $rules += New-Rule 'read' '*COMPLETION-PLAN.md' 'allow'
    $rules += New-Rule 'read' '*RCT-EXPANSION-PLAN.md' 'allow'
    if ($entry.frontendScope) {
      $rules += New-Rule 'read' '*apps*control-center*public*' 'allow'
      $rules += New-Rule 'edit' ('*apps*control-center*public*' + $entry.frontendScope + '*') 'allow'
    }
    $rules += New-Rule 'read' '*.env*' 'deny'
    $rules += New-Rule 'edit' '*.env*' 'deny'
    Invoke-OcrApi PATCH ('/session/' + $entry.sessionId) @{permission=$rules} | Out-Null
    $entry.permissionRevision = 2
    Save-State
    Write-Output ($entry.name + ' scoped Windows path rules updated')
  }
} elseif ($Action -eq 'send') {
  if (-not $Worker -or -not $PromptFile) { throw 'Worker and PromptFile are required' }
  $entry = $state.workers[$Worker]
  Assert-Session $entry | Out-Null
  if ($entry.status -in @('send_intent','delivery_unknown')) { throw 'Reconcile uncertain delivery before another send' }
  $prompt = Get-Content -LiteralPath $PromptFile -Raw
  $absoluteOwned = $workspace.Replace('\','/') + '/' + $entry.ownedPath
  $absoluteReceipt = $workspace.Replace('\','/') + '/' + $entry.receipt
  $prompt = @"
WORKSPACE CORRECTION: All tool file paths MUST be absolute.
Your writable package is $absoluteOwned/ . Your receipt is $absoluteReceipt .
Git root E:/Veyminore is NOT the product working directory. Never use E:/Veyminore/packages/.
Do not list root or read missing package metadata. New package files must be created directly.
Use write/edit tools now, not shell. If a tool fails twice, report the exact blocker and stop.
Do not repeat successful writes or external submissions. Tests unavailable to you must be marked NOT RUN.

$prompt
"@
  $messageId = 'msg' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString('x') + [Guid]::NewGuid().ToString('N').Substring(0,12)
  $entry.messageId = $messageId
  $entry.status = 'send_intent'
  $entry.sentAt = [DateTime]::UtcNow.ToString('o')
  Save-State
  try {
    Invoke-OcrApi POST ('/session/' + $entry.sessionId + '/prompt_async') @{
      messageID=$messageId; model=$state.model; agent='build'; parts=@(@{type='text';text=$prompt})
    } | Out-Null
    $entry.status = 'submitted'
    Save-State
    Write-Output ($Worker + ' acknowledged')
  } catch {
    $entry.status = 'delivery_unknown'
    Save-State
    throw 'OCR delivery unknown; do not resend'
  }
} elseif ($Action -eq 'abort') {
  $entry = $state.workers[$Worker]
  Assert-Session $entry | Out-Null
  $entry.abortIntentAt = [DateTime]::UtcNow.ToString('o')
  Save-State
  Invoke-OcrApi POST ('/session/' + $entry.sessionId + '/abort') @{} | Out-Null
  $entry.status = 'paused_for_permission_repair'
  Save-State
  Write-Output ($Worker + ' abort acknowledged')
} elseif ($Action -eq 'messages') {
  $entry = $state.workers[$Worker]
  Assert-Session $entry | Out-Null
  $messages = Invoke-OcrApi GET ('/session/' + $entry.sessionId + '/message?limit=2') $null
  foreach ($message in $messages) {
    [pscustomobject]@{
      worker=$Worker; id=$message.info.id; role=$message.info.role;
      completed=$message.info.time.completed; tokens=$message.info.tokens; cost=$message.info.cost;
      parts=@($message.parts | ForEach-Object {
        [pscustomobject]@{type=$_.type;tool=$_.tool;status=$_.state.status;
          text=if ($_.type -eq 'text') { $_.text.Substring(0,[Math]::Min(1600,$_.text.Length)) } else { $null }}
      })
    } | ConvertTo-Json -Depth 8 -Compress
  }
} else {
  $statuses = Invoke-OcrApi GET '/session/status' $null
  foreach ($entry in $state.workers.Values) {
    $session = Assert-Session $entry
    $recent = @(Invoke-OcrApi GET ('/session/' + $entry.sessionId + '/message?limit=2') $null)
    $assistant = @($recent | Where-Object { $_.info.role -eq 'assistant' }) | Select-Object -Last 1
    $runtime = $statuses.($entry.sessionId).type
    $observed = if ($assistant.info.error.name -eq 'MessageAbortedError') { 'interrupted' }
      elseif ($assistant.info.error.name) { 'failed' }
      elseif ($runtime -eq 'busy' -and -not $assistant.info.time.completed) { 'running_unverified' }
      elseif ($assistant.info.time.completed) { 'turn_completed_unverified' }
      else { 'idle_or_waiting' }
    $packageRoot = Join-Path $workspace $entry.ownedPath
    $files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue)
    [pscustomobject]@{worker=$entry.name; sessionId=$entry.sessionId; project=$session.projectID;
      title=$session.title; dispatch=$entry.status; runtime=$runtime; observed=$observed;
      lastError=$assistant.info.error.name; files=$files.Count;
      latestFile=($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name}
  }
}
