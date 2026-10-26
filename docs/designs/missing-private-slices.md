# Missing browser backends: private slice contracts

Date: 2026-10-26. Status: private source contracts implemented; no live install,
native-host registration, or browser activation.

This note freezes the private APIs for two readiness-approved source slices.
It does not approve the ten-tool browser backend design, companion installation,
browser activation, or live pairing. The same-user IPC channel is not an
authentication boundary.

## Artifact analysis read

`createArtifactStore(root, options)` keeps its current public store methods.
`put(clientRef, contextRef, data, mimeType, provenance?)` gains one optional
fifth argument. When present, it is the exact screenshot provenance record
`{sourceTool, tabRef, documentGeneration, viewportGeneration}` with
`sourceTool: "browser_screenshot"`. Existing four-argument calls and existing
metadata results retain their shape; provenance remains private store state.
Width, height, and MIME type continue to be held by the artifact record.

The new internal method is:

```js
analysisRead(clientRef, contextRef, artifactRef, { maxBytes, maxPixels })
// -> Promise<Buffer> containing the verified PNG bytes
analysisMetadata(clientRef, contextRef, artifactRef)
// -> Promise<{ width, height, provenance }> after the same full verification
```

The options are bounded positive safe integers. Defaults are the store's
`maxFileBytes` ceiling (6 MiB by default) and 16,000,000 pixels. A caller cannot
raise either hard ceiling. The method accepts PNG artifacts only. If provenance
is present, it must identify a `browser_screenshot`; absence remains allowed
for legacy store records because the current private writer only stores browser
screenshots. JPEG or an explicit non-screenshot source is rejected.

The method serializes its full operation with put, release, and sweep. It checks
client/context ownership and expiry, real-path containment, non-symlink regular
file status, recorded byte length, requested byte and pixel limits, and the
stored SHA-256 before returning. It validates PNG signature/chunk bounds and
header dimensions against stored dimensions; width and height must be nonzero
and their product must fit the pixel limit. Size and dimension limits are
checked before allocating the returned Buffer. Read/hash validation and the
post-read expiry check finish before a queued release or sweep can proceed.
No path, image block, or analysis result is exposed to MCP.

No screenshot capture caller, tool schema, or public route changes in this
slice. Future screenshot wiring may pass the optional provenance record.

## Companion pairing registry

The module exports:

```js
createCompanionPairingRegistry({
  now = Date.now,
  randomBytes = crypto.randomBytes,
  maxPending = 64,
  maxBindings = 128,
})
```

It returns a private registry with these operations:

```js
attachTransport(transport)
begin({ ownerRef, contextRef, tabRef, nativeTabId, windowId,
        documentToken, generation, hostEpoch, permittedOrigin? })
getBinding({ ownerRef, contextRef, tabRef })
getBindingByPairRef(pairRef) // private in-process lookup; returns the same safe binding shape
invalidateContext(ownerRef, contextRef)
invalidateTab(ownerRef, contextRef, tabRef)
invalidateHostEpoch(ownerRef, hostEpoch)
invalidateCompanionEpoch(companionEpoch)
dispose()
```

`attachTransport` accepts only the private, validated companion transport
contract. It calls `transport.subscribePairingEvents({onEpoch, onDisconnect,
onAttestation})`, which returns an unsubscribe function. `onEpoch` and
`onDisconnect` receive `{profileSessionRef, companionEpoch}` so multiple Chrome
profiles can share one broker without sharing epoch state. A pending nonce
captures the connected profile/epoch pairs at begin time; an attestation must
match one still-active pair exactly. Its identity is normalized from Chrome's
direct browser sender metadata and the native-messaging session; page message
fields are not browser sender metadata. This injected transport is the only
completion path. The registry exports no caller-facing
`complete(attestation)` method.

`begin` is an internal bridge operation after opaque refs have been resolved.
It creates a random 32-byte, base64url, single-use nonce and a 30-second pending
record bound to the exact owner, context, tab ref, native tab ID, window ID,
document token, generation, host epoch, and connected profile/companion epochs. The
optional `permittedOrigin` is an exact, normalized HTTP(S) page/frame origin
derived by trusted runtime state. It is only an additional match guard; a URL
does not establish tab or document identity. The return is `{nonce, expiresAt}`
for internal pairing orchestration. Nonces are never returned by `getBinding`;
duplicate active targets and nonce reuse fail closed.

An attestation has this normalized shape:

```js
{
  nonce, ownerRef, contextRef, tabRef, documentToken, generation, hostEpoch,
  companionEpoch, profileSessionRef,
  sender: { id, origin, tabId, windowId, frameId, documentId }
}
```

Completion succeeds only when every ref/token/generation/epoch equals the
pending record and the callback's active profile/companion epoch. The browser-authenticated
content-script `sender.id` is pinned to the UiPath extension
`jfcmnbofjlffnejneillkgbniiidiigd`; `sender.origin` is the page/frame origin,
not extension identity. It must be a canonical HTTP(S) origin, and when
`permittedOrigin` was supplied it must match exactly. `frameId` is zero,
browser-provided `tabId`/`windowId` equal the internal target, `documentId` is
nonempty, and `profileSessionRef` is nonempty. Unknown/opaque origin, malformed,
expired, replayed, duplicate, owner/document/epoch-mismatched attestations
create no binding.
`getBinding` returns only `pairRef` and scoped identity/session metadata; it
never returns sender IDs, browser raw IDs, or the nonce. To let the companion
associate the browser-observed challenge with the private ref without a second
raw-ID control message, `pairRef` is `pair_` plus the 256-bit challenge nonce.
It remains private and is never an MCP field.

Context, tab, host-epoch, and profile-scoped companion-epoch changes remove their
matching pending records and bindings. A profile transport epoch change
invalidates that profile's older companion state. `dispose` unsubscribes and
clears all state. Pending and binding counts
are bounded by the configured limits. Binding lifetime is ended by explicit
invalidation or disposal; the 30-second TTL applies to the pending challenge.

This private registry does not dispatch browser commands, activate tabs,
install/register the companion, or add MCP registration. It assumes the
injected transport has authenticated its own IPC peer and obtained sender
metadata from Chrome; same-user IPC, URL/title matching, and DOM-visible nonce
pairing are not substitutes for that evidence.

## Private companion package and client

`src/companion-client.mjs` exports `createCompanionClient`,
`COMPANION_ENDPOINT`, and `COMPANION_EXTENSION_ID`. The client uses the hashed
local endpoint derived from the canonical installation root, operating-system
username, and optional explicit instance. It receives native-host messages,
checks the fixed extension identity and protocol envelopes, passes normalized
attestations through the registry, and exposes `getBinding` with the live
connection epoch added from the matching profile connection.

The fixed client API is:

```js
start() -> readiness()
beginPairing(target) -> { nonce, expiresAt }
getBinding({ ownerRef, contextRef, tabRef })
waitForPairing(target, { deadline, signal })
request(envelope, { signal }) -> Promise<data>
subscribeEvents(listener)
waitForEvent({ ownerRef, contextRef, watchRef, kind, deadline, signal })
cleanupContext({ ownerRef, contextRef, deadline })
cleanupClient({ ownerRef, deadline })
dispose()
```

`signal` is local-only and is stripped from the JSON frame. After dispatch,
aborting a stateful operation reports an unknown outcome; the client never
replays it. `cleanupContext` returns
`{cleanupConfirmed, blockedTabRefs, cleanedPickerRefs}` and only reports picker
watch refs after the owning debugger release is acknowledged. The extension
service worker validates the closed protocol before dispatching fixed Chrome
APIs. The native host forwards bounded length-prefixed messages and accepts
only the stable extension origin; it does not log to stdout except for native
messaging frames.

`companion/manifest.json` holds the stable public extension key and pinned
UiPath external sender ID. `scripts/Build-Companion.ps1` builds the unpacked
extension plus separate host manifest under ignored `work/` and copies the
locally pinned axe-core bundle and license. `scripts/Setup-Companion.ps1`
offers read-only status and explicit registration/removal of only the separate
`com.uipath.companion_v1` host key. Neither script installs the extension or
activates Chrome by itself. See `companion/README.md` for manual setup and
rollback steps.

## Focused acceptance evidence

The artifact tests cover owner/context denial, expiry, same-size file
replacement, malformed and oversized PNGs, optional provenance, and reads
ordered against release/sweep. The registry tests use an injected transport
fixture and cover exact target binding, pinned sender/main-frame/origin checks,
expiry, replay, duplicate targets, owner/document/host/companion epoch mismatch,
all lifecycle invalidations, limits, and disposal. These offline tests establish
only private module behavior, not live Chrome authentication or browser support.
