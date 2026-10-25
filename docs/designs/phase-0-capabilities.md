# Phase 0: truthful runtime capabilities

Status: implementation scope requested by the user; two scoped independent EGM
reviews completed. Findings and resolutions are in phase-0-review.md.

## Problem and goals

The runtime exposes four legacy UiPath tools, while the catalog lists 53 proposed
tools. An agent needs a machine-readable distinction before planning a browser
workflow. Implement a read-only capability tool now while G0 protocol research
continues. Do not advertise DOM actions until they have an adapter and live evidence.

## Scope

Add `browser_capabilities({})`, callable after MCP initialization even if the native
host is unavailable. Keep names, input schemas and output behavior of the four
legacy tools. No context, tab or element references are introduced in this slice.
Do not activate the driver, open tabs, read page content or expose raw native
commands from this tool. It only calls the existing local `status` operation.

`available` means callable in the currently observed connection under the stated
limits. It does not mean the current session or every site was live-verified.
Return a `connection` observation and explicitly label evidence as a historical
baseline. Driver availability is confirmed only when status reports `connected:
true`, `driverLoaded: true`, and `driverVersion: 23.4.55.39317`. Version queries
need a connection; the status tool remains available offline because returning
`connected:false` fulfills its contract. Open/tab metadata additionally need a
confirmed driver.
This deliberately reports page operations unavailable until legacy activation
has completed; it never activates a browser merely to answer capabilities.

## Output contract

Use `structuredContent` plus matching JSON text for compatibility, and an
`outputSchema` requiring `ok`, `data`, `error`. On successful capability discovery,
`ok=true`, `error=null`, even when disconnected: connection state is data.
`data` contains `schemaVersion:1`, `connection`, `capabilities`, `gates`.
Each capability has `name`, nullable `tool`, `implemented`, `available`,
`implementationStatus`, `backend`, nullable `driverVersion`, `supportedOptions`,
`limits`, `verificationLevel`, nullable `unsupportedReason`, and `evidence`.
Evidence identifies offline tests or the dated historical live baseline; querying
capabilities must not mint a fresh live validation record.

Capability entries, in order:

1. `capabilities` / browser_capabilities: always implemented and available;
   adapter-tested, local bridge metadata.
2. `connection.status` / uipath_bridge_status: implemented/available even offline
   because its contract returns connected:false; historical live baseline.
3. `driver.versions` / uipath_driver_versions: implemented, available when connected.
4. `tab.open` / uipath_open_url and `tab.metadata` / uipath_tab_info: implemented,
   available only with the confirmed pinned driver. Limits state HTTP(S)/new tab
   only or URL/title/readystate only, respectively.
5. `element.find`, `element.read`, `element.click`, `element.type`: tool=null,
   implemented=false, available=false, planned, source-audited, no supported options,
   reason `G0_NOT_VERIFIED`. This is a bounded summary, not the full 53-tool registry.

`gates.g0` has `passed:false`, `verificationLevel:"source-audited"`, and a reason.
Runtime does not infer G0 from any arbitrary receipt file. A future G0 adapter
must change this with tests and reviewed live evidence.

Connection is `{connected, driverLoaded, driverVersion, reason}`. Treat an absent,
malformed or disconnected status as disconnected; never trust truthy strings.
Do not return native PID, local endpoint, username, personal path or raw exception
in this new public result. IPC failure uses bounded `BRIDGE_DISCONNECTED` reason.
Connected status with a different/unknown driver disables page capabilities with
`DRIVER_NOT_CONFIRMED`; a missing connection uses `BRIDGE_DISCONNECTED`.

Tool failures, if capability code itself fails, return `isError:true` and
`{ok:false,data:null,error:{code:"INTERNAL_ERROR",message:"Capability discovery failed"}}`.
Legacy execution errors retain their existing text behavior. JSON-RPC validation
rejects extra/non-object arguments before IPC. A non-responsive native host is
bounded by the existing six-second status deadline; discovery performs one status
request and no write operations.

## Alternatives

Publishing the feature catalog as available would confuse proposed and shipped
features. Activating the driver in discovery would add browser side effects to a
metadata query. A full ref broker before G0 would guess document/frame identity.
These alternatives are outside this slice.

## Detailed Implementation Plan

- Create `src/capabilities.mjs`: pure snapshot builder and output schema; it
  accepts observed status or null. Define the bounded capability list in code,
  not by importing research artifacts or vendor sources at runtime.
- Modify `src/bridge.mjs`: register the fifth tool with read-only annotations,
  output schema and no input properties. Dispatch it before legacy handling;
  catch IPC failure as a disconnected observation. Preserve all four legacy APIs.
- Create `test/capabilities.test.mjs`: connected/pinned, disconnected, driver not
  loaded, wrong version, malformed status and no evidence promotion. Assert fields
  and complete output shape, not merely tool count.
- Modify `test/bridge.test.mjs`: expect the fifth tool; call discovery before and
  after legacy activation, reject extra args before IPC, assert no extra native
  activation/navigation calls, verify structured/text equality and disconnected
  discovery after host exit. All tests use the simulated extension.
- Modify `package.json` and `package-lock.json`: add pinned Ajv as a development
  dependency to validate full nested output schemas in tests. Runtime uses no
  external dependency. Ajv does not participate in production input validation.
- Modify `README.md`, `src/EGM.md`, `EGM.md`, `docs/EGM-WORKFLOW.md` to document
  the actual fifth tool and phase task link while leaving dated evidence untouched.
- Create/update `docs/DEVELOPMENT-PHASES.vi.md` for task status and this design's
  review report. Keep all source of the installed vendor extension outside Git.

## Acceptance and rollout

Run `npm test` and `node --check` on modified/new modules. A mock fixture proves
adapter logic and unchanged legacy operations; it is not a fresh live browser
verification. No registration or installed native-host replacement is required
for this change. Existing clients can continue using the four legacy tools;
new sessions discover one additional read-only tool. The existing native host's
status protocol remains compatible. Rollback removes the additional tool/module
and restores the documented count without migrating persistent data.

Next work: G0 fixture/runner and protocol investigation. An inability to establish
live discovery leaves G0 pending and does not block this read-only foundation.

## Resolved schema details

All objects in the output schema reject additional properties and require every
listed property. Every list below is an array of strings, except `capabilities`
and `evidence`, which are arrays of objects. No fields are optional.

- Envelope: `ok:boolean`, `data:Data|null`, `error:Error|null`.
- Data: `schemaVersion` constant 1, `connection:Connection`,
  `capabilities:Capability[]`, `gates:{g0:Gate}`.
- Connection: `connected:boolean`, `driverLoaded:boolean`, `driverVersion:string|null`,
  `reason:null|BRIDGE_DISCONNECTED|DRIVER_NOT_CONFIRMED`.
- Capability: `name:string`, `tool:string|null`, `implemented:boolean`,
  `available:boolean`, `implementationStatus:implemented|planned`,
  `backend:bridge|extension+bridge|extension-adapter`, `driverVersion:string|null`,
  `supportedOptions:string[]`, `limits:string[]`,
  `verificationLevel:adapter-tested|live-fixture-verified|source-audited`,
  `unsupportedReason:null|BRIDGE_DISCONNECTED|DRIVER_NOT_CONFIRMED|G0_NOT_VERIFIED`,
  `evidence:Evidence[]`.
- Gate: `passed` constant false, `verificationLevel` constant `source-audited`,
  `reason` constant `G0_NOT_VERIFIED`.
- Evidence: `kind:offline-test|historical-live-fixture|historical-source-audit`,
  `source:string` (repository-relative), `date:string|null`. Date is null for
  offline tests; historical dates are the recorded `verificationDate` or document
  date, not the query's clock. The error object is exactly the INTERNAL_ERROR
  object defined above.

Connection normalization accepts a non-array object with `connected===true`,
boolean `driverLoaded`, and driverVersion null or a version string matching four
numeric components (each 1–8 digits). Otherwise treat it as disconnected. Do not
echo arbitrary version strings, error text or unrelated fields. A connected but
not loaded/null/mismatched driver gets reason DRIVER_NOT_CONFIRMED.

Per-entry metadata:

| Entries | backend | verificationLevel | evidence |
|---|---|---|---|
| capabilities | bridge | adapter-tested | test/capabilities.test.mjs, offline-test, date=null |
| connection.status | bridge | live-fixture-verified | docs/EXTENSION-LIVE-VERIFICATION.json, historical-live-fixture, date=2026-10-26 |
| driver.versions, tab.open, tab.metadata | extension+bridge | live-fixture-verified | same historical live source/date |
| four planned element entries | extension-adapter | source-audited | docs/EXTENSION-CAPABILITY-VERIFICATION.vi.md, historical-source-audit, date=2026-10-26 |

`driverVersion` is null on capabilities/status and disconnected entries; other
entries receive the sanitized observed version. supportedOptions is empty except
tab.open=`[http,https,new-tab]`, tab.metadata=`[url,title,readystate]`.
Limits are stable descriptive strings: capabilities is a bounded subset, status
is connection metadata only, versions is embedded versions only, tab.open is a
new tab/no automatic retry, tab.metadata has no DOM fields, and planned entries
are blocked on G0. The exact wording is not a machine-readable condition.

Validation distinguishes omitted arguments from explicit null only for the new
tool: omitted means `{}`; null/scalar/array/extra properties return -32602 before
IPC. Preserve the legacy null-to-empty behavior for compatibility. Add mock MCP
tests for all these new-tool cases and a legacy null regression test. Test nested
schema compliance against every output case, text/structured equality, and absence
of native activation/navigation effects. Keep the existing 6-second status timeout.
