import json, hashlib, re, runpy
from pathlib import Path
from collections import Counter

ROOT = Path('.')
OUT = ROOT / 'docs'
RESEARCH = Path('work/browser-activity-research')
BASE = 'https://docs.uipath.com/activities/other/latest/ui-automation/'
DATE = '2026-10-26'
BASELINE_DATE = '2026-10-25'
catalog = json.loads((OUT/'uipath-function-catalog.json').read_text(encoding='utf8'))
commands = {x['name']: x for x in catalog['functions']}
features = []

def feature(key, phase, tools, acts, raw, backend, purpose, inputs, outputs, acceptance, caveat=''):
    features.append(dict(id=key, phase=phase, proposedTools=tools.split(), activities=acts.split('|') if acts else [],
        candidateCommands=raw.split() if raw else [], backend=backend, purpose=purpose,
        inputs=inputs, outputs=outputs, acceptance=acceptance, limitation=caveat,
        implementationStatus='proposed', runtimeVerified=False))

# Public tools below are a design, not tools registered by the current server.
feature('context','P0','browser_capabilities browser_attach',
    'Use Application/Browser|Attach Browser|Set Runtime Browser',
    'Handshake FindBrowserTabs GetBrowserWindows GetActiveTabId', 'extension+bridge',
    'Chọn đúng kết nối Chrome, trả capability thực tế và tạo context cho chuỗi thao tác.',
    'connectionRef?; browser=chrome; match={urlPattern?,title?}; tabRef?; strict=true',
    'contextRef; connectionRef; tabRef; driverVersion; capabilities[]; unsupported[]',
    'Có hai tab cùng URL phải báo mơ hồ; capability phụ thuộc driver; không tự chuyển tab khi agent chưa chọn.',
    'Prototype mới có một native-host context; nhiều profile/kết nối cần broker riêng. Attach không chứng minh khởi chạy được process/browser mới.')
feature('tabs','P0','browser_tabs browser_tab_open browser_tab_get browser_tab_activate browser_tab_close',
    'Open Browser|Close Tab|Get URL',
    'FindBrowserTabs OpenTab GetHtmlAttribute GetActiveTabId NavigationCommand CloseBrowser', 'extension+bridge',
    'Liệt kê, mở, đọc, kích hoạt và đóng đúng tab.',
    'contextRef; action trên tab rõ ràng; url cho open; match/cursor/limit cho list',
    'tabRef; url; title; readyState; windowRef; danh sách có phân trang',
    'Open chỉ gửi một lần; giữ tabRef khi đọc metadata lỗi; close chỉ đóng tab chỉ định.',
    'Open Browser được bao phủ phần mở trang trong Chrome đã kết nối. Khởi chạy process/profile mới là phần launch riêng; CloseBrowser trong bản khảo sát đóng tab, không đồng nghĩa kill Chrome.')
feature('navigate','P0','browser_navigate browser_history',
    'Go to URL|Navigate To|Navigate Browser|Go Back|Go Forward|Refresh Browser|Go Home',
    'Navigate NavigationCommand ReplaceTabAndNavigate', 'extension+bridge',
    'Đi đến URL và điều khiển back, forward, reload; home dùng URL được cấu hình rõ.',
    'contextRef; tabRef; url hoặc action=back/forward/reload/home; waitUntil; timeoutMs',
    'tabRef; requestedUrl; finalUrl; readyState; documentGeneration; navigation evidence',
    'Redirect trả finalUrl; history không có mục không gây retry; điều hướng làm stale elementRef cũ.',
    'Không hứa Go Home theo trang chủ trong Chrome. Tham số NavigationCommand cần xác minh adapter; gọi lặp có thể điều hướng hai lần.')
feature('snapshot','P0','browser_snapshot',
    'Export UI Tree',
    'FindWebCtrlElements GetHtmlAncestryInfo GetHtmlAttribute', 'composite',
    'Cho agent quan sát trang thành cây rút gọn và elementRef dùng được cho bước tiếp theo.',
    'contextRef; tabRef; frameRef?; rootRef?; depth; limit; includeHidden=false; cursor?',
    'url; title; documentGeneration; nodes[{elementRef,tag,role?,name?,text?,state}]; truncated; cursor',
    'Giới hạn số node và chuỗi; node được trả phải dùng lại được; không bịa role/name khi backend không cung cấp.',
    'Snapshot là tiện ích bridge đề xuất. Chưa có triển khai cây accessibility hoàn chỉnh; cần phân biệt DOM tree và accessibility tree.')
feature('find','P0','browser_find_element browser_find_elements',
    'Find Element|Find Children|Find Elements|Element Scope|Anchor Base|Context Aware Anchor|Find Relative Element|Get Ancestor|Indicate On Screen',
    'FindWebCtrlElements GetHtmlElemById GetHtmlCollectionById GetHtmlAncestryInfo FindContainer FindSelectors', 'extension+composite',
    'Tìm một hoặc nhiều phần tử; hỗ trợ root, quan hệ cha/con/ancestor/relative và anchor khi adapter cho phép.',
    'contextRef; tabRef; frameRef?; rootRef?; locator; relation?; strict=true; timeoutMs; limit/cursor',
    'elementRef hoặc elements[]; matchCount; locator provenance; scope; documentGeneration',
    'Zero match → NOT_FOUND; nhiều match với find một → AMBIGUOUS_TARGET; không tự lấy phần tử đầu.',
    'Find mới phân giải locator. Get dùng ref có sẵn. CSS/XPath/role/fuzzy và picking bằng GUI là các capability riêng, chưa được chứng minh bằng tên FindWebCtrlElements.')
feature('element-read','P0','browser_get_element',
    'Get Attribute|Get Text|Get Full Text|Get Visible Text|Get Position|Check Element|Element Exists|Text Exists',
    'GetHtmlElemById GetHtmlAttribute GetHtmlAttributesList GetHtmlValue GetHtmlRectangle IsHtmlElemValid IsHtmlElemVisible IsHtmlElemDisabled GetFocusedHtmlElement', 'extension+composite',
    'Đọc trạng thái, text, value, attributes và hình chữ nhật từ elementRef.',
    'contextRef; elementRef; fields=[text,value,attributes,state,rect]; attributeNames?; textMode=dom/visible',
    'elementRef; fields được hỗ trợ; observedAt; rect={x,y,width,height,coordinateSpace,devicePixelRatio}',
    'Phân biệt attribute/property/value; checkbox checked khác enabled; rect phải ghi rõ đơn vị và gốc tọa độ.',
    'Check Element của UiPath kiểm tra enabled/disabled; Check/Uncheck mới đổi checked. FullText/VisibleText ở đây là phương thức web đã định nghĩa, không thay toàn bộ engine native/OCR của UiPath.')
feature('wait','P0','browser_wait_for',
    'Check App State|Wait Attribute|Wait Element Vanish|On Element Appear|On Element Vanish',
    'GetHtmlAttribute IsHtmlElemValid IsHtmlElemVisible IsHtmlElemDisabled GetHtmlValue', 'composite',
    'Chờ điều kiện DOM hoặc tab với deadline; dùng cùng phép đọc cho kiểm tra trạng thái.',
    'contextRef; target=tabRef/locator/elementRef; condition; expected?; timeoutMs; pollIntervalMs',
    'matched; lastObserved; elapsedMs; evidence; error TIMEOUT nếu hết hạn',
    'Ẩn khác bị xóa; SPA load complete vẫn phải đợi điều kiện nghiệp vụ; stale ref không bị hiểu là trang mới đã thỏa.',
    'Chờ absent/hidden có thể dùng locator để tái phân giải. If/Else của Check App State do orchestrator thực hiện, không nhúng workflow UiPath vào extension.')
feature('click','P0','browser_click',
    'Click|Double Click|Click Text|Double Click Text',
    'GenericRequest ClickHtmlElem', 'extension-adapter',
    'Click mục tiêu theo button, số lần và modifiers.',
    'contextRef; elementRef; button=left/right/middle; clickCount=1/2; modifiers[]; verify?',
    'dispatchState; outcome; before/after evidence; verifiedPostcondition?',
    'Kiểm tra target hợp lệ/hiển thị trước click; che khuất, disabled và handler phát sinh navigation phải được kiểm chứng.',
    'Driver 23.4 xử lý click qua GenericRequest messageId=6. Payload flags khác options ở 23.10. Chưa có click thật được kiểm chứng.')
feature('type','P0','browser_type',
    'Type Into|Type Secure Text',
    'WriteTextHtmlElem', 'extension-adapter',
    'Nhập text dạng replace hoặc append, giữ thao tác Enter/submit tách biệt.',
    'contextRef; elementRef; text hoặc secretRef; mode=replace/append; inputMethod=auto; verify?',
    'dispatchState; valueMatch?; charsProcessed?; evidence đã che dữ liệu nhạy cảm',
    'Native input, textarea, contenteditable và controlled input phải nhận event phù hợp; append không tự retry.',
    'WriteTextHtmlElem nhận tokens/inputOptions; cấu trúc tokens chưa được xác lập. Không gửi chuỗi text thẳng vào trường tokens. Secure Text cần chính sách che log, không thừa hưởng SecureString của UiPath.')
feature('checked','P0','browser_set_checked',
    'Check|Check/Uncheck',
    'CheckHtmlElem GetHtmlAttribute', 'extension-adapter',
    'Đặt checkbox/radio về trạng thái mong muốn thay vì toggle mù.',
    'contextRef; elementRef; checked:boolean; verify=true',
    'beforeChecked; afterChecked; changed; verified',
    'Đã đúng trạng thái thì không click; radio không cho bỏ chọn phải báo UNSUPPORTED_CAPABILITY thay vì giả thành công.')
feature('select','P0','browser_select_options',
    'Select Item|Select Multiple Items',
    'HtmlGetSelectedItems HtmlSetSelectedItems', 'extension-adapter',
    'Đọc/đặt lựa chọn của HTML select theo value hoặc label.',
    'contextRef; elementRef; action=get/set; values[] hoặc labels[]; mode=replace/add/remove',
    'selected[{value,label}]; changed; verified',
    'Single select không nhận nhiều giá trị; label trùng phải báo mơ hồ; custom dropdown dùng find/click riêng.',
    'Nguồn Select Item giới hạn custom web dropdown. Không coi mọi combobox là native select.')
feature('scroll','P0','browser_scroll',
    'Mouse Scroll',
    'BringElementIntoView ScrollIntoView MouseWheelDebugger', 'extension-adapter',
    'Cuộn trang/container hoặc đưa phần tử vào vùng nhìn.',
    'contextRef; tabRef hoặc elementRef; action=by/intoView; deltaX/deltaY; unit=cssPixel',
    'scrollPosition?; targetVisible?; evidence',
    'Nested scroll container cuộn đúng vùng; không lẫn screen-device pixel với CSS pixel.',
    'Wheel qua debugger có điều kiện AttachDebugger; không tự gắn debugger như fallback chưa khai báo.')
feature('focus','P0','browser_focus',
    'Set Focus|Activate',
    'SetFocusedHtmlElement GetFocusedHtmlElement NavigationCommand', 'extension-adapter',
    'Đặt focus vào phần tử hoặc kích hoạt tab được chỉ định.',
    'contextRef; elementRef hoặc tabRef',
    'focusedElementRef?; activeTabRef?; verified',
    'DOM focus và cửa sổ Chrome ở foreground là hai trạng thái riêng.',
    'Foreground cửa sổ OS cần backend native nếu extension không cung cấp.')
feature('screenshot','P0','browser_screenshot',
    'Take Screenshot|Set Clipping Region',
    'TakeScreenshot GetHtmlRectangle GetHtmlDevicePixelRatio', 'extension+artifact',
    'Chụp viewport hoặc phần tử, trả ảnh/artifact có kích thước và tọa độ rõ ràng.',
    'contextRef; tabRef; elementRef?; clip?; format=png/jpeg; maxWidth?; destination?',
    'artifactRef/image content; width; height; mediaType; coordinateSpace; captureScope',
    'Clip đúng khi zoom/DPR thay đổi; giới hạn ảnh trước khi vượt khung native message; không báo full-page nếu chỉ chụp viewport.',
    'Full-page và desktop capture là capability riêng cần kiểm chứng. Native host → Chrome giới hạn 1 MiB cho mỗi message.')
feature('keys','P1','browser_press_keys',
    'Keyboard Shortcuts|Send Hotkey|Copy Selected Text',
    'WriteTextHtmlElem IgnoreNextKeystrokeEvent SimulateEvent', 'adapter-gap',
    'Gửi key chord hoặc chuỗi key có thứ tự với keydown/keyup cân bằng.',
    'contextRef; target; keys=[{key,modifiers?}]; inputMethod?',
    'dispatchState; verification?; unsupportedKeys[]',
    'Ctrl+A/Enter/Tab và modifiers được nhả khi lỗi; xác minh tác động trên trang.',
    'Tên SimulateEvent chưa đủ chứng minh trusted keyboard event. Shortcut Chrome/OS có thể cần native backend; không coi UiPath key-token syntax là giao diện MCP.')
feature('set-text','P1','browser_set_text',
    'Set Text',
    'WriteTextHtmlElem RunJS', 'adapter-gap',
    'Đặt giá trị text theo semantics riêng cho control, đọc lại và báo event đã phát.',
    'contextRef; elementRef; text; emitEvents=[input,change]; verify=true',
    'beforeValue?; afterValue; emittedEvents; verified',
    'React/Vue controlled input không bị revert; attribute value và live property được phân biệt.',
    'SetHtmlAttribute(value) không tương đương Set Text; phương thức RunJS là fallback có khai báo và cần kiểm chứng.')
feature('set-attribute','P1','browser_set_attribute',
    'Set Web Attribute',
    'SetHtmlAttribute GetHtmlAttribute', 'extension-adapter',
    'Đổi DOM attribute và đọc lại kết quả.',
    'contextRef; elementRef; name; value:string hoặc null để xóa nếu adapter hỗ trợ',
    'attributeName; before; after; verified',
    'Không nhầm checked/value attribute với state hiện hành; null/remove có capability riêng.',
    'Không quảng bá như cơ chế nhập liệu thay thế.')
feature('hover','P1','browser_hover',
    'Hover|Hover Text|Tooltip',
    'SimulateEvent GenericRequest', 'adapter-gap',
    'Đưa con trỏ/hover vào mục tiêu và chờ tooltip/menu nếu yêu cầu.',
    'contextRef; elementRef; position?; verify?',
    'dispatchState; inputMethod; observedState?',
    'CSS :hover và mouseover listener phải được kiểm chứng riêng.',
    'Chưa xác định lệnh hover trực tiếp trong driver đang ghim; synthetic mouseover không tự bảo đảm CSS :hover.')
feature('drag','P2','browser_drag_and_drop',
    'Drag and Drop',
    'SimulateEvent GenericRequest', 'adapter-gap',
    'Kéo từ source sang target với hành vi HTML5 hoặc pointer được chỉ rõ.',
    'contextRef; sourceRef; targetRef; mode=html5/pointer; path?; verify?',
    'inputMethod; dispatchState; drop evidence; verified',
    'HTML5 dataTransfer và pointer-based sortable được kiểm chứng độc lập; không chỉ phát drop rồi báo thành công.',
    'Không có raw DragDrop đã xác nhận; có thể cần backend phụ.')
feature('frames','P1','browser_frames browser_frame_attach',
    '', '', 'adapter-gap',
    'Liệt kê/chọn frame và khai báo khả năng xuyên iframe hoặc shadow root.',
    'contextRef; tabRef; frameLocator/frameRef?; rootRef?; strict=true',
    'frames[{frameRef,parentRef,url,accessible}]; selected frameRef; shadow capability',
    'Nested/cross-origin iframe phải có scope riêng; frame reload làm stale ref; closed shadow root trả unsupported khi không truy cập được.',
    'Chưa có schema frame được xác minh. Không coi JS trang chính có thể tự truy cập mọi cross-origin iframe hoặc closed shadow root.')
feature('selection','P1','browser_text_selection',
    '', 'GetSelectedRange SetSelectedRange', 'extension-adapter',
    'Đọc/đặt vùng text selection cho trường nhập hoặc nội dung được hỗ trợ.',
    'contextRef; elementRef; action=get/set; start?; end?; direction?',
    'range; selectedText?; verified',
    'Unicode, textarea và contenteditable có mapping offset rõ; không làm hỏng surrogate pair.')
feature('highlight','P1','browser_highlight',
    'Highlight', 'StartHighlight StopHighlight', 'extension-adapter',
    'Đánh dấu mục tiêu để debug rồi tự thu hồi.',
    'contextRef; elementRef; durationMs; style?',
    'highlightRef; expiresAt; applied',
    'Overlay không chặn input; cleanup khi navigation/timeout.')
feature('script','P1','browser_evaluate',
    'Inject Js Script', 'InjectAndRunJs RunJS', 'extension-adapter',
    'Chạy hàm JavaScript trên target/document trong world được khai báo.',
    'contextRef; tabRef; elementRef?; script; input:JSON; world=isolated/page; timeoutMs',
    'result:JSON; executionWorld; durationMs; scriptError?',
    'Promise, exception, JSON nonserializable và timeout được xử lý; không trả toàn bộ DOM object.',
    'UiPath Inject JS dùng input/output string; JSON là hợp đồng bridge đề xuất qua serialize/parse. Page world cần capability; tên tool evaluate luôn được coi có thể ghi.')
feature('extract','P1','browser_extract_table',
    'Extract Table Data|Extract Structured Data', 'ExtractData ExtractMetadata GetHtmlValueForElements GetAttributeForElements', 'extension+composite',
    'Trích xuất bảng có schema cột và phân trang được kiểm soát.',
    'contextRef; rootRef/locator; columns[]; maxRows; cursor?; pagination={enabled:false,maxPages?}',
    'columns; rows; sourceRefs?; nextCursor; truncated; pagesVisited',
    'Header lặp, ô trống và virtualized rows được phân biệt; bật pagination mới được click Next.',
    'Schema ExtractData/Metadata cần decode. Trích xuất không tự đồng nghĩa OCR hoặc PDF parsing.')
feature('table-cell','P1','browser_table_cell',
    'Table Cell Scope', 'FindWebCtrlElements GetHtmlCollectionById GetSapFioriAllColLabels', 'composite+sap-conditional',
    'Trả ref ô theo cột và điều kiện hàng, để dùng tiếp click/type.',
    'contextRef; tableRef; column=key/label; row={index/filter/firstEmpty}; strict=true',
    'cellRef; rowIndex; columnKey; matchedRows',
    'Index 0-based ghi rõ; label trùng báo mơ hồ; virtualized row không được coi đã tải đủ.',
    'Đây là web analogue của scope. SAP activity còn phụ thuộc nền tảng và ma trận tương thích, không suy từ GetSapFioriAllColLabels thành đầy đủ SAP support.')
feature('tree','P1','browser_tree',
    'Expand Tree', 'TreeGetNodePath TreeGetAllPaths TreeExpandPath', 'extension-adapter',
    'Đọc/expand đường dẫn cây web mà driver nhận diện được.',
    'contextRef; rootRef; action=paths/path/expand; path?; maxNodes',
    'paths; nodeRef?; expanded; truncated',
    'Lazy loaded tree có giới hạn; label trùng dùng key ổn định.',
    'Không thay SAP ALV engine; Expand Tree của UiPath là SAP activity có giới hạn nền tảng.')
feature('calendar','P2','browser_calendar_select',
    'Select Dates in Calendar', '', 'composite+sap-conditional',
    'Chọn ngày/range/week trên widget web bằng thao tác có xác minh.',
    'contextRef; rootRef; mode=date/range/week; ISO date(s); locale; timezone?',
    'selectedDates; normalizedValue; evidence',
    'Tháng/năm, locale và timezone không bị đảo; phải quan sát đúng widget.',
    'UiPath activity này dành cho SAP Fiori. Generic datepicker workflow là analogue, không phải triển khai protocol SAP activity.')
feature('form-read','P1','browser_form_read',
    'Extract Form Data', 'FindWebCtrlElements GetHtmlValueForElements GetAttributeForElements', 'composite',
    'Đọc form thành trường có ref, nhãn, value và state.',
    'contextRef; rootRef; fields?; maxFields; includeSensitive=false',
    'fields[{fieldKey,elementRef,label,type,value?,state}]; unresolved[]',
    'Label gắn đúng input; password bị che; không tự suy giá trị hidden.',
    'Web composite tương đương mục đích; không cung cấp semantic AI engine của UiPath.')
feature('form-fill','P1','browser_form_fill',
    'Fill Form', 'FindWebCtrlElements WriteTextHtmlElem CheckHtmlElem HtmlSetSelectedItems', 'composite',
    'Lập preview ánh xạ field rồi điền các trường được chỉ định, không tự submit.',
    'contextRef; rootRef; values; mode=preview/apply; bindings?; verify=true',
    'plan; completed[]; failed[]; skipped[]; partial; evidence',
    'Không click submit; trùng label phải dừng field đó; lỗi giữa chừng trả partial và không rollback giả.',
    'Semantics phải bám vào type/select/check đã kiểm chứng; không hứa thao tác atomic.')
feature('semantic','P2','browser_semantic_query',
    'Extract UI Data (preview)|Update UI Element (former Set Value)', '', 'optional-semantic-provider',
    'Tìm/trích xuất theo mô tả từ snapshot hoặc provider AI tùy chọn.',
    'contextRef; instruction; schema?; mode=read/plan; maxResults',
    'candidates hoặc structuredData; sourceRefs; uncertainty; proposedActions?',
    'Mỗi giá trị có nguồn; hành động cập nhật phải qua plan/ref cụ thể và tool ghi phù hợp.',
    'Không có engine semantic UiPath trong extension cũ. Agent có thể tự suy luận từ snapshot; không cần ép có thêm LLM phía server.')
feature('popup','P1','browser_close_popup',
    'Close Popup', 'FindWebCtrlElements GenericRequest', 'composite',
    'Phân loại và đóng DOM overlay theo nút đã định vị.',
    'contextRef; rootRef/locator; closeButtonRef?; verify=true',
    'kind=domOverlay; actionRef; closed; evidence',
    'Không tự đóng tab hay accept alert khi target là DOM overlay.',
    'JS dialog và cửa sổ/tab mới dùng family riêng. Không thừa hưởng khả năng semantic Close Popup của UiPath.')
feature('network','P1','browser_network_wait',
    '', 'StartWebRequestMonitoring AnyWebRequestsInFlight StopWebRequestMonitoring', 'extension-adapter',
    'Theo dõi request trong scope và chờ khoảng yên lặng có giới hạn.',
    'contextRef; tabRef; action=arm/wait/stop; watchRef?; quietMs; timeoutMs; filters?',
    'watchRef; pending?; quietForMs; endedReason',
    'Arm trước thao tác gây mạng; long-poll không làm treo vô hạn; stop cleanup.',
    'Network idle không chứng minh giao diện hoặc nghiệp vụ đã sẵn sàng; cần condition DOM khi phù hợp.')
feature('events','P2','browser_events',
    'Application Event Trigger|Click Event Trigger|Keypress Event Trigger|Click Trigger|Key Press Trigger|Element Attribute Change Trigger|Element State Change Trigger|Monitor Events|Get Event Info|Get Source Element|Replay User Event',
    'MonitorNativeEvents GetFocusedHtmlElement', 'adapter-gap+broker',
    'Subscribe/poll/unsubscribe sự kiện trong tab, có TTL và hàng đợi.',
    'contextRef; action=subscribe/poll/unsubscribe; types[]; subscriptionRef?; cursor?; ttlMs',
    'subscriptionRef; events[{eventId,type,elementRef?,timestamp,payload}]; cursor; droppedCount',
    'Tab đóng phải kết thúc stream; giới hạn queue; source ref có generation; replay là thao tác ghi riêng.',
    'Không suy từ MonitorNativeEvents thành mọi trigger/hotkey OS. Hỗ trợ push MCP tùy client; polling là phương án portable. Replay chưa có endpoint riêng trong thiết kế P0.')
feature('new-tab','P1','browser_wait_new_tab',
    '', 'FindBrowserTabs GetBrowserWindows', 'composite',
    'Arm danh sách tab trước trigger rồi chờ tab/window mới khớp điều kiện.',
    'contextRef; action=arm/wait/cancel; watchRef?; openerTabRef?; urlPattern?; timeoutMs',
    'watchRef; newTabRef; windowRef; correlation',
    'Không chọn tab mới do tác vụ khác tạo; nhiều tab khớp báo mơ hồ.')
feature('dialog','P2','browser_dialog',
    'Browser Dialog Scope', '', 'external-backend-required',
    'Chuẩn bị listener rồi nhận/respond alert, confirm hoặc prompt.',
    'contextRef; action=arm/wait/respond/cancel; watchRef?; accept?; promptText?; timeoutMs',
    'watchRef; dialogRef; type; message; handled; response',
    'Arm → trigger → wait/respond không bỏ lỡ dialog; listener cleanup; không nhầm DOM modal.',
    'Chưa tìm được raw handler tương ứng đã xác minh; có thể cần CDP/native backend giữ nguyên extension.')
feature('file-picker','P2','browser_file_picker',
    'Browser File Picker Scope', '', 'external-backend-required',
    'Chuẩn bị thao tác chọn file upload/download theo khả năng backend.',
    'contextRef; action=arm/wait/provide/cancel; watchRef?; paths[]?; mode; timeoutMs',
    'pickerRef; selectedCount; result; supportedPickerType',
    'Arm trước click; nhiều file và cancel rõ; chỉ báo thành công khi input/ứng dụng xác nhận nhận file.',
    'UiPath Browser File Picker Scope thuộc UIA 25.10.7+, không suy hỗ trợ từ extension 23.10.1; docs nêu showOpenFilePicker không hỗ trợ. Không giả upload bằng gán input.value.')
feature('downloads','P1','browser_download',
    'Wait for Download', '', 'filesystem+optional-browser-backend',
    'Theo dõi download với mốc bắt đầu và correlation trước thao tác kích hoạt.',
    'contextRef; action=arm/wait/cancel; directory; filenamePattern?; watchRef?; timeoutMs',
    'downloadRef; artifactRef/path; size; completedAt; correlation; completionEvidence',
    'Không chọn file cũ hoặc .crdownload; song song phải phân biệt; completion không chỉ là file đã xuất hiện.',
    'Wait for Download thuộc UiPath.System.Activities. Extension hiện chưa có lệnh tải xuống tương ứng được xác nhận; folder watch là backend riêng, có giới hạn correlation.')
feature('cookies','P1','browser_cookies',
    'Get Browser Data|Set Browser Data',
    'GetBrowserData SetBrowserData SetBigString GetBigString AppendBigString DeleteBigString', 'extension-adapter',
    'Xuất/nhập session cookies trong scope công khai.',
    'contextRef; action=export/import; domainFilter; artifactRef?; overwritePolicy?',
    'artifactRef; cookieCount; domains; perItemResults; applied',
    'Không trả cookie thô vào transcript mặc định; phân biệt domain/path/expiry; cleanup big-string.',
    'Mã driver khảo sát xử lý cookies. Không hứa localStorage/sessionStorage hay đọc profile offline theo toàn bộ activity UiPath.')
feature('window','P2','browser_window',
    'Window Operation|Maximize Window|Minimize Window|Restore Window|Move Window|Hide Window|Show Window|Use Foreground|Get Active Window|Attach Window|Close Window',
    'MaximizeWindow GetBrowserWindows GetWindowIdForTabId', 'extension-partial+native-optional',
    'Đọc và đổi trạng thái cửa sổ Chrome khi backend hỗ trợ.',
    'contextRef; windowRef; action=get/maximize/minimize/restore/move/resize/foreground/close',
    'windowRef; bounds; state; applied; backend',
    'Không nhầm tab/window/OS-process; action ngoài capability phải từ chối trước dispatch.',
    'Chỉ thấy MaximizeWindow trực tiếp; các action khác cần native/backend bổ sung. Link window-operation ở danh sách Modern trả trang tổng quan khi khảo sát; chưa dùng làm đặc tả chi tiết.')
feature('launch','P2','browser_launch',
    'Open Application|Close Application|Start Process', '', 'native-optional',
    'Khởi chạy/đóng process Chrome hoặc profile được quản lý.',
    'browserExecutable/profileRef; launchOptions; processRef?; gracefulClose=true',
    'processRef; connectionRef; ownership; connected',
    'Không đóng process dùng chung; launch không ghi đè profile đang dùng.',
    'Chỉ nhận process trình duyệt trong phạm vi browser. Chạy ứng dụng bất kỳ là ngoài scope.')
feature('clipboard','P2','system_clipboard',
    'Get Clipboard|Get From Clipboard|Set Clipboard|Set To Clipboard', '', 'native-optional',
    'Đọc/ghi clipboard hệ điều hành khi workflow thật sự cần.',
    'action=read/write; format=text; text?; timeoutMs',
    'text hoặc written; format; observedAt',
    'Phân biệt clipboard OS và navigator.clipboard bị permission/user-gesture hạn chế.',
    'Là nhóm system tùy chọn, không thuộc extension DOM cơ bản.')
feature('image-files','P2','browser_image_artifact',
    'Save Image|Load Image', '', 'artifact-filesystem',
    'Đọc/lưu ảnh artifact để dùng cho screenshot/vision.',
    'action=load/save; artifactRef/path; format?; destination?',
    'artifactRef; path?; mediaType; width; height',
    'Định dạng và nơi lưu rõ; ghi file không được coi là tương tác DOM.',
    'Save Image Modern lưu Image variable xuống đĩa. Tải ảnh gốc từ URL là tính năng asset-download riêng, không đánh đồng với activity này.')
feature('visual','P2','browser_visual_find browser_ocr',
    'Click Image|Double Click Image|Click OCR Text|Double Click OCR Text|Hover Image|Hover OCR Text|Find Image|Find Image Matches|Find OCR Text Position|Find Text Position|Image Exists|OCR Text Exists|Get OCR Text|On Image Appear|On Image Vanish|Wait Image Vanish|Click Image Trigger|Google Cloud Vision OCR|Microsoft Azure Computer Vision OCR|Microsoft OCR|Microsoft Project Oxford Online OCR|Tesseract OCR|CV Check|CV Click|CV Dropdown Select|CV Element Exists|CV Extract Table|CV Get Text|CV Highlight|CV Hover|CV Refresh|CV Screen Scope|CV Type Into|Set CV Server',
    'TakeScreenshot', 'vision-provider-required',
    'OCR và định vị ảnh từ screenshot; hành động tiếp theo dùng tọa độ/ref có provenance.',
    'contextRef; imageArtifactRef/tabRef; query/template; region; providerRef; confidenceThreshold',
    'matches[{text?,rect,confidence}]; coordinateSpace; sourceScreenshot; provider',
    'DPR/zoom/viewport khớp; kết quả yếu hoặc nhiều match không tự click; screenshot cũ không dùng sau layout change.',
    'Tên CV/OCR provider là lựa chọn UiPath, không phải engine có sẵn trong extension. CV Check/dropdown/table/type là capability mở rộng, chưa có parity. CV Screen Scope/Set CV Server là context/provider config.')
feature('accessibility','P2','browser_accessibility_audit',
    'Accessibility Check', '', 'audit-engine-required',
    'Audit trang bằng engine kiểm tra accessibility riêng.',
    'contextRef; tabRef; standard/ruleset; scope?',
    'violations; ruleIds; targetRefs; engineVersion; limitations',
    'Vi phạm có rule và element nguồn; ghi rõ automated checks không thay toàn bộ kiểm tra thủ công.',
    'DOM snapshot không tự tương đương Accessibility Check; cần engine và hợp đồng kết quả riêng.')
feature('sap','P2','',
    'Call Transaction|Click Picture on Screen|Click Toolbar Button|Expand ALV Hierarchical Table|Expand ALV Tree|Read Status Bar|SAP Login|SAP Logon|SAP Session Attributes Change Trigger|Select Menu Item',
    '', 'sap-specific-conditional',
    'Giữ SAP activity trong coverage để đánh giá backend theo SAP Fiori/WebGUI/WinGUI.',
    'platform; control type; supported adapter; operation',
    'support decision; explicit unsupported reason',
    'Đối chiếu ma trận SAP theo từng activity và nền tảng; generic click/get text không được tính là parity SAP activity.',
    'Chưa đề xuất public tool SAP chuyên dụng. Website SAP vẫn có thể dùng generic browser tools nếu control và adapter cho phép.')
feature('orchestration','P1','',
    'For Each UI Element|Retry Scope', '', 'agent-orchestrator',
    'Lặp, branch, retry có deadline và điều kiện hậu kiểm ở agent/CLI.',
    'bounded element list; condition; maxIterations; deadline; retry policy',
    'perStepResults; elapsed; partial; stopReason',
    'Không retry mù click/type/navigation; loop có giới hạn và xử lý element stale.',
    'Không cần mỗi control-flow activity thành một MCP tool. Retry Scope thuộc Workflow/System, dùng để thiết kế orchestration.')
feature('desktop-out','P2','',
    'Block User Input|Unblock User Input|Callout|Get Password|Hotkey Trigger|Inject .NET Code|Invoke ActiveX Method|Mouse Trigger|System Trigger|Set Project Setting|Hide Status Window|Show Status Message|Show Status Window',
    '', 'outside-browser-core',
    'Ghi nhận activity desktop, Studio config, người dùng và OS event để không bỏ sót baseline.',
    'N/A trong browser-only API', 'OUT_OF_SCOPE hoặc optional native integration',
    'Capability browser không công bố các chức năng này khi chưa có backend riêng.',
    'Block input/global trigger là OS scope; status/callout là giao diện workflow; Get Password không đồng nghĩa đọc password trong DOM; .NET/ActiveX không là JS browser.')

features=runpy.run_path('scripts/feature-route-revisions.py')['revise'](features)

# Freeze activity-name coverage rather than copying the vendor's full documentation.
baseline = {}
excluded = {'Activity','Windows','link','Classic'}
source_manifest = []
for fn, field in [('index','activities'),('modern','anchors'),('classic','anchors')]:
    p = RESEARCH/(fn+'.json')
    d=json.loads(p.read_text(encoding='utf8'))
    source_manifest.append(dict(id=fn,url=d['url'],retrievedOn=BASELINE_DATE,sha256=hashlib.sha256((RESEARCH/(fn+'.html')).read_bytes()).hexdigest()))
    for a in d[field]:
        name=a['name'].strip('\u200b \t\r\n')
        if not name or name in excluded: continue
        row=baseline.setdefault(name,dict(name=name,lists=[],sources=[]))
        if fn not in row['lists']: row['lists'].append(fn)
        url=a.get('url') or d['url']
        if url not in row['sources']: row['sources'].append(url)
for name in ['Close Popup','Extract Form Data','Extract UI Data (preview)','Fill Form','Update UI Element (former Set Value)']:
    row=baseline.setdefault(name,dict(name=name,lists=[],sources=[]))
    row['lists'].append('semantic')
    row['sources'].append(BASE+'ui-automation-semantic-activities')
for name, slug in [('Wait for Download','get-last-downloaded-file'),('Retry Scope','retry-scope')]:
    baseline[name]=dict(name=name,lists=['workflow-selected'],sources=['https://docs.uipath.com/activities/other/latest/workflow/'+slug])
source_manifest.extend([
    dict(id='semantic',url=BASE+'ui-automation-semantic-activities',retrievedOn=BASELINE_DATE),
    dict(id='workflow-download',url=baseline['Wait for Download']['sources'][0],retrievedOn=BASELINE_DATE),
    dict(id='workflow-retry',url=baseline['Retry Scope']['sources'][0],retrievedOn=BASELINE_DATE),
    dict(id='sap-compatibility',url=BASE+'sap-activities-compatibility-matrix',retrievedOn=BASELINE_DATE)])
for d in json.loads((RESEARCH/'details.json').read_text(encoding='utf8')):
    source_manifest.append(dict(id='detail-'+d['url'].rsplit('/',1)[-1], activity=d['name'], url=d['url'],
        retrievedOn=BASELINE_DATE, textSha256=hashlib.sha256(d['text'].encode('utf8')).hexdigest(),
        contentMatchesExpectedTitle=d['name']!='Window Operation'))
dependencies={
    'snapshot':['find','element-read'], 'element-read':['find'], 'wait':['element-read'],
    'click':['find','element-read'], 'type':['find','element-read'], 'checked':['find','element-read'],
    'select':['find','element-read'], 'focus':['find'], 'scroll':['find'],
    'form-read':['find','element-read'], 'form-fill':['form-read','type','checked','select'],
    'popup':['find','click','wait'], 'table-cell':['find','element-read'],
    'calendar':['find','click','wait'], 'visual':['screenshot'], 'semantic':['snapshot']}
for f in features: f['dependencies']=dependencies.get(f['id'],[])
activity_notes={
    'Open Browser':'Chỉ phần mở trang/tab có primitive hiện tại; launch process/profile là feature launch.',
    'Get URL':'URL/tab metadata đã có trong uipath_tab_info; schema browser_tab_get mới vẫn là đề xuất.',
    'Get Attribute':'Metadata tab đã đọc được; DOM attribute theo elementRef chưa triển khai.',
    'Get Text':'Đề xuất DOM/visible text; native/OCR scraping cần backend riêng.',
    'Find Element':'Dùng candidate FindSelectors/content 8; FindWebCtrlElements là stub. Schema/ref còn chờ live fixture.',
    'Indicate On Screen':'Chọn mục tiêu từ snapshot là analogue; picker UI trực tiếp chưa có.',
    'Check Element':'Kiểm tra enabled/disabled, không phải đặt checked.',
    'Copy Selected Text':'Cần selection, key dispatch và clipboard/readback phù hợp; không chỉ gửi Ctrl+C rồi báo đã đọc text.',
    'Save Image':'Modern lưu Image variable ra đĩa; không đồng nghĩa download ảnh gốc từ URL.',
    'Replay User Event':'Chưa có endpoint public tương đương; event broker chỉ là hạ tầng đề xuất.',
    'Window Operation':'Nguồn link danh sách trả trang tổng quan trong snapshot; chưa lấy làm schema chi tiết.',
    'Extract UI Data (preview)':'Tên preview trong baseline; semantic provider/agent reasoning riêng, không có UiPath AI engine.',
    'Select Dates in Calendar':'Activity SAP Fiori; generic calendar workflow là analogue có phạm vi hẹp.',
    'Table Cell Scope':'Activity SAP; table-cell web composite chưa chứng minh parity theo nền tảng.',
    'Expand Tree':'Activity SAP theo ma trận; Tree* driver entry là candidate, không bảo đảm SAP ALV.',
    'Close Popup':'Chỉ DOM-overlay composite; JS dialog/new-tab/OS dialog được tách riêng.'}
assignment={}
for f in features:
    for n in f['activities']:
        if n in assignment: raise ValueError('duplicate activity assignment '+n)
        assignment[n]=f['id']
uncovered=sorted(set(baseline)-set(assignment))
if uncovered: raise ValueError('uncovered baseline '+str(uncovered))
unknown=sorted(set(assignment)-set(baseline))
if unknown: raise ValueError('extra assignments '+str(unknown))
by_id={f['id']:f for f in features}
coverage=[]
for name,row in sorted(baseline.items()):
    f=by_id[assignment[name]]
    coverage.append(dict(**row,featureId=f['id'],proposedTools=f['proposedTools'],backend=f['backend'],
        phase=f['phase'],coverage='excluded-browser-core' if f['id']=='desktop-out' else 'conditional-specialist' if f['id'] in ['sap','visual','accessibility'] else 'mapped-scope-limited',
        parity='purpose-level; see feature limitations',implemented=False,
        scopeNote=activity_notes.get(name,f['limitation'] or f['purpose']),
        extensionSupport=f['extensionSupport'],candidateCommands=f['candidateCommands'],candidateGenericMessageIds=f['candidateGenericMessageIds']))

spec=dict(schemaVersion='1.1.0-draft',updatedOn=DATE,baselineCapturedOn=BASELINE_DATE,status='source-audited-feature-design',
    baselineScope='UiPath UI Automation index + Modern + Classic + Semantic name union; selected Workflow Wait for Download and Retry Scope',
    officialActivityNames=len(coverage),extensionId='jfcmnbofjlffnejneillkgbniiidiigd',extensionVersion='23.10.1',
    pinnedDriver='23.4.55.39317',
    existingMcpTools=['uipath_bridge_status','uipath_driver_versions','uipath_open_url','uipath_tab_info'],
    existingToProposedMappings={'uipath_bridge_status':['browser_capabilities'],
        'uipath_driver_versions':['browser_capabilities'], 'uipath_open_url':['browser_tab_open'],
        'uipath_tab_info':['browser_tab_get']},
    existingRuntimeEvidence='EXTENSION-LIVE-VERIFICATION.json',protocolEvidence='pinned-driver-audit.json',offlineProbeEvidence='EXTENSION-PROTOCOL-PROBES.json',
    implementationGate='G0: live FindSelectors discovery -> stable ref -> read -> input -> readback; snapshot and other DOM tools remain unavailable until passed.',
    sources=source_manifest,features=features,activityCoverage=coverage)
(OUT/'browser-feature-spec.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def cell(s): return str(s).replace('|',' / ').replace('\n',' ')
def tools_cell(f): return ', '.join('`'+t+'`' for t in f['proposedTools']) or 'orchestrator / adapter riêng'
counts=Counter(f['phase'] for f in features)
toolcounts=Counter()
for f in features: toolcounts[f['phase']]+=len(f['proposedTools'])

intro=f'''# Đặc tả tính năng browser automation cho agent

Bản thiết kế ngày {DATE}. Mục tiêu là giữ nguyên extension UiPath đang cài, dùng native host và MCP riêng để agent thao tác trình duyệt qua các primitive có kết quả kiểm chứng được. Tên `browser_*` dưới đây là API đề xuất; chưa được đăng ký trong MCP server.

Khuyến nghị xây lớp primitive nhỏ trước: context, tab, quan sát trang, tìm phần tử, đọc trạng thái, click, type, check, select, scroll và wait. Các activity như For Each hoặc Check App State trở thành luồng ghép từ primitive. File picker, dialog, download, vision và semantic được khai báo thành capability riêng.

## Phạm vi và trạng thái

- Baseline đối chiếu có **{len(coverage)} tên activity phân biệt**: hợp của [index](https://docs.uipath.com/activities/other/latest/ui-automation/activities-index), [Modern](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-modern-activities), [Classic](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-classic-activities), [Semantic](https://docs.uipath.com/activities/other/latest/ui-automation/ui-automation-semantic-activities), cộng hai helper Workflow được chọn là Wait for Download và Retry Scope. Đây là coverage của baseline nêu trên, không phải toàn bộ mọi package UiPath.
- **{len(features)} nhóm tính năng**, **{sum(toolcounts.values())} tên tool đề xuất** chia theo P0/P1/P2. Mỗi activity có hàng đối chiếu trong [bảng mapping](BROWSER-ACTIVITY-MAPPING.vi.md). Tên khác nhau giữa Modern/Classic được giữ lại để tra cứu.
- Extension đang khảo sát là **23.10.1**, driver bridge ghim **23.4.55.39317**. Tài liệu vendor `latest` mô tả các activity mới hơn; một activity có trong docs không có nghĩa extension cũ hiểu được.
- Server hiện chỉ có `uipath_bridge_status`, `uipath_driver_versions`, `uipath_open_url`, `uipath_tab_info`. Bốn tool đã được kiểm tra lại trên fixture HTTP local ngày 2026-10-26, đọc đúng URL/title/complete trong [receipt mới](EXTENSION-LIVE-VERIFICATION.json). Click, type, DOM và các tool đề xuất chưa được xác minh live.
- Backend candidate trong tài liệu là hướng triển khai từ [catalog giao thức](UIPATH-EXTENSION-GUIDE.vi.md), chưa phải schema request hoàn chỉnh hoặc API công khai do UiPath cam kết.

## Nguyên tắc public MCP

Agent dùng `elementRef`, `tabRef`, locator và tham số có nghĩa nghiệp vụ. Adapter giữ `customId`, `codeVersion`, `flags`, `tokens`, `messageId` ở phía trong. Không public nguyên 88 entry của driver làm 88 tool.

`browser_find_element` tìm mới từ locator và yêu cầu đúng một mục tiêu. `browser_find_elements` trả collection có giới hạn. `browser_get_element` đọc lại ref có sẵn, với `fields` để lấy text, value, attributes, state hoặc rect. Có thể bổ sung alias `get_attribute`/`get_text` cho client cần schema đơn giản; chúng không cần là primitive độc lập.

Chỉ công bố tool đã triển khai và có capability phù hợp. Bảng đầy đủ là roadmap; P2 không tự xuất hiện cùng P0. Với action enum, capability phải chi tiết đến action, ví dụ `browser_window.maximize` khác `browser_window.minimize`.

| Giai đoạn | Nhóm | Tên tool đề xuất | Phạm vi |
|---|---:|---:|---|
| P0 | {counts['P0']} | {toolcounts['P0']} | Chuỗi quan sát → định vị → thao tác → kiểm chứng |
| P1 | {counts['P1']} | {toolcounts['P1']} | JS, extract/form, keys, debug, network, cookie và download |
| P2 | {counts['P2']} | {toolcounts['P2']} | Gap protocol, native/vision/semantic và nền tảng chuyên biệt |

P0 là tập tính năng đích sau **gate G0**, không phải nhãn đã hỗ trợ. G0 phải xác minh live đường discovery, ref và một vòng đọc → input → đọc lại. `FindWebCtrlElements` là stub trong driver ghim; `GetHtmlElemById` không trả lời nhánh DOM thông thường. Candidate thay thế là `FindSelectors` → content 8; schema và live behavior vẫn chưa đạt G0.

Xem [kết quả đối chiếu extension](EXTENSION-CAPABILITY-VERIFICATION.vi.md) để biết route đúng, điều kiện screenshot, giới hạn JS và các finding đã được sửa trong plan. Chỉ chuyển một tính năng thành available sau khi adapter và live fixture đạt tiêu chí của tính năng đó.

## Danh mục tính năng

Mỗi nhóm có input/output riêng ở dưới; mọi tool còn tuân theo [hợp đồng chung](BROWSER-MCP-CONTRACTS.vi.md). Tên command là candidate trong mã, kể cả khi handler không tồn tại trực tiếp ở driver khác. Availability theo từng version nằm trong [JSON](browser-feature-spec.json).

'''
parts=[intro]
for phase in ['P0','P1','P2']:
    parts.append('## '+phase+'\n\n')
    for f in [x for x in features if x['phase']==phase]:
        parts.append(f"### {f['id']}\n\n{f['purpose']}\n\n")
        parts.append(f"- Tool đề xuất: {tools_cell(f)}.\n- Activity: {', '.join(f['activities']) or 'Tiện ích agent bổ sung; không có activity một đối một trong baseline'}.\n- Input: {f['inputs']}.\n- Output: {f['outputs']}.\n- Backend: `{f['backend']}`; candidate: {', '.join('`'+x+'`' for x in f['candidateCommands']) or 'chưa xác định command phù hợp'}.\n- Nghiệm thu: {f['acceptance']}\n")
        if f['limitation']: parts.append('- Điều kiện: '+f['limitation']+'\n')
        parts.append('- Mức đối chiếu: `'+f['extensionSupport']+'`; generic messageIds: '+(', '.join(map(str,f['candidateGenericMessageIds'])) or 'không chốt tuyến generic cho nhóm này')+'.\n')
        parts.append('\n')
parts.append('''## Các khác biệt cần giữ trong thiết kế

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
''')
(OUT/'BROWSER-AUTOMATION-FEATURES.vi.md').write_text(''.join(parts),encoding='utf8')

mapping=[f'''# Đối chiếu activity UiPath với tính năng MCP browser

Baseline chụp ngày {BASELINE_DATE}; mapping cập nhật {DATE}: **{len(coverage)} tên activity**, mỗi tên đúng một hàng. Các hàng là mapping theo mục đích, không khẳng định chạy được toàn bộ thuộc tính của activity. Danh mục có cả desktop/system/SAP để chỉ rõ ranh giới; không loại bỏ im lặng các hàng không thuộc browser core.

Nguồn gốc danh sách: [index]({BASE}activities-index), [Modern]({BASE}ui-automation-modern-activities), [Classic]({BASE}ui-automation-classic-activities), [Semantic]({BASE}ui-automation-semantic-activities); bổ sung Wait for Download và Retry Scope từ Workflow. Header và anchor điều hướng được loại khỏi tên activity. Không chuẩn hóa mất tên Classic hoặc tên cũ.

Chi tiết input/output, tiêu chí nghiệm thu và giới hạn nằm trong [feature catalog](BROWSER-AUTOMATION-FEATURES.vi.md). `M` là có mapping theo mục đích trong phạm vi đã giới hạn; `C` là phụ thuộc engine/platform chuyên biệt; `O` là ngoài browser core. Cả M lẫn C đều chưa khẳng định tool đã triển khai. Cột P là ưu tiên thiết kế.

Route theo driver 23.4 đã được sửa theo [audit extension](EXTENSION-CAPABILITY-VERIFICATION.vi.md): discovery dùng candidate FindSelectors; text/value có generic messageId 5; click là messageId 6; arbitrary JS dùng InjectAndRunJs. Có entry trong mã khác với có backend hoạt động, và khác với đã được MCP triển khai.

| Activity | Danh sách | Feature | MCP đề xuất | Backend | P | Phạm vi |
|---|---|---|---|---|---|---|
''']
for row in coverage:
    f=by_id[row['featureId']]
    flag={'mapped-scope-limited':'M','conditional-specialist':'C','excluded-browser-core':'O'}[row['coverage']]
    mapping.append('| '+ ' | '.join(map(cell,[f"[{row['name']}]({row['sources'][-1]})",', '.join(row['lists']),f"[{f['id']}](BROWSER-AUTOMATION-FEATURES.vi.md#{f['id']})",tools_cell(f),f['backend'],f['phase'],flag]))+' |\n')
mapping.append('''
## Cách đọc các mapping dễ nhầm

- `Open Browser` được tách phần mở trang/tab khỏi phần launch process/profile. `Close Tab`, `Close Window` và `Close Application` cần scope tài nguyên khác nhau.
- `Find Children` và `Find Elements` dùng tìm collection; `Find Element` yêu cầu một target; `Get Ancestor` dùng quan hệ trong locator. `Indicate On Screen` chỉ tương đương chọn target nếu có picker UI, chưa nằm trong prototype.
- `Get Full Text` / `Get Visible Text` được giới hạn sang text mode web; OCR là provider riêng. `Get Position` phải chuyển đổi tọa độ tường minh.
- Trigger và control flow được gom thành broker/orchestrator, không biến mỗi activity thành một tool. Replay User Event chưa có endpoint tương đương và không được công bố là available.
- Các hàng CV/image/OCR cùng nhóm visual nhưng chưa có từng backend con. `Microsoft Project Oxford Online OCR` là tên legacy trong baseline, không phải đề xuất sử dụng provider đó.
- `Select Dates in Calendar`, `Table Cell Scope`, `Expand Tree` là tên activity SAP trong nguồn; generic browser composite chỉ bao phủ một phần mục đích trên widget web. Ma trận SAP theo platform phải được xét riêng; không suy từ generic DOM sang parity SAP.
- `Get Password`, status window, .NET/ActiveX, OS-wide triggers và Studio settings ở ngoài API browser core. Clipboard và process/window operations là module tùy chọn, không có sẵn nhờ extension.

## Bảo trì baseline

Khi nâng phiên bản, chụp lại danh sách, so diff tên mới/xóa/đổi tên, gán feature và ghi compatibility driver trước khi công bố capability. [JSON spec](browser-feature-spec.json) giữ nguồn và hash snapshot; [kết quả kiểm tra tài liệu](browser-docs-validation.json) kiểm tra coverage và tên command. Kiểm tra tài liệu không thay cho chạy automation thật.
''')
(OUT/'BROWSER-ACTIVITY-MAPPING.vi.md').write_text(''.join(mapping),encoding='utf8')
print(json.dumps(dict(activities=len(coverage),features=len(features),tools=sum(toolcounts.values()),phaseTools=toolcounts),ensure_ascii=False))
