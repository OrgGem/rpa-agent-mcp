# G0.4: live reference lifetime, frames and controlled inputs

Status: implementation and independent reviews complete; live attempts 3 and 4
passed all 11 scoped cases. Attempt 4 uses separate native close acknowledgement
and independent UI tab-absence proof; durable probe disable verified. Two failed
attempts remain in the receipt, with readiness/not-found translation corrections.
Scope: pinned extension 23.10.1 / driver 23.4.55.39317, private fixture only.
Keep all five public MCP APIs unchanged. Do not enable general DOM capability
merely because this fixture passes.

## Fixture and acceptance

Add a two-origin loopback fixture (two ephemeral 127.0.0.1 ports). Parent contains
a native input plus real React controlled and rejecting inputs. Two iframes have
unique input IDs, one same-origin and one cross-origin by port. Serve React from
a local esbuild bundle (development dependencies only, no CDN). Pin versions in
the lockfile. Controlled value uses state plus synchronous onChange; rejecting
input deliberately retains its original state. Verify DOM and model independently,
then force a parent rerender to catch DOM-only assignments.

Parent and frame pages generate fresh document UUIDs per load and node UUIDs per
input construction. Mark inputs with data-g04-document and data-g04-node values
`nonce:uuid`. Parent title is `G04 fixture <nonce> document <uuid>`. These markers
are controlled test guards, not a general website document identity solution.
Do not claim automatic general documentGeneration support.

The fixture has an in-process command queue polled by page-owned JS. Allowed
commands: remove native input; clone/replace it including old custom-ID attributes
but changing node marker; reload parent at the same URL; navigate parent to its
owned /next URL; reload same/cross frame; force React rerender. No arbitrary JS
or remote command endpoint. Reports include document generation, node status,
DOM/model values, input/change/React handler counters and command acknowledgements.
Main/frame reports have exact origin/role/path validation, sequence per generation,
bounded sizes and no remote-origin trust. Parent/frame nonce paths and CSP are
fixed. Queue navigation acknowledgement before reload; runner waits for a new
document generation, never infers it from command enqueue success.

Live cases:

1. Find/read native input, remove it from page, old read AND old type must fail
   stale without changing any other input. Find returns zero after removal.
2. Replace input with a clone carrying a new node token. Old refs stay stale;
   find/read the replacement; no automatic healing or rebinding.
3. Same-URL parent reload and owned /next navigation: previous refs fail stale
   even if local custom IDs are reused; new refs can be found/read.
4. Same-origin and cross-origin frame find/read/type with Unicode readback and
   independent frame report; nonzero frame IDs remain scoped to the owning tab.
5. Reload each frame, reject old frame refs before write, then refind/read;
   unchanged sibling/main frame refs must remain valid.
6. React controlled input replace/append: DOM value and model agree and remain
   after rerender. Record event counters, do not assume every React/Vue control.
7. Rejecting controlled input: one attempted write, observe retained/rejected value
   and handler report; classify postcondition mismatch, never retry automatically.
8. Real native disconnect: keep fixture server alive, ask user to refresh only
   UiPath Web Automation background page. Wait up to 5 minutes for different
   native startedAt/PID and enabled probe v2; sending an old session/ref must
   fail PROBE_STALE_SESSION before any browser dispatch. No fake restart counts.

## Probe protocol 2

Preflight v2 scope `owned-fixture-only`. The legacy smoke runner accepts v1 or v2;
advanced runner requires v2. Existing basic open/find/read/type/click/close behavior
is retained. Add open_advanced(fixtureUrl) for /g04/nonce/page. Strict allowlisted
targets are native, controlled, rejecting, same-frame-input, cross-frame-input;
no CSS/JS/raw command input and fixed text/options only. Descriptor binds expected
id and main/nonzero frame class; normalize full tab|frame|local to frame|local.
Validate safe numeric owned tab/frame IDs and bounded local IDs. A negative find
or malformed response must not be silently interpreted as another target.

At first advanced operation, pin parent document token from exact title pattern.
On owned same-URL reload or /next URL change, clear all refs and increment fixture
generation. Read/type of old ref returns stale; new find may recover a new ref.
Unowned navigation invalidates the session and forbids close. The only allowed
post-open URLs are exact /page and /next on the original nonce/port.

For advanced refs record frame ID, generation, node UUID, document UUID and target.
Read data markers using GetHtmlAttribute with normalized frame/local ID after
find. Before every read/write verify IsHtmlElemValid then the two marker attributes;
reject reuse/replacement as stale rather than resolving by locator. For parent
navigation scope guard clears all refs; frame-only reload invalidates only that
frame's refs as their markers differ. Backend failures/timeouts are not silently
accepted as valid. Keep the one-session/TTL/overlap/quarantine rules.

Pinned ElementNotFoundError is exactly {m_id:0}. Translate it to count=0 only
when the complete response has one partial, an empty match collection and valid
allocation bounds. Reject unknown errors or nonempty matches with an error.

Advanced read adds marker comparison but returns only bounded id/value as before.
Type permits only the descriptor's input ID, uses the already-tested one-token
WriteTextHtmlElem options 0/4. No alternate write backend is enabled speculatively:
if React fails, preserve the result, audit the failing route and fix/test a
scoped alternative before another attempt. Mark framework/method limits honestly.

After a real host restart, cleanup cannot use the lost session. Add close_orphan
(fixtureUrl,tabId) as a private cleanup-only action: require no active session,
enabled/non-quarantined probe, exact /g04/nonce/page URL grammar plus safe integer
tabId, activate driver, re-read allowed parent URL and exact nonce/title token,
then CloseBrowser once. Never adopt arbitrary refs, pages or browser tabs.
Validation is best effort and does not lock Chrome against user navigation.
One confirmed-closed nonce/tab tombstone makes cleanup idempotent.

Add finish() to disable the private probe in-process, clear temporary refs/session,
and report whether an unclosed session remained. No enable action exists. Native
status uses the adapter's actual enable state. Also clear the generated launcher
flag with normal Setup Install after tests. This avoids another user refresh just
to disable the probe. Never report cleanup success if a session/tab was lost.

## Files and tests

- src/g0-probe.mjs: v2 preflight, advanced descriptors/open, scoped full-ID parser,
  fixture generation and marker guards, orphan cleanup, irreversible finish.
- src/bridge.mjs: status reports actual private adapter enablement/protocol version.
- scripts/g04-fixture.mjs + scripts/fixtures/g04-app.jsx: local bundle, two servers,
  real React state, page-owned command queue and strict independent reports.
- scripts/run-g04.mjs: default no-action preflight, --live suite, safe receipts,
  real-disconnect checkpoint, bounded waiting, finally cleanup and finish.
- scripts/run-g0.mjs: retain v1 compatibility through shared readiness predicate.
- package.json/lock: pinned react/react-dom/esbuild dev dependencies only.
- test/g0-probe.test.mjs, test/bridge.test.mjs: protocol compatibility, old/new
  doc/node/frame token mismatch, safe frame ID, stale predispatch no write,
  sibling ref independence, orphan close scoping, finish and quarantine regression.
- test/g04-fixture.test.mjs: per-origin/role/generation/seq/body validation,
  no speculative command acks, bundle generation and both-server cleanup.
- docs/G0-4-LIVE-VERIFICATION.json and phase/design/contracts/matrix docs: record
  actual tested versions/methods and unverified boundaries; preserve failed runs.

Run targeted tests, npm test and matrix checks after reviewed changes. Enable
probe through existing Setup opt-in, then ask user to refresh/open/keep the UiPath
background page. Do not use Computer Use or kill Chrome. Preserve prior successful
basic smoke receipt. Record step outcomes and cleanup separately; a failed test
or missing user reconnect must never become a pass or silent skip.

CloseBrowser retCode is only an acknowledgement. Raw runner leaves tabLeftOpen
null, tabClosureVerified=false and cleanup.passed=false after ACK (exit 2 for
otherwise passed suite/resources). The parent must observe the dedicated fixture
window/tab before cleanup and independently prove its absence after, or use a
separately verified tab-absence backend. Only the aggregate receipt records that
proof; retain raw pending fields. Matrix evidence also requires exact case names
and current probe/runner/fixture/lock fingerprints matching the accepted receipt.

## Completion boundary

Report each case independently (passed/failed/not-run/unsupported), native host
identity change, fixture versions, source hash and probe source hash. Full G0
advertisement in runtime remains separately reviewed; public DOM APIs are not
implemented by this validation task. Scope excludes closed shadow roots, nested
arbitrary frames, framework variants and all websites beyond these fixtures.

## Readiness resolutions

The read-only reviewer completed all required reads. Its four Major findings
are accepted and resolved as follows before adapter implementation:

- Identity comes from existing IPC status: connected=true, positive safe integer
  nativePid and parseable ISO startedAt. Sample immediately before the restart
  checkpoint and after; require both PID and startedAt to differ and enabled v2
  preflight. Save raw identity locally only; public receipt records changed=true.
- Report schema is exact: seq/generation/ack, nullable nativeValue/controlledDom/
  controlledModel/rejectingDom/rejectingModel (strings <=128), nodePresent boolean,
  nonnegative safe integer inputEvents/changeEvents/reactChanges/rejectChanges,
  and frameworkVersion string <=32. Controlled initial value is controlled-initial;
  after replace/append DOM AND model must equal fixed G0_TEXT / G0_TEXT+G0_APPEND,
  after forced rerender as well. React change counter must increase. Rejecting
  case passes as a negative test only if handler ran and DOM/model stay
  reject-initial; an acknowledged write alone is never a positive pass.
- Frame packet is the existing golden FindSelectors shape (FIND_ALL=1,
  DESCENDANTS=1, max=10, timeout=2000, offsets=0). Source audit established that
  iframe traversal needs a matching iframe selector: frame targets use two tag
  infos, IFRAME/id=same-frame|cross-frame then INPUT/id=g04-same-input|g04-cross-input.
  Main targets keep a single INPUT tag. No flat global input selector is assumed
  to cross frame boundaries.
  Driver onFindSelectors sets allowCrossFrameRedirectCalls/allowSameFrameRedirectCalls.
  This is a source candidate; live must verify actual child IDs and marker
  binding, else the frame case fails/unsupported rather than silently switching
  locator or fabricating support. No caller-supplied frame/tab/selector is allowed.
- Runner retains original fixture URL and returned tabId locally through restart.
  After verifying new identity, assert old-session read is stale, call private
  close_orphan with the retained pair, then finish regardless of suite outcome.
  close_orphan rechecks exact owned URL/title before CloseBrowser. finish reports
  abandonedSession; true prevents cleanup success. Finally both HTTP servers stop.
  Reports also include documentReady (boolean) and run in per-document sequence
  order. Wait for readyState complete in all roles initially and after reload,
  not merely an early React layout/input-presence report.
  The parent runs plain Setup Install and verifies launcher flag plus disabled
  preflight/native status; no UI action is used except the user's refresh.

## Code-review resolutions and remaining boundary

Both P2 findings from the independent code review are accepted. Runner cleanup
now labels finish as privateProbeDisabledInProcess and leaves launcherDisableVerified
false until the parent performs and records plain Setup Install plus verification.
The runner cleanup pass covers owned resources and the current process only.

Advanced reads recheck identity after reading; advanced type rechecks immediately
before dispatch and after acknowledgement. Mock interleavings cover replacement
during the ID read, after value read and after write. Post-write identity loss is
ACTION_OUTCOME_UNKNOWN, quarantines the session and never retries. These are
best-effort guards over separate proprietary RPCs: identity checking and mutation
are not atomic. A replacement immediately before a write may already receive input;
postchecks cannot undo it. Live stable-fixture results do not prove race freedom.
General public DOM tools remain gated pending a separately reviewed atomic backend
strategy or an explicit bounded-handle contract.
