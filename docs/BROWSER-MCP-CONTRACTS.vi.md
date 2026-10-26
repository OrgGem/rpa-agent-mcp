# Hợp đồng MCP cho agent thao tác browser

Bản baseline thiết kế ngày 2026-10-26, dùng cùng [feature catalog](BROWSER-AUTOMATION-FEATURES.vi.md), [mapping activity](BROWSER-ACTIVITY-MAPPING.vi.md) và [audit route extension](EXTENSION-CAPABILITY-VERIFICATION.vi.md). Các ví dụ bên dưới giữ vocabulary đề xuất. API runtime chính xác hiện là [browser-tool-contracts.json](browser-tool-contracts.json) và [guide agent](BROWSER-RUNTIME-GUIDE.vi.md): catalog gồm 52 adapter browser, capabilities và 4 legacy. Mười adapter advanced có source backend nhưng cần readiness/configuration riêng; xem [bảng trạng thái](ADVANCED-BACKEND-STATUS.vi.md). Không gửi option baseline chưa có trong schema runtime. Receipt live cũ chỉ áp dụng cho hashes và scope được ghi trong receipt.

## Context và vòng đời ref

| Ref | Ý nghĩa | Vòng đời |
|---|---|---|
| `connectionRef` | Một kết nối native host gắn với browser/profile được nhận diện | Hết hạn khi host disconnect; không suy profile từ URL |
| `contextRef` | Phạm vi thao tác agent đã chọn, gắn connection và capability | Hết hạn khi detach/disconnect; MVP chưa public detach riêng |
| `windowRef` | Cửa sổ browser trong connection | Hết hạn khi cửa sổ đóng |
| `tabRef` | Tab trong connection, không chỉ một số Chrome tab ID | Hết hạn khi tab đóng hoặc connection bị thay thế |
| `frameRef` | Frame thuộc tab và document generation | Hết hạn khi frame reload/remove hoặc tab đổi document |
| `elementRef` | Handle opaque do server quản lý, gắn tab/frame/document generation | Hết hạn khi node không còn hợp lệ, document thay thế hoặc connection mất |
| `watchRef` | Watcher đã arm cho dialog/download/network/new-tab | Có TTL, scope và cleanup khi cancel/disconnect |
| `artifactRef` | File/ảnh/result lớn có metadata và nơi lưu | Có chính sách lưu và cleanup riêng, không phụ thuộc vòng đời DOM |

`elementRef` ánh xạ nội bộ đến driver `customId` sau khi đã định vị thành công. Không dùng chuỗi CSS, XPath hoặc text làm `customId`. Ref phải được kiểm tra scope trước dispatch, kể cả khi Chrome tái sử dụng tab ID.

Document generation tăng khi thay document; cùng-document navigation hoặc SPA có thể thay node dù generation không đổi. Server phải kiểm tra node còn hợp lệ trước action. Khi stale, trả `STALE_ELEMENT` để agent quan sát/tìm lại; không tự click vào phần tử mới gần giống. Một ref giữ nguyên không bảo đảm layout hay giá trị giữ nguyên.

Prototype hiện dùng một native-host context. Khả năng nhiều profile/connection đồng thời và quản lý sở hữu tab/process cần thiết kế broker trước khi triển khai.

## Locator và định vị

Locator có `kind`, tiêu chí, scope và quy tắc matching rõ. Các kind dự kiến gồm `uipath`, `attributes`, `text`, `role`, `css`, `xpath`; chỉ kind đã được adapter kiểm chứng mới xuất hiện trong `browser_capabilities`. Đây là vocabulary đề xuất, không phải tuyên bố driver đang hỗ trợ tất cả.

```json
{
  "contextRef": "ctx_demo",
  "tabRef": "tab_demo",
  "frameRef": "frame_main",
  "rootRef": null,
  "locator": {
    "kind": "attributes",
    "tag": "textarea",
    "attributes": { "name": "q" },
    "match": "exact"
  },
  "strict": true,
  "timeoutMs": 10000
}
```

Ví dụ này chỉ dùng được sau khi capability `locator.attributes` được triển khai. Không phải payload gửi thẳng đến extension. Adapter phải ánh xạ vào `FindSelectors.partialRequests` và xác minh frame/customId trước. Trong driver 23.4, `FindWebCtrlElements` là stub, `GetHtmlElemById` không xử lý DOM lookup thông thường; không dùng hai tên này làm đường discovery/get ref.

- `find_element`: cần đúng một match. Không tìm thấy → `NOT_FOUND`; nhiều match → `AMBIGUOUS_TARGET`, kèm danh sách ứng viên giới hạn để agent chọn lại.
- `find_elements`: trả 0..N refs, `matchCount` khi biết, `truncated` và `nextCursor`. Không có match là collection rỗng hợp lệ.
- `get_element`: chỉ đọc ref đã có. Có thể yêu cầu `fields=["text","value","attributes","state","rect"]`; thuộc tính chưa hỗ trợ phải được nêu rõ trong `unsupportedFields`, không trả giá trị suy đoán.
- Quan hệ `children`, `descendants`, `ancestor`, `relative` và `anchor` cần scope ổn định. Index là 0-based; thứ tự collection phải được định nghĩa. Chọn `nth` chỉ khi caller yêu cầu rõ.
- Iframe, cross-origin frame, shadow DOM và closed shadow root có capability riêng. Không dùng JS ở main frame để hứa xuyên mọi biên này.
- Match `role/name` phải có thuật toán accessible-name đã định nghĩa; không đổi ngầm thành tìm text tương tự. Selector healing hoặc semantic matching không tự chọn lại mục tiêu ghi.

## Capability và các mức bằng chứng

Mỗi capability cần `name`, `available`, `implementationStatus`, `backend`, `driverVersion`, `supportedOptions`, `limits`, `verificationLevel` và `unsupportedReason` nếu có. Ví dụ: `click.left` khác `click.right`; `screenshot.viewport` khác `screenshot.fullPage`; `dialog.alert` khác `dialog.prompt`.

| Mức | Ý nghĩa | Được dùng để khẳng định |
|---|---|---|
| `catalog-only` | Tìm thấy entry/handler trong source extension | Candidate cho adapter |
| `source-audited` | Đã truy vết dispatch và giới hạn của handler | Tuyến source cụ thể; có thể là stub/partial/unavailable |
| `isolated-probe` | Chạy handler với helper/DOM/API mock | Hành vi cục bộ đã probe; không chứng minh UI thật |
| `adapter-tested` | Adapter qua fixture/mock đúng schema và lỗi | Logic adapter trong phạm vi kiểm thử |
| `live-fixture-verified` | Đã chạy trên extension thật với fixture kiểm soát | Chức năng cụ thể ở version/platform đã thử |
| `workflow-verified` | Chuỗi nghiệp vụ đã có hậu kiểm | Workflow cụ thể, không suy mọi website |

Tên entry có trong catalog không đủ bật capability. Mặc định chỉ public các tool đã triển khai; nếu một tool nhiều action, từ chối action chưa hỗ trợ trước khi gửi lệnh. `browser_capabilities` cần cho biết version và lý do thiếu capability để agent lập kế hoạch.

Readiness được đánh giá theo tool và mode. Backend OCR là tùy chọn: thiếu Windows OCR chỉ làm `browser_ocr` unavailable, không chặn core hoặc tool advanced khác. `browser_semantic_query` có hai mode độc lập: AX cần Companion, natural-language cần model Ollama được cấu hình tường minh; mode đầu vẫn dùng được khi mode sau unavailable. Không có model thì runtime không gửi request tới Ollama. Caller có thể đọc screenshot artifact và tự chuyển image block cho provider đa phương thức của mình; runtime không tự gửi ảnh hoặc thay OCR bằng dịch vụ bên ngoài.

## Input chung và kết quả

Tool nhận JSON object có schema, các trường bắt buộc rõ và giới hạn kích thước. `contextRef` và target là bắt buộc cho thao tác trang; capability/status/list connection có thể không cần context. Không nhận nhiều target xung đột, ví dụ vừa `elementRef` vừa locator khác scope.

Các trường dùng chung theo tool: `timeoutMs`, `requestKey`, `verify` và `expectedDocumentGeneration`. `requestKey` do caller cấp giúp phát hiện lệnh gửi lại, không đồng nghĩa mọi action có exactly-once guarantee. `verify` mô tả hậu điều kiện cụ thể; mặc định đọc lại state khi action có state đọc được.

Kết quả đề xuất:

```json
{
  "ok": true,
  "requestId": "req_123",
  "context": {
    "contextRef": "ctx_demo",
    "tabRef": "tab_demo",
    "frameRef": "frame_main",
    "documentGeneration": 7
  },
  "data": {
    "elementRef": "el_demo",
    "dispatchState": "acknowledged",
    "outcome": "verified",
    "valueMatch": true
  },
  "evidence": {
    "kind": "readback",
    "condition": "valueEquals",
    "matched": true
  },
  "timing": { "elapsedMs": 184 },
  "error": null
}
```

`ok=true` nghĩa tool đạt hợp đồng của nó. Với action, `outcome=dispatched` chỉ xác nhận dispatch; `outcome=verified` cần hậu điều kiện. Không dùng chung một cờ success để suy cả click đã gửi, navigation đã xong và nghiệp vụ thành công.

`dispatchState` dùng `notSent`, `sent`, `acknowledged` hoặc `unknown`. Lỗi sau khi gửi có thể trả `ACTION_OUTCOME_UNKNOWN`; caller phải quan sát lại trước quyết định tiếp. Form fill/extract nhiều bước trả `partial` và kết quả từng bước, không hứa rollback.

Theo [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), server có thể dùng `structuredContent` kèm `outputSchema`; có thể kèm text để client tương thích. Lỗi thực thi tool trả `isError=true` và error object có cấu trúc; lỗi JSON-RPC/protocol tách riêng. Envelope trên thuộc bridge, không phải response nguyên bản của UiPath. Bốn tool hiện có vẫn giữ schema hiện tại đến khi có kế hoạch migration.

## Lỗi có thể xử lý bằng chương trình

| Mã đề xuất | Khi dùng | Agent xử lý |
|---|---|---|
| `BRIDGE_DISCONNECTED` | Native host hoặc connection đã mất | Kết nối/chọn lại context |
| `INVALID_ARGUMENT` | Input mâu thuẫn, thiếu hoặc sai kiểu | Sửa input |
| `UNSUPPORTED_CAPABILITY` | Tool/option/backend không có | Chọn bước khác theo capability |
| `NOT_FOUND` | Một target không tìm được trong thời hạn | Quan sát và đổi locator |
| `AMBIGUOUS_TARGET` | Có nhiều target khi cần đúng một | Thu hẹp scope/tiêu chí |
| `STALE_ELEMENT` | Ref hết vòng đời hoặc node đã mất | Tìm lại từ observation mới |
| `FRAME_UNAVAILABLE` | Frame không truy cập được hoặc thay thế | Chọn lại frame hoặc báo giới hạn |
| `ELEMENT_NOT_ACTIONABLE` | Hidden, disabled, che khuất hoặc không phù hợp action | Đợi/sửa bước trước; không force âm thầm |
| `TIMEOUT` | Deadline hết khi chưa đạt điều kiện | Dùng lastObserved; tránh lặp action mù |
| `ACTION_OUTCOME_UNKNOWN` | Có thể đã gửi action nhưng mất phản hồi | Đọc lại trạng thái trước khi làm tiếp |
| `SCRIPT_ERROR` | JS ném lỗi hoặc kết quả không serialize được | Sửa script; không tự chạy lại nếu có ghi |
| `RESULT_TOO_LARGE` | Kết quả vượt giới hạn/không chunk được | Thu hẹp fields/scope hoặc lấy artifact |
| `PERMISSION_DENIED` | Chrome, frame, filesystem hoặc backend từ chối | Báo yêu cầu cụ thể; không đổi policy âm thầm |
| `CANCELLED` | Caller hủy trước khi hoàn thành | Xem dispatchState để biết action có thể đã xảy ra |

Giữ `backendCode` để debug nhưng không buộc agent hiểu `retCode` của UiPath. Error cần `message`, `retryableRead`, `dispatchState`, `details` giới hạn và hướng khắc phục. Không đưa secret/raw cookies vào lỗi.

## Timeout, retry và điều phối

Mặc định đề xuất: read/action 10 giây; navigation/wait 30 giây; thao tác dài có timeout riêng tối đa cấu hình 120 giây. Đây là giá trị thiết kế, không đổi timeout hiện tại. Mọi bước con dùng cùng deadline còn lại thay vì mỗi helper bắt đầu timeout mới.

Read và polling có thể thử lại trong deadline khi lỗi transient. Click, type append, navigation, submit, dialog response và replay event không tự retry sau khi đã gửi hoặc không biết trạng thái. Desired-state action như `set_checked(true)` vẫn phải đọc lại trước khi thử tiếp; không mặc định event side effect là idempotent.

Broker tuần tự hóa thao tác ghi trong cùng tab/context và bảo vệ precondition generation. Readback phục vụ một action cần giữ cùng scope. Tác vụ khác hoặc người dùng vẫn có thể đổi trang; phát hiện bằng version/state trước dispatch, không tuyên bố lock được Chrome toàn cục.

Thao tác phụ thuộc active tab như screenshot viewport phải được điều phối theo **window**. Manual dialog response, khi được hỗ trợ, đi qua control path độc lập với action đang bị dialog chặn. Không xếp respond vào sau một click đang đợi chính dialog đó đóng.

Cancellation dừng chờ và không gửi bước tiếp theo; không đảm bảo thu hồi được input hay JS đã gửi. JS timeout không có nghĩa script bị kill: trả outcome chưa biết nếu script có thể vẫn chạy. Watcher luôn có TTL và cleanup.

Read-only/idempotent/destructive/open-world annotations phải phản ánh semantics thực tế. JS, cookie import, file write và click/type là thao tác có thể ghi; caller truyền `readOnly=true` không biến script tùy ý thành read-only. Tool nhiều action cần hint bảo thủ hoặc tách read/write nếu client cần phân quyền theo tool.

## Input và hậu kiểm

- `type` nhận text thông thường hoặc `secretRef`, có mode replace/append. Nhánh không debugger của driver ghim nhận đúng một token có `text`; đã probe việc chuyển tiếp text, chưa kiểm chứng input/event thật. Key tokens của debugger là schema khác. Không tự thêm Enter, Tab hoặc click Submit.
- `set_text` đặt giá trị theo control và contract event rõ; `set_attribute` chỉ đổi attribute. Một attribute đã đổi không đủ chứng minh framework nhận dữ liệu.
- `set_checked` đọc trạng thái trước và sau. Radio/tri-state cần khai báo capability; không ép thao tác không phù hợp control.
- `select_options` giới hạn native HTML select nếu adapter chỉ hỗ trợ loại đó. Custom combobox/menu dùng workflow tìm và click với postcondition riêng.
- `press_keys` dùng vocabulary portable như `Enter`, `Tab`, `Control+A`, hoặc danh sách `{key,modifiers}`; grammar cuối cùng cần schema nhất quán. Input method phải trả về trong evidence; không ngầm thay simulated event bằng OS input.
- Tọa độ phải có `coordinateSpace=cssViewport/cssDocument/screenDevice`, frame origin và DPR. Chuyển viewport screenshot sang OS click cần phép biến đổi đã kiểm chứng.

P0 action nhận `elementRef`. API P2 có thể nhận `visualTarget={screenshotRef,x,y,coordinateSpace,viewportGeneration}` thay thế, không nhận cả hai target. Backend pointer/debugger/native phải được xác minh trước khi bật capability này. Scroll/zoom/navigation/layout change làm observation không còn phù hợp phải invalidate visualTarget; không tạo DOM ref giả từ rectangle OCR. Hiện visual action là deferred.

`wait_for(absent)` dùng locator và xác nhận không có match. `wait_for(detached)` trên ref chỉ hoàn tất khi xác định node bị tháo khỏi cùng document. Stale do navigation, frame thay thế, disconnect hoặc ref không rõ nguồn vẫn trả lỗi; không coi mọi STALE_ELEMENT là điều kiện đã đạt.

## Watcher và luồng có trigger

| Nhóm | Chuỗi bước | Điều kiện hoàn tất |
|---|---|---|
| New tab | arm baseline → click → wait → attach ref | Tab mới khớp opener/time/pattern; nhiều match báo mơ hồ |
| JS dialog tự xử lý | arm responsePolicy có điều kiện → trigger; handler xử lý ngay khi xuất hiện → nhận receipt → cleanup | Dialog đúng type/message và response do caller chỉ định |
| JS dialog quyết định sau | arm → trigger trả operationRef/pending → nhận dialog → respond qua control path → hoàn tất operation | Deferred đến khi backend hỗ trợ trigger bất đồng bộ và respond độc lập |
| File picker | arm với mode → trigger → provide/cancel → verify | Backend xác nhận lựa chọn và ứng dụng nhận file |
| Download | arm folder/browser watch → trigger → wait → artifact | Có correlation và dấu hoàn tất; không lấy file cũ |
| Network | start monitor → trigger → wait quiet → stop | Quiet window đủ dài hoặc deadline; không suy business readiness |
| DOM event | subscribe → poll/cursor → unsubscribe | Event trong scope, queue hữu hạn, báo droppedCount |

Một tool với action enum giữ schema nhất quán: `arm` trả watchRef, `wait` cần watchRef, `cancel` thu hồi watchRef. Watcher không có backend được kiểm chứng phải trả unsupported trước trigger, để agent không click rồi mới phát hiện không xử lý được dialog.

Chỉ arm listener rồi chờ click kết thúc mới respond là không đủ: dialog có thể chặn callback của click. Với automatic policy, response phải được caller xác định trước, giới hạn theo tab/expectedType/messageMatch và TTL. Nếu chưa hỗ trợ manual async, từ chối mode đó trước trigger. Bộ kiểm chứng phải có alert/confirm/prompt phát sinh đồng bộ trong handler click.

Browser Dialog Scope dành cho JS alert/confirm/prompt. DOM modal, tab mới, OS file picker và browser permission prompt là bốn loại khác, không gom thành một popup API. `showOpenFilePicker`, input file và Save As dialog cũng có thể khác backend. Thiết kế giữ nguyên extension; backend phụ nếu cần phải được khai báo.

## JS, extract và kết quả lớn

`browser_evaluate` đi qua candidate **InjectAndRunJs**, nhận một anonymous function `(element,input)` và input JSON-serializable ở lớp MCP. `RunJS` chỉ gọi `CallableScripts[scriptName]` đã đăng ký, không là endpoint nhận mã tùy ý. Adapter chuyển sang string input/output theo contract [Inject JS của UiPath](https://docs.uipath.com/activities/other/latest/ui-automation/n-inject-js-script). Kết quả không serialize được và exception phải có quy tắc rõ; world/debugger/Promise cần kiểm chứng live. Không chỉ kiểm tra retCode: probe source cho thấy `retCode=1,isScriptErr=1` vẫn là lỗi script.

Extract table nhận schema cột, root, maxRows/maxPages và cursor. Trả cột có tên ổn định, null khi giá trị thiếu, source ref khi còn hợp lệ và cờ truncated. Tự chuyển trang là hành động ghi, mặc định tắt. Với virtualized list, kết quả chỉ là phần đã quan sát nếu không có traversal policy; không gắn nhãn full dataset.

Theo [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), host gửi sang Chrome tối đa khoảng 1 MiB/message; chiều extension gửi tới native host có giới hạn 64 MiB. Bridge hiện dùng một giới hạn 1 MiB cho cả hai chiều và IPC. Trước khi bật screenshot, phải chốt giới hạn nhận riêng có bound, kiểm tra memory và chuyển kết quả lớn sang artifact trước khi trả MCP/IPC. Không mặc định tăng tất cả đường truyền lên 64 MiB.

Driver trả base64 nguyên ảnh. Tham số `maxWidth` của MCP là postprocess sau khi nhận, không là tham số TakeScreenshot của extension đã khảo sát; nó không chữa được native frame đã bị decoder từ chối. Chunking chỉ dùng khi protocol hai bên hỗ trợ. Big-string lifecycle cũng phải được kiểm chứng, không coi tên entry là cơ chế truyền ảnh sẵn có.

VIEWPORT/ELEMENT/BOUNDS lấy ảnh bằng `captureVisibleTab(windowId)`. Mặc định từ chối tab không active; chỉ activate khi caller chọn chính sách cho phép, có window-scoped coordination và hậu kiểm active tab/document/viewport. FULLPAGE qua debugger là capability khác. Ảnh không đủ bằng chứng identity phải trả unverified/error thay vì gắn nhầm vào tabRef yêu cầu.

Snapshot đề xuất tối đa mặc định 200 nodes, text 2.000 ký tự/node, depth 6; find collection 100 refs/trang; table 500 rows/trang. Giới hạn được cấu hình và báo trong capability. Ảnh trả MCP image hoặc artifactRef với mediaType/kích thước, không nhét base64 dài vào text transcript. Cookie/password và field nhạy cảm được che khỏi log; việc che không làm thay đổi payload thao tác thật.

## Ví dụ luồng agent

Ví dụ sau mô tả API đích, chưa chạy được với bốn MCP tool hiện có. Locator phải thuộc capability đã được adapter triển khai.

1. `browser_capabilities({})`: kiểm tra connected, driver và find/type/click/wait.
2. `browser_attach({connectionRef,tabRef})` với tab/context đã chọn không mơ hồ: nhận contextRef. Connection discovery do capabilities cung cấp; không dùng contextRef chưa khởi tạo.
3. `browser_tab_open({contextRef, url:"https://www.google.com/"})`: nhận tabRef; giữ ref dù metadata đọc chậm.
4. `browser_snapshot({contextRef,tabRef})`: quan sát textarea/input tìm kiếm.
5. `browser_find_element({contextRef,tabRef,locator:{kind:"attributes",tag:"textarea",attributes:{name:"q"},match:"exact"},strict:true})`: nhận elementRef nếu đúng một match.
6. `browser_type({contextRef,elementRef,text:"UiPath browser automation",mode:"replace",verify:{condition:"valueEquals",expected:"UiPath browser automation"}})`.
7. Dừng sau nhập liệu nếu mục tiêu chỉ là điền. Nếu workflow yêu cầu tìm kiếm, gọi `browser_press_keys` với Enter rồi `browser_wait_for` bằng điều kiện kết quả; keys là P1.

Một luồng P0 không cần keys có thể tìm nút Submit theo snapshot rồi `browser_click`, sau đó wait điều kiện cụ thể. Agent không tự suy click thành công chỉ từ `dispatchState=acknowledged`.

Ví dụ primitive tương ứng các yêu cầu ban đầu:

| Nhu cầu | Tool đích | Input chính |
|---|---|---|
| Get element | `browser_get_element` | elementRef, fields |
| Find element(s) | `browser_find_element(s)` | locator, scope, strict/limit |
| Get attribute | `browser_get_element` | fields=[attributes], attributeNames |
| Get text/value | `browser_get_element` | fields=[text,value] |
| Click | `browser_click` | elementRef, button, clickCount |
| Type into | `browser_type` | elementRef, text, mode |
| Run JS | `browser_evaluate` | script, input, world |

## Điều kiện nghiệm thu trước khi public tool

| Nhóm fixture | Điều phải chứng minh |
|---|---|
| Context | Hai profile/tab cùng URL, disconnect/reconnect, ID tái sử dụng không thao tác chéo |
| Locator | 0/1/n matches, root/anchor/ancestor, collection phân trang, thứ tự ổn định |
| Ref | Full navigation, SPA re-render, node remove/replace, stale frame |
| Input | Native/controlled input, textarea, contenteditable, Unicode tiếng Việt, focus và input/change events |
| Action | Left/right/double click, disabled/hidden/occluded target, click gây navigation, outcome mất ACK |
| State | checked khác enabled, attribute khác property, hidden khác absent |
| Wait | Timeout/cancel, delayed node, route transition, network long-poll không treo vô hạn |
| Frame và shadow | Nested frame, cross-origin, shadow root được hỗ trợ và unsupported có nghĩa |
| Geometry | Zoom/DPR, nested scroll, element clip, screenshot inactive tab nếu backend hỗ trợ |
| Watchers | Arm trước trigger, hai download đồng thời, file cũ/partial, dialog không bỏ lỡ, cleanup TTL |
| JS và data | Promise/reject, serialization, oversize, partial table/form, cookie scope và cleanup |

Mỗi feature cần receipt gắn browser/extension/driver version, fixture, input đã che, quan sát trước/sau và kết quả. Mock test, source catalog, live primitive và workflow thực tế là các mức bằng chứng riêng. Tài liệu hiện tại đặt tiêu chí; không tạo kết quả kiểm thử giả cho các tính năng chưa triển khai.

## Điểm cần giải mã trước khi viết adapter

1. `FindSelectors.partialRequests`, selector matcher, return collection/customId/frame và invalidation. FindWebCtrlElements là stub; GetHtmlElemById không dùng làm DOM lookup.
2. Hoàn thiện `WriteTextHtmlElem.inputOptions`, nhánh debugger/special keys và event behavior. Nhánh không debugger đã xác định `tokens=[{text:...}]` ở source/probe, vẫn cần live input và readback.
3. Click `GenericRequest` messageId 6 ở driver 23.4, flags/coordinates/visibility; driver 23.10 dùng options khác.
4. Schema Select/Check/Scroll/InjectAndRunJs/ExtractData, retCode và isScriptErr. GetHtmlValue ở driver ghim đi qua GenericRequest messageId=5; RunJS chỉ có registered scripts.
5. Backend thực tế cho hover/drag/keys/dialog/file picker/download, capability của iframe/shadow và giới hạn screenshot/big-string.

Chỉ sau khi các điểm tương ứng được xác minh mới chuyển feature sang implementation. Chưa có thay đổi code, registry, extension hoặc MCP config từ bộ đặc tả này.
