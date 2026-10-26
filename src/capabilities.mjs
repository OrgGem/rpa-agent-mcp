const nullableString = { type: ['string', 'null'] };
const strings = { type: 'array', items: { type: 'string' } };
const reason = { enum: [null, 'BRIDGE_DISCONNECTED', 'DRIVER_NOT_CONFIRMED', 'G0_NOT_VERIFIED'] };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const evidenceSchema = object({
  kind: { enum: ['offline-test', 'historical-live-fixture', 'historical-source-audit'] },
  source: { type: 'string' }, date: nullableString
});
const capabilitySchema = object({
  name: { type: 'string' }, tool: nullableString, implemented: { type: 'boolean' }, available: { type: 'boolean' },
  implementationStatus: { enum: ['implemented', 'planned'] },
  backend: { enum: ['bridge', 'extension+bridge', 'extension-adapter'] },
  driverVersion: nullableString, supportedOptions: strings, limits: strings,
  verificationLevel: { enum: ['adapter-tested', 'live-fixture-verified', 'source-audited'] },
  unsupportedReason: reason, evidence: { type: 'array', items: evidenceSchema }
});
const dataSchema = object({
  schemaVersion: { const: 1 },
  connection: object({ connected: { type: 'boolean' }, driverLoaded: { type: 'boolean' },
    driverVersion: nullableString, reason: { enum: [null, 'BRIDGE_DISCONNECTED', 'DRIVER_NOT_CONFIRMED'] } }),
  capabilities: { type: 'array', items: capabilitySchema },
  gates: object({ g0: object({ passed: { const: false }, verificationLevel: { const: 'source-audited' }, reason: { const: 'G0_NOT_VERIFIED' } }) })
});
const legacyOutputSchema = object({
  ok: { type: 'boolean' },
  data: { anyOf: [dataSchema, { type: 'null' }] },
  error: { anyOf: [object({ code: { const: 'INTERNAL_ERROR' }, message: { const: 'Capability discovery failed' } }), { type: 'null' }] }
});
const runtimeData=object({schemaVersion:{const:2},connection:dataSchema.properties.connection,
  connectionRef:nullableString,tools:{type:'array',maxItems:64,items:object({name:{type:'string'},implemented:{type:'boolean'},available:{type:'boolean'},unsupportedReason:nullableString,verificationLevel:{const:'source-implemented'},contract:{const:'docs/browser-tool-contracts.json'}})},
  historicalG0:object({receipt:{const:'docs/G0-4-LIVE-VERIFICATION.json'},scope:{const:'historical-private-fixture-not-public-tool-acceptance'}}),
  limits:{type:['object','null']}});
export const CAPABILITY_OUTPUT_SCHEMA={anyOf:[legacyOutputSchema,object({ok:{const:true},data:runtimeData,error:{type:'null'}})]};

const liveEvidence = () => [{ kind: 'historical-live-fixture', source: 'docs/EXTENSION-LIVE-VERIFICATION.json', date: '2026-10-26' }];
const sourceEvidence = () => [{ kind: 'historical-source-audit', source: 'docs/EXTENSION-CAPABILITY-VERIFICATION.vi.md', date: '2026-10-26' }];

// Pure snapshot: this module never reads receipt files or sends browser commands.
export function buildCapabilities(status, pinnedDriverVersion) {
  const valid = status !== null && typeof status === 'object' && !Array.isArray(status)
    && status.connected === true && typeof status.driverLoaded === 'boolean'
    && (status.driverVersion === null || (typeof status.driverVersion === 'string'
      && /^\d{1,8}(?:\.\d{1,8}){3}$/.test(status.driverVersion)));
  const connected = Boolean(valid);
  const driverLoaded = connected && status.driverLoaded;
  const driverVersion = connected ? status.driverVersion : null;
  const confirmed = driverLoaded && driverVersion === pinnedDriverVersion;
  const connection = { connected, driverLoaded, driverVersion,
    reason: !connected ? 'BRIDGE_DISCONNECTED' : confirmed ? null : 'DRIVER_NOT_CONFIRMED' };
  if(status?.browserRuntime?.protocolVersion===1){
    const runtime=status.browserRuntime;
    return {ok:true,data:{schemaVersion:2,connection,connectionRef:runtime.connectionRef??null,
      tools:[...BROWSER_TOOLS.map(t=>({name:t.name,implemented:true,available:Boolean(confirmed&&runtime.tools?.includes(t.name)),unsupportedReason:confirmed?null:connection.reason,verificationLevel:'source-implemented',contract:'docs/browser-tool-contracts.json'})),
        ...Object.entries(UNAVAILABLE_TOOLS).map(([name,unsupportedReason])=>({name,implemented:false,available:false,unsupportedReason,verificationLevel:'source-implemented',contract:'docs/browser-tool-contracts.json'}))],
      historicalG0:{receipt:'docs/G0-4-LIVE-VERIFICATION.json',scope:'historical-private-fixture-not-public-tool-acceptance'},limits:runtime.limits??null},error:null};
  }
  const implemented = (name, tool, available, backend, supportedOptions, limits, verificationLevel, evidence, version = driverVersion) => ({
    name, tool, implemented: true, available, implementationStatus: 'implemented', backend,
    driverVersion: version, supportedOptions, limits, verificationLevel,
    unsupportedReason: available ? null : connection.reason, evidence
  });
  const capabilities = [
    implemented('capabilities', 'browser_capabilities', true, 'bridge', [],
      ['Bounded capability summary; not the full proposed tool catalog.'], 'adapter-tested',
      [{ kind: 'offline-test', source: 'test/capabilities.test.mjs', date: null }], null),
    implemented('connection.status', 'uipath_bridge_status', true, 'bridge', [],
      ['Connection metadata only; available offline with connected:false.'], 'live-fixture-verified', liveEvidence(), null),
    implemented('driver.versions', 'uipath_driver_versions', connected, 'extension+bridge', [],
      ['Lists embedded driver versions; does not prove DOM automation.'], 'live-fixture-verified', liveEvidence()),
    implemented('tab.open', 'uipath_open_url', Boolean(confirmed), 'extension+bridge', ['http', 'https', 'new-tab'],
      ['New tab only; no embedded URL credentials; never automatically retry uncertain navigation.'], 'live-fixture-verified', liveEvidence()),
    implemented('tab.metadata', 'uipath_tab_info', Boolean(confirmed), 'extension+bridge', ['url', 'title', 'readystate'],
      ['Tab metadata only; no DOM fields.'], 'live-fixture-verified', liveEvidence()),
    ...['find', 'read', 'click', 'type'].map(action => ({
      name: `element.${action}`, tool: null, implemented: false, available: false,
      implementationStatus: 'planned', backend: 'extension-adapter', driverVersion,
      supportedOptions: [], limits: ['Blocked on live discovery/reference/input gate G0.'],
      verificationLevel: 'source-audited', unsupportedReason: 'G0_NOT_VERIFIED', evidence: sourceEvidence()
    }))
  ];
  return { ok: true, data: { schemaVersion: 1, connection, capabilities,
    gates: { g0: { passed: false, verificationLevel: 'source-audited', reason: 'G0_NOT_VERIFIED' } } }, error: null };
}
import {BROWSER_TOOLS,UNAVAILABLE_TOOLS} from './browser-tools.mjs';
