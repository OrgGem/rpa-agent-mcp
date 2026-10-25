# Scoped EGM readiness review

Date: 2026-10-26. Target: [capability design](phase-0-capabilities.md).
Method: two independent native subagents with `fork_turns: none`, no transcript
or memory retrieval. Both confirmed reading their bundled persona, the
implementation-readiness standard, target and selected source reading list.
This was a scoped readiness/codebase check, not all five EGM review stages.

| ID | Reviewer | Severity | Finding | Resolution |
|---|---|---|---|---|
| R1 | readiness, codebase | Major | Nested schema, value vocabularies and metadata underspecified | Define nested required types, enum values, metadata and limits in design; implementation exports matching schema |
| R2 | readiness | Major | Historical baseline date/source not fixed | Map legacy capabilities to dated receipt 2026-10-26; planned DOM to dated source audit; never mint live evidence during discovery |
| R3 | codebase | Major | Offline status availability contradicted scope prose | Status remains available offline; versions needs connection; page tools need confirmed pinned driver |
| R4 | codebase | Major | Existing null-to-empty argument behavior contradicts strict validation | New tool rejects explicit null/scalar/array; omitted accepted; legacy normalization retained and regression-tested |

Disposition: all four findings accepted and incorporated before implementation.
No blocker was reported. A second independent review round has not been run;
the table records author resolutions, not a reviewer re-approval.

## Implementation validation

A separate fresh-context code reviewer read the updated design, runtime modules,
test files and package manifest after implementation. It reported no P1/P2
findings in that scope. This is a code review, not re-certification of all EGM
design review stages or the live extension workflow.

Validation: `npm test` passed all 7 tests; `node --check src/capabilities.mjs`
and `node --check src/bridge.mjs` passed. Tests include schema validation via
Ajv, legacy IPC/MCP roundtrip, no activation/navigation during discovery,
argument null/array/scalar rejection for the new tool, legacy null compatibility,
wrong-driver and disconnected snapshots, unchanged G0 gate and sanitized metadata.
No live DOM or native-host registration changes were made.
