# Private Windows helper: implementation contract

This is an independent first slice of [missing browser backends](missing-browser-backends.md).
It implements real local backends without registering new public MCP tools.
Companion pairing, browser action admission and public schema integration remain
separate review gates. No live clipboard operation is authorized by the tests.

## Files and interface

Create `src/windows-browser-helper.mjs`, `scripts/Windows-BrowserHelper.ps1`,
and `test/windows-browser-helper.test.mjs`. The Node module exports
`createWindowsBrowserHelper({spawn, now, powershellPath, helperPath} = {})`.
Production defaults use `node:child_process.spawn`, `Date.now`, Windows
PowerShell 5.1 beneath the Windows system directory and the repository helper
script resolved from `import.meta.url`. Callers cannot supply executable/script
paths through MCP. Injection exists only for local composition and tests.

The returned object implements:

- `capabilities({deadline, signal})` -> `{platform:"windows", clipboardText:boolean,
  ocr:{available:boolean,languages:string[],maxImageDimension:number}}`.
  The probe never reads or writes clipboard contents and never opens an image.
- `readClipboard({deadline,signal,maxChars=65536})` ->
  `{format:"text",text:string,dispatchState:"notSent"}`. Reject text exceeding
  either `maxChars` or 65536 UTF-8 bytes; never truncate silently.
- `writeClipboard({text,deadline,signal})` ->
  `{format:"text",writtenChars:number,dispatchState:"acknowledged",
  verification:"acknowledged"}`. Text must fit 65536 UTF-8 bytes. It replaces
  the global text clipboard; it does not claim postcondition retention.
- `ocr({png,language="en-US",region,maxLines=500,deadline,signal})` ->
  `{engine:"Windows.Media.Ocr",language,width,height,coordinateSpace:"screenshot-px",
  lines:[{text,rect:{x,y,width,height},words:[{text,rect}]}],truncated:boolean}`.
  `png` is an already authorized Buffer provided by the artifact adapter, never
  a user-selected path. An optional region contains nonnegative integer x/y and
  positive integer width/height inside the image. Boxes are translated back to
  full-image pixel coordinates. No confidence or DOM refs are invented.

Each call receives an absolute millisecond `deadline` and optional AbortSignal.
Already expired/aborted calls fail before spawn. Backend calls never retry.
Errors are Error objects with bounded fixed `code`, `dispatchState` and message;
they never include input text, image data or helper paths.

## Helper protocol and process lifecycle

Spawn Windows PowerShell with fixed arguments `-NoLogo -NoProfile
-NonInteractive -STA -File <repository-helper>`, `windowsHide:true` and piped
stdio. No command text, shell, user-supplied executable or interpolation is used.
Pass exactly one UTF-8 JSON document followed by newline through stdin and close
stdin. The helper consumes one request and exits; no service is left running.

Request envelope: `{protocol:1,operation,payload}`. Operation is exactly one of
`capabilities`, `clipboard.read`, `clipboard.write`, `ocr`. Unknown operations
or extra fields are rejected. Payload follows the Node signatures, except OCR
uses `pngBase64` rather than Buffer and process timing/signal are not serialized.

Success: `{protocol:1,ok:true,data:<operation-result>}`. Failure:
`{protocol:1,ok:false,error:{code,phase}}`, with phase exactly `before` or
`after-dispatch`. Error codes: `INVALID_ARGUMENT`, `BACKEND_UNAVAILABLE`,
`CLIPBOARD_UNAVAILABLE`, `OCR_LANGUAGE_UNAVAILABLE`, `INVALID_IMAGE`,
`RESULT_TOO_LARGE`, `OPERATION_FAILED`. Messages are mapped to fixed Node-side
strings; raw Windows exceptions, paths and stack traces are not returned.

Suppress PowerShell progress and output no banners or diagnostic stdout.
Use UTF-8 without BOM for console output. Stdout must contain exactly one JSON
document with no trailing payload. Collect at most 1 MiB stdout and 4 KiB stderr;
stderr is drained but is not returned/logged with user data. Bound stdin at
6 MiB. Malformed output, nonzero exit, spawn failure or timeout are errors.

On abort/deadline/output overflow, kill only the exact ChildProcess owned by
this call and await its exit within a bounded 2-second cleanup interval. Do not
kill by process name, enumerate unrelated processes or retry. Track/clean event
handlers and timers on every path. A child that cannot be confirmed exited is
reported as `HELPER_CLEANUP_UNCONFIRMED`.

For writes, phase is `before` until immediately before the helper calls
Set-Clipboard. A successful response acknowledges that call only. Once Node
has sent the payload, missing/malformed acknowledgement or cancellation is
conservatively `unknown`; a validated helper failure with phase `before`
remains `notSent`. Read-only operations never create a write outcome.

## Clipboard serialization

All helper instances in one Node process share one FIFO for clipboard reads
and writes. Queue waiting consumes the same absolute deadline. Expired queued
jobs settle without spawning and retain the predecessor barrier; later jobs
cannot overtake an active helper. Drain the active process before advancing.
If child exit cannot be confirmed, quarantine the process-wide clipboard FIFO:
subsequent clipboard calls fail `CLIPBOARD_UNAVAILABLE` with `notSent` and never
spawn another helper. Clear that quarantine only when the original ChildProcess
emits independently observed exit/close, not merely when kill() returned true.
Do not release the FIFO barrier after an unconfirmed termination.
No process exit, release or dispose restores a previous clipboard value.

## OCR resource and data bounds

Reject encoded PNGs over 4 MiB, invalid PNG signature/IHDR, dimensions over
16 megapixels, decoded RGBA over 64 MiB or an out-of-bounds region before spawn.
The helper validates PNG decoding, region and dimensions independently and
checks `OcrEngine.MaxImageDimension` on the bitmap actually sent to the engine.
Check the requested language against installed OCR languages for every call;
do not download language packs. Use a software bitmap in a WinRT-supported
pixel format and release bitmap/stream/engine resources after recognition.

Prefer in-memory WinRT decoding. If the implementation requires a temporary
PNG, create a fresh private temporary directory/file with exclusive creation,
never accept a caller path, and delete only that known file/directory after
closing handles. If killed helpers can leave temporary files, the Node owner
must track the exact created paths and perform bounded cleanup. No recursive
delete on an unchecked/computed path. Do not include temporary paths in output.

Keep at most 500 lines and 5000 words, and at most 64 KiB UTF-8 recognized text.
`maxLines` is 1..500. Exceeding line/word limits truncates whole entries and sets
`truncated`; exceeding bounded transport output fails explicitly. Reject invalid
or non-finite boxes. OCR boxes describe the submitted image only, with no claim
that the current browser layout still matches it.

## Acceptance

Focused tests use injected child processes and clocks to cover exact fixed
argv, Unicode/stdin framing, shape validation, output limits, spawn/exit errors,
queued expiry/order, deadline kill, confirmed cleanup and no write retry.
They assert unknown for a lost clipboard write acknowledgement and notSent for
pre-dispatch errors. OCR tests cover language/dimension/region/word limits and
crop-to-full-image box translation. An opt-in real Windows OCR test generates
its own image containing `MCP TEST 123`, recognizes it and cleans its files;
it never captures a user page or reads the clipboard. Capability probing may
run read-only on Windows. Real clipboard tests are not part of this slice.
