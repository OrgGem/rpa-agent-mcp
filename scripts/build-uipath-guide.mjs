import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = '.';
const docs = path.join(root, 'docs');
await mkdir(docs, { recursive: true });
const data = JSON.parse(await readFile('work/uipath-extracted.json', 'utf8'));
const current = '23.4.55.39317', latest = '23.10.66.54596';
const live = new Set(['Handshake', 'GetActiveTabId', 'OpenTab', 'GetHtmlAttribute', 'FindBrowserTabs']);
const definitions = {
  'Tab và cửa sổ': {
    GetBrowserWindows: 'Liệt kê ID các cửa sổ trình duyệt.',
    GetWindowIdForTabId: 'Lấy ID cửa sổ chứa một tab.',
    GetActiveTabId: 'Lấy tab đang hoạt động trong cửa sổ chỉ định hoặc cửa sổ Chrome được focus gần nhất.',
    GetTabCount: 'Đếm các tab mà extension nhìn thấy.',
    FindBrowserTabs: 'Tìm tab theo tập thuộc tính như URL hoặc tiêu đề; trả về ID và thông tin khớp.',
    IsBrowserTabActive: 'Kiểm tra một tab có đang hoạt động hay không.',
    GetBrowserTabZoom: 'Đọc mức zoom của tab.',
    MaximizeWindow: 'Phóng to cửa sổ trình duyệt.',
    OpenTab: 'Tạo tab mới trong cửa sổ chứa tab gốc; tabId = -1 yêu cầu tạo cửa sổ mới.',
    Navigate: 'Điều hướng một tab đang có đến URL khác.',
    ReplaceTabAndNavigate: 'Tạo tab thay thế rồi đóng tab gốc khi điều hướng.',
    NavigationCommand: 'Thực hiện thao tác điều hướng hoặc kích hoạt tab theo trường command.',
    CloseBrowser: 'Đóng tab được chỉ định bởi tabId; không nên diễn giải tên này là luôn thoát toàn bộ Chrome.',
    OpenMarkerTabs: 'Mở các marker tab phục vụ nhận diện hoặc phối hợp cửa sổ của driver.',
    CloseMarkerTabs: 'Đóng các marker tab thuộc cơ chế đánh dấu của driver.'
  },
  'Tìm và nhận diện phần tử': {
    FindWebCtrlElements: 'Tìm phần tử web theo thuộc tính, phạm vi cha và giới hạn kết quả; dùng ID riêng của UiPath.',
    GetHtmlElemById: 'Lấy hoặc phân giải phần tử dựa trên ID mà driver quản lý.',
    GetHtmlCollectionById: 'Tìm một tập phần tử trong phạm vi ID cha và các điều kiện thuộc tính.',
    GetHtmlIdInfo: 'Đọc thông tin nhận diện và chỉ mục liên quan đến ID phần tử.',
    GetHtmlIndex: 'Đọc chỉ mục của phần tử trong phạm vi tìm kiếm.',
    GetHtmlFromPoint: 'Xác định phần tử HTML tại tọa độ chỉ định.',
    GetHtmlAncestryInfo: 'Đọc thông tin chuỗi tổ tiên của phần tử.',
    GetSelectorAttributeNames: 'Liệt kê thuộc tính dùng cho việc xây dựng selector.',
    FindSelectors: 'Tạo hoặc tìm các selector cho phần tử theo yêu cầu và giới hạn thời gian.',
    FindContainer: 'Tìm container liên quan đến phần tử theo loại container.',
    MatchesTag: 'Kiểm tra phần tử có khớp điều kiện tag hay không.',
    IsInstanceOfHtmlElement: 'Kiểm tra đối tượng đích có là một HTML element theo logic driver.'
  },
  'Đọc và sửa thuộc tính': {
    GetHtmlAttribute: 'Đọc một thuộc tính phần tử; ID rỗng có thể dùng để đọc thuộc tính tab như URL và title.',
    GetHtmlAttributesList: 'Lấy danh sách thuộc tính của phần tử.',
    SetHtmlAttribute: 'Gán thuộc tính cho phần tử HTML.',
    GetHtmlAttrValuesList: 'Đọc danh sách giá trị thuộc tính theo yêu cầu.',
    GetHtmlValue: 'Đọc giá trị hoặc nội dung của phần tử theo tùy chọn yêu cầu.',
    GetHtmlValueForElements: 'Đọc giá trị cho nhiều phần tử.',
    GetAttributeForElements: 'Đọc một thuộc tính trên tập phần tử.',
    IsHtmlElemValid: 'Kiểm tra ID phần tử còn phân giải được và hợp lệ.',
    IsHtmlElemDisabled: 'Kiểm tra trạng thái disabled của phần tử.',
    IsHtmlElemVisible: 'Kiểm tra khả năng hiển thị của phần tử theo handler của phiên bản tương ứng.',
    IsHtmlVisible: 'Kiểm tra trạng thái hiển thị qua entry point của các driver cũ.',
    IsHtmlPointVisible: 'Kiểm tra khả năng nhìn thấy hoặc tương tác tại một điểm của phần tử.',
    IsTabContentAccessible: 'Kiểm tra driver có truy cập được nội dung tab.',
    GetFocusedHtmlElement: 'Lấy phần tử đang có focus.',
    SetFocusedHtmlElement: 'Đưa focus đến phần tử chỉ định.'
  },
  'Click nhập liệu và lựa chọn': {
    ClickHtmlElem: 'Click phần tử qua entry point trực tiếp của driver cũ; các driver hiện tại dùng GenericRequest messageId 6.',
    WriteTextHtmlElem: 'Nhập văn bản hoặc chuỗi token vào phần tử theo inputOptions và tokens.',
    CheckHtmlElem: 'Thay đổi trạng thái chọn của checkbox hoặc radio theo doCheck.',
    HtmlGetSelectedItems: 'Đọc các mục đang được chọn của control hỗ trợ selection.',
    HtmlSetSelectedItems: 'Thay đổi các mục được chọn của control.',
    GetSelectedRange: 'Đọc vùng lựa chọn của phần tử.',
    SetSelectedRange: 'Gán vùng lựa chọn của phần tử.',
    IgnoreNextKeystrokeEvent: 'Yêu cầu cơ chế theo dõi bỏ qua sự kiện phím kế tiếp theo flags hoặc mã phím.',
    SimulateEvent: 'Phát sự kiện lên phần tử theo eventType, eventName và eventArgs.',
    MonitorNativeEvents: 'Điều khiển cơ chế theo dõi sự kiện tương tác của driver.'
  },
  'Tọa độ cuộn và ảnh chụp': {
    GetHtmlRectangle: 'Lấy hình chữ nhật của phần tử hoặc tab, với hệ tọa độ phụ thuộc tham số.',
    ScrollIntoView: 'Cuộn để đưa phần tử vào vùng nhìn thấy.',
    BringElementIntoView: 'Yêu cầu đưa phần tử vào vùng hiển thị theo cơ chế của driver.',
    GetHtmlDevicePixelRatio: 'Đọc hệ số pixel giữa tọa độ CSS và thiết bị.',
    MouseWheelDebugger: 'Cuộn bằng cơ chế debugger và các tham số hướng, khoảng cách hoặc delta.',
    GetTextFromScreenRect: 'Yêu cầu đọc văn bản tương ứng với vùng hình chữ nhật qua driver.',
    GetRectFromText: 'Tìm vùng hình chữ nhật tương ứng với văn bản mục tiêu.',
    TakeScreenshot: 'Chụp ảnh tab hoặc vùng theo khả năng và tham số của handler.',
    StartHighlight: 'Bật đánh dấu trực quan cho đối tượng được chỉ định.',
    StopHighlight: 'Dừng đánh dấu trực quan.'
  },
  'Trích xuất dữ liệu và control đặc thù': {
    ExtractMetadata: 'Phân tích cấu trúc và metadata phục vụ trích xuất dữ liệu web.',
    ExtractData: 'Trích dữ liệu theo metadata hoặc mô hình trích xuất đã cung cấp.',
    IsSamplePartOfANewColumn: 'Kiểm tra mẫu trong quá trình phân tích cột của dữ liệu trích xuất.',
    GetSapFioriAllColLabels: 'Đọc nhãn cột của control SAP Fiori được driver hỗ trợ.',
    TreeGetNodePath: 'Đọc đường dẫn của một node trong control dạng cây.',
    TreeGetAllPaths: 'Đọc tập đường dẫn trong control dạng cây.',
    TreeExpandPath: 'Mở rộng một đường dẫn trong control dạng cây.',
    GetTaskMiningInfoFromPoint: 'Lấy thông tin phần tử tại tọa độ cho cơ chế Task Mining.',
    GetTaskMiningInfoFromFocus: 'Lấy thông tin phần tử đang focus cho cơ chế Task Mining.'
  },
  'JavaScript debugger và giao thức': {
    Handshake: 'Kiểm tra driver đang nạp có xử lý và phản hồi được yêu cầu.',
    GenericRequest: 'Điều phối yêu cầu theo messageId; có thể xử lý ở background hoặc chuyển thành contentCommandId.',
    InjectAndRunJs: 'Yêu cầu chèn và chạy JavaScript qua cơ chế driver tương ứng.',
    RunJS: 'Gửi yêu cầu chạy JavaScript qua đường xử lý của driver; cấu trúc payload phụ thuộc phiên bản.',
    AttachDebugger: 'Gắn debugger vào tab theo cơ chế driver.',
    DetachDebugger: 'Gỡ debugger khỏi tab.',
    SupportsDebugger: 'Kiểm tra khả năng hoặc điều kiện sử dụng debugger.',
    EnableTracing: 'Bật tracing theo handler trực tiếp có trong driver 23.10.'
  },
  'Theo dõi mạng': {
    StartWebRequestMonitoring: 'Bắt đầu theo dõi các request mạng trong phạm vi yêu cầu.',
    StopWebRequestMonitoring: 'Dừng theo dõi request mạng.',
    AnyWebRequestsInFlight: 'Kiểm tra còn request mạng đang xử lý theo bộ theo dõi của driver.'
  },
  'Cookie và bộ đệm chuỗi': {
    GetBrowserData: 'Thu thập cookie và tuần tự hóa dữ liệu vào bộ đệm chuỗi được chỉ định.',
    SetBrowserData: 'Khôi phục hoặc thay đổi cookie từ dữ liệu trong bộ đệm chuỗi.',
    SetBigString: 'Tạo hoặc gán một chuỗi lớn trong bộ đệm của background driver.',
    AppendBigString: 'Nối thêm dữ liệu vào chuỗi trong bộ đệm.',
    GetBigString: 'Đọc chuỗi từ bộ đệm.',
    DeleteBigString: 'Xóa mục chuỗi trong bộ đệm.'
  }
};
const descriptive = new Map();
for (const [group, entries] of Object.entries(definitions)) for (const [name, description] of Object.entries(entries)) descriptive.set(name, { group, description });
const names = [...new Set(data.drivers.flatMap(d => d.commands.map(c => c.name)))].sort();
assert.equal(names.length, 88);
assert.equal(descriptive.size, names.length);
for (const name of names) assert.ok(descriptive.has(name), 'Missing description: ' + name);
const has = (name, version) => data.drivers.find(d => d.version === version).commands.some(c => c.name === name);
const mark = name => has(name, current) ? (has(name, latest) ? 'A' : 'B') : has(name, latest) ? 'C' : 'D';
const bridgeNames = { Handshake: 'Nội bộ bridge; đã xác minh', GetActiveTabId: 'Nội bộ bridge và CLI active; đã xác minh', OpenTab: 'MCP uipath_open_url; đã xác minh', GetHtmlAttribute: 'MCP uipath_tab_info; đã xác minh', FindBrowserTabs: 'CLI find; đã xác minh' };
const catalog = {
  schemaVersion: 1, generatedAt: data.generatedAt,
  extension: { id: data.extensionId, version: data.extensionVersion },
  scope: data.scope, sources: data.sources, activeBridgeDriver: current,
  semantics: {
    sourcePresence: 'A registered dispatch entry in the inspected bundle, not a guarantee that it works on every page or in every runtime.',
    requestFields: 'Direct parameter property accesses found in each handler, accounting for shadowed function bindings. They are not a complete required/optional parameter schema; helper functions can access additional fields.',
    emptyRequestFields: 'No direct fields were extracted; this does not establish that the operation takes no arguments.',
    genericRouting: 'A special handler takes precedence over g_callMapping. contentCommandId is an internal ID, not the native messageId.',
    descriptions: 'General Vietnamese summaries based on handler bodies, field access and command names; they are not a published UiPath API contract.'
  },
  counts: { uniqueDriverFunctionNames: names.length, loaderFunctions: data.loaderCommands.length },
  loaderFunctions: data.loaderCommands,
  functions: names.map(name => ({ name, ...descriptive.get(name), compatibilityMark: mark(name),
    bridge: bridgeNames[name] ?? 'Chưa triển khai trong bridge', runtimeVerified: live.has(name),
    runtimeVerifiedDriverVersion: live.has(name) ? current : null,
    implementations: data.drivers.flatMap(d => d.commands.filter(c => c.name === name).map(c => ({ driverVersion: d.version, codeVersion: d.uniqueId, ...c }))) })),
  drivers: data.drivers.map(d => ({ version: d.version, codeVersion: d.uniqueId,
    namedFunctionCount: d.commands.length, genericRoutes: d.genericRoutes, specialRoutes: d.specialRoutes })),
  staticReverseCalls: [...new Set([...data.loaderOutbound, ...data.drivers.flatMap(d => d.outbound)])].sort(),
  reverseCallScope: 'Names visible as string literals at native-host call sites. Dynamically computed function names are not enumerated.'
};
await writeFile(path.join(docs, 'uipath-function-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');

let matrix = '# Bảng tương thích lệnh driver UiPath\n\nMỗi dấu ✓ là một entry gọi trực tiếp có trong bảng dispatch của driver; dấu — không khẳng định chức năng tương đương không tồn tại qua `GenericRequest`. Driver nhúng thuộc extension 23.10.1.\n\n';
matrix += '| Function | ' + data.drivers.map(d => d.version).join(' | ') + ' |\n';
matrix += '|---|' + data.drivers.map(() => '---').join('|') + '|\n';
for (const name of names) matrix += '| `' + name + '` | ' + data.drivers.map(d => has(name, d.version) ? '✓' : '—').join(' | ') + ' |\n';
matrix += '\nCác request theo messageId, trường request trích từ từng handler và SHA256 nguồn được lưu trong [catalog JSON](uipath-function-catalog.json).\n';
await writeFile(path.join(docs, 'FUNCTION-MATRIX.vi.md'), matrix);

const loaderDescriptions = {
  GetEmbeddedDriverVersions: 'Liệt kê phiên bản driver được đóng gói sẵn trong extension; bridge đã xác minh.',
  OnProductVersionChanged: 'Thông báo phiên bản driver cần dùng và khởi tạo quá trình nạp; bridge đã xác minh với driver 23.4.',
  CanLoadDriverVersion: 'Hỏi package manager có thể nạp một detailedVersion hay không; chưa kiểm chứng runtime.',
  _ValidatePermissions: 'Yêu cầu chạy logic kiểm tra quyền của extension; không tự cấp thêm quyền và chưa kiểm chứng runtime.'
};
const reverseDescriptions = {
  RegisterNewlyCreatedWindowId: 'Extension đăng ký metadata cửa sổ và chờ callback khi có requestId.',
  UnregisterWindowId: 'Extension thông báo cửa sổ đã bị loại bỏ.',
  LoadScripts: 'Extension yêu cầu thông tin và gói driver; host hiện tại từ chối adapter ngoài để extension chọn driver nhúng.',
  GetDetailedDriverVersion: 'Extension yêu cầu thông tin phiên bản chi tiết để tìm driver tương thích.',
  IsTraceEnabled: 'Driver hỏi native host có bật tracing hay không; bridge hiện trả 0.'
};
const driverRows = data.drivers.map(d => `| ${d.version} | \`${d.uniqueId}\` | ${d.commands.length} | ${d.genericRoutes.length} | ${d.specialRoutes.length} |`).join('\n');
const genericIds = [...new Set(data.drivers.flatMap(d => [...d.genericRoutes, ...d.specialRoutes].map(r => r.messageId)))].sort((a,b) => a-b);
const currentDriver = data.drivers.find(d => d.version === current), latestDriver = data.drivers.find(d => d.version === latest);
function routeCell(driver, id) {
  const special = driver.specialRoutes.find(r => r.messageId === id);
  if (special) return '`' + special.handler + '`';
  const route = driver.genericRoutes.find(r => r.messageId === id);
  return route ? '`contentCommandId = ' + route.contentCommandId + '`' : '—';
}
const meanings = new Map();
for (const d of data.drivers) for (const route of d.specialRoutes) meanings.set(route.messageId, route.handler.replace(/^on/, ''));
const genericRows = genericIds.map(id => `| ${id} | ${routeCell(currentDriver, id)} | ${routeCell(latestDriver, id)} | ${meanings.get(id) ?? 'Đường chuyển tiếp theo bảng mapping'} |`).join('\n');
let guide = `# Hướng dẫn giao thức và danh mục lệnh extension UiPath trên Chrome

Extension **UiPath Browser Automation 23.10.1** đóng gói 6 phiên bản driver, với **88 tên lệnh driver khác nhau** và **4 lệnh điều khiển loader**. Bridge local hiện dùng driver **23.4.55.39317** để nạp driver, mở tab và đọc metadata tab qua MCP. Những lệnh có trong mã extension nhưng chưa được bridge triển khai không tự xuất hiện thành MCP tool.

## Phạm vi và phiên bản

Phạm vi là đường native host Win32 \`com.uipath.chromenativemsg_v2\` trên máy Windows đang dùng. Danh mục liệt kê các entry point trong bảng dispatch của driver, các tuyến \`GenericRequest\` được khai báo, và các lời gọi ngược có tên cố định về native host. Các hàm JavaScript nội bộ, hàm tiện ích, luồng Studio Web hoặc portable host và mọi Chrome API không được tính thành lệnh tự động hóa độc lập. Đây là tài liệu tương thích được khảo sát từ bản đã cài, không phải hợp đồng API công khai do UiPath phát hành.

| Driver nhúng | Giá trị codeVersion | Lệnh trực tiếp | Mapping GenericRequest | Handler GenericRequest đặc biệt |
|---|---|---:|---:|---:|
${driverRows}

Số mapping và handler đặc biệt có thể trùng \`messageId\`; không cộng hai cột này để tính số thao tác duy nhất. Driver 23.10 có 70 entry gọi trực tiếp, còn driver 23.4 có 78; một số chức năng đã chuyển sang đường gọi theo ID.

## Cách đọc danh mục

- **A**: có entry trực tiếp ở cả driver 23.4 và 23.10.
- **B**: có entry trực tiếp ở 23.4, không có entry trực tiếp ở 23.10.
- **C**: có entry trực tiếp ở 23.10, không có entry trực tiếp ở 23.4.
- **D**: chỉ xuất hiện ở một hoặc nhiều driver cũ hơn trong bộ nhúng.

[Bảng tương thích đầy đủ](FUNCTION-MATRIX.vi.md) có từng lệnh trên cả 6 driver. [Catalog JSON](uipath-function-catalog.json) có tên handler, phiên bản, offset trong file nguồn và các trường request đọc trực tiếp trong từng handler. Danh sách trường này không phân biệt bắt buộc/tùy chọn, không bao quát các trường chỉ được đọc trong helper, và danh sách rỗng không có nghĩa là không cần tham số.

## Lệnh điều khiển loader

Các lệnh này được \`LoaderWin32.OnNativeHostMessage\` xử lý trước bảng lệnh driver.

| Function | Ý nghĩa |
|---|---|
${data.loaderCommands.map(name => `| \`${name}\` | ${loaderDescriptions[name]} |`).join('\n')}

## Lệnh driver theo nhóm

Mô tả dưới đây nêu vai trò chung của handler. Khả năng chạy trên một trang còn phụ thuộc phiên bản driver, ID phần tử, quyền Chrome, iframe, trạng thái trang và các điều kiện riêng của handler.

`;
for (const [group, entries] of Object.entries(definitions)) {
  guide += `### ${group}\n\n| Function | Mô tả chung | Tương thích | Bridge hiện tại |\n|---|---|---|---|\n`;
  for (const [name, description] of Object.entries(entries)) guide += `| \`${name}\` | ${description} | ${mark(name)} | ${bridgeNames[name] ?? 'Chưa triển khai'} |\n`;
  guide += '\n';
}
guide += `## Gọi thông qua GenericRequest

Ở driver 23.4 và 23.10, \`GenericRequest\` kiểm tra handler đặc biệt theo \`messageId\` trước; nếu không có thì dùng \`g_callMapping\` để chuyển sang \`contentCommandId\`. Hai loại ID này khác nhau. Bảng dưới liệt kê **${genericIds.length} messageId khác nhau được khai báo** ở hai driver này.

| messageId | Driver 23.4 | Driver 23.10 | Ý nghĩa khi có handler đặc biệt |
|---:|---|---|---|
${genericRows}

Các giá trị \`contentCommandId = 0\` được giữ nguyên từ bảng nguồn; danh mục không coi chúng là thao tác đã chạy thành công. Những hàng chỉ có mapping chưa có mô tả nghiệp vụ đầy đủ nếu không xác định được handler cuối. Không gửi trực tiếp contentCommandId như một messageId.

### Click và nhập liệu

Với driver đang dùng, click đi qua \`functionCall: "GenericRequest"\`, \`messageId: 6\`, không phải một lệnh tùy ý tên \`click\`. Handler 23.4 đọc \`tabId\`, \`customId\`, tọa độ, offset và \`flags\`. Handler 23.10 thay đổi sang đối tượng \`options\` và thêm \`scrollTimeout\`; không dùng lẫn schema hai bản.

Nhập liệu có entry \`WriteTextHtmlElem\`; các trường đọc trực tiếp gồm \`tabId\`, \`customId\`, \`inputOptions\` và \`tokens\`. \`tokens\` không được mặc nhiên coi là một chuỗi văn bản thuần; định dạng và bit flags cần được xác minh trước khi thêm tool nhập liệu.

ID phần tử phải được phân giải theo cơ chế driver, thường bắt đầu từ \`FindWebCtrlElements\` và kết quả tìm kiếm. CSS selector hoặc chuỗi mô tả do AI tạo không tự biến thành \`customId\`. Click và nhập liệu chưa được kiểm chứng trong bridge hiện tại.

## Lời gọi từ extension về native host

Native host vừa gửi yêu cầu, vừa phải trả lời callback từ extension. Năm tên cố định dưới đây xuất hiện ở các call site đã xác định; những tên được tạo động không được coi là đã liệt kê đầy đủ.

| Function phía native host | Vai trò |
|---|---|
${catalog.staticReverseCalls.map(name => `| \`${name}\` | ${reverseDescriptions[name] ?? 'Lời gọi ngược có tên cố định; cần khảo sát handler native tương ứng.'} |`).join('\n')}

## Thông điệp và vòng đời

Chrome khởi chạy native host khi extension gọi \`chrome.runtime.connectNative\`. Host và Chrome trao đổi JSON UTF-8 qua stdin/stdout; mỗi thông điệp Native Messaging có tiền tố độ dài 4 byte. MCP STDIO dùng JSON-RPC phân cách bằng newline, nên bridge xử lý hai transport riêng. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Extension đang cài tìm host \`com.uipath.chromenativemsg_v2\`. Host cần manifest có đúng tên và allowed_origins của extension, rồi xử lý các lời gọi đăng ký cửa sổ. Luồng khởi tạo driver đang dùng là \`OnProductVersionChanged → LoadScripts → chọn package nhúng → Handshake\`.

Ví dụ phong bì yêu cầu đọc URL của tab demo đã tạo:

\`\`\`json
{
  "functionCall": "GetHtmlAttribute",
  "codeVersion": "23.4.55.39317",
  "requestId": "example-read-url-1",
  "tabId": 561209531,
  "customId": "",
  "attrName": "url"
}
\`\`\`

Tab ID trong ví dụ chỉ thuộc phiên demo; lấy ID hiện tại từ phản hồi mở tab hoặc tìm tab trước khi gọi. \`requestId\` dùng để đối chiếu \`returnId\`, không phải ID phần tử. \`codeVersion\` phải khớp package đã được nạp. Host xử lý thành công hoặc thất bại theo từng phản hồi; không suy ra thành công chỉ vì pipe kết nối được.

Với bản 23.4, trạng thái readystate của tab có thể được trả dưới dạng chuỗi \`"1"\` hoặc \`"0"\`; bridge chuẩn hóa thành \`complete\` hoặc \`loading\`. Hệ tọa độ, frame ID, ID cache và tùy chọn input phải đi theo cùng phiên bản driver.

## Bridge và MCP hiện tại

| MCP tool | Lệnh extension sử dụng | Kết quả đã kiểm chứng |
|---|---|---|
| \`uipath_bridge_status\` | Trạng thái native host local | Host đang kết nối và các thông tin trạng thái |
| \`uipath_driver_versions\` | \`GetEmbeddedDriverVersions\` | 6 phiên bản driver từ extension thật |
| \`uipath_open_url\` | Nạp driver, \`GetActiveTabId\`, \`OpenTab\`, \`GetHtmlAttribute\` | Mở Google trong tab mới và đọc lại metadata |
| \`uipath_tab_info\` | \`GetHtmlAttribute\` | URL, title và trạng thái tải của tab chỉ định |

CLI còn có \`find\` dùng \`FindBrowserTabs\`, đã trả về kết quả từ extension thật. Demo Google có URL \`https://www.google.com/\`, title \`Google\`, trạng thái \`complete\`; xem [biên bản kiểm chứng](../verification.json). Việc client local gọi MCP đã được xác minh; việc ứng dụng ChatGPT/Codex đang mở nạp đủ tool vẫn là bước riêng.

Mở rộng bridge bằng một adapter cho từng thao tác đã xác định payload, rồi tạo MCP tool có schema rõ ràng. Không đưa toàn bộ 88 lệnh thành một tool raw tùy ý: caller cần phân biệt thao tác đọc, mở/đóng tab, thay đổi DOM, thực thi JavaScript và đọc/ghi cookie. Đặc biệt, CloseBrowser, ReplaceTabAndNavigate và SetBrowserData có thay đổi trạng thái khác với lệnh đọc thông tin.

## Nguồn và cập nhật

Nguồn chính là các bảng dispatch trong bản extension đang cài: \`BackgroundMain.js\` và \`EmbeddedDriversContainer.js\`. Catalog lưu SHA256 của các file nguồn và offset của từng entry. Không có mã driver UiPath được sao chép vào guide.

- [Tài liệu UiPath Chrome extension 2023.10](https://docs.uipath.com/studio/standalone/2023.10/user-guide/extension-for-chrome) mô tả cài đặt và phạm vi sản phẩm; không được dùng làm bằng chứng cho toàn bộ schema nội bộ trên đây.
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) mô tả transport và đăng ký host.
- [Danh mục JSON](uipath-function-catalog.json) lưu đủ 88 tên lệnh, trường request quan sát được theo phiên bản, loader, các tuyến GenericRequest và metadata nguồn.
- [Bảng tương thích](FUNCTION-MATRIX.vi.md) giúp chọn đúng entry point của 6 driver.

Khi cập nhật extension, so sánh lại hash nguồn, phiên bản driver, bảng functionCall, các messageId đặc biệt và schema request trước khi mở rộng hoặc tái sử dụng adapter. Một tên lệnh không đổi vẫn có thể đổi payload giữa các bản, như trường hợp click 23.4 và 23.10.
`;
assert.equal((guide.match(/^\| `[^`]+` \|/gm) ?? []).length >= 88, true);
await writeFile(path.join(docs, 'UIPATH-EXTENSION-GUIDE.vi.md'), guide);
console.log(JSON.stringify({ namedDriverFunctions: names.length, loaderFunctions: data.loaderCommands.length,
  staticReverseCalls: catalog.staticReverseCalls.length, genericMessageIds: genericIds.length,
  groupedCounts: Object.fromEntries(Object.entries(definitions).map(([g, items]) => [g, Object.keys(items).length])),
  outputFiles: ['UIPATH-EXTENSION-GUIDE.vi.md', 'FUNCTION-MATRIX.vi.md', 'uipath-function-catalog.json'] }, null, 2));
