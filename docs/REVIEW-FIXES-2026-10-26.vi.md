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
làm lịch sử. Đợt sửa này chưa reload host, chưa chạy Chrome live và chưa có
CI remote mới; không chuyển423 scenario planned thành passed.
