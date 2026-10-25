# Script khảo sát và kiểm chứng

Chạy các lệnh từ thư mục gốc repository. Runtime bridge không cần package npm bên ngoài; Acorn và BeautifulSoup phục vụ công cụ khảo sát.

```powershell
npm ci
python -m pip install -r requirements-dev.txt
$env:UIPATH_EXTENSION_DIR = 'C:/path/to/installed/UiPath/23.10.1_0'
```

Nếu không đặt biến trên, script JavaScript dùng thư mục extension Chrome Default dưới LOCALAPPDATA trên Windows. Extension phải được người dùng cài riêng. Repository không chứa bundle extension hoặc các HTML tài liệu vendor đã tải.

## Kiểm thử bridge

`npm test` chạy test transport/MCP với extension mô phỏng. Không đụng registry hoặc browser thật.

`node Verify-Live.mjs` cần native host đã kết nối; mặc định kiểm tra status/version. Thêm `--open-url https://example.com/` sẽ mở tab thật. Script ghi receipt mới vào verification.json.

`node scripts/verify-plan-live.mjs` mở một fixture HTTP loopback qua MCP, xác minh metadata rồi dừng HTTP server. Nó để lại tab fixture, ghi docs/EXTENSION-LIVE-VERIFICATION.json và chưa kiểm chứng click/type/DOM.

## Audit source và probe cô lập

```powershell
node scripts/extract-uipath-catalog.mjs
node scripts/review-browser-plan.mjs
node scripts/audit-pinned-driver.mjs
node scripts/probe-pinned-content.mjs
```

Audit driver ghim 23.4.55.39317 trong extension 23.10.1. Source excerpts và AST intermediates chỉ ghi vào work/ đã gitignore. Probe dùng helper mock; không thay thế live automation. Các receipt được commit là bằng chứng lịch sử đã che đường dẫn máy, không phải kết quả vừa chạy trên máy clone.

## Nghiên cứu và sinh tài liệu

`research-browser-activities.py` và `fetch-activity-details.py` tải tài liệu UiPath về work/browser-activity-research. Nội dung `latest` có thể khác baseline ngày 2026-10-25 đã commit; hãy review diff danh sách trước khi cập nhật baseline.

`build-uipath-guide.mjs` là generator inventory ban đầu. Chạy nó có thể thay các chú thích audit được biên tập sau đó; phải đối chiếu pinned-driver-audit.json và giữ các kết luận stub/partial/registered-script trước khi commit lại guide.

`build-browser-feature-docs.py` áp dụng feature-route-revisions.py để sinh feature catalog, mapping và registry. `validate-browser-feature-docs.py` cần các snapshot nghiên cứu cùng evidence đã tạo; nó kiểm tra consistency của baseline cụ thể, không tự chứng minh runtime support. `validate-uipath-guide.mjs` kiểm tra inventory từ source và intermediate extraction.

Các script authoring lưu ngày baseline/verification cụ thể của lần nghiên cứu. Khi thực hiện audit mới, cập nhật ngày và review evidence thay vì coi dữ liệu lịch sử là kiểm chứng mới.

## Ma trận function và kiểm thử coverage

`npm run matrix:build` sinh [ma trận Markdown](../docs/EXTENSION-FUNCTION-MATRIX.vi.md)
và [JSON](../docs/extension-function-matrix.json) từ quyết định tường minh trong
build-function-matrix.mjs. `npm run matrix:check` đối chiếu đủ named/loader/callback/
generic/content, task và toàn bộ 53 tool roadmap. Test trong ma trận là kế hoạch;
validator coverage không chứng minh 423 ca runtime đã chạy.

## G0 development fixture

```powershell
node scripts/run-g0.mjs
```

Lệnh mặc định chỉ preflight, ghi work/g0-preflight.json; không mở tab. Host cũ hoặc
probe tắt trả lỗi rõ ràng và exit code khác 0.

Trên checkout đã được đăng ký làm native host, có thể bật probe bằng
`./Setup.ps1 -Mode Install -EnableG0Probe`, rồi tắt/bật extension khi các tác vụ
browser đã xong. Cờ được ghi vào launcher sinh tự động, không phải env của riêng
MCP client. Setup vẫn từ chối host thuộc checkout khác. Việc chuyển host cũ và
rollback thuộc F0.5; runner không tự sửa registry hoặc restart Chrome.

```powershell
node scripts/run-g0.mjs --live
```

Chế độ live chấp nhận probe protocol 1 hoặc 2 và source hash khớp driver ghim. Nó mở duy nhất
fixture loopback riêng, tìm 0/1/2 match, đọc, replace/append Unicode và click counter.
Readback qua extension được đối chiếu report từ script của fixture. Runner không
retry action; ghi receipt vào work/g0-live.json và thử đóng đúng fixture tab.
Cleanup không chắc chắn sẽ để lại tab và trả exit khác 0. Không đưa receipt này
thành bằng chứng gate G0 hoàn chỉnh: iframe, stale navigation, controlled inputs
và change/blur còn cần kiểm chứng riêng. Sau thử nghiệm, cài lại bằng plain
`./Setup.ps1 -Mode Install` rồi reload extension để tắt probe.

## G0.4 stale refs, iframe và React

`node scripts/run-g04.mjs` chỉ preflight; thêm `--live` mới mở fixture. Cần
`npm ci` để có React/react-dom/esbuild dev dependencies và native probe v2.
Bật bằng Setup Install -EnableG0Probe, rồi refresh tab **UiPath Web Automation**
và giữ tab đó mở. Runner không thay registry hoặc tự reload extension.

Suite dùng hai port loopback cho same/cross-origin iframe, React controlled
value thực, report DOM/model độc lập và rerender. Nó thử remove/clone/reload/
navigation, frame reload và từ chối ref cũ. Khi in G04_RECONNECT_REQUIRED, refresh
trang nền UiPath một lần; giữ fixture mở. PID và startedAt phải cùng thay đổi;
read/type bằng session cũ phải bị từ chối, rồi cleanup riêng đóng fixture cũ.

Receipt nằm ở work/g04-live.json; giữ receipt lần lỗi trước khi chạy lại fixture
mới. Không retry write không rõ kết quả. finish chỉ tắt probe trong tiến trình;
sau suite chạy plain Setup Install rồi xác nhận launcher không bật UIPATH_G0_PROBE,
preflight.enabled=false và status.g0ProbeProtocol=null. Không cần refresh thêm
chỉ để tắt khi finish đã thành công. Runner ghi launcherDisableVerified=false
cho đến khi bước hậu kiểm này được ghi trong receipt tổng hợp.

CloseBrowser chỉ cung cấp acknowledgement. Raw runner ghi tabCloseAcknowledged,
tabLeftOpen=null và tabClosureVerified=false; suite đạt nhưng còn chờ xác nhận
tab biến mất sẽ exit 2, cleanup.passed=false. Parent phải đối chiếu cửa sổ/tab
fixture cụ thể qua UI hoặc một backend tab-absence độc lập đã kiểm chứng, rồi
ghi cleanup tổng hợp riêng. Matrix chỉ nhận evidence có closure verification
và launcher disable; raw acknowledgement không đủ.

Document/node markers chỉ là guard của fixture. Nhiều RPC kiểm tra/ghi không
nguyên tử; hậu kiểm không thể hoàn tác input nếu race xảy ra. Suite không mở
public DOM tool hoặc chứng minh mọi framework/site/nested frame đều hỗ trợ.

## Chuyển host có rollback (PowerShell 7.2+)

`Switch-NativeHost.ps1 -PreviousRoot <checkout-cũ>` mặc định chỉ tạo snapshot và
Rollback.ps1 trong work/host-transition-*. Thêm `-Apply` để chuyển đăng ký HKCU
sang repo này và bật private probe. Nó từ chối HKLM/host không thuộc checkout đã
chỉ định; kiểm tra REG_SZ, checksum và đường dẫn cố định. Không sửa extension.

```powershell
pwsh -NoProfile -File scripts/Switch-NativeHost.ps1 -PreviousRoot 'C:/path/to/old-checkout' -SnapshotDirectory 'C:/path/to/rpa-agent-mcp/work/host-transition-local'
pwsh -NoProfile -File scripts/Switch-NativeHost.ps1 -PreviousRoot 'C:/path/to/old-checkout' -SnapshotDirectory 'C:/path/to/rpa-agent-mcp/work/host-transition-local' -Apply
```

Chỉ định đúng đường dẫn máy; snapshot chứa dữ liệu máy và phải ở work/ đã ignore.
Sau Apply, người dùng mở `chrome://extensions/?id=jfcmnbofjlffnejneillkgbniiidiigd`,
tắt rồi bật UiPath. Chỉ khi endpoint repo mới trả lời mới chạy G0 live.

Để khôi phục, chạy `pwsh -NoProfile -File <snapshot-folder>/Rollback.ps1`, rồi
tắt/bật extension nếu đã nối host mới. Rollback chỉ khôi phục sáu file generated
cố định và registry đã chụp, không xóa thư mục/source. Cần giữ nguyên cả hai checkout
và snapshot; không chạy snapshot nhận từ nguồn không tin cậy. `-ValidateOnly` kiểm
tra snapshot/quyền sở hữu mà không thay đổi gì.
