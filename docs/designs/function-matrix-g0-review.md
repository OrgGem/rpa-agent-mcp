# Function matrix and G0 fixture review

Date: 2026-10-26. Scope: complete planning coverage plus F0.3 development probe.
EGM reviewers ran as independent native subagents with no forked transcript.
This is a scoped readiness/code review, not the full five-stage EGM workflow.

## Matrix findings and disposition

The reviewer checked 188 unique protocol rows, all 47 feature groups/53 proposed
tools, task references, source hashes, unsupported decisions and planned tests.

| Finding | Resolution |
|---|---|
| Generic 6 mapping is shadowed; content-2 click relationship needs evidence | Recorded conditional special-handler dispatch with pinned hash, handler/call offsets; map 6 stays shadowed |
| Aggregate GenericRequest row omits route consumers | Derive consumer/task union from active route rows |
| Partial loader/callback status has catalog-only evidence | Add implementation-source evidence and narrow scope |
| FindBrowserTabs internal CLI and private probe status ambiguous | Partial implementation is explicitly scoped to CLI/dev fixture; never public DOM availability |
| Special 75 consumer was inferred via fallback | Make it explicit internal-only identity diagnostic; no MCP consumer; fail generation for unknown generic owners |
| Validator ignores implementation-source drift | Hash bridge/probe source as well as catalog/audit/spec; matrix check rejects artifact/source mismatch |

The reviewer confirmed the earlier route/evidence findings were addressed, then
raised the source-hash gap. That final gap was fixed afterward; no second complete
review round was claimed. Coverage assertions and tests run against final artifacts.
The 376 row scenarios plus 47 feature scenarios remain planned acceptance tests.

## G0 readiness findings and disposition

| Finding | Resolution |
|---|---|
| Wire payload/success checks incomplete (Blocker) | Freeze each allowed request and response in design; fail closed on unknown shape |
| Concurrency/timeout behavior missing | Reject overlapping IPC, quarantine uncertain writes/discovery, no retry |
| Tab ownership/cleanup lifecycle ambiguous | Single session/40 refs/TTL, best-effort scope checks, orphan reporting, restart cleanup unknown |
| Fixture pass criteria vague | Freeze initial value, 0/1/2 targets, fixed Unicode writes, independent event counters |
| Probe enablement lacks concrete path | Add explicit Setup opt-in launcher flag; default clears it; migration separate |
| Find mutates DOM/cache | Record side effect and discovery quarantine requirement |

## Code review and corrections

Read-only code review found no P1 after the action-type coercion guard was fixed.
It identified cleanup false pass after host restart, ambiguous discovery replay,
falsey preflight quarantine state and unbounded active-tab conversion. All were
accepted and fixed with regression tests. The implementation also validates
action as a string before looking up its allowlist, so array coercion cannot
convert an apparent read into a click.

## Validation and boundaries

- `npm test`: 20 passed, including legacy integration, capabilities, full matrix
  coverage/negative cases, HTTP fixture validation, private probe scope/ref/TTL,
  Unicode token schema, timeout quarantine, restart cleanup and opt-in native IPC
  preflight without extension dispatch.
- Matrix validator passed. New modules passed Node syntax checks; Setup.ps1
  passed PowerShell parsing. Installer registry behavior was not integration-tested.
- Actual clone preflight: exit 1 / HOST_PROBE_UNAVAILABLE. It opened no fixture/tab.
  Chrome is still on the prior prototype host. No new live DOM behavior is claimed.
- Registry and the running native host were unchanged. F0.5 host transition and
  live G0.2–G0.4 remain pending. Public MCP still exposes five tools; G0 stays false.
