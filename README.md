# RPA Agent MCP

Local CLI/MCP bridge cho extension UiPath trên Chrome. Runtime prototype có bốn tool; bộ tài liệu đi kèm mô tả roadmap và giới hạn đã audit.

```powershell
git clone https://github.com/OrgGem/rpa-agent-mcp.git
cd rpa-agent-mcp
npm ci
npm test
```

Yêu cầu runtime: Windows, Node.js 22+ và extension UiPath đã cài riêng. Xem phần cài đặt bên dưới để đăng ký native host. Các file native-host.json, native-host.cmd và registration-before.json được Setup.ps1 sinh trên máy cài và không được commit.

Bản thử nghiệm đã được kiểm chứng với extension **UiPath Browser Automation 23.10.1**. Native host riêng cung cấp kết nối cho CLI và MCP; không cần chương trình `ChromeNativeMessaging.exe` của UiPath cho các thao tác đã triển khai.

## Phạm vi hiện tại

- `status`: xem native host có kết nối hay không và số cửa sổ đã đăng ký.
- `versions`: gửi `GetEmbeddedDriverVersions` đến extension và nhận phản hồi theo `requestId` / `returnId`.
- `activate`: nạp và handshake với driver **23.4.55.39317** có sẵn trong extension.
- `open URL`: mở URL HTTP(S) trong tab mới bằng lệnh UiPath `OpenTab`.
- `tab ID`: đọc URL, tiêu đề và trạng thái tải bằng `GetHtmlAttribute`.
- `active`, `find URL_PATTERN`: các lệnh chẩn đoán chỉ đọc.
- `mcp`: MCP STDIO với `uipath_bridge_status`, `uipath_driver_versions`, `uipath_open_url`, `uipath_tab_info`.
- Chưa triển khai đọc nội dung DOM, click, nhập liệu hoặc thay thế UiPath Robot. Mở tab thành công không chứng minh các chức năng đó hoạt động.

Không phân phối lại mã extension của UiPath. Giao thức được khảo sát từ bản đã cài; chưa có cam kết tương thích các phiên bản khác. Xem `verification.json` để biết kết quả kiểm chứng thực tế, tách khỏi kiểm thử với extension mô phỏng.

Đã kiểm chứng ngày 2026-10-25: native host được Chrome khởi chạy, CLI và MCP STDIO nhận được 6 phiên bản driver từ extension thật. MCP đã mở `https://www.google.com/` qua `OpenTab`, rồi đọc lại URL, tiêu đề `Google` và trạng thái `complete` từ tab ID **561209531**. Hash `BackgroundMain.js` không đổi so với trước khi đăng ký host. Chưa kiểm chứng click hoặc nhập liệu.

Native host trả lời `LoadScripts` bằng metadata phiên bản và stub `return null;` để từ chối driver bên ngoài; extension chọn package nhúng tương thích. Không sao chép mã driver UiPath vào dự án. Prototype ghim driver 23.4 đã kiểm chứng trong extension 23.10.1; chưa cam kết với phiên bản extension khác.

`OpenTab` chỉ gửi một lần. Nếu metadata chưa sẵn sàng, adapter đọc lại metadata, không mở tab lặp. Kết quả giữ ID tab đã tạo kể cả khi chưa xác minh tải xong. Chỉ URL HTTP(S) không chứa thông tin đăng nhập được chấp nhận.

## Cấu trúc

`ChatGPT/Codex → MCP STDIO → IPC named pipe → native host → Chrome Native Messaging → extension UiPath`

Cùng entry point `src/bridge.mjs`, nhưng `mcp` và `native` là hai tiến trình: ChatGPT chạy phía MCP; Chrome chạy native host. IPC điều phối các thao tác trạng thái, phiên bản, nạp driver, mở URL và đọc thông tin tab cùng các lệnh chẩn đoán cố định; thông điệp được giới hạn 1 MiB và có timeout.

## Danh mục giao thức của extension

- [Guide tổng quan và đầy đủ tên lệnh](docs/UIPATH-EXTENSION-GUIDE.vi.md): 88 tên lệnh driver, 4 lệnh loader và các tuyến GenericRequest.
- [Bảng tương thích theo 6 driver nhúng](docs/FUNCTION-MATRIX.vi.md).
- [Catalog JSON](docs/uipath-function-catalog.json): trường request quan sát được theo từng phiên bản, tên handler, offset và SHA256 nguồn.

Danh mục phản ánh các entry trong mã extension 23.10.1; những lệnh chưa triển khai trong bridge không tự trở thành MCP tool.

## Thiết kế tính năng browser automation

- [Feature catalog cho agent](docs/BROWSER-AUTOMATION-FEATURES.vi.md): 47 nhóm tính năng, 53 tên tool đề xuất, 21 tool ưu tiên MVP; input/output và tiêu chí nghiệm thu.
- [Mapping 168 tên activity UiPath](docs/BROWSER-ACTIVITY-MAPPING.vi.md): Modern, Classic, Semantic và hai helper Workflow được chọn; có phân loại phần cần backend riêng hoặc ngoài browser core.
- [Hợp đồng MCP](docs/BROWSER-MCP-CONTRACTS.vi.md): context/ref, locator, errors, timeout/retry, watchers và ví dụ luồng agent.
- [Feature registry JSON](docs/browser-feature-spec.json) và [kiểm tra tài liệu](docs/browser-docs-validation.json).

Đặc tả đã được [đối chiếu lại với extension ngày 2026-10-26](docs/EXTENSION-CAPABILITY-VERIFICATION.vi.md), có [audit route](docs/pinned-driver-audit.json), [probe cô lập](docs/EXTENSION-PROTOCOL-PROBES.json) và [receipt live mới](docs/EXTENSION-LIVE-VERIFICATION.json). Bốn tool hiện có đạt trên fixture HTTP local; chưa có click/type/DOM live.

P0 còn chờ gate G0 discovery/ref/input. FindWebCtrlElements là stub trong driver ghim; candidate discovery đúng hơn là FindSelectors. GetHtmlValue đi qua generic message 5, click qua message 6, arbitrary JS qua InjectAndRunJs. Các tên `browser_*` vẫn là đề xuất; baseline activity UiPath `latest` không đồng nghĩa extension 23.10.1 hỗ trợ toàn bộ.

## Cài đăng ký native host cho người dùng hiện tại

Yêu cầu Windows, Node.js 22+, Chrome và đúng extension đã khảo sát.

```powershell
.\Setup.ps1 -Mode Install
node .\src\bridge.mjs status
node .\src\bridge.mjs versions
node .\src\bridge.mjs open https://www.google.com
node .\src\bridge.mjs tab 561209531
```

Setup tạo manifest cùng launcher `.cmd`, đăng ký **HKCU** `com.uipath.chromenativemsg_v2`. Nó từ chối ghi đè host khác, lưu trạng thái trước khi cài vào `registration-before.json`, và không thay đổi extension hoặc policy Chrome.

Nếu extension chưa tự kết nối lại, tắt/bật extension UiPath trong `chrome://extensions` sau khi các tác vụ trình duyệt hoàn tất. Không cần thoát Chrome bằng cách cưỡng bức dừng tiến trình.

## MCP local

Trên máy kiểm chứng, bốn tool đã được gọi thành công bằng MCP client local riêng; chưa xác nhận việc khám phá tool trong mọi giao diện ChatGPT/Codex. Sau khi clone, cấu hình MCP client của bạn với command `node` và hai arguments: đường dẫn tuyệt đối tới `src/bridge.mjs`, rồi `mcp`.

`mcp.example.toml` dùng đường dẫn placeholder; thay bằng vị trí clone của bạn. Có thể dùng đường dẫn tuyệt đối đến node.exe nếu client không nhận PATH.

## Kiểm thử và gỡ đăng ký

```powershell
npm test
node .\Verify-Live.mjs
.\Setup.ps1 -Mode Status
.\Setup.ps1 -Mode Uninstall
codex mcp remove uipath_bridge
```

Uninstall chỉ xóa đăng ký do prototype này tạo. Host đang chạy kết thúc khi Chrome ngắt kết nối; chương trình không cưỡng bức đóng Chrome. Giữ nguyên thư mục dự án khi đang dùng host hoặc cấu hình MCP trỏ vào đó.

Demo có điều hướng thật: `node .\Verify-Live.mjs --open-url https://www.google.com`. Tùy chọn này mở tab mới; lệnh kiểm chứng mặc định không mở trang web.

## Nguồn

Các script audit, probe và sinh tài liệu nằm trong [scripts](scripts/README.md). Receipt đã commit là bằng chứng lịch sử; đường dẫn máy được thay bằng placeholder. Giấy phép [MIT](LICENSE) của repository áp dụng cho code bridge và công cụ của dự án; extension UiPath được cài riêng và không được phân phối trong repository.

- Chrome Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- MCP local trong ChatGPT/Codex: https://learn.chatgpt.com/docs/extend/mcp
- MCP STDIO: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Bản extension được khảo sát: ID `jfcmnbofjlffnejneillkgbniiidiigd`, phiên bản `23.10.1`, Manifest V3.
