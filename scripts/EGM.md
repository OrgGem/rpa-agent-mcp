# Research and verification tooling contract

## Overview

These scripts inspect an installed extension, maintain capability documents and
record bounded evidence. They are development tools, not runtime MCP tools.
Read [the usage guide](README.md) before execution.

## Interface

- [paths.mjs](paths.mjs) exports `EXTENSION_ROOT`, from `UIPATH_EXTENSION_DIR`
  or the pinned Chrome Default profile path under `LOCALAPPDATA`.
- [extract-uipath-catalog.mjs](extract-uipath-catalog.mjs) reads installed
  extension files and writes `work/uipath-extracted.json`.
- [feature-route-revisions.py](feature-route-revisions.py) exports `revise(features)`;
  it mutates feature records using `docs/pinned-driver-audit.json`.
- [review-browser-plan.mjs](review-browser-plan.mjs) performs AST inspection and
  isolated handler evaluation, writing `work/browser-plan-review-evidence.json`.
- [validate-browser-feature-docs.py](validate-browser-feature-docs.py) and
  [validate-uipath-guide.mjs](validate-uipath-guide.mjs) check consistency and
  write documentation validation receipts.
- [verify-plan-live.mjs](verify-plan-live.mjs) checks the four existing MCP tools
  with a localhost fixture and writes `docs/EXTENSION-LIVE-VERIFICATION.json`.
- [build-function-matrix.mjs](build-function-matrix.mjs) exports `buildMatrix` and
  `renderMatrix`, and writes the complete planning matrix from explicit decisions
  and baseline catalogs. [validate-function-matrix.mjs](validate-function-matrix.mjs)
  exports `validateMatrix`/`checkArtifacts` to reject missing rows, unresolved
  unsupported routes, invalid task/tool references or generated artifact drift.
- [g0-fixture.mjs](g0-fixture.mjs) exports `startG0Fixture`, a bounded loopback page
  with independent value/event reports. [run-g0.mjs](run-g0.mjs) defaults to no-action
  preflight; `--live` requires an enabled private host and matching source hash.
- [g04-fixture.mjs](g04-fixture.mjs) serves an esbuild bundle with pinned React
  dev dependencies on two ephemeral loopback ports. Reports bind origin/nonce/
  role/document/sequence; only fixed page-owned commands can mutate the fixture.
- [run-g04.mjs](run-g04.mjs) requires private protocol v2; `--live` checks stale
  refs, iframe reload isolation and controlled-input DOM/model/rerender behavior.
  It waits for a real native PID/start-time change after a manual background-page
  refresh. Receipts separate suite pass, resource cleanup, in-process probe disable
  and the still-required launcher-disable verification.
- [run-browser-live.mjs](run-browser-live.mjs) creates an independent stdio MCP
  client. Default preflight sends no page actions; --live serves owned two-origin
  React fixtures, exercises all 42 new tool names, validates result schemas and
  records exact step/cleanup outcomes in ignored work/BROWSER-LIVE-VERIFICATION.json.
  It does not retry a failed action, register a host, reload Chrome or promote its
  raw receipt to documentation automatically.
  Optional --base-url HTTP_URL requires a unique, visible discovery result and
  explicitly attaches to that base before opening the fixture in its window.
  The base tab is retained; only runner-owned tabs are closed. The runner saves
  the returned MCP image in ignored work/ and records its hash/size/dimensions.
- [build-runtime-coverage.mjs](build-runtime-coverage.mjs) records each roadmap
  tool's exact adapter/routes and all 188 protocol row dispositions. The planning
  matrix remains the broad scenario baseline; test source does not mean test pass.
  Scoped public live promotion requires matching current source and host-loaded
  hashes, the exact full-suite groups/tool names and explicit cleanup. A partial
  receipt marks only successful tool calls, never all options/native routes.

## Invariants

Run from the repository root. Install the extension separately. Importing the
paths module requires either configured extension location or `LOCALAPPDATA`.
The feature validator checks the historical baseline of 47 feature groups,
168 activity names, 53 proposed tools, 88 catalog functions and 21 P0 tools.
It compares source hashes across receipts; this is consistency validation,
not a new browser test. Live fixture verification explicitly leaves DOM
automation unverified. Do not promote proposed tools into implemented claims.

## Side Effects

Importing paths creates `work/`. Extraction and review write scratch evidence;
validators overwrite receipts in `docs/`. Live verification starts an HTTP server
and child bridge, opens a real fixture tab, then stops the server and child.
The tab may remain. Research/generation commands described in the usage guide
can fetch remote documents or overwrite authored documentation; inspect their
source and review resulting diffs before using regenerated output.
Matrix generation writes two documentation artifacts; validation does not dispatch
browser commands. G0 runner writes work/g0-preflight.json or work/g0-live.json and
always attempts server cleanup. It never changes registry or reloads Chrome.
G0.4 writes work/g04-preflight.json or work/g04-live.json; it can close an orphaned
owned fixture tab after host restart, then finish disables the probe in-process.
The parent must run plain Setup Install and verify launcher/preflight disabled;
the runner never claims durable disablement from finish alone.
Native close acknowledgement does not prove tab absence. G0.4 raw receipts keep
tabLeftOpen=null, tabClosureVerified=false and cleanup.passed=false after ACK;
exit 2 means a passed suite still awaits independent tab-absence confirmation.
The parent records that check in the aggregate receipt before matrix promotion.

## Verification

`npm test` checks the bridge, not all research scripts. Validators require
matching local source and prior research artifacts; see the usage guide.

The initial independent scout fully inspected the seven scripts linked above.
Its bounded output did not establish complete contracts for
`audit-pinned-driver.mjs`, `build-browser-feature-docs.py`,
`build-uipath-guide.mjs`, `probe-pinned-content.mjs`,
`research-browser-activities.py`, or the partly visible `fetch-activity-details.py`.
Those source contracts remain pending; this file is not a full tooling audit.
