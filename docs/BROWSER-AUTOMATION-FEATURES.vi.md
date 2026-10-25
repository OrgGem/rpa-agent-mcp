# Đặc tả tính năng browser automation cho agent

Bản thiết kế ngày 2026-10-26. Mục tiêu là giữ nguyên extension UiPath đang cài, dùng native host và MCP riêng để agent thao tác trình duyệt qua các primitive có kết quả kiểm chứng được. Tên `browser_*` dưới đây là API đề xuất; chưa được đăng ký trong MCP server.

Khuyến nghị xây lớp primitive nhỏ trước: context, tab, quan sát trang, tìm phần tử, đọc trạng thái, click, type, check, select, scroll và wait. Các activity như For Each hoặc Check App State trở thành luồng ghép từ primitive. File picker, dialog, download, vision và semantic được khai báo thành capability riêng.

## Phạm vi và trạng thái

- Baseline đối chiếu có **168 tên activity phân biệt**: hợp của [index](https://docs.uipath.com/activities/other/latest/ui-automation/activities-index), [Modern](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-modern-activities), [Classic](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-classic-activities), [Semantic](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-semantic-activities), cộng hai helper Workflow được chọn là Wait for Download và Retry Scope. Đây là coverage của baseline nêu trên, không phải toàn bộ mọi package UiPath.
- **47 nhóm tính năng**, **53 tên tool đề xuất** chia theo P0/P1/P2. Mỗi activity có hàng đối chiếu trong [bảng mapping](BROWSER-ACTIVITY-MAPPING.vi.md). Tên khác nhau giữa Modern/Classic được giữ lại để tra cứu.
- Extension đang khảo sát là **23.10.1**, driver bridge ghim **23.4.55.39317**. Tài liệu vendor `latest` mô tả các activity mới hơn; một activity có trong docs không có nghĩa extension cũ hiểu được.
- Server hiện chỉ có `uipath_bridge_status`, `uipath_driver_versions`, `uipath_open_url`, `uipath_tab_info`. Bốn tool đã được kiểm tra lại trên fixture HTTP local ngày 2026-10-26, đọc đúng URL/title/complete trong [receipt mới](EXTENSION-LIVE-VERIFICATION.json). Click, type, DOM và các tool đề xuất chưa được xác minh live.
- Backend candidate trong tài liệu là hướng triển khai từ [catalog giao thức](UIPATH-EXTENSION-GUIDE.vi.md), chưa phải schema request hoàn chỉnh hoặc API công khai do UiPath cam kết.

## Nguyên tắc public MCP

Agent dùng `elementRef`, `tabRef`, locator và tham số có nghĩa nghiệp vụ. Adapter giữ `customId`, `codeVersion`, `flags`, `tokens`, `messageId` ở phía trong. Không public nguyên 88 entry của driver làm 88 tool.

`browser_find_element` tìm mới từ locator và yêu cầu đúng một mục tiêu. `browser_find_elements` trả collection có giới hạn. `browser_get_element` đọc lại ref có sẵn, với `fields` để lấy text, value, attributes, state hoặc rect. Có thể bổ sung alias `get_attribute`/`get_text` cho client cần schema đơn giản; chúng không cần là primitive độc lập.

Chỉ công bố tool đã triển khai và có capability phù hợp. Bảng đầy đủ là roadmap; P2 không tự xuất hiện cùng P0. Với action enum, capability phải chi tiết đến action, ví dụ `browser_window.maximize` khác `browser_window.minimize`.

| Giai đoạn | Nhóm | Tên tool đề xuất | Phạm vi |
|---|---:|---:|---|
| P0 | 14 | 21 | Chuỗi quan sát → định vị → thao tác → kiểm chứng |
| P1 | 19 | 19 | JS, extract/form, keys, debug, network, cookie và download |
| P2 | 14 | 13 | Gap protocol, native/vision/semantic và nền tảng chuyên biệt |

P0 là tập tính năng đích sau **gate G0**, không phải nhãn đã hỗ trợ. G0 phải xác minh live đường discovery, ref và một vòng đọc → input → đọc lại. `FindWebCtrlElements` là stub trong driver ghim; `GetHtmlElemById` không trả lời nhánh DOM thông thường. Candidate thay thế là `FindSelectors` → content 8; schema và live behavior vẫn chưa đạt G0.

Xem [kết quả đối chiếu extension](EXTENSION-CAPABILITY-VERIFICATION.vi.md) để biết route đúng, điều kiện screenshot, giới hạn JS và các finding đã được sửa trong plan. Chỉ chuyển một tính năng thành available sau khi adapter và live fixture đạt tiêu chí của tính năng đó.

## Danh mục tính năng

Mỗi nhóm có input/output riêng ở dưới; mọi tool còn tuân theo [hợp đồng chung](BROWSER-MCP-CONTRACTS.vi.md). Tên command là candidate trong mã, kể cả khi handler không tồn tại trực tiếp ở driver khác. Availability theo từng version nằm trong [JSON](browser-feature-spec.json).

## P0

### context

Chọn đúng kết nối Chrome, trả capability thực tế và tạo context cho chuỗi thao tác.

- Tool đề xuất: `browser_capabilities`, `browser_attach`.
- Activity: Use Application/Browser, Attach Browser, Set Runtime Browser.
- Input: connectionRef?; browser=chrome; match={urlPattern?,title?}; tabRef?; strict=true.
- Output: contextRef; connectionRef; tabRef; driverVersion; capabilities[]; unsupported[].
- Backend: `extension+bridge`; candidate: `Handshake`, `FindBrowserTabs`, `GetBrowserWindows`, `GetActiveTabId`.
- Nghiệm thu: Có hai tab cùng URL phải báo mơ hồ; capability phụ thuộc driver; không tự chuyển tab khi agent chưa chọn.
- Điều kiện: Prototype mới có một native-host context; nhiều profile/kết nối cần broker riêng. Attach không chứng minh khởi chạy được process/browser mới.
- Mức đối chiếu: `partial-existing-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### tabs

Liệt kê, mở, đọc, kích hoạt và đóng đúng tab.

- Tool đề xuất: `browser_tabs`, `browser_tab_open`, `browser_tab_get`, `browser_tab_activate`, `browser_tab_close`.
- Activity: Open Browser, Close Tab, Get URL.
- Input: contextRef; action trên tab rõ ràng; url cho open; match/cursor/limit cho list.
- Output: tabRef; url; title; readyState; windowRef; danh sách có phân trang.
- Backend: `extension+bridge`; candidate: `FindBrowserTabs`, `OpenTab`, `GetHtmlAttribute`, `GetActiveTabId`, `NavigationCommand`, `CloseBrowser`.
- Nghiệm thu: Open chỉ gửi một lần; giữ tabRef khi đọc metadata lỗi; close chỉ đóng tab chỉ định.
- Điều kiện: Open Browser được bao phủ phần mở trang trong Chrome đã kết nối. Khởi chạy process/profile mới là phần launch riêng; CloseBrowser trong bản khảo sát đóng tab, không đồng nghĩa kill Chrome.
- Mức đối chiếu: `partial-existing-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### navigate

Đi đến URL và điều khiển back, forward, reload; home dùng URL được cấu hình rõ.

- Tool đề xuất: `browser_navigate`, `browser_history`.
- Activity: Go to URL, Navigate To, Navigate Browser, Go Back, Go Forward, Refresh Browser, Go Home.
- Input: contextRef; tabRef; url hoặc action=back/forward/reload/home; waitUntil; timeoutMs.
- Output: tabRef; requestedUrl; finalUrl; readyState; documentGeneration; navigation evidence.
- Backend: `extension+bridge`; candidate: `Navigate`, `NavigationCommand`, `ReplaceTabAndNavigate`.
- Nghiệm thu: Redirect trả finalUrl; history không có mục không gây retry; điều hướng làm stale elementRef cũ.
- Điều kiện: Không hứa Go Home theo trang chủ trong Chrome. Tham số NavigationCommand cần xác minh adapter; gọi lặp có thể điều hướng hai lần.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### snapshot

Cho agent quan sát trang thành cây rút gọn và elementRef dùng được cho bước tiếp theo.

- Tool đề xuất: `browser_snapshot`.
- Activity: Export UI Tree.
- Input: contextRef; tabRef; frameRef?; rootRef?; depth; limit; includeHidden=false; cursor?.
- Output: url; title; documentGeneration; nodes[{elementRef,tag,role?,name?,text?,state}]; truncated; cursor.
- Backend: `composite`; candidate: `FindSelectors`, `GetHtmlAncestryInfo`, `GetHtmlAttribute`.
- Nghiệm thu: Giới hạn số node và chuỗi; node được trả phải dùng lại được; không bịa role/name khi backend không cung cấp.
- Điều kiện: Composite bị chặn bởi discovery/ref chưa kiểm chứng live. FindWebCtrlElements là stub trong driver đang ghim; không dùng làm backend. Cây DOM/role/name phải được xây và kiểm tra riêng.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### find

Tìm một hoặc nhiều phần tử; hỗ trợ root, quan hệ cha/con/ancestor/relative và anchor khi adapter cho phép.

- Tool đề xuất: `browser_find_element`, `browser_find_elements`.
- Activity: Find Element, Find Children, Find Elements, Element Scope, Anchor Base, Context Aware Anchor, Find Relative Element, Get Ancestor, Indicate On Screen.
- Input: contextRef; tabRef; frameRef?; rootRef?; locator; relation?; strict=true; timeoutMs; limit/cursor.
- Output: elementRef hoặc elements[]; matchCount; locator provenance; scope; documentGeneration.
- Backend: `source-route-awaiting-live-probe`; candidate: `FindSelectors`, `GetHtmlAncestryInfo`, `FindContainer`, `GetHtmlIndex`.
- Nghiệm thu: Zero match → NOT_FOUND; nhiều match với find một → AMBIGUOUS_TARGET; không tự lấy phần tử đầu.
- Điều kiện: FindSelectors → content command 8 có engine search trong source; partialRequests cần schema và live fixture. FindWebCtrlElements là stub; GetHtmlElemById chỉ xử lý nhánh tìm tab, không là DOM getter. Không quảng bá CSS/XPath/role hay traversal trước khi adapter kiểm chứng.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### element-read

Đọc trạng thái, text, value, attributes và hình chữ nhật từ elementRef.

- Tool đề xuất: `browser_get_element`.
- Activity: Get Attribute, Get Text, Get Full Text, Get Visible Text, Get Position, Check Element, Element Exists, Text Exists.
- Input: contextRef; elementRef; fields=[text,value,attributes,state,rect]; attributeNames?; textMode=dom/visible.
- Output: elementRef; fields được hỗ trợ; observedAt; rect={x,y,width,height,coordinateSpace,devicePixelRatio}.
- Backend: `extension+composite`; candidate: `GetHtmlAttribute`, `GetHtmlAttributesList`, `GetHtmlValueForElements`, `GenericRequest`, `GetHtmlRectangle`, `IsHtmlElemValid`, `IsHtmlElemVisible`, `IsHtmlElemDisabled`, `GetFocusedHtmlElement`.
- Nghiệm thu: Phân biệt attribute/property/value; checkbox checked khác enabled; rect phải ghi rõ đơn vị và gốc tọa độ.
- Điều kiện: GetHtmlValue không có direct entry ở driver 23.4; đọc value/text qua GenericRequest messageId=5 → content 18 hoặc helper batch. GetHtmlElemById không phải đọc elementRef. Metadata tab đã live-verified; DOM fields chưa. Check Element là enabled/disabled, Check/Uncheck là checked.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: 5.

### wait

Chờ điều kiện DOM hoặc tab với deadline; dùng cùng phép đọc cho kiểm tra trạng thái.

- Tool đề xuất: `browser_wait_for`.
- Activity: Check App State, Wait Attribute, Wait Element Vanish, On Element Appear, On Element Vanish.
- Input: contextRef; target=tabRef/locator/elementRef; condition; expected?; timeoutMs; pollIntervalMs.
- Output: matched; lastObserved; elapsedMs; evidence; error TIMEOUT nếu hết hạn.
- Backend: `composite`; candidate: `GetHtmlAttribute`, `IsHtmlElemValid`, `IsHtmlElemVisible`, `IsHtmlElemDisabled`, `GenericRequest`.
- Nghiệm thu: Ẩn khác bị xóa; SPA load complete vẫn phải đợi điều kiện nghiệp vụ; stale ref không bị hiểu là trang mới đã thỏa.
- Điều kiện: Polling composite; text/value dùng route đọc hợp lệ, không gọi direct GetHtmlValue. Điều kiện absent dùng locator; detached trên ref chỉ thành công khi node mất trong cùng document, không phải do navigation/disconnect. Branch do orchestrator thực hiện.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: 5.

### click

Click mục tiêu theo button, số lần và modifiers.

- Tool đề xuất: `browser_click`.
- Activity: Click, Double Click, Click Text, Double Click Text.
- Input: contextRef; elementRef ở P0; button=left/right/middle; clickCount=1/2; modifiers[]; verify?; visualTarget chỉ khi capability P2 được bật.
- Output: dispatchState; outcome; before/after evidence; verifiedPostcondition?.
- Backend: `extension-adapter`; candidate: `GenericRequest`.
- Nghiệm thu: Kiểm tra target hợp lệ/hiển thị trước click; che khuất, disabled và handler phát sinh navigation phải được kiểm chứng.
- Điều kiện: Driver 23.4: GenericRequest messageId=6 gọi special onClickHtmlElem; ClickHtmlElem không có direct entry. Flags/options khác version. Nhánh tọa độ/debugger phải kiểm chứng riêng; chưa có click thật qua bridge.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: 6.

### type

Nhập text dạng replace hoặc append, giữ thao tác Enter/submit tách biệt.

- Tool đề xuất: `browser_type`.
- Activity: Type Into, Type Secure Text.
- Input: contextRef; elementRef; text hoặc secretRef; mode=replace/append; inputMethod=auto; verify?.
- Output: dispatchState; valueMatch?; charsProcessed?; evidence đã che dữ liệu nhạy cảm.
- Backend: `extension-adapter`; candidate: `WriteTextHtmlElem`.
- Nghiệm thu: Native input, textarea, contenteditable và controlled input phải nhận event phù hợp; append không tự retry.
- Điều kiện: Source và probe cô lập xác nhận nhánh không dùng debugger nhận đúng một token có trường text: tokens=[{text:...}]. Options quan sát: PARSE_HOTKEYS=1, USE_DEBUGGER=2, APPEND=4. Chưa kiểm chứng live semantics replace/append/events; nhánh debugger/key tokens khác. Không đưa chuỗi text trực tiếp vào tokens.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### checked

Đặt checkbox/radio về trạng thái mong muốn thay vì toggle mù.

- Tool đề xuất: `browser_set_checked`.
- Activity: Check, Check/Uncheck.
- Input: contextRef; elementRef; checked:boolean; verify=true.
- Output: beforeChecked; afterChecked; changed; verified.
- Backend: `extension-adapter`; candidate: `CheckHtmlElem`, `GetHtmlAttribute`.
- Nghiệm thu: Đã đúng trạng thái thì không click; radio không cho bỏ chọn phải báo UNSUPPORTED_CAPABILITY thay vì giả thành công.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### select

Đọc/đặt lựa chọn của HTML select theo value hoặc label.

- Tool đề xuất: `browser_select_options`.
- Activity: Select Item, Select Multiple Items.
- Input: contextRef; elementRef; action=get/set; values[] hoặc labels[]; mode=replace/add/remove.
- Output: selected[{value,label}]; changed; verified.
- Backend: `extension-adapter`; candidate: `HtmlGetSelectedItems`, `HtmlSetSelectedItems`.
- Nghiệm thu: Single select không nhận nhiều giá trị; label trùng phải báo mơ hồ; custom dropdown dùng find/click riêng.
- Điều kiện: Nguồn Select Item giới hạn custom web dropdown. Không coi mọi combobox là native select.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### scroll

Cuộn trang/container hoặc đưa phần tử vào vùng nhìn.

- Tool đề xuất: `browser_scroll`.
- Activity: Mouse Scroll.
- Input: contextRef; tabRef hoặc elementRef; action=by/intoView; deltaX/deltaY; unit=cssPixel.
- Output: scrollPosition?; targetVisible?; evidence.
- Backend: `extension-adapter`; candidate: `BringElementIntoView`, `ScrollIntoView`, `MouseWheelDebugger`.
- Nghiệm thu: Nested scroll container cuộn đúng vùng; không lẫn screen-device pixel với CSS pixel.
- Điều kiện: Wheel qua debugger có điều kiện AttachDebugger; không tự gắn debugger như fallback chưa khai báo.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### focus

Đặt focus vào phần tử hoặc kích hoạt tab được chỉ định.

- Tool đề xuất: `browser_focus`.
- Activity: Set Focus, Activate.
- Input: contextRef; elementRef hoặc tabRef.
- Output: focusedElementRef?; activeTabRef?; verified.
- Backend: `extension-adapter`; candidate: `SetFocusedHtmlElement`, `GetFocusedHtmlElement`, `NavigationCommand`.
- Nghiệm thu: DOM focus và cửa sổ Chrome ở foreground là hai trạng thái riêng.
- Điều kiện: Foreground cửa sổ OS cần backend native nếu extension không cung cấp.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### screenshot

Chụp viewport hoặc phần tử, trả ảnh/artifact có kích thước và tọa độ rõ ràng.

- Tool đề xuất: `browser_screenshot`.
- Activity: Take Screenshot, Set Clipping Region.
- Input: contextRef; tabRef; elementRef?; clip?; format=png/jpeg; maxWidth?; destination?.
- Output: artifactRef/image content; width; height; mediaType; coordinateSpace; captureScope.
- Backend: `extension+artifact`; candidate: `TakeScreenshot`, `GetHtmlRectangle`, `GetHtmlDevicePixelRatio`.
- Nghiệm thu: Hai tab cùng window không được trả ảnh A gắn ref B; invalidate khi active tab/viewport thay đổi. Clip/DPR và ảnh >1 MiB phải được kiểm tra; không dùng mock làm bằng chứng capture thật.
- Điều kiện: VIEWPORT/ELEMENT/BOUNDS gọi captureVisibleTab(windowId), yêu cầu target tab active. P0 mặc định từ chối target inactive; activate chỉ khi caller yêu cầu, có điều phối theo window và kiểm tra identity. FULLPAGE dùng debugger riêng. maxWidth chỉ là postprocess sau nhận, không giảm native frame đầu vào; cần giới hạn nhận riêng và artifact trước khi public.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

## P1

### keys

Gửi key chord hoặc chuỗi key có thứ tự với keydown/keyup cân bằng.

- Tool đề xuất: `browser_press_keys`.
- Activity: Keyboard Shortcuts, Send Hotkey, Copy Selected Text.
- Input: contextRef; target; keys=[{key,modifiers?}]; inputMethod?.
- Output: dispatchState; verification?; unsupportedKeys[].
- Backend: `adapter-gap`; candidate: `WriteTextHtmlElem`.
- Nghiệm thu: Ctrl+A/Enter/Tab và modifiers được nhả khi lỗi; xác minh tác động trên trang.
- Điều kiện: Nhánh debugger có key-token parser; nhánh không debugger chỉ nhận một text token. Không lấy IgnoreNextKeystrokeEvent làm backend gửi phím; không coi SimulateEvent là trusted keyboard input. Key schema và keyup cleanup còn phải kiểm chứng.
- Mức đối chiếu: `protocol-semantics-unresolved`; generic messageIds: không chốt tuyến generic cho nhóm này.

### set-text

Đặt giá trị text theo semantics riêng cho control, đọc lại và báo event đã phát.

- Tool đề xuất: `browser_set_text`.
- Activity: Set Text.
- Input: contextRef; elementRef; text; emitEvents=[input,change]; verify=true.
- Output: beforeValue?; afterValue; emittedEvents; verified.
- Backend: `adapter-gap`; candidate: `WriteTextHtmlElem`, `InjectAndRunJs`.
- Nghiệm thu: React/Vue controlled input không bị revert; attribute value và live property được phân biệt.
- Điều kiện: Chọn adapter đặt live value và event rõ. SetHtmlAttribute(value) không tương đương; JS fallback dùng InjectAndRunJs, không dùng RunJS với mã tùy ý. Controlled-input behavior cần live fixture.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### set-attribute

Đổi DOM attribute và đọc lại kết quả.

- Tool đề xuất: `browser_set_attribute`.
- Activity: Set Web Attribute.
- Input: contextRef; elementRef; name; value:string hoặc null để xóa nếu adapter hỗ trợ.
- Output: attributeName; before; after; verified.
- Backend: `extension-adapter`; candidate: `SetHtmlAttribute`, `GetHtmlAttribute`.
- Nghiệm thu: Không nhầm checked/value attribute với state hiện hành; null/remove có capability riêng.
- Điều kiện: Không quảng bá như cơ chế nhập liệu thay thế.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### hover

Đưa con trỏ/hover vào mục tiêu và chờ tooltip/menu nếu yêu cầu.

- Tool đề xuất: `browser_hover`.
- Activity: Hover, Hover Text, Tooltip.
- Input: contextRef; elementRef hoặc visualTarget khi capability tương ứng có; position?; verify?.
- Output: dispatchState; inputMethod; observedState?.
- Backend: `adapter-gap`; candidate: `SimulateEvent`, `GenericRequest`.
- Nghiệm thu: CSS :hover và mouseover listener phải được kiểm chứng riêng.
- Điều kiện: SimulateEvent chỉ là candidate phát DOM event; chưa xác nhận pointer movement/CSS :hover. visualTarget là API P2 deferred, cần backend tọa độ; không hứa từ tên GenericRequest.
- Mức đối chiếu: `protocol-semantics-unresolved`; generic messageIds: không chốt tuyến generic cho nhóm này.

### frames

Liệt kê/chọn frame và khai báo khả năng xuyên iframe hoặc shadow root.

- Tool đề xuất: `browser_frames`, `browser_frame_attach`.
- Activity: Tiện ích agent bổ sung; không có activity một đối một trong baseline.
- Input: contextRef; tabRef; frameLocator/frameRef?; rootRef?; strict=true.
- Output: frames[{frameRef,parentRef,url,accessible}]; selected frameRef; shadow capability.
- Backend: `source-internal-routing-public-api-gap`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Nested/cross-origin iframe phải có scope riêng; frame reload làm stale ref; closed shadow root trả unsupported khi không truy cập được.
- Điều kiện: Source có SplitCustomIdWithFrame và FindSelectors cross-origin routing; chưa có public frame enumeration/schema đã live-verified. Không hứa xuyên mọi iframe/closed shadow root.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### selection

Đọc/đặt vùng text selection cho trường nhập hoặc nội dung được hỗ trợ.

- Tool đề xuất: `browser_text_selection`.
- Activity: Tiện ích agent bổ sung; không có activity một đối một trong baseline.
- Input: contextRef; elementRef; action=get/set; start?; end?; direction?.
- Output: range; selectedText?; verified.
- Backend: `extension-adapter`; candidate: `GetSelectedRange`, `SetSelectedRange`.
- Nghiệm thu: Unicode, textarea và contenteditable có mapping offset rõ; không làm hỏng surrogate pair.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### highlight

Đánh dấu mục tiêu để debug rồi tự thu hồi.

- Tool đề xuất: `browser_highlight`.
- Activity: Highlight.
- Input: contextRef; elementRef; durationMs; style?.
- Output: highlightRef; expiresAt; applied.
- Backend: `extension-adapter`; candidate: `StartHighlight`, `StopHighlight`.
- Nghiệm thu: Overlay không chặn input; cleanup khi navigation/timeout.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### script

Chạy hàm JavaScript trên target/document trong world được khai báo.

- Tool đề xuất: `browser_evaluate`.
- Activity: Inject Js Script.
- Input: contextRef; tabRef; elementRef?; script; input:JSON; world=isolated/page; timeoutMs.
- Output: result:JSON; executionWorld; durationMs; scriptError?.
- Backend: `extension-adapter`; candidate: `InjectAndRunJs`.
- Nghiệm thu: Promise, exception, JSON nonserializable và timeout được xử lý; không trả toàn bộ DOM object.
- Điều kiện: InjectAndRunJs nhận jsCode/input/executionWorld. RunJS chỉ gọi CallableScripts[scriptName] đã đăng ký. Cả retCode và isScriptErr phải được kiểm tra; retCode=1 vẫn có thể là lỗi script. World/debugger/Promise còn cần live validation; JSON serialization là lớp bridge.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### extract

Trích xuất bảng có schema cột và phân trang được kiểm soát.

- Tool đề xuất: `browser_extract_table`.
- Activity: Extract Table Data, Extract Structured Data.
- Input: contextRef; rootRef/locator; columns[]; maxRows; cursor?; pagination={enabled:false,maxPages?}.
- Output: columns; rows; sourceRefs?; nextCursor; truncated; pagesVisited.
- Backend: `extension+composite`; candidate: `ExtractData`, `ExtractMetadata`, `GetHtmlValueForElements`, `GetAttributeForElements`.
- Nghiệm thu: Header lặp, ô trống và virtualized rows được phân biệt; bật pagination mới được click Next.
- Điều kiện: Schema ExtractData/Metadata cần decode. Trích xuất không tự đồng nghĩa OCR hoặc PDF parsing.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### table-cell

Trả ref ô theo cột và điều kiện hàng, để dùng tiếp click/type.

- Tool đề xuất: `browser_table_cell`.
- Activity: Table Cell Scope.
- Input: contextRef; tableRef; column=key/label; row={index/filter/firstEmpty}; strict=true.
- Output: cellRef; rowIndex; columnKey; matchedRows.
- Backend: `composite+sap-conditional`; candidate: `FindSelectors`, `GetHtmlAttribute`, `GetSapFioriAllColLabels`.
- Nghiệm thu: Index 0-based ghi rõ; label trùng báo mơ hồ; virtualized row không được coi đã tải đủ.
- Điều kiện: Web composite có điều kiện SAP; GetHtmlCollectionById không có direct entry trong driver ghim. Discovery dựa trên FindSelectors còn chờ live validation; không suy đầy đủ SAP parity từ helper label.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### tree

Đọc/expand đường dẫn cây web mà driver nhận diện được.

- Tool đề xuất: `browser_tree`.
- Activity: Expand Tree.
- Input: contextRef; rootRef; action=paths/path/expand; path?; maxNodes.
- Output: paths; nodeRef?; expanded; truncated.
- Backend: `extension-adapter`; candidate: `TreeGetNodePath`, `TreeGetAllPaths`, `TreeExpandPath`.
- Nghiệm thu: Lazy loaded tree có giới hạn; label trùng dùng key ổn định.
- Điều kiện: Không thay SAP ALV engine; Expand Tree của UiPath là SAP activity có giới hạn nền tảng.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### form-read

Đọc form thành trường có ref, nhãn, value và state.

- Tool đề xuất: `browser_form_read`.
- Activity: Extract Form Data.
- Input: contextRef; rootRef; fields?; maxFields; includeSensitive=false.
- Output: fields[{fieldKey,elementRef,label,type,value?,state}]; unresolved[].
- Backend: `composite`; candidate: `FindSelectors`, `GetHtmlValueForElements`, `GetAttributeForElements`.
- Nghiệm thu: Label gắn đúng input; password bị che; không tự suy giá trị hidden.
- Điều kiện: Composite chỉ được bật sau discovery/read primitives; không có semantic AI engine UiPath được cung cấp bởi bridge.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### form-fill

Lập preview ánh xạ field rồi điền các trường được chỉ định, không tự submit.

- Tool đề xuất: `browser_form_fill`.
- Activity: Fill Form.
- Input: contextRef; rootRef; values; mode=preview/apply; bindings?; verify=true.
- Output: plan; completed[]; failed[]; skipped[]; partial; evidence.
- Backend: `composite`; candidate: `FindSelectors`, `WriteTextHtmlElem`, `CheckHtmlElem`, `HtmlSetSelectedItems`.
- Nghiệm thu: Không click submit; trùng label phải dừng field đó; lỗi giữa chừng trả partial và không rollback giả.
- Điều kiện: Ghép primitives đã live-verified; preview phải giữ binding/ref và kiểm tra lại trước apply. Trả partial khi lỗi; không submit hay hứa atomic.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### popup

Phân loại và đóng DOM overlay theo nút đã định vị.

- Tool đề xuất: `browser_close_popup`.
- Activity: Close Popup.
- Input: contextRef; rootRef/locator; closeButtonRef?; verify=true.
- Output: kind=domOverlay; actionRef; closed; evidence.
- Backend: `composite`; candidate: `FindSelectors`, `GenericRequest`.
- Nghiệm thu: Không tự đóng tab hay accept alert khi target là DOM overlay.
- Điều kiện: DOM-overlay composite qua find và click messageId=6. JS dialog/new-tab/OS dialog có cơ chế riêng; chưa có semantic Close Popup parity.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: 6.

### network

Theo dõi request trong scope và chờ khoảng yên lặng có giới hạn.

- Tool đề xuất: `browser_network_wait`.
- Activity: Tiện ích agent bổ sung; không có activity một đối một trong baseline.
- Input: contextRef; tabRef; action=arm/wait/stop; watchRef?; quietMs; timeoutMs; filters?.
- Output: watchRef; pending?; quietForMs; endedReason.
- Backend: `extension-adapter`; candidate: `StartWebRequestMonitoring`, `AnyWebRequestsInFlight`, `StopWebRequestMonitoring`.
- Nghiệm thu: Arm trước thao tác gây mạng; long-poll không làm treo vô hạn; stop cleanup.
- Điều kiện: Source có monitor theo tabId, nhưng URL filter hiện hardcode <all_urls>. API filters chỉ là đề xuất, không passthrough sẵn. Network idle không chứng minh app ready; cần ref-count ownership cho watcher cùng tab và cleanup.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### new-tab

Arm danh sách tab trước trigger rồi chờ tab/window mới khớp điều kiện.

- Tool đề xuất: `browser_wait_new_tab`.
- Activity: Tiện ích agent bổ sung; không có activity một đối một trong baseline.
- Input: contextRef; action=arm/wait/cancel; watchRef?; openerTabRef?; urlPattern?; timeoutMs.
- Output: watchRef; newTabRef; windowRef; correlation.
- Backend: `composite`; candidate: `FindBrowserTabs`, `GetBrowserWindows`.
- Nghiệm thu: Không chọn tab mới do tác vụ khác tạo; nhiều tab khớp báo mơ hồ.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### downloads

Theo dõi download với mốc bắt đầu và correlation trước thao tác kích hoạt.

- Tool đề xuất: `browser_download`.
- Activity: Wait for Download.
- Input: contextRef; action=arm/wait/cancel; directory; filenamePattern?; watchRef?; timeoutMs.
- Output: downloadRef; artifactRef/path; size; completedAt; correlation; completionEvidence.
- Backend: `filesystem+optional-browser-backend`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Không chọn file cũ hoặc .crdownload; song song phải phân biệt; completion không chỉ là file đã xuất hiện.
- Điều kiện: Wait for Download thuộc UiPath.System.Activities. Extension hiện chưa có lệnh tải xuống tương ứng được xác nhận; folder watch là backend riêng, có giới hạn correlation.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### cookies

Xuất/nhập session cookies trong scope công khai.

- Tool đề xuất: `browser_cookies`.
- Activity: Get Browser Data, Set Browser Data.
- Input: contextRef; action=export/import; domainFilter; artifactRef?; overwritePolicy?.
- Output: artifactRef; cookieCount; domains; perItemResults; applied.
- Backend: `extension-adapter`; candidate: `GetBrowserData`, `SetBrowserData`, `SetBigString`, `GetBigString`, `AppendBigString`, `DeleteBigString`.
- Nghiệm thu: Không trả cookie thô vào transcript mặc định; phân biệt domain/path/expiry; cleanup big-string.
- Điều kiện: Mã driver khảo sát xử lý cookies. Không hứa localStorage/sessionStorage hay đọc profile offline theo toàn bộ activity UiPath.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### orchestration

Lặp, branch, retry có deadline và điều kiện hậu kiểm ở agent/CLI.

- Tool đề xuất: orchestrator / adapter riêng.
- Activity: For Each UI Element, Retry Scope.
- Input: bounded element list; condition; maxIterations; deadline; retry policy.
- Output: perStepResults; elapsed; partial; stopReason.
- Backend: `agent-orchestrator`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Không retry mù click/type/navigation; loop có giới hạn và xử lý element stale.
- Điều kiện: Không cần mỗi control-flow activity thành một MCP tool. Retry Scope thuộc Workflow/System, dùng để thiết kế orchestration.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

## P2

### drag

Kéo từ source sang target với hành vi HTML5 hoặc pointer được chỉ rõ.

- Tool đề xuất: `browser_drag_and_drop`.
- Activity: Drag and Drop.
- Input: contextRef; sourceRef; targetRef; mode=html5/pointer; path?; verify?.
- Output: inputMethod; dispatchState; drop evidence; verified.
- Backend: `adapter-gap`; candidate: `SimulateEvent`, `GenericRequest`.
- Nghiệm thu: HTML5 dataTransfer và pointer-based sortable được kiểm chứng độc lập; không chỉ phát drop rồi báo thành công.
- Điều kiện: Không có raw DragDrop đã xác nhận. API visualTarget cho endpoint tọa độ chỉ bật cùng backend input và viewport validation; sourceRef/targetRef DOM không tự bao phủ canvas/vision.
- Mức đối chiếu: `protocol-semantics-unresolved`; generic messageIds: không chốt tuyến generic cho nhóm này.

### calendar

Chọn ngày/range/week trên widget web bằng thao tác có xác minh.

- Tool đề xuất: `browser_calendar_select`.
- Activity: Select Dates in Calendar.
- Input: contextRef; rootRef; mode=date/range/week; ISO date(s); locale; timezone?.
- Output: selectedDates; normalizedValue; evidence.
- Backend: `composite+sap-conditional`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Tháng/năm, locale và timezone không bị đảo; phải quan sát đúng widget.
- Điều kiện: UiPath activity này dành cho SAP Fiori. Generic datepicker workflow là analogue, không phải triển khai protocol SAP activity.
- Mức đối chiếu: `composite-awaiting-primitives`; generic messageIds: không chốt tuyến generic cho nhóm này.

### semantic

Tìm/trích xuất theo mô tả từ snapshot hoặc provider AI tùy chọn.

- Tool đề xuất: `browser_semantic_query`.
- Activity: Extract UI Data (preview), Update UI Element (former Set Value).
- Input: contextRef; instruction; schema?; mode=read/plan; maxResults.
- Output: candidates hoặc structuredData; sourceRefs; uncertainty; proposedActions?.
- Backend: `optional-semantic-provider`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Mỗi giá trị có nguồn; hành động cập nhật phải qua plan/ref cụ thể và tool ghi phù hợp.
- Điều kiện: Không có engine semantic UiPath trong extension cũ. Agent có thể tự suy luận từ snapshot; không cần ép có thêm LLM phía server.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### events

Subscribe/poll/unsubscribe sự kiện trong tab, có TTL và hàng đợi.

- Tool đề xuất: `browser_events`.
- Activity: Application Event Trigger, Click Event Trigger, Keypress Event Trigger, Click Trigger, Key Press Trigger, Element Attribute Change Trigger, Element State Change Trigger, Monitor Events, Get Event Info, Get Source Element, Replay User Event.
- Input: contextRef; action=subscribe/poll/unsubscribe; types[]; subscriptionRef?; cursor?; ttlMs.
- Output: subscriptionRef; events[{eventId,type,elementRef?,timestamp,payload}]; cursor; droppedCount.
- Backend: `adapter-gap+broker`; candidate: `MonitorNativeEvents`, `GetFocusedHtmlElement`.
- Nghiệm thu: Tab đóng phải kết thúc stream; giới hạn queue; source ref có generation; replay là thao tác ghi riêng.
- Điều kiện: Không suy từ MonitorNativeEvents thành mọi trigger/hotkey OS. Hỗ trợ push MCP tùy client; polling là phương án portable. Replay chưa có endpoint riêng trong thiết kế P0.
- Mức đối chiếu: `protocol-semantics-unresolved`; generic messageIds: không chốt tuyến generic cho nhóm này.

### dialog

Chuẩn bị listener rồi nhận/respond alert, confirm hoặc prompt.

- Tool đề xuất: `browser_dialog`.
- Activity: Browser Dialog Scope.
- Input: contextRef; tabRef; action=arm/wait/respond/cancel; watchRef?; responsePolicy={accept/dismiss,promptText?,expectedType?,messageMatch?}; timeoutMs.
- Output: watchRef; dialogRef; type; message; handled; response.
- Backend: `external-backend-required`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Alert/confirm/prompt phát sinh đồng bộ trong click handler không deadlock; wrong type/message không auto-accept; TTL cleanup và trạng thái unknown rõ.
- Điều kiện: Chưa có raw endpoint JS dialog được xác minh. Arm phải đăng ký response policy có điều kiện trước trigger; chỉ listener là chưa đủ. Manual respond bị deferred đến khi có trigger bất đồng bộ và control path không bị queue ghi chặn.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### file-picker

Chuẩn bị thao tác chọn file upload/download theo khả năng backend.

- Tool đề xuất: `browser_file_picker`.
- Activity: Browser File Picker Scope.
- Input: contextRef; action=arm/wait/provide/cancel; watchRef?; paths[]?; mode; timeoutMs.
- Output: pickerRef; selectedCount; result; supportedPickerType.
- Backend: `external-backend-required`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Arm trước click; nhiều file và cancel rõ; chỉ báo thành công khi input/ứng dụng xác nhận nhận file.
- Điều kiện: UiPath Browser File Picker Scope thuộc UIA 25.10.7+, không suy hỗ trợ từ extension 23.10.1; docs nêu showOpenFilePicker không hỗ trợ. Không giả upload bằng gán input.value.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### window

Đọc và đổi trạng thái cửa sổ Chrome khi backend hỗ trợ.

- Tool đề xuất: `browser_window`.
- Activity: Window Operation, Maximize Window, Minimize Window, Restore Window, Move Window, Hide Window, Show Window, Use Foreground, Get Active Window, Attach Window, Close Window.
- Input: contextRef; windowRef; action=get/maximize/minimize/restore/move/resize/foreground/close.
- Output: windowRef; bounds; state; applied; backend.
- Backend: `extension-partial+native-optional`; candidate: `MaximizeWindow`, `GetBrowserWindows`, `GetWindowIdForTabId`, `NavigationCommand`.
- Nghiệm thu: Không nhầm tab/window/OS-process; action ngoài capability phải từ chối trước dispatch.
- Điều kiện: Maximize có direct entry; NavigationCommand activate + activateWindow có source path focus cửa sổ. Minimize/move/resize/restore chưa xác nhận route. Link Window Operation cũ không dùng làm schema.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### launch

Khởi chạy/đóng process Chrome hoặc profile được quản lý.

- Tool đề xuất: `browser_launch`.
- Activity: Open Application, Close Application, Start Process.
- Input: browserExecutable/profileRef; launchOptions; processRef?; gracefulClose=true.
- Output: processRef; connectionRef; ownership; connected.
- Backend: `native-optional`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Không đóng process dùng chung; launch không ghi đè profile đang dùng.
- Điều kiện: Chỉ nhận process trình duyệt trong phạm vi browser. Chạy ứng dụng bất kỳ là ngoài scope.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### clipboard

Đọc/ghi clipboard hệ điều hành khi workflow thật sự cần.

- Tool đề xuất: `system_clipboard`.
- Activity: Get Clipboard, Get From Clipboard, Set Clipboard, Set To Clipboard.
- Input: action=read/write; format=text; text?; timeoutMs.
- Output: text hoặc written; format; observedAt.
- Backend: `native-optional`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Phân biệt clipboard OS và navigator.clipboard bị permission/user-gesture hạn chế.
- Điều kiện: Là nhóm system tùy chọn, không thuộc extension DOM cơ bản.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### image-files

Đọc/lưu ảnh artifact để dùng cho screenshot/vision.

- Tool đề xuất: `browser_image_artifact`.
- Activity: Save Image, Load Image.
- Input: action=load/save; artifactRef/path; format?; destination?.
- Output: artifactRef; path?; mediaType; width; height.
- Backend: `artifact-filesystem`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Định dạng và nơi lưu rõ; ghi file không được coi là tương tác DOM.
- Điều kiện: Save Image Modern lưu Image variable xuống đĩa. Tải ảnh gốc từ URL là tính năng asset-download riêng, không đánh đồng với activity này.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### visual

OCR và định vị ảnh từ screenshot; hành động tiếp theo dùng tọa độ/ref có provenance.

- Tool đề xuất: `browser_visual_find`, `browser_ocr`.
- Activity: Click Image, Double Click Image, Click OCR Text, Double Click OCR Text, Hover Image, Hover OCR Text, Find Image, Find Image Matches, Find OCR Text Position, Find Text Position, Image Exists, OCR Text Exists, Get OCR Text, On Image Appear, On Image Vanish, Wait Image Vanish, Click Image Trigger, Google Cloud Vision OCR, Microsoft Azure Computer Vision OCR, Microsoft OCR, Microsoft Project Oxford Online OCR, Tesseract OCR, CV Check, CV Click, CV Dropdown Select, CV Element Exists, CV Extract Table, CV Get Text, CV Highlight, CV Hover, CV Refresh, CV Screen Scope, CV Type Into, Set CV Server.
- Input: contextRef; imageArtifactRef/tabRef; query/template; region; providerRef; confidenceThreshold.
- Output: matches[{text?,rect,confidence}]; coordinateSpace; sourceScreenshot; provider.
- Backend: `vision-provider-required`; candidate: `TakeScreenshot`.
- Nghiệm thu: DPR/zoom/viewport khớp; kết quả yếu hoặc nhiều match không tự click; screenshot cũ không dùng sau layout change.
- Điều kiện: P2 read/find/OCR cần provider riêng. Click/hover/drag từ ảnh chỉ được bật khi action hỗ trợ visualTarget (screenshotRef, point, coordinateSpace, viewportGeneration) cùng input backend đã kiểm chứng. Hiện các visual action là deferred; không chuyển rect thành DOM elementRef giả.
- Mức đối chiếu: `source-route-awaiting-live`; generic messageIds: không chốt tuyến generic cho nhóm này.

### accessibility

Audit trang bằng engine kiểm tra accessibility riêng.

- Tool đề xuất: `browser_accessibility_audit`.
- Activity: Accessibility Check.
- Input: contextRef; tabRef; standard/ruleset; scope?.
- Output: violations; ruleIds; targetRefs; engineVersion; limitations.
- Backend: `audit-engine-required`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Vi phạm có rule và element nguồn; ghi rõ automated checks không thay toàn bộ kiểm tra thủ công.
- Điều kiện: DOM snapshot không tự tương đương Accessibility Check; cần engine và hợp đồng kết quả riêng.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### sap

Giữ SAP activity trong coverage để đánh giá backend theo SAP Fiori/WebGUI/WinGUI.

- Tool đề xuất: orchestrator / adapter riêng.
- Activity: Call Transaction, Click Picture on Screen, Click Toolbar Button, Expand ALV Hierarchical Table, Expand ALV Tree, Read Status Bar, SAP Login, SAP Logon, SAP Session Attributes Change Trigger, Select Menu Item.
- Input: platform; control type; supported adapter; operation.
- Output: support decision; explicit unsupported reason.
- Backend: `sap-specific-conditional`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Đối chiếu ma trận SAP theo từng activity và nền tảng; generic click/get text không được tính là parity SAP activity.
- Điều kiện: Chưa đề xuất public tool SAP chuyên dụng. Website SAP vẫn có thể dùng generic browser tools nếu control và adapter cho phép.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

### desktop-out

Ghi nhận activity desktop, Studio config, người dùng và OS event để không bỏ sót baseline.

- Tool đề xuất: orchestrator / adapter riêng.
- Activity: Block User Input, Unblock User Input, Callout, Get Password, Hotkey Trigger, Inject .NET Code, Invoke ActiveX Method, Mouse Trigger, System Trigger, Set Project Setting, Hide Status Window, Show Status Message, Show Status Window.
- Input: N/A trong browser-only API.
- Output: OUT_OF_SCOPE hoặc optional native integration.
- Backend: `outside-browser-core`; candidate: chưa xác định command phù hợp.
- Nghiệm thu: Capability browser không công bố các chức năng này khi chưa có backend riêng.
- Điều kiện: Block input/global trigger là OS scope; status/callout là giao diện workflow; Get Password không đồng nghĩa đọc password trong DOM; .NET/ActiveX không là JS browser.
- Mức đối chiếu: `backend-unresolved-or-outside-core`; generic messageIds: không chốt tuyến generic cho nhóm này.

## Các khác biệt cần giữ trong thiết kế

Click đơn, double click và right click dùng cùng tool với options. Type Into, Set Text và Set Web Attribute có semantics khác nhau; cần hợp đồng event và đọc lại state. [Check Element](https://docs.uipath.com/activities/other/latest/ui-automation/n-check-element) kiểm tra enabled/disabled, còn [Check/Uncheck](https://docs.uipath.com/activities/other/latest/ui-automation/n-check) đặt checked. [Select Item](https://docs.uipath.com/activities/other/latest/ui-automation/n-select-item) không tự xử lý mọi custom dropdown.

[Inject JS Script](https://docs.uipath.com/activities/other/latest/ui-automation/n-inject-js-script) có world và hợp đồng input/output riêng; bridge cần serialize JSON một cách tường minh. Không tự dùng script để thay thế toàn bộ click/type khi semantics khác nhau.

[Browser Dialog Scope](https://docs.uipath.com/activities/other/latest/ui-automation/n-browser-dialog-scope) và [Browser File Picker Scope](https://docs.uipath.com/activities/other/latest/ui-automation/n-browser-file-picker-scope) cần arm trước trigger. [Hướng dẫn browser](https://docs.uipath.com/activities/other/latest/ui-automation/how-to-guide) nêu File Picker ở UIA 25.10.7 trở lên; không suy khả năng từ bản extension 23.10.1. [Wait for Download](https://docs.uipath.com/activities/other/latest/workflow/get-last-downloaded-file) thuộc System Activities, cần correlation và completion ở backend filesystem/browser.

[Get Browser Data](https://docs.uipath.com/activities/other/latest/ui-automation/n-get-browser-data) và [Set Browser Data](https://docs.uipath.com/activities/other/latest/ui-automation/n-set-browser-data) có phạm vi rộng hơn candidate live-cookie hiện khảo sát. Không mở rộng ngầm thành mọi loại storage hay profile offline. [Save Image](https://docs.uipath.com/activities/other/latest/ui-automation/n-save-image) lưu biến ảnh; lấy ảnh gốc từ URL là tính năng riêng.

Nhóm [Semantic](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-semantic-activities), CV/OCR và [SAP](https://docs.uipath.com/activities/other/latest/ui-automation/sap-activities-compatibility-matrix) cần engine hoặc platform tương ứng. Có thể tạo composite đạt cùng mục đích trên một website mà vẫn chưa đạt parity toàn activity.

## Thứ tự triển khai đề xuất

1. Gate G0: giải mã FindSelectors.partialRequests và customId/frame, thử live trên fixture một vòng find → read → input → readback. Hai handler direct cũ không dùng cho DOM discovery. Chốt error, deadline và lifecycle ref từ bằng chứng này.
2. Hoàn tất vòng P0 find → read → click/type/check/select → wait → screenshot; dùng điều kiện sau thao tác làm bằng chứng.
3. Bổ sung P1 theo nhu cầu workflow: keys và extract trước, JS có contract riêng, sau đó form/cookie/download có scope rõ.
4. Chỉ bổ sung dialog/file picker/hover/drag/vision khi đã xác định backend và kiểm chứng semantics; capability thiếu trả lỗi có nghĩa, không fallback âm thầm.

Chốt phạm vi tương thích đầu tiên ở Windows + Chrome + extension 23.10.1 + driver 23.4.55.39317. Linux, Edge, Firefox và phiên bản extension khác cần ma trận riêng; tài liệu này chưa cam kết hỗ trợ chúng.
