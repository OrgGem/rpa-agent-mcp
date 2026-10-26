param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
$entries = @('src','scripts','docs','test','companion','.github','AGENTS.md','EGM.md','README.md','LICENSE','Setup.ps1','package.json','package-lock.json','mcp.example.toml','.gitignore')
foreach ($entry in $entries) {
  $source = Join-Path $repoRoot $entry
  if (!(Test-Path -LiteralPath $source)) { throw "Missing source entry: $entry" }
}
if ($ValidateOnly) { [ordered]@{ validated=$true; version=$package.version; entries=$entries; scope='source-only; no host registration or publication' } | ConvertTo-Json; return }
$releaseRoot = Join-Path $repoRoot 'work\releases'
$resolvedOutput = [IO.Path]::GetFullPath($releaseRoot)
if (!$resolvedOutput.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escaped workspace' }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$name = 'rpa-agent-mcp-' + $package.version + '-' + [guid]::NewGuid().ToString('N').Substring(0,12)
$stage = Join-Path $releaseRoot $name
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($entry in $entries) { Copy-Item -LiteralPath (Join-Path $repoRoot $entry) -Destination $stage -Recurse }
$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -Force | Where-Object {
  $_.Name -in @('native-host.json','native-host.cmd','registration-before.json','com.uipath.companion_v1.json',
    'EmbeddedDriversContainer.js','axe.min.js','node_modules','.env') -or
  $_.Name -like '.env.*' -or $_.Extension -in @('.pem','.pfx')
}
if ($forbidden) { throw 'Generated host, dependency or vendor files entered source release' }
$archive = Join-Path $releaseRoot ($name + '.zip')
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[ordered]@{ created=$true; archive=$archive; sha256=$hash; version=$package.version; scope='Source archive only; no dependency bundle, registration, browser actions or publication.' } | ConvertTo-Json
