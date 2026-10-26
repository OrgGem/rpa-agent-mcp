param(
  [string]$OutputPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'work/companion-unpacked')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workRoot = [IO.Path]::GetFullPath((Join-Path $root 'work'))
$output = [IO.Path]::GetFullPath($OutputPath)
$prefix = $workRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Companion build output must stay under this repository work directory.'
}

$manifestSource = Join-Path $root 'companion/manifest.json'
$protocolSource = Join-Path $root 'src/companion-protocol.mjs'
$hostSource = Join-Path $root 'src/companion-host.mjs'
$axePackagePath = Join-Path $root 'node_modules/axe-core/package.json'
$axeBundlePath = Join-Path $root 'node_modules/axe-core/axe.min.js'
$axeLicensePath = Join-Path $root 'node_modules/axe-core/LICENSE'
foreach ($required in @($manifestSource, $protocolSource, $hostSource, $axePackagePath, $axeBundlePath, $axeLicensePath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required companion source is missing: $required" }
}

$axePackage = Get-Content -LiteralPath $axePackagePath -Raw | ConvertFrom-Json
if ($axePackage.version -ne '4.14.0' -or $axePackage.license -ne 'MPL-2.0') {
  throw 'Companion build requires axe-core 4.14.0 under MPL-2.0.'
}
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$manifest = Get-Content -LiteralPath $manifestSource -Raw | ConvertFrom-Json
$keyBytes = [Convert]::FromBase64String($manifest.key)
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $digest = $sha256.ComputeHash($keyBytes) } finally { $sha256.Dispose() }
$id = -join ($digest[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
$protocolText = Get-Content -LiteralPath $protocolSource -Raw
if ($id -ne 'dppcppnipbmolajgbbackncmhgejpena' -or $protocolText -notmatch [regex]::Escape($id)) {
  throw 'The companion manifest key and pinned extension ID do not match.'
}

if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
$extensionOut = Join-Path $output 'extension'
New-Item -ItemType Directory -Path $extensionOut -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'companion/backend.mjs') -Destination $extensionOut
Copy-Item -LiteralPath (Join-Path $root 'companion/storage.mjs') -Destination $extensionOut
Copy-Item -LiteralPath (Join-Path $root 'companion/protocol.mjs') -Destination $extensionOut
Copy-Item -LiteralPath (Join-Path $root 'companion/service-worker.mjs') -Destination $extensionOut
Copy-Item -LiteralPath $manifestSource -Destination (Join-Path $extensionOut 'manifest.json')
Copy-Item -LiteralPath $protocolSource -Destination (Join-Path $extensionOut 'companion-protocol.mjs')
$protocolBridge = "export * from './companion-protocol.mjs';`r`n"
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
[IO.File]::WriteAllText((Join-Path $extensionOut 'protocol.mjs'), $protocolBridge, $utf8NoBom)
Copy-Item -LiteralPath $axeBundlePath -Destination (Join-Path $extensionOut 'axe.min.js')
Copy-Item -LiteralPath $axeLicensePath -Destination (Join-Path $extensionOut 'AXE-LICENSE.txt')
Set-Content -LiteralPath (Join-Path $extensionOut 'axe-core-version.txt') -Value $axePackage.version -NoNewline -Encoding ASCII

$nativeHostLauncher = Join-Path $output 'companion-host.cmd'
$nodeCommand = [IO.Path]::GetFullPath($node.Source).Replace('%','%%')
$hostCommand = [IO.Path]::GetFullPath($hostSource).Replace('%','%%')
$launcher = @(
  '@echo off'
  'chcp 65001>nul'
  'setlocal DisableDelayedExpansion'
  ('"' + $nodeCommand + '" "' + $hostCommand + '" %*')
  'exit /b %errorlevel%'
) -join "`r`n"
[IO.File]::WriteAllText($nativeHostLauncher, $launcher + "`r`n", $utf8NoBom)
$nativeHostManifest = [ordered]@{
  name = 'com.uipath.companion_v1'
  description = 'UiPath typed browser companion transport'
  path = $nativeHostLauncher
  type = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
}
$nativeHostOut = Join-Path $output 'com.uipath.companion_v1.json'
$json = $nativeHostManifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($nativeHostOut, $json, $utf8NoBom)

& $node.Source (Join-Path $PSScriptRoot 'validate-companion-package.mjs') $output
if ($LASTEXITCODE -ne 0) { throw 'Built companion package failed validation.' }
& $node.Source (Join-Path $PSScriptRoot 'test-companion-launcher.mjs') $output
if ($LASTEXITCODE -ne 0) { throw 'Generated native-host launcher self-test failed.' }

[pscustomobject]@{
  extensionId = $id
  extensionDirectory = $extensionOut
  nativeHostManifest = $nativeHostOut
  nativeHostLauncher = $nativeHostLauncher
  nativeHostCommand = $node.Source
  axeCoreVersion = $axePackage.version
}
