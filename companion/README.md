# Private Chrome Companion

The Companion is a separate Manifest V3 extension and native-messaging bridge
for the local UiPath MCP process. It is a private typed backend; it does not
add public MCP registration or expose a raw CDP tunnel.

The stable extension ID is
`dppcppnipbmolajgbbackncmhgejpena`. The manifest contains the matching public
key; there is no signing private key in this repository. The extension only
accepts external pairing messages from the pinned UiPath extension ID and
checks Chrome's sender ID, main-frame tab/window/document IDs, and page origin.
The native pipe is scoped by the canonical repository/install root, operating
system user, and optional `UIPATH_BRIDGE_INSTANCE`. Same-user IPC is not an
authentication boundary.

## Build package

Build writes only under the ignored `work/companion-unpacked` directory. It
checks that axe-core is exactly 4.14.0 (MPL-2.0), copies the local bundle and
license, verifies the manifest key maps to the pinned extension ID, and emits
a native-host manifest for the current repository path.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-Companion.ps1
```

The resulting files are:

- `work/companion-unpacked/extension/` — unpacked extension package
- `work/companion-unpacked/com.uipath.companion_v1.json` — native-host manifest
- `work/companion-unpacked/companion-host.cmd` — generated Windows native-host launcher

Build does not install the extension, register the native host, enable Chrome
debugging, or launch a browser process.

## Separate manual setup

When setup is explicitly authorized, load the `extension` directory as an
unpacked extension in Chrome. Then register only this Companion native host:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-Companion.ps1 -Action Register
```

`Status` is read-only. `Register` checks both 32-bit and 64-bit current-user
Chrome registry views and refuses to replace a different host manifest already
registered under `com.uipath.companion_v1`; it does not stop processes or adopt
an existing browser. Each Chrome profile connects through the same
per-installation endpoint and keeps its own profile session, companion epoch,
and connection epoch.

The fixed protocol supports bounded key sequences, exact-trigger JavaScript
dialog watches, exact-trigger file chooser watches, owner-scoped explicit
downloads, bounded Chrome accessibility candidates, and a locally bundled
axe-core audit. File staging and allowlisted upload roots remain owned by the
bridge; the Companion consumes only staged file manifests and the one-shot
Chrome backend-node proof. Dialog policy controls whether an open dialog is
dismissed or left open. Downloads continue to be tracked by owner and profile
session after document navigation.

## Rollback

Unregister removes the native-host key only when it still points to this
build's manifest. A different registration is preserved:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-Companion.ps1 -Action Unregister
```

Then remove the unpacked Companion extension from Chrome's extension page.
This rollback does not stop Chrome or other native-host processes and does not
change UiPath's extension registration. The ignored build output can be removed
separately after verifying its path under this repository's `work` directory.
