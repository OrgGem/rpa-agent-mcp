# G0 source investigation

Date: 2026-10-26. Status: source-only candidate; G0 has not passed.
Read-only fresh-context investigator; no vendor source copied and no live action.

## Source provenance

Installed extension 23.10.1, embedded driver 23.4.55.39317.
`EmbeddedDriversContainer.js` SHA256:
`4de732c63b8a6b1b22e12a9db2a4a13ae2c0700a80669fd26631f7488f4b7308`.
This matches the existing pinned audit. Offsets below refer to that exact file.

## Discovery candidate

`onFindSelectors` (offset 2996946–2998542) accepts tabId, parentCustomId,
partialRequests, startWithId, timeoutMs, windowLeft/windowTop and page render
offsets. It dispatches content 8 with same/cross-frame redirect flags enabled.
The content original handler begins near offset 3205741.

A partial request contains `m_tagInfosList`, `m_searchOption`, `m_parentScore`,
`m_futureAttributeCount`. Tag info includes `m_attributesMap`,
`m_isGreedySearch`, `m_hasFuzzyAttributes`. Attribute key is `tag`, e.g. uppercase
`BUTTON`, plus a fixture ID. Do not substitute `tagName`.

Observed search enums: FIND_FIRST=0, FIND_ALL=1, FIND_SIMILAR=2;
scope CHILDREN=0, DESCENDANTS=1, TOP_LEVEL=2. A source-derived first candidate
uses FIND_ALL, DESCENDANTS, m_maxResults=10, m_minSelectorScore=0, boolean
search flags false, m_futureAttributeCount=0 and zero coordinate fields.
The empty parent score candidate is `{max:0,min:Number.MAX_VALUE,average:0,sum:0,count:0}`.
These observations still need a controlled wire/fixture probe; they are not a
public locator schema.

Observed output: `{results,retCode,endedWithId,isDocumentReady}`. Each partial
result has `m_resultsCollection.m_results[]`, containing `m_customId`, `m_id`,
`m_parentId`, matching score and optional position. Find may install a UiPath
custom-ID DOM attribute and cache nodes, so it has a DOM mutation side effect.

`|` separates custom-ID components. The background frame splitter expects exactly
`frameId|localCustomId`. Additional source tracing (same hash) at 3414202 confirms
selector results call ComputeCustomIdWithTabAndFrame(tab,frame,local); helper
definitions around 3090790/3090918 produce `tab|frame|local` and split the two-part
background form. G0 now validates owned tab/main frame 0 and sends `0|local`.
Iframe behavior remains separate and unsupported by this private smoke adapter.

## Read and write candidates

- GetHtmlAttribute offset 2987268: tabId/customId/attrName, content 11 for DOM.
  Empty customId metadata reads are already covered by historical live evidence.
- GenericRequest messageId 5 routes to content 18 for value/text and returns
  value/retCode. GetHtmlValueForElements receives customIdList/getFullText and
  returns htmlValues/retCode. Bulk refs contain tabId plus optional frame ID.
- WriteTextHtmlElem offset 2981901: tabId/customId/inputOptions/tokens. Non-debugger
  branch goes to content 45; the first probe must use one token `{text:...}` with
  debugger bit clear. Replace/append/events remain unverified.
- FindWebCtrlElements and the normal DOM branch of GetHtmlElemById remain
  unsuitable discovery routes; the existing audit records stub/partial behavior.

## Live prerequisites and next tasks

The new clone's endpoint was unavailable during inspection. Chrome was connected
to the original prototype directory, whose running host has only legacy IPC
operations and no DOM probe operation. This does not establish a DOM route failure.
No host registration or running host was changed in this task.

F0.3 must implement a bounded fixture/runner and a controlled development-only
probe path before G0.2. It must check exact host version, target only its own tab,
retain zero/one/multiple matches, and independently observe input and click events.
Then test stale refs after node removal, navigation and disconnect. A future host
transition must preserve the prior registration and provide rollback; a source
candidate must never silently enable public click/type capability.
