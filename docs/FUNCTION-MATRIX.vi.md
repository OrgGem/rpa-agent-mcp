# Bảng tương thích lệnh driver UiPath

Mỗi dấu ✓ là một entry gọi trực tiếp có trong bảng dispatch của driver; dấu — không khẳng định chức năng tương đương không tồn tại qua `GenericRequest`. Driver nhúng thuộc extension 23.10.1.

Dấu ✓ không khẳng định handler trả lời hoặc chức năng đã chạy được. Audit ngày 2026-10-26 phát hiện FindWebCtrlElements là stub và GetHtmlElemById chỉ xử lý nhánh tìm tab trong driver 23.4. Xem [audit capability](EXTENSION-CAPABILITY-VERIFICATION.vi.md) trước khi dùng ma trận này làm cơ sở implementation.

| Function | 20.10.7992.24819 | 21.10.34.30369 | 22.4.38.42025 | 22.10.44.61278 | 23.4.55.39317 | 23.10.66.54596 |
|---|---|---|---|---|---|---|
| `AnyWebRequestsInFlight` | — | — | — | — | ✓ | ✓ |
| `AppendBigString` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AttachDebugger` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `BringElementIntoView` | — | — | ✓ | ✓ | ✓ | ✓ |
| `CheckHtmlElem` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ClickHtmlElem` | ✓ | ✓ | ✓ | ✓ | — | — |
| `CloseBrowser` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CloseMarkerTabs` | — | — | — | — | — | ✓ |
| `DeleteBigString` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `DetachDebugger` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EnableTracing` | — | — | — | — | — | ✓ |
| `ExtractData` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ExtractMetadata` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FindBrowserTabs` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FindContainer` | — | — | — | ✓ | ✓ | — |
| `FindSelectors` | — | — | ✓ | ✓ | ✓ | — |
| `FindWebCtrlElements` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GenericRequest` | — | — | — | — | ✓ | ✓ |
| `GetActiveTabId` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetAttributeForElements` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetBigString` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetBrowserData` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetBrowserTabZoom` | — | — | ✓ | ✓ | ✓ | ✓ |
| `GetBrowserWindows` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetFocusedHtmlElement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlAncestryInfo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlAttrValuesList` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlAttribute` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlAttributesList` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlCollectionById` | ✓ | — | — | — | — | — |
| `GetHtmlDevicePixelRatio` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlElemById` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlFromPoint` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlIdInfo` | ✓ | — | — | — | — | — |
| `GetHtmlIndex` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetHtmlRectangle` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `GetHtmlValue` | ✓ | ✓ | ✓ | ✓ | — | — |
| `GetHtmlValueForElements` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetRectFromText` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetSapFioriAllColLabels` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetSelectedRange` | — | — | — | — | ✓ | — |
| `GetSelectorAttributeNames` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetTabCount` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetTaskMiningInfoFromFocus` | — | — | ✓ | ✓ | ✓ | ✓ |
| `GetTaskMiningInfoFromPoint` | — | — | ✓ | ✓ | ✓ | ✓ |
| `GetTextFromScreenRect` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GetWindowIdForTabId` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Handshake` | — | — | — | ✓ | ✓ | ✓ |
| `HtmlGetSelectedItems` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `HtmlSetSelectedItems` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `IgnoreNextKeystrokeEvent` | ✓ | ✓ | ✓ | ✓ | — | — |
| `InjectAndRunJs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `IsBrowserTabActive` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `IsHtmlElemDisabled` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `IsHtmlElemValid` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `IsHtmlElemVisible` | — | — | ✓ | ✓ | ✓ | — |
| `IsHtmlPointVisible` | — | — | ✓ | ✓ | ✓ | ✓ |
| `IsHtmlVisible` | — | ✓ | — | — | — | — |
| `IsInstanceOfHtmlElement` | — | — | — | — | — | ✓ |
| `IsSamplePartOfANewColumn` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `IsTabContentAccessible` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MatchesTag` | — | — | ✓ | ✓ | ✓ | ✓ |
| `MaximizeWindow` | — | — | ✓ | ✓ | ✓ | ✓ |
| `MonitorNativeEvents` | — | — | — | — | ✓ | ✓ |
| `MouseWheelDebugger` | — | — | ✓ | ✓ | ✓ | ✓ |
| `Navigate` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `NavigationCommand` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `OpenMarkerTabs` | — | — | — | — | — | ✓ |
| `OpenTab` | — | — | — | — | ✓ | ✓ |
| `ReplaceTabAndNavigate` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `RunJS` | — | — | — | ✓ | ✓ | ✓ |
| `ScrollIntoView` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `SetBigString` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SetBrowserData` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SetFocusedHtmlElement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SetHtmlAttribute` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SetSelectedRange` | — | — | — | — | ✓ | — |
| `SimulateEvent` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `StartHighlight` | — | — | — | ✓ | ✓ | ✓ |
| `StartWebRequestMonitoring` | — | — | — | — | ✓ | ✓ |
| `StopHighlight` | — | — | — | ✓ | ✓ | ✓ |
| `StopWebRequestMonitoring` | — | — | — | — | ✓ | ✓ |
| `SupportsDebugger` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `TakeScreenshot` | — | — | ✓ | ✓ | ✓ | ✓ |
| `TreeExpandPath` | — | — | — | ✓ | ✓ | — |
| `TreeGetAllPaths` | — | — | — | ✓ | ✓ | — |
| `TreeGetNodePath` | — | — | — | ✓ | ✓ | — |
| `WriteTextHtmlElem` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Các request theo messageId, trường request trích từ từng handler và SHA256 nguồn được lưu trong [catalog JSON](uipath-function-catalog.json).
