param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$NodePath,
    [switch]$EnableG0Probe
)
$ErrorActionPreference = 'Stop'
$checkoutRoot = [IO.Path]::GetFullPath($Root)
$launcherPath = Join-Path $checkoutRoot 'native-host.cmd'
$entryPath = Join-Path $checkoutRoot 'src\bridge.mjs'
$utf8 = [Text.UTF8Encoding]::new($false)
$manifest = [ordered]@{
    name='com.uipath.chromenativemsg_v2'
    description='Local UiPath browser MCP bridge prototype'
    path=$launcherPath
    type='stdio'
    allowed_origins=@('chrome-extension://jfcmnbofjlffnejneillkgbniiidiigd/')
} | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $checkoutRoot 'native-host.json'), $manifest + "`r`n", $utf8)

# CMD reads subsequent lines as UTF-8 after the ASCII-only preamble. No BOM or
# console output may precede the binary native-message stream. Disable delayed
# expansion and escape percent signs so literal checkout paths stay literal.
$probeFlag = if ($EnableG0Probe) { '1' } else { '' }
$nodeCommand = [IO.Path]::GetFullPath($NodePath).Replace('%','%%')
$entryCommand = $entryPath.Replace('%','%%')
$launcher = @(
    '@echo off'
    'setlocal DisableDelayedExpansion'
    'chcp 65001 >nul'
    'if errorlevel 1 exit /b 1'
    ('set "UIPATH_G0_PROBE=' + $probeFlag + '"')
    ('"' + $nodeCommand + '" "' + $entryCommand + '" native %*')
    'exit /b %errorlevel%'
) -join "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcher + "`r`n", $utf8)
