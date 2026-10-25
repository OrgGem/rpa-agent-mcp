param([ValidateSet('Install','Uninstall','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
$hostName = 'com.uipath.chromenativemsg_v2'
$subKey = 'Software\Google\Chrome\NativeMessagingHosts\' + $hostName
$manifestPath = Join-Path $PSScriptRoot 'native-host.json'
$launcherPath = Join-Path $PSScriptRoot 'native-host.cmd'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$entryPath = Join-Path $PSScriptRoot 'src\bridge.mjs'

function Get-Registrations {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
            $key = $base.OpenSubKey($subKey)
            try { if ($key) { [pscustomobject]@{Hive=$hive.ToString();View=$view.ToString();Manifest=$key.GetValue('')} } }
            finally { if ($key) {$key.Dispose()}; $base.Dispose() }
        }
    }
}
$registrations = @(Get-Registrations)
if ($Mode -eq 'Status') { $registrations | Format-Table -AutoSize; return }
if ($Mode -eq 'Install') {
    $foreign = @($registrations | Where-Object { $_.Manifest -ne $manifestPath })
    if ($foreign.Count) { throw 'Another UiPath native host is registered. No existing registration was overwritten.' }
    $extensionPath = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Extensions\jfcmnbofjlffnejneillkgbniiidiigd\23.10.1_0\manifest.json'
    if (!(Test-Path -LiteralPath $extensionPath)) { throw 'The inspected UiPath 23.10.1 extension was not found. Recheck compatibility before installation.' }
    [ordered]@{name=$hostName;description='Local UiPath browser MCP bridge prototype';path=$launcherPath;type='stdio';allowed_origins=@('chrome-extension://jfcmnbofjlffnejneillkgbniiidiigd/')} |
        ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding ASCII
    ('@echo off' + "`r`n" + '"' + $nodePath + '" "' + $entryPath + '" native %*' + "`r`n") |
        Set-Content -LiteralPath $launcherPath -Encoding ASCII
    $snapshotPath = Join-Path $PSScriptRoot 'registration-before.json'
    if (!(Test-Path -LiteralPath $snapshotPath)) {
        [ordered]@{capturedAt=(Get-Date -Format o);registrations=@($registrations)} | ConvertTo-Json -Depth 4 |
            Set-Content -LiteralPath $snapshotPath -Encoding UTF8
    }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry32)
    try { $key=$base.CreateSubKey($subKey); try {$key.SetValue('',$manifestPath,[Microsoft.Win32.RegistryValueKind]::String)} finally {$key.Dispose()} }
    finally {$base.Dispose()}
    Write-Output 'Installed the current-user registration. Existing UiPath extension files are unchanged.'
} else {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        $key=$base.OpenSubKey($subKey)
        try {$owned=($null -ne $key -and $key.GetValue('') -eq $manifestPath)} finally {if($key){$key.Dispose()}}
        try {if($owned){$base.DeleteSubKey($subKey,$false)}} finally {$base.Dispose()}
    }
    Write-Output 'Removed only this prototype registration. A running host remains until Chrome disconnects it.'
}
