import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const REPO = fileURLToPath(new URL('../', import.meta.url));
const load = name => readFile(path.join(REPO, name), 'utf8').then(JSON.parse);
const unique = values => [...new Set(values)];

const g04Steps=['remove-ref-read-and-write-stale','cloned-node-ref-stays-stale','same-url-reload-ref-stale',
  'owned-navigation-ref-stale','same-origin-frame-read-write','cross-origin-frame-read-write',
  'same-frame-reload-stale-and-sibling-valid','cross-frame-reload-stale-and-sibling-valid',
  'react-controlled-replace-append-persists-rerender','react-rejection-detected-no-retry','real-native-reconnect-old-session-stale'];
export function qualifiesG04Evidence(g04,audit,currentHashes){
  const latest=g04?.latestLiveAttempt,steps=latest?.steps;
  return g04?.fixtureSuitePassed===true&&latest?.sourceSha256===audit.sourceSha256
    &&latest?.driverVersion===audit.driverVersion&&latest?.passed===true
    &&latest?.cleanup?.tabCloseAcknowledged===true&&latest?.cleanup?.privateProbeDisabledInProcess===true
    &&g04.cleanup?.passed===true&&g04.cleanup?.tabClosureVerified===true&&g04.cleanup?.tabLeftOpen===false
    &&g04.cleanup?.launcherDisableVerified===true&&g04.cleanup?.privateProbeDisabledVerified===true
    &&latest.probeSourceSha256===currentHashes['src/g0-probe.mjs']
    &&latest.runnerSourceSha256===currentHashes['scripts/run-g04.mjs']
    &&Object.entries(currentHashes).every(([file,hash])=>g04.sourceHashes?.[file]===hash)
    &&Array.isArray(steps)&&steps.length===g04Steps.length
    &&g04Steps.every(name=>steps.filter(s=>s.name===name&&s.passed===true).length===1);
}

// Explicit ownership: new catalog names fail generation until a decision is made.
const decisions = new Map();
function group(names, adapter, tasks, tools, scenario, decision = 'planned', reason = null) {
  for (const name of names.split(' ')) {
    if (decisions.has(name)) throw Error(`Duplicate decision: ${name}`);
    decisions.set(name, { adapter, taskIds: tasks.split(' '), mcpTools: tools ? tools.split(' ') : [], scenario, decision, unsupportedReason: reason });
  }
}
group('Handshake', 'driver.lifecycle', 'F0.3 F1.1', 'browser_attach uipath_open_url uipath_tab_info', 'Load + handshake; sai version/retCode; disconnect giữa activation.');
group('FindBrowserTabs GetActiveTabId GetBrowserWindows GetWindowIdForTabId GetTabCount IsBrowserTabActive GetBrowserTabZoom', 'tabs.identity', 'F1.1 F1.2', 'browser_attach browser_tabs browser_tab_get browser_tab_activate', 'Hai tab/window; strict match; tab đóng/reused; zoom/active không bị suy từ URL.');
group('CloseBrowser', 'tabs.close', 'F1.2', 'browser_tab_close', 'Chỉ đóng tab sở hữu; tab khác không đổi; timeout không đóng lại.');
group('OpenTab', 'tabs.open', 'F1.2', 'uipath_open_url browser_tab_open', 'HTTP(S), reject credentials; OpenTab một lần; giữ ID khi metadata lỗi.');
group('Navigate NavigationCommand ReplaceTabAndNavigate', 'tabs.navigation', 'F1.3', 'browser_navigate browser_history browser_tab_activate browser_focus', 'Redirect/history/reload; invalidate refs; replace đổi tab ID; home không dùng hardcode làm Chrome home.');
group('FindSelectors FindContainer GetHtmlAncestryInfo GetHtmlIndex GetSelectorAttributeNames MatchesTag GetHtmlFromPoint', 'elements.discovery', 'G0.2 F2.1', 'browser_find_element browser_find_elements browser_snapshot', '0/1/n match; selector exact; scope/frame; ancestor/index/point đúng; customId không là CSS.');
group('GetHtmlAttribute GetHtmlAttributesList GetHtmlAttrValuesList GetAttributeForElements GetHtmlValueForElements', 'elements.read', 'G0.2 F2.2', 'uipath_tab_info browser_get_element browser_form_read browser_extract_table', 'Tab metadata khác DOM; attribute/property/value; batch partial, Unicode, missing field.');
group('GetFocusedHtmlElement IsHtmlElemDisabled IsHtmlElemValid IsHtmlElemVisible IsHtmlPointVisible IsTabContentAccessible', 'elements.state', 'G0.4 F2.2 F2.3', 'browser_get_element browser_wait_for browser_focus', 'Removed/stale/hidden/disabled/readonly/occluded khác nhau; navigation không là absent.');
group('GetHtmlRectangle GetHtmlDevicePixelRatio GetRectFromText GetTextFromScreenRect', 'elements.geometry', 'F2.2 F3.3', 'browser_get_element browser_screenshot', 'CSS/device/screen coordinates, zoom/scroll; DOM text vùng không được quảng bá là OCR.');
group('GenericRequest', 'protocol.generic-router', 'G0.2 F3.1 F4.1', 'browser_get_element browser_click browser_hover browser_drag_and_drop browser_close_popup', 'Allowlist messageId; special handler ưu tiên mapping; không public arbitrary dispatch.', 'internal-only');
group('WriteTextHtmlElem', 'input.text', 'G0.3 F3.1 F4.1', 'browser_type browser_press_keys browser_set_text browser_form_fill', 'Một token.text; replace/append; input/change; debugger/key tokens tách; không retry append.');
group('CheckHtmlElem', 'input.checked', 'F3.2', 'browser_set_checked browser_form_fill', 'Đọc trước/sau desired state; checkbox khác radio; không toggle mù.');
group('HtmlGetSelectedItems HtmlSetSelectedItems', 'input.select', 'F3.2', 'browser_select_options browser_get_element browser_form_fill', 'Single/multi select; option không tồn tại; readback; disabled; partial change.');
group('BringElementIntoView ScrollIntoView MouseWheelDebugger', 'input.scroll', 'F3.2', 'browser_scroll', 'Scroll container/viewport, tọa độ/zoom, stale target; debugger cleanup; verify sau scroll.');
group('SetFocusedHtmlElement', 'input.focus', 'F3.2', 'browser_focus', 'Focus đúng ref, blur/change; hidden/disabled reject; tab/window không đổi âm thầm.');
group('TakeScreenshot', 'artifacts.screenshot', 'F3.3', 'browser_screenshot browser_visual_find browser_ocr', 'Hai tab cùng window; active-tab race; 1 MiB transport; full-page debugger cleanup; ảnh không là OCR.');
group('InjectAndRunJs', 'script.evaluate', 'F4.1', 'browser_evaluate browser_set_text', 'isScriptErr, serialize/Promise/world; timeout có outcome unknown; không retry script ghi.');
group('RunJS', 'script.registered', 'F4.1', '', 'Tên registry tồn tại/không tồn tại; retCode=1 + isScriptErr=1 là lỗi; jsCode không được thực thi.', 'internal-only');
group('SetHtmlAttribute', 'elements.mutate-attribute', 'F4.4', 'browser_set_attribute', 'Attribute khác property; readback; không suy input/change hoặc business success.');
group('GetSelectedRange SetSelectedRange', 'input.selection', 'F4.4', 'browser_text_selection', 'Range boundary/Unicode; detached node; selection readback.');
group('SimulateEvent', 'input.events', 'F4.4 F5.6', 'browser_hover browser_drag_and_drop browser_close_popup', 'Event synthetic khác pointer thật/CSS hover/HTML5 drag; unsupported event reject trước dispatch.');
group('StartHighlight StopHighlight', 'debug.highlight', 'F4.4', 'browser_highlight', 'Scope/ref/TTL; stop khi disconnect/navigation; không đổi target state.');
group('ExtractData ExtractMetadata IsSamplePartOfANewColumn', 'extract.tables', 'F4.2', 'browser_extract_table browser_table_cell', 'Metadata contract; duplicate/virtual rows; pagination stop; output bound; heuristic column không suy schema.');
group('GetSapFioriAllColLabels', 'controls.sap-fiori', 'F4.4 F5.5', 'browser_table_cell', 'SAP fixture riêng; labels/virtual column; non-SAP trả unsupported, không claim SAP parity.');
group('TreeExpandPath TreeGetAllPaths TreeGetNodePath', 'controls.tree', 'F4.4', 'browser_tree', 'Node/path ambiguity, lazy load, detached node; không suy mọi tree widget.');
group('StartWebRequestMonitoring AnyWebRequestsInFlight StopWebRequestMonitoring', 'network.monitor', 'F4.3', 'browser_network_wait', 'Start/stop TTL + cleanup; long-poll; all_urls filter hardcoded; network idle khác app ready.');
group('SetBigString AppendBigString GetBigString DeleteBigString', 'session.big-string', 'F4.3', 'browser_cookies', 'Chunk/order/size/quota; delete trong finally; không log cookie; timeout append không retry.', 'internal-only');
group('GetBrowserData SetBrowserData', 'session.cookies', 'F4.3', 'browser_cookies', 'Cookie roundtrip/domain/path/permission; cleanup buffer; không suy localStorage/sessionStorage.');
group('AttachDebugger DetachDebugger SupportsDebugger', 'debug.debugger-lifecycle', 'F4.5', 'browser_evaluate browser_screenshot browser_press_keys', 'Debugger busy/permission; attach/detach ownership; cleanup khi timeout; không detach phiên của người dùng.', 'internal-only');
group('MaximizeWindow', 'window.state', 'F5.4', 'browser_window', 'Đúng window; maximize/restore; không suy minimize/native process controls.');
group('MonitorNativeEvents', 'events.recorder', 'F5.6', 'browser_events', 'Schema/event scope/TTL/backpressure; ignore event ngoài fixture; không coi listener là send-key.');
group('FindWebCtrlElements', 'unsupported.stub-discovery', 'F0.4', '', 'Negative: không dispatch stub; candidate FindSelectors phải qua G0.', 'unsupported', 'PINNED_STUB_NO_CALLBACK: handler chỉ khai báo biến, không trả kết quả.');
group('GetHtmlElemById', 'unsupported.dom-id-lookup', 'F0.4', '', 'Negative DOM lookup; nhánh tab-only không được dùng làm element getter.', 'unsupported', 'PINNED_PARTIAL_TAB_ONLY: tabId thường/index hợp lệ không trả lời nhánh DOM.');
group('ClickHtmlElem', 'input.click-via-generic-6', 'G0.3 F3.1', 'browser_click', 'Direct call bị cấm; GenericRequest 6 special route; button/count/flags; timeout không retry.', 'alternative-route', 'DIRECT_ENTRY_ABSENT: driver ghim dùng GenericRequest messageId 6.');
group('GetHtmlValue', 'elements.value-via-generic-5', 'G0.2 F2.2', 'browser_get_element browser_wait_for', 'Direct call bị cấm; GenericRequest 5/content18; body text khác input value.', 'alternative-route', 'DIRECT_ENTRY_ABSENT: dùng GenericRequest messageId 5 hoặc reader batch.');
group('GetHtmlCollectionById', 'unsupported.legacy-collection', 'F0.4', '', 'Negative legacy dispatch; thay discovery bằng FindSelectors sau G0.', 'unsupported', 'DIRECT_ENTRY_ABSENT: legacy collection không tồn tại ở driver ghim; không suy schema tương đương FindSelectors.');
group('GetHtmlIdInfo', 'unsupported.legacy-id-info', 'F0.4', '', 'Negative dispatch; resolver/ref registry không phụ thuộc helper legacy.', 'unsupported', 'DIRECT_ENTRY_ABSENT: chưa có contract tương đương cho helper ID legacy.');
group('IsHtmlVisible', 'unsupported.legacy-visible', 'F0.4', '', 'Negative alias; test IsHtmlElemVisible riêng trước khi thay thế semantics.', 'unsupported', 'DIRECT_ENTRY_ABSENT: visibility legacy không có ở driver ghim; không alias âm thầm.');
group('IsInstanceOfHtmlElement', 'unsupported.legacy-instance-check', 'F0.4', '', 'Negative direct call; validate scope/ref bằng primitive đã kiểm chứng.', 'unsupported', 'DIRECT_ENTRY_ABSENT: helper legacy không có tuyến trực tiếp đã audit trong driver ghim.');
group('EnableTracing', 'unsupported.driver-tracing', 'F0.4 F4.5', '', 'Negative direct tracing; bridge logging riêng không giả lập vendor tracing.', 'unsupported', 'DRIVER_VERSION_MISMATCH: entry chỉ có ở driver 23.10, không có ở 23.4 ghim.');
group('OpenMarkerTabs CloseMarkerTabs', 'unsupported.vendor-marker-tabs', 'F0.4', '', 'Negative marker dispatch; broker không tạo/xóa marker tab vendor.', 'unsupported', 'DIRECT_ENTRY_ABSENT: marker workflow legacy không có trong driver ghim và không cần cho own tab refs.');
group('IgnoreNextKeystrokeEvent', 'unsupported.recorder-key-filter', 'F0.4', '', 'Negative send-key mapping; không dùng recorder filter làm keyboard input.', 'unsupported', 'DIRECT_ENTRY_ABSENT_AND_WRONG_SEMANTICS: bỏ qua sự kiện recorder không phải phát phím.');
group('GetTaskMiningInfoFromFocus GetTaskMiningInfoFromPoint', 'unsupported.task-mining-contract', 'F0.4 F5.6', '', 'Không public payload Task Mining; cần design recorder/metadata riêng trước khi enable.', 'unsupported', 'OUTSIDE_CURRENT_PUBLIC_CONTRACT: telemetry Task Mining không có API/schema/acceptance trong 53 tool browser; không suy thành DOM read.');

const featureTasks = {
  context:['F0.2','F1.1'], tabs:['F1.2'], navigate:['F1.3'], snapshot:['F2.3'], find:['G0.2','F2.1'],
  'element-read':['F2.2'], wait:['F2.3'], click:['F3.1'], type:['F3.1'], checked:['F3.2'], select:['F3.2'], scroll:['F3.2'], focus:['F3.2'], screenshot:['F3.3'],
  keys:['F4.1'], 'set-text':['F4.1'], 'set-attribute':['F4.4'], hover:['F4.4'], drag:['F5.6'], frames:['F4.6'], selection:['F4.4'], highlight:['F4.4'], script:['F4.1'], extract:['F4.2'], 'table-cell':['F4.4'], tree:['F4.4'], calendar:['F5.5'], 'form-read':['F4.2'], 'form-fill':['F4.2'], semantic:['F5.5'], popup:['F4.4'], network:['F4.3'], events:['F5.6'], 'new-tab':['F1.2','F4.3'], dialog:['F5.1'], 'file-picker':['F5.1'], downloads:['F4.3'], cookies:['F4.3'], window:['F5.4'], launch:['F5.4'], clipboard:['F5.4'], 'image-files':['F5.4'], visual:['F5.2'], accessibility:['F5.5'], sap:['F5.5'], orchestration:['F4.2'], 'desktop-out':['F5.4']
};
const phase = id => id.startsWith('G0.') ? 0 : Number(id[1]);
const testPlans = (key, d) => [
  { id:`contract:${key}`, level:'offline-adapter', status:'planned', scenario:d.scenario },
  { id:`fixture:${key}`, level:d.decision==='unsupported'?'negative-source-contract':'live-fixture', status:'planned',
    scenario:d.decision==='unsupported'?'Không gửi endpoint unsupported; capability không available; giữ lý do/route thay thế.':`Fixture scope riêng cho ${key}; hậu kiểm và lỗi/timeouts; không suy live từ catalog.` }
];

export async function buildMatrix() {
  const [catalog, audit, spec] = await Promise.all([load('docs/uipath-function-catalog.json'),load('docs/pinned-driver-audit.json'),load('docs/browser-feature-spec.json')]);
  const catalogNames = new Set(catalog.functions.map(f=>f.name));
  if (decisions.size!==catalogNames.size || [...decisions.keys()].some(n=>!catalogNames.has(n))) throw Error('Catalog/explicit decision set differs; add/review every function');
  const rows = catalog.functions.map(fn=>{
    const d=decisions.get(fn.name); if(!d) throw Error(`Missing decision ${fn.name}`);
    const route=audit.namedEntries.find(a=>a.name===fn.name); if(!route)throw Error(`Missing audit ${fn.name}`);
    const partial=['Handshake','OpenTab','GetActiveTabId','GetHtmlAttribute','FindBrowserTabs'].includes(fn.name);
    const devProbe=['FindSelectors','IsHtmlElemValid','WriteTextHtmlElem','CloseBrowser','GenericRequest','ClickHtmlElem','GetHtmlValue'].includes(fn.name);
    return { key:`named:${fn.name}`, kind:'named', name:fn.name, ...d,
      phaseNumbers:unique(d.taskIds.map(phase)), implementationStatus:partial||devProbe?'partial':d.decision==='unsupported'?'unsupported':'planned',
      implementedScope:partial?(fn.name==='GetHtmlAttribute'?'empty customId; url/title/readystate only':fn.name==='FindBrowserTabs'?'Internal IPC/CLI URL-match diagnostic only; no public MCP or live proof':'legacy navigation/activation path only'):
        devProbe?'Private opt-in G0 fixture candidate only; offline adapter tests; no public DOM capability or live proof':null,
      pinnedRoute:{entryPresent:route.entryPresent,status:route.status,contentCommandIds:route.contentCommandIds??[],sourceOffset:route.sourceOffset??null},
      driverVersions:fn.implementations.map(i=>i.driverVersion),
      evidence:[{level:'source-audited',source:'docs/pinned-driver-audit.json',liveVerified:route.liveVerified===true,scope:route.liveVerifiedScope??null},
        ...(partial||devProbe?[{level:'implementation-source',source:devProbe?'src/g0-probe.mjs':'src/bridge.mjs',liveVerified:false,scope:devProbe?'Private fixture-only development adapter':'Narrow legacy/internal implementation only'}]:[])],
      tests:testPlans(`named:${fn.name}`,d) };
  });
  const aux=(kind,name,adapter,taskIds,mcpTools,scenario,implemented=false)=>({key:`${kind}:${name}`,kind,name,adapter,taskIds,mcpTools,scenario,
    decision:'internal-only',unsupportedReason:null,phaseNumbers:unique(taskIds.map(phase)),implementationStatus:implemented?'partial':'planned',
    implementedScope:implemented?'Existing pinned prototype handshake/callback behavior only':null,
    notPublicReason:'Hạ tầng protocol; consumer tool dùng gián tiếp, không tạo raw public MCP endpoint.',
    evidence:[{level:'catalog-only',source:'docs/uipath-function-catalog.json',liveVerified:false,scope:null},
      ...(implemented?[{level:'implementation-source',source:'src/bridge.mjs',liveVerified:false,scope:'Exact fixed-version prototype handler; not full vendor callback contract.'}]:[])],
    tests:testPlans(`${kind}:${name}`,{scenario,decision:'internal-only'})});
  for(const name of catalog.loaderFunctions) rows.push(aux('loader',name,'driver.loader',['F0.3','F1.1'],
    name==='GetEmbeddedDriverVersions'?['uipath_driver_versions','browser_capabilities']:['browser_attach','uipath_open_url'],
    name==='_ValidatePermissions'?'Permission denied có lý do; kiểm tra không tự cấp quyền.':'Version compatibility/load failure/handshake; response đúng correlation ID.', ['GetEmbeddedDriverVersions','OnProductVersionChanged'].includes(name)));
  for(const name of catalog.staticReverseCalls) rows.push(aux('host-callback',name,'host.callbacks',name==='IsTraceEnabled'?['F4.5']:['F0.3','F1.1'],
    name==='IsTraceEnabled'?[]:['browser_attach','uipath_open_url'],
    name==='LoadScripts'?'Decline external driver bằng return null; metadata đúng pinned version; không bundle vendor source.':
    name==='IsTraceEnabled'?'Trả 0 cho trace chưa hỗ trợ; không coi callback này là EnableTracing.':
    name==='RegisterNewlyCreatedWindowId'||name==='UnregisterWindowId'?'Ack requestId; register/unregister cleanup và idempotency.':'Detailed version đúng bốn component; mismatch không silently load driver khác.',true));

  const contentOwner = {0:'FindBrowserTabs',1:'CheckHtmlElem',2:'ClickHtmlElem',3:'MatchesTag',5:'ExtractData',6:'ExtractMetadata',7:'FindContainer',8:'FindSelectors',9:'GetFocusedHtmlElement',10:'GetHtmlAncestryInfo',11:'GetHtmlAttribute',12:'GetHtmlAttributesList',13:'GetHtmlAttrValuesList',14:'GetHtmlDevicePixelRatio',15:'GetHtmlFromPoint',16:'GetHtmlIndex',17:'GetHtmlRectangle',18:'GetHtmlValue',19:'GetRectFromText',20:'GetSapFioriAllColLabels',21:'GetSelectorAttributeNames',22:'GetTextFromScreenRect',23:'HtmlGetSelectedItems',24:'GetSelectedRange',25:'HtmlSetSelectedItems',26:'SetSelectedRange',27:'InjectAndRunJs',28:'IsHtmlElemDisabled',29:'IsHtmlElemValid',30:'IsHtmlElemVisible',31:'IsHtmlPointVisible',32:'IsSamplePartOfANewColumn',33:'IsTabContentAccessible',34:'NavigationCommand',35:'RunJS',36:'ScrollIntoView',37:'SetFocusedHtmlElement',38:'SetHtmlAttribute',39:'SimulateEvent',40:'StartHighlight',41:'StopHighlight',42:'TreeExpandPath',43:'TreeGetAllPaths',44:'TreeGetNodePath',45:'WriteTextHtmlElem',48:'MonitorNativeEvents'};
  const contentRows = audit.contentDispatch.map(c=>{
    const owner=contentOwner[c.contentCommandId],d=decisions.get(owner);
    const unknown=!d;
    const entry={key:`content:${c.contentCommandId}`,kind:'content',name:String(c.contentCommandId),handlerBindings:c.handlerBindings,
      adapter:d?.adapter??'unsupported.opaque-content-handler',taskIds:d?.taskIds??['F0.4'],mcpTools:d?.mcpTools??[],
      decision:unknown?'unsupported':'internal-only',implementationStatus:unknown?'unsupported':'planned',
      unsupportedReason:unknown?'NO_AUDITED_HOST_CONTRACT: handler opaque hoặc chưa truy vết đầy đủ; không dispatch content ID trực tiếp.':null,
      notPublicReason:'Content ID là dispatch nội bộ, không phải functionCall host; cần parent route đã audit.',
      parentNamedFunction:owner??null,sourceOffset:c.sourceOffset,
      phaseNumbers:unique((d?.taskIds??['F0.4']).map(phase)),
      scenario:d?.scenario??'Không dispatch opaque/internal matcher từ host; audit contract trước khi thêm adapter.'};
    entry.tests=testPlans(entry.key,entry);return entry;
  });
  rows.push(...contentRows);
  for(const [type,routes] of [['map',audit.genericRoutes],['special',audit.specialRoutes]]) for(const g of routes){
    const c=contentRows.find(c=>c.name===String(g.contentCommandId));
    const shadowed=type==='map'&&audit.specialRoutes.some(s=>s.messageId===g.messageId);
    const d=g.messageId===6?decisions.get('ClickHtmlElem'):c;
    if(!d&&!(type==='special'&&g.messageId===75))throw Error(`Missing explicit generic owner ${type}:${g.messageId}`);
    const entry={key:`generic:${type}:${g.messageId}`,kind:'generic',name:String(g.messageId),routeType:type,contentCommandId:g.contentCommandId??null,
      handlerBindings:g.contentBindings??(g.handler?[g.handler]:[]),adapter:d?.adapter??'driver.identity',taskIds:d?.taskIds??['F1.1'],mcpTools:d?.mcpTools??[],
      phaseNumbers:unique((d?.taskIds??['F1.1']).map(phase)),implementationStatus:'planned',decision:shadowed?'shadowed':'internal-only',
      unsupportedReason:shadowed?'SPECIAL_HANDLER_PRECEDENCE: GenericRequest 6 vào special handler trước mapping; không bypass nó.':null,
      notPublicReason:'GenericRequest là tuyến nội bộ allowlist; không cung cấp arbitrary messageId cho agent.',
      scenario:shadowed?'Assert special-before-map; không giả định content mapping là tuyến có hiệu lực.':d?.scenario??'ID 75 identity diagnostic nội bộ dự kiến; browser_capabilities hiện không gọi tuyến này; kiểm tra version/retCode trước mọi consumer tương lai.'};
    if(type==='special'&&g.messageId===6){
      if(audit.sourceSha256!=='4de732c63b8a6b1b22e12a9db2a4a13ae2c0700a80669fd26631f7488f4b7308')throw Error('Re-audit special click dispatch after source change');
      entry.contentCommandId=2;
      entry.dispatchEvidence={source:'EmbeddedDriversContainer.js',sha256:audit.sourceSha256,handlerStart:2979675,handlerEnd:2981315,callOffset:2981288,
        condition:'Debugger flag clear: special onClickHtmlElem invokes content 2; debugger branch is separate.',level:'source-audited',liveVerified:false};
    }
    entry.tests=testPlans(entry.key,entry);rows.push(entry);
  }
  const g0 = await load('docs/G0-LIVE-VERIFICATION.json');
  if(g0.smokePassed===true&&g0.latestLiveAttempt?.sourceSha256===audit.sourceSha256
    &&g0.latestLiveAttempt?.cleanup?.passed===true&&g0.latestLiveAttempt?.smokePassed===true){
    const scopes={
      'named:FindSelectors':'Private main-frame fixture: missing=0, input=1, duplicates=2, button=1; owned tab|0|local ID normalization.',
      'named:IsHtmlElemValid':'Private fixture valid refs before read/write only; stale/navigation/iframe behavior not verified.',
      'named:GetHtmlAttribute':'Private fixture input/button id read; other DOM attributes not verified.',
      'named:GenericRequest':'Private fixture messageId 5 value read and special messageId 6 single click, flags=0 only.',
      'named:GetHtmlValue':'Alternative route only: GenericRequest 5 value read; named direct entry remains absent.',
      'named:ClickHtmlElem':'Alternative route only: GenericRequest 6, flags=0, one counter click; named direct entry remains absent.',
      'named:WriteTextHtmlElem':'Private native input: Unicode replace/append via one token, options 0/4, independent input counter/value readback.',
      'named:CloseBrowser':'Private owned fixture cleanup acknowledged; no general tab-close API verification.',
      'generic:map:5':'Private fixture GenericRequest 5 value read only.',
      'generic:special:6':'Private fixture flags=0 single counter click; debugger branch not tested.'
    };
    for(const r of rows)if(scopes[r.key]){
      (r.evidence??=[]).push({level:'live-fixture-verified',source:'docs/G0-LIVE-VERIFICATION.json',liveVerified:true,scope:scopes[r.key]});
      r.implementationStatus='partial';
      r.implementedScope=(r.key==='named:GetHtmlAttribute'?'Legacy tab metadata plus private fixture id read only. ':scopes[r.key]+' ')
        +'Public general DOM APIs/options remain gated.';
    }
  }
  const g04=await load('docs/G0-4-LIVE-VERIFICATION.json');
  const g04Files=['src/g0-probe.mjs','scripts/run-g04.mjs','scripts/g04-fixture.mjs','scripts/fixtures/g04-app.jsx','package-lock.json'];
  const g04Hashes=Object.fromEntries(await Promise.all(g04Files.map(async p=>[p,createHash('sha256').update(await readFile(path.join(REPO,p))).digest('hex')])));
  if(qualifiesG04Evidence(g04,audit,g04Hashes)){
    const scopes={
      'named:FindSelectors':'Private G0.4 fixed main/same-origin/cross-port iframe paths; not-found translation and refind after clone/navigation/frame reload.',
      'named:IsHtmlElemValid':'Private G0.4 removed/cloned/old frame refs rejected; generation/node guards supplement native validity; sibling/main refs remain valid.',
      'named:GetHtmlAttribute':'Private G0.4 id and nonce document/node marker attributes in main/child frames, plus parent URL/title guards.',
      'named:GenericRequest':'Private G0.4 messageId 5 fixed input value readback in main/child frames and React controls.',
      'named:GetHtmlValue':'Alternative only: GenericRequest 5 fixed fixture value readback; named direct entry absent.',
      'named:WriteTextHtmlElem':'Private G0.4 options 0/4, fixed Unicode, same/cross-origin iframe and React 19.3.1 DOM/model after rerender; rejecting control detected, no retry.',
      'named:CloseBrowser':'Private G0.4 orphan cleanup after proven native PID/start-time change; exact owned fixture URL/title/tab guards.',
      'generic:map:5':'Private G0.4 fixed input value readback in main/child frames and React controls.'
    };
    for(const r of rows)if(scopes[r.key]){
      (r.evidence??=[]).push({level:'live-fixture-verified',source:'docs/G0-4-LIVE-VERIFICATION.json',liveVerified:true,
        scope:scopes[r.key]+' Multi-RPC identity checks are not atomic; other sites/frameworks and public DOM APIs remain unverified.'});
      r.implementationStatus='partial';
      r.implementedScope=scopes[r.key]+' Public general DOM APIs/options remain gated.';
    }
  }
  const generic=rows.find(r=>r.key==='named:GenericRequest');
  const activeGeneric=rows.filter(r=>r.kind==='generic'&&r.decision!=='shadowed');
  generic.mcpTools=unique(activeGeneric.flatMap(r=>r.mcpTools));
  generic.taskIds=unique(activeGeneric.flatMap(r=>r.taskIds));
  generic.phaseNumbers=unique(generic.taskIds.map(phase));
  generic.scenario='Aggregate allowlist for all active generic routes below; special-before-map; no arbitrary dispatch. Consumers are planned dependencies, not enabled tools.';
  const featureCoverage=spec.features.map(f=>({featureId:f.id,priority:f.phase,tools:f.proposedTools,taskIds:featureTasks[f.id],
    backend:f.backend,candidateFunctionKeys:f.candidateCommands.map(n=>`named:${n}`),
    needsSeparateBackend:f.candidateCommands.length===0,
    limitation:f.limitation,tests:[{id:`feature:${f.id}`,status:'planned',level:'workflow-fixture',scenario:f.acceptance}]}));
  if(featureCoverage.some(f=>!f.taskIds?.length))throw Error('Unassigned feature');
  const sourceFiles=['docs/uipath-function-catalog.json','docs/pinned-driver-audit.json','docs/browser-feature-spec.json','docs/G0-LIVE-VERIFICATION.json','docs/G0-4-LIVE-VERIFICATION.json','src/bridge.mjs',...g04Files];
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash('sha256').update(await readFile(path.join(REPO,p))).digest('hex')])));
  return { schemaVersion:1,baselineDate:'2026-10-26',pinnedDriver:audit.driverVersion,extensionVersion:audit.extensionVersion,
    scope:'All cataloged named functions across six drivers; pinned loader/reverse and audited generic/content dispatch. Not all private JS helpers or future extension versions.',
    status:'planning-matrix-not-runtime-capabilities',sourceHashes,
    counts:{named:catalog.functions.length,loader:catalog.loaderFunctions.length,hostCallbacks:catalog.staticReverseCalls.length,
      genericMapEntries:audit.genericRoutes.length,genericSpecialEntries:audit.specialRoutes.length,
      genericDistinctMessageIds:new Set([...audit.genericRoutes,...audit.specialRoutes].map(g=>g.messageId)).size,
      content:audit.contentDispatch.length,rows:rows.length,features:featureCoverage.length,proposedTools:new Set(featureCoverage.flatMap(f=>f.tools)).size},
    rows,featureCoverage };
}

const escape = text=>String(text??'—').replaceAll('|','\\|').replaceAll('\n',' ');
export function renderMatrix(m){
  const lines=['# Ma trận function extension → adapter → MCP → task/phase → kiểm thử','',
    `Baseline ${m.baselineDate}; extension ${m.extensionVersion}, driver ghim ${m.pinnedDriver}.`,
    '',`Bao phủ **${m.counts.named} tên function** trong union 6 driver, **${m.counts.loader} loader**, **${m.counts.hostCallbacks} host callbacks**, **${m.counts.genericMapEntries} generic mappings + ${m.counts.genericSpecialEntries} special handlers** (${m.counts.genericDistinctMessageIds} messageId phân biệt), **${m.counts.content} content IDs**. Tổng ${m.counts.rows} hàng protocol.`,
    '', 'Đây là ma trận quyết định và kiểm thử dự kiến, không phải danh sách capability khả dụng. `planned` vẫn chưa triển khai; `internal-only` chỉ dùng trong adapter; `alternative-route` cấm direct entry và chờ tuyến thay thế; `unsupported` có lý do theo driver ghim. `shadowed` là mapping bị special handler ưu tiên. Test scenario trong bảng chưa được chạy trừ evidence/scope ghi rõ trong JSON.',
    '', 'Một function có thể phục vụ nhiều tool; một tool có thể cần nhiều function hoặc backend ngoài extension. Không public raw GenericRequest/content IDs. `partial` có thể là CLI nội bộ hoặc dev probe: xem implementedScope/evidence, không suy public MCP đã hỗ trợ. Phạm vi không bao gồm mọi helper JavaScript riêng trong bundle hay extension/version tương lai.',
    '', '[G0 live receipt](G0-LIVE-VERIFICATION.json) bổ sung bằng chứng hẹp cho private main-frame fixture; xem evidence trong JSON theo từng route. Các test acceptance rộng vẫn planned, full G0 và public DOM capability vẫn chưa đạt.',
    '', '[G0.4 live receipt](G0-4-LIVE-VERIFICATION.json) ghi 11 ca stale/frame/React/reconnect đạt và cleanup/probe disable. Đây là kiểm chứng fixture cố định, không chứng minh atomic identity/dispatch hoặc mọi framework/site; 423 scenario rộng vẫn là kế hoạch.',
    '', 'Special ID 6: source audit bổ sung xác nhận nhánh không debugger của onClickHtmlElem gọi content 2 (handler offsets 2979675–2981315, call 2981288, SHA256 trong JSON). Mapping ID 6 vẫn bị special handler ưu tiên; không bypass flags/coordinate processing.',
    '', '[Task theo phase](DEVELOPMENT-PHASES.vi.md) · [JSON đầy đủ: version/route/test ID/evidence](extension-function-matrix.json)', ''];
  for(const [kind,title] of [['named','Function theo tên'],['loader','Loader'],['host-callback','Callback extension → native host'],['generic','Generic routes (special trước map)'],['content','Content dispatch nội bộ']]){
    lines.push(`## ${title}`,'','| Function/route | Adapter | MCP consumer/đích | Task (phase) | Quyết định / implementation | Unsupported / giới hạn | Kiểm thử dự kiến |','|---|---|---|---|---|---|---|');
    for(const r of m.rows.filter(r=>r.kind===kind))lines.push(`| ${escape(r.key)} | ${escape(r.adapter)} | ${escape(r.mcpTools.join(', ')||'Nội bộ/không public')} | ${escape(r.taskIds.map(t=>`${t} (P${phase(t)})`).join(', '))} | ${r.decision} / ${r.implementationStatus} | ${escape(r.unsupportedReason??r.implementedScope??r.notPublicReason??'Chờ adapter + fixture; source không chứng minh live')} | ${escape(r.scenario)} |`);
    lines.push('');
  }
  lines.push('## Coverage của toàn bộ feature/MCP roadmap','','| Feature | MCP tools | Task | Backend / giới hạn | Kiểm thử nghiệm thu |','|---|---|---|---|---|');
  for(const f of m.featureCoverage)lines.push(`| ${f.featureId} (${f.priority}) | ${escape(f.tools.join(', ')||'Orchestrator/provider; không thêm tool')} | ${f.taskIds.join(', ')} | ${escape(f.backend+'; '+f.limitation)} | ${escape(f.tests[0].scenario)} |`);
  lines.push('','## Kiểm chứng và cập nhật','','Chạy `npm run matrix:check` để kiểm tra độ phủ, nguồn hash, task/tool references, lý do unsupported và artifact drift. Chạy `npm run matrix:build` sau khi review quyết định trong `scripts/build-function-matrix.mjs`. Validator không biến test dự kiến thành test runtime đã chạy.','');
  return lines.join('\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const m=await buildMatrix();
  await writeFile(path.join(REPO,'docs/extension-function-matrix.json'),JSON.stringify(m,null,2)+'\n');
  await writeFile(path.join(REPO,'docs/EXTENSION-FUNCTION-MATRIX.vi.md'),renderMatrix(m));
  console.log(JSON.stringify(m.counts));
}
