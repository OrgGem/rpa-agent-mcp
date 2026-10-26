# Capture visibility/readiness review

2026-10-26. Scoped existing-tool repair under the approved browser runtime plan.
Reviewer: fresh-context Goldfish, GPT-6.1 Sol/high, read-only. Parent owns code,
tests, native host reload and live evidence; reviews alone do not prove those.

Design review resolved three P2 gaps before implementation: bounded render ticket
protocol/cleanup, read-dispatch plus deadline/context precedence, and visibility
refresh plus strict tab output schemas. Final design verdict: no remaining P1/P2
gaps in the reviewed scope.

Code review found one P2: an in-flight render poll could return CAPTURE_NOT_READY
after context release/deadline without a fresh budget check. Screenshot now
checks budget in the readiness catch before rethrowing; regression covers both
STALE_CONTEXT and TIMEOUT, no TakeScreenshot and no unknown-write quarantine.
Reviewer re-read the patch and test and confirmed the finding resolved; no
remaining P1/P2 findings in owner/TTL cleanup, read dispatch, visibility metadata,
schemas or explicit base selection. Reviewer did not run tests/live actions.

Parent live evidence: the full public MCP fixture passes seven groups and all42
new tool names on an explicitly selected rendered Chrome window. A separate
fresh-window check observes hidden and receives TARGET_NOT_VISIBLE, notSent,
with tab/context cleanup. Exact current source hashes and final counts live in
the verification receipts. This does not establish every option/site or race
freedom across the non-atomic native calls.
