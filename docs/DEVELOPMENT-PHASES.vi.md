# Task phát triển theo phase

Ngày bắt đầu: 2026-10-26. Đầu vào: feature catalog 47 nhóm / 53 tool đề xuất,
MCP contracts và audit extension 23.10.1 / driver 23.4.55.39317.
Mỗi task có PR/code diff, kiểm thử và bằng chứng riêng. Không lấy số activity
làm số capability đã triển khai. Các phase dưới là thứ tự phụ thuộc, khác P0/P1/P2
là độ ưu tiên tính năng trong catalog.

| Phase | Task | Kết quả và điều kiện hoàn tất | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 0 Nền tảng | F0.1 | Lưu task, design EGM, review độc lập và kết luận review | — | Hoàn tất scoped readiness review |
| 0 Nền tảng | F0.2 | `browser_capabilities`: báo implementation / availability / evidence riêng; schema và lỗi có cấu trúc; giữ 4 API cũ | F0.1 | Hoàn tất; offline schema + independent MCP live client 5 tools đạt |
| 0 Nền tảng | F0.3 | Fixture G0 có readback và counter độc lập, runner probe đóng kín; không public raw protocol | F0.1 | Hoàn tất; private main-frame smoke live đạt, probe đã tắt sau kiểm chứng |
| 0 Coverage | F0.4 | Ma trận đủ named/loader/callback/generic/content; mọi feature có task và test; unsupported có lý do; validator chống drift | — | Hoàn tất matrix + validator và review; ca runtime trong matrix vẫn planned |
| 0 Host | F0.5 | Chuyển host checkout cũ → repo mới có backup/rollback; bật probe riêng rồi reload extension có kiểm soát | F0.3 | Hoàn tất: host mới chế độ thường, probe tắt; MCP client độc lập đạt; rollback sẵn có |
| 0 G0 | G0.1 | Xác định schema FindSelectors / content 8, không dùng stub FindWebCtrlElements | — | Golden packet đã live trên fixture main/iframe; mã not-found ghim đã audit + test |
| 0 G0 | G0.2 | Live find 0/1/n mục tiêu; ref gắn tab/frame/document; DOM attribute/value đọc đúng | G0.1, F0.3 | Fixture main 0/1/2 và same/cross-origin frame, marker/ref lifetime đạt; general ref API thuộc F1/F2 |
| 0 G0 | G0.3 | Live replace/append/input/change/click trên fixture; đối chiếu counter; không retry write | G0.2 | Native Unicode/click smoke + React 19.3.1 DOM/model/rerender và negative rejection đạt; general event parity chưa kiểm chứng |
| 0 G0 | G0.4 | Stale sau remove/navigation/disconnect, frame đổi; receipt ghi version/hash/scope | G0.2 | Hoàn tất scoped live 11/11; 32/32 offline đạt; UI xác nhận fixture đóng, server/probe disable đạt |
| 1 Phiên/tab | F1.1 | Connection/context/tab ref registry, attach strict, reject ref sai phiên | G0; nền tảng có thể làm song song | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 1 Phiên/tab | F1.2 | tabs/list/open/get/activate/close; scope tab rõ, không kill browser | F1.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 1 Phiên/tab | F1.3 | navigate/history, deadline chung và invalidation ref | F1.2 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 2 DOM đọc | F2.1 | find_element(s), zero/multi match, giới hạn collection và locator đã thử | G0, F1.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 2 DOM đọc | F2.2 | get_element: attributes/value/text/state/rect theo field đã thử | F2.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 2 DOM đọc | F2.3 | snapshot có giới hạn và ref dùng lại được; wait đúng absent/detached/navigation | F2.2 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 3 DOM ghi | F3.1 | click/type; precondition, queue theo tab, outcome unknown; readback | G0, F2.2 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 3 DOM ghi | F3.2 | set_checked/select/scroll/focus; desired state và hậu kiểm | F3.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 3 Quan sát | F3.3 | Screenshot: active-tab/window guard, transport bound và artifact; reject nếu chưa an toàn | F1.2; gate screenshot riêng | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 3 MVP | F3.4 | Workflow form hoàn chỉnh; stale/multi-tab/timeout tests; cập nhật capability theo receipt | F3.1–F3.3 | Workflow fixture live đạt; broad negative scenarios vẫn planned |
| 4 P1 | F4.1 | Keyboard Enter/Tab/chords và JS; phân biệt RunJS registry/InjectAndRunJs | MVP; design riêng | JS/set-text fixture live đạt; trusted keys unsupported |
| 4 P1 | F4.2 | Form/extract/table/pagination; partial results, giới hạn output | F4.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 4 P1 | F4.3 | Network/cookie/download/debug theo permission, watcher TTL và cleanup | MVP; design riêng | Network/visible cookies fixture live đạt; download/debug backend thiếu |
| 4 Controls | F4.4 | Selection/highlight/hover/popup/set-attribute/tree/table-cell; mỗi control có fixture riêng | F2.2, F3.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 4 Debug | F4.5 | Debugger attach/detach ownership, permission, tracing/diagnostic; không chiếm phiên người dùng | F4.1, F3.3 | Deferred: chưa có debugger ownership an toàn |
| 4 Frames | F4.6 | Frame list/attach/ref ownership, same/cross-origin boundaries; không suy closed shadow support | G0.4, F2.1 | Source + offline + public fixture smoke đạt; xem scope bên dưới |
| 5 P2 | F5.1 | Dialog response policy/control path không deadlock; file picker/native helper | Backend và fixture riêng | Deferred |
| 5 P2 | F5.2 | OCR/CV/semantic; visualTarget có viewport generation và input backend | Provider + point input đã thử | Deferred |
| 5 Đóng gói | F5.3 | Cài/gỡ/upgrade, tài liệu, CI Windows, release và license review | Capability đích đạt nghiệm thu | CI Node22/24 baseline; local71 tests + public/review live đạt; signed release pending |
| 5 Native | F5.4 | Window/launch/clipboard/image artifact/native; chỉ mở backend và action đã thử | Backend riêng; F1.1 | Window/image artifact fixture live đạt; launch/clipboard/native helper thiếu |
| 5 Specialist | F5.5 | Calendar/SAP/accessibility/semantic; engine hoặc composite và acceptance riêng | F2.2, F4.2; provider riêng | HTML date/composites fixture live đạt; SAP/provider/audit thiếu |
| 5 Events | F5.6 | Event broker/recorder và drag; schema, TTL/backpressure, target generation | F3.1, F4.6 | DOM events/drag synthetic fixture live đạt; không trusted input |

## Quy tắc nghiệm thu

Ma trận bắt buộc: [function → adapter → MCP → task → test](EXTENSION-FUNCTION-MATRIX.vi.md),
[JSON có cấu trúc](extension-function-matrix.json). Ma trận bao phủ named union
qua sáu driver, loader/callback và generic/content của driver ghim; không quảng bá
mọi helper JavaScript riêng hay version tương lai. `npm run matrix:check` phải đạt
khi thay catalog/mapping. Ma trận ghi rõ planned/internal/alternative/unsupported;
test kế hoạch không được coi là test runtime đã chạy.

- Task chỉ hoàn tất trong đúng phạm vi đã chạy: offline, source audit, mock,
  live fixture và workflow là các cột bằng chứng độc lập.
- Chỉ public tool đã có adapter. Option chưa thử phải trả lỗi trước dispatch.
- Không retry click, append, navigation hoặc submit sau timeout không rõ outcome.
- Receipt live phải có nguồn/version/hash, kết quả readback, trạng thái cleanup,
  và không chứa secret hay đường dẫn cá nhân.
- Tham chiếu [workflow EGM](EGM-WORKFLOW.md) và
  [design phase đầu](designs/phase-0-capabilities.md). Các phase sau được thiết kế
  chi tiết trước implementation; bảng này chưa thay thế design của từng feature.

## Kết quả slice đầu

- Đã thêm tool thứ năm `browser_capabilities`, nested output schema và
  structuredContent/text tương thích. Các tool legacy giữ schema/hành vi cũ.
- `npm test`: 7/7 đạt; hai module runtime mới/sửa qua `node --check`.
- Hai Goldfish reviewer đã đọc độc lập design và source; 4 finding Major được
  xử lý trong design trước code. Review code riêng không phát hiện P1/P2.
  Xem [biên bản review](designs/phase-0-review.md).
- [G0 protocol notes](designs/g0-protocol-notes.md) ghi hash, route/schema candidate
  và điều kiện live; không có click/type/DOM live mới.
- Tại mốc capability slice đầu, việc tiếp theo là F0.3. Tiến độ mới của task đó
  được ghi ở phần dưới.

## Cập nhật ma trận và F0.3

- 188 hàng: 88 named + 4 loader + 5 callback + 39 generic map + 2 special +
  50 content IDs. Generic có 40 messageId phân biệt. Đã gắn task cho đủ 47 nhóm /
  53 tool roadmap; 423 test scenario là **kế hoạch**, không phải số test đã chạy.
- Unsupported/legacy/stub/opaque handler có lý do; direct entry không tồn tại
  được phân biệt với alternative generic route. Callback/helper nội bộ không
  biến thành public MCP endpoint.
- Đã thêm private `g0_probe`, fixture và runner. Probe tắt mặc định; chỉ dùng
  fixture loopback/main frame/fixed text. Public tools vẫn là 5, G0 vẫn false.
- `npm test`: **20/20 đạt**. `matrix:check` đạt; module syntax và PowerShell parser
  đạt. Review độc lập phát hiện các gap route/evidence, timeout discovery, malformed
  preflight và cleanup sau host restart; đã sửa và thêm regression tests.
- Chạy preflight thật trên clone: exit 1, `HOST_PROBE_UNAVAILABLE`, không mở tab,
  không đổi registry. Không có click/type live mới; không nâng evidence level.
- Việc tiếp theo là **F0.5 → G0.2 → G0.3/G0.4**. Xem
  [design runner](designs/g0-fixture-runner.md),
  [review và kiểm chứng](designs/function-matrix-g0-review.md) và
  [cách bật/tắt probe](../scripts/README.md#g0-development-fixture).

## F0.5 thực thi và G0 live lần đầu

- Đã chụp snapshot machine-local trước mutation, chuẩn bị Rollback.ps1, kiểm tra
  checksum/quyền sở hữu/HKCU REG_SZ/reparse points. Đã Apply → rollback → readback
  file/registry → Apply lại bằng PowerShell. Không đóng hoặc kill Chrome.
- Người dùng đã tắt/bật UiPath; endpoint repo mới kết nối bằng tiến trình mới,
  probe protocol 1 bật; endpoint prototype cũ không còn. Xem
  [receipt chuyển host](HOST-TRANSITION-VERIFICATION.json).
- G0 live attempt 1: preflight và source hash đạt, fixture mở, find-missing trả
  đúng 0. Find-input gặp PROBE_UNSUPPORTED_RESPONSE, nên không có type/click.
  Server fixture đã dừng; probe quarantine và tab cleanup không xác nhận được.
  [Receipt G0](G0-LIVE-VERIFICATION.json) giữ nguyên lần thất bại.
- Source bổ sung xác nhận selector results là tab|frame|local; background nhận
  frame|local. Đã sửa adapter: kiểm tra đúng tab/main frame 0, strip riêng tab prefix,
  và kiểm thử mọi native DOM packet nhận 0|local. Review độc lập không phát hiện
  P1/P2 runtime ở bản sửa; test gap về wire ID đã được xử lý.
- **21/21 offline tests đạt**; test chuẩn hóa ID bổ sung đã đạt. Full G0 vẫn false.
  Cần người dùng đóng tab G0 fixture cũ nếu còn và tắt/bật UiPath lần nữa để nạp
  bản sửa, rồi chạy fixture mới. Không replay phiên quarantine hoặc retry write.
- Sau kiểm chứng: plain Setup Install để tắt probe trong launcher, reconnect và
  kiểm tra host mới vẫn hoạt động. Rollback vẫn có tại
  work/host-transition-f0-5/Rollback.ps1 (ignored, chỉ dùng trên máy này).

### Kiểm tra reconnect tiếp theo

Sau khi người dùng báo đã đóng fixture/tắt-bật extension, endpoint mới chưa xuất
hiện (HOST_PROBE_UNAVAILABLE), nên runner dừng ở preflight và không mở fixture.
Registry hai view và launcher vẫn đúng; không có tiến trình native trên checkout
mới và chưa có stderr từ launcher. Ba bài test native/IPC được chạy lại và đạt.
Trang BackgroundPage.html của extension ghi rõ “Keep this window open”; đã hướng
dẫn người dùng mở/giữ trang **UiPath Web Automation**, khác tab **G0 fixture**.
Trạng thái vận hành hiện tại chờ trang nền kết nối; lần kết nối thành công trước
đó không được coi là bằng chứng host đang hoạt động ở thời điểm này.

### Kết quả cuối sau khi mở trang nền (2026-10-26, Asia/Bangkok)

- Người dùng mở và giữ UiPath Web Automation; native host mới khởi chạy, G0
  preflight đạt. Live smoke retest đạt: find 0/1/2, id/value read, Unicode replace
  và append, input counters lần lượt 10/19, change counters ghi nhận 1/2, click=1.
  Readback qua extension khớp report độc lập từ fixture. Không suy mọi event/key
  sequence hoặc controlled component từ những counter này.
- Cleanup xác nhận fixture tab đóng và HTTP server dừng. Receipt giữ cả lần fail
  và lần pass: [G0 live](G0-LIVE-VERIFICATION.json).
- Đã cài lại launcher ở chế độ thường và người dùng refresh trang nền. Host mới
  kết nối, driver ghim đã nạp, private probe disabled được xác nhận qua IPC.
- Alias Codex uipath_bridge đổi sang src/bridge.mjs của repo mới. Client stdio độc
  lập initialize/list/capabilities đạt, thấy đúng 5 public tools và G0=false.
  [Receipt MCP](MCP-HOST-VERIFICATION.json). Phiên app đã chạy từ trước chưa được
  chứng minh reload cấu hình; cần Restart MCP server hoặc phiên mới để dùng path mới.
- Rollback native file/registry đã chạy thử. Snapshot MCP trước/sau và
  work/host-transition-f0-5/Rollback-All.ps1 được chuẩn bị và ValidateOnly đạt;
  combined rollback native+MCP chưa được chạy end-to-end để tránh đổi ngược host
  đang hoạt động. Snapshot machine-local vẫn ignored và được giữ nguyên.
- **Full gate G0 còn false**: tiếp tục G0.4 (stale/remove/navigation/disconnect/frame),
  controlled-input/event semantics rồi mới mở public DOM tool. F0.5 hoàn tất.

## G0.4: triển khai và preflight (2026-10-26, Asia/Bangkok)

- Đã thêm private probe v2: ref gắn fixture document/node/generation, kiểm tra
  tab/frame ID, iframe selector IFRAME → INPUT và cleanup-only orphan adoption
  sau native restart. Không tự heal ref hoặc retry thao tác ghi.
- Fixture dùng hai origin loopback, React/react-dom 19.3.1 thực và esbuild 0.28.2.
  Runner kiểm tra remove/clone/same-URL reload/navigation, same/cross-origin iframe
  và reload isolation, controlled DOM/model sau rerender, rejection không retry,
  rồi yêu cầu native PID và startedAt thực sự thay đổi.
- Review thiết kế đã xử lý 4 Major. Review code phát hiện 2 P2: nhầm tắt probe
  trong tiến trình với launcher, và race giữa identity check/read/write. Đã tách
  bằng chứng disable, thêm pre/post guards và ba test interleaving; reviewer đã
  re-review và không còn blocker trong phạm vi đã đọc. Xem
  [review](designs/g0-4-review.md), [thiết kế](designs/g0-4-lifetime-frames-controlled.md).
- **29/29 offline tests đạt**; matrix check đạt, vẫn 423 scenario planned.
  Preflight trên host thật trả HOST_G04_PROBE_NOT_READY: tiến trình đang chạy
  protocol 1, enabled=false. **0 ca G0.4 live đã chạy**, không mở fixture hay gửi
  thao tác ghi. [Receipt G0.4](G0-4-LIVE-VERIFICATION.json) ghi not-run rõ ràng.
- Launcher đã bật opt-in cho lần nạp v2 tiếp theo; người dùng cần Ctrl+R trên
  tab **UiPath Web Automation** và giữ trang này mở. Sau suite, plain Setup Install
  sẽ bỏ opt-in; cần xác nhận cả launcher và disabled preflight/status. Chưa coi
  bước hậu kiểm đó đã đạt khi chưa chạy.
- Giới hạn còn lại: nhiều native RPC không nguyên tử. Guard marker thuộc fixture,
  không chứng minh chống mọi race hoặc định danh document cho website bất kỳ.
  Post-write identity loss là ACTION_OUTCOME_UNKNOWN + quarantine, không retry.
  Full G0 vẫn false; public MCP vẫn 5 tool, chưa có public DOM API.

### G0.4 live lần 1 và bản sửa

- Sau khi người dùng refresh, native host kết nối protocol 2, enabled=true,
  quarantine=false. Driver ghim được nạp; extension source hash khớp.
- Fixture React và cả hai iframe đã gửi report, nhưng bước remove/ref đầu dừng
  tại FindSelectors với RESULT_SHAPE_OR_ALLOCATION. Không có lệnh nhập liệu; chưa ca
  stale/frame/controlled nào đạt. Server dừng, finish tắt probe trong tiến trình;
  tab closure không xác nhận được vì quarantine. Giữ receipt lần lỗi trong
  [G0.4 live receipt](G0-4-LIVE-VERIFICATION.json).
- Đã sửa runner chờ documentReady/complete của mọi role, không chỉ input hiện
  diện; fixture gửi report theo thứ tự và báo lại khi load. Chưa xác nhận đây là
  nguyên nhân duy nhất: extension còn có success-coded empty fallback khi thiếu
  response hoặc frame geometry thất bại. Diagnostic mới ghi counts/readiness/
  allocator; không lưu raw page payload.
- Audit phát hiện m_searchError cần được từ chối dù collection có phần tử; đã
  thêm guard + regression test. **30/30 offline tests đạt**, matrix check đạt.
  Focused review readiness/report ordering không phát hiện false-pass regression.
- Đang chờ người dùng đóng G04 fixture lỗi và Ctrl+R trên **UiPath Web Automation**
  để nạp bản sửa. Launcher opt-in vẫn bật cho retest; tiến trình hiện đã tắt probe.
  Sau retest phải plain Setup Install và xác nhận cả launcher/preflight disabled.

### G0.4 kết quả cuối: 11/11 live đạt

- Người dùng đã ủy quyền Computer Use. Đã đóng fixture lỗi và reload đúng trang
  **UiPath Web Automation**; giữ trang nền mở. Không thao tác ứng dụng/website khác.
- Lần 2: readiness đạt, nhưng zero-match sau remove có m_searchError. Source ghim
  xác nhận ElementNotFoundError là đúng `{m_id:0}`. Đã sửa chỉ nhận mã này khi
  collection rỗng và shape/readiness/allocator hợp lệ; lỗi lạ hoặc có match kèm
  error vẫn quarantine. Regression + full suite **31/31 đạt**; reviewer kiểm tra
  độc lập source/adapter và không phát hiện blocker. Giữ cả hai lần lỗi.
- Lần 3 **11/11 đạt**: remove/clone stale read+type; same-URL reload; owned
  navigation; same/cross-origin iframe read/type Unicode, input counter=10 mỗi
  frame; reload từng frame từ chối ref cũ và giữ sibling/main hợp lệ; React
  controlled replace/append DOM=model sau rerender, React change counter=2;
  negative rejecting control phát hiện postcondition mismatch với 1 write/0 retry.
- Native reconnect được tạo bằng Computer Use reload trang nền, giữ fixture mở.
  PID và startedAt đều đổi; read/type bằng session cũ trả PROBE_STALE_SESSION.
  Cleanup-only orphan adoption đóng đúng fixture; cả hai server đã dừng.
- finish tắt probe trong tiến trình; plain Setup Install bỏ opt-in launcher.
  IPC xác nhận enabled=false, status protocol=null, host/driver vẫn kết nối.
  Independent MCP client xác nhận đúng 5 tools và public G0=false. UI không còn
  cửa sổ fixture; trang nền UiPath vẫn mở. Xem [receipt đầy đủ](G0-4-LIVE-VERIFICATION.json),
  [host](HOST-TRANSITION-VERIFICATION.json), [MCP](MCP-HOST-VERIFICATION.json).
- G0.4 hoàn tất **trong phạm vi fixture**. Public DOM APIs chưa triển khai; gate
  public G0 giữ false theo design. Guard marker/multi-RPC không chứng minh atomic
  identity/dispatch. Nested frames, shadow DOM, mọi framework/site và general
  change/blur parity còn ngoài kiểm chứng. Các test matrix rộng vẫn planned.
- Tiếp theo là F1.1 context/ref registry và lifecycle chung, thiết kế contract
  cho general website trước khi triển khai F2/F3 và đổi capability advertisement.

### Hậu kiểm trước commit/push

- Release review phân biệt CloseBrowser acknowledgement với tab absence. Runner
  giờ ghi ACK riêng; raw tabLeftOpen=null, tabClosureVerified=false và không cho
  cleanup.passed=true chỉ từ retCode. Parent xác nhận độc lập qua UI trong receipt
  tổng hợp; suite pass nhưng chưa có xác nhận này là trạng thái chờ hậu kiểm.
- Lần 4 chạy lại đúng runner mới, **11/11 đạt**. Trước native reconnect, Computer
  Use xác nhận fixture là tab duy nhất trong cửa sổ riêng; sau native cleanup,
  đúng window đã quan sát không còn và không có cửa sổ fixture nào. Plain Setup
  Install + IPC disable và MCP 5 tools đạt lần nữa. Raw receipt vẫn giữ trạng thái
  pending; aggregate riêng ghi closure đã xác nhận, không ghi đè bằng chứng gốc.
- Đã bỏ hai tab ID máy-local khỏi receipt G0 lịch sử và làm rõ cleanup cũ chỉ là
  ACK/server shutdown. Matrix chỉ nhận G0.4 khi có independent closure, launcher
  disable, đúng 11 case và hash hiện tại của probe/runner/fixture/lock khớp receipt;
  regression kiểm tra đổi source sẽ loại evidence cũ. **32/32 offline tests đạt**.
- Native manifest/launcher, snapshot rollback, raw machine receipts và vendor
  source vẫn ở ignored work/generated files. Chỉ source, plan, design/review,
  matrix và receipt đã loại dữ liệu máy được đưa vào commit.

## Runtime public F1–F5 supported subset — snapshot source trước public live

Baseline G0 đã commit/push `ac7d999`. Implementation mới theo
[thiết kế EGM](designs/browser-runtime-full.md),
[schema từng tool](browser-tool-contracts.json),
[guide agent](BROWSER-RUNTIME-GUIDE.vi.md) và
[ma trận runtime](RUNTIME-FUNCTION-COVERAGE.vi.md).

| Phase/task | Implementation hiện tại | Giới hạn acceptance |
|---|---|---|
| F1.1–F1.3 | Context/client lifecycle, tab discovery/open/get/activate/close, navigation/history, scoped refs/requestKey/deadline | Source + focused offline; public live pending |
| F2.1–F2.3 | CSS/XPath/text/attributes strict find, flat bounded snapshot, read/state/rect/attribute, wait | Không tự xuyên frame/shadow; stale ref không heal |
| F3.1–F3.3 | DOM/native input subset, check/select/scroll/focus, guarded viewport screenshot | Synthetic DOM default; native checks không nguyên tử; không fullpage/OS input |
| F4.1 | MAIN function evaluate + bounded Promise tickets, set text/attribute | JS/set-text có source; trusted keys unsupported |
| F4.2 | HTML form read/fill partial steps, table extraction + explicit bounded pagination | Đã triển khai source + offline; public live pending |
| F4.3 | Arm/wait/cancel network/new-tab, visible origin/path cookies | Network/visible cookies có source; download/debug backend thiếu |
| F4.4/F4.6 | Explicit iframe attach, selection/highlight/hover/drag/popup, HTML cells/ARIA tree | HTML composites, không SAP parity hoặc trusted pointer |
| F5 supported subset | DOM events bounded queue, window get/activate/maximize, date input, owned image artifacts | Maximize chỉ ACK; artifact tạm; desktop/provider features chưa có backend |

Public MCP tăng từ 5 lên **47 tool**: 4 legacy + capabilities +42 adapter.
**10/53 tên roadmap unsupported**, có lý do trong schema/coverage; không public
placeholder: keys, semantic, dialog, file picker, downloads, launch, clipboard,
visual, OCR, accessibility audit. Đây là disposition đầy đủ của roadmap, không
phải tuyên bố đã triển khai các backend ngoài extension hoặc mọi UiPath activity.

Đã có 16 regression tests cho runtime mới, thêm MCP→IPC image-block test và
coverage drift test: wrong-scope predispatch, removed/cloned
nodes, in-flight key joining/conflict, unknown quarantine + abandon mọi context,
navigation transition/generation, falsy Promise/oversize, network TTL/cleanup retry,
parallel tab queues, owner release/events/cookies, iframe reload, partial form,
artifact quota/no-overwrite, delayed-start expiry, release drain, client discovery
cleanup, dispatch evidence và output contracts. Các test chạy bằng jsdom/native
mock; không coi layout/realm mock là Chrome evidence. Suite legacy vẫn được giữ.
Full suite hiện **55/55 offline đạt**; matrix validator đạt 188 rows/53 tools và
423 scenario planned. Không suy 423 scenario đã chạy từ 55 regression tests.
Xem [receipt runtime/offline](BROWSER-RUNTIME-VERIFICATION.json),
[review ledger](designs/browser-runtime-full-review.md) và
[public live preflight chưa chạy](BROWSER-LIVE-VERIFICATION.json).

Runner public `scripts/run-browser-live.mjs --live` đã chuẩn bị. Preflight hiện
trả NEW_HOST_NOT_LOADED: host đang giữ code cũ trong bộ nhớ. Computer Use không
kích hoạt được window nền; browser connector từ chối chrome-extension:// theo
URL policy. Đã yêu cầu người dùng Ctrl+R trang UiPath Web Automation; không tìm
cách vượt policy. **Chưa có public runtime live pass**. 423 scenario broad trong
matrix vẫn planned; receipt G0 cũ là lịch sử sau khi source/lockfile thay đổi.

### F5.3 source packaging chuẩn bị

Đã dựng source ZIP local bằng allowlist, không có vendor/generated host/dependencies; có SHA256. Windows CI Node22/24 đã viết, action SHA ghim, chưa xác nhận run trên GitHub. License inventory từ lockfile gồm71 packages (6 production), check đạt; đây là metadata review, không phải kết luận pháp lý. Signed installer/public release và upgrade/browser live vẫn pending. Xem [release runbook](RELEASE.vi.md).

### Retained input và CI sau commit71525e7

Bổ sung bốn test dùng React thực trong jsdom, queued sanitizer/restoration và convergence. Text/check/select/date giờ xác minh retained state ở RPC sau dispatch; không chỉ dùng synchronous match. Source review focused không còn P1/P2 trong các nhánh đã đọc; đây chưa phải live Chrome. Mô tả42 tool MCP đã ghi rõ mục đích, giới hạn và recovery thay cho mô tả generic.

CI commit71525e7: Node24 đã đạt cả tests/matrix/license/source archive; Node22 lỗi test startup chờ host30 lần*30ms. Đã đổi sang readiness deadline10s và xác nhận PID của đúng child. Full local55/55 đạt; CI của bản sửa còn chờ run.

### Windows CI đã đạt trên remote

Commit c020364 đã qua cả hai job Node22.23.4 và24.22.1 trên GitHub Windows: npm ci, tests, matrix, license inventory và source archive. Node22 log55/55,0 skipped. Xem [receipt CI](WINDOWS-CI-VERIFICATION.json) và [run40266585783](https://github.com/OrgGem/rpa-agent-mcp/actions/runs/40266585783). Source ZIP local đã khớp26 source hashes/108 entries. Đây là CI offline/packaging, không nghiệm thu browser live.

Tại snapshot c020364, code đã lưu trên origin/main nhưng public live còn chờ host mới. Trạng thái hiện tại được cập nhật bên dưới.

## Public live và capture readiness — 2026-10-26

Đã tự reconnect host bằng CLI: xác minh đúng tiến trình node native của repo, dừng khi không còn action in-flight, extension tự kết nối lại theo timer10s. Không kill Chrome, không đổi registry và không truy cập URL extension bị browser policy từ chối. Host0.3.0 đã load đúng12 source/contract hashes.

Public MCP trên Chrome155.0.0.0 UA, extension23.10.1/driver23.4.55.39317: **7/7 nhóm và42/42 tool browser mới đạt**; tools/list có47 tool. Fixture hai origin kiểm chứng native/DOM Unicode replace/append, React retained model, requestKey click dedup, stale/replaced nodes, same/cross-origin iframe reload isolation, MAIN Promise, form/table/tree/date, events/network/cookies/new-tab/navigation và PNG artifact inspect/read/save với MCP image block/hash. Tab/context/server/client cleanup đều xác nhận. Xem [receipt live](BROWSER-LIVE-VERIFICATION.json).

Đã sửa capture theo [design/review EGM](designs/capture-visibility-readiness.md): active/focus không thay visibility; ticket hai animation frames có owner/document/TTL<=2s; tab ẩn trả TARGET_NOT_VISIBLE trước TakeScreenshot. Lỗi target không vô hiệu hóa toàn connection. Capture thành công trên fixture mở trong cửa sổ hiển thị, chọn base URL rõ ràng. Ca cửa sổ mới bị ẩn được kiểm tra riêng và từ chối đúng; không suy mọi cửa sổ đều render. Cũng sửa lỗi vendor capture bị biến thành timeout và cleanup sau tab đóng/ref pruning.

**64/64 offline tests đạt**, matrix188 rows/53 roadmap tools đạt;423 scenario vẫn là kế hoạch rộng. Source review focused đã xử lý P2 precedence deadline/context; reviewer xác nhận không còn P1/P2 trong scope. G0 hoàn tất scoped trước đó; F1–F3 và supported subset F4/F5 nay có public fixture smoke. F4.5, backend ngoài extension, signed installer/public release và các option/site/negative scenario chưa có bằng chứng vẫn pending/deferred. Không tuyên bố full UiPath Activity parity.

### Lưu remote và CI của public live slice

Commit [`a13599e`](https://github.com/OrgGem/rpa-agent-mcp/commit/a13599e87379d48cc8a9987c894d375fab1eac25) đã push origin/main. [CI40274330202](https://github.com/OrgGem/rpa-agent-mcp/actions/runs/40274330202) đạt cả Windows Node22.23.4 và24.22.1: mỗi job64 tests,64pass,0fail,0skip, matrix/license/source archive đều success. Receipt CI tách khỏi live receipt. Source ZIP local đã kiểm tra26 source hashes,111 entries,0 mismatch; không phải signed installer hay GitHub release. Host cuối phiên đang connected, runtime0.3.0/driver ready, source hashes đúng, probe tắt và cleanupUnconfirmed=0.

## Sửa các finding từ review toàn repo — 2026-10-26

Đã sửa cả7 finding tại baseline95e5017: network timeout/recovery (P1), release
khi đầy cache, pagination/rootRef và dispatch evidence, deadline trong queue,
Unicode launcher/manifest và fixture path có khoảng trắng. Phạm vi liên quan
F1.1, F4.2, F4.3 và tooling cài host/live fixture; không thêm capability.
Xem [bản sửa và từng kiểm chứng](REVIEW-FIXES-2026-10-26.vi.md).

**71/71 offline/integration tests đạt,0skip**. Bao gồm launcher Windows thật với
binary stdio, Unicode và ký tự đặc biệt; không sửa registry trong test. Network
cleanup unknown vẫn cần explicit abandon; queue timeout không chạy muộn hoặc
cho write sau vượt hàng; pagination không replay click.

Source mới đã làm receipt public live cũ lệch hash. Coverage được tái tạo đúng
trạng thái pending cho bản sửa, không giữ nhãn live pass từ source cũ. Receipt
Chrome7/7 và CI64/64 ở trên là lịch sử; đợt sửa này chưa reload native host hoặc
chạy Chrome live/CI remote mới.423 scenario rộng vẫn planned.

## Kiểm thử live lại bản sửa review — 2026-10-26

Đã reload host với backup launcher/manifest sẵn có; probe tắt và12/12 loaded
hashes khớp runtime của commit2db694b. Browser connector mở thành công tab
example.com để chọn cửa sổ hiển thị; không cần thao tác thủ công. Public suite
đạt **7/7 nhóm,42/42 tool mới** trên fixture riêng. Receipt mới đã thay receipt
lịch sử và coverage trở lại fixture-smoke-verified cho đúng source hiện tại.

Runner `scripts/run-review-live.mjs` đạt **6/6 nhóm**: mạng bận timeout rồi ghi
tiếp; read/write trong queue hết hạn đúng lúc, không chạy muộn/vượt hàng; phân
trang DOM và navigation với rootRef, dispatch evidence đúng; release khi đầy256
key; explicit unknown recovery khi đầy cache. Có fixture report độc lập cho
input/Next click và readback xác nhận overflow không đổi DOM. Không đổi runtime
trong đợt retest. Xem [kết quả/giới hạn](REVIEW-FIXES-2026-10-26.vi.md),
[public receipt](BROWSER-LIVE-VERIFICATION.json) và
[regression receipt](REVIEW-LIVE-VERIFICATION.json).

Tabs/context/server/client cleanup đều đạt; host còn connected,
cleanupUnconfirmed=0. Native monitor cleanup thất bại và Unicode Chrome
registration chưa có live evidence mới; giữ kết quả offline/process riêng.
F4.5, backend thiếu, signed release và các scenario rộng chưa được kiểm chứng
vẫn pending/deferred. Chưa kiểm tra CI remote cho snapshot retest này.
