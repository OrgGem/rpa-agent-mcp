# Review đặc tả browser MCP

Ngày review: 2026-10-26. Phạm vi: feature catalog, mapping activity, MCP contracts, feature registry và các đường xử lý liên quan trong extension UiPath 23.10.1, driver 23.4.55.39317.

Cập nhật sau review: bốn finding dưới đây đã được phản ánh vào **plan**, xem [đối chiếu extension](EXTENSION-CAPABILITY-VERIFICATION.vi.md). R1 chuyển discovery sang candidate FindSelectors và đặt gate live; R2 bổ sung active-tab/window/transport constraints; R3 bổ sung response policy và manual-async gate; R4 bổ sung visualTarget và deferred action. Đây là xử lý ở mức đặc tả, chưa phải bốn runtime fix đã triển khai. Phần dưới giữ nguyên nội dung review ban đầu để truy vết.

Kết luận: cấu trúc primitive MCP, context/ref và hậu kiểm phù hợp với mục tiêu agent automation. Bộ tài liệu dùng được làm danh mục tính năng. Trước khi chốt kế hoạch triển khai MVP, cần sửa hai giả định backend ở mức P1. Hai điểm P2 cần chốt trước khi triển khai dialog và visual automation.

Các số 168 tên activity, 47 nhóm tính năng, 53 tool đề xuất và 21 tool P0 khớp registry. Đây là số lượng coverage thiết kế, không phải số capability đã chạy được. Bốn tool hiện có vẫn là phạm vi implementation được ghi nhận.

## P1 Đường định vị P0 trỏ tới handler không trả kết quả

Vị trí: [feature find](BROWSER-AUTOMATION-FEATURES.vi.md#find), [snapshot](BROWSER-AUTOMATION-FEATURES.vi.md#snapshot), cùng hướng dẫn lấy ID phần tử trong [extension guide](UIPATH-EXTENSION-GUIDE.vi.md).

Feature find và snapshot dùng `FindWebCtrlElements` làm candidate nền tảng. Trong chính driver 23.4.55.39317 đang ghim, `onFindWebCtrlElements` chỉ có khai báo biến; không gọi callback, không dispatch content request. `onGetHtmlElemById` cũng chỉ trả lời nhánh tìm tab khi `tabId == -1` hoặc index không hợp lệ; với tab DOM thông thường và index hợp lệ, handler kết thúc không trả lời.

Đã trích đúng AST của driver, chạy hai handler trong sandbox JavaScript offline với helper tối thiểu: callback không được gọi. Dispatcher của driver gọi trực tiếp handler từ `g_functionCallMap`; BackgroundMain chuyển request vào adapter, không có nhánh riêng cho hai tên này. Đây là bằng chứng source/probe cục bộ, chưa phải một lần gọi live vào extension.

Tác động: nếu adapter triển khai theo hai candidate này, thao tác tìm element trong tab sẽ chờ đến timeout. Toàn bộ chuỗi find → get → click/type và snapshot dùng lại ref bị chặn. `handlerFound=true` và `activeDriver=true` trong catalog chỉ chứng minh entry tồn tại, không chứng minh handler hoạt động.

Sửa đề xuất:

1. Đánh dấu hai đường này là `stub` hoặc `partial` trong mapping của driver hiện tại, thay mô tả candidate chung chung bằng giới hạn đã xác định.
2. Chốt một đường discovery thực sự trả customId/ref: tìm tuyến protocol khác hoặc triển khai query adapter qua cơ chế script đã kiểm chứng. Chưa khẳng định GenericRequest đã có đường thay thế.
3. Giữ bước khảo sát protocol trước implementation, nhưng tiêu chí ra khỏi bước này phải là một vòng live trên fixture: find đúng một input → đọc attribute/value → thao tác → đọc lại. Không lấy việc tìm thấy tên hàm làm tiêu chí đạt.

## P1 Screenshot theo tabRef có thể lấy ảnh của tab khác

Vị trí: [feature screenshot](BROWSER-AUTOMATION-FEATURES.vi.md#screenshot), phần tuần tự hóa theo tab/context trong [MCP contracts](BROWSER-MCP-CONTRACTS.vi.md#timeout-retry-và-điều-phối).

API đề xuất nhận `tabRef` và trả ảnh viewport/element. Tuy nhiên, `onTakeScreenshot` của driver hiện tại lấy `windowId` từ tab được yêu cầu, rồi nhánh VIEWPORT/ELEMENT/BOUNDS gọi `chrome.tabs.captureVisibleTab(windowId, ...)`. Trong handler không có bước activate tab được yêu cầu. Chrome định nghĩa API này chụp **tab đang active trong cửa sổ được chỉ định**. [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)

Ví dụ: tab A đang active, agent yêu cầu ảnh tab B trong cùng cửa sổ. Nếu adapter gọi candidate này trực tiếp, ảnh viewport có thể là A nhưng được gắn context của B; crop element còn có thể dùng bounds B trên ảnh A. Hậu kiểm bằng ảnh lúc đó sai mục tiêu. Nhánh full-page dùng debugger khác; phát hiện này không quy toàn bộ mode về cùng một đường.

Sửa đề xuất: khai báo `requiresActiveTab` theo mode; chọn chính sách reject tab không active hoặc activate có chủ đích. Nếu activate, quản lý và kiểm tra lại trạng thái tại phạm vi **window**, vì hai queue theo tab vẫn có thể đổi active tab của cùng cửa sổ. Gắn identity tab/document/viewport vào ảnh; khi phát hiện active tab đổi trong khoảng capture, trả lỗi hoặc kết quả chưa xác minh, không gắn ảnh cho target cũ. Thêm fixture hai tab cùng cửa sổ và một lần đổi active tab trong khi capture.

## P2 Luồng dialog chưa giải quyết thao tác trigger đang bị chặn

Vị trí: [feature dialog](BROWSER-AUTOMATION-FEATURES.vi.md#dialog) và [watcher contracts](BROWSER-MCP-CONTRACTS.vi.md#watcher-và-luồng-có-trigger).

Contract hiện mô tả `arm → trigger → wait/respond`, đồng thời yêu cầu tuần tự hóa thao tác ghi trong tab. Nếu click/evaluate mở alert/confirm và chờ callback hoặc hậu kiểm, tác vụ trigger có thể chưa hoàn tất cho đến khi dialog được xử lý. Agent đợi tool trigger trả về mới gọi respond, hoặc respond xếp sau trigger trong cùng queue, sẽ không tiến triển cho tới timeout. Tài liệu Playwright cũng chỉ ra rằng listener chỉ quan sát dialog mà không xử lý có thể làm action bị treo; đây là tính chất modal cần tính đến khi thiết kế backend. [Playwright dialogs](https://playwright.dev/docs/dialogs)

Đây là gap thiết kế có điều kiện, chưa phải lỗi runtime đã tái hiện trong bridge, vì dialog chưa được triển khai.

Sửa đề xuất: chọn một trong hai contract rõ ràng. Cách đơn giản là arm trước với response policy do caller chỉ định và điều kiện khớp dialog, để handler xử lý ngay khi xuất hiện. Nếu cần agent đọc nội dung rồi quyết định, trigger phải trả operationRef/pending và đường respond phải hoạt động độc lập với queue đang bị chặn. Thêm tiêu chí nghiệm thu alert/confirm/prompt phát sinh đồng bộ trong click handler; arm listener đơn thuần chưa đủ.

## P2 Kết quả visual chưa nối được vào public action

Vị trí: [feature visual](BROWSER-AUTOMATION-FEATURES.vi.md#visual), [click](BROWSER-AUTOMATION-FEATURES.vi.md#click), [hover](BROWSER-AUTOMATION-FEATURES.vi.md#hover), [drag](BROWSER-AUTOMATION-FEATURES.vi.md#drag).

Visual/OCR trả rectangle, confidence và sourceScreenshot. Các action công khai lại nhận `elementRef` hoặc sourceRef/targetRef; chưa có target tọa độ hoặc visualRef tương ứng. Với nút chỉ được vẽ trong canvas, OCR có thể tìm đúng vùng nhưng agent không có input hợp lệ để click. Việc chuyển rectangle thành elementRef trỏ canvas cũng không giữ được vị trí nút bên trong canvas.

Do đó, dù thêm provider OCR, các activity Click Image, Click OCR Text hoặc CV Click vẫn chưa có chuỗi public tool hoàn chỉnh. Ghi chú “chưa có parity” đã phản ánh trạng thái hiện tại, nhưng API đích vẫn cần một đường hành động để hoàn thành nhóm này.

Sửa đề xuất: thêm target union `element`/`point` hoặc một tool pointer riêng. Target point phải gắn screenshotRef, tab/frame, coordinateSpace và viewport generation; invalidate sau scroll, zoom, navigation hoặc layout change liên quan. Backend input và hậu kiểm cần được xác định riêng. Nếu chưa muốn hỗ trợ thao tác tọa độ, ghi visual P2 là đọc/định vị và giữ các visual action ở trạng thái deferred.

## Điều chỉnh ưu tiên và các điểm cần chốt

- Giữ 53 tên tool như roadmap; chốt adapter discovery trước khi cam kết triển khai đồng loạt 21 tool P0. Sau discovery, chạy một workflow nhỏ hoàn chỉnh rồi mở rộng từng primitive.
- Cân nhắc đưa Enter/Tab và key chord tối thiểu vào MVP. Nhiều form cần keyboard event/blur để hoàn tất tương tác; đây là ưu tiên sản phẩm, không phải lỗi bắt buộc trong danh mục hiện tại.
- Viết rõ bootstrap `capabilities → attach → tab_open`; ví dụ hiện dùng contextRef ở bước mở tab nhưng không chỉ ra bước lấy contextRef.
- Phần screenshot lớn cần kế hoạch transport cụ thể trước triển khai: bridge đang giới hạn cả nhận và gửi ở 1 MiB, trong khi Chrome cho phép extension gửi tới native host tới 64 MiB. Driver trả base64 nguyên ảnh; `maxWidth` chưa là tham số của handler đã khảo sát. Artifact sau transport không xử lý được frame đã bị decoder từ chối. Đây là hạng mục cần chốt, không phải tuyên bố phải tăng giới hạn lên tối đa. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Phạm vi kiểm chứng

Đã đọc ba tài liệu thiết kế, registry, code bridge/transport liên quan và các handler cần thiết trong extension đã cài. Đã đối chiếu AST, thực thi cô lập hai handler định vị, kiểm tra số lượng registry và tham chiếu tài liệu Chrome/Playwright cho semantics tương ứng. [Evidence JSON](PLAN-REVIEW.evidence.json) ghi hash nguồn, offsets và kết quả probe.

Chưa chạy thao tác browser mới, chưa kiểm chứng tuyến discovery thay thế, chưa chạy click/type/dialog/CV E2E. Review được lưu riêng; các finding là yêu cầu sửa kế hoạch trước implementation, không phải các fix đã áp dụng.
