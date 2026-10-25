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
