# F0.3: isolated G0 fixture and development probe

Status: implemented and offline-tested after scoped readiness/code review.
F0.5 connected the new host and live preflight passed. After correcting scoped
full-ID normalization, the main-frame smoke passed find 0/1/2, value read,
Unicode replace/append and one click with independent fixture reports. Tab/server
cleanup passed. Private probe is now disabled in the connected normal-mode host.
Full G0 remains false; iframe, stale refs and controlled/event semantics remain.

Readiness findings were accepted; the frozen wire, lifecycle and fixture details
below resolve them before coding. This is a source-candidate probe, not a claim
that these packets already work live.

## Goal

Prepare a real browser smoke test for the pinned discovery/read/type/click routes
without publishing unverified DOM tools. The normal five MCP tools stay unchanged.
The full G0 gate remains false: this slice targets a main-frame fixture only,
not frame lifetime, same-URL navigation or general web control compatibility.

## Boundary and interfaces

Add a private local IPC `g0_probe` operation. It has no MCP tool and is disabled
unless the native process starts with `UIPATH_G0_PROBE=1`. `preflight` reports
enabled/protocolVersion=1 without browser actions, even if disabled. No arbitrary
functionCall, JS, selector, customId, tabId, URL after open or text is accepted.

Allowed operations: preflight; open(fixtureUrl); find(sessionRef,target);
read(sessionRef,elementRef); type(sessionRef,elementRef,mode=replace|append);
click(sessionRef,elementRef); close(sessionRef). Reject unknown fields and wrong
types before dispatch. Target enum is input/missing/duplicates/button. Text is
fixed to `G0 Việt 😀` and append suffix ` + append`, flags fixed to zero for
click and inputOptions 0/4 for type (debugger off). This is a development test
adapter, not the proposed general browser API.

Open allows exactly `http://127.0.0.1:<explicit-port>/g0/<uuid>/page`, no credentials,
query or fragment. One active session, 5-minute TTL, no concurrent requests.
Use the UUID as sessionRef, return created tabId without retrying OpenTab.
Each subsequent command verifies tab URL and exact title `G0 fixture <uuid>`.
Refs are opaque UUIDs mapped in host memory to customId and fixture target;
check IsHtmlElemValid before read/write. Reject missing/stale/cross-session refs.
Discovery IDs must include the exact owned tab and main frame 0. The adapter
strips only the verified tab prefix and dispatches `0|localId` to background
handlers; nonzero frames are rejected by this main-frame-only probe. A navigation
or target mismatch invalidates the session; never close a tab that no longer
matches the fixture. Guarding is best effort; it cannot lock the user out of
Chrome or establish a security boundary against same-user processes.

Find builds the source-derived FindSelectors candidate in g0-protocol-notes.md:
one tag with exact attributes, FIND_ALL/DESCENDANTS, at most 10 results, false
location/ancestor/invisible/fuzzy/greedy flags, zero offsets and empty parent score.
Parse only retCode success plus one partial result's m_resultsCollection.m_results;
malformed/truncated/overflow output is an error, never a zero-match result.
Input targets id=g0-input, missing id=g0-missing, duplicates name=g0-duplicate,
button id=g0-button. Validate nonempty bounded IDs before storing refs.

Read uses GenericRequest messageId=5 and GetHtmlAttribute(id), requiring successful
retCode and bounded string values. Type uses WriteTextHtmlElem with one token;
click uses GenericRequest messageId=6 with fixed coordinates/flags. Only the input
ref can be typed and only the button ref clicked. No writes are retried. After
an ambiguous write exception, block further writes in that session, allow read
and cleanup, and record ACTION_OUTCOME_UNKNOWN. No raw backend error/page content
is included in receipts. Close attempts CloseBrowser once for the owned matching
fixture tab, drops session state even on cleanup failure, and reports tabLeftOpen.
Expired sessions reject actions but retain a bounded cleanup handle until close;
do not silently leak unlimited refs/sessions.

## Fixture and runner

HTTP fixture listens on 127.0.0.1 ephemeral port only, with UUID paths. It contains
one input, two duplicate-name inputs and a counter button. Browser-owned script
reports value/input/change/click counters to a bounded JSON report endpoint.
The server exposes a snapshot to the runner directly, separately from UiPath
readback. This controlled page is not an authentication boundary or evidence that
the page could not forge its own report. Reject foreign Origin, malformed/oversized
reports, non-increasing sequence and unknown paths; disable caching.

CLI `node scripts/run-g0.mjs` defaults to preflight (no navigation), writes
`work/g0-preflight.json`; `--live` verifies installed source hash against pinned
audit, requires enabled probe protocol, then starts fixture, opens once, checks
find 0/1/2, reads initial value, replace/readback/independent input counter,
append/readback, click/readback counter. Poll reports within a deadline; never
repeat actions. It writes `work/g0-live.json` on success or failure, distinguishing
smokePassed from g0GatePassed=false and evidenceLevel=live-fixture-attempt.
Always stop the fixture server, attempt owned tab cleanup if a session was opened,
and record cleanup outcome. Errors exit nonzero and never turn into pass receipts.

No installer or registry change is part of this slice. CLI fails preflight cleanly
when Chrome still connects to the old host. Installation/host transition remains
a separate explicit task with registration backup and rollback.

## Detailed Implementation Plan

- Create src/g0-probe.mjs: enabled-only allowlist adapter with injected request,
  openUrl, tabInfo, clock dependencies. Keep dev refs and bounded session state
  independent of the eventual public context/element registry.
- Modify src/bridge.mjs: create adapter, route private IPC operation, advertise
  g0ProbeProtocol only when enabled; preserve the five public tools and legacy APIs.
- Create scripts/g0-fixture.mjs: reusable loopback fixture builder with snapshot
  and close methods, page-owned event reports and strict request bounds.
- Create scripts/run-g0.mjs: preflight/default and explicit --live runner, bounded
  polling, source hash check, receipts and cleanup in finally.
- Create test/g0-probe.test.mjs: disabled/extra fields/arbitrary target rejected,
  exact discovery packet, zero/one/multiple/malformed result, wrong scope and TTL,
  write target binding, one token/options, no retry after timeout, close ownership.
- Create test/g0-fixture.test.mjs: loopback routes, nonce/origin/body validation,
  report sequencing and snapshot isolation, server cleanup. Simulated reports
  are offline plumbing tests, not actual Chrome events.
- Modify test/bridge.test.mjs to assert private IPC disabled by default and absent
  from public MCP discovery. Runtime status exposes only a disabled probe marker.
- Modify Setup.ps1: opt-in -EnableG0Probe only writes `set UIPATH_G0_PROBE=1` in
  the generated ignored launcher. Existing conflict detection and registry
  ownership rules remain unchanged. Default launcher explicitly clears this flag.
- Update scripts/README.md, src/EGM.md, scripts/EGM.md, README.md and task status.
  No generated receipt is committed as live evidence without a successful run.

## Acceptance

Run npm test and node --check on new modules. Run default preflight on this clone
and record its actual outcome. Live can only run after preflight/source checks;
do not change registration to make a receipt pass. Record separate unsupported
scope for iframe/shadow/controlled inputs and same-document replacement; they
remain G0.4 tasks. The public G0 capability remains false regardless of probe result.

## Frozen wire/lifecycle details after readiness review

Each injected request uses a 3-second timeout. Activate once before open via the
existing ensureDriver helper (up to 25 seconds load plus 7 seconds handshake).
Open requests active tab then OpenTab once, returning sessionRef/tabId. The runner
uses a 40-second IPC timeout; an OpenTab exception locks the probe until host
restart and records outcome unknown, because the tab ID may be lost.

Every non-open action except preflight/close validates UUID session + TTL. Reject
overlapping calls from all clients with PROBE_BUSY; do not queue them. One session
and at most 40 refs; repeat find invalidates previous refs of that target. TTL is
300000 ms. Expiration retains the single cleanup handle and prevents another open
until close; close can clean an expired session. Closed session close again returns
tabLeftOpen=false/no dispatch. A failed/uncertain close locks further opens until
restart. A write exception quarantines the host probe: allow observations only,
never further writes or tab-close dispatch; cleanup reports tabLeftOpen=true.
Late native responses are ignored by the existing correlation map. A read after
timeout may race the late effect and must never authorize continuation of writes.
An ambiguous or malformed discovery response also quarantines the probe and
invalidates refs: FindSelectors can mutate cached IDs and must not reuse an ID
allocation after timeout. Keep one confirmed-closed nonce as a bounded tombstone;
an unknown session after host restart cannot claim its old tab was cleaned up.
The runner requires explicit closed=true/tabLeftOpen=false before cleanup passes.

Wire packets (all carry the existing host requestId and codeVersion):

- GetActiveTabId: `{windowId:-1}`; success retCode true/1 and numeric tabId,
  otherwise OpenTab uses -1. OpenTab `{tabId,url}` requires retCode true/1 and
  nonnegative integer newTabId; no retry.
- Scope reads: GetHtmlAttribute `{tabId,customId:'',attrName:'url'|'title'}`;
  retCode true/1 and exact string match. Failure invalidates all refs.
- IsHtmlElemValid `{tabId,customId,checkVirtualId:false,bringIntoViewVirtualId:false}`;
  retCode true/1 means valid, false/0 means stale. No implicit scroll.
- FindSelectors includes `{tabId,parentCustomId:'',partialRequests:[...],startWithId,
  timeoutMs:2000,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0}`.
  Start IDs at 1, advance from a safe integer endedWithId >= startWithId. Require
  success retCode, ready true/1, results array of exactly one partial result and
  bounded m_results array. Source-confirmed customId shape is
  `ownedTabId|0|localId`, with localId matching `[A-Za-z0-9._:-]{1,128}`.
  The host dispatches only `0|localId`. Mismatched tabs, nonzero frames or
  missing/extra segments fail closed. An unsupported response fails rather than
  guessing the schema. The original flat-ID assumption was rejected by the first
  live input search, after the zero-match search had passed.
- GetHtmlAttribute `{tabId,customId,attrName:'id'}` plus GenericRequest
  `{tabId,customId,messageId:5,getFullText:false}` must return successful retCode
  and string attrValue/value <=128 characters. These are separate id and value reads.
- WriteTextHtmlElem `{tabId,customId,inputOptions:0|4,tokens:[{text:fixedText}]}`;
  GenericRequest click `{tabId,customId,messageId:6,flags:0,doClickInPageWorld:false,
  x:0,y:0,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0}`.
  Both require retCode true/1; explicit false/0 is PROBE_BACKEND_REJECTED,
  missing/malformed response or exceptions are ACTION_OUTCOME_UNKNOWN. Find can
  mutate custom-ID attributes/caches; no raw arbitrary payload is accepted.
- CloseBrowser `{tabId}` requires success retCode. Recheck URL/title immediately
  before close; this is best effort, not an atomic guarantee against user navigation.

Fixture initial value is `initial`; input target is id=g0-input; two inputs have
name=g0-duplicate; missing target has id=g0-missing; button id=g0-button. A report
is exactly `{seq:integer>=0,value:string<=128,inputEvents:integer>=0,
changeEvents:integer>=0,clicks:integer>=0}`. Body <=1024 bytes; content-type JSON;
same exact fixture Origin required on POST, browser script increments seq each
report. Query snapshot in-process only. Default empty server snapshot is null.
Require initial value/zero counters; replace value `G0 Việt 😀` with inputEvents
increased; append value `G0 Việt 😀 + append` with another input event; one click
with clicks=1. Record changeEvents but do not require blur/change parity in this
main-frame smoke; full change/controlled input acceptance remains G0.3.

Enablement: on an already installed checkout run Setup.ps1 -Mode Install
-EnableG0Probe, then toggle the UiPath extension after browser work completes.
For a conflicting old checkout, F0.5 must handle owned uninstall/install plus
rollback first; this runner does not change registration or reload Chrome.
Disabled or old hosts fail preflight with bounded codes. No raw exceptions/URLs
outside the known fixture/text are saved in receipts. Source hash must match
the pinned audit before --live opens anything.
Preflight must have exact enabled=true, protocolVersion=1,
quarantined=false and main-frame-fixture-only scope. Missing/falsey substitutes
are incompatible. Active tab IDs must be nonnegative safe integers; otherwise
use the documented -1 fallback.
