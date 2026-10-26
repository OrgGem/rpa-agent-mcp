# Missing browser backends

* **Author:** Codex
* **Status:** Source implementation approved by focused fresh-context review; implementation and live acceptance in progress
* **Date:** 2026-10-26

## Overview

This design adds real, bounded implementations for the ten deferred tools while
keeping the installed UiPath extension as the owner of the existing tab, DOM,
and element operations. A small, separately installed Chrome companion handles
the browser APIs that the UiPath bridge does not expose. Windows OCR and
clipboard use local Windows facilities. Image matching and accessibility
auditing run locally. Natural-language semantic queries use an explicitly
configured local Ollama model over a bounded accessibility snapshot; an optional
structured mode queries Chrome's accessibility tree directly. Model output is
limited to candidate IDs or abstention.

Backend presence is checked at runtime. Once a real adapter, strict schema, and
offline contract tests exist, the tool is registered. If its required backend
is not ready for the selected connection, its handler returns a typed
`BACKEND_UNAVAILABLE` before dispatch and `browser_capabilities` reports the
specific reason. No no-op stub is published, and no tool silently installs an
extension, launches a browser, changes registry state, enables remote debugging,
or installs a model or language pack.

## The Problem

The runtime has strict adapters for 42 browser tools, but the ten entries below
are currently only deferred coverage records. Their contract entries accept
only `contextRef`, and there are no adapters or routes. Vendor permission bits
and source function names do not prove a working route.

The pinned UiPath 23.10.1 manifest declares `debugger` and `downloads`, but the
repository audit found no typed endpoint that safely exposes those capabilities.
The audited `AttachDebugger` and `DetachDebugger` entries accept only a tab ID;
the normal `WriteTextHtmlElem` path does not implement a public key API. The
existing runtime coverage therefore correctly leaves all ten tools unsupported.
The Chrome `DownloadItem` also has no tab ID, so a newly observed download
cannot be safely attributed to an arbitrary page click. The design uses owned
download IDs instead of guessing that correlation.

## Goals

* Implement the ten strict tool contracts below without replacing or patching
  the vendor extension.
* Bind every browser operation to the existing context, connection, profile
  session, tab, and document generation; never use a raw tab ID or URL as public
  identity.
* Give the companion extension a narrow typed protocol, not a public raw-CDP
  tunnel.
* Make dialog response independent of a page-action queue that may be blocked
  by the dialog.
* Provide local, explicit semantics for OCR, template matching, semantic query,
  accessibility audit, clipboard, and browser launch.
* Test offline protocol behavior separately from live Chrome and OS evidence.

## Non-Goals

* Modifying, repackaging, or replacing the UiPath extension.
* Enabling `--remote-debugging-port`, changing Chrome security settings, or
  installing/registering a companion extension during implementation or tests.
* Clicking a visual match, treating OCR boxes as DOM refs, or claiming
  screenshot coordinates are safe action targets.
* Remote LLM calls, arbitrary page actions returned by semantic queries, or
  model-generated CSS/XPath selectors.
* Native `showOpenFilePicker()` or OS file-dialog automation. The file tool
  covers HTML `input[type=file]` only.
* Correlating an arbitrary user-clicked download to a tab. The download tool
  starts and tracks only downloads it started itself.
* Claiming an automated accessibility scan proves WCAG conformance.
* Launching or closing a shared Chrome profile or attaching to an existing
  process without proof that the bridge owns it.

## Evidence and feasibility

The implementation baseline is the source in this checkout and the installed
Chrome extension, not the older feature catalog:

* `docs/runtime-function-coverage.json` marks all ten as unsupported with no
  adapter or route. `docs/browser-tool-contracts.json` has context-only stub
  schemas for these entries.
* The installed extension is UiPath 23.10.1; the embedded driver audited by the
  repository is 23.4.55.39317. Its manifest includes `debugger`, `downloads`,
  `nativeMessaging`, and `tabs`, but the pinned audit does not establish a
  suitable public protocol path for these tools.
* The installed host has Windows PowerShell and `Windows.Media.Ocr.OcrEngine`;
  a read-only host probe created the English (`en-US`) OCR engine. This is local
  host evidence only. The implementation must check the requested language at
  runtime. No Tesseract, OpenCV, axe-core, or Ollama package/model is currently
  present in the repository's runtime dependencies.
* Official Chrome documentation describes the required APIs: [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger), [`chrome.downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads), [CDP dialog events and handling](https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-javascriptDialogOpening), [file chooser interception](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setInterceptFileChooserDialog), [`DOM.setFileInputFiles`](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-setFileInputFiles), and [`Accessibility.queryAXTree`](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/#method-queryAXTree).
* Microsoft documents the local [Windows OCR API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine?view=winrt-26100) and its language availability. The design never downloads language data.
* The separate [private Windows helper contract](missing-native-helper-contract.md)
  specifies the exact PowerShell 5.1 subprocess, FIFO, clipboard, OCR, deadline,
  and error protocol. This design delegates to its exported
  `createWindowsBrowserHelper` API rather than defining a second OS interface.
* The model-backed mode uses the local [Ollama chat API](https://docs.ollama.com/api/chat),
  with the strict loopback and result restrictions below. No Ollama package or
  model is present in the inspected host, so the mode is currently unavailable.

The extension permission list is a prerequisite, not proof that the route is
usable. The companion below is the proposed concrete route because the existing
UiPath extension cannot be changed and the bridge does not publish its debugger
or download APIs.

## Critical User Journeys

### Send a page key

* **Given:** The MCP client owns a live context and tab; the companion is
  connected to that same Chrome profile; no competing debugger owns the tab.
* **When:** The client sends one bounded key sequence to `browser_press_keys`.
* **Then:** The companion dispatches key-down/key-up events to the exact tab,
  reports the dispatch state, and releases any outstanding key on failure. It
  never retries an uncertain sequence.

### Handle a modal page dialog

* **Given:** A dialog watch is armed for an exact tab and a response policy is
  explicit.
* **When:** A page action opens an alert, confirm, prompt, or before-unload
  dialog.
* **Then:** The companion reports a `dialogRef` over its independent control
  path. `wait` and `respond` do not enter the page-action queue or issue DOM
  probes. The arm request states what to do on mismatch or expiry. An explicit
  `leaveOpen` choice returns an unresolved `dialogRef`; no policy silently
  accepts or dismisses the dialog.

### Upload, download, or analyze local evidence

* **Given:** A selected connection owns its browser profile and artifacts.
* **When:** The client provides files to an armed HTML file input, starts a
  download by URL, or submits a screenshot/template to a local analyzer.
* **Then:** Results are scoped to the initiating owner; assignment, download
  completion, OCR, image match, AX query, and audit results are reported with
  their source and bounded evidence.

## Technical Plan

### Components and data flow

```text
MCP client
  -> existing bridge/runtime (strict schema, owner refs, deadline, write ledger)
     -> existing UiPath native host and extension (existing browser/DOM tools)
     -> companion broker (separate Native Messaging host)
          -> explicitly installed MV3 companion
               -> chrome.debugger/CDP: keys, JS dialogs, file input, AX tree
               -> chrome.downloads: start and track owned download IDs
     -> local modules in the MCP/native runtime
          -> Windows.Media.Ocr (OCR)
          -> local OpenCV.js template matching (visual find)
          -> pinned axe-core bundle injected in the isolated page world (audit)
          -> Windows PowerShell clipboard commands
          -> configured Chrome executable and isolated profile (launch)
```

The companion is a separate extension and native-messaging host with its own
registered origin. Its manifest requests only `debugger`, `downloads`,
`nativeMessaging`, and `tabs`; `externally_connectable.ids` contains only the
pinned UiPath extension ID. It has no `<all_urls>` host permission, content
script, arbitrary-command endpoint, or remote-debugging port. A typed request
union is the only bridge between the runtime and companion. The companion
returns extension version, browser version, connection nonce, and capability
handshake before the runtime marks it ready.

Do not add the companion extension ID to the existing UiPath native-host
manifest. Register the separate host under a separate native-host name and
allowed-origin list, through an explicit installer that the user must run.
Companion package installation and native-host registration are final setup
steps after EGM review; they are not performed by this design task. Until both
are present and the handshake succeeds, companion-backed tools stay unavailable.

The companion/native-host wire protocol is versioned and closed:

```ts
type CompanionRequest = {
  protocol: 1; requestId: string; connectionEpoch: number;
  profileSessionRef: Ref; pairRef: Ref; operation:
    | "debugger.acquire" | "debugger.release" | "keys.dispatch"
    | "dialog.arm" | "dialog.wait" | "dialog.respond" | "dialog.cancel"
    | "file.arm" | "file.wait" | "file.provide" | "file.release" | "file.cancel"
    | "download.start" | "download.get" | "download.cancel"
    | "ax.query";
  leaseRef: Ref | null; tabRef: Ref | null;
  deadline: number; payload: JsonFromThatOperation;
}; // No raw CDP method names, script text, or native IDs at the MCP boundary.
type CompanionReply = { protocol: 1; requestId: string;
  connectionEpoch: number; ok: true; data: JsonFromThatOperation }
  | { protocol: 1; requestId: string; connectionEpoch: number; ok: false;
      error: "INVALID_REQUEST" | "BACKEND_UNAVAILABLE" | "BACKEND_BUSY"
        | "STALE_PROFILE" | "STALE_TAB" | "STALE_DOCUMENT"
        | "POLICY_RESTRICTED" | "TARGET_UNSUPPORTED" | "TIMEOUT"
        | "UNKNOWN_OUTCOME" };
type CompanionEvent = { protocol: 1; connectionEpoch: number;
  eventId: string; leaseRef: Ref; tabRef: Ref;
  kind: "dialog.opened" | "dialog.closed" | "file.opened"
    | "download.changed" | "debugger.detached";
  sequence: number; payload: JsonForThatEvent };
```

`JsonFromThatOperation`/`JsonForThatEvent` are closed discriminated schemas in
`companion/service-worker.mjs`, not extensible maps. The native host correlates
every reply/event by request, profile epoch, pair, lease, and opaque tab ref;
the companion resolves those refs to browser-supplied IDs only after pairing.
Messages are UTF-8 JSON, bounded to 256 KiB per request/reply and 16 KiB per
event. Each pending request has one `requestId`; a lost response never resends a
stateful command. The bridge reports unknown, then uses only an allowed read
(`download.get`, dialog status, or lease reconciliation) to discover current
state. A retry with a different request key is a new user action, not recovery.

The debugger broker acquires one Chrome debugger session per paired target and
keeps an owner/refcount ledger. Each operation requires an active `pairRef`,
lease, profile epoch, and tab generation. `debugger.detached` invalidates every
lease for that target; no automatic reattach or action replay occurs. A later
read may re-pair the same context after normal identity validation. Dialog and
file events are associated with their one-shot arm and sequence before they
enter the bridge queue.

### Identity, ownership, deadlines, and cleanup

* MCP callers continue using opaque `contextRef`, `tabRef`, and `elementRef`.
  The bridge resolves these to internal connection/session IDs and the driver
  tab ID. The companion receives a short-lived opaque lease plus that internal
  tab ID; it never returns the ID to MCP.
* Pair a UiPath connection to the companion with a fresh 256-bit nonce and
  connection epoch. The runtime records a pending, single-use pairing bound to
  `(connectionRef, contextRef, tabRef, documentGeneration)` for at most 30
  seconds. A fixed `InjectAndRunJs` pairing function in UiPath's isolated
  extension world calls `chrome.runtime.sendMessage(companionId, {nonce,
  documentToken})`. The companion accepts only an authenticated external sender
  whose `sender.id` is the pinned UiPath extension ID, and records the browser
  supplied `sender.tab.id`, `windowId`, `frameId`, and `documentId`. It returns
  the nonce and its profile-session nonce through its own native-messaging
  channel. The bridge completes the pair only if both nonces, target, document
  generation, and epoch match. It does not put a pairing marker in page DOM.
* Verify that the pinned `InjectAndRunJs` isolated world can call
  `chrome.runtime.sendMessage` before advertising companion support. If this is
  unavailable, pairing fails closed; URL/title, raw tab ID, geometry, or
  DOM-visible nonce fallback is prohibited. A second Chrome profile must use a
  unique `UIPATH_BRIDGE_INSTANCE` endpoint; if the current setup cannot provide
  one, that profile remains unpaired. Every native-host reconnect increments
  the epoch and invalidates prior context, tab, dialog, picker, and debugger
  leases.
* The companion keeps one debugger owner per tab and a reference count of the
  active leases (key action, dialog watch, file watch, AX query). It attaches
  only when the count changes from zero to one and detaches only when the count
  reaches zero. It never detaches a debugger it did not attach. A competing debugger,
  DevTools session, enterprise restriction, or attach failure returns
  `BACKEND_BUSY`/`BACKEND_UNAVAILABLE`; it does not fall back to a different
  tab or OS keyboard input. The normal tab queue coordinates existing UiPath
  actions with debugger operations. Dialog wait/respond uses a separate control
  lane because the page action may be blocked.
* Every call has one absolute deadline (100–30000 ms). A stateful action is
  dispatched at most once and uses the existing `requestKey` ledger. Timeout
  after dispatch is `unknown`, never an automatic retry.
* Debugger leases, dialog watches, file chooser watches, download refs, and
  analysis refs are owner-scoped with bounded TTLs. Release, timeout, context
  close, native-host disconnect, and client exit attempt cleanup. Failed
  detach or key-up is reported and quarantines that tab/session until
  reconciliation; missing registry state alone does not prove cleanup.
* No page action, snapshot, or DOM postcondition probe runs while a JS dialog is
  open. The independent companion event path is the only response route.
* Artifacts remain in the existing managed artifact store. Visual and OCR
  outputs carry the screenshot artifact hash, dimensions, coordinate space,
  and captured viewport generation. They do not produce `elementRef`s.

### Dialog admission and state machine

`arm` is a precondition for one named write, not a general event subscription.
It reserves the exact `(connectionRef, profileSessionRef, tabRef,
documentGeneration, triggerRequestKey)` before that write is dispatched. The
arm request itself has its own `requestKey`. It fails if the context is stale,
the tab is already modal/quarantined, or an existing arm owns the tab. A
subsequent click/type/evaluate must use the exact `triggerRequestKey`; otherwise
the dialog arm is not consumed. If a navigation or host epoch change occurs
before the dialog event, the arm expires without matching another document.

The companion event listener timestamps each event with its profile epoch,
debugger session, tab, frame, and monotonically increasing event sequence. The
bridge binds the first eligible event to the pre-armed document/action identity
and produces an opaque `dialogRef`. URLs and messages are descriptive evidence,
not identity. This admission path does not wait behind the page or window
queues. Once the event is open, all page actions and DOM reads remain blocked;
only `wait`, `respond`, or an explicitly requested `cancel(disposition:"dismiss")`
may enter the control lane for that ref. That narrow lane can run while the
triggering page write is quarantined, but it cannot clear that write's outcome
or unblock unrelated writes.

| Current state | Event/call | Next state | Cleanup/admission |
|---|---|---|---|
| `ARMED` | Matching dialog event | `OPEN_MANUAL` or `OPEN_AUTO` | Retain exact debugger lease; reject unrelated page actions. |
| `ARMED` | Wrong type/message | `MISMATCH_OPEN` or `DISMISSED_BY_POLICY` | Apply the caller's required `mismatchPolicy`; never infer accept. |
| `ARMED` | TTL/navigation/epoch expiry | `EXPIRED_NO_DIALOG` | Disable interception, release owned lease; do not touch another document. |
| `OPEN_MANUAL` | `respond`/explicit cancel | `RESPONDING` then `CLOSED` or `UNKNOWN` | Send one `Page.handleJavaScriptDialog`; release lease only after closed/detach evidence. |
| `OPEN_AUTO` | Policy response | `CLOSED` or `UNKNOWN` | Response is sent once; report dispatch and close evidence separately. |
| Open state | TTL with `expiryPolicy:"dismiss"` | `DISMISSED_BY_POLICY` or `UNKNOWN` | Dismiss once, then bounded detach. |
| Open state | TTL with `expiryPolicy:"leaveOpen"` | `EXPIRED_OPEN` | Keep ref recoverable, attempt detach, report unresolved state. A later response revalidates epoch and reattaches only to the same target. |

If response acknowledgement is lost, preserve `UNKNOWN`, retain the dialog
identity only for bounded recovery, and do not replay the triggering action or
dialog response. Client release attempts owned detach. A failed detach leaves an
explicit cleanup error and keeps that connection/tab unavailable until a new
epoch or confirmed reconciliation.

### Context/client release ordering

`releaseContext` and `releaseClient` must not wait for queued page jobs before
handling a modal that is blocking one of those jobs. The order is:

1. Mark the context/client as releasing and reject new ordinary tool admission.
2. Using immutable owner leases, invoke the companion's cleanup control lane for
   all owned dialog and file-picker watches, even though `ctx.alive` is false or
   `client.releasing` is true. This lane does not run browser activation,
   document validation, DOM probes, or page/window queues.
3. For an open JS dialog, apply the arm's required `releasePolicy`: either
   issue one dismiss and await close evidence, or detach and report unresolved
   state. Never silently choose a response. For an intercepted file picker,
   apply its arm's `releasePolicy` (`cancel` or `detach`) and release only its
   own staged files after the browser no longer needs them or the TTL expires.
4. Cancel/settle ordinary queued jobs and only then await `ctx.jobs` and
   `client.jobs`. Preserve unknown write outcomes; modal cleanup does not clear
   quarantines or replay their triggering writes.
5. Release remaining refs/artifacts and complete cleanup receipts. Report each
   unconfirmed detach or staged-file cleanup instead of treating it as success.

An extension disconnect follows the same order from the bridge's last valid
owner ledger; it never issues a new normal browser operation during release.

### Screenshot artifact provenance and analysis reads

`ScreenshotRef` is an alias for the existing owner-scoped `artifactRef`, not a
second reference namespace. The source is the existing
`browser_screenshot({contextRef,tabRef,mode:"viewport",format:"png"})`; its
`data.artifactRef` and metadata are used by OCR and visual search. The existing
`browser_image_artifact` tool has inspect/read/save only and no import. The
design does not add arbitrary image-path reads. A caller selects a template by
cropping a region from a second owned screenshot artifact.

Add an internal artifact-store operation
`analysisRead(clientRef,contextRef,artifactRef,{maxBytes,maxPixels})`. It
reuses the existing owner/context, real-path, non-symlink, file-size, and
SHA-256 checks, decodes the PNG header, verifies dimensions, and returns bytes
only inside the runtime process. It never returns a path or image block to MCP.
On screenshot capture, persist source metadata alongside the hash:
`sourceTool:"browser_screenshot"`, `tabRef`, `documentGeneration`,
`viewportGeneration`, width, height, and `mimeType`. Reject other image sources
for this tool. Respect the artifact store's 6 MiB per-file bound and add a
16-megapixel analysis bound before decode; both checks happen before allocation.
Artifact release and TTL remain owned by the current client/context cleanup.

For `browser_visual_find`, `templateRegion` and optional `searchRegion` are
integer screenshot-pixel rectangles, with nonnegative x/y, positive width and
height, and must fit completely within the recorded artifact dimensions.
`templateRegion` is at least 8 by 8 and at most 512 by 512 pixels. Both image
refs must belong to the same client/context and be verified screenshot
artifacts. Matching uses the exact template pixel scale. OCR's `region` uses
the same exact coordinate validation and the result boxes remain in full-image
coordinates.

### Tool contracts

All objects use `additionalProperties:false`, bounded fields, explicit action
discriminators, and the existing result envelope. Browser tools use the normal
`{ok, requestId, context, data, evidence, timing, error}` envelope. Errors use
the existing `dispatchState` values `notSent`, `sent`, `acknowledged`, and
`unknown`. MCP output schemas are validated before publishing a result.

| Tool | Strict input and result | Backend and limits |
|---|---|---|
| `browser_press_keys` | Input: `contextRef`, `tabRef`, `keys[1..20]`, optional per-step `modifiers[]`, `requestKey`, `timeoutMs`. Key enum: `ENTER`, `TAB`, `ESCAPE`, `BACKSPACE`, `DELETE`, `SPACE`, `ARROWUP`, `ARROWDOWN`, `ARROWLEFT`, `ARROWRIGHT`, `HOME`, `END`, `PAGEUP`, `PAGEDOWN`, `F1`–`F12`; modifiers: `CTRL`, `ALT`, `SHIFT`, `META`. No printable text or raw CDP. Output: `inputMethod:"cdp-key-events"`, `dispatchState`, `sentCount`, `releasedKeys[]`, `verified:false`. | Companion `Input.dispatchKeyEvent` on exact tab. Max 20 keys, one key-down/up pair each; key-up cleanup runs before return. A missed key-up or timeout after dispatch is unknown and quarantines writes. Not trusted hardware input. |
| `browser_semantic_query` | Discriminated input: `mode:"natural-language"` with `contextRef`, `tabRef`, `query` (1–2000 chars), `limit` (1–20), `timeoutMs`; or `mode:"ax"` with `contextRef`, `tabRef`, `role`, exact `accessibleName` (1–256 chars), `limit` (1–100), `includeDisabled`, `timeoutMs`. Natural-language output is `matches[{candidateId,elementRef|null}]`, `abstained`, `provider:{name:"ollama",model}`, `truncated`. AX output is `matches[{role,accessibleName,states,elementRef|null,refAvailable}]`, `source:"chrome-accessibility-tree"`. Model output contains no actions, selectors, HTML, or free-form explanations. | Natural-language mode snapshots at most 100 visible candidates, omits passwords, input values, URL query strings and arbitrary attributes, and sends bounded `candidateId` plus role/name/short visible label to an explicitly configured local Ollama model. Send `POST /api/chat` to fixed `127.0.0.1:11434` using direct `node:http` (no DNS, proxy environment, or redirects), with `{model,messages,stream:false,format:"json",options:{temperature:0,num_predict:128}}`; the user message contains only `{query,candidates}`. Cap the request at 24 KiB, full HTTP response at 4 KiB, and total time at 5 seconds. Parse `message.content` as JSON and require exactly `{candidateIds:string[],abstain:boolean}` with only allowlisted IDs; if abstaining, empty, malformed, unknown, duplicated, or over-limit, return no matches and abstain. AX mode uses companion `Accessibility.queryAXTree` plus exact DOM backend-node resolution. A missing/unmappable backend node yields `elementRef:null,refAvailable:false`; never guess from name, selector, or geometry. Natural-language candidates also return null when the current registry cannot mint an exact ref. |
| `browser_dialog` | Discriminated input: `arm(contextRef,tabRef,triggerRequestKey,requestKey,mode,expectedType,expectedMessage?,autoResponse?,mismatchPolicy,expiryPolicy,releasePolicy,ttlMs)`, `wait(dialogWatchRef,timeoutMs)`, `respond(dialogRef,accept,promptText?,requestKey)`, or `cancel(dialogRef,disposition:"dismiss",requestKey)`. `mode` is `manual` or `auto`; `mismatchPolicy` and `expiryPolicy` are `dismiss` or `leaveOpen`; `releasePolicy` is `dismiss` or `detach`. Output: `dialogWatchRef`, `dialogRef`, `type`, bounded `message`, `handledBy`, `state`, `cleanupState`. | Companion observes `Page.javascriptDialogOpening` and calls `Page.handleJavaScriptDialog`. Supported types are `alert`, `confirm`, `prompt`, and `beforeunload`. The arm binds the expected imminent write's request key, document generation, frame, event sequence and debugger lease. `wait`/`respond` use an independent control lane that bypasses page/window queues and the quarantine for that exact armed event only; it never clears the pending write's unknown outcome. No DOM probe or action runs while open. Mismatch, expiry, and owner release use only the explicitly selected policy. `leaveOpen` retains a recoverable ref, attempts debugger detach, and reports cleanup uncertainty; a later response must revalidate the same profile epoch and dialog target. |
| `browser_file_picker` | Discriminated input: `arm(contextRef,tabRef,triggerRequestKey,requestKey,releasePolicy:"cancel"|"detach",ttlMs)`, `wait(pickerWatchRef,timeoutMs)`, `provide(pickerRef,paths[1..10],requestKey)`, `release(pickerRef,requestKey)`, or `cancel(pickerWatchRef,requestKey)`. Paths must be canonical files under configured `UIPATH_UPLOAD_ROOTS`; no arbitrary path or symlink escape. Output: `pickerRef`, `mode`, `selectedCount`, `selection:"assigned"`, `verification:"browser-acknowledged"`, `expiresAt`. | Companion enables `Page.setInterceptFileChooserDialog` before the named trigger action, then uses the exact tab/frame/backendNodeId from the one-shot `Page.fileChooserOpened` event. It supports only HTML `input[type=file]`; the event itself identifies the requested element, so no selector/geometry cross-backend guess is made. Before dispatch it canonicalizes and stages immutable copies under a managed temporary root (max 10 files, 25 MiB/file, 50 MiB total), computes hashes, and calls `DOM.setFileInputFiles` with staged paths. Staged files remain until explicit `release`, owner cleanup, or bounded TTL. `showOpenFilePicker()` and other native picker APIs return `UNSUPPORTED_PICKER`; assignment is not proof the application accepted an upload. |
| `browser_download` | Discriminated input: `start(contextRef,tabRef,url,filename?,requestKey,timeoutMs)`, `get(contextRef,downloadRef,timeoutMs)`, or `cancel(contextRef,downloadRef,requestKey,timeoutMs)`. URL must be credential-free HTTP(S); filename is a safe basename/relative path with no `..`. Output: `downloadRef`, `state`, `fileName`, `bytesReceived`, `totalBytes`, `completedAt`, `completionEvidence`. | `tabRef` establishes the paired companion profile before start; `chrome.downloads.download` returns the unique ID. Use `conflictAction:"uniquify"`, retain the returned ID in owner-scoped persistent state, and track with `onChanged`/`search`. Only refs created by this owner may be read/cancelled; the opaque ref survives page navigation. Do not watch arbitrary click downloads: `DownloadItem` has no `tabId`. Chrome owns the destination under its Downloads directory; no arbitrary filesystem destination, overwrite, or auto-open. On client disconnect the download is not cancelled; its owner ref becomes unavailable and the download may finish in Chrome. |
| `browser_launch` | Discriminated input: `start(profileAlias,url?,requestKey,timeoutMs)`, `status(launchRef)`, or `close(launchRef,requestKey,timeoutMs)`. `profileAlias` must name an explicit local configuration; MCP cannot choose an executable or arbitrary user-data path. Output: `launchRef`, `state`, `processOwned`, `browserVersion`, `connectionRef|null`, `tabRef|null`, `automationReady`, `reason`. | Windows process helper starts only the configured executable with a dedicated, configured user-data directory and no remote-debugging flags. Before spawn, mint a unique `UIPATH_BRIDGE_INSTANCE` and pass it only in the child's environment to prevent the new profile's UiPath native host from colliding with the default IPC endpoint. Record canonical executable path, profile alias, launch nonce, PID and process creation time; hold/check the process handle and profile lock so PID reuse cannot satisfy ownership. Never install extensions or infer readiness from process start. Initial scope returns `launchRef` only and `connectionRef:null`, `tabRef:null`, `automationReady:false`, `reason:"SEPARATE_BRIDGE_ATTACHMENT_REQUIRED"`. A future connection is returned only after the unique profile endpoint, companion pairing epoch, driver handshake, and exact tab open all succeed. Close only the process/window proven to belong to that launch. |
| `system_clipboard` | Discriminated input: `read(timeoutMs,maxChars)` or `write(text,requestKey,timeoutMs)`; text is limited to 64 KiB. Output: read returns `{format:"text",text,observedAt}`; write returns `{format:"text",writtenChars,verification:"acknowledged"}`. | Delegate to [`missing-native-helper-contract.md`](missing-native-helper-contract.md): `createWindowsBrowserHelper().readClipboard/writeClipboard`, one Windows PowerShell 5.1 `-STA` process per operation, fixed script, stdin JSON, FIFO, one deadline, no retry, fixed errors. Never log clipboard text. Windows interactive session only. Reads over limit fail rather than truncate. Write replaces the global clipboard. |
| `browser_visual_find` | Input: `contextRef`, `targetScreenshotRef`, `templateScreenshotRef`, `templateRegion`, optional `searchRegion`, `threshold` (0–1, default 0.90), `maxMatches` (1–50), `timeoutMs`. Both refs are existing screenshot `artifactRef`s; no upload path is accepted. `Rect` coordinates are integers in screenshot pixels; regions must be non-empty and fully inside their source image; template crop must be 8–512 pixels in each dimension. Output: `matches[{rect:{x,y,width,height},score}]`, both source refs, `coordinateSpace:"screenshot-px"`, `viewportGeneration`, `truncated`. | Crop template/search regions in memory from owner-scoped PNG screenshots. Use `@techstark/opencv-js@5.0.0-release.1` `TM_CCOEFF_NORMED`, exact same-scale matching, and deterministic ordering by score descending then y/x ascending. The score is normalized pixel similarity, not a probability. Non-maximum suppression uses IoU > 0.50; max 50 matches. Reject decoded images over 16 megapixels or 64 MiB; cap worker memory at 128 MiB and run in a killable worker with a 5-second deadline. It only finds pixel patterns; no object/semantic search, confidence calibration, click, or coordinate action. A stale screenshot remains historical evidence and cannot be used as an action target. |
| `browser_ocr` | Input: `contextRef`, `screenshotRef`, optional `language` (default `en-US`), optional `region:{x,y,width,height}`, `maxLines` (1–500), `timeoutMs`. Output: `lines[{text,rect,words[]}]`, `sourceScreenshotRef`, `language`, `engine:"Windows.Media.Ocr"`, `coordinateSpace:"screenshot-px"`, `truncated`. | Delegate to [`missing-native-helper-contract.md`](missing-native-helper-contract.md): `createWindowsBrowserHelper().ocr({png,language,region,maxLines,deadline,signal})`. The runtime obtains `png` only through internal owner/hash-verified `analysisRead`, never from a tool path. Reject encoded PNGs over 4 MiB, decoded RGBA over 64 MiB, images over 16 MP or WinRT's reported max dimension, and outputs over helper bounds. Never install a language pack or invent confidence scores. Boxes are observations only; they cannot be converted to action coordinates. |
| `browser_accessibility_audit` | Discriminated input: `start(contextRef,tabRef,standard,includeIncomplete,limit,requestKey,timeoutMs)`, `poll(auditRef,timeoutMs)`, or `cancel(auditRef,requestKey)`. `standard` is `WCAG21AA` or `WCAG22AA`; `limit` is 1–100. Start/poll returns `state:"running"` with `auditRef`, `state:"complete"` with `result`, or `state:"unknown"` with cleanup state; failures use the standard error envelope. | Pin `axe-core@4.14.0` (MPL-2.0). Map `WCAG21AA` to tags `wcag2a,wcag2aa,wcag21a,wcag21aa`; `WCAG22AA` adds `wcag22aa`. Start a fixed isolated-world async ticket bound to context/tab/document generation; do not use the synchronous `pageOperation` JSON path. Poll/cancel never re-run the audit. One ticket per document, 10-second execution deadline, 30-second maximum ticket TTL. Bound output by the requested limit, at most 100 nodes/rule, 256-char HTML excerpts, 1024-char summaries, and 245,760 bytes total. Cancel drops the result; it cannot claim to stop axe's already-running page computation. Redact values/passwords; mint `elementRef` only for an exact current-generation target. A scan is not a full conformance statement. |

`role` is a finite supported ARIA role enum, not arbitrary CDP input. The exact
role list is shared by input and output schemas and is tested against the pinned
Chrome protocol version. Every path-bearing tool rejects unknown roots and
symlink escapes before dispatch. No tool returns raw native IDs, paths outside
an explicitly requested safe display name, or arbitrary CDP messages.

The following TypeScript-style declarations are the schema source for the
strict JSON Schemas. `Ref` is a non-empty opaque string with a 64-character
maximum; `requestKey` is a non-empty string with a 128-character maximum;
`timeoutMs` is an integer from 100 through 30,000. Every listed union is
discriminated by `action` or `mode`, and rejects fields belonging to another
branch.

```ts
type Dispatch = "notSent" | "sent" | "acknowledged" | "unknown";
type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";
type Key = "ENTER" | "TAB" | "ESCAPE" | "BACKSPACE" | "DELETE" | "SPACE"
  | "ARROWUP" | "ARROWDOWN" | "ARROWLEFT" | "ARROWRIGHT"
  | "HOME" | "END" | "PAGEUP" | "PAGEDOWN"
  | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8"
  | "F9" | "F10" | "F11" | "F12";
type Modifier = "CTRL" | "ALT" | "SHIFT" | "META";
type Rect = { x: number; y: number; width: number; height: number };
// In JSON Schema, x/y/width/height are integers; x/y >= 0 and width/height >= 1.
type ScreenshotRef = Ref; // Same opaque artifactRef returned by browser_screenshot.

type PressKeysInput = {
  contextRef: Ref; tabRef: Ref;
  keys: Array<{ key: Key; modifiers?: Modifier[] }>;
  requestKey: string; timeoutMs?: number;
}; // 1..20 keys.
type PressKeysData = {
  inputMethod: "cdp-key-events"; dispatchState: Dispatch; sentCount: number;
  releasedKeys: Array<Key | Modifier>; verified: false;
}; // Release distinct modifiers once, in reverse press order, on every exit.

type SemanticQueryInput =
  | { mode: "natural-language"; contextRef: Ref; tabRef: Ref;
      query: string; limit: number; timeoutMs?: number }
  | { mode: "ax"; contextRef: Ref; tabRef: Ref; role: AriaRole;
      accessibleName: string; limit: number; includeDisabled: boolean;
      timeoutMs?: number };
type SemanticQueryData =
  | { mode: "natural-language"; matches: Array<{ candidateId: string;
      elementRef: Ref | null }>; abstained: boolean;
      provider: { name: "ollama"; model: string }; truncated: boolean }
  | { mode: "ax"; matches: Array<{ role: AriaRole; accessibleName: string;
      disabled: boolean; checked: boolean | null; expanded: boolean | null;
      selected: boolean | null; elementRef: Ref | null; refAvailable: boolean }>;
      source: "chrome-accessibility-tree"; truncated: boolean };

type DialogInput =
  | { action: "arm"; contextRef: Ref; tabRef: Ref; triggerRequestKey: string;
      requestKey: string; mode: "manual"; expectedType: DialogType;
      expectedMessage?: string; mismatchPolicy: "dismiss" | "leaveOpen";
      expiryPolicy: "dismiss" | "leaveOpen";
      releasePolicy: "dismiss" | "detach"; ttlMs: number }
  | { action: "arm"; contextRef: Ref; tabRef: Ref; triggerRequestKey: string;
      requestKey: string; mode: "auto"; expectedType: DialogType;
      expectedMessage?: string; autoResponse: { accept: boolean;
        promptText?: string }; mismatchPolicy: "dismiss" | "leaveOpen";
      expiryPolicy: "dismiss" | "leaveOpen";
      releasePolicy: "dismiss" | "detach"; ttlMs: number }
  | { action: "wait"; dialogWatchRef: Ref; timeoutMs?: number }
  | { action: "respond"; dialogRef: Ref; accept: boolean;
      promptText?: string; requestKey: string; timeoutMs?: number }
  | { action: "cancel"; dialogRef: Ref; disposition: "dismiss";
      requestKey: string; timeoutMs?: number };
type DialogState = "armed" | "pending" | "open-manual" | "open-mismatch"
  | "responded" | "dismissed-by-policy" | "cancelled" | "expired-no-dialog"
  | "expired-open" | "unknown";
type DialogData = { action: "arm"; dialogWatchRef: Ref; state: "armed";
    expiresAt: string }
  | { action: "wait"; dialogWatchRef: Ref; dialogRef: Ref | null;
    type: DialogType | null; message: string | null; state: DialogState;
    cleanupState: "released" | "retained" | "unknown" }
  | { action: "respond" | "cancel"; dialogRef: Ref; state: DialogState;
    dispatchState: Dispatch; cleanupState: "released" | "retained" | "unknown" };

type FilePickerInput =
  | { action: "arm"; contextRef: Ref; tabRef: Ref; triggerRequestKey: string;
      requestKey: string; releasePolicy: "cancel" | "detach"; ttlMs: number }
  | { action: "wait"; pickerWatchRef: Ref; timeoutMs?: number }
  | { action: "provide"; pickerRef: Ref; paths: string[];
      requestKey: string; timeoutMs?: number }
  | { action: "release"; pickerRef: Ref; requestKey: string }
  | { action: "cancel"; pickerWatchRef: Ref; requestKey: string };
type FilePickerData = { action: "arm"; pickerWatchRef: Ref; state: "armed";
    expiresAt: string }
  | { action: "wait"; pickerRef: Ref | null;
      mode: "selectSingle" | "selectMultiple" | null;
      state: "pending" | "open" | "expired" }
  | { action: "provide"; pickerRef: Ref; selectedCount: number;
      selection: "assigned"; verification: "browser-acknowledged";
      stagedBytes: number; expiresAt: string; dispatchState: Dispatch }
  | { action: "release" | "cancel"; state: "released" | "cancelled";
      cleanupState: "released" | "unknown" };

type DownloadInput =
  | { action: "start"; contextRef: Ref; tabRef: Ref; url: string; filename?: string;
      requestKey: string; timeoutMs?: number }
  | { action: "get"; contextRef: Ref; downloadRef: Ref; timeoutMs?: number }
  | { action: "cancel"; contextRef: Ref; downloadRef: Ref;
      requestKey: string; timeoutMs?: number };
type DownloadData = { action: "start" | "get" | "cancel"; downloadRef: Ref;
    state: "in_progress" | "complete" | "interrupted" | "cancelled" | "unknown";
    fileName: string | null; bytesReceived: number; totalBytes: number | null;
    completedAt: string | null; completionEvidence: "downloads.onChanged"
      | "downloads.search" | "none"; dispatchState: Dispatch };

type LaunchInput =
  | { action: "start"; profileAlias: string; url?: string;
      requestKey: string; timeoutMs?: number }
  | { action: "status"; launchRef: Ref }
  | { action: "close"; launchRef: Ref; requestKey: string;
      timeoutMs?: number };
type LaunchData = { action: "start" | "status" | "close";
    launchRef: Ref; state: "starting" | "running_unpaired" | "closed" | "failed" | "unknown";
    processOwned: boolean; browserVersion: string | null; connectionRef: Ref | null;
    tabRef: Ref | null; automationReady: boolean;
    reason: "SEPARATE_BRIDGE_ATTACHMENT_REQUIRED" | "PROFILE_BUSY"
      | "OWNERSHIP_UNPROVEN" | null; dispatchState: Dispatch };

type ClipboardInput =
  | { action: "read"; maxChars: number; timeoutMs?: number }
  | { action: "write"; text: string; requestKey: string; timeoutMs?: number };
type ClipboardData = { action: "read"; format: "text"; text: string;
    observedAt: string }
  | { action: "write"; format: "text"; writtenChars: number;
    verification: "acknowledged"; dispatchState: Dispatch };

type VisualFindInput = { contextRef: Ref; targetScreenshotRef: ScreenshotRef;
  templateScreenshotRef: ScreenshotRef; templateRegion: Rect;
  searchRegion?: Rect; threshold: number; maxMatches: number; timeoutMs?: number };
type VisualFindData = { matches: Array<{ rect: Rect; score: number }>;
  sourceScreenshotRef: ScreenshotRef; templateScreenshotRef: ScreenshotRef;
  coordinateSpace: "screenshot-px"; viewportGeneration: number;
  truncated: boolean };

type OcrInput = { contextRef: Ref; screenshotRef: ScreenshotRef;
  language: string; region?: Rect; maxLines: number; timeoutMs?: number };
type OcrData = { width: number; height: number;
  lines: Array<{ text: string; rect: Rect;
  words: Array<{ text: string; rect: Rect }> }>;
  sourceScreenshotRef: ScreenshotRef; language: string;
  engine: "Windows.Media.Ocr"; coordinateSpace: "screenshot-px";
  truncated: boolean };

type AuditResult = { engine: "axe-core"; engineVersion: "4.14.0";
  standard: "WCAG21AA" | "WCAG22AA"; summary: { violations: number;
    incomplete: number; passes: number }; violations: Array<{ id: string;
    impact: "minor" | "moderate" | "serious" | "critical" | null;
    description: string; help: string; helpUrl: string; tags: string[];
    nodes: Array<{ targetPath: string[]; elementRef: Ref | null;
      htmlExcerpt: string; failureSummary: string | null }> }>;
  incomplete: Array<{ id: string; targetPath: string[]; reason: string }>;
  truncated: boolean };
type AccessibilityAuditInput =
  | { action: "start"; contextRef: Ref; tabRef: Ref;
      standard: "WCAG21AA" | "WCAG22AA"; includeIncomplete: boolean;
      limit: number; requestKey: string; timeoutMs?: number }
  | { action: "poll"; auditRef: Ref; timeoutMs?: number }
  | { action: "cancel"; auditRef: Ref; requestKey: string };
type AccessibilityAuditData =
  | { action: "start" | "poll"; auditRef: Ref; state: "running";
      expiresAt: string }
  | { action: "start" | "poll"; auditRef: Ref; state: "complete";
      result: AuditResult }
  | { action: "start" | "poll"; auditRef: Ref; state: "unknown";
      cleanupState: "ticket-retained" | "unknown" }
  | { action: "cancel"; auditRef: Ref; state: "cancelled" | "unknown";
      cleanupState: "result-dropped" | "unknown" };
```

The supported `AriaRole` enum is pinned in the schema from the role values
reported by the Chrome AX protocol: `alert`, `button`, `checkbox`, `combobox`,
`dialog`, `grid`, `gridcell`, `heading`, `img`, `link`, `list`, `listbox`,
`listitem`, `menu`, `menuitem`, `option`, `progressbar`, `radio`, `row`,
`scrollbar`, `searchbox`, `slider`, `spinbutton`, `status`, `switch`, `tab`,
`table`, `textbox`, `toolbar`, `tooltip`, and `treeitem`. A non-enum role is a
schema error before dispatch.

### Launch lifecycle

`browser_launch` uses these states: `ABSENT -> STARTING -> RUNNING_UNPAIRED`.
`RUNNING_UNPAIRED` is the terminal state for this slice: it returns an owned
`launchRef` but no `connectionRef`, `tabRef`, or automation readiness. A later,
separate bridge-attach design may transition a launch to `CONNECTED` only after
the unique `UIPATH_BRIDGE_INSTANCE` endpoint, native-host handshake, companion
pairing epoch, pinned driver, and exact tab identity are all verified. A process
start or visible Chrome window alone never causes that transition.

`start` stores a 128-bit launch nonce, canonical executable path, profile alias,
configured user-data directory, Windows process handle, PID, process creation
time, and generated bridge instance ID. `status` compares the live handle/PID
creation time, executable path, and profile lock before claiming `processOwned`.
If the handle is gone or PID creation time differs, transition to `UNKNOWN`;
never infer ownership from PID or process name alone. `close` sends a graceful
close only to a window/process identity recorded by that launch. If there is no
unique owned window or profile lock, return `OWNERSHIP_UNPROVEN`; do not kill
`chrome.exe` by name or force-kill a process tree. Report `CLOSED` only after
the exact owned process exits and the profile lock is independently absent.

### Availability and configuration

| Tools | Required local readiness | Default behavior when missing |
|---|---|---|
| `browser_press_keys`, `browser_dialog`, `browser_file_picker`, `browser_download`, semantic AX mode | Companion extension installed in the selected Chrome profile, separate native-messaging host registered, valid profile pairing and epoch, target tab attach allowed. | `browser_capabilities` reports the specific missing companion, unpaired profile, debugger conflict, unsupported picker, or policy restriction. After implementation and static registration, a call fails with `BACKEND_UNAVAILABLE` before dispatch while readiness is false. |
| `browser_semantic_query` natural-language mode | Companion readiness plus explicit `UIPATH_SEMANTIC_MODEL`; Ollama listening on IPv4 loopback `127.0.0.1:11434` with that model installed. | Report this mode unavailable when service/model is absent. No remote fallback. |
| `browser_launch` | Explicit executable and isolated profile alias in local config; profile is not locked by another Chrome. Extension presence is reported separately and is not inferred from process start. | After implementation, report unavailable without safe launch configuration and fail before process creation. Never default to the user's shared `Default` profile. |
| `system_clipboard` | Windows and Windows PowerShell STA clipboard support in the same interactive session. | Report unavailable if session/backend probe fails; do not read clipboard contents during probing. |
| `browser_visual_find` | Pinned local OpenCV.js matcher and PNG decoder packaged with runtime. | Report unavailable if package or bounded image decoder is absent. |
| `browser_ocr` | Windows OCR API and requested language available. `en-US` is the observed host language; other machines/languages are rechecked. | Report unavailable if the configured default language is unsupported; a call for a requested unsupported language returns a typed unsupported-language error. |
| `browser_accessibility_audit` | Pinned axe-core bundle packaged and fixed asynchronous isolated-world ticket route ready. | Report unavailable if bundle or script route is absent. |

Use explicit local configuration for upload roots and launch profile aliases.
Do not accept arbitrary endpoint URLs, scripts, Chrome flags, model names, or
native commands from tool input. The Ollama endpoint is fixed to
`http://127.0.0.1:11434`; the configured model name is local configuration, not
tool input. The natural-language mode uses direct IPv4 loopback HTTP, rejects
redirects, bypasses environment proxies, caps request/response bytes and
generation tokens, and returns only allowlisted candidate IDs or abstention.
An absent Ollama service/model disables that mode; there is no remote fallback.

### Tool discovery and local-only dispatch

MCP `tools/list` is synchronous and performs no I/O. Once each implementation,
strict schema, and offline contract test exists, register its tool statically
with the other runtime tools. The ten tools bring the source-complete target to
57 MCP tools. Before an adapter exists, keep its current unsupported coverage
record and do not publish a stub. After the real adapter exists, retain the
tool in `tools/list` even when its backend is unconfigured; a call checks the
cached readiness state and returns typed `BACKEND_UNAVAILABLE` before any
dispatch. This is a real adapter with a truthful setup gate, not a no-op
placeholder. `browser_capabilities` reports per-tool/per-mode availability and
reason.

Backend probes run asynchronously at initialization and on explicit
`browser_capabilities` refresh when the cache is older than 30 seconds. They
update an immutable readiness snapshot with fixed deadlines; tools/list never
waits or changes dynamically. No probe reads or writes clipboard contents.

The Windows helper's `capabilities({deadline,signal})` is read-only and supplies
clipboard/Windows OCR readiness without touching the clipboard. Ollama
readiness checks only the fixed loopback service and configured model. Companion
availability is event-driven from its authenticated handshake/pairing. Image
matcher/decoder and axe bundle readiness comes from local package loading.
Launch readiness checks only explicit profile configuration and lock/ownership
state. Probe results have a 30-second cache; tools/list never waits on a probe.

`system_clipboard`, `browser_ocr`, and `browser_visual_find` are local-only
handlers. They must bypass the browser runtime's `run()`/driver-activation path;
OCR/visual read only context-owned screenshot artifacts. `browser_launch` is a
configured local process action and also does not require a browser context.
Browser-side tools use the normal context/driver path plus the paired companion.
`browser_accessibility_audit` uses the normal browser context but starts one
bounded isolated-world async ticket; `poll` does not re-run the scan.

### Exact local dependency pins

Use exact lockfile versions: `@techstark/opencv-js@5.0.0-release.1`
(Apache-2.0), `pngjs@7.0.0` (MIT), and `axe-core@4.14.0` (MPL-2.0). Registry
metadata confirms these versions and licenses as of this design date. Keep the
Ollama client on Node's built-in `node:http`; Windows OCR/clipboard use the
separate reviewed helper. Run the repository license check before adding the
lockfile changes. No package is installed or loaded into Chrome by this design.

## Alternatives Considered

### Reuse only the UiPath extension

It is already installed and declares debugger/download permissions. The audited
bridge does not expose the required typed lifecycle, file chooser, dialog, or
download routes. Adding a public MCP API over the existing `AttachDebugger`
entry would expose an unverified protocol and conflict with the current strict
adapter boundary. Keep UiPath for its current APIs and use a typed, separately
installed companion for the missing Chrome APIs.

### Enable Chrome remote debugging

Remote debugging flags would create a separate control endpoint and require
changing the browser launch/security configuration. They are prohibited for
this work and are unnecessary because an extension can use `chrome.debugger`
without opening a remote-debugging port.

### Use OS keyboard automation for page keys

Windows `SendInput` targets the foreground desktop, not an exact Chrome tab. A
foreground check followed by a global key dispatch still races with user focus
changes. It cannot meet the required tab identity. Use tab-targeted CDP key
events, and fail closed when the companion cannot attach.

### Watch the Downloads folder for any new file

File appearance alone cannot distinguish pre-existing files, `.crdownload`
partials, or simultaneous downloads. Chrome's `DownloadItem` has no source tab
ID. Start through `chrome.downloads.download` and retain the returned ID instead.

### Treat string matching as semantic AI

Lexical matching is not natural-language semantic reasoning, and AX role/name
matching does not understand a description such as “the account menu.” The
design keeps an explicit structured AX mode and a separate Ollama-backed
natural-language mode. The latter is unavailable until a user explicitly
configures a local model; it never falls back to lexical search.

### Use DOM snapshot as an accessibility audit

A snapshot cannot evaluate accessibility rules or computed outcomes. Bundle a
real audit engine (`axe-core`) and report only its selected automated checks.

## Non-Functional Requirements

### Security and privacy

* Companion extension installation and native-host registration require a
  separate explicit user action. The existing UiPath allowed-origin list stays
  unchanged. Do not run registration or load the companion into a live profile
  as part of source implementation or unit tests.
* `chrome.debugger` has powerful browser access. The companion exposes only the
  finite operations in this design, binds each one to a lease and selected
  tab, and detaches on cleanup. It never accepts a raw method name or params.
* Clipboard reads may contain secrets. Do not log the value, include it in
  diagnostics, or return it from any tool other than the requested read.
  Clipboard writes replace global user state.
* Upload paths are limited to configured roots. Do not return full paths in
  results. Download paths remain Chrome-managed. Do not auto-open downloaded
  files.
* Page content and accessible names are untrusted. Semantic query and audit
  return observations only; neither evaluates page-provided JavaScript nor
  takes actions from text.
* OCR, visual, and audit outputs are bounded before MCP publication. Do not log
  page content, file content, OCR text, clipboard data, or the model/provider
  payload. Ollama receives only bounded candidate metadata over IPv4 loopback;
  no browser URL, query string, form value, cookie, or file content is sent.

### Timeouts and failures

Timeouts are one absolute budget for queue wait, backend dispatch, result
validation, and cleanup. If a stateful call might have reached Chrome or Windows,
return `unknown`; do not retry. Dialog response, key release, debugger detach,
and process cleanup have bounded cleanup budgets and explicit unresolved states.
The public result never upgrades an ACK to a verified business outcome.

### Rollout

Land source adapters and offline tests first. EGM review must pass before
implementation. Live verification uses a disposable loopback fixture and a
dedicated profile only after the user explicitly approves companion installation
and registration. The shared browser, existing registry, native-host origin
list, and Chrome security settings are not modified by tests. Existing 42 tools
and four legacy APIs remain unchanged.

## Open Questions and Review Gates

1. **Companion distribution:** Choose the installation and signing path. Chrome's
   `debugger` permission may show a prominent permission warning. The native
   host must be registered as a separate host with the companion's exact origin;
   the existing UiPath host origin must not be widened.
2. **Debugger coexistence:** Verify the pinned Chrome version's competing
   debugger behavior with DevTools and UiPath screenshot/debug actions. A busy
   target must fail before dispatch; no fallback is allowed.
3. **Profile-specific launch connection:** The current HKCU host registration
   is shared across Chrome profiles and the IPC endpoint is not profile-scoped
   by default. `browser_launch` may report only `launchRef` until a unique
   `UIPATH_BRIDGE_INSTANCE` endpoint and a separate native-host handshake are
   verified. Never fabricate `connectionRef` or `tabRef` from process start.
4. **OpenCV packaging:** Pin and license-scan the OpenCV.js WebAssembly
   distribution and PNG decoder before exposing `browser_visual_find`. The
   selected package must be local/offline at runtime and pass bounded-image
   performance tests.
5. **axe-core release pin:** Select and license-scan an exact axe-core version
   in `package-lock.json`; keep supported standards and engine version in
   capabilities/results.

These are readiness gates, not permission to change the user's browser. Resolve
the distribution, debugger coexistence, and isolated-profile process ownership
gates before public exposure or live setup; scoped source work does not install
the companion or modify a live browser.

## Detailed Implementation Plan

### Target files to create or modify

| File | Change and owner |
|---|---|
| `src/browser-tools.mjs` | Replace ten context-only placeholders with the strict action-union schemas and output schemas above. **Owner:** tool contract. |
| `src/browser-runtime.mjs` | Add dispatch, request-key/idempotency policy, deadlines, context/session ownership, and per-tab coordination for the ten tools. **Owner:** runtime integration. |
| `src/capabilities.mjs` | Add actual backend readiness and typed unavailable reasons; never infer readiness from manifest permissions or receipts. **Owner:** capability reporting. |
| `src/bridge.mjs` | Connect typed tool requests to existing UiPath host, optional companion channel, Windows helpers, and cleanup on client release. Keep UiPath origin and existing APIs unchanged. **Owner:** bridge wiring. |
| `src/browser-companion-client.mjs` (new) | Typed request/response client, readiness handshake, profile session and lease validation, timeout and disconnect handling. No raw CDP passthrough. **Owner:** broker protocol. |
| `companion/manifest.json` (new) | MV3 companion manifest with only the enumerated permissions and exact native-messaging host name. **Owner:** browser package. |
| `companion/service-worker.mjs` (new) | Implement key, dialog, input-file, AX-tree, and owned download operations; serialize debugger leases per tab and persist only recovery metadata needed for service-worker restart. **Owner:** browser backends. |
| `companion/README.md` (new) | Manual package/install steps, permission text, removal steps, and explicit statement that installation is not automatic. **Owner:** setup documentation. |
| `src/companion-native-host.mjs` (new) | Separate native-messaging proxy with strict frames and a distinct local IPC endpoint. It must not alter the UiPath host registration. **Owner:** companion transport. |
| `companion/native-host.json` and `companion/native-host.cmd` (new) | Companion host manifest and launcher; exact companion `allowed_origins`; no user-specific absolute paths in Git. **Owner:** companion transport. |
| `scripts/Register-CompanionHost.ps1` and `scripts/Unregister-CompanionHost.ps1` (new) | Explicit opt-in HKCU registration/removal for only the new host name. No default Setup mode calls these scripts. **Owner:** optional installation. |
| `src/browser-semantic.mjs` (new) | Query supported roles and exact computed accessible names through the companion; convert AX backend nodes to existing scoped refs only after normal registry validation. **Owner:** local semantic query. |
| `src/browser-dialog.mjs` (new) | Watch/ref registry, policy matching, independent wait/respond lane, and bounded dismissal/cleanup. **Owner:** modal lifecycle. |
| `src/browser-file-picker.mjs` (new) | Upload-root canonicalization, picker watch registry, mode/count validation, and result mapping. **Owner:** file input lifecycle. |
| `src/browser-download.mjs` (new) | Start, poll, cancel, and owner-scope Chrome download IDs; no folder watcher fallback. **Owner:** download lifecycle. |
| `src/browser-keys.mjs` (new) | Key enum mapping, key-down/up pairing, cleanup, unknown outcomes, and action ledger. **Owner:** tab-targeted keyboard. |
| `src/browser-visual.mjs` (new) | Read managed PNG artifacts, call pinned local OpenCV.js template matching, bound pixels/results, and preserve screenshot coordinate provenance. **Owner:** local image matching. |
| `src/browser-ocr.mjs` (new) | Call Windows OCR through a bounded STA helper, check installed language, and normalize boxes to screenshot pixels. **Owner:** Windows OCR. |
| `src/browser-accessibility.mjs` (new) | Run the pinned axe-core bundle through the fixed isolated-world route; redact and bound results and map only exact live targets. **Owner:** local accessibility engine. |
| `src/system-clipboard.mjs` (new) | Invoke constant PowerShell STA scripts with stdin payloads, deadlines, output bounds, and no clipboard logging. **Owner:** Windows clipboard. |
| `src/browser-launch.mjs` (new) | Validate configured isolated profile aliases, start/observe only owned Chrome launches, and close only proven owned windows/processes. Return no browser refs until bridge identity is verified. **Owner:** process lifecycle. |
| `package.json`, `package-lock.json` | Add exact pinned OpenCV.js/PNG decoder and axe-core dependencies; keep OCR/clipboard on Windows APIs and semantic query on Chrome AX. **Owner:** dependency and license review. |
| `test/browser-backends.test.mjs` (new) | Offline schema, ownership, result, deadline, no-retry, and side-effect tests using mocked backends. **Owner:** shared contracts. |
| `test/browser-companion.test.mjs` (new) | Companion request protocol, attach conflict, key-up cleanup, dialog queue bypass, picker lease, download ID ownership, and AX-node mapping tests. **Owner:** companion. |
| `test/native-backends.test.mjs` (new) | Mocked clipboard/launch and Windows OCR availability/output bounds; optional explicit local OCR test guarded by platform/language readiness. **Owner:** local OS adapters. |
| `scripts/run-browser-backends-live.mjs` (new) | Opt-in fixture runner for exact new tool names and cleanup receipts; requires explicit live flag and a separately configured disposable profile. **Owner:** live acceptance. |
| `scripts/fixtures/browser-backends.html` (new) | Loopback fixture for keys, alert/confirm/prompt, input[type=file], accessible roles/names, axe findings, and deterministic screenshot templates. **Owner:** live fixture. |
| `docs/browser-tool-contracts.json`, `docs/runtime-function-coverage.json`, `docs/RUNTIME-FUNCTION-COVERAGE.vi.md` | Regenerate/update ten exact schemas, backend routes, unsupported reasons, offline tests, and live evidence separately. **Owner:** contract and coverage. |
| `src/EGM.md`, `EGM.md`, `README.md`, `docs/EGM-WORKFLOW.md`, `docs/BROWSER-MCP-CONTRACTS.vi.md`, `docs/BROWSER-AUTOMATION-FEATURES.vi.md` | Document the implemented local/companion routes and revised boundaries. Keep catalog proposals distinct from source/test/live claims. **Owner:** documentation. |

### Verification plan

* **Offline tests:** Validate all ten schemas and output schemas; reject extra
  fields, malformed refs, path escapes, oversized inputs/results, unsupported
  language, and requests whose backend is absent. Use mock companion APIs to
  test exact request routing, session binding, queue behavior, deadlines,
  key-up/detach cleanup, dialog mismatch/timeout, file mode mismatch, download
  ID ownership, and no automatic retries.
* **Local engine tests:** OCR a generated PNG using only an installed language;
  confirm exact bounding boxes within tolerance and `LANGUAGE_UNAVAILABLE` when
  missing. Match a deterministic template in a fixture screenshot; cover no
  match, repeated match, overlapping match suppression, image bounds, deadline,
  and screenshot provenance. Run axe against known passing and failing fixture
  pages and verify sanitized bounded output.
* **Windows helper tests:** Mock process invocation and stdin/stdout for
  clipboard and launch; assert no clipboard content in logs, no shell
  interpolation, no shared-profile default, and no close when ownership is
  uncertain. Live clipboard test is opt-in and must use a dedicated known test
  value with restoration agreed before execution.
* **Companion fixture tests:** On a disposable, explicitly configured Chrome
  profile, exercise exact-page key default action, sync modal dialog arm/trigger/
  wait/respond, wrong-dialog policy dismissal, single/multiple HTML file input,
  `showOpenFilePicker()` rejection, owned URL download to completion/cancel,
  AX role/name query, debugger conflict, profile loss, and extension disconnect.
* **Evidence:** Keep offline adapter tests, package/build checks, companion live
  fixture receipt, and existing shared-profile evidence separate. No live
  receipt is created until user approval for the separate companion installation
  and disposable profile. Verify each cleanup by independent tab/profile
  enumeration; a close ACK alone is not proof of process or tab absence.

## Current Review Status

Fresh-context Sol/high focused readiness review permits source implementation
and mocked integration tests. This does not establish live browser support.
The following clarifications are mandatory and take precedence over common
protocol/lifetime descriptions above:

- `download.get`, `download.cancel` and `download.changed` are scoped by owner,
  companion profile-session/epoch and owned download ref. After successful start,
  they do not require the initiating document pair or debugger lease; those
  irrelevant tab/document/lease wire fields are nullable. Navigation invalidates
  the originating tab pair but not ownership of the transfer. Test get/cancel
  after navigation. Companion reconnect still requires explicit reconciliation.
- Reject a constant/zero-variance template crop with `INVALID_ARGUMENT` before
  `TM_CCOEFF_NORMED`. Reject non-finite matcher scores. A solid-color crop is a
  required negative test.
- Cancelling an axe ticket drops its result but retains the running-computation
  lock. A second scan of that document is rejected until the original promise
  settles or the document disappears. Test cancel followed by immediate start.
- For pairing from the UiPath content-script isolated world, `sender.id` is the
  authenticated extension identity. `sender.origin` describes the sending page
  or frame, not the extension. An optional internal `permittedOrigin` may add an
  exact page-origin guard; it never replaces nonce, sender ID, browser-provided
  tab/window/document metadata and epoch checks.

See [review ledger](missing-browser-backends-review.md). Installation, configured
models, process ownership and live fixture gates remain explicit runtime/setup
requirements; they do not prevent writing and testing the real implementations.

*Drafted with EGM*
