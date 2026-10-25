# Hướng dẫn giao thức và danh mục lệnh extension UiPath trên Chrome

Extension **UiPath Browser Automation 23.10.1** đóng gói 6 phiên bản driver, với **88 tên lệnh driver khác nhau** và **4 lệnh điều khiển loader**. Bridge local hiện dùng driver **23.4.55.39317** để nạp driver, mở tab và đọc metadata tab qua MCP. Những lệnh có trong mã extension nhưng chưa được bridge triển khai không tự xuất hiện thành MCP tool.

Cập nhật audit 2026-10-26: **entry tồn tại không đồng nghĩa handler hoạt động**. FindWebCtrlElements của driver ghim là stub không trả lời; GetHtmlElemById không xử lý DOM lookup thông thường. [Đối chiếu capability](EXTENSION-CAPABILITY-VERIFICATION.vi.md) và [audit route theo driver](pinned-driver-audit.json) là căn cứ cho kế hoạch implementation; các dấu A/B/C/D dưới đây chỉ nói về sự hiện diện entry.

## Phạm vi và phiên bản

Phạm vi là đường native host Win32 `com.uipath.chromenativemsg_v2` trên máy Windows đang dùng. Danh mục liệt kê các entry point trong bảng dispatch của driver, các tuyến `GenericRequest` được khai báo, và các lời gọi ngược có tên cố định về native host. Các hàm JavaScript nội bộ, hàm tiện ích, luồng Studio Web hoặc portable host và mọi Chrome API không được tính thành lệnh tự động hóa độc lập. Đây là tài liệu tương thích được khảo sát từ bản đã cài, không phải hợp đồng API công khai do UiPath phát hành.

| Driver nhúng | Giá trị codeVersion | Lệnh trực tiếp | Mapping GenericRequest | Handler GenericRequest đặc biệt |
|---|---|---:|---:|---:|
| 20.10.7992.24819 | `7992` | 40 | 0 | 0 |
| 21.10.34.30369 | `2258593` | 55 | 0 | 0 |
| 22.4.38.42025 | `2532393` | 65 | 0 | 0 |
| 22.10.44.61278 | `2944862` | 73 | 0 | 0 |
| 23.4.55.39317 | `23.4.55.39317` | 78 | 39 | 2 |
| 23.10.66.54596 | `23.10.66.54596` | 70 | 43 | 8 |

Số mapping và handler đặc biệt có thể trùng `messageId`; không cộng hai cột này để tính số thao tác duy nhất. Driver 23.10 có 70 entry gọi trực tiếp, còn driver 23.4 có 78; một số chức năng đã chuyển sang đường gọi theo ID.

## Cách đọc danh mục

- **A**: có entry trực tiếp ở cả driver 23.4 và 23.10.
- **B**: có entry trực tiếp ở 23.4, không có entry trực tiếp ở 23.10.
- **C**: có entry trực tiếp ở 23.10, không có entry trực tiếp ở 23.4.
- **D**: chỉ xuất hiện ở một hoặc nhiều driver cũ hơn trong bộ nhúng.

[Bảng tương thích đầy đủ](FUNCTION-MATRIX.vi.md) có từng lệnh trên cả 6 driver. [Catalog JSON](uipath-function-catalog.json) có tên handler, phiên bản, offset trong file nguồn và các trường request đọc trực tiếp trong từng handler. Danh sách trường này không phân biệt bắt buộc/tùy chọn, không bao quát các trường chỉ được đọc trong helper, và danh sách rỗng không có nghĩa là không cần tham số.

## Lệnh điều khiển loader

Các lệnh này được `LoaderWin32.OnNativeHostMessage` xử lý trước bảng lệnh driver.

| Function | Ý nghĩa |
|---|---|
| `CanLoadDriverVersion` | Hỏi package manager có thể nạp một detailedVersion hay không; chưa kiểm chứng runtime. |
| `GetEmbeddedDriverVersions` | Liệt kê phiên bản driver được đóng gói sẵn trong extension; bridge đã xác minh. |
| `OnProductVersionChanged` | Thông báo phiên bản driver cần dùng và khởi tạo quá trình nạp; bridge đã xác minh với driver 23.4. |
| `_ValidatePermissions` | Yêu cầu chạy logic kiểm tra quyền của extension; không tự cấp thêm quyền và chưa kiểm chứng runtime. |

## Lệnh driver theo nhóm

Mô tả dưới đây nêu vai trò chung của handler. Khả năng chạy trên một trang còn phụ thuộc phiên bản driver, ID phần tử, quyền Chrome, iframe, trạng thái trang và các điều kiện riêng của handler.

### Tab và cửa sổ

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `GetBrowserWindows` | Liệt kê ID các cửa sổ trình duyệt. | A | Chưa triển khai |
| `GetWindowIdForTabId` | Lấy ID cửa sổ chứa một tab. | A | Chưa triển khai |
| `GetActiveTabId` | Lấy tab đang hoạt động trong cửa sổ chỉ định hoặc cửa sổ Chrome được focus gần nhất. | A | Nội bộ bridge và CLI active; đã xác minh |
| `GetTabCount` | Đếm các tab mà extension nhìn thấy. | A | Chưa triển khai |
| `FindBrowserTabs` | Tìm tab theo tập thuộc tính như URL hoặc tiêu đề; trả về ID và thông tin khớp. | A | CLI find; đã xác minh |
| `IsBrowserTabActive` | Kiểm tra một tab có đang hoạt động hay không. | A | Chưa triển khai |
| `GetBrowserTabZoom` | Đọc mức zoom của tab. | A | Chưa triển khai |
| `MaximizeWindow` | Phóng to cửa sổ trình duyệt. | A | Chưa triển khai |
| `OpenTab` | Tạo tab mới trong cửa sổ chứa tab gốc; tabId = -1 yêu cầu tạo cửa sổ mới. | A | MCP uipath_open_url; đã xác minh |
| `Navigate` | Điều hướng một tab đang có đến URL khác. | A | Chưa triển khai |
| `ReplaceTabAndNavigate` | Tạo tab thay thế rồi đóng tab gốc khi điều hướng. | A | Chưa triển khai |
| `NavigationCommand` | Thực hiện thao tác điều hướng hoặc kích hoạt tab theo trường command. | A | Chưa triển khai |
| `CloseBrowser` | Đóng tab được chỉ định bởi tabId; không nên diễn giải tên này là luôn thoát toàn bộ Chrome. | A | Chưa triển khai |
| `OpenMarkerTabs` | Mở các marker tab phục vụ nhận diện hoặc phối hợp cửa sổ của driver. | C | Chưa triển khai |
| `CloseMarkerTabs` | Đóng các marker tab thuộc cơ chế đánh dấu của driver. | C | Chưa triển khai |

### Tìm và nhận diện phần tử

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `FindWebCtrlElements` | Tên entry legacy; ở driver 23.4.55.39317 handler chỉ khai báo biến, không trả callback. Không dùng cho DOM discovery. | A | Stub ở driver ghim |
| `GetHtmlElemById` | Driver ghim chỉ trả kết quả nhánh tìm browser tab với tabId=-1; nhánh DOM/index hợp lệ không trả lời. | A | Không dùng làm DOM getter |
| `GetHtmlCollectionById` | Tìm một tập phần tử trong phạm vi ID cha và các điều kiện thuộc tính. | D | Chưa triển khai |
| `GetHtmlIdInfo` | Đọc thông tin nhận diện và chỉ mục liên quan đến ID phần tử. | D | Chưa triển khai |
| `GetHtmlIndex` | Đọc chỉ mục của phần tử trong phạm vi tìm kiếm. | A | Chưa triển khai |
| `GetHtmlFromPoint` | Xác định phần tử HTML tại tọa độ chỉ định. | A | Chưa triển khai |
| `GetHtmlAncestryInfo` | Đọc thông tin chuỗi tổ tiên của phần tử. | A | Chưa triển khai |
| `GetSelectorAttributeNames` | Liệt kê thuộc tính dùng cho việc xây dựng selector. | A | Chưa triển khai |
| `FindSelectors` | Tìm phần tử bằng partialRequests/selector matcher, có frame routing; đi content 8 trong driver ghim. Schema và live lookup còn chờ xác minh. | B | Candidate discovery |
| `FindContainer` | Tìm container liên quan đến phần tử theo loại container. | B | Chưa triển khai |
| `MatchesTag` | Kiểm tra phần tử có khớp điều kiện tag hay không. | A | Chưa triển khai |
| `IsInstanceOfHtmlElement` | Kiểm tra đối tượng đích có là một HTML element theo logic driver. | C | Chưa triển khai |

### Đọc và sửa thuộc tính

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `GetHtmlAttribute` | Đọc một thuộc tính phần tử; ID rỗng có thể dùng để đọc thuộc tính tab như URL và title. | A | MCP uipath_tab_info; đã xác minh |
| `GetHtmlAttributesList` | Lấy danh sách thuộc tính của phần tử. | A | Chưa triển khai |
| `SetHtmlAttribute` | Gán thuộc tính cho phần tử HTML. | A | Chưa triển khai |
| `GetHtmlAttrValuesList` | Đọc danh sách giá trị thuộc tính theo yêu cầu. | A | Chưa triển khai |
| `GetHtmlValue` | Driver ghim không có direct entry; tuyến tương ứng là GenericRequest messageId 5 → content 18. | D | Chưa live DOM read |
| `GetHtmlValueForElements` | Đọc giá trị cho nhiều phần tử. | A | Chưa triển khai |
| `GetAttributeForElements` | Đọc một thuộc tính trên tập phần tử. | A | Chưa triển khai |
| `IsHtmlElemValid` | Kiểm tra ID phần tử còn phân giải được và hợp lệ. | A | Chưa triển khai |
| `IsHtmlElemDisabled` | Kiểm tra trạng thái disabled của phần tử. | A | Chưa triển khai |
| `IsHtmlElemVisible` | Kiểm tra khả năng hiển thị của phần tử theo handler của phiên bản tương ứng. | B | Chưa triển khai |
| `IsHtmlVisible` | Kiểm tra trạng thái hiển thị qua entry point của các driver cũ. | D | Chưa triển khai |
| `IsHtmlPointVisible` | Kiểm tra khả năng nhìn thấy hoặc tương tác tại một điểm của phần tử. | A | Chưa triển khai |
| `IsTabContentAccessible` | Kiểm tra driver có truy cập được nội dung tab. | A | Chưa triển khai |
| `GetFocusedHtmlElement` | Lấy phần tử đang có focus. | A | Chưa triển khai |
| `SetFocusedHtmlElement` | Đưa focus đến phần tử chỉ định. | A | Chưa triển khai |

### Click nhập liệu và lựa chọn

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `ClickHtmlElem` | Click phần tử qua entry point trực tiếp của driver cũ; các driver hiện tại dùng GenericRequest messageId 6. | D | Chưa triển khai |
| `WriteTextHtmlElem` | Nhập văn bản hoặc chuỗi token vào phần tử theo inputOptions và tokens. | A | Chưa triển khai |
| `CheckHtmlElem` | Thay đổi trạng thái chọn của checkbox hoặc radio theo doCheck. | A | Chưa triển khai |
| `HtmlGetSelectedItems` | Đọc các mục đang được chọn của control hỗ trợ selection. | B | Chưa triển khai |
| `HtmlSetSelectedItems` | Thay đổi các mục được chọn của control. | B | Chưa triển khai |
| `GetSelectedRange` | Đọc vùng lựa chọn của phần tử. | B | Chưa triển khai |
| `SetSelectedRange` | Gán vùng lựa chọn của phần tử. | B | Chưa triển khai |
| `IgnoreNextKeystrokeEvent` | Yêu cầu cơ chế theo dõi bỏ qua sự kiện phím kế tiếp theo flags hoặc mã phím. | D | Chưa triển khai |
| `SimulateEvent` | Phát sự kiện lên phần tử theo eventType, eventName và eventArgs. | A | Chưa triển khai |
| `MonitorNativeEvents` | Điều khiển cơ chế theo dõi sự kiện tương tác của driver. | A | Chưa triển khai |

### Tọa độ cuộn và ảnh chụp

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `GetHtmlRectangle` | Lấy hình chữ nhật của phần tử hoặc tab, với hệ tọa độ phụ thuộc tham số. | B | Chưa triển khai |
| `ScrollIntoView` | Cuộn để đưa phần tử vào vùng nhìn thấy. | B | Chưa triển khai |
| `BringElementIntoView` | Yêu cầu đưa phần tử vào vùng hiển thị theo cơ chế của driver. | A | Chưa triển khai |
| `GetHtmlDevicePixelRatio` | Đọc hệ số pixel giữa tọa độ CSS và thiết bị. | A | Chưa triển khai |
| `MouseWheelDebugger` | Cuộn bằng cơ chế debugger và các tham số hướng, khoảng cách hoặc delta. | A | Chưa triển khai |
| `GetTextFromScreenRect` | Yêu cầu đọc văn bản tương ứng với vùng hình chữ nhật qua driver. | A | Chưa triển khai |
| `GetRectFromText` | Tìm vùng hình chữ nhật tương ứng với văn bản mục tiêu. | A | Chưa triển khai |
| `TakeScreenshot` | Viewport/element/bounds chụp tab active trong window; full-page đi debugger. Cần identity check và transport bound. | A | Chưa live screenshot |
| `StartHighlight` | Bật đánh dấu trực quan cho đối tượng được chỉ định. | A | Chưa triển khai |
| `StopHighlight` | Dừng đánh dấu trực quan. | A | Chưa triển khai |

### Trích xuất dữ liệu và control đặc thù

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `ExtractMetadata` | Phân tích cấu trúc và metadata phục vụ trích xuất dữ liệu web. | A | Chưa triển khai |
| `ExtractData` | Trích dữ liệu theo metadata hoặc mô hình trích xuất đã cung cấp. | A | Chưa triển khai |
| `IsSamplePartOfANewColumn` | Kiểm tra mẫu trong quá trình phân tích cột của dữ liệu trích xuất. | A | Chưa triển khai |
| `GetSapFioriAllColLabels` | Đọc nhãn cột của control SAP Fiori được driver hỗ trợ. | A | Chưa triển khai |
| `TreeGetNodePath` | Đọc đường dẫn của một node trong control dạng cây. | B | Chưa triển khai |
| `TreeGetAllPaths` | Đọc tập đường dẫn trong control dạng cây. | B | Chưa triển khai |
| `TreeExpandPath` | Mở rộng một đường dẫn trong control dạng cây. | B | Chưa triển khai |
| `GetTaskMiningInfoFromPoint` | Lấy thông tin phần tử tại tọa độ cho cơ chế Task Mining. | A | Chưa triển khai |
| `GetTaskMiningInfoFromFocus` | Lấy thông tin phần tử đang focus cho cơ chế Task Mining. | A | Chưa triển khai |

### JavaScript debugger và giao thức

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `Handshake` | Kiểm tra driver đang nạp có xử lý và phản hồi được yêu cầu. | A | Nội bộ bridge; đã xác minh |
| `GenericRequest` | Điều phối yêu cầu theo messageId; có thể xử lý ở background hoặc chuyển thành contentCommandId. | A | Chưa triển khai |
| `InjectAndRunJs` | Yêu cầu chèn và chạy JavaScript qua cơ chế driver tương ứng. | A | Chưa triển khai |
| `RunJS` | Driver ghim gọi CallableScripts[scriptName] đã đăng ký; không nhận mã tùy ý. Kiểm tra cả retCode và isScriptErr. | A | Chưa triển khai |
| `AttachDebugger` | Gắn debugger vào tab theo cơ chế driver. | A | Chưa triển khai |
| `DetachDebugger` | Gỡ debugger khỏi tab. | A | Chưa triển khai |
| `SupportsDebugger` | Kiểm tra khả năng hoặc điều kiện sử dụng debugger. | A | Chưa triển khai |
| `EnableTracing` | Bật tracing theo handler trực tiếp có trong driver 23.10. | C | Chưa triển khai |

### Theo dõi mạng

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `StartWebRequestMonitoring` | Bắt đầu theo dõi các request mạng trong phạm vi yêu cầu. | A | Chưa triển khai |
| `StopWebRequestMonitoring` | Dừng theo dõi request mạng. | A | Chưa triển khai |
| `AnyWebRequestsInFlight` | Kiểm tra còn request mạng đang xử lý theo bộ theo dõi của driver. | A | Chưa triển khai |

### Cookie và bộ đệm chuỗi

| Function | Mô tả chung | Tương thích | Bridge hiện tại |
|---|---|---|---|
| `GetBrowserData` | Thu thập cookie và tuần tự hóa dữ liệu vào bộ đệm chuỗi được chỉ định. | A | Chưa triển khai |
| `SetBrowserData` | Khôi phục hoặc thay đổi cookie từ dữ liệu trong bộ đệm chuỗi. | A | Chưa triển khai |
| `SetBigString` | Tạo hoặc gán một chuỗi lớn trong bộ đệm của background driver. | A | Chưa triển khai |
| `AppendBigString` | Nối thêm dữ liệu vào chuỗi trong bộ đệm. | A | Chưa triển khai |
| `GetBigString` | Đọc chuỗi từ bộ đệm. | A | Chưa triển khai |
| `DeleteBigString` | Xóa mục chuỗi trong bộ đệm. | A | Chưa triển khai |

## Gọi thông qua GenericRequest

Ở driver 23.4 và 23.10, `GenericRequest` kiểm tra handler đặc biệt theo `messageId` trước; nếu không có thì dùng `g_callMapping` để chuyển sang `contentCommandId`. Hai loại ID này khác nhau. Bảng dưới liệt kê **46 messageId khác nhau được khai báo** ở hai driver này.

| messageId | Driver 23.4 | Driver 23.10 | Ý nghĩa khi có handler đặc biệt |
|---:|---|---|---|
| 2 | `contentCommandId = 16` | `contentCommandId = 16` | Đường chuyển tiếp theo bảng mapping |
| 4 | `contentCommandId = 17` | `onGetHtmlRectangle` | GetHtmlRectangle |
| 5 | `contentCommandId = 18` | `onGetHtmlValue` | GetHtmlValue |
| 6 | `onClickHtmlElem` | `onClickHtmlElem` | ClickHtmlElem |
| 7 | `contentCommandId = 45` | `contentCommandId = 46` | Đường chuyển tiếp theo bảng mapping |
| 10 | `contentCommandId = 11` | `contentCommandId = 11` | Đường chuyển tiếp theo bảng mapping |
| 11 | `contentCommandId = 1` | `contentCommandId = 1` | Đường chuyển tiếp theo bảng mapping |
| 12 | `contentCommandId = 23` | `contentCommandId = 23` | Đường chuyển tiếp theo bảng mapping |
| 13 | `contentCommandId = 25` | `contentCommandId = 25` | Đường chuyển tiếp theo bảng mapping |
| 14 | `contentCommandId = 15` | `contentCommandId = 15` | Đường chuyển tiếp theo bảng mapping |
| 15 | `contentCommandId = 29` | `contentCommandId = 29` | Đường chuyển tiếp theo bảng mapping |
| 16 | `contentCommandId = 12` | `contentCommandId = 12` | Đường chuyển tiếp theo bảng mapping |
| 17 | `contentCommandId = 21` | `contentCommandId = 21` | Đường chuyển tiếp theo bảng mapping |
| 18 | `contentCommandId = 38` | `contentCommandId = 39` | Đường chuyển tiếp theo bảng mapping |
| 19 | `contentCommandId = 9` | `contentCommandId = 9` | Đường chuyển tiếp theo bảng mapping |
| 20 | `contentCommandId = 37` | `contentCommandId = 38` | Đường chuyển tiếp theo bảng mapping |
| 21 | `contentCommandId = 22` | `contentCommandId = 22` | Đường chuyển tiếp theo bảng mapping |
| 22 | `contentCommandId = 19` | `contentCommandId = 19` | Đường chuyển tiếp theo bảng mapping |
| 23 | `contentCommandId = 27` | `contentCommandId = 27` | Đường chuyển tiếp theo bảng mapping |
| 24 | `contentCommandId = 13` | `contentCommandId = 13` | Đường chuyển tiếp theo bảng mapping |
| 25 | `contentCommandId = 14` | `contentCommandId = 14` | Đường chuyển tiếp theo bảng mapping |
| 34 | `contentCommandId = 10` | `contentCommandId = 10` | Đường chuyển tiếp theo bảng mapping |
| 36 | `contentCommandId = 28` | `contentCommandId = 28` | Đường chuyển tiếp theo bảng mapping |
| 38 | — | `onGetAttributeForElements` | GetAttributeForElements |
| 40 | `contentCommandId = 36` | `contentCommandId = 36` | Đường chuyển tiếp theo bảng mapping |
| 41 | `contentCommandId = 0` | `contentCommandId = 0` | Đường chuyển tiếp theo bảng mapping |
| 42 | `contentCommandId = 0` | `contentCommandId = 0` | Đường chuyển tiếp theo bảng mapping |
| 43 | `contentCommandId = 5` | `contentCommandId = 5` | Đường chuyển tiếp theo bảng mapping |
| 44 | `contentCommandId = 6` | `contentCommandId = 6` | Đường chuyển tiếp theo bảng mapping |
| 45 | `contentCommandId = 32` | `contentCommandId = 32` | Đường chuyển tiếp theo bảng mapping |
| 46 | `contentCommandId = 39` | `contentCommandId = 40` | Đường chuyển tiếp theo bảng mapping |
| 47 | `contentCommandId = 20` | `contentCommandId = 20` | Đường chuyển tiếp theo bảng mapping |
| 52 | `contentCommandId = 8` | `onFindSelectors` | FindSelectors |
| 54 | `contentCommandId = 30` | `contentCommandId = 30` | Đường chuyển tiếp theo bảng mapping |
| 55 | `contentCommandId = 31` | `contentCommandId = 31` | Đường chuyển tiếp theo bảng mapping |
| 60 | `contentCommandId = 35` | `contentCommandId = 35` | Đường chuyển tiếp theo bảng mapping |
| 63 | `contentCommandId = 7` | `contentCommandId = 7` | Đường chuyển tiếp theo bảng mapping |
| 64 | `contentCommandId = 44` | `contentCommandId = 45` | Đường chuyển tiếp theo bảng mapping |
| 65 | `contentCommandId = 43` | `contentCommandId = 44` | Đường chuyển tiếp theo bảng mapping |
| 66 | `contentCommandId = 42` | `contentCommandId = 43` | Đường chuyển tiếp theo bảng mapping |
| 67 | — | `contentCommandId = 26` | Đường chuyển tiếp theo bảng mapping |
| 68 | — | `contentCommandId = 24` | Đường chuyển tiếp theo bảng mapping |
| 75 | `onGetBrowserExtensionId` | `onGetBrowserExtensionId` | GetBrowserExtensionId |
| 77 | — | `onExecuteBrowserDriverRequest` | ExecuteBrowserDriverRequest |
| 79 | — | `onIsAllowedFileSchemeAccess` | IsAllowedFileSchemeAccess |
| 81 | — | `contentCommandId = 54` | Đường chuyển tiếp theo bảng mapping |

Các giá trị `contentCommandId = 0` được giữ nguyên từ bảng nguồn; danh mục không coi chúng là thao tác đã chạy thành công. Những hàng chỉ có mapping chưa có mô tả nghiệp vụ đầy đủ nếu không xác định được handler cuối. Không gửi trực tiếp contentCommandId như một messageId.

### Click và nhập liệu

Với driver đang dùng, click đi qua `functionCall: "GenericRequest"`, `messageId: 6`, không phải một lệnh tùy ý tên `click`. Handler 23.4 đọc `tabId`, `customId`, tọa độ, offset và `flags`. Handler 23.10 thay đổi sang đối tượng `options` và thêm `scrollTimeout`; không dùng lẫn schema hai bản.

Nhập liệu có entry `WriteTextHtmlElem`; các trường đọc trực tiếp gồm `tabId`, `customId`, `inputOptions` và `tokens`. `tokens` không được mặc nhiên coi là một chuỗi văn bản thuần; định dạng và bit flags cần được xác minh trước khi thêm tool nhập liệu.

ID phần tử phải được phân giải theo cơ chế driver. Với driver 23.4 đang ghim, candidate discovery là `FindSelectors` với partialRequests; `FindWebCtrlElements` là stub và không được dùng làm điểm bắt đầu. CSS selector hoặc chuỗi mô tả do AI tạo không tự biến thành customId. Gate discovery/ref/click/input live vẫn chưa đạt.

## Lời gọi từ extension về native host

Native host vừa gửi yêu cầu, vừa phải trả lời callback từ extension. Năm tên cố định dưới đây xuất hiện ở các call site đã xác định; những tên được tạo động không được coi là đã liệt kê đầy đủ.

| Function phía native host | Vai trò |
|---|---|
| `GetDetailedDriverVersion` | Extension yêu cầu thông tin phiên bản chi tiết để tìm driver tương thích. |
| `IsTraceEnabled` | Driver hỏi native host có bật tracing hay không; bridge hiện trả 0. |
| `LoadScripts` | Extension yêu cầu thông tin và gói driver; host hiện tại từ chối adapter ngoài để extension chọn driver nhúng. |
| `RegisterNewlyCreatedWindowId` | Extension đăng ký metadata cửa sổ và chờ callback khi có requestId. |
| `UnregisterWindowId` | Extension thông báo cửa sổ đã bị loại bỏ. |

## Thông điệp và vòng đời

Chrome khởi chạy native host khi extension gọi `chrome.runtime.connectNative`. Host và Chrome trao đổi JSON UTF-8 qua stdin/stdout; mỗi thông điệp Native Messaging có tiền tố độ dài 4 byte. MCP STDIO dùng JSON-RPC phân cách bằng newline, nên bridge xử lý hai transport riêng. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Extension đang cài tìm host `com.uipath.chromenativemsg_v2`. Host cần manifest có đúng tên và allowed_origins của extension, rồi xử lý các lời gọi đăng ký cửa sổ. Luồng khởi tạo driver đang dùng là `OnProductVersionChanged → LoadScripts → chọn package nhúng → Handshake`.

Ví dụ phong bì yêu cầu đọc URL của tab demo đã tạo:

```json
{
  "functionCall": "GetHtmlAttribute",
  "codeVersion": "23.4.55.39317",
  "requestId": "example-read-url-1",
  "tabId": 561209531,
  "customId": "",
  "attrName": "url"
}
```

Tab ID trong ví dụ chỉ thuộc phiên demo; lấy ID hiện tại từ phản hồi mở tab hoặc tìm tab trước khi gọi. `requestId` dùng để đối chiếu `returnId`, không phải ID phần tử. `codeVersion` phải khớp package đã được nạp. Host xử lý thành công hoặc thất bại theo từng phản hồi; không suy ra thành công chỉ vì pipe kết nối được.

Với bản 23.4, trạng thái readystate của tab có thể được trả dưới dạng chuỗi `"1"` hoặc `"0"`; bridge chuẩn hóa thành `complete` hoặc `loading`. Hệ tọa độ, frame ID, ID cache và tùy chọn input phải đi theo cùng phiên bản driver.

## Bridge và MCP hiện tại

| MCP tool | Lệnh extension sử dụng | Kết quả đã kiểm chứng |
|---|---|---|
| `uipath_bridge_status` | Trạng thái native host local | Host đang kết nối và các thông tin trạng thái |
| `uipath_driver_versions` | `GetEmbeddedDriverVersions` | 6 phiên bản driver từ extension thật |
| `uipath_open_url` | Nạp driver, `GetActiveTabId`, `OpenTab`, `GetHtmlAttribute` | Mở Google trong tab mới và đọc lại metadata |
| `uipath_tab_info` | `GetHtmlAttribute` | URL, title và trạng thái tải của tab chỉ định |

CLI còn có `find` dùng `FindBrowserTabs`, đã trả về kết quả từ extension thật. Demo Google có URL `https://www.google.com/`, title `Google`, trạng thái `complete`; xem [biên bản kiểm chứng](../verification.json). Việc client local gọi MCP đã được xác minh; việc ứng dụng ChatGPT/Codex đang mở nạp đủ tool vẫn là bước riêng.

Mở rộng bridge bằng một adapter cho từng thao tác đã xác định payload, rồi tạo MCP tool có schema rõ ràng. Không đưa toàn bộ 88 lệnh thành một tool raw tùy ý: caller cần phân biệt thao tác đọc, mở/đóng tab, thay đổi DOM, thực thi JavaScript và đọc/ghi cookie. Đặc biệt, CloseBrowser, ReplaceTabAndNavigate và SetBrowserData có thay đổi trạng thái khác với lệnh đọc thông tin.

## Nguồn và cập nhật

Nguồn chính là các bảng dispatch trong bản extension đang cài: `BackgroundMain.js` và `EmbeddedDriversContainer.js`. Catalog lưu SHA256 của các file nguồn và offset của từng entry. Không có mã driver UiPath được sao chép vào guide.

- [Tài liệu UiPath Chrome extension 2023.10](https://docs.uipath.com/studio/standalone/2023.10/user-guide/extension-for-chrome) mô tả cài đặt và phạm vi sản phẩm; không được dùng làm bằng chứng cho toàn bộ schema nội bộ trên đây.
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) mô tả transport và đăng ký host.
- [Danh mục JSON](uipath-function-catalog.json) lưu đủ 88 tên lệnh, trường request quan sát được theo phiên bản, loader, các tuyến GenericRequest và metadata nguồn.
- [Bảng tương thích](FUNCTION-MATRIX.vi.md) giúp chọn đúng entry point của 6 driver.

Khi cập nhật extension, so sánh lại hash nguồn, phiên bản driver, bảng functionCall, các messageId đặc biệt và schema request trước khi mở rộng hoặc tái sử dụng adapter. Một tên lệnh không đổi vẫn có thể đổi payload giữa các bản, như trường hợp click 23.4 và 23.10.
