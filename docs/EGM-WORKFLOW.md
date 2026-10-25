# EGM development workflow

This repository uses [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
for specifications and independent review. The initial integration uses EGM
0.1.0. EGM is a development plugin, not a bridge runtime dependency.

## Setup

```powershell
codex plugin marketplace add google/elephant-goldfish-model
codex plugin add egm@egm
```

Start a fresh Codex session in this repository after installation so the skills
appear in the session inventory. Select the installed skill by its exposed
name; the commands below are the upstream command labels. Read the installed
`docs/codex.md` for harness-specific invocation and reviewer isolation.

## Feature cycle

1. Use `egm-brainstorm` when the problem or scope needs exploration. For already
   agreed work, use the existing requirements as input to `egm-draft`.
2. Save each scoped design under `docs/designs/`. Include the selected extension
   and driver versions, concrete protocol route, request and response shapes,
   element lifetime, frame/tab ownership, failure behavior, and acceptance tests.
3. Use `egm-review docs/designs/<feature>.md`. Reviewers receive only the design,
   bundled persona/standards and a selected source reading list. In this harness,
   use `fork_turns: "none"`; do not pass conversation history as evidence.
4. Use `egm-resolve` to triage findings and update the design. Record unresolved
   blockers and human decisions. Follow the skill's approval gates when invoked.
5. Implement the approved specification in the normal coding workflow. EGM
   design/review completion is not implementation or browser validation.
6. Run targeted offline tests, then explicitly scoped live fixture checks where
   required. Review code/spec drift with `egm-drift-report`. Update contracts and
   evidence before submitting the change through the normal Git workflow.

## Existing code and proposed scope

Use [the phased task list](DEVELOPMENT-PHASES.vi.md) to track implementation.
The first [capability slice](designs/phase-0-capabilities.md) has a scoped
[readiness review](designs/phase-0-review.md). It adds a fifth tool for metadata;
the four legacy extension operations retain their existing behavior.

Read [the runtime contract](../src/EGM.md) and
[script contract](../scripts/EGM.md). The existing
[feature specification](BROWSER-AUTOMATION-FEATURES.vi.md),
[MCP contracts](BROWSER-MCP-CONTRACTS.vi.md), and
[extension verification](EXTENSION-CAPABILITY-VERIFICATION.vi.md) are inputs to
feature designs; they are not all implemented or EGM-approved designs.

The first feature design should address the pending G0 discovery/reference/input
validation before promising general click/type support. Establish a live element
discovery route, stale-reference behavior, frame ownership, and safe fixture input
semantics. Treat source stubs and partial handlers as limitations.

## Evidence and regeneration

- `npm test`: transport and MCP tests with a simulated extension.
- Capability tests: schema validation, disconnected/wrong-driver cases and no
  promotion of historical evidence into a new live result.
- Source audits: names, handlers and routing for the inspected pinned bundle.
- Mock probes: isolated handler behavior, not a live browser result.
- Live receipts: only the exact operations and versions recorded in the receipt.
- EGM bootstrap: code contracts, not a completed multi-stage design review.

Use `egm-bootstrap` with `target_filename=EGM.md` to refresh code contracts while
preserving human-maintained READMEs. Keep generated drafts and review reports in
`docs/designs/`. Never record tokens, personal paths or page secrets in artifacts.
Historical receipts remain historical until a new run produces new evidence.
