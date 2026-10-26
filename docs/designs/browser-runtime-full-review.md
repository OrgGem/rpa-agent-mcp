# Focused EGM design and code review ledger

Scope: supported public browser runtime, extension23.10.1 / driver23.4.55.39317.
Baseline G0 commit ac7d999. The existing full-plan request authorizes this scope;
the JSON tool contract narrows options to concrete adapters. This ledger does not
claim the broad 423 scenarios or every EGM qualitative review stage passed.

## Design decisions resolved before integration

The scoped design and strict contracts define client/context ownership, document
and node identity, explicit iframe routing, write-key reservation, unknown-action
quarantine/abandon, MAIN/ISOLATED separation, deadlines, watcher TTL/cleanup,
bounded async evaluate and temporary artifacts. No raw vendor dispatcher or
placeholder provider tools is public. Ten missing backends have explicit reasons.

## Code review findings and resolutions

Independent read-only reviewers inspected core, observers and page/artifacts.
Reviewers used source evidence; parent executed tests. Source review is separate
from an actual native host run.

| Finding | Resolution and focused evidence |
|---|---|
| Failed enumeration falsely proves close | Reject explicit native retCode failure, validate IDs/counts, independently require GetTabCount; source contract at offsets3004740–3004849, N_TRUE=1 at2852884. Regression rejects failed enumeration after close ACK. |
| Old complete document accepted after navigation | Require document/URL transition before complete result; delayed-native-navigation test proves old document is not accepted. Same-document URL change and stop are explicit exceptions. |
| Script throw/identity loss after mutation does not block writes | Evaluate failures/lost identity/oversize are unknown; quarantine across contexts, never replay. Falsy Promise rejection and post-evaluate document replacement tests. |
| Element targets ignore tab/frame scope | Preflight all supplied tab/frame/root/element/source/target/form-field refs before activation; wrong-tab test covers scroll/evaluate/wait/extract. |
| Abandon only expires one context | Retire every ref for the native tab before unblocking; unknown cached outcome immutable. Cross-context test. |
| Global read waits block unrelated work | Per-tab queues; stateful/window/capture coordination; network/new-tab wait are read polls. Concurrent tab read and new-tab-wait/write tests. |
| Generation always zero | Track observed document token/generation per native tab/frame. Navigation and child reload tests. |
| Output contract unchecked | Validate successful and failed envelopes, bounded fallback contract error. Malformed adapter result test. |
| Password selection leaks value | Return redacted selection text; state/value/form/event password redaction retained. Regression. |
| Falsy rejection treated success, unbounded serialization | Explicit failed flag and bounded incremental clone; no server execution of user function. Falsy/oversize tests. |
| Form/table limits materialize all results, UTF8 mismatch | Incremental iteration and encoded-byte row budget preserve partial output. Composite partial-step test. |
| Network TTL lags, failed Stop never retried | Precise timers, reset stop promise, retry failed cleanup, re-stop late Start ACK after expiry. Delayed-start and failed-stop tests. |
| Monitor arm incorrectly read-only/idempotent | Stateful annotation and requestKey reservation; actual native dispatch evidence. |
| Cancellation wins too late or reports expired | Mark control state before queueing; recheck after awaits; active network waiter cancellation test. |
| Release races active tasks or leaves listeners/artifacts | Mark owner closing, drain jobs, cleanup page state/monitors/artifacts, report each failed cleanup class. Delayed capture/release and network-release failure tests. |
| Client disconnect leaks contextless discovery refs | Drain client jobs, retire all client refs; retain bounded released-identity tombstones. Test includes existing discovery refs and delayed in-flight discovery. |
| Screenshot limit disagrees with transport | Native inbound8MiB; outbound/IPC1MiB; artifact before IPC; separate <=384KiB MCP image block. Transport and public MCP→IPC image tests. |
| Cookie path prefix accepts wrong boundary | Enforce cookie path boundary, not raw startsWith. Regression. |
| Watcher dispatch evidence says notSent after native action | Pass actual operation state; failed cleanup reports unknown and preserves MONITOR_CLEANUP_UNCONFIRMED. |
| Repeated unsubscribe hides failed cleanup | Retry owner cleanup before idempotent success; repeat-failure then success test. |

Core and observer reviewers confirmed their focused fixes at source level;
the final released-client tombstone is additionally covered by parent regression.
The page reviewer confirmed the targeted fixes at source level. Review completion does not
imply native protocol, actual Chrome realms/layout or live option acceptance.

## Open acceptance boundary

55 offline tests pass; their count is distinct from423 planned scenarios. jsdom
uses the same simulated realm/layout for fixed and user scripts and cannot prove
Chrome ISOLATED/MAIN separation. The public live runner validates47 discovered
tools,42 new tool names and explicit fixture witnesses; it has not run browser
actions because the connected host is still the old five-tool process.

Manual reload is required: native Computer Use could not activate the background
window, and the browser connector rejected chrome-extension:// under its URL
policy. No workaround was attempted after that rejection. Keep this acceptance
pending until a real public-tool fixture run and cleanup complete.

The page review notes that querySelectorAll itself creates a static collection
for form/custom table selectors before the bounded processing loop. Output and
processing are bounded, not all browser selector-engine work. Offline tests do
not establish real listener/highlight cleanup, all large-DOM limits or every
keyboard/selection edge case in Chrome. These remain acceptance limits.

### Retained input và CI sau commit71525e7

Bổ sung bốn test dùng React thực trong jsdom, queued sanitizer/restoration và convergence. Text/check/select/date giờ xác minh retained state ở RPC sau dispatch; không chỉ dùng synchronous match. Source review focused không còn P1/P2 trong các nhánh đã đọc; đây chưa phải live Chrome. Mô tả42 tool MCP đã ghi rõ mục đích, giới hạn và recovery thay cho mô tả generic.

CI commit71525e7: Node24 đã đạt cả tests/matrix/license/source archive; Node22 lỗi test startup chờ host30 lần*30ms. Đã đổi sang readiness deadline10s và xác nhận PID của đúng child. Full local55/55 đạt; CI của bản sửa còn chờ run.
