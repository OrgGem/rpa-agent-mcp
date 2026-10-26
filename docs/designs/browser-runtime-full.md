# General browser runtime and MCP implementation

Scope authorized by the existing phase plan and request to implement its full
supported feature set. Baseline: ac7d999, extension 23.10.1, driver 23.4.55.39317.
G0 receipts remain historical. New adapters need separate tests and live receipts.

## Goal and boundaries

Implement F1-F4 browser tools, plus the artifact work in F5.3, against the pinned
extension. Keep the four legacy APIs. Do not publish placeholder tools. All 53
roadmap tool names receive an implementation or a specific unavailable-backend
reason in coverage. External OCR/vision/semantic/audit providers, OS file/dialog
helpers, native process/clipboard control and profile-wide cookie replacement
remain unavailable until a separate backend exists. Synthetic DOM input is
identified explicitly; it does not claim trusted OS keyboard/pointer events.

## Components and ownership

- src/browser-tools.mjs: tool definitions, strict input schemas and subset JSON
  schema validator shared by MCP and native dispatch; common structured envelope.
- src/browser-runtime.mjs: one runtime per native connection, context/tab/frame/
  element/watch/artifact registries and typed tool dispatch. No arbitrary native
  function/messageId endpoint. Dependency-injected native request and activation.
- src/browser-page.mjs: fixed isolated-world scripts for document/node identity,
  bounded DOM observation and composite operations, plus user evaluate wrapper.
- src/browser-artifacts.mjs: bounded local artifact storage under ignored work/;
  opaque owner-scoped IDs, no arbitrary filesystem read or overwrite.
- package.json/package-lock.json: move the existing pinned Ajv dependency from
  development-only to production for shared runtime schema validation. Update
  src/EGM.md's dependency-free runtime statement in the same implementation.
- src/bridge.mjs: create native runtime, route private browser_tool IPC, merge
  implemented MCP definitions, return structured errors, release client scope.
- src/capabilities.mjs: list actual implemented options and unavailable reasons;
  distinguish adapter tests from dated live fixtures. No automatic promotion from
  an arbitrary receipt/status field. Native runtime supplies a typed descriptor.
- src/transport.mjs: separately bounded inbound native decoder (8 MiB) for images;
  outbound native/IPC/MCP lines retain 1 MiB. Images become artifacts before IPC.
- test/browser-*.test.mjs: protocol/schema/identity/queue/error/artifact tests.
- scripts/run-browser-live.mjs and fixtures: independent controlled pages and
  MCP client, public-tool workflows, no raw native shortcuts or blind retries.
- docs/DEVELOPMENT-PHASES.vi.md, coverage JSON/Markdown, component contracts,
  README and function-matrix generator: exact implemented/verified/unsupported
  scope, source hashes, live outcomes and outstanding provider requirements.

## Ref lifecycle and document identity

The native runtime has a random connectionRef which changes on host replacement.
Each MCP process has a random clientRef sent only by its internal IPC wrapper.
Context and target refs bind client, connection and context. Validate all refs
before native dispatch; cross-client/context refs fail closed. No profile name is
inferred from URLs or machine paths. Attach selects the current connection and
an optional explicitly supplied tabRef; never silently attach the active tab.

Tab discovery creates opaque refs from a bounded, validated FindBrowserTabs
enumeration. Track openTabsCount/truncation; absence in a truncated enumeration
does not prove closure. Tab close returns acknowledgement until a complete
enumeration independently confirms the exact native ID is absent.

Use InjectAndRunJs executionWorld=0 for fixed bridge scripts. A bridge-owned
per-document state in the extension isolated realm stores document UUID,
WeakMap(node -> UUID) and bounded weak node lookup. Replace state when document
object changes. Each operation reads the document token; changed token advances
generation and invalidates dependent refs. Node UUID/connected checks reject
replacement. A frame binds its own document token, plus parent/frame-element
identity; a frame-only reload invalidates its descendants, not siblings.

Native FindSelectors returns validated tab|frame|local IDs; normalize frame|local
only internally. Inspection binds the resolved node to its isolated token.
Snapshot/CSS/XPath helpers may register native IDs only through the pinned,
source-audited GenerateCustomIdForElement helper in that same realm; live preflight
must prove availability before exposing these options. Never interpret a CSS
selector as a customId or heal a stale ref by rediscovery.

Typed isolated DOM operations can validate identity and act in one synchronous
call. UiPath native click/type remain separate RPCs with pre/post checks; they
are best effort, not atomic. Report method and this limitation. Do not claim a
fixture marker or URL equality identifies an arbitrary document.

## Validation, deadlines and outcomes

Arguments are objects with additionalProperties=false, bounded arrays/strings,
explicit discriminated action enums and finite integer timeouts (100-30000 ms).
Unknown options fail before dispatch. Registry limits: 16 contexts/client,
512 tabs/connection enumeration, 2048 element refs/context, 64 watchers/context,
128 events/watch, 256 cached write request keys/context. Ref/watch TTLs and
overflow return explicit limits, never silently evict a pending write outcome.

Every operation has one absolute deadline including activation, queue and all
native RPCs. Serialize all target-tab operations (including discovery allocator)
across contexts. Revalidate refs after queue acquisition. One nonretrying native
write dispatch per action; discovery timeout invalidates allocation state.

Use {ok,requestId,context,data,evidence,timing,error}. Error has code, message and
dispatchState (notSent/sent/acknowledged/unknown); page exceptions are bounded
data. MCP execution failures set isError; protocol failures stay JSON-RPC errors.
requestKey caches the complete write outcome under canonical argument fingerprint;
identical replay returns cached result, differing arguments conflict. Unknown
write outcome blocks more writes; metadata alone never clears it. Explicit
tab_get resolve requires the original requestKey and resolution=abandon-unknown.
That is the caller's deliberate decision to stop trying that action, not proof
of its business outcome. It keeps the cached unknown result immutable, invalidates
refs and permits different future actions. Never retry an uncertain write.

Reads recheck document/node identity before returning. Mutations distinguish
acknowledgement from postcondition verification; failed value/state verification
is a postcondition error, not success. A click that changes document invalidates
refs and can return acknowledged without claiming business success.

## Feature behavior

Start with strict attach/list/open/get/activate/close, navigate/reload/back/forward;
then native attributes and bounded snapshot/find/get/wait, native click/type and
desired-state check/select/scroll/focus. Locator support is explicit and literal
matching must escape driver wildcard syntax or reject it. No promised role/name
matching algorithm or closed shadow traversal without implementation.

Wait absent uses a locator and a valid empty result. Detached requires the same
document and known node disconnection; navigation/disconnect is an error.
Frame list/attach use validated parent-frame paths or frame IDs; nested and
cross-origin support have independent tests.

Composite HTML form/table/tree/calendar/popup tools have bounded collections,
exact matching, partial step results and no automatic pagination/submit. Native
and DOM input methods/options are separate capabilities. Keyboard event dispatch
does not imply native default Enter/Tab behavior; special-key routes remain
unavailable if the pinned native parser cannot target safely.

Evaluate accepts an anonymous function (element,input); bridge serializes
input/output explicitly. User code runs only in MAIN, while fixed bridge scripts
run isolated. Promise results use a bounded page-side job ticket and polling;
the native route itself remains synchronous. Reject nonserializable results and
isScriptErr even when retCode=1. Timeout cannot stop arbitrary page code and is
ACTION_OUTCOME_UNKNOWN, never an automatic retry. No server/filesystem execution.

Network watcher owns start/poll/stop per tab, prevents duplicate native start,
requires continuous quiet duration, and stops in finally. DOM events use bounded
isolated listeners, TTL and explicit unsubscribe. New-tab watchers use baseline
and strict URL matching; do not claim opener correlation if extension omits it.

Screenshot initially supports active-tab viewport only. Verify native window and
active-tab identity before/after capture, never silently activate. Store decoded
bounded image as an owner-scoped artifact before IPC; no huge base64 text reply.
Element/full-page modes require their own geometry/debugger acceptance. Cookie
operations must be origin scoped; the pinned profile-wide destructive restore is
not a domain-scoped write API and stays unsupported. Report visible-cookie-only
limits if using document.cookie; never claim HttpOnly access from that path.

## Verification and delivery

Fresh-context Goldfish readiness and protocol reviewers inspect this design and
source contracts before public rollout. Add focused unit/transport/MCP tests and
run npm test plus matrix validators. Test real public MCP calls on two-origin
fixtures with React, duplicate/missing targets, frame reloads, navigation,
cross-client refs, stale nodes, partial workflows and cleanup. Use Computer Use
for Chrome background reload and independent fixture tab-absence verification.
Keep generated machine state/vendor source ignored. Save failures and versions;
do not call mock tests or 423 planned scenarios live coverage.

## Readiness decisions and exact public contract

[browser-tool-contracts.json](../browser-tool-contracts.json) defines every new
tool's exact arguments, enums, bounds, required fields, annotations, defaults and
common structured output. It accounts for the 52 names beside the already shipped
browser_capabilities: 42 concrete browser/composite candidates and 10 unavailable
backends. Unsupported names are reported in capabilities/coverage but absent
from tools/list. No callable unsupported placeholder counts as implementation.
The four uipath_* tool schemas, text-content result/error behavior and null-arg
normalization stay unchanged. Only new tools use the common envelope. Capability
schema may add a versioned runtime descriptor; it must label actual evidence.

The typed default input method is DOM (isolated, synchronous identity + action).
It uses native property setters plus input/change events for text, and returns
method=dom. Explicit method=uipath uses the existing non-debugger click/WriteText
packets, with their non-atomic pre/post limitations. Do not silently switch
methods. Typed synthetic hover/HTML5 drag advertise only event-dispatch semantics,
never OS pointer movement/trusted input. Special-key default actions stay
unavailable because the audited normal token route ignores key type/flags.

For request keys, reserve key -> fingerprint + in-flight Promise atomically
before any await/dispatch. Concurrent identical calls join that Promise; a
different fingerprint conflicts immediately. Completed results, including unknown
outcomes, remain cached until context release/connection loss. Unknown writes
block the native tab across contexts; another context cannot bypass the block.
Only the originating context can explicitly abandon its original key. A released
owner with unresolved unknown writes leaves the tab blocked until host replacement.

Tab lifetime is conservative because the extension supplies numeric IDs without
an incarnation event stream. Complete enumeration retires refs for absent IDs.
Bind a public tab incarnation to the observed isolated document token/window ID;
an unexpected token/window replacement invalidates old tab refs before writes
(including indistinguishable close/reuse). Caller must rediscover. Explicit
navigate/history operations retire old refs and return a new tabRef after their
observed document transition; no old element/frame handle survives. This is a
stricter expiration policy than stable browser tab IDs, not automatic healing.

Frame list returns only immediate iframe/frame elements in the chosen parent
frame, with an elementRef. Attach requires that exact iframe ref and its parent
document/node checks. FindSelectors parentCustomId=parentFrame|iframeLocal,
target HTML, discovers exactly one full tab|childFrame|local result; validate the
tab and nonnegative numeric child ID, then read that frame's isolated document
token. Store parentFrameRef, iframe element identity, child native frame ID and
child document token. Each access validates the parent chain. Child reload affects
that frame and descendants; parent replacement affects its whole subtree.

Execution world pin is source-audited: active content handler at offset 3252935
uses exactly 1 for page MAIN, and 0 for extension ISOLATED. Alternate debugger
injection also maps 0 to ISOLATED. G0 did not verify this route. Live bootstrap
must prove cross-call isolated state persistence, different document token after
reload, and a MAIN-world marker invisible to the isolated script. Until this
passes, public document/node APIs cannot be described as live verified. Page
scripts cannot access that isolated JS state; explicitly authorized MAIN evaluate
does not receive bridge identity registry tokens.

Screenshot/activation/closing/navigation and all target-tab actions also hold a
connection-wide browser/window coordination lock (in addition to tab scope).
This deliberately conservative lock serializes cross-tab focus/capture work.
External user focus changes remain possible: capture requires matching native
window/active tab/document observations before and after, otherwise discard the
image and return unverified. No automatic activation or full-page debugger mode.

Concrete bounds: context idle TTL 30 minutes; element refs 10 minutes; events
and new-tab watches default 30 seconds, max 60; event queue 128 with droppedCount;
network observation uses the operation's <=30-second deadline and finally stop.
Artifacts: <=6 MiB decoded/file, <=32/client, <=64 MiB/client, <=128 MiB/runtime,
one-hour TTL. Filenames are generated opaque IDs; exports accept a basename only
inside the owned artifact export root, never arbitrary paths or overwrite.
Exclusive temp writes and rename occur only after quota checks; failures remove
only the owned partial file and return ARTIFACT_IO_ERROR. Client release expires
refs/watches and removes its temporary artifacts; TTL limits leftovers after
disconnect. These are same-user local tools, not an OS security boundary.

Native FindSelectors is retained for literal attribute discovery and explicit
iframe routing. For DOM CSS/XPath/text observation, isolated typed selectors
can return bridge-owned weak node refs directly. Native handles are optional and
must be obtained only from validated native results or a separately live-verified
pinned helper. DOM actions work with bridge-owned refs; method=uipath requires
an actual native handle and rejects otherwise. Snapshot is bounded and reports
truncation; strict matching never pretends a truncated search proves uniqueness.

Per-tool success data now has explicit bounded result schemas in the JSON
contract. Every success includes evidence with backend, dispatchState, outcome
and verified; errors include retryableRead, bounded details and recovery enum.
The four legacy results remain outside this envelope. Conditional schemas require
events subscribe types, poll/unsubscribe watchRef, new-tab arm URL and wait/cancel
watchRef, selection-set offsets, cookie-set values and artifact-save basename.
Select values/labels and focus tab/element targets are mutually exclusive.
Remaining semantic cross-field checks (wait target versus condition; form field
value/checked/selectedValues exclusivity; same-frame source/target; reserved
attribute names) run before any native dispatch and return INVALID_ARGUMENT.

Evaluate input JSON is <=16 KiB, result JSON <=64 KiB and depth <=16. All tool
results are <=240 KiB before MCP's text/structured duplication; typed page data
is <=192 KiB. Overflow after user-script dispatch returns RESULT_TOO_LARGE with
dispatchState=acknowledged, retryableRead=false and observe-do-not-retry recovery,
and keeps the unknown-action block. No smaller-output re-execution is automatic.
Snapshot/table/form truncate at declared row/node/byte limits before overflow.
Ajv uses strict validation with strictRequired=false solely for valid conditional
required clauses; unknown fields, wrong types and branch requirements still fail.

Stateful success schemas require explicit unknownWrite/resolution (nullable) on
tab_get, events/cursor/droppedCount on event polls, tab on new-tab waits, cookies
on cookie lists and selected action-specific tree/watch result fields. Network
observation uses arm/wait/cancel: arm before triggering a request, then wait for
continuous quiet among requests started since arm. It never claims to know
requests already in flight before listeners existed. Cancellation marks state
before awaiting cleanup so an active waiter cannot mistake stopped monitoring
for quiet. TTL/owner release stop the native listener; duplicate arms are rejected.

Network arm TTL is 30 seconds by default, configurable 1000-60000 ms, independent
of the arm call's deadline. Expiry marks the watch expired before stopping its
listener; subsequent wait returns WATCH_EXPIRED without a quiet claim. Cancel
after expiry is idempotent on the retained 60-second tombstone and reports whether
stop was confirmed. Cleanup failure is MONITOR_CLEANUP_UNCONFIRMED, not quiet.
