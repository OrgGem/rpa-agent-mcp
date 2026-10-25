# G0.4 review and evidence

Date: 2026-10-26 (Asia/Bangkok). Scope: private fixture adapter and runner for
extension 23.10.1 / driver 23.4.55.39317. EGM reviews used independent fresh-context
agents; their conclusions are source/design evidence, not live acceptance.

## Design readiness

The design reviewer raised four Major findings: exact native restart identity,
strict report schema and positive/negative React acceptance, iframe selector
packet, and complete cleanup/disable lifecycle. All were accepted and resolved
in [the design](g0-4-lifetime-frames-controlled.md#readiness-resolutions).

## Protocol source audit

The independent auditor confirmed the IFRAME -> INPUT selector path, full
tab|frame|local discovery IDs versus frame|local DOM request IDs, arbitrary
data-* attribute fallback, and normal WriteTextHtmlElem options 0/4. The normal
route resets React's value tracker before dispatch; this is a candidate to test,
not proof of framework support. The debugger2 alternative lacks target/focus
guarantees and stays disabled. Proprietary excerpts remain outside Git.

## Code review

Two P2 findings were accepted and fixed:

- finish disabled only the current process, while launcher opt-in persisted.
  Runner now says privateProbeDisabledInProcess, leaves launcherDisableVerified
  false and records the plain Setup Install + verification post-run requirement.
- Identity checks and reads/writes used separate native RPCs. Added advanced
  post-read checks, a final pre-write guard, and post-write checks. Identity loss
  after acknowledgement returns ACTION_OUTCOME_UNKNOWN, quarantines and never
  retries. Three interleaving unit cases cover these boundaries.

The same reviewer completed a focused re-review and found no remaining material
blocker in those changes. Separate RPCs still cannot provide atomic identity and
dispatch; this limitation is explicit and keeps general public DOM tools gated.

## Validation before live

29/29 offline tests passed, including seven advanced probe cases, two-origin
fixture validation, prior basic probe/transport/MCP and rollback regressions.
Matrix check passed: 188 protocol rows, 53 proposed tools, 423 planned scenarios.
These counts do not represent 423 executed browser tests. Live acceptance and
durable probe disablement must be recorded separately after execution.

## First advanced live attempt

Host reloaded to protocol v2, source hash matched and all three fixture roles
reported. The first remove/ref test stopped at FindSelectors with
RESULT_SHAPE_OR_ALLOCATION before any
WriteText dispatch. The response gate quarantined; server shutdown and in-process
finish passed, but tab closure was not confirmed. Keep this failed receipt.

Initial reports can precede document load, while FindSelectors requires complete.
Added a strict documentReady boolean, load event reporting and ordered per-document
report delivery. Runner now waits complete for each role initially and after
navigation/frame reload. This is a readiness fix, not a confirmed diagnosis of
the first response (it lacked detailed shape). New bounded diagnostics record
readiness, collection counts and allocator integers on a future shape failure.

Focused re-review found no false-pass regression in readiness, serialized reports
or bounded diagnostics. The reviewer noted discovery quarantine deliberately
prevents automatic close; failed attempts can leave their tab with a stopped
server. Keep the honest cleanup failure and require manual closure of that G04
fixture tab before a fresh attempt. Do not weaken write-uncertainty quarantine
just to obtain a cleanup pass.

The protocol auditor confirmed complete readiness is taken directly from
document.readyState, and identified a separate success-coded empty fallback
(missing content response or failed frame-rectangle read). The first receipt
cannot distinguish these. Normal results are per partial request; single INPUT
selectors do not traverse unmatched iframes. The audit also found m_searchError
must be checked even with a populated collection. Added that rejection guard,
a bounded selectorErrorPresent diagnostic and a regression: 30/30 offline tests
passed. No CSP-specific root cause was established by source evidence.

## Second attempt: absent-result error semantics

With complete readiness, initial find/read and stale-after-remove rejection ran;
the subsequent zero-match find stopped on m_searchError (ready=true, one partial,
zero matches, allocator valid). The earlier blanket error guard was too strict.
Pinned ElementNotFoundError constructor at offset 3114029 is exactly {m_id:0};
TagInfo.GetError near 3450332 returns it when empty. The adapter now translates
only this exact single-key object plus a valid empty collection to count=0.
Unknown errors, extra fields, wrong IDs or an error with populated matches still
quarantine. Expanded regressions passed with the full 31/31 offline suite.
Second failed receipt is retained; the parent closed its fixture through Chrome
UI under the user's explicit authorization, without replaying browser writes.

The code reviewer independently verified the pinned constructor/empty-result
propagation and completed a focused re-review: no material blocker in the strict
translation or bounded diagnostics. No reviewer performed browser input.

## Final live acceptance

Attempt 3 passed all 11 cases, including same/cross-origin frame writes/reload
isolation, replacement/navigation stale refs, React DOM/model/rerender, rejecting
control detection and a real native PID/start-time change. The parent used
Computer Use for background reload, keeping the fixture alive. The restarted
adapter rejected old-session read and type; orphan cleanup closed the fixture.
Two servers stopped and finish disabled the current process. Plain Setup Install
cleared the launcher; independent IPC verified disabled status and loaded driver.
An independent MCP client listed exactly five tools with public G0=false.
See [the full receipt](../G0-4-LIVE-VERIFICATION.json), including both failed runs.
This completes scoped G0.4 acceptance, not general DOM APIs or race-free dispatch.

## Release review corrections

The independent release reviewer found two P2s: native close ACK was being used
as tab-absence proof, and historical G0 receipts exposed local tab IDs. Accepted:
the new runner records ACK separately, leaves tabLeftOpen=null and cleanup false
pending external verification, and historical tab IDs were redacted with a caveat
about ACK-only cleanup. Re-review confirmed those corrections, then identified
a source-evidence drift gap in the matrix. Added current probe/runner/fixture/lock
hash checks, pinned source/driver and exact case-name checks before promotion.
The regression suite now passes 32/32 including stale-source/closure failures.

Attempt 4 reran all 11 cases with the exact new runner hash. At the reconnect
checkpoint Computer Use observed the fixture's dedicated single-tab window;
after native cleanup it confirmed that specific returned window no longer
existed, no fixture window title remained, and the UiPath background stayed open.
The raw runner correctly kept cleanup pending; independent UI plus plain Setup
and IPC proofs were recorded only in the aggregate receipt. Native probe source
was unchanged from attempt 3. Both failed attempts and both successful suites
remain preserved, with no public DOM gate promotion.

Final focused re-review completed with no remaining material P1/P2 finding in
the reviewed paths. Before commit, repository text/lock line endings were
normalized to Git's LF form without dependency-data or runtime-code changes;
published source fingerprints and generated matrix were refreshed accordingly.
