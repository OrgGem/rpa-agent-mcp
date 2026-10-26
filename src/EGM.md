# Bridge component contract

## Overview

The bridge connects MCP stdio clients to a Chrome-launched native host over
local IPC. The native host talks to the installed UiPath extension.

## Interface

- [bridge.mjs](bridge.mjs): `ipcCall`, `startNative`, `startMcp` and exported
  `ROOT`, `EXTENSION_ID`, `ORIGIN`, `DRIVER_VERSION`, `ENDPOINT`.
- MCP tools: `uipath_bridge_status`, `uipath_driver_versions`,
  `uipath_open_url({url})`, `uipath_tab_info({tabId})`, `browser_capabilities({})`.
- The public runtime adds 42 strict browser tools from
  [the JSON contract](../docs/browser-tool-contracts.json). Runtime/operations/page/
  observers/composites/artifacts modules own contexts, document/node refs, typed
  actions, watchers and temporary images. Ten unavailable backends are omitted.
- [capabilities.mjs](capabilities.mjs): `buildCapabilities(status, pinnedDriverVersion)`
  and `CAPABILITY_OUTPUT_SCHEMA`. The pure builder emits bounded metadata and
  dated historical evidence. New-host schema v2 reports actual adapter availability;
  old/disconnected status retains the compatibility v1 snapshot. Discovery reads status only;
  disconnected/malformed status fails closed for extension-dependent capabilities.
  The new tool rejects explicit null arguments; legacy null normalization stays.
- Local IPC additionally accepts `activate_driver`, `active_tab`, `find_tabs`;
  these are not published MCP tools.
- Private IPC `browser_tool`, `browser_artifact_image`, `browser_client_release`
  carries MCP-process clientRef. This is same-user IPC, not an authentication boundary.
- [transport.mjs](transport.mjs): `MAX_BYTES`, `nativeFrame(message)`,
  `NativeDecoder.push(chunk)`, `LineDecoder.push(chunk)`.
- [g0-probe.mjs](g0-probe.mjs): development-only `createG0Probe` adapter, fixed
  `makeFindRequest`, `parseFixtureUrl` and `parseAdvancedFixtureUrl`. The native IPC `g0_probe` endpoint
  reports preflight while disabled; browser actions require an explicitly enabled
  native process. It is absent from MCP tool discovery.

## Invariants

- Native messages use four-byte little-endian lengths and UTF-8 JSON; local IPC
  and MCP use newline-delimited JSON. Native inbound is 8 MiB for screenshot
  payloads; native outbound and IPC/MCP lines remain 1 MiB. Artifacts precede IPC.
- Native startup requires the configured extension origin. Endpoint identity
  derives from repository path, OS username and optional `UIPATH_BRIDGE_INSTANCE`.
  This naming and origin check do not establish a comprehensive security boundary.
- Embedded driver version is `23.4.55.39317`; the inspected extension version is
  `23.10.1`. These identify different components.
- Driver activation requires both a successful load response and handshake.
- Open URL accepts HTTP(S) without embedded credentials. Each request sends
  `OpenTab` once; subsequent retries only read metadata. A timeout may leave an
  opened tab and must not trigger an automatic repeat of navigation.
- Tab IDs are non-negative integers. MCP tool discovery/calls require initialization.
- Status reports driverAutomationReady only after driver load and a valid isolated
  identity response; this is readiness, not acceptance evidence. Public results
  distinguish ACK, readback, verified postcondition and unknown outcomes.
- The runtime descriptor snapshots relative code/contract/lockfile hashes on module
  load. The live runner compares those to disk before browser actions, rejecting a
  stale in-memory host even if it already advertises the new tool names.
- Validate input before activation/dispatch and output before publication.
  Per-tab queues and connection window coordination share absolute deadlines.
  Write keys reserve in flight; uncertain writes block the native tab across
  contexts. Explicit originating-context abandon expires all refs before unblocking.
- Default input is synthetic isolated DOM with atomic node/document guards inside
  the script. Optional native actions use non-atomic pre/post RPC guards.
  MAIN evaluate uses bounded async tickets; failed scripts may have mutated and
  quarantine writes. Password observations are redacted; user JS is never executed
  on the Node host. Page content is untrusted input.
- Context release/idle TTL and client exit remove owner listeners, highlights,
  monitors and images. Native-monitor cleanup failure is explicit and retried;
  a host crash cannot guarantee vendor listener cleanup.
- Private G0 probe v2 targets one nonce-scoped loopback fixture; the basic suite
  uses the main frame, G0.4 uses fixed main/same-origin/cross-port frame targets,
  at most 40 temporary refs and one 5-minute session. Arbitrary commands, locators,
  text, JS and tab IDs are rejected. Best-effort URL/title guards are not a browser
  lock or security boundary against same-user processes. Ambiguous writes quarantine
  the probe; no subsequent write or tab-close dispatch is allowed until host restart.
- G0.4 refs bind generation plus fixture document/node markers; full native
  tab|frame|local IDs are validated then normalized to frame|local. Advanced reads
  recheck identity afterwards; typing rechecks immediately before and after write.
  Identity change after write is ACTION_OUTCOME_UNKNOWN with no retry. Separate
  native RPCs are not atomic; these fixture guards cannot prove race freedom.
- Pinned selector ElementNotFoundError {m_id:0} translates to zero only with
  a valid empty collection. Unknown errors and populated error results quarantine.
- Private finish disables the current process irreversibly; launcher opt-in must
  also be cleared with plain Setup Install. close_orphan accepts only an owned
  fixture URL/tab pair for cleanup after restart, with metadata revalidation.

## Side Effects

Binds a local named pipe/socket, keeps request/window state in memory, writes
protocol frames to stdout, and sends activation/read requests to the extension.
Open URL creates a real Chrome tab. The package does not ship the extension.
Opt-in G0 probe may open/close its fixture tab, mutate UiPath custom-ID attributes,
type fixed test text and click its counter button. G0.4 can reload/navigate only
its own fixture, test actual React state and await a user-triggered native restart.
None of these dev-only tests
changes the public G0 capability to available. Cleanup can leave a tab open when
scope or write outcome is uncertain; the runner records that condition.

## Verification

Run `npm test` from the repository root. These tests use a simulated extension.
Ajv validates strict input/output at runtime; Acorn validates function-expression
syntax without executing user JS. Both are pinned production dependencies.
The jsdom test harness simulates native routes/layout and is not live browser proof.
Live browser support requires separate fixture evidence. Initial bootstrap scout
covered bridge lines 1–300 and the complete transport file; it was not a security
audit or a completed Goldfish design review.
