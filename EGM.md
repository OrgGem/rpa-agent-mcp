# RPA Agent MCP blueprint

## System Overview

The runtime exposes four legacy MCP tools, read-only `browser_capabilities` and
42 strict browser adapters through a local bridge to the separately installed
UiPath Chrome extension. Ten roadmap tools need missing backends and are omitted.
The [runtime coverage](docs/RUNTIME-FUNCTION-COVERAGE.vi.md) distinguishes wired
native routes, isolated DOM composites and unavailable endpoints. Broad feature
catalogs remain the scenario baseline, not proof every option passed live.
Use [the development workflow](docs/EGM-WORKFLOW.md) for design and review.

## Interface

- [Runtime](src/EGM.md): native messaging, local IPC and MCP stdio interfaces.
- [Audit and authoring scripts](scripts/EGM.md): source evidence and docs tooling.
- [Setup.ps1](Setup.ps1): `-Mode Status` (default), `Install`, `Uninstall`.
  `Install -EnableG0Probe` explicitly enables the development fixture probe in
  the generated native launcher; plain Install explicitly disables it.
- [Verify-Live.mjs](Verify-Live.mjs): status/version verification; optional
  `--open-url <url>` requests real navigation.
- [Tests](test/bridge.test.mjs): offline transport and simulated extension roundtrip.

## Invariants

Node 22.22.2+ in v22 or 24.15+ is required. Setup requires Node on PATH in every mode. Installation
requires the exact UiPath extension ID/version in Chrome's Default profile.
It refuses conflicting native-host registrations and creates its registration
under HKCU Registry32. Uninstall removes only matching owned HKCU registrations.
Setup delegates generated files to scripts/Write-NativeHostFiles.ps1; UTF-8
manifest/launcher and an ASCII code-page preamble preserve Unicode paths without
adding text to the native binary stream. The helper does not change registration.

The UiPath Activity list, source handlers, mock probes, and live receipts are
different kinds of evidence. Public input/ref/discovery adapters have source and
focused offline evidence; public runtime live acceptance remains pending.
The opt-in private G0 adapter passed a pinned main-frame live smoke with
independent value/event reports. It does not advertise general DOM capability;
G0.4 subsequently passed 11 scoped stale/frame/controlled/reconnect live cases
with React 19.3.1. The connected host has returned to normal mode with probe
disabled in-process and in its launcher. A new native load is needed to activate
the public runtime. Multi-RPC identity guards are not atomic.

## Side Effects

Setup installation writes a manifest, launcher and initial registration snapshot,
and updates the Windows registry. Generated machine files are ignored by Git.
Uninstall leaves generated files and does not terminate an already connected host.
Live verification starts a child process and overwrites `verification.json`;
its optional navigation opens a browser tab. Scripts may fetch documentation,
read local extension files and overwrite evidence or generated documentation.

## Verification

Run `npm test` from this directory for offline tests. For live checks, follow
[the script guide](scripts/README.md), inspect side effects first and record
the exact tested scope. Bootstrap inspection creates documentation contracts;
it does not certify full browser automation or a completed EGM review cycle.
