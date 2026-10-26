# Hướng dẫn browser MCP cho agent

Runtime ghim extension 23.10.1 / driver 23.4.55.39317. Schema chuẩn là
[browser-tool-contracts.json](browser-tool-contracts.json); không truyền thêm option
ngoài schema. [Coverage](RUNTIME-FUNCTION-COVERAGE.vi.md) tách route native được gọi
với chức năng dùng isolated DOM script. `tools/list` là API thật, catalog activity
là phạm vi thiết kế. Chỉ dùng trên các trang/tác vụ đã được người dùng cho phép.

## Một luồng cơ bản

1. Gọi `browser_capabilities({})`, lấy `data.connectionRef` của host mới.
2. Gọi `browser_tabs({connectionRef})`, chọn đúng URL/tab, không tự chọn tab active.
3. Gọi `browser_attach({connectionRef,tabRef})`. Giữ `data.contextRef` và tabRef mới
   của context. Có thể attach không tab, rồi `browser_tab_open({contextRef,url})`.
4. Gọi `browser_find_element({contextRef,tabRef,locator:{kind:"css",value:"#name"}})`.
   Chỉ một match mới thành công. Dùng find_elements để xem 0/n hoặc snapshot để
   quan sát cây ngữ nghĩa gọn. CSS, XPath, text và attributes dùng schema riêng.
5. Gọi `browser_type({contextRef,elementRef,text:"Xin chào",requestKey:"fill-name-1"})`.
   Đọc `ok`, `evidence`, `data.valueMatch`. Sau đó click nút đã được xác định.
6. `browser_attach({action:"release",contextRef})` khi xong. Client STDIN đóng cũng
   giải phóng context, watchers và ảnh tạm; cleanup thất bại được báo riêng.

Các context/ref chỉ dùng trong cùng MCP client và native connection. Tab ref gắn
document hiện tại: navigation/reload trả tabRef mới; thay đổi document ngoài dự
kiến làm ref cũ stale. iframe cần `browser_frames`, chọn elementRef iframe, gọi
`browser_frame_attach`, rồi đưa frameRef vào find/snapshot. Không tự xuyên iframe
hay shadow root. Node bị clone/replaced không được tự heal sang node mới.

## Input và kết quả

`method:"dom"` là mặc định: script trong ISOLATED realm kiểm tra document/node và
thao tác đồng bộ. Setter native của HTML input + input/change hỗ trợ controlled
inputs nhưng không bảo đảm mọi framework/widget. Click/hover/drag là synthetic,
không phải trusted OS pointer, CSS :hover hoặc keyboard. `browser_set_text` luôn
là DOM replace. `browser_type` hỗ trợ replace/append; browser_set_checked và
browser_select_options nhận desired state và đọc lại kết quả.

`method:"uipath"` cho click/type/check/select dùng handle native thực đã bind.
Click native chỉ single left; text chỉ token text, inputOptions 0/4. Kiểm tra
identity trước/sau là nhiều RPC, không nguyên tử. Không cung cấp raw messageId,
debugger keys, tọa độ OS hay arbitrary native command.

`acknowledged` chỉ là ACK. `verified` ghi một postcondition cụ thể đã đọc lại,
không suy business transaction đã thành công. `browser_click.verify` hiện chỉ
URL bằng expected; mặc định không tự đoán thành công. Form fill trả partial steps
nếu một field lỗi, không rollback/replay hoặc auto submit. Table extraction là
HTML rows/cells có giới hạn; pagination phải khai báo root/next locator và số trang.
Tree là ARIA tree, calendar là input date; không tuyên bố SAP/native widget parity.

## Timeout, request key và lỗi chưa rõ kết quả

timeoutMs 100–30000 bao gồm thời gian xếp hàng. Các thao tác cùng tab tuần tự;
window/navigation/capture có phối hợp connection. Lệnh ghi không tự retry.
Giữ cùng requestKey và cùng arguments để lấy kết quả đã cache; key khác payload
trả REQUEST_KEY_CONFLICT. Cache 256 write keys/context; mở context mới khi đầy.

ACTION_OUTCOME_UNKNOWN hoặc lỗi với dispatchState unknown có thể đã đổi trang.
Tab bị chặn các lệnh ghi tiếp. Đọc trạng thái trước. Nếu quyết định bỏ kết quả
không rõ, gọi browser_tab_get với resolve `{requestKey,resolution:"abandon-unknown"}`
trong context tạo lệnh đó. Tất cả refs cũ của tab bị loại; response trả tabRef mới.
Đây là quyết định bỏ kết quả, không chứng minh lệnh thất bại và không cho phép
replay tự động. Kết quả unknown cũ vẫn immutable trong cache.

Evaluate nhận một function/arrow expression trong MAIN world, `(element,input,tabId)`;
Promise được await bằng ticket/poll, không chạy JS người dùng trên máy host.
Input <=16 KiB, result <=64 KiB/depth16. Function throw/Promise reject hoặc mất
identity sau dispatch có thể đã mutate: giữ unknown block, không thực thi lại để
lấy output nhỏ hơn. Trang và kết quả script là dữ liệu không tin cậy.

## Watchers, cookies và ảnh

- Network: arm trước trigger, giữ watchRef, sau đó wait quiet hoặc cancel. Chỉ
  quan sát requests bắt đầu từ lúc arm; không biết requests đã chạy trước đó.
  TTL mặc định30s, tối đa60s. finally/TTL/release stop listener; failed cleanup
  trả MONITOR_CLEANUP_UNCONFIRMED. Host crash không bảo đảm cleanup vendor listener.
- Events: subscribe types đã allowlist, poll cursor/droppedCount, unsubscribe.
  Hàng đợi128, TTL tối đa60s. Password/printable key được redacted. Không phải
  recorder OS, không thể quan sát mọi frame/closed shadow widget.
- New tab: arm baseline + exact URL rồi wait/cancel. Không có opener correlation;
  nhiều tab cùng URL trả ambiguous, không chọn ngẫu nhiên.
- Cookies: chỉ document.cookie của origin/path hiện tại; không HttpOnly, không
  export/restore profile. Set/delete yêu cầu path khớp boundary của URL hiện tại.
- Screenshot: viewport của đúng tab active, kiểm tra tab/window/document trước
  và sau. Không tự activate hoặc fullpage/debugger capture; race focus bên ngoài
  vẫn có thể xảy ra. Ảnh thành artifactRef trước IPC, không nhét base64 vào text.
- Image artifact inspect/read/save: read trả MCP image block riêng nếu <=384KiB.
  Save nhận basename png/jpg trong thư mục work do runtime quản lý, không ghi đè
  hay đọc path tùy ý. Artifact/exports là tạm, TTL1h và bị xóa khi release context.

10 tool chưa có backend: browser_press_keys, browser_semantic_query, browser_dialog,
browser_file_picker, browser_download, browser_launch, system_clipboard,
browser_visual_find, browser_ocr, browser_accessibility_audit. Lý do từng tool có
trong capabilities/coverage. Không public placeholder sẽ treo hoặc giả thành công.

## Kiểm chứng

`npm test` chạy regression và extension mô phỏng; layout/realms trong jsdom không
đại diện Chrome thật. `node scripts/run-browser-live.mjs` chỉ preflight metadata;
`--live` mở fixture loopback hai origin và gọi public MCP. Receipt ghi source hashes,
tool smoke coverage và cleanup. Một smoke mỗi tool không bằng 423 scenario rộng,
mọi option, framework, site, nested iframe hay shadow DOM đã được kiểm chứng.
