# Đóng gói và nâng cấp

`npm run release:source` tạo source ZIP có SHA256 trong ignored work/releases.
Script dùng allowlist, giữ package-lock và schema runtime, từ chối generated native
host, node_modules, .env hoặc vendor EmbeddedDriversContainer.js. Không đăng ký
host, chạy browser hay publish release. Đây chưa phải gói binary/installer ký số.

Windows CI chạy Node22/24, npm ci, test, matrix/coverage và license inventory,
rồi dựng source archive. Cả hai job đã đạt trên commit c020364; xem [receipt CI](WINDOWS-CI-VERIFICATION.json). Cấu hình dùng action SHA cố định từ các repository
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
review và allowlist. Inventory gồm cả dependency development, không phải kết luận
pháp lý. Dependency do npm cài giữ license của upstream. MIT của dự án không cấp
quyền cho extension/driver UiPath cài riêng. Không bundle mã vendor. Public fixture live đã đạt theo receipt riêng; không thay thế kiểm chứng upgrade toàn diện. Signed binary
installer và release publication vẫn pending.

Có thể nạp source mới bằng cách xác minh đúng PID/path/command line của node native host thuộc repo, bảo đảm không có action in-flight rồi dừng riêng tiến trình đó. Extension23.10.1 đã tự reconnect sau timer10s trong kiểm chứng này. Luôn xác nhận host-loaded hashes sau đó; không kill Chrome hoặc giả định cơ chế này hoạt động trên mọi version.
