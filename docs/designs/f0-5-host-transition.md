# F0.5 host transition and rollback

User authorization: switch the existing owned prototype registration to this
checkout with rollback, run live G0, and update the plan. Scope is the current
user's UiPath native messaging host only. Do not stop Chrome or change vendor files.

## Procedure and rollback contract

1. Inspect HKCU/HKLM Registry32/64 default values for
   com.uipath.chromenativemsg_v2. Refuse any HKLM registration or an HKCU value
   other than the explicitly supplied previous checkout's native-host.json.
2. Create a unique ignored work/host-transition-* folder. Snapshot all observed
   registry views and bytes of old launcher/manifest plus any generated files in
   this checkout (native-host.cmd/json and registration-before.json). Store local
   paths only in that ignored machine snapshot, never public receipts.
3. Save a rollback script beside the snapshot BEFORE mutations. It rejects
   unrelated current registrations, directly restores the fixed HKCU host key,
   restores previous generated-file bytes and original HKCU default values for
   each view. It restores/deletes only the fixed allowlist of generated files;
   it never recursively removes a directory or touches source files.
4. Remove only old owned HKCU keys using the previous checkout's Setup.ps1, then
   run this checkout's Setup.ps1 Install -EnableG0Probe. If setup fails, invoke
   rollback immediately. Write an applied receipt only after registry readback.
5. Toggle the UiPath extension off/on through Chrome extensions UI. Check the
   old endpoint is gone and this checkout's endpoint has a new native PID,
   expected version and enabled G0 protocol. Registry switch alone is not success.
6. Run preflight, then scripts/run-g0.mjs --live. Preserve failed receipts before
   debugging. Read/schema fixes must be source-bounded and tested; never repeat
   uncertain writes. A quarantined probe needs an extension reconnect before any
   further action. Close only owned fixture tabs with exact nonce URL/title.
7. Exercise rollback once and reconnect/verify old host before final migration,
   or report rollback as prepared but untested. Keep snapshot and rollback script
   available after final migration. After testing, disable the private probe via
   plain Install and extension reconnect, retaining the new production host.

## Implementation

Create scripts/Switch-NativeHost.ps1 with PreviousRoot and SnapshotDirectory
parameters. PreviousRoot is resolved literally, must differ from this checkout,
and must contain Setup.ps1/native-host.json/native-host.cmd. SnapshotDirectory is
new and under this checkout's ignored work folder. Generated rollback is copied
from scripts/Restore-NativeHost.ps1 and reads snapshot.json in the same directory.
Both scripts require PowerShell 7.2+, validate the fixed host name, current
registrations, REG_SZ kinds and fixed file names. Restore binds the new root to
the snapshot's checkout work/ location and rejects reparse points in roots/files;
restoration never overwrites an unrelated native host. Snapshot metadata is trusted
local input created by the switch script, not an imported third-party document.

The switch script runs only explicitly authorized installer changes. Rollback
failure must propagate and retain the snapshot. Native processes reconnect only
via the extension UI; process IDs from endpoints are evidence, not kill targets.

## Verification and evidence

PowerShell parser checks first. Review scripts independently before registry
mutation. Capture before/applied/rollback/final registry and connection readback.
Run existing offline tests if runtime changes are needed for live protocol fixes.
Store sanitized public transition and G0 receipts in docs/; raw paths/PIDs and
snapshots remain in ignored work/. G0 smoke evidence is scoped to the main-frame
fixture; do not promote it to full frame/stale/control compatibility.

Concrete checks: reject checksum mismatch, path traversal, incomplete file set and
invalid registry view before mutation (test/host-transition.test.mjs); ValidateOnly
must leave files/registry unchanged; Apply must read both HKCU views pointing at
new manifest; rollback must verify original byte hashes/absence and original
registry values; old native endpoint must still respond after CLI rollback drill.
That drill does not claim a fresh old-process reconnect when no extension reload
occurred. Final host connection requires a new endpoint response after the user
manually toggles the extension; registry readback alone is insufficient.

## Review and executed checkpoints

Independent EGM code review found no P1 on the prepared machine snapshot. Its P2
findings were accepted: bind snapshot to checkout work/, reject reparse points,
declare PowerShell 7.2+, check REG_SZ kind, defer Node lookup to Install, and align
rollback description with actual HKCU restoration. Negative snapshot tests passed.

The CLI drill applied the new registration, restored original file hashes and
registry values, verified the still-running old endpoint, then applied the new
registration again. The user manually reconnected the extension; the new endpoint
responded with probe protocol 1 and the old endpoint became unavailable. This is
actual host transition evidence, separate from the failed first G0 discovery test.

First G0 attempt passed missing-element=0 and stopped finding the input at schema
validation; no type/click was sent. Source tracing corrected full selector IDs
from tab|frame|local to the scoped frame|local background form. A separate reviewer
found no P1/P2 runtime issue in that fix and requested stronger normalized-wire
assertions; those assertions were added and passed with numeric local IDs. The
failed receipt is preserved; the quarantined host must reconnect before retry.

## Final verified state

After the user opened the extension's required background page, the new host
connected. The normalized-ID retest passed 0/1/2 discovery, value read, Unicode
replace/append and one counter click; independent fixture reports matched, and
tab/server cleanup passed. The launcher was reinstalled without probe enablement;
the user refreshed the background page and the normal-mode host connected with
the pinned driver loaded. IPC preflight confirmed private probe disabled.

MCP follow-through: the existing uipath_bridge client alias still referenced the
old checkout, whose path-derived IPC endpoint no longer existed. Its prior stdio
configuration (no env, tool filters or nondefault timeouts) was snapshotted, and
only this alias was changed to the new checkout via Codex CLI. An independent
client from that saved configuration initialized, listed five tools and called
capability discovery against the normal-mode native host. Existing app processes
were not forcibly restarted; their configuration reload was not verified.

Machine-local Rollback-All.ps1 restores native files/registry and the old MCP
alias, rejecting changes made since migration. Combined rollback preconditions
were validated, but the combined sequence was not executed end-to-end against
the now-working host. The earlier native-only CLI rollback drill did execute and
verify file/registry readback. Raw snapshots stay ignored under work/.

Evidence: docs/HOST-TRANSITION-VERIFICATION.json, docs/G0-LIVE-VERIFICATION.json,
docs/MCP-HOST-VERIFICATION.json. Full G0 remains false.
