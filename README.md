# RPA Agent MCP

Local CLI/MCP bridge cho extension UiPath trên Chrome: **47 MCP tools** gồm bốn API legacy, `browser_capabilities` và 42 adapter browser. Xem [coverage runtime](docs/RUNTIME-FUNCTION-COVERAGE.vi.md) và [schema input/output](docs/browser-tool-contracts.json). 10 tool cần backend riêng được ghi unsupported và không xuất hiện trong `tools/list`.

```powershell
git clone https://github.com/OrgGem/rpa-agent-mcp.git
cd rpa-agent-mcp
npm ci
npm test
```

Yêu cầu runtime: Windows, Node.js 22.22.2+ (v22) hoặc 24.15+ và extension UiPath đã cài riêng. Xem phần cài đặt bên dưới để đăng ký native host. Các file native-host.json, native-host.cmd và registration-before.json được Setup.ps1 sinh trên máy cài và không được commit.

Bản thử nghiệm đã được kiểm chứng với extension **UiPath Browser Automation 23.10.1**. Native host riêng cung cấp kết nối cho CLI và MCP; không cần chương trình `ChromeNativeMessaging.exe` của UiPath cho các thao tác đã triển khai.

Public runtime đã đạt **7/7 nhóm live và42/42 tên tool browser mới** trên fixture hai origin/React, cùng64/64 offline tests. Screenshot PNG qua MCP đạt trong cửa sổ hiển thị; tab ẩn bị từ chối trước capture. Xem [kết quả và giới hạn](docs/BROWSER-LIVE-VERIFICATION.json) và [tiến độ phase](docs/DEVELOPMENT-PHASES.vi.md).

## Phạm vi hiện tại

- `status`: xem native host có kết nối hay không và số cửa sổ đã đăng ký.
- `versions`: gửi `GetEmbeddedDriverVersions` đến extension và nhận phản hồi theo `requestId` / `returnId`.
- `activate`: nạp và handshake với driver **23.4.55.39317** có sẵn trong extension.
- `open URL`: mở URL HTTP(S) trong tab mới bằng lệnh UiPath `OpenTab`.
- `tab ID`: đọc URL, tiêu đề và trạng thái tải bằng `GetHtmlAttribute`.
- `active`, `find URL_PATTERN`: các lệnh chẩn đoán chỉ đọc.
- `mcp`: MCP STDIO với session/tab/navigation, DOM read/snapshot/find/wait, input, iframe, evaluate, form/table/tree/date, watchers, cookies và ảnh.
- `browser_capabilities({})`: snapshot không dispatch browser action. Host mới trả schema v2 với connectionRef, tool availability, giới hạn và unsupported reasons. Availability không chứng nhận mọi option đã live; receipt G0 lịch sử tách khỏi acceptance public tool mới.
- [Hướng dẫn agent](docs/BROWSER-RUNTIME-GUIDE.vi.md): attach, refs, requestKey, xử lý lỗi, input method, artifact và cleanup.

Không phân phối lại mã extension của UiPath. Giao thức được khảo sát từ bản đã cài; chưa có cam kết tương thích các phiên bản khác. Xem `verification.json` để biết kết quả kiểm chứng thực tế, tách khỏi kiểm thử với extension mô phỏng.

Mốc bootstrap lịch sử ngày 2026-10-25: native host được Chrome khởi chạy, CLI và MCP STDIO nhận được 6 phiên bản driver từ extension thật. MCP đã mở `https://www.google.com/` qua `OpenTab`, rồi đọc lại URL, tiêu đề `Google` và trạng thái `complete` từ tab ID **561209531**. Hash `BackgroundMain.js` không đổi so với trước khi đăng ký host. Tại mốc bootstrap này chưa kiểm chứng click hoặc nhập liệu; public runtime hiện tại có receipt riêng ở trên.

Native host trả lời `LoadScripts` bằng metadata phiên bản và stub `return null;` để từ chối driver bên ngoài; extension chọn package nhúng tương thích. Không sao chép mã driver UiPath vào dự án. Prototype ghim driver 23.4 đã kiểm chứng trong extension 23.10.1; chưa cam kết với phiên bản extension khác.

`OpenTab` chỉ gửi một lần. Nếu metadata chưa sẵn sàng, adapter đọc lại metadata, không mở tab lặp. Kết quả giữ ID tab đã tạo kể cả khi chưa xác minh tải xong. Chỉ URL HTTP(S) không chứa thông tin đăng nhập được chấp nhận.

## Cấu trúc

`ChatGPT/Codex → MCP STDIO → IPC named pipe → native host → Chrome Native Messaging → extension UiPath`

Cùng entry point `src/bridge.mjs`, nhưng `mcp` và `native` là hai tiến trình: ChatGPT chạy phía MCP; Chrome chạy native host. IPC điều phối các thao tác trạng thái, phiên bản, nạp driver, mở URL và đọc thông tin tab cùng các lệnh chẩn đoán cố định; thông điệp được giới hạn 1 MiB và có timeout.

## Danh mục giao thức của extension

- [Guide tổng quan và đầy đủ tên lệnh](docs/UIPATH-EXTENSION-GUIDE.vi.md): 88 tên lệnh driver, 4 lệnh loader và các tuyến GenericRequest.
- [Bảng tương thích theo 6 driver nhúng](docs/FUNCTION-MATRIX.vi.md).
- [Catalog JSON](docs/uipath-function-catalog.json): trường request quan sát được theo từng phiên bản, tên handler, offset và SHA256 nguồn.
- [Ma trận triển khai đầy đủ](docs/EXTENSION-FUNCTION-MATRIX.vi.md): từng function/loader/callback/generic/content → adapter → MCP consumer → task/phase → test; unsupported có lý do và tuyến thay thế. [JSON](docs/extension-function-matrix.json) dùng cho validator.

Danh mục phản ánh các entry trong mã extension 23.10.1; những lệnh chưa triển khai trong bridge không tự trở thành MCP tool.

## Thiết kế tính năng browser automation

- [Feature catalog cho agent](docs/BROWSER-AUTOMATION-FEATURES.vi.md): 47 nhóm tính năng, 53 tên tool đề xuất, 21 tool ưu tiên MVP; input/output và tiêu chí nghiệm thu.
- [Mapping 168 tên activity UiPath](docs/BROWSER-ACTIVITY-MAPPING.vi.md): Modern, Classic, Semantic và hai helper Workflow được chọn; có phân loại phần cần backend riêng hoặc ngoài browser core.
- [Hợp đồng MCP](docs/BROWSER-MCP-CONTRACTS.vi.md): context/ref, locator, errors, timeout/retry, watchers và ví dụ luồng agent.
- [Feature registry JSON](docs/browser-feature-spec.json) và [kiểm tra tài liệu](docs/browser-docs-validation.json).

Đặc tả đã được [đối chiếu lại với extension ngày 2026-10-26](docs/EXTENSION-CAPABILITY-VERIFICATION.vi.md), có [audit route](docs/pinned-driver-audit.json), [probe cô lập](docs/EXTENSION-PROTOCOL-PROBES.json) và [receipt metadata live](docs/EXTENSION-LIVE-VERIFICATION.json). Receipt metadata kiểm tra bốn API legacy; kiểm chứng DOM/input riêng ở các receipt G0 bên dưới.

Catalog activity và ma trận cũ là baseline kế hoạch. Runtime mới dùng typed isolated DOM script cho nhiều chức năng; native literal discovery/iframe dùng FindSelectors, native click dùng GenericRequest 6, native text dùng WriteTextHtmlElem 0/4. GetHtmlValue generic 5 chỉ là route private G0 lịch sử; public read dùng script DOM. Không coi tên activity là bằng chứng endpoint vendor được gọi. [Coverage từng protocol row](docs/runtime-function-coverage.json) ghi rõ wired, dom-composite và not-wired.

## Phát triển theo phase

Xem [task theo phase](docs/DEVELOPMENT-PHASES.vi.md),
[quy trình EGM](docs/EGM-WORKFLOW.md) và [hợp đồng code](EGM.md).
Slice đầu triển khai capability discovery, kiểm thử offline và giữ API cũ.
Task kế tiếp đã thêm fixture/runner và private probe G0, tắt mặc định, không public
DOM tool mới. Xem [cách chạy preflight/live](scripts/README.md#g0-development-fixture)
và `npm run matrix:check` để kiểm tra coverage của plan.
Đã chuyển sang host repo mới và chạy [G0 main-frame smoke live đạt](docs/G0-LIVE-VERIFICATION.json):
find 0/1/2, đọc value, replace/append Unicode và click counter có report độc lập;
tab/server cleanup đạt. Probe đã tắt lại trên host đang kết nối. Đây chưa phải full
G0 hoặc API DOM công khai. [G0.4 live](docs/G0-4-LIVE-VERIFICATION.json) đã đạt
**11/11 ca** stale/remove/clone/reload/navigation/native reconnect, same/cross-origin
iframe và React 19.3.1 controlled DOM/model sau rerender. Hai lần lỗi được giữ cùng
bản sửa readiness/not-found semantics; **32/32 offline tests đạt**. Fixture/server
cleanup và tắt probe cả trong tiến trình lẫn launcher đã xác nhận. Guard fixture
không bảo đảm atomic identity/dispatch hoặc mọi framework/site; general DOM API
được giữ là bằng chứng lịch sử. Runtime public mới cần receipt riêng từ `node scripts/run-browser-live.mjs --live`; kết quả hiện tại nằm trong [plan](docs/DEVELOPMENT-PHASES.vi.md#runtime-public-f1f5-supported-subset).
Receipt tổng hợp có xác nhận UI độc lập rằng cửa sổ fixture đã biến mất; raw
CloseBrowser acknowledgement không tự được coi là cleanup pass.
Xem [receipt host](docs/HOST-TRANSITION-VERIFICATION.json) và
[kiểm tra MCP 5 tool](docs/MCP-HOST-VERIFICATION.json). Giữ trang nền
**UiPath Web Automation** mở; nó khác fixture thử nghiệm có thể đóng.
Capability trả bằng chứng live lịch sử có ngày/nguồn; gọi discovery không tạo
receipt live mới. Open/tab metadata chỉ báo available khi status xác nhận driver
ghim đã nạp; dùng legacy open/activate khi cần nạp driver có chủ đích.

## Cài đăng ký native host cho người dùng hiện tại

Yêu cầu Windows, Node.js 22.22.2+ (v22) hoặc 24.15+, Chrome và đúng extension đã khảo sát.

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
