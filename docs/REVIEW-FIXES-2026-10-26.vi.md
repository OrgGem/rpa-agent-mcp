# Sửa bảy lỗi từ review toàn repo

Baseline review: `95e5017861de3cb392749fead956bf4fe623e76b`.
Phạm vi là sửa contract/lifecycle đã có; không thêm MCP tool hay native route.

| Finding | Bản sửa | Kiểm chứng hồi quy |
|---|---|---|
| P1: network wait timeout khóa tab, không resolve được | Cleanup thành công giữ TIMEOUT của quan sát. Wait vẫn reserve key để cleanup unknown có thể resolve | Busy network + timeout100ms: monitor được stop, không unknown block, type tiếp thành công. Stop thất bại: generated key có record unknown và resolve được |
| P2: cache256 key chặn release | Release dùng cleanup promise của context, không cấp/cache action key. Valid resolution có tối đa256 chỗ dự phòng. Không evict write history hay cho invalid resolution vượt quota |256 ghi thành công rồi release.255 ghi + một unknown rồi resolve, dedup resolution và release. Invalid resolution không làm tăng cache |
| P2: pagination dùng rootRef cũ | Scope tồn tại qua các vòng cùng document; sau navigation dùng lại explicit rootLocator, xử lý cả navigation phát hiện trong find kế tiếp | Bảng hai trang với rootRef: DOM update, navigation ngay và navigation trễ đều đọc One/Two, không replay Next |
| P2: pagination báo notSent sau click | Evidence readback giữ dispatchState thực của operation | Đọc một trang không click: notSent. Phân trang có click: acknowledged |
| P2: timeout phải chờ tiền nhiệm | Timer riêng cho thời gian xếp hàng; trả lỗi đúng lúc, bỏ dispatch của request hết hạn, giữ predecessor barrier cho lệnh sau | Giữ write đầu bằng gate: read/write queued hết hạn trước khi mở gate; cached timeout không dispatch; write sau không vượt hàng |
| P2: ASCII làm hỏng đường dẫn Unicode | Manifest/launcher UTF-8 không BOM; CMD chọn65001 trước dòng Unicode, tắt delayed expansion, escape dấu phần trăm | Chạy launcher thật trên Windows trong đường dẫn có chữ Việt, khoảng trắng, dấu ! và phần trăm; binary stdin/stdout1024 bytes giữ nguyên, argv/probe flag/exit code đúng |
| P2: URL.pathname gây lỗi fixture path | Chuyển URL sang filesystem bằng fileURLToPath | Copy module/JSX vào thư mục có khoảng trắng/chữ Việt, build và phục vụ bundle thành công |

Test chính: [runtime regressions](../test/browser-review-regressions.test.mjs),
[fixture path](../test/browser-fixture.test.mjs),
[Windows launcher](../test/host-transition.test.mjs).

`npm test`: **71 tests,71pass,0fail,0skip** trên Windows/Node24.21.0.
Suite bao gồm các kiểm tra matrix/coverage hiện có. Đây là unit/integration
cô lập, jsdom/native mocks và launcher process thật, không phải Chrome live mới.
Launcher test ghi file tạm và chạy Node stub; không sửa registry/native host
đang cài. Các test không tự replay browser write sau kết quả không rõ.

Source hashes đã đổi nên coverage runtime không công nhận receipt public live
cũ cho source mới. Receipt7/7 nhóm,42/42 tool và CI64/64 trước đó giữ nguyên
làm lịch sử tại thời điểm commit bản sửa. Kết quả kiểm thử live tiếp theo ở dưới;
không chuyển423 scenario planned thành passed.

## Kiểm chứng lại trên Chrome sau bản sửa

Runtime của commit `2db694bb3e89ff65132a8c13fdb44c53f8349e13` đã được nạp lại;
12/12 hash nguồn/contract đang chạy khớp checkout. Probe tắt, host connected và
cleanupUnconfirmed=0 sau kiểm thử. Đã mở `https://example.com/` qua browser
connector để chọn cửa sổ hiển thị; mọi thao tác ghi của suite chạy trên fixture
loopback riêng. Không cần người dùng mở tab hoặc approve thêm.

Bộ public live đạt **7/7 nhóm,42/42 browser tool mới**; tools/list47, tổng45 tên
tool được gọi gồm capabilities và hai legacy status/version. Same/cross-origin
iframe reload, stale refs, React retained inputs, native/DOM input, events,
network/cookies/navigation và PNG artifact đều qua. Receipt hiện tại:
[BROWSER-LIVE-VERIFICATION.json](BROWSER-LIVE-VERIFICATION.json).

Runner hồi quy mới [run-review-live.mjs](../scripts/run-review-live.mjs) đạt
**6/6 nhóm** với hash nguồn chạy thực; xem
[REVIEW-LIVE-VERIFICATION.json](REVIEW-LIVE-VERIFICATION.json):

| Ca live | Bằng chứng |
|---|---|
| Mạng còn request chờ khi wait hết500ms | TIMEOUT/notSent; type+readback tiếp thành công; arm/cancel monitor mới thành công |
| Read/write hết hạn trong queue | Trả TIMEOUT khoảng310ms trước khi predecessor kết thúc; report độc lập không có input chạy muộn/vượt hàng; chỉ nhận after queue |
| Phân trang thay DOM | Hai trang One/Two, partial=false, evidence acknowledged, đúng một Next click |
| Phân trang navigation trễ100ms | RootRef ban đầu được thay bằng locator sau navigation; hai trang, đúng một Next và một page2 load |
| Cache256 write key | Key vượt quota trả LIMIT_EXCEEDED và không đổi DOM; release cleanupConfirmed |
| Cache255 write + một unknown | Invalid recovery vẫn bị giới hạn; explicit abandon-unknown thành công; lấy ref mới sau recovery rồi xác minh DOM; release cleanupConfirmed |

Tabs của runner đã được đóng và rediscovery xác nhận không còn; tất cả context,
server và MCP child đã cleanup. Runner không replay action không rõ kết quả.
Trong quá trình hoàn thiện runner đã sửa cách đọc envelope legacy và ref cũ sau
explicit recovery; các lần lỗi được giữ ở work/, đều cleanup, không sửa runtime.

Giới hạn: lỗi native StopWebRequestMonitoring thất bại chỉ được kiểm tra bằng
mock offline; không gây lỗi này vào extension live. Unicode launcher/path có
kiểm chứng Windows process/filesystem riêng, chưa đăng ký Chrome từ checkout
Unicode. Không xác nhận mọi website/option hay423 scenario; CI remote của đợt
kiểm thử này chưa được kiểm tra.
