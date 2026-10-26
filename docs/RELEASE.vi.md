# Đóng gói và nâng cấp

`npm run release:source` tạo source ZIP có SHA256 trong ignored work/releases.
Script dùng allowlist, gồm source runtime, Windows helpers và `companion/`, giữ
package-lock và schema runtime; nó từ chối generated native-host manifests,
node_modules, `.env`, axe bundle và vendor `EmbeddedDriversContainer.js`. Archive
không chứa cấu hình máy, extension bundle đã build hay dependency bundle. Build
không đăng ký host, chạy browser hay publish release. Đây chưa phải gói
binary/installer ký số.

Windows CI chạy Node22/24, npm ci, test, matrix/coverage và license inventory,
rồi dựng source archive. Cả hai job đã đạt trên commit a13599e (64 tests/job); xem [receipt CI](WINDOWS-CI-VERIFICATION.json). Cấu hình dùng action SHA cố định từ các repository
[checkout](https://github.com/actions/checkout) và
[setup-node](https://github.com/actions/setup-node); hosted runner không có UiPath
fixture thật và không được coi là browser live acceptance.

Upgrade tại cùng checkout: lưu công việc browser đang chạy, cập nhật source,
chạy npm ci, npm test và kiểm tra receipt/source hashes. Giữ các file generated
registration đã có; không ghi đè registration của host khác. Plain Setup Install
chỉ dùng nếu cần cập nhật launcher và sẽ bỏ opt-in G0 probe. Sau đó reload trang
nền UiPath Web Automation ở thời điểm không còn action in-flight. Runner public
so sánh hash host đã load với disk; cùng tên tool/version vẫn chưa đủ chứng minh
host đã nạp code mới. Không tự retry action chưa rõ kết quả sau upgrade.

Rollback registration dùng snapshot + Restore-NativeHost.ps1 đã có; trước hết
chạy ValidateOnly theo runbook chuyển host. Source rollback dùng Git, không xóa
snapshot hoặc uncommitted changes. Live gate, cleanup và artifact receipts phải
được kiểm tra lại sau lần load khác; offline tests không thay thế bước này.

`npm run licenses:check` so license metadata trong package-lock với inventory đã
review và allowlist. Inventory hiện có 74 package (9 production), gồm axe-core
4.14.0 theo MPL-2.0; Companion build chép đúng upstream license cạnh bundle axe.
Inventory là metadata check, không phải kết luận pháp lý. Source ZIP không chứa
bundle axe. MIT của dự án không cấp quyền cho extension/driver UiPath cài riêng.
Không bundle mã vendor. Public fixture receipt áp dụng riêng cho hashes cũ và
không thay thế kiểm chứng upgrade toàn diện. Signed binary installer và release
publication vẫn pending.

Final source snapshot: default suite đạt 139 pass, 0 fail, 1 skip; OCR opt-in chạy
riêng đạt 1/1 với full/crop. Companion build, package validation, Unicode launcher,
license check và matrix check đều đạt. Source ZIP được build và kiểm tra lại sau
khi cập nhật docs; ZIP chứa source Companion/helpers và loại generated machine
manifests, dependency tree, axe bundle và vendor driver. Companion chưa được
cài/load hoặc đăng ký và chưa có advanced live acceptance.

Có thể nạp source mới bằng cách xác minh đúng PID/path/command line của node native host thuộc repo, bảo đảm không có action in-flight rồi dừng riêng tiến trình đó. Extension23.10.1 đã tự reconnect sau timer10s trong kiểm chứng này. Luôn xác nhận host-loaded hashes sau đó; không kill Chrome hoặc giả định cơ chế này hoạt động trên mọi version.
