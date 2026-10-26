# Development instructions

EGM artifact directory: docs/designs

Use Elephant-Goldfish Model (EGM) for feature design and review. Read
[the workflow](docs/EGM-WORKFLOW.md) and [the code blueprint](EGM.md) first.
Resolve skills from the installed plugin inventory; do not hardcode a user's
plugin cache path. Installation instructions are in the workflow.

For new browser capabilities or protocol changes, draft a scoped design with
EGM, review it with fresh-context Goldfish agents, resolve findings, then
implement the user-approved scope. Load the applicable skill before using it.
Keep review findings and unresolved decisions beside the design. Do not report
a review as passed until the reviewers actually complete. Small fixes may use
a focused existing contract and targeted tests rather than a new design.

The static MCP catalog has four legacy tools, `browser_capabilities`, and 52
strict browser adapters: the established 42-tool core plus ten advanced backend
adapters. Advanced source implementation does not establish backend readiness or
live browser support; companion installation, local configuration and live
acceptance remain separate. See docs/browser-tool-contracts.json,
docs/runtime-function-coverage.json and docs/ADVANCED-BACKEND-STATUS.vi.md.
The feature catalog describes proposed
capabilities, not an implemented API. Never equate a UiPath Activity, a source
function name, a mock probe, or a historical receipt with live browser support.
Every new tool must identify its pinned extension route, input/output contract,
errors, side effects, and separate offline and live acceptance evidence.

Run `npm test` for runtime changes. Keep native-host registration and generated
machine files out of Git. Do not bundle UiPath extension code. Do not replay
state-changing browser actions automatically after an ambiguous timeout.
Update component contracts when interfaces or side effects change.
