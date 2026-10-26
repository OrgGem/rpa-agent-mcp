# Missing browser backends: review ledger

Date: 2026-10-26. Scope: ten deferred MCP tools, preserving the installed UiPath
extension. This ledger distinguishes feasibility, specification, implementation
and live acceptance. None of the proposed tools is accepted by this review yet.

## Initial feasibility review

Fresh-context, read-only Goldfish: `missing_backends_design_review`, Sol/high.
Target: [feasibility note](missing-browser-backends-feasibility.md). The full
design was not available at this review. The reviewer read the bundled Design
Critic persona and Feature Spec Standard, repository instructions, runtime,
tool validation and the baseline MCP contract. No tests or browser actions ran.

Result: feasibility is not an implementation specification. Findings to resolve
in the detailed design:

| ID | Severity | Required correction | Status |
|---|---|---|---|
| M01 | Blocker | Concrete cross-extension pairing with profile/connection/document epochs; raw tab IDs and matching URLs do not prove identity | Open |
| M02 | Blocker | Dialog state machine and control admission outside blocked page/tab/window queues, including quarantine and release ordering | Open |
| M03 | Major | Debugger ownership, contention, shared consumers, detach and key-release cleanup without replay | Open |
| M04 | Major | Strict input/output schemas, side-effect annotations, limits, errors and request-key semantics for all ten tools | Open |
| M05 | Major | Owned download IDs survive navigation; define status/wait/cancel and filename policy; defer arbitrary click correlation | Open |
| M06 | Major | File root policy, canonicalization, stable staging, bounds and element-to-CDP binding; selection is not upload completion | Open |
| M07 | Major | Launch ownership handles startup handoff, PID reuse, failure/crash and retained profiles; no inherited extension readiness | Open |
| M08 | Major | Loopback provider identity/no redirects, bounded redacted candidates, validated candidate IDs, cancellation and abstention | Open |
| M09 | Major | OCR/template observations bind owned images, capture geometry and resource limits; rectangles are not actionable element refs | Open |
| M10 | Major | Component flow and explicit alternatives/tradeoffs, including companion versus separate owned CDP browser | Open |

The reviewer did not independently verify host inventory or pinned vendor audit
claims. The feasibility worker separately ran a synthetic local WinRT OCR probe;
that result does not establish browser screenshot or MCP OCR integration.

## Scoped readiness: private Windows backend

Fresh-context Implementation Readiness Goldfish `missing_backends_readiness`
(Sol/high) read the implementation-readiness persona/standard and the current
design/code context. It accepted the independent
[Windows helper contract](missing-native-helper-contract.md) for source work:
helper, OCR and clipboard modules plus mocked process/unit tests, without public
registration or live clipboard operations. It required an unconfirmed child
termination to quarantine the global clipboard FIFO until actual child exit.
That clarification is incorporated in the helper contract before implementation.

This is a scoped readiness decision only. Main runtime integration, artifact
analysis/pinning, asynchronous axe execution, companion protocol and public
contracts remain under review; no full-design approval or live pass is claimed.

## Scoped readiness: artifact analysis and private pairing

The same readiness reviewer completed its review of the main-design snapshot
last modified at 14:50:02 local time. It cleared two further independent source
slices, with no MCP exposure or browser activation:

- Artifact store: internal owner/expiry/hash-verified `analysisRead`, serialized
  against release/sweep, with optional screenshot provenance and focused race,
  corrupt-file and resource-bound tests. Capturing provenance is a later wiring step.
- Pairing registry: a single-use 256-bit challenge, 30-second TTL, bound owner,
  tab/document/host epoch, completion only through validated companion transport
  and browser-authenticated sender metadata; explicit lifecycle invalidation.
  This slice cannot dispatch browser commands or prove live pairing by itself.

Main design M05 (explicit-ID downloads), M06 (staged file selection boundary)
and M10 (alternatives) were materially addressed at that snapshot. M01/M03/M09
support isolated source work but not activation. M02/M04/M07/M08 and full
runtime/public integration remain open pending the detailed amendments.

Implementation owners have begun the private Windows and artifact/pairing
slices. Started work is not completed functionality or a passing test receipt.

## Focused readiness recheck

The same fresh-context Sol/high readiness reviewer re-read the frozen amended
main specification and supplemental contracts. Source work may proceed for all
components; there is no remaining P1 blocker in that focused snapshot. The
reviewer confirmed explicit release-before-jobs, local activation bypass, static
MCP discovery with dynamic readiness, dependency pins, bounded Ollama parsing,
owned-process launch scope, and asynchronous axe lifecycle.

Two residual P2 corrections were incorporated directly into the final design:
owned download get/cancel/events survive originating-document invalidation, and
zero-variance templates/non-finite scores are rejected before publication. Axe
cancel keeps the one-running-scan lock until computation settles. Pairing uses
authenticated sender.id, while sender.origin is page metadata; the private
registry implementation/tests are being corrected accordingly. The reviewer
explicitly allowed these focused corrections without another broad review loop.

This accepts the specification for source work, not completed adapters, live
extension pairing, model configuration or browser acceptance. The initial
M01–M10 rows above record the historical feasibility findings; their design
corrections are now captured by the main specification and supplemental contracts.

## Source review: local backends and companion

Fresh-context Sol/high reviewer `missing_backend_code_review` inspected the
implemented local modules and companion code. Central runtime integration was
still being edited and is excluded from this review snapshot. The reviewer
reported the following actionable findings; fixes and final regression evidence
are pending owner completion and recheck.

| ID | Severity | Finding | Owner |
| --- | --- | --- | --- |
| C01 | P1 | Launch helper uses `Path.IsPathFullyQualified`, absent in pinned Windows PowerShell 5.1 | Local backend |
| C02 | P1 | Launch lock lookup assigns reserved constant `$PID` through `$pid` | Local backend |
| C03 | P1 | Companion client substitutes the pending document token for the received attestation token | Companion |
| C04 | P1 | `Accessibility.queryAXTree` omits its required DOM root identity; mock accepted invalid parameters | Companion |
| C05 | P2 | Cancelled axe task never releases its running lock after underlying settlement | Companion |
| C06 | P2 | Malformed clipboard success acknowledgement can be classified as `notSent` after dispatch | Local backend |
| C07 | P2 | Uncertain keydown/keyup can escape held-key cleanup tracking | Companion |

The review performed safe runtime compatibility probes, but no browser actions,
installation, clipboard access or source edits. Earlier focused passing tests
do not supersede these findings. The local backend owner is adding actual
pinned-PowerShell execution checks and the companion owner is tightening its
Chrome test double as part of remediation.

## Source recheck and integration review

The same reviewer confirmed C01–C07 resolved in source after focused regressions.
The local owner reports 43/43 tests including actual pinned PowerShell execution;
the companion owner reports 43/43 focused tests and a generated-launcher test.
These are separate suites and do not prove the complete MCP call chain.

Integration review identified these additional issues. They remain open until
the owning implementation and regression evidence are rechecked:

| ID | Severity | Finding | Owner |
| --- | --- | --- | --- |
| C08 | P1 | Lease acquisition and action reuse one RPC request ID, conflicting with companion deduplication | Runtime |
| C09 | P1 | Audit poll/cancel supplies fields rejected by the real private ticket manager | Runtime |
| C10 | P1 | Audit executor passes tab in the wrong argument position to binding lookup | Runtime |
| C11 | P1 | Cached debugger leases discard expiry and can remain unusable after TTL; watch TTL must fit its lease | Runtime |
| C12 | P1 | Uncertain companion errors lose dispatch state through client/adapter/runtime boundaries | Runtime and companion |
| C13 | P2 | UTF-8 CMD launcher lacks code-page setup for Unicode installation paths | Companion |

Package review also found unsupported native-manifest `args`, an extension import
outside its unpacked root, and omitted companion files in source release. The
reviewer subsequently confirmed those three corrections in the generated/source
package; Unicode path handling is tracked separately as C13. Source archives
must be rebuilt after the final runtime changes and tests.

## Final focused source recheck

The reviewer rechecked C08–C13 and the additional keyboard-trigger issue (a
prearmed dialog/file watcher must be marked before `browser_press_keys` sends
the exact triggering request). All are resolved in the inspected source, with
no remaining P1/P2 finding in that bounded scope. The reviewer independently ran
the advanced-runtime plus real-backend tests (4/4) and companion client plus
backend tests (4/4), with no skips.

Lease reacquisition was checked against the actual companion implementation:
it permits another owned lease on the same already-attached paired target. Old
leases remain owned until expiry or cleanup; the runtime does not assume an
unsupported in-place extension. Parsed expiry and requested watch TTL are now
retained. The generated Unicode-path launcher includes its UTF-8 code-page setup.

This closes the listed source findings, not full-suite acceptance or live Chrome
qualification. Full-suite/build results and configuration/live limitations belong
in the phase plan and advanced-backend status receipt once final validation runs.

## Final implementation and package validation

Final source review closed C01–C13 and the key-trigger finding within the bounded
source/test scope. Default `npm test` finished with 139 pass, 0 fail and 1 opt-in
OCR skip (140 total); `RUN_WINDOWS_OCR_TEST=1` separately passed 1/1 using the
generated image for both full-image and crop OCR. The local backend focus had 43
tests, Companion focus had 44 tests, and the strict runtime integration tests
passed 2/2. These are distinct from Chrome live acceptance.

Companion build/package validation and the generated Unicode launcher check passed.
The source archive was rebuilt and inspected after the final docs update; it includes
Companion and local helpers while excluding machine manifests and vendor bundles.
The extension has not been installed/loaded and the native host has not been
registered. No advanced live browser run, clipboard access or model call occurred;
runtime coverage remains 0/10 advanced live and the 423 broad scenarios remain
planned. The older core live receipt remains tied to its recorded hashes.
