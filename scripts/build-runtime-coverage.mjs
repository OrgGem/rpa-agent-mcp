import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BROWSER_TOOLS,UNAVAILABLE_TOOLS,BROWSER_CONTRACT} from '../src/browser-tools.mjs';
import {buildMatrix} from './build-function-matrix.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const shared=['OnProductVersionChanged','Handshake'];
const identity=['InjectAndRunJs','GetWindowIdForTabId'];
const metadata=['GetHtmlAttribute','GetWindowIdForTabId','GetActiveTabId','InjectAndRunJs'];
const enumerate=['FindBrowserTabs','GetTabCount',...metadata];
const element=[...identity,'InjectAndRunJs'];
const special={browser_attach:[...metadata],browser_tabs:enumerate,browser_tab_open:['OpenTab',...identity,...metadata],browser_tab_get:identity,
  browser_tab_activate:['NavigationCommand','GetActiveTabId',...identity],browser_tab_close:['CloseBrowser',...enumerate],browser_navigate:['Navigate',...metadata],browser_history:['NavigationCommand',...metadata],
  browser_find_element:[...identity,'FindSelectors'],browser_find_elements:[...identity,'FindSelectors'],browser_frame_attach:[...identity,'FindSelectors','IsHtmlElemValid'],
  browser_click:[...element,'FindSelectors','IsHtmlElemValid','GenericRequest'],browser_type:[...element,'FindSelectors','IsHtmlElemValid','WriteTextHtmlElem'],
  browser_set_checked:[...element,'FindSelectors','IsHtmlElemValid','CheckHtmlElem'],browser_select_options:[...element,'FindSelectors','IsHtmlElemValid','HtmlSetSelectedItems'],
  browser_evaluate:[...identity,'FindSelectors','IsHtmlElemValid'],browser_screenshot:[...identity,'GetActiveTabId','TakeScreenshot'],
  browser_extract_table:[...element,...metadata],browser_close_popup:[...element,...metadata],browser_network_wait:[...identity,'StartWebRequestMonitoring','AnyWebRequestsInFlight','StopWebRequestMonitoring'],
  browser_events:identity,browser_wait_new_tab:enumerate,browser_window:[...identity,'GetActiveTabId','NavigationCommand','MaximizeWindow'],browser_focus:[...element,'NavigationCommand','GetActiveTabId'],browser_image_artifact:[]};
const advancedModules=new Set(['browser_form_read','browser_form_fill','browser_extract_table','browser_table_cell','browser_tree','browser_calendar_select','browser_close_popup']);
const observerModules=new Set(['browser_screenshot','browser_network_wait','browser_events','browser_wait_new_tab','browser_cookies','browser_window','browser_image_artifact']);
const domBypass=new Set('GetHtmlAttributesList GetHtmlAttrValuesList GetAttributeForElements GetHtmlValueForElements GetHtmlValue GetHtmlRectangle GetHtmlDevicePixelRatio IsHtmlElemDisabled IsHtmlElemVisible IsHtmlPointVisible GetFocusedHtmlElement BringElementIntoView ScrollIntoView SetFocusedHtmlElement SetHtmlAttribute HtmlGetSelectedItems GetSelectedRange SetSelectedRange SimulateEvent StartHighlight StopHighlight ExtractData ExtractMetadata IsSamplePartOfANewColumn TreeExpandPath TreeGetAllPaths TreeGetNodePath MonitorNativeEvents'.split(' '));
const riskReasons={GetBrowserData:'Not dispatched: exports cookies across the entire profile, including unrelated origins; public cookies use document.cookie only.',SetBrowserData:'Not dispatched: profile-wide destructive cookie replacement is not a scoped/transactional cookie API.',WriteTextHtmlElem:'Native text only options 0/4; debugger key-token route is unavailable.',AttachDebugger:'Not dispatched: shared debugger ownership and targeted trusted key input are not implemented.',DetachDebugger:'Not dispatched: cannot detach a debugger owned by another client.',SupportsDebugger:'No debugger-backed public option is enabled.',GetSapFioriAllColLabels:'SAP-specific native schema is not a generic HTML table contract; public table tools use isolated DOM.',ReplaceTabAndNavigate:'Not dispatched: replacing a native tab needs separate ownership/identity semantics; public navigate uses Navigate.'};
export async function buildRuntimeCoverage(){
  const matrix=await buildMatrix(),tools=BROWSER_CONTRACT.tools.map(t=>{
    if(t.unsupportedReason)return {name:t.name,phase:t.phase,status:'unsupported',unsupportedReason:t.unsupportedReason,adapter:null,routes:[],offline:{status:'not-applicable'},live:{status:'not-applicable'}};
    const module=advancedModules.has(t.name)?'src/browser-composites.mjs':observerModules.has(t.name)?'src/browser-observers.mjs':'src/browser-operations.mjs';
    const routes=[...new Set([...shared,...(special[t.name]??element)])];
    return {name:t.name,phase:t.phase,status:'implemented-source',adapter:module,routes,contract:'docs/browser-tool-contracts.json',
      offline:{status:'test-source',source:'test/browser-runtime.test.mjs',limitations:'Focused regression coverage; not all planned scenarios or browser semantics.'},
      live:{status:'pending',runner:'scripts/run-browser-live.mjs',receipt:'docs/BROWSER-LIVE-VERIFICATION.json'},
      semantics:t.result,limitations:t.name==='browser_click'||t.name==='browser_type'?'Default dom is synthetic; optional uipath uses separate best-effort native identity checks.':'Only the enums/options in the strict input schema are implemented.'};
  });
  const routes=new Map();for(const t of tools)for(const route of t.routes){if(!routes.has(route))routes.set(route,[]);routes.get(route).push(t.name);}
  routes.set('GetEmbeddedDriverVersions',['uipath_driver_versions']);
  const callbacks=new Set(['LoadScripts','IsTraceEnabled','GetDetailedDriverVersion','RegisterNewlyCreatedWindowId','UnregisterWindowId']);
  const rows=matrix.rows.map(r=>{
    let consumers=routes.get(r.name)??[],disposition,reason;
    if(r.kind==='named'||r.kind==='loader'){
      if(consumers.length){disposition='wired';reason=r.name==='GenericRequest'?'Only messageId 6 non-debugger single-left-click. Generic 5 remains private historical G0 only.':riskReasons[r.name]??'Exact public adapter and shared lifecycle/identity route listed in consumers.';}
      else if(domBypass.has(r.name)){disposition='dom-composite';consumers=r.mcpTools.filter(t=>BROWSER_TOOLS.some(x=>x.name===t));reason='This vendor function is not dispatched. Public semantics use typed isolated InjectAndRunJs DOM operations; no parity with native/SAP/extraction schema is claimed.';}
      else{disposition='not-wired';reason=r.unsupportedReason??riskReasons[r.name]??'No public route in the strict supported subset needs this vendor endpoint; no raw dispatcher is exposed.';}
    }else if(r.kind==='host-callback'){disposition=callbacks.has(r.name)?'fixed-host-handler':'not-wired';reason=callbacks.has(r.name)?'Fixed pinned host callback, not a callable public tool.':'No host callback handler in this runtime.';consumers=[];}
    else if(r.kind==='generic'){const used=r.name.includes('6')&&r.key.includes('special');disposition=used?'wired':'not-wired';consumers=used?['browser_click']:[];reason=used?'Only GenericRequest special messageId 6 non-debugger click.':'No public arbitrary generic route. Mapped/special IDs are not interchangeable; historical private G0 is separate.';}
    else{const id=Number(r.name);const direct={1:'CheckHtmlElem',2:'GenericRequest',8:'FindSelectors',11:'GetHtmlAttribute',25:'HtmlSetSelectedItems',27:'InjectAndRunJs',29:'IsHtmlElemValid',34:'NavigationCommand',45:'WriteTextHtmlElem'}[id];consumers=direct?(routes.get(direct)??[]):[];disposition=consumers.length?'indirect-vendor-content':'not-wired';reason=consumers.length?`Vendor background route ${direct} forwards internally; not called as raw content ID.`:'No public raw content dispatcher. DOM composites do not imply this native content command was invoked.';}
    return {key:r.key,kind:r.kind,name:r.name,disposition,consumers:[...new Set(consumers)],reason,taskIds:r.taskIds,phaseNumbers:r.phaseNumbers};
  });
  const files=['docs/browser-tool-contracts.json','src/browser-runtime.mjs','src/browser-operations.mjs','src/browser-observers.mjs','src/browser-composites.mjs','src/browser-page.mjs','src/browser-artifacts.mjs','src/browser-tools.mjs','src/bridge.mjs','src/capabilities.mjs','src/transport.mjs','scripts/build-runtime-coverage.mjs'];
  const sourceHashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));
  return {schemaVersion:1,driverVersion:matrix.pinnedDriver,extensionVersion:matrix.extensionVersion,counts:{publicMcpTools:47,roadmapTools:53,implementedBrowserTools:BROWSER_TOOLS.length+1,unsupportedTools:Object.keys(UNAVAILABLE_TOOLS).length,protocolRows:rows.length},
    capabilityTool:{name:'browser_capabilities',status:'implemented-source',adapter:'src/capabilities.mjs',phase:'F0.2'},sourceHashes,tools,rows,
    limitations:['Every catalog row has a disposition, not every endpoint is dispatched.','The 423 original acceptance scenarios remain planned until individually evidenced.','Test source, live smoke, deployed host and general site/framework support are separate evidence levels.']};
}
export function renderRuntimeCoverage(c){const esc=v=>String(v??'—').replaceAll('|','\\|').replaceAll('\n',' ');const lines=['# Runtime: function → adapter → MCP → phase','',`Extension ${c.extensionVersion}; driver ${c.driverVersion}. ${c.counts.implementedBrowserTools} browser tools gồm capabilities; 4 legacy; ${c.counts.unsupportedTools} tool cần backend còn thiếu. Đây là coverage source, chưa phải chứng nhận live cho mọi option.`,'','[Schema input/output chính xác](browser-tool-contracts.json) · [JSON từng protocol row](runtime-function-coverage.json) · [Plan](DEVELOPMENT-PHASES.vi.md)','','| Tool | Phase | Adapter | Route | Trạng thái / giới hạn |','|---|---|---|---|---|'];
  for(const t of c.tools)lines.push(`| ${t.name} | ${t.phase} | ${t.adapter??'—'} | ${esc(t.routes.join(', '))} | ${esc(t.unsupportedReason??t.limitations)} |`);
  lines.push('','## Disposition cho toàn bộ protocol','','`wired` là gọi native endpoint; `dom-composite` là chức năng tương ứng được viết bằng typed isolated JS, không gọi endpoint vendor đó. `not-wired` có lý do riêng. Content IDs là chi tiết forwarding bên trong vendor, không public.','','| Function/route | Disposition | MCP consumers thực tế | Task | Lý do |','|---|---|---|---|---|');
  for(const r of c.rows)lines.push(`| ${esc(r.key)} | ${r.disposition} | ${esc(r.consumers.join(', '))} | ${r.taskIds.join(', ')} | ${esc(r.reason)} |`);return lines.join('\n')+'\n';}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const c=await buildRuntimeCoverage();await writeFile(path.join(root,'docs/runtime-function-coverage.json'),JSON.stringify(c,null,2)+'\n');await writeFile(path.join(root,'docs/RUNTIME-FUNCTION-COVERAGE.vi.md'),renderRuntimeCoverage(c));console.log(JSON.stringify(c.counts));}
