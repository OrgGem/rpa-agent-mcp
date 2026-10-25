# Đối chiếu chức năng MCP với extension UiPath đã cài

Cập nhật 2026-10-26. Đối tượng: extension UiPath **23.10.1**, ID `jfcmnbofjlffnejneillkgbniiidiigd`, embedded driver **23.4.55.39317** mà bridge đang ghim. Các kết luận dưới đây không tự áp dụng cho driver 23.10 hoặc extension mới hơn.

**Bốn MCP tool hiện có đã qua kiểm chứng live mới. Các primitive DOM trong roadmap vẫn chưa được công bố là hỗ trợ.** Audit source tìm thấy tuyến tìm kiếm phù hợp hơn và sửa các mapping không đúng; việc có tuyến source chưa đủ chứng minh toàn bộ payload và hành vi trên browser thật.

## Bằng chứng

| Loại | Nội dung kiểm chứng | Kết quả |
|---|---|---|
| Live MCP | status, versions, mở URL fixture HTTP local, đọc đúng URL/title/complete | 4 tool đạt; tab fixture `561209538` |
| Audit dispatch | 88 tên union đối chiếu driver ghim | 78 direct entries; 10 không có direct entry |
| Handler có giới hạn | FindWebCtrlElements; GetHtmlElemById | Một stub không trả lời; một handler chỉ hữu dụng cho nhánh tìm tab |
| Generic routing | Bảng g_callMapping và special handlers | 39 mappings và 2 special handlers; có ID giao nhau, không cộng thành số command phân biệt |
| Content routing | Bảng dispatch trong content driver | 50 content IDs được ghi nhận; không đồng nghĩa 50 public host commands |
| Probe cô lập | Hai handler tìm phần tử cũ, một/two token WriteText, registry RunJS | 5 probe đạt điều kiện kiểm tra; DOM/Chrome/helper được mock |

[Receipt live](EXTENSION-LIVE-VERIFICATION.json), [audit toàn bộ entry/route](pinned-driver-audit.json), [probe offline](EXTENSION-PROTOCOL-PROBES.json). Source hash trong audit và receipt được đối chiếu để bảo đảm cùng bundle. Fixture server đã dừng; tab fixture được giữ để người dùng nhận diện lần kiểm chứng. Không có click/type/JS script/dialog/CV live trong receipt này.

## Mapping chức năng đã hiệu chỉnh

| Tính năng đích | Đường xử lý trong driver 23.4 | Trạng thái và giới hạn |
|---|---|---|
| Kết nối / phiên bản | Host status; loader GetEmbeddedDriverVersions | Live qua MCP |
| Mở tab / URL, title, load state | OpenTab; GetHtmlAttribute với customId rỗng và attrName metadata | Live qua MCP; không suy sang DOM attributes |
| Find một / collection | FindSelectors → content 8; GenericRequest 52 cũng ánh xạ content 8 | Có search engine trong source; schema và live behavior còn chờ G0 |
| FindWebCtrlElements | Direct handler chỉ khai báo biến | Stub; loại khỏi backend discovery |
| Get element theo ref | Resolver registry phía bridge + IsHtmlElemValid/GetHtmlAttribute và các reader phù hợp | Composite đề xuất; không dùng GetHtmlElemById làm DOM getter |
| GetHtmlElemById | Chỉ tìm browser tab với tabId=-1, index hợp lệ | Nhánh DOM tabId thông thường không trả lời |
| Get text/value | GenericRequest 5 → content 18; hoặc GetHtmlValueForElements | GetHtmlValue không có direct entry; chưa live DOM read |
| Get attribute/state/rect | GetHtmlAttribute, GetHtmlAttributesList, IsHtmlElemValid/Visible/Disabled, GetHtmlRectangle | Source routes; cần ref và kiểm chứng từng field/unit |
| Click | GenericRequest 6 → special onClickHtmlElem | Không gọi direct ClickHtmlElem; flags/coordinate/input method cần live probe |
| Type Into | WriteTextHtmlElem → content 45 hoặc debugger branch | Nhánh không debugger nhận một token.text; chưa chứng minh event/replace/append thật |
| Check / select | CheckHtmlElem; HtmlGetSelectedItems / HtmlSetSelectedItems | Source routes; state/options/control compatibility còn phải thử |
| Keyboard | WriteTextHtmlElem debugger/key parser hoặc text parser tùy options | Chưa có portable key adapter được kiểm chứng; không dùng IgnoreNextKeystrokeEvent làm send-key |
| Scroll / focus | BringElementIntoView, ScrollIntoView, MouseWheelDebugger; SetFocusedHtmlElement | Có route; wheel/debugger và tọa độ có điều kiện |
| Điều hướng / activate / focus window | Navigate; NavigationCommand | Source routes; activateWindow có đường focus window; home hardcode Google, không phải Chrome home config |
| Snapshot / wait / form | Composite từ FindSelectors + các reader/action hợp lệ | Bị chặn bởi G0 discovery/ref; không phải raw snapshot activity |
| Arbitrary JavaScript | InjectAndRunJs(jsCode,input,executionWorld) | Source route; injection có thể qua debugger; cần kiểm tra isScriptErr và live semantics |
| Registered JavaScript | RunJS(scriptName,inputArgs) | Chỉ CallableScripts[scriptName]; không nhận mã tùy ý |
| Table extraction | ExtractMetadata / ExtractData + helper batch | Source routes; metadata schema, pagination, virtualized rows chưa live |
| Viewport / element screenshot | TakeScreenshot → captureVisibleTab(windowId) | Phải xác nhận target active; có rủi ro chụp nhầm tab nếu adapter bỏ qua điều kiện |
| Full-page screenshot | TakeScreenshot → debugger Page.captureScreenshot | Capability riêng, chưa live; có device override/cleanup |
| Frame traversal | CustomId chứa frame; FindSelectors có cross-origin routing | Có cơ chế nội bộ; public frame enumeration và closed shadow support chưa được xác nhận |
| Network idle | Start/StopWebRequestMonitoring và AnyWebRequestsInFlight theo tabId | Source routes; URL filter hardcode all_urls; không hứa passthrough filters |
| Session data | GetBrowserData / SetBrowserData và big-string | Cookie path; không suy localStorage/sessionStorage/offline profile support |
| Hover / drag | SimulateEvent và các đường input là candidate cần khảo sát | Chưa xác định route bảo đảm pointer movement/CSS hover/HTML5 drag |
| JS dialog / file picker | Chưa xác nhận direct/generic endpoint phù hợp | Backend unresolved; permission debugger/downloads không tự tạo API MCP |
| Download completion | Filesystem/browser watcher do bridge xây | Composite/backend riêng, chưa có native command được kiểm chứng |
| OCR / CV / semantic | Engine/provider hoặc logic agent riêng | Không được cung cấp đầy đủ bởi embedded extension; visual action còn deferred |
| OS clipboard / process / native window | Helper/native backend ngoài DOM extension | Tùy chọn; chỉ focus/maximize có candidate extension đã xác định |

## Discovery và ref

`FindSelectors` trong driver ghim có request path thật: dựng dữ liệu tìm kiếm, gọi content command 8, xử lý result collection và frame rectangle. Content driver có `FindSelectors_OriginalRequest` và `FindSelectors_CrossOriginRequest`, selector matching và frame stack.

Các trường đã quan sát: `tabId`, `parentCustomId`, `partialRequests`, `startWithId`, `timeoutMs`, tọa độ window/page-render. Bên trong partial request có `m_tagInfosList`, `m_searchOption`, `m_parentScore`, `m_futureAttributeCount`; tag info có các nhánh attributes map khác nhau. Đây là trường quan sát, chưa phải payload hoàn chỉnh có thể copy chạy.

G0 phải xác minh enum, selector grammar, zero/one/multiple match, ref/customId và frame lifetime. Không thay stub bằng một messageId phỏng đoán. `GetHtmlIndex` có nhánh DOM gọi content 16; audit phân biệt nó với GetHtmlElemById, không gắn cả nhóm “GetHtml” là stub.

## Nhập liệu và JS

Probe cô lập xác nhận `Content.WriteText` nhánh không debugger nhận đúng một token rồi chuyển `token.text` vào input helper; hai token bị từ chối. Các bit source quan sát được: `PARSE_HOTKEYS_OPT=1`, `USE_DEBUGGER_OPT=2`, `APPEND_OPT=4`. Chưa kiểm chứng giá trị tổng hợp, thứ tự key events, controlled input hay replacement behavior trên browser thật. Public tool tiếp tục nhận text thông thường; adapter chịu trách nhiệm chuyển thành payload đã kiểm chứng.

`RunJS` dùng registry script theo tên. Khi tên không tồn tại, probe trả `retCode=1` cùng `isScriptErr=1`; vì vậy retCode thành công không đủ. Arbitrary JS phải đi qua InjectAndRunJs, kiểm tra cả lỗi script lẫn lỗi transport, và chỉ bật executionWorld/Promise behavior đã thử.

## Screenshot và điều phối

Viewport/element/bounds đều dùng tab active trong window. P0 chọn mặc định từ chối tab inactive; nếu caller cho phép activate, quản lý theo window và kiểm tra lại tab/document/viewport trước khi gắn evidence. Nhánh full-page không được suy từ viewport. [Chrome captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)

Driver trả base64 ảnh một lần. Giới hạn nhận 1 MiB hiện tại của bridge có thể từ chối ảnh trước khi xử lý maxWidth/artifact. Plan yêu cầu transport bound riêng cho chiều extension → host và lưu artifact trước MCP/IPC; không hứa chunking chưa có protocol. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

Dialog P2 phải arm response policy có điều kiện trước trigger. Manual decision chỉ được bật khi trigger có thể pending và respond không bị queue đang chờ dialog chặn. Visual action chỉ bật khi có visualTarget/point input backend, cùng cơ chế invalidate screenshot sau viewport change. Hai yêu cầu này đã được đưa vào [MCP contracts](BROWSER-MCP-CONTRACTS.vi.md).

## Gate triển khai

1. **G0 discovery/ref/input:** live fixture find → ref → read → input → readback, kiểm tra mơ hồ/stale và route/schema. Chưa đạt.
2. **P0 primitives:** triển khai từng nhóm trong 21 tool đích sau G0; không mở tool có route stub/unsupported option. Screenshot có gate active-tab và transport riêng.
3. **P1 composites:** keys, JS, extract/form, cookie/network/download theo capability thực tế. Không mở rộng từ một test primitive sang tất cả activity cùng nhóm.
4. **P2 backends:** dialog/file/vision/native và visual actions có hợp đồng và fixture riêng; giữ deferred khi chưa có đường input/response hoàn chỉnh.

168 activity là baseline đối chiếu nghiệp vụ; 53 tool là roadmap. Bộ số này không được dùng làm tỷ lệ extension đã hỗ trợ. [Feature registry](browser-feature-spec.json) ghi route, tình trạng source và bằng chứng riêng cho từng nhóm.
