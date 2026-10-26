# Trạng thái backend advanced

Cập nhật 2026-10-26. Source static catalog định nghĩa 57 tool: 4 API legacy,
`browser_capabilities` và 52 browser tools. MCP/native host process đang chạy
chưa được reload; source catalog hoặc test response không xác nhận tool list của
process hiện tại. 42 tool core chỉ có live receipt lịch sử cho các source hash
trong receipt. Mười tool advanced có source adapter/backend riêng; receipt core
không kiểm chứng chúng hoặc source hashes hiện tại. Không suy ra 52/52 live hay
423 acceptance scenarios đã chạy từ source và offline tests.

`tools/list` là catalog tĩnh. Trước khi gọi tool, dùng `browser_capabilities` để
kiểm tra backend thực tế. Các hàng dưới tách module/test source khỏi trạng thái
Chrome live:

| Tool | Backend và gate cần có | Bằng chứng local hiện có | Live Chrome |
|---|---|---|---|
| `browser_press_keys` | Companion paired với đúng profile/tab; Chrome `debugger` input route và quyền extension. | Companion protocol/API mock tests và strict key-trigger integration; không gửi phím vào browser thật. | Chưa chạy. Cần cài Companion và fixture profile riêng. |
| `browser_semantic_query` | AX mode cần Companion accessibility tree. Natural-language cần `UIPATH_SEMANTIC_MODEL` và model đã cài trên Ollama loopback `127.0.0.1:11434`; không có remote fallback. | Direct HTTP client được kiểm tra với local fake server: allowlist candidate IDs, abstention, bounds, timeout. Không gọi model thật. | Chưa chạy. |
| `browser_dialog` | Companion pair + debugger event/response cho một dialog đã arm chính xác; policy xác định rõ leave-open/dismiss/respond. | Chrome API/mock state-machine tests. | Chưa chạy. |
| `browser_file_picker` | Companion file chooser interception và `DOM.setFileInputFiles`; `UIPATH_UPLOAD_ROOTS` là JSON array các root được phép, file được stage trước khi giao. Chỉ hỗ trợ HTML `input[type=file]`; OS picker và `showOpenFilePicker()` không được nhận là đã hỗ trợ. | Mock companion/file staging tests kiểm tra root, bounds và node binding. | Chưa chạy. |
| `browser_download` | Companion `chrome.downloads`; chỉ theo dõi ID do lệnh explicit start sở hữu. Download do click tùy ý không được ghép theo phỏng đoán. | Mock API tests cho start/status/cancel, owner và navigation lifetime. | Chưa chạy. |
| `browser_launch` | Windows PowerShell helper; `UIPATH_BROWSER_PROFILES` là JSON object alias → `{executablePath,userDataDir}` cho Chrome/Edge executable và profile cô lập đã cấu hình. Kết quả launch ban đầu là unpaired, không tự cấp browser refs. | Windows PowerShell 5.1 integration test dùng temp profile và inert window fixture để kiểm tra profile lock/PID correlation; không chạy Chrome. | Chưa chạy; chưa khởi tạo profile/config launch thật. |
| `system_clipboard` | Windows PowerShell STA trong interactive user session; thao tác ghi thay clipboard toàn hệ thống, đọc không được dùng trong readiness probe. | Process/protocol tests và kiểm tra lỗi/ACK; clipboard thật không được đọc hoặc ghi. | Chưa chạy. |
| `browser_visual_find` | `@techstark/opencv-js@5.0.0-release.1` + `pngjs@7.0.0`; nhận PNG screenshot artifact thuộc context, không nhận path tùy ý. | OpenCV thực tìm template trong PNG tổng hợp và trong artifact screenshot sở hữu qua runtime; constant-template rejection, bounds và cross-owner denial đạt. | Chưa chạy trên screenshot Chrome. |
| `browser_ocr` | Windows `Windows.Media.Ocr`; ngôn ngữ phải được cài sẵn. Host probe cho thấy `en-US`; các máy khác phải tự kiểm tra readiness. Nhận PNG artifact đã sở hữu, không đọc clipboard hay file path từ tool input. | WinRT OCR thực trên ảnh tổng hợp đọc được `MCP TEST 123` ở full image và crop; opt-in `RUN_WINDOWS_OCR_TEST` đạt 1/1. Không dùng browser/user image. | Chưa chạy trên screenshot Chrome. |
| `browser_accessibility_audit` | axe-core `4.14.0` (MPL-2.0), đóng gói cục bộ bởi Companion build; chạy bất đồng bộ qua ticket Companion. Cần load/register Companion và quyền đã nêu trong manifest. | Ticket thật + runtime audit handler dùng strict Companion request/reply envelope, owner isolation, poll success và cancel lock settlement; không chạy axe scan trên trang. | Chưa chạy. |

## Build, cấu hình và dữ liệu

`scripts/Build-Companion.ps1` tạo unpacked extension và manifest native host trong
`work/companion-unpacked`; `scripts/Setup-Companion.ps1` có các action đăng ký/
gỡ riêng. Companion build và package validation đã đạt; generated launcher test
cũng đạt với Unicode path và broker cô lập. Build chưa được load trong Chrome
hay đăng ký native host, chưa ghi registry, chưa thay quyền browser và chưa khởi
chạy Chrome/profile riêng. Sau khi source được deploy, MCP/native host cần reload;
advanced readiness còn cần load Companion và đăng ký host riêng. `UIPATH_UPLOAD_ROOTS`,
`UIPATH_SEMANTIC_MODEL` và `UIPATH_BROWSER_PROFILES` chỉ có tác dụng khi được cấu
hình trong MCP process của người dùng.

OCR và visual tests xử lý ảnh tổng hợp nội bộ. Ollama test dùng server giả loopback.
Clipboard không được chạm tới. Không có page data nào được gửi ra ngoài; không có
live audit/page scan.

## Kiểm chứng snapshot đóng băng

Source static catalog định nghĩa 57 tools; response `tools/list` trong regression
test là 352,519 bytes, dưới giới hạn 1 MiB. Đây không phải quan sát process đang
chạy, vì MCP/native host chưa được reload. Runtime coverage ghi 42 core tools, 10 advanced tools và
`advancedLiveVerified=0`; matrix validator đạt 188 protocol rows. **423**
acceptance scenarios vẫn là kế hoạch cho đến khi từng ca có evidence.

Focused backend suite đạt **43 local tests** và **44 Companion tests**; hai
integration tests mới chạy ticket manager/strict audit route và real OpenCV qua
screenshot artifacts cũng đạt **2/2**. Default `npm test` đạt **139 pass, 0 fail,
1 skip (140 total)**. Skip là test OCR opt-in; chạy riêng với
`RUN_WINDOWS_OCR_TEST=1` đạt **1/1**, gồm full image và crop. Unicode Companion
launcher, `npm run licenses:check` và `npm run matrix:check` đạt.

Review C01–C13 cùng key-trigger finding đã được đóng trong bounded source/test
review. License inventory có 74 package (9 production), gồm axe-core 4.14.0
MPL-2.0. Companion đã build/validate nhưng chưa cài/load hoặc đăng ký. Không có
advanced live receipt hoặc host-loaded hash receipt mới; core 42-tool live receipt
cũ chỉ ràng buộc với hashes/scope đã ghi. Không truy cập clipboard thật, không gọi
model thật, không scan trang thật và không khởi chạy browser profile.
