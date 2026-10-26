# Viewport capture visibility and paint readiness repair

Scope: existing browser_screenshot viewport API, extension23.10.1 / driver
23.4.55.39317, within the user-authorized full browser plan. No new provider,
debugger attachment, extension permission or protected-page interaction.

## Observed defect

The public full suite passes40/42 new tool names but capture fails in fresh
Chrome windows. A separate owned HTTP tab created by Browser Use in the normal
Chrome window is visibly rendered and the exact same UiPath/MCP viewport route
produces a26906-byte PNG plus a real MCP image block. A fresh MCP-created window
reports document.visibilityState=hidden, document.hasFocus()=true, positive
viewport dimensions and no double-rAF completion within1.5seconds. Active tab or
focus alone therefore does not establish a capturable renderer. Chrome155 reports
image readback failure or fails to answer. These observations do not prove a GPU
driver defect or that all windows on the connection are unavailable.

The current connection-global capture block is too broad. The repair uses target
visibility/readiness preconditions and preserves bounded native error reporting.

## Proposed bounded behavior

- Fixed ISOLATED `document` data adds visibility `visible|hidden|unknown`.
  Browser tab data exposes that same bounded field so callers can explicitly
  select a visible base tab. Logical active and document visibility stay distinct.
- Screenshot rejects hidden/unknown documents with TARGET_NOT_VISIBLE before
  TakeScreenshot. It does not activate tabs or raise/restore windows implicitly.
- For a visible document, arm a bridge-owned render ticket in ISOLATED state,
  wait for two animation frames, then poll readiness. Ticket owner/context and
  expected document are checked. Maximum lifetime2seconds, <=64tickets/document.
  Expiry, consumption and context release cancel scheduled frames/timer and
  remove the ticket. Every callback checks wall-clock expiry before readiness.
- Polling counts against the existing absolute tool deadline. Expired readiness
  returns CAPTURE_NOT_READY and sends no native screenshot request.
- Preserve active-tab/window/document guards before/after actual capture; also
  require visibility to remain visible. Return no artifact if capture identity
  or visibility changed. Native capture still has its own bounded response wait.
- Remove connection-global blocking caused by a target capture failure. Keep
  structured CAPTURE_FAILED vendor code/message and genuine native timeout
  identity. Explicit reads on another visible target remain possible. No automatic
  retry of native capture occurs inside the tool.

## Acceptance and evidence

Offline: hidden target sends no TakeScreenshot; visible mock uses bounded paint
tickets; timeout/cancel cleanup is bounded; a failure does not disable other
targets; all updated tab output schemas validate. Mocks do not prove painting.

Live: create an owned HTTP base tab through Browser Use, explicitly discover/
attach to that base, then open the full fixture in the same visible window. The
runner gets an optional --base-url selector and keeps its no-silent-active rule.
Run all42 new tool names, PNG artifact inspect/read/save, then verify owned tab,
context and server cleanup. Test the hidden-new-window rejection separately.
Record the exact rendered-window scope; native multi-RPC races, all screenshot
formats/sites and every broader planned scenario remain separate acceptance.

## Concrete contract and review resolutions

`pageOperation` gains `render` with action arm/poll/cancel. Arm takes ttlMs
100–2000 and returns `{ticket,ready:false}`; poll requires the same context owner,
document token and ticket, returning `{ticket,ready:false}` until two frames or
`{ticket,ready:true}` while consuming it. A ticket from another owner fails
REF_SCOPE_MISMATCH. Missing/expired poll is CAPTURE_NOT_READY. Cancel is idempotent
for missing/consumed/expired tickets and removes only the caller-owned ticket.
Callbacks never touch business DOM. They check expiresAt before setting ready.
The page state has <=64 tickets; expiry/consume/cancel removes both rAF handles
and timeout. Owner release cancels its remaining tickets.

All arm/poll/cancel calls use r.page mutates=false, preserving read dispatch state.
The screenshot registers touchFrame before arm dispatch, including lost-ACK paths.
Its finally attempts idempotent cancel only within remaining tool budget; when
there is no remaining budget or an arm ACK was lost, the independent2second
expiry and registered owner-release path bound the ticket. Cleanup failure does
not replace the primary error or quarantine writes. The existing budget check
takes precedence: released context -> STALE_CONTEXT, expired tool deadline ->
TIMEOUT. Ticket expiry while budget/context remain valid -> CAPTURE_NOT_READY.
Only an actual TakeScreenshot response timeout carries nativeCode
NATIVE_RESPONSE_TIMEOUT. Readiness errors never dispatch that request and never
set an unknown-write block.

Normalize document visibility to visible/hidden/unknown. Both adopt(existing/new)
and tab() copy current document visibility into tab records. tabData returns it.
Strict output schema objects containing tabRef/url/title/documentGeneration gain
visibility: browser_tabs entries, initialized browser_tab_open, browser_tab_get
and browser_wait_new_tab.tab. Pending tab-open returns visibility:unknown as an
allowed optional field. No legacy uipath_* result changes.

Additional observed comparison: the same visible HTTP tab reports visible,
focused:true and double-rAF completion, but the current global block rejects it
without dispatch after a separate hidden-window timeout. This directly supports
removing that global block. Two frames remain a readiness observation, not a
guarantee native capture will succeed; native errors retain their own handling.
