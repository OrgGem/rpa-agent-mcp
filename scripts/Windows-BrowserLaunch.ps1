[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$script:Protocol = 1
$script:MaxInputBytes = 64 * 1024
$script:MaxOutputBytes = 64 * 1024

function Write-Result($Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  $bytes = $utf8.GetBytes($json)
  if ($bytes.Length -gt $script:MaxOutputBytes) { throw 'output bound exceeded' }
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

function Read-Request {
  $bytes = New-Object System.Collections.Generic.List[byte]
  $stream = [Console]::OpenStandardInput()
  $buffer = New-Object byte[] 4096
  while ($true) {
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    if ($bytes.Count + $read -gt $script:MaxInputBytes) { throw 'input bound exceeded' }
    for ($index = 0; $index -lt $read; $index++) { $bytes.Add($buffer[$index]) }
  }
  $raw = $utf8.GetString($bytes.ToArray())
  if (-not $raw.EndsWith("`n", [StringComparison]::Ordinal)) { throw 'invalid framing' }
  $raw = $raw.Substring(0, $raw.Length - 1)
  if ($raw.Contains("`n") -or $raw.Contains("`r") -or $raw.Length -eq 0) { throw 'invalid framing' }
  return ConvertFrom-Json -InputObject $raw -ErrorAction Stop
}

function Assert-Shape($Object, [string[]]$Allowed, [string[]]$Required) {
  if ($null -eq $Object -or $Object -isnot [System.Management.Automation.PSCustomObject]) { throw 'bad object' }
  $names = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($name in $names) { if ($Allowed -cnotcontains $name) { throw 'unexpected field' } }
  foreach ($name in $Required) { if ($names -cnotcontains $name) { throw 'missing field' } }
}

function Normalize-UserDataDir([string]$Path) {
  # Windows PowerShell 5.1 runs on .NET Framework, which lacks
  # Path.IsPathFullyQualified. Accept only a drive-rooted path or a UNC share.
  $driveRooted = $Path -match '^[A-Za-z]:[\\/]'
  $uncRooted = $Path -match '^\\\\[^\\]+\\[^\\]+(?:[\\/]|$)'
  if ([string]::IsNullOrWhiteSpace($Path) -or (-not $driveRooted -and -not $uncRooted)) { throw 'invalid path' }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $rootPath = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::Equals($fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
      $rootPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'invalid profile root'
  }
  return $fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

if (-not ('CodexBrowserProfileWindow' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodexBrowserProfileWindow {
  [DllImport("user32.dll", EntryPoint="FindWindowExW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", EntryPoint="GetWindowThreadProcessId", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@ -ErrorAction Stop | Out-Null
}

function Get-ProfileLock([string]$UserDataDir) {
  $messageWindow = [IntPtr]::new(-3)
  $window = [CodexBrowserProfileWindow]::FindWindowEx($messageWindow, [IntPtr]::Zero,
    'Chrome_MessageWindow', $UserDataDir)
  if ($window -eq [IntPtr]::Zero) { return [pscustomobject]@{ locked = $false; processId = $null } }
  [uint32]$lockProcessId = 0
  [void][CodexBrowserProfileWindow]::GetWindowThreadProcessId($window, [ref]$lockProcessId)
  if ($lockProcessId -eq 0) { return [pscustomobject]@{ locked = $true; processId = $null } }
  return [pscustomobject]@{ locked = $true; processId = [int]$lockProcessId }
}

function Get-ProcessDetails([int]$ProcessId, [string]$ExecutablePath, [string]$UserDataDir, [string]$ExpectedCreationTicks) {
  $userDataDir = Normalize-UserDataDir $UserDataDir
  $profileLock = Get-ProfileLock $userDataDir
  $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return [pscustomobject]@{ exists = $false; identityMatches = $false; creationTimeUtcTicks = $null;
      executablePath = $null; commandLineMatches = $false; profileLockProcessId = $profileLock.processId;
      profileLockMatches = $false }
  }
  $actualExecutable = [string]$process.ExecutablePath
  $expectedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
  $executableMatches = [string]::Equals($actualExecutable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)
  $escaped = [regex]::Escape($userDataDir)
  $pattern = '(?:^|\s)--user-data-dir=(?:"' + $escaped + '"|' + $escaped + ')(?=\s|$)'
  $commandLineMatches = [regex]::IsMatch([string]$process.CommandLine, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $processObject = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  $creationTicks = $null
  if ($null -ne $processObject) {
    $creationTicks = $processObject.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  }
  $creationMatches = [string]::IsNullOrEmpty($ExpectedCreationTicks) -or
    [string]::Equals($creationTicks, $ExpectedCreationTicks, [StringComparison]::Ordinal)
  return [pscustomobject]@{ exists = $true; identityMatches = ($executableMatches -and $commandLineMatches -and $creationMatches);
    creationTimeUtcTicks = $creationTicks; executablePath = $actualExecutable; commandLineMatches = $commandLineMatches;
    profileLockProcessId = $profileLock.processId; profileLockMatches = ($profileLock.locked -and $profileLock.processId -eq $ProcessId) }
}

try {
  $request = Read-Request
  Assert-Shape $request @('protocol', 'operation', 'payload') @('protocol', 'operation', 'payload')
  if ($request.protocol -ne $script:Protocol -or $request.operation -isnot [string]) { throw 'invalid envelope' }
  $payload = $request.payload
  switch -CaseSensitive ($request.operation) {
    'profile.check' {
      Assert-Shape $payload @('userDataDir') @('userDataDir')
      $userDataDir = Normalize-UserDataDir ([string]$payload.userDataDir)
      $data = Get-ProfileLock $userDataDir
    }
    'process.inspect' {
      Assert-Shape $payload @('pid', 'executablePath', 'userDataDir', 'creationTimeUtcTicks') @('pid', 'executablePath', 'userDataDir')
      if ($payload.pid -isnot [ValueType] -or $payload.pid -is [bool] -or [int]$payload.pid -lt 1 -or
          [string]::IsNullOrWhiteSpace([string]$payload.executablePath)) { throw 'invalid process identity' }
      if ($payload.creationTimeUtcTicks -and [string]$payload.creationTimeUtcTicks -notmatch '^\d{1,19}$') { throw 'invalid creation time' }
      $data = Get-ProcessDetails ([int]$payload.pid) ([string]$payload.executablePath) ([string]$payload.userDataDir) ([string]$payload.creationTimeUtcTicks)
    }
    'process.close' {
      Assert-Shape $payload @('pid', 'executablePath', 'userDataDir', 'creationTimeUtcTicks', 'waitMs') @('pid', 'executablePath', 'userDataDir', 'creationTimeUtcTicks', 'waitMs')
      if ([int]$payload.pid -lt 1 -or [string]$payload.creationTimeUtcTicks -notmatch '^\d{1,19}$' -or
          [int]$payload.waitMs -lt 0 -or [int]$payload.waitMs -gt 5000) { throw 'invalid close request' }
      $identity = Get-ProcessDetails ([int]$payload.pid) ([string]$payload.executablePath) ([string]$payload.userDataDir) ([string]$payload.creationTimeUtcTicks)
      if (-not $identity.exists) {
        $data = [pscustomobject]@{ closeRequested = $false; exited = $true; profileUnlocked = (-not (Get-ProfileLock (Normalize-UserDataDir ([string]$payload.userDataDir))).locked); ownershipConfirmed = $true }
      } elseif (-not $identity.identityMatches -or -not $identity.profileLockMatches) {
        $data = [pscustomobject]@{ closeRequested = $false; exited = $false; profileUnlocked = $false; ownershipConfirmed = $false }
      } else {
        $processObject = Get-Process -Id ([int]$payload.pid) -ErrorAction Stop
        $closeRequested = $processObject.CloseMainWindow()
        if ($closeRequested -and [int]$payload.waitMs -gt 0) { [void]$processObject.WaitForExit([int]$payload.waitMs) }
        $after = Get-ProcessDetails ([int]$payload.pid) ([string]$payload.executablePath) ([string]$payload.userDataDir) ([string]$payload.creationTimeUtcTicks)
        $profileUnlocked = -not (Get-ProfileLock (Normalize-UserDataDir ([string]$payload.userDataDir))).locked
        $data = [pscustomobject]@{ closeRequested = [bool]$closeRequested; exited = (-not $after.exists);
          profileUnlocked = [bool]$profileUnlocked;
          ownershipConfirmed = [bool](($after.exists -and $after.identityMatches) -or ((-not $after.exists) -and $profileUnlocked)) }
      }
    }
    default { throw 'unknown operation' }
  }
  Write-Result ([pscustomobject]@{ protocol = $script:Protocol; ok = $true; data = $data })
  exit 0
} catch {
  try { Write-Result ([pscustomobject]@{ protocol = $script:Protocol; ok = $false; error = [pscustomobject]@{ code = 'OPERATION_FAILED' } }) } catch { }
  exit 1
}
