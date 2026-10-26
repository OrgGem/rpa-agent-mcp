# Runtime: function → adapter → MCP → phase

Extension 23.10.1; driver 23.4.55.39317. 43 browser tools gồm capabilities; 4 legacy; 10 tool cần backend còn thiếu. Đây là coverage source, chưa phải chứng nhận live cho mọi option.

[Schema input/output chính xác](browser-tool-contracts.json) · [JSON từng protocol row](runtime-function-coverage.json) · [Plan](DEVELOPMENT-PHASES.vi.md)

| Tool | Phase | Adapter | Route | Trạng thái / giới hạn |
|---|---|---|---|---|
| browser_attach | F1.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_tabs | F1.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, FindBrowserTabs, GetTabCount, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_tab_open | F1.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, OpenTab, InjectAndRunJs, GetWindowIdForTabId, GetHtmlAttribute, GetActiveTabId | Only the enums/options in the strict input schema are implemented. |
| browser_tab_get | F1.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_tab_activate | F1.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, NavigationCommand, GetActiveTabId, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_tab_close | F1.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, CloseBrowser, FindBrowserTabs, GetTabCount, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_navigate | F1.3 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, Navigate, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_history | F1.3 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, NavigationCommand, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_find_element | F2.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors | Only the enums/options in the strict input schema are implemented. |
| browser_find_elements | F2.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors | Only the enums/options in the strict input schema are implemented. |
| browser_snapshot | F2.3 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_get_element | F2.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_wait_for | F2.3 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_click | F3.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid, GenericRequest | Default dom is synthetic; optional uipath uses separate best-effort native identity checks. |
| browser_type | F3.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid, WriteTextHtmlElem | Default dom is synthetic; optional uipath uses separate best-effort native identity checks. |
| browser_set_text | F4.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_set_checked | F3.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid, CheckHtmlElem | Only the enums/options in the strict input schema are implemented. |
| browser_select_options | F3.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid, HtmlSetSelectedItems | Only the enums/options in the strict input schema are implemented. |
| browser_scroll | F3.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_focus | F3.2 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, NavigationCommand, GetActiveTabId | Only the enums/options in the strict input schema are implemented. |
| browser_screenshot | F3.3 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, GetActiveTabId, TakeScreenshot | Only the enums/options in the strict input schema are implemented. |
| browser_set_attribute | F4.4 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_hover | F4.4 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_drag_and_drop | F5.6 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_frames | F4.6 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_frame_attach | F4.6 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid | Only the enums/options in the strict input schema are implemented. |
| browser_text_selection | F4.4 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_highlight | F4.4 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_evaluate | F4.1 | src/browser-operations.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, FindSelectors, IsHtmlElemValid | Only the enums/options in the strict input schema are implemented. |
| browser_extract_table | F4.2 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, GetHtmlAttribute, GetActiveTabId | Only the enums/options in the strict input schema are implemented. |
| browser_table_cell | F4.4 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_tree | F4.4 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_calendar_select | F5.5 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_form_read | F4.2 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_form_fill | F4.2 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_close_popup | F4.4 | src/browser-composites.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, GetHtmlAttribute, GetActiveTabId | Only the enums/options in the strict input schema are implemented. |
| browser_network_wait | F4.3 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, StartWebRequestMonitoring, AnyWebRequestsInFlight, StopWebRequestMonitoring | Only the enums/options in the strict input schema are implemented. |
| browser_events | F5.6 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_wait_new_tab | F4.3 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, FindBrowserTabs, GetTabCount, GetHtmlAttribute, GetWindowIdForTabId, GetActiveTabId, InjectAndRunJs | Only the enums/options in the strict input schema are implemented. |
| browser_cookies | F4.3 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId | Only the enums/options in the strict input schema are implemented. |
| browser_window | F5.4 | src/browser-observers.mjs | OnProductVersionChanged, Handshake, InjectAndRunJs, GetWindowIdForTabId, GetActiveTabId, NavigationCommand, MaximizeWindow | Only the enums/options in the strict input schema are implemented. |
| browser_image_artifact | F5.3 | src/browser-observers.mjs | OnProductVersionChanged, Handshake | Only the enums/options in the strict input schema are implemented. |
| browser_press_keys | deferred | — |  | NO_SAFE_TARGETED_KEY_BACKEND: pinned normal WriteText ignores key tokens; debugger route lacks verified target/default-action semantics. |
| browser_semantic_query | deferred | — |  | SEMANTIC_PROVIDER_REQUIRED |
| browser_dialog | deferred | — |  | INDEPENDENT_ASYNC_DIALOG_BACKEND_REQUIRED |
| browser_file_picker | deferred | — |  | NATIVE_FILE_PICKER_BACKEND_REQUIRED |
| browser_download | deferred | — |  | CORRELATED_DOWNLOAD_BACKEND_REQUIRED |
| browser_launch | deferred | — |  | OWNED_PROFILE_LAUNCH_BACKEND_REQUIRED |
| system_clipboard | deferred | — |  | OPTIONAL_NATIVE_CLIPBOARD_BACKEND_REQUIRED |
| browser_visual_find | deferred | — |  | VISION_PROVIDER_REQUIRED |
| browser_ocr | deferred | — |  | OCR_PROVIDER_REQUIRED |
| browser_accessibility_audit | deferred | — |  | ACCESSIBILITY_AUDIT_ENGINE_REQUIRED |

## Disposition cho toàn bộ protocol

`wired` là gọi native endpoint; `dom-composite` là chức năng tương ứng được viết bằng typed isolated JS, không gọi endpoint vendor đó. `not-wired` có lý do riêng. Content IDs là chi tiết forwarding bên trong vendor, không public.

| Function/route | Disposition | MCP consumers thực tế | Task | Lý do |
|---|---|---|---|---|
| named:AnyWebRequestsInFlight | wired | browser_network_wait | F4.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:AppendBigString | not-wired |  | F4.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:AttachDebugger | not-wired |  | F4.5 | Not dispatched: shared debugger ownership and targeted trusted key input are not implemented. |
| named:BringElementIntoView | dom-composite | browser_scroll | F3.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:CheckHtmlElem | wired | browser_set_checked | F3.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:ClickHtmlElem | not-wired |  | G0.3, F3.1 | DIRECT_ENTRY_ABSENT: driver ghim dùng GenericRequest messageId 6. |
| named:CloseBrowser | wired | browser_tab_close | F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:CloseMarkerTabs | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: marker workflow legacy không có trong driver ghim và không cần cho own tab refs. |
| named:DeleteBigString | not-wired |  | F4.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:DetachDebugger | not-wired |  | F4.5 | Not dispatched: cannot detach a debugger owned by another client. |
| named:EnableTracing | not-wired |  | F0.4, F4.5 | DRIVER_VERSION_MISMATCH: entry chỉ có ở driver 23.10, không có ở 23.4 ghim. |
| named:ExtractData | dom-composite | browser_extract_table, browser_table_cell | F4.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:ExtractMetadata | dom-composite | browser_extract_table, browser_table_cell | F4.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:FindBrowserTabs | wired | browser_tabs, browser_tab_close, browser_wait_new_tab | F1.1, F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:FindContainer | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:FindSelectors | wired | browser_find_element, browser_find_elements, browser_click, browser_type, browser_set_checked, browser_select_options, browser_frame_attach, browser_evaluate | G0.2, F2.1 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:FindWebCtrlElements | not-wired |  | F0.4 | PINNED_STUB_NO_CALLBACK: handler chỉ khai báo biến, không trả kết quả. |
| named:GenericRequest | wired | browser_click | G0.2, F2.2, G0.4, F2.3, F3.2, F3.3, F2.1, F4.1, G0.3, F3.1, F4.4, F5.6, F5.5, F1.1, F1.2, F4.2 | Only messageId 6 non-debugger single-left-click. Generic 5 remains private historical G0 only. |
| named:GetActiveTabId | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_focus, browser_screenshot, browser_extract_table, browser_close_popup, browser_wait_new_tab, browser_window | F1.1, F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:GetAttributeForElements | dom-composite | browser_get_element, browser_form_read, browser_extract_table | G0.2, F2.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetBigString | not-wired |  | F4.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetBrowserData | not-wired |  | F4.3 | Not dispatched: exports cookies across the entire profile, including unrelated origins; public cookies use document.cookie only. |
| named:GetBrowserTabZoom | not-wired |  | F1.1, F1.2 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetBrowserWindows | not-wired |  | F1.1, F1.2 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetFocusedHtmlElement | dom-composite | browser_get_element, browser_wait_for, browser_focus | G0.4, F2.2, F2.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlAncestryInfo | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetHtmlAttrValuesList | dom-composite | browser_get_element, browser_form_read, browser_extract_table | G0.2, F2.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlAttribute | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_close, browser_navigate, browser_history, browser_extract_table, browser_close_popup, browser_wait_new_tab | G0.2, F2.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:GetHtmlAttributesList | dom-composite | browser_get_element, browser_form_read, browser_extract_table | G0.2, F2.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlCollectionById | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: legacy collection không tồn tại ở driver ghim; không suy schema tương đương FindSelectors. |
| named:GetHtmlDevicePixelRatio | dom-composite | browser_get_element, browser_screenshot | F2.2, F3.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlElemById | not-wired |  | F0.4 | PINNED_PARTIAL_TAB_ONLY: tabId thường/index hợp lệ không trả lời nhánh DOM. |
| named:GetHtmlFromPoint | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetHtmlIdInfo | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: chưa có contract tương đương cho helper ID legacy. |
| named:GetHtmlIndex | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetHtmlRectangle | dom-composite | browser_get_element, browser_screenshot | F2.2, F3.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlValue | dom-composite | browser_get_element, browser_wait_for | G0.2, F2.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetHtmlValueForElements | dom-composite | browser_get_element, browser_form_read, browser_extract_table | G0.2, F2.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetRectFromText | not-wired |  | F2.2, F3.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetSapFioriAllColLabels | not-wired |  | F4.4, F5.5 | SAP-specific native schema is not a generic HTML table contract; public table tools use isolated DOM. |
| named:GetSelectedRange | dom-composite | browser_text_selection | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:GetSelectorAttributeNames | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetTabCount | wired | browser_tabs, browser_tab_close, browser_wait_new_tab | F1.1, F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:GetTaskMiningInfoFromFocus | not-wired |  | F0.4, F5.6 | OUTSIDE_CURRENT_PUBLIC_CONTRACT: telemetry Task Mining không có API/schema/acceptance trong 53 tool browser; không suy thành DOM read. |
| named:GetTaskMiningInfoFromPoint | not-wired |  | F0.4, F5.6 | OUTSIDE_CURRENT_PUBLIC_CONTRACT: telemetry Task Mining không có API/schema/acceptance trong 53 tool browser; không suy thành DOM read. |
| named:GetTextFromScreenRect | not-wired |  | F2.2, F3.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:GetWindowIdForTabId | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_get, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_find_element, browser_find_elements, browser_snapshot, browser_get_element, browser_wait_for, browser_click, browser_type, browser_set_text, browser_set_checked, browser_select_options, browser_scroll, browser_focus, browser_screenshot, browser_set_attribute, browser_hover, browser_drag_and_drop, browser_frames, browser_frame_attach, browser_text_selection, browser_highlight, browser_evaluate, browser_extract_table, browser_table_cell, browser_tree, browser_calendar_select, browser_form_read, browser_form_fill, browser_close_popup, browser_network_wait, browser_events, browser_wait_new_tab, browser_cookies, browser_window | F1.1, F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:Handshake | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_get, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_find_element, browser_find_elements, browser_snapshot, browser_get_element, browser_wait_for, browser_click, browser_type, browser_set_text, browser_set_checked, browser_select_options, browser_scroll, browser_focus, browser_screenshot, browser_set_attribute, browser_hover, browser_drag_and_drop, browser_frames, browser_frame_attach, browser_text_selection, browser_highlight, browser_evaluate, browser_extract_table, browser_table_cell, browser_tree, browser_calendar_select, browser_form_read, browser_form_fill, browser_close_popup, browser_network_wait, browser_events, browser_wait_new_tab, browser_cookies, browser_window, browser_image_artifact | F0.3, F1.1 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:HtmlGetSelectedItems | dom-composite | browser_select_options, browser_get_element, browser_form_fill | F3.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:HtmlSetSelectedItems | wired | browser_select_options | F3.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:IgnoreNextKeystrokeEvent | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT_AND_WRONG_SEMANTICS: bỏ qua sự kiện recorder không phải phát phím. |
| named:InjectAndRunJs | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_get, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_find_element, browser_find_elements, browser_snapshot, browser_get_element, browser_wait_for, browser_click, browser_type, browser_set_text, browser_set_checked, browser_select_options, browser_scroll, browser_focus, browser_screenshot, browser_set_attribute, browser_hover, browser_drag_and_drop, browser_frames, browser_frame_attach, browser_text_selection, browser_highlight, browser_evaluate, browser_extract_table, browser_table_cell, browser_tree, browser_calendar_select, browser_form_read, browser_form_fill, browser_close_popup, browser_network_wait, browser_events, browser_wait_new_tab, browser_cookies, browser_window | F4.1 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:IsBrowserTabActive | not-wired |  | F1.1, F1.2 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:IsHtmlElemDisabled | dom-composite | browser_get_element, browser_wait_for, browser_focus | G0.4, F2.2, F2.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:IsHtmlElemValid | wired | browser_click, browser_type, browser_set_checked, browser_select_options, browser_frame_attach, browser_evaluate | G0.4, F2.2, F2.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:IsHtmlElemVisible | dom-composite | browser_get_element, browser_wait_for, browser_focus | G0.4, F2.2, F2.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:IsHtmlPointVisible | dom-composite | browser_get_element, browser_wait_for, browser_focus | G0.4, F2.2, F2.3 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:IsHtmlVisible | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: visibility legacy không có ở driver ghim; không alias âm thầm. |
| named:IsInstanceOfHtmlElement | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: helper legacy không có tuyến trực tiếp đã audit trong driver ghim. |
| named:IsSamplePartOfANewColumn | dom-composite | browser_extract_table, browser_table_cell | F4.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:IsTabContentAccessible | not-wired |  | G0.4, F2.2, F2.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:MatchesTag | not-wired |  | G0.2, F2.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:MaximizeWindow | wired | browser_window | F5.4 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:MonitorNativeEvents | dom-composite | browser_events | F5.6 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:MouseWheelDebugger | not-wired |  | F3.2 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:Navigate | wired | browser_navigate | F1.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:NavigationCommand | wired | browser_tab_activate, browser_history, browser_focus, browser_window | F1.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:OpenMarkerTabs | not-wired |  | F0.4 | DIRECT_ENTRY_ABSENT: marker workflow legacy không có trong driver ghim và không cần cho own tab refs. |
| named:OpenTab | wired | browser_tab_open | F1.2 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:ReplaceTabAndNavigate | not-wired |  | F1.3 | Not dispatched: replacing a native tab needs separate ownership/identity semantics; public navigate uses Navigate. |
| named:RunJS | not-wired |  | F4.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:ScrollIntoView | dom-composite | browser_scroll | F3.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:SetBigString | not-wired |  | F4.3 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| named:SetBrowserData | not-wired |  | F4.3 | Not dispatched: profile-wide destructive cookie replacement is not a scoped/transactional cookie API. |
| named:SetFocusedHtmlElement | dom-composite | browser_focus | F3.2 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:SetHtmlAttribute | dom-composite | browser_set_attribute | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:SetSelectedRange | dom-composite | browser_text_selection | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:SimulateEvent | dom-composite | browser_hover, browser_drag_and_drop, browser_close_popup | F4.4, F5.6 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:StartHighlight | dom-composite | browser_highlight | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:StartWebRequestMonitoring | wired | browser_network_wait | F4.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:StopHighlight | dom-composite | browser_highlight | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:StopWebRequestMonitoring | wired | browser_network_wait | F4.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:SupportsDebugger | not-wired |  | F4.5 | No debugger-backed public option is enabled. |
| named:TakeScreenshot | wired | browser_screenshot | F3.3 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| named:TreeExpandPath | dom-composite | browser_tree | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:TreeGetAllPaths | dom-composite | browser_tree | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:TreeGetNodePath | dom-composite | browser_tree | F4.4 | This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed. |
| named:WriteTextHtmlElem | wired | browser_type | G0.3, F3.1, F4.1 | Native text only options 0/4; debugger key-token route is unavailable. |
| loader:CanLoadDriverVersion | not-wired |  | F0.3, F1.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| loader:GetEmbeddedDriverVersions | wired | uipath_driver_versions | F0.3, F1.1 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| loader:OnProductVersionChanged | wired | browser_attach, browser_tabs, browser_tab_open, browser_tab_get, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_find_element, browser_find_elements, browser_snapshot, browser_get_element, browser_wait_for, browser_click, browser_type, browser_set_text, browser_set_checked, browser_select_options, browser_scroll, browser_focus, browser_screenshot, browser_set_attribute, browser_hover, browser_drag_and_drop, browser_frames, browser_frame_attach, browser_text_selection, browser_highlight, browser_evaluate, browser_extract_table, browser_table_cell, browser_tree, browser_calendar_select, browser_form_read, browser_form_fill, browser_close_popup, browser_network_wait, browser_events, browser_wait_new_tab, browser_cookies, browser_window, browser_image_artifact | F0.3, F1.1 | Exact public adapter and shared lifecycle/identity route listed in consumers. |
| loader:_ValidatePermissions | not-wired |  | F0.3, F1.1 | No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed. |
| host-callback:GetDetailedDriverVersion | fixed-host-handler |  | F0.3, F1.1 | Fixed pinned host callback, not a callable public tool. |
| host-callback:IsTraceEnabled | fixed-host-handler |  | F4.5 | Fixed pinned host callback, not a callable public tool. |
| host-callback:LoadScripts | fixed-host-handler |  | F0.3, F1.1 | Fixed pinned host callback, not a callable public tool. |
| host-callback:RegisterNewlyCreatedWindowId | fixed-host-handler |  | F0.3, F1.1 | Fixed pinned host callback, not a callable public tool. |
| host-callback:UnregisterWindowId | fixed-host-handler |  | F0.3, F1.1 | Fixed pinned host callback, not a callable public tool. |
| content:0 | not-wired |  | F1.1, F1.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:1 | indirect-vendor-content | browser_set_checked | F3.2 | Vendor background route CheckHtmlElem forwards internally; not called as raw content ID. |
| content:2 | indirect-vendor-content | browser_click | G0.3, F3.1 | Vendor background route GenericRequest forwards internally; not called as raw content ID. |
| content:3 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:4 | not-wired |  | F0.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:5 | not-wired |  | F4.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:6 | not-wired |  | F4.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:7 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:8 | indirect-vendor-content | browser_find_element, browser_find_elements, browser_click, browser_type, browser_set_checked, browser_select_options, browser_frame_attach, browser_evaluate | G0.2, F2.1 | Vendor background route FindSelectors forwards internally; not called as raw content ID. |
| content:9 | not-wired |  | G0.4, F2.2, F2.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:10 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:11 | indirect-vendor-content | browser_attach, browser_tabs, browser_tab_open, browser_tab_close, browser_navigate, browser_history, browser_extract_table, browser_close_popup, browser_wait_new_tab | G0.2, F2.2 | Vendor background route GetHtmlAttribute forwards internally; not called as raw content ID. |
| content:12 | not-wired |  | G0.2, F2.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:13 | not-wired |  | G0.2, F2.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:14 | not-wired |  | F2.2, F3.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:15 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:16 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:17 | not-wired |  | F2.2, F3.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:18 | not-wired |  | G0.2, F2.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:19 | not-wired |  | F2.2, F3.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:20 | not-wired |  | F4.4, F5.5 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:21 | not-wired |  | G0.2, F2.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:22 | not-wired |  | F2.2, F3.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:23 | not-wired |  | F3.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:24 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:25 | indirect-vendor-content | browser_select_options | F3.2 | Vendor background route HtmlSetSelectedItems forwards internally; not called as raw content ID. |
| content:26 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:27 | indirect-vendor-content | browser_attach, browser_tabs, browser_tab_open, browser_tab_get, browser_tab_activate, browser_tab_close, browser_navigate, browser_history, browser_find_element, browser_find_elements, browser_snapshot, browser_get_element, browser_wait_for, browser_click, browser_type, browser_set_text, browser_set_checked, browser_select_options, browser_scroll, browser_focus, browser_screenshot, browser_set_attribute, browser_hover, browser_drag_and_drop, browser_frames, browser_frame_attach, browser_text_selection, browser_highlight, browser_evaluate, browser_extract_table, browser_table_cell, browser_tree, browser_calendar_select, browser_form_read, browser_form_fill, browser_close_popup, browser_network_wait, browser_events, browser_wait_new_tab, browser_cookies, browser_window | F4.1 | Vendor background route InjectAndRunJs forwards internally; not called as raw content ID. |
| content:28 | not-wired |  | G0.4, F2.2, F2.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:29 | indirect-vendor-content | browser_click, browser_type, browser_set_checked, browser_select_options, browser_frame_attach, browser_evaluate | G0.4, F2.2, F2.3 | Vendor background route IsHtmlElemValid forwards internally; not called as raw content ID. |
| content:30 | not-wired |  | G0.4, F2.2, F2.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:31 | not-wired |  | G0.4, F2.2, F2.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:32 | not-wired |  | F4.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:33 | not-wired |  | G0.4, F2.2, F2.3 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:34 | indirect-vendor-content | browser_tab_activate, browser_history, browser_focus, browser_window | F1.3 | Vendor background route NavigationCommand forwards internally; not called as raw content ID. |
| content:35 | not-wired |  | F4.1 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:36 | not-wired |  | F3.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:37 | not-wired |  | F3.2 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:38 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:39 | not-wired |  | F4.4, F5.6 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:40 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:41 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:42 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:43 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:44 | not-wired |  | F4.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:45 | indirect-vendor-content | browser_type | G0.3, F3.1, F4.1 | Vendor background route WriteTextHtmlElem forwards internally; not called as raw content ID. |
| content:46 | not-wired |  | F0.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:47 | not-wired |  | F0.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:48 | not-wired |  | F5.6 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| content:49 | not-wired |  | F0.4 | No public raw content dispatcher. DOM composites do not imply this native content command was invoked. |
| generic:map:5 | not-wired |  | G0.2, F2.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:6 | not-wired |  | G0.3, F3.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:10 | not-wired |  | G0.2, F2.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:15 | not-wired |  | G0.4, F2.2, F2.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:40 | not-wired |  | F3.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:4 | not-wired |  | F2.2, F3.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:34 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:24 | not-wired |  | G0.2, F2.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:12 | not-wired |  | F3.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:23 | not-wired |  | F4.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:60 | not-wired |  | F4.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:25 | not-wired |  | F2.2, F3.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:20 | not-wired |  | F3.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:36 | not-wired |  | G0.4, F2.2, F2.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:13 | not-wired |  | F3.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:11 | not-wired |  | F3.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:7 | not-wired |  | G0.3, F3.1, F4.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:18 | not-wired |  | F4.4 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:16 | not-wired |  | G0.2, F2.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:21 | not-wired |  | F2.2, F3.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:22 | not-wired |  | F2.2, F3.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:17 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:46 | not-wired |  | F4.4, F5.6 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:19 | not-wired |  | G0.4, F2.2, F2.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:2 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:47 | not-wired |  | F4.4, F5.5 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:63 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:64 | not-wired |  | F4.4 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:65 | not-wired |  | F4.4 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:66 | not-wired |  | F4.4 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:55 | not-wired |  | G0.4, F2.2, F2.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:54 | not-wired |  | G0.4, F2.2, F2.3 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:41 | not-wired |  | F1.1, F1.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:42 | not-wired |  | F1.1, F1.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:14 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:52 | not-wired |  | G0.2, F2.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:44 | not-wired |  | F4.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:43 | not-wired |  | F4.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:map:45 | not-wired |  | F4.2 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
| generic:special:6 | wired | browser_click | G0.3, F3.1 | Only GenericRequest special messageId 6 non-debugger click. |
| generic:special:75 | not-wired |  | F1.1 | No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate. |
