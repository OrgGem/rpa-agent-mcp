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
$script:MaxInputBytes = 6 * 1024 * 1024
$script:MaxOutputBytes = 1024 * 1024
$script:MaxClipboardBytes = 64 * 1024
$script:MaxPngBytes = 4 * 1024 * 1024
$script:MaxPixels = 16 * 1024 * 1024
$script:MaxRgbaBytes = 64 * 1024 * 1024
$script:MaxLines = 500
$script:MaxWords = 5000
$script:MaxOcrTextBytes = 64 * 1024
$script:Phase = 'before'

function Throw-HelperError([string]$Code, [string]$Phase = 'before') {
  $exception = New-Object System.InvalidOperationException('Windows helper operation failed')
  $exception.Data['WindowsHelperCode'] = $Code
  $exception.Data['WindowsHelperPhase'] = $Phase
  throw $exception
}

function Read-InputDocument {
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8, $false, 4096)
  $builder = New-Object System.Text.StringBuilder
  $buffer = New-Object char[] 4096
  $byteCount = 0
  while ($true) {
    $read = $reader.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    $chunk = New-Object string($buffer, 0, $read)
    $byteCount += $utf8.GetByteCount($chunk)
    if ($byteCount -gt $script:MaxInputBytes) { Throw-HelperError 'RESULT_TOO_LARGE' }
    [void]$builder.Append($chunk)
  }
  $document = $builder.ToString()
  if (-not $document.EndsWith("`n", [StringComparison]::Ordinal)) { Throw-HelperError 'INVALID_ARGUMENT' }
  $document = $document.Substring(0, $document.Length - 1)
  if ($document.Contains("`n") -or $document.Contains("`r") -or $document.Length -eq 0) {
    Throw-HelperError 'INVALID_ARGUMENT'
  }
  try { return ConvertFrom-Json -InputObject $document -ErrorAction Stop }
  catch { Throw-HelperError 'INVALID_ARGUMENT' }
}

function Assert-Properties($Object, [string[]]$Allowed, [string[]]$Required = @()) {
  if ($null -eq $Object -or $Object -isnot [System.Management.Automation.PSCustomObject]) {
    Throw-HelperError 'INVALID_ARGUMENT'
  }
  $names = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($name in $names) {
    if ($Allowed -cnotcontains $name) { Throw-HelperError 'INVALID_ARGUMENT' }
  }
  foreach ($name in $Required) {
    if ($names -cnotcontains $name) { Throw-HelperError 'INVALID_ARGUMENT' }
  }
}

function Test-Integer($Value) {
  return ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or
    $Value -is [int64] -or $Value -is [uint16] -or $Value -is [uint32] -or $Value -is [uint64])
}

function Get-ScalarCount([string]$Value) {
  $count = 0
  for ($i = 0; $i -lt $Value.Length; $i++) {
    $ch = $Value[$i]
    if ([Char]::IsHighSurrogate($ch) -and $i + 1 -lt $Value.Length -and [Char]::IsLowSurrogate($Value[$i + 1])) {
      $i++
    } elseif ([Char]::IsSurrogate($ch)) {
      Throw-HelperError 'INVALID_ARGUMENT'
    }
    $count++
  }
  return $count
}

function Get-AsyncResult($Operation, [Type]$ResultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  if (-not $asTask) { Throw-HelperError 'BACKEND_UNAVAILABLE' }
  try {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.GetAwaiter().GetResult()
  } catch { Throw-HelperError 'OPERATION_FAILED' }
}

function Close-WinRtObject($Object) {
  if ($null -eq $Object) { return }
  try {
    if ($Object -is [System.IDisposable]) { $Object.Dispose(); return }
    $closeMethod = $Object.GetType().GetMethod('Close')
    if ($closeMethod) { $Object.Close() }
  } catch { }
}

function Read-PngDimensions([byte[]]$Bytes) {
  if ($Bytes.Length -lt 33 -or $Bytes.Length -gt $script:MaxPngBytes) {
    Throw-HelperError $(if ($Bytes.Length -gt $script:MaxPngBytes) { 'RESULT_TOO_LARGE' } else { 'INVALID_IMAGE' })
  }
  $signature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
  for ($i = 0; $i -lt $signature.Length; $i++) { if ($Bytes[$i] -ne $signature[$i]) { Throw-HelperError 'INVALID_IMAGE' } }
  if ([BitConverter]::ToUInt32([byte[]]@($Bytes[11], $Bytes[10], $Bytes[9], $Bytes[8]), 0) -ne 13 -or
      [Text.Encoding]::ASCII.GetString($Bytes, 12, 4) -cne 'IHDR') { Throw-HelperError 'INVALID_IMAGE' }
  $width = [long]$Bytes[16] -shl 24 -bor ([long]$Bytes[17] -shl 16) -bor ([long]$Bytes[18] -shl 8) -bor [long]$Bytes[19]
  $height = [long]$Bytes[20] -shl 24 -bor ([long]$Bytes[21] -shl 16) -bor ([long]$Bytes[22] -shl 8) -bor [long]$Bytes[23]
  $bitDepth = [int]$Bytes[24]
  $colorType = [int]$Bytes[25]
  if ($width -le 0 -or $height -le 0 -or $width * $height -gt $script:MaxPixels -or
      $width * $height * 4 -gt $script:MaxRgbaBytes -or $bitDepth -notin @(1, 2, 4, 8, 16) -or
      $colorType -notin @(0, 2, 3, 4, 6) -or $Bytes[26] -ne 0 -or $Bytes[27] -ne 0 -or $Bytes[28] -notin @(0, 1)) {
    Throw-HelperError 'INVALID_IMAGE'
  }
  return [pscustomobject]@{ width = [int]$width; height = [int]$height }
}

function Get-OcrAvailability {
  try { Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null }
  catch { return [pscustomobject]@{ available = $false; languages = @(); maxImageDimension = 0 } }
  try {
    $ocrType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime]
    $languages = @($ocrType::AvailableRecognizerLanguages | ForEach-Object { [string]$_.LanguageTag })
    $engine = $ocrType::TryCreateFromUserProfileLanguages()
    $maxDimension = 0
    if ($null -ne $engine) {
      # PowerShell 5.1 does not project this WinRT runtime property as a normal
      # member; reflection reads its generated ABI property reliably.
      $maxProperty = $ocrType.GetProperty('MaxImageDimension')
      if ($maxProperty) { $maxDimension = [int]$maxProperty.GetValue($engine) }
    }
    $available = ($null -ne $engine -and $languages.Count -gt 0 -and $maxDimension -gt 0)
    Close-WinRtObject $engine
    return [pscustomobject]@{ available = [bool]$available; languages = @($languages); maxImageDimension = $maxDimension }
  } catch {
    return [pscustomobject]@{ available = $false; languages = @(); maxImageDimension = 0 }
  }
}

function Get-Capabilities {
  $clipboard = $false
  try {
    $get = Get-Command Get-Clipboard -ErrorAction Stop
    $set = Get-Command Set-Clipboard -ErrorAction Stop
    $clipboard = [Environment]::UserInteractive -and [Threading.Thread]::CurrentThread.ApartmentState -eq [Threading.ApartmentState]::STA -and
      $null -ne $get -and $null -ne $set
  } catch { $clipboard = $false }
  $ocr = Get-OcrAvailability
  return [pscustomobject]@{
    platform = 'windows'
    clipboardText = [bool]$clipboard
    ocr = $ocr
  }
}

function Get-Payload($Request, [string]$Operation) {
  Assert-Properties $Request @('protocol', 'operation', 'payload') @('protocol', 'operation', 'payload')
  if ($Request.protocol -ne $script:Protocol -or $Request.operation -cne $Operation) { Throw-HelperError 'INVALID_ARGUMENT' }
  if ($null -eq $Request.payload) { Throw-HelperError 'INVALID_ARGUMENT' }
  return $Request.payload
}

function Get-ImageCrop($Payload) {
  Assert-Properties $Payload @('pngBase64', 'language', 'region', 'maxLines') @('pngBase64', 'language', 'maxLines')
  if ($Payload.pngBase64 -isnot [string] -or $Payload.pngBase64.Length -gt [Math]::Ceiling($script:MaxPngBytes / 3.0) * 4) {
    Throw-HelperError $(if ($Payload.pngBase64 -is [string]) { 'RESULT_TOO_LARGE' } else { 'INVALID_ARGUMENT' })
  }
  try { $bytes = [Convert]::FromBase64String($Payload.pngBase64) }
  catch { Throw-HelperError 'INVALID_IMAGE' }
  $dimensions = Read-PngDimensions $bytes
  if ($Payload.language -isnot [string] -or $Payload.language.Length -lt 2 -or $Payload.language.Length -gt 32 -or
      $Payload.language -cnotmatch '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$' -or
      -not (Test-Integer $Payload.maxLines) -or $Payload.maxLines -lt 1 -or $Payload.maxLines -gt $script:MaxLines) {
    Throw-HelperError 'INVALID_ARGUMENT'
  }
  $region = $null
  if ($null -ne $Payload.region) {
    Assert-Properties $Payload.region @('x', 'y', 'width', 'height') @('x', 'y', 'width', 'height')
    foreach ($name in @('x', 'y', 'width', 'height')) { if (-not (Test-Integer $Payload.region.$name)) { Throw-HelperError 'INVALID_ARGUMENT' } }
    $x = [long]$Payload.region.x; $y = [long]$Payload.region.y
    $w = [long]$Payload.region.width; $h = [long]$Payload.region.height
    if ($x -lt 0 -or $y -lt 0 -or $w -le 0 -or $h -le 0 -or $x + $w -gt $dimensions.width -or $y + $h -gt $dimensions.height) {
      Throw-HelperError 'INVALID_ARGUMENT'
    }
    $region = [pscustomobject]@{ x = [int]$x; y = [int]$y; width = [int]$w; height = [int]$h }
  }
  return [pscustomobject]@{ bytes = $bytes; width = $dimensions.width; height = $dimensions.height; region = $region }
}

function Get-Rect([object]$Rect, [int]$OffsetX, [int]$OffsetY, [int]$ImageWidth, [int]$ImageHeight) {
  $x = [double]$Rect.X + $OffsetX; $y = [double]$Rect.Y + $OffsetY
  $width = [double]$Rect.Width; $height = [double]$Rect.Height
  if ([double]::IsNaN($x) -or [double]::IsInfinity($x) -or [double]::IsNaN($y) -or [double]::IsInfinity($y) -or
      [double]::IsNaN($width) -or [double]::IsInfinity($width) -or [double]::IsNaN($height) -or [double]::IsInfinity($height) -or
      $x -lt 0 -or $y -lt 0 -or $width -lt 0 -or $height -lt 0 -or
      $x + $width -gt $ImageWidth + 1 -or $y + $height -gt $ImageHeight + 1) {
    Throw-HelperError 'OPERATION_FAILED'
  }
  return [pscustomobject]@{ x = $x; y = $y; width = $width; height = $height }
}

function Invoke-WinRtOcr($Payload) {
  $image = Get-ImageCrop $Payload
  try { Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null }
  catch { Throw-HelperError 'BACKEND_UNAVAILABLE' }

  $stream = $null; $outputStream = $null; $writer = $null; $decoder = $null; $bitmap = $null; $engine = $null
  try {
    $ocrType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime]
    $installed = @($ocrType::AvailableRecognizerLanguages | ForEach-Object { [string]$_.LanguageTag })
    if ($installed -cnotcontains $Payload.language) { Throw-HelperError 'OCR_LANGUAGE_UNAVAILABLE' }
    $languageType = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    $language = New-Object $languageType($Payload.language)
    $engine = $ocrType::TryCreateFromLanguage($language)
    if ($null -eq $engine) { Throw-HelperError 'OCR_LANGUAGE_UNAVAILABLE' }

    $streamType = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage, ContentType = WindowsRuntime]
    $writerType = [Windows.Storage.Streams.DataWriter, Windows.Storage, ContentType = WindowsRuntime]
    $stream = New-Object $streamType
    $outputStream = $stream.GetOutputStreamAt([UInt64]0)
    $writer = New-Object $writerType($outputStream)
    $writer.WriteBytes([byte[]]$image.bytes)
    [void](Get-AsyncResult ($writer.StoreAsync()) ([UInt32]))
    [void](Get-AsyncResult ($writer.FlushAsync()) ([Boolean]))
    [void]$writer.DetachStream()
    $stream.Seek([UInt64]0)

    $decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $decoder = Get-AsyncResult ($decoderType::CreateAsync($stream)) $decoderType
    if ([int]$decoder.PixelWidth -ne $image.width -or [int]$decoder.PixelHeight -ne $image.height) {
      Throw-HelperError 'INVALID_IMAGE'
    }
    $transformType = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $pixelFormatType = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $alphaModeType = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $exifModeType = [Windows.Graphics.Imaging.ExifOrientationMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $colorModeType = [Windows.Graphics.Imaging.ColorManagementMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $transform = New-Object $transformType
    $offsetX = 0; $offsetY = 0
    if ($image.region) {
      $boundsType = [Windows.Graphics.Imaging.BitmapBounds, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
      $bounds = New-Object $boundsType
      $bounds.X = [UInt32]$image.region.x; $bounds.Y = [UInt32]$image.region.y
      $bounds.Width = [UInt32]$image.region.width; $bounds.Height = [UInt32]$image.region.height
      $transform.Bounds = $bounds
      $offsetX = $image.region.x; $offsetY = $image.region.y
    }
    $pixelFormat = [Enum]::Parse($pixelFormatType, 'Bgra8')
    $alphaMode = [Enum]::Parse($alphaModeType, 'Premultiplied')
    $exifMode = [Enum]::Parse($exifModeType, 'IgnoreExifOrientation')
    $colorMode = [Enum]::Parse($colorModeType, 'ColorManageToSRgb')
    $bitmap = Get-AsyncResult ($decoder.GetSoftwareBitmapAsync($pixelFormat, $alphaMode, $transform, $exifMode, $colorMode)) `
      ([Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime])
    $width = [int]$bitmap.PixelWidth; $height = [int]$bitmap.PixelHeight
    if ($width -le 0 -or $height -le 0 -or $width * $height -gt $script:MaxPixels -or
        $width * $height * 4 -gt $script:MaxRgbaBytes -or
        $width -gt [int]$ocrType.GetProperty('MaxImageDimension').GetValue($engine) -or
        $height -gt [int]$ocrType.GetProperty('MaxImageDimension').GetValue($engine)) {
      Throw-HelperError 'RESULT_TOO_LARGE'
    }
    $resultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime]
    $ocrResult = Get-AsyncResult ($engine.RecognizeAsync($bitmap)) $resultType
    $lines = New-Object System.Collections.Generic.List[object]
    $wordCount = 0; $textByteCount = 0; $truncated = $false
    foreach ($line in $ocrResult.Lines) {
      $lineText = [string]$line.Text
      $words = New-Object System.Collections.Generic.List[object]
      $nextWordCount = $wordCount
      $nextTextBytes = $textByteCount + $utf8.GetByteCount($lineText)
      foreach ($word in $line.Words) {
        $wordText = [string]$word.Text
        $nextWordCount++
        $nextTextBytes += $utf8.GetByteCount($wordText)
        if ($nextWordCount -gt $script:MaxWords -or $nextTextBytes -gt $script:MaxOcrTextBytes) { break }
        [void]$words.Add([pscustomobject]@{ text = $wordText; rect = (Get-Rect $word.BoundingRect $offsetX $offsetY $image.width $image.height) })
      }
      if ($lines.Count -ge $Payload.maxLines -or $nextWordCount -gt $script:MaxWords -or $nextTextBytes -gt $script:MaxOcrTextBytes) {
        $truncated = $true
        break
      }
      [void]$lines.Add([pscustomobject]@{ text = $lineText; rect = (Get-Rect $line.BoundingRect $offsetX $offsetY $image.width $image.height); words = @($words.ToArray()) })
      $wordCount = $nextWordCount; $textByteCount = $nextTextBytes
    }
    if ($ocrResult.Lines.Count -gt $lines.Count) { $truncated = $true }
    return [pscustomobject]@{
      engine = 'Windows.Media.Ocr'; language = [string]$Payload.language
      width = $image.width; height = $image.height; coordinateSpace = 'screenshot-px'
      lines = @($lines.ToArray()); truncated = [bool]$truncated
    }
  } catch {
    $code = $_.Exception.Data['WindowsHelperCode']
    if ($code) { Throw-HelperError ([string]$code) }
    Throw-HelperError 'OPERATION_FAILED'
  } finally {
    Close-WinRtObject $bitmap
    Close-WinRtObject $decoder
    Close-WinRtObject $writer
    Close-WinRtObject $outputStream
    Close-WinRtObject $stream
    Close-WinRtObject $engine
  }
}

function Invoke-Operation($Request) {
  Assert-Properties $Request @('protocol', 'operation', 'payload') @('protocol', 'operation', 'payload')
  if ($Request.protocol -ne $script:Protocol -or $Request.protocol -is [bool] -or $Request.operation -isnot [string]) {
    Throw-HelperError 'INVALID_ARGUMENT'
  }
  switch -CaseSensitive ($Request.operation) {
    'capabilities' {
      $payload = Get-Payload $Request 'capabilities'
      Assert-Properties $payload @() @()
      return Get-Capabilities
    }
    'clipboard.read' {
      $payload = Get-Payload $Request 'clipboard.read'
      Assert-Properties $payload @('maxChars') @('maxChars')
      if (-not (Test-Integer $payload.maxChars) -or $payload.maxChars -lt 1 -or $payload.maxChars -gt $script:MaxClipboardBytes) {
        Throw-HelperError 'INVALID_ARGUMENT'
      }
      try { $text = [string](Get-Clipboard -Raw -TextFormatType UnicodeText -ErrorAction Stop) }
      catch { Throw-HelperError 'CLIPBOARD_UNAVAILABLE' }
      $scalarCount = Get-ScalarCount $text
      if ($scalarCount -gt $payload.maxChars -or $utf8.GetByteCount($text) -gt $script:MaxClipboardBytes) {
        Throw-HelperError 'RESULT_TOO_LARGE'
      }
      return [pscustomobject]@{ format = 'text'; text = $text }
    }
    'clipboard.write' {
      $payload = Get-Payload $Request 'clipboard.write'
      Assert-Properties $payload @('text') @('text')
      if ($payload.text -isnot [string]) { Throw-HelperError 'INVALID_ARGUMENT' }
      $scalarCount = Get-ScalarCount $payload.text
      if ($utf8.GetByteCount($payload.text) -gt $script:MaxClipboardBytes) { Throw-HelperError 'RESULT_TOO_LARGE' }
      try { [void](Get-Command Set-Clipboard -ErrorAction Stop) }
      catch { Throw-HelperError 'CLIPBOARD_UNAVAILABLE' }
      $script:Phase = 'after-dispatch'
      try { Set-Clipboard -Value $payload.text -ErrorAction Stop }
      catch { Throw-HelperError 'CLIPBOARD_UNAVAILABLE' 'after-dispatch' }
      return [pscustomobject]@{ format = 'text'; writtenChars = $scalarCount }
    }
    'ocr' {
      $payload = Get-Payload $Request 'ocr'
      return Invoke-WinRtOcr $payload
    }
    default { Throw-HelperError 'INVALID_ARGUMENT' }
  }
}

$response = $null
try {
  $request = Read-InputDocument
  $data = Invoke-Operation $request
  $response = [pscustomobject]@{ protocol = 1; ok = $true; data = $data }
} catch {
  $code = [string]$_.Exception.Data['WindowsHelperCode']
  if ($code -notin @('INVALID_ARGUMENT', 'BACKEND_UNAVAILABLE', 'CLIPBOARD_UNAVAILABLE',
      'OCR_LANGUAGE_UNAVAILABLE', 'INVALID_IMAGE', 'RESULT_TOO_LARGE', 'OPERATION_FAILED')) { $code = 'OPERATION_FAILED' }
  $phase = [string]$_.Exception.Data['WindowsHelperPhase']
  if ($phase -notin @('before', 'after-dispatch')) { $phase = $script:Phase }
  $response = [pscustomobject]@{ protocol = 1; ok = $false; error = [pscustomobject]@{ code = $code; phase = $phase } }
}

try { $json = ConvertTo-Json -InputObject $response -Depth 24 -Compress -ErrorAction Stop }
catch { $json = '{"protocol":1,"ok":false,"error":{"code":"OPERATION_FAILED","phase":"before"}}' }
if ($utf8.GetByteCount($json) -gt $script:MaxOutputBytes) {
  $json = '{"protocol":1,"ok":false,"error":{"code":"RESULT_TOO_LARGE","phase":"before"}}'
}
[Console]::Out.WriteLine($json)
exit 0

