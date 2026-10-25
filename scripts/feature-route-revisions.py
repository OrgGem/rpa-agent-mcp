"""Apply the pinned-driver source audit to the feature-design registry."""
import json
from pathlib import Path

def revise(features):
    audit=json.loads(Path('docs/pinned-driver-audit.json').read_text(encoding='utf8'))
    by_name={r['name']:r for r in audit['namedEntries']}
    updates={
      'snapshot': dict(candidateCommands='FindSelectors GetHtmlAncestryInfo GetHtmlAttribute',limitation='Composite bị chặn bởi discovery/ref chưa kiểm chứng live. FindWebCtrlElements là stub trong driver đang ghim; không dùng làm backend. Cây DOM/role/name phải được xây và kiểm tra riêng.'),
      'find': dict(candidateCommands='FindSelectors GetHtmlAncestryInfo FindContainer GetHtmlIndex',backend='source-route-awaiting-live-probe',limitation='FindSelectors → content command 8 có engine search trong source; partialRequests cần schema và live fixture. FindWebCtrlElements là stub; GetHtmlElemById chỉ xử lý nhánh tìm tab, không là DOM getter. Không quảng bá CSS/XPath/role hay traversal trước khi adapter kiểm chứng.'),
      'element-read': dict(candidateCommands='GetHtmlAttribute GetHtmlAttributesList GetHtmlValueForElements GenericRequest GetHtmlRectangle IsHtmlElemValid IsHtmlElemVisible IsHtmlElemDisabled GetFocusedHtmlElement',limitation='GetHtmlValue không có direct entry ở driver 23.4; đọc value/text qua GenericRequest messageId=5 → content 18 hoặc helper batch. GetHtmlElemById không phải đọc elementRef. Metadata tab đã live-verified; DOM fields chưa. Check Element là enabled/disabled, Check/Uncheck là checked.'),
      'wait': dict(candidateCommands='GetHtmlAttribute IsHtmlElemValid IsHtmlElemVisible IsHtmlElemDisabled GenericRequest',limitation='Polling composite; text/value dùng route đọc hợp lệ, không gọi direct GetHtmlValue. Điều kiện absent dùng locator; detached trên ref chỉ thành công khi node mất trong cùng document, không phải do navigation/disconnect. Branch do orchestrator thực hiện.'),
      'type': dict(limitation='Source và probe cô lập xác nhận nhánh không dùng debugger nhận đúng một token có trường text: tokens=[{text:...}]. Options quan sát: PARSE_HOTKEYS=1, USE_DEBUGGER=2, APPEND=4. Chưa kiểm chứng live semantics replace/append/events; nhánh debugger/key tokens khác. Không đưa chuỗi text trực tiếp vào tokens.'),
      'keys': dict(candidateCommands='WriteTextHtmlElem',limitation='Nhánh debugger có key-token parser; nhánh không debugger chỉ nhận một text token. Không lấy IgnoreNextKeystrokeEvent làm backend gửi phím; không coi SimulateEvent là trusted keyboard input. Key schema và keyup cleanup còn phải kiểm chứng.'),
      'set-text': dict(candidateCommands='WriteTextHtmlElem InjectAndRunJs',limitation='Chọn adapter đặt live value và event rõ. SetHtmlAttribute(value) không tương đương; JS fallback dùng InjectAndRunJs, không dùng RunJS với mã tùy ý. Controlled-input behavior cần live fixture.'),
      'script': dict(candidateCommands='InjectAndRunJs',limitation='InjectAndRunJs nhận jsCode/input/executionWorld. RunJS chỉ gọi CallableScripts[scriptName] đã đăng ký. Cả retCode và isScriptErr phải được kiểm tra; retCode=1 vẫn có thể là lỗi script. World/debugger/Promise còn cần live validation; JSON serialization là lớp bridge.'),
      'table-cell': dict(candidateCommands='FindSelectors GetHtmlAttribute GetSapFioriAllColLabels',limitation='Web composite có điều kiện SAP; GetHtmlCollectionById không có direct entry trong driver ghim. Discovery dựa trên FindSelectors còn chờ live validation; không suy đầy đủ SAP parity từ helper label.'),
      'form-read': dict(candidateCommands='FindSelectors GetHtmlValueForElements GetAttributeForElements',limitation='Composite chỉ được bật sau discovery/read primitives; không có semantic AI engine UiPath được cung cấp bởi bridge.'),
      'form-fill': dict(candidateCommands='FindSelectors WriteTextHtmlElem CheckHtmlElem HtmlSetSelectedItems',limitation='Ghép primitives đã live-verified; preview phải giữ binding/ref và kiểm tra lại trước apply. Trả partial khi lỗi; không submit hay hứa atomic.'),
      'popup': dict(candidateCommands='FindSelectors GenericRequest',limitation='DOM-overlay composite qua find và click messageId=6. JS dialog/new-tab/OS dialog có cơ chế riêng; chưa có semantic Close Popup parity.'),
      'screenshot': dict(limitation='VIEWPORT/ELEMENT/BOUNDS gọi captureVisibleTab(windowId), yêu cầu target tab active. P0 mặc định từ chối target inactive; activate chỉ khi caller yêu cầu, có điều phối theo window và kiểm tra identity. FULLPAGE dùng debugger riêng. maxWidth chỉ là postprocess sau nhận, không giảm native frame đầu vào; cần giới hạn nhận riêng và artifact trước khi public.',acceptance='Hai tab cùng window không được trả ảnh A gắn ref B; invalidate khi active tab/viewport thay đổi. Clip/DPR và ảnh >1 MiB phải được kiểm tra; không dùng mock làm bằng chứng capture thật.'),
      'frames': dict(backend='source-internal-routing-public-api-gap',limitation='Source có SplitCustomIdWithFrame và FindSelectors cross-origin routing; chưa có public frame enumeration/schema đã live-verified. Không hứa xuyên mọi iframe/closed shadow root.'),
      'network': dict(limitation='Source có monitor theo tabId, nhưng URL filter hiện hardcode <all_urls>. API filters chỉ là đề xuất, không passthrough sẵn. Network idle không chứng minh app ready; cần ref-count ownership cho watcher cùng tab và cleanup.'),
      'window': dict(candidateCommands='MaximizeWindow GetBrowserWindows GetWindowIdForTabId NavigationCommand',limitation='Maximize có direct entry; NavigationCommand activate + activateWindow có source path focus cửa sổ. Minimize/move/resize/restore chưa xác nhận route. Link Window Operation cũ không dùng làm schema.'),
      'dialog': dict(inputs='contextRef; tabRef; action=arm/wait/respond/cancel; watchRef?; responsePolicy={accept/dismiss,promptText?,expectedType?,messageMatch?}; timeoutMs',limitation='Chưa có raw endpoint JS dialog được xác minh. Arm phải đăng ký response policy có điều kiện trước trigger; chỉ listener là chưa đủ. Manual respond bị deferred đến khi có trigger bất đồng bộ và control path không bị queue ghi chặn.',acceptance='Alert/confirm/prompt phát sinh đồng bộ trong click handler không deadlock; wrong type/message không auto-accept; TTL cleanup và trạng thái unknown rõ.'),
      'visual': dict(limitation='P2 read/find/OCR cần provider riêng. Click/hover/drag từ ảnh chỉ được bật khi action hỗ trợ visualTarget (screenshotRef, point, coordinateSpace, viewportGeneration) cùng input backend đã kiểm chứng. Hiện các visual action là deferred; không chuyển rect thành DOM elementRef giả.'),
      'click': dict(candidateCommands='GenericRequest',inputs='contextRef; elementRef ở P0; button=left/right/middle; clickCount=1/2; modifiers[]; verify?; visualTarget chỉ khi capability P2 được bật',limitation='Driver 23.4: GenericRequest messageId=6 gọi special onClickHtmlElem; ClickHtmlElem không có direct entry. Flags/options khác version. Nhánh tọa độ/debugger phải kiểm chứng riêng; chưa có click thật qua bridge.'),
      'hover': dict(inputs='contextRef; elementRef hoặc visualTarget khi capability tương ứng có; position?; verify?',limitation='SimulateEvent chỉ là candidate phát DOM event; chưa xác nhận pointer movement/CSS :hover. visualTarget là API P2 deferred, cần backend tọa độ; không hứa từ tên GenericRequest.'),
      'drag': dict(limitation='Không có raw DragDrop đã xác nhận. API visualTarget cho endpoint tọa độ chỉ bật cùng backend input và viewport validation; sourceRef/targetRef DOM không tự bao phủ canvas/vision.')
    }
    generic={'element-read':[5], 'wait':[5], 'click':[6], 'popup':[6]}
    live={
      'context':['uipath_bridge_status','uipath_driver_versions'],
      'tabs':['uipath_open_url','uipath_tab_info']
    }
    composed={'snapshot','wait','table-cell','form-read','form-fill','popup','new-tab','calendar','orchestration'}
    for f in features:
        change=updates.get(f['id'],{})
        if 'candidateCommands' in change: change={**change,'candidateCommands':change['candidateCommands'].split()}
        f.update(change)
        f['protocolAuditDate']='2026-10-26'
        f['candidateGenericMessageIds']=generic.get(f['id'],[])
        f['existingLiveVerifiedTools']=live.get(f['id'],[])
        f['extensionSupport']='partial-existing-live' if f['id'] in live else 'composite-awaiting-primitives' if f['id'] in composed else 'source-route-awaiting-live' if f['candidateCommands'] else 'backend-unresolved-or-outside-core'
        if f['id'] in ['hover','drag','keys','events']:f['extensionSupport']='protocol-semantics-unresolved'
        f['protocolNotes']=f['limitation']
        f['candidateCommandAvailability']={n:{'entryPresentInPinnedDriver':by_name[n]['entryPresent'],'routeStatus':by_name[n]['status'],'liveProbeScope':by_name[n].get('liveVerifiedScope')} for n in f['candidateCommands']}
    return features
