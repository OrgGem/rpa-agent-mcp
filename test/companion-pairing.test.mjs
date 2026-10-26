import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionPairingRegistry,PINNED_UIPATH_EXTENSION_ID} from '../src/companion-pairing.mjs';

const pageOrigin='https://shop.example.test';
function transportFixture(){
  let events,detached=false;
  return {
    subscribePairingEvents(callbacks){events=callbacks;return()=>{detached=true;events=null;};},
    epoch(value,profileSessionRef='profile-session-abc'){return events?.onEpoch({profileSessionRef,companionEpoch:value})??false;},
    disconnect(value,profileSessionRef='profile-session-abc'){return events?.onDisconnect({profileSessionRef,companionEpoch:value})??false;},
    attest(value){return events?.onAttestation(value)??false;},
    get detached(){return detached;}
  };
}
function setup({time=1000,maxPending=64,maxBindings=128,randomBytes}={}){
  let now=time,sequence=0;
  const registry=createCompanionPairingRegistry({now:()=>now,maxPending,maxBindings,
    randomBytes:randomBytes??(size=>Buffer.alloc(size,++sequence))});
  const transport=transportFixture();registry.attachTransport(transport);transport.epoch(7);
  const target={ownerRef:'owner-a',contextRef:'context-a',tabRef:'tab-a',nativeTabId:42,windowId:3,documentToken:'doc-token-a',generation:4,hostEpoch:9,permittedOrigin:pageOrigin};
  return {registry,transport,target,get now(){return now;},set now(value){now=value;}};
}
function attestation(challenge,target,overrides={}){
  return {
    nonce:challenge.nonce,ownerRef:target.ownerRef,contextRef:target.contextRef,tabRef:target.tabRef,
    documentToken:target.documentToken,generation:target.generation,hostEpoch:target.hostEpoch,companionEpoch:7,
    profileSessionRef:'profile-session-abc',sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:pageOrigin,
      tabId:target.nativeTabId,windowId:target.windowId,frameId:0,documentId:'chrome-document-abc'},
    ...overrides
  };
}
function begin(registry,target){return registry.begin(target);}
const code=expected=>error=>error?.code===expected;

test('pairing completes only from the injected transport with exact browser identity',()=>{
  const {registry,transport,target}=setup(),challenge=begin(registry,target);
  assert.equal(challenge.nonce.length,43);
  assert.equal(Buffer.from(challenge.nonce,'base64url').length,32);
  assert.equal(transport.attest(attestation(challenge,target)),true);
  const binding=registry.getBinding({ownerRef:target.ownerRef,contextRef:target.contextRef,tabRef:target.tabRef});
  assert.equal(binding.documentToken,target.documentToken);assert.equal(binding.generation,target.generation);
  assert.equal(binding.hostEpoch,target.hostEpoch);assert.equal(binding.companionEpoch,7);
  assert.equal(binding.profileSessionRef,'profile-session-abc');assert.ok(binding.pairRef.startsWith('pair_'));
  assert.equal(Object.hasOwn(binding,'nonce'),false);assert.equal(Object.hasOwn(binding,'nativeTabId'),false);
  assert.equal(Object.hasOwn(binding,'windowId'),false);assert.equal(Object.hasOwn(binding,'documentId'),false);
  assert.equal(registry.complete,undefined);
  assert.equal(transport.attest(attestation(challenge,target)),false,'a consumed nonce cannot replay');
  assert.deepEqual(registry.size,{pending:0,bindings:1});
});

test('unknown origin, wrong sender, child frames, target IDs, and empty sender evidence fail closed',()=>{
  const cases=[
    ['unknown opaque origin',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:'null',tabId:42,windowId:3,frameId:0,documentId:'chrome-document-abc'}}],
    ['origin outside permitted page',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:'https://other.example.test',tabId:42,windowId:3,frameId:0,documentId:'chrome-document-abc'}}],
    ['extension origin is not page origin',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:`chrome-extension://${PINNED_UIPATH_EXTENSION_ID}`,tabId:42,windowId:3,frameId:0,documentId:'chrome-document-abc'}}],
    ['sender id',{sender:{id:'wrong-extension',origin:pageOrigin,tabId:42,windowId:3,frameId:0,documentId:'chrome-document-abc'}}],
    ['child frame',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:pageOrigin,tabId:42,windowId:3,frameId:1,documentId:'chrome-document-abc'}}],
    ['tab ID',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:pageOrigin,tabId:43,windowId:3,frameId:0,documentId:'chrome-document-abc'}}],
    ['window ID',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:pageOrigin,tabId:42,windowId:4,frameId:0,documentId:'chrome-document-abc'}}],
    ['Chrome document ID',{sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:pageOrigin,tabId:42,windowId:3,frameId:0,documentId:''}}],
    ['profile session',{profileSessionRef:''}]
  ];
  for(const [label,overrides] of cases){
    const {registry,transport,target}=setup(),challenge=begin(registry,target);
    assert.equal(transport.attest(attestation(challenge,target,overrides)),false,label);
    assert.equal(registry.getBinding({ownerRef:target.ownerRef,contextRef:target.contextRef,tabRef:target.tabRef}),null,label);
  }
});

test('owner, document, generation, and host or companion epoch mismatches do not bind',()=>{
  const cases=[
    ['ownerRef',{ownerRef:'owner-other'}],['contextRef',{contextRef:'context-other'}],['tabRef',{tabRef:'tab-other'}],
    ['documentToken',{documentToken:'doc-other'}],['generation',{generation:5}],['hostEpoch',{hostEpoch:10}],['companionEpoch',{companionEpoch:8}]
  ];
  for(const [label,overrides] of cases){
    const {registry,transport,target}=setup(),challenge=begin(registry,target);
    assert.equal(transport.attest(attestation(challenge,target,overrides)),false,label);
    assert.deepEqual(registry.size,{pending:1,bindings:0},label);
    assert.equal(transport.attest(attestation(challenge,target)),true,`the same pending request can complete after a mismatched event: ${label}`);
  }
});

test('pending challenges expire at 30 seconds and cannot be replayed',()=>{
  const state=setup(),challenge=begin(state.registry,state.target);
  state.now+=30_000;
  assert.equal(state.transport.attest(attestation(challenge,state.target)),false);
  assert.deepEqual(state.registry.size,{pending:0,bindings:0});
});

test('duplicate active refs or Chrome targets and configured capacity are rejected',()=>{
  const state=setup({maxPending:1}),challenge=begin(state.registry,state.target);
  assert.throws(()=>begin(state.registry,state.target),code('PAIRING_DUPLICATE'));
  assert.throws(()=>begin(state.registry,{...state.target,ownerRef:'owner-b',contextRef:'context-b',tabRef:'tab-b'}),code('PAIRING_DUPLICATE'));
  assert.throws(()=>begin(state.registry,{...state.target,nativeTabId:43,tabRef:'tab-b'}),code('LIMIT_EXCEEDED'));
  assert.equal(state.transport.attest(attestation(challenge,state.target)),true);
  begin(state.registry,{...state.target,nativeTabId:43,tabRef:'tab-b'});
  assert.deepEqual(state.registry.size,{pending:1,bindings:1});

  const full=setup({maxBindings:1}),first=begin(full.registry,full.target);
  assert.equal(full.transport.attest(attestation(first,full.target)),true);
  const secondTarget={...full.target,tabRef:'tab-b',nativeTabId:43};
  const second=begin(full.registry,secondTarget);
  assert.equal(full.transport.attest(attestation(second,secondTarget)),false);
  assert.deepEqual(full.registry.size,{pending:0,bindings:1});
});

test('host and companion epoch changes invalidate previous records',()=>{
  const state=setup(),challenge=begin(state.registry,state.target);
  assert.equal(state.transport.attest(attestation(challenge,state.target)),true);
  const next=begin(state.registry,{...state.target,tabRef:'tab-b',nativeTabId:43});
  assert.deepEqual(state.registry.size,{pending:1,bindings:1});
  state.transport.epoch(8);
  assert.deepEqual(state.registry.size,{pending:0,bindings:0});
  assert.equal(state.transport.attest(attestation(next,{...state.target,tabRef:'tab-b',nativeTabId:43},{companionEpoch:7})),false);
  assert.equal(state.transport.attest(attestation(next,{...state.target,tabRef:'tab-b',nativeTabId:43},{companionEpoch:8})),false);
  const afterReconnectTarget={...state.target,tabRef:'tab-b',nativeTabId:43};
  const afterReconnect=begin(state.registry,afterReconnectTarget);
  assert.equal(state.transport.attest(attestation(afterReconnect,afterReconnectTarget,{companionEpoch:8})),true);

  const host=setup(),pending=begin(host.registry,host.target);
  assert.equal(host.registry.invalidateHostEpoch(host.target.ownerRef,host.target.hostEpoch),1);
  assert.equal(host.transport.attest(attestation(pending,host.target)),false);
  const reconnect=begin(host.registry,host.target);
  assert.equal(host.transport.disconnect(7),true);
  assert.deepEqual(host.registry.size,{pending:0,bindings:0});
  assert.equal(host.transport.attest(attestation(reconnect,host.target)),false);
});

test('profile sessions keep independent companion epochs while one broker shares the registry',()=>{
  const state=setup();assert.equal(state.transport.epoch(3,'profile-session-b'),true);
  const targetB={...state.target,ownerRef:'owner-b',contextRef:'context-b',tabRef:'tab-b',nativeTabId:42,windowId:3,documentToken:'doc-token-b'};
  const challenge=begin(state.registry,targetB);
  assert.equal(state.transport.attest(attestation(challenge,targetB,{profileSessionRef:'profile-session-b',companionEpoch:3})),true);
  const targetA={...state.target,ownerRef:'owner-a2',contextRef:'context-a2',tabRef:'tab-a2',nativeTabId:42,windowId:3};
  const challengeA=begin(state.registry,targetA);
  assert.equal(state.transport.attest(attestation(challengeA,targetA)),true);
  assert.equal(state.transport.disconnect(3,'profile-session-b'),true);
  assert.equal(state.registry.getBinding({ownerRef:targetB.ownerRef,contextRef:targetB.contextRef,tabRef:targetB.tabRef}),null);
  assert.ok(state.registry.getBinding({ownerRef:targetA.ownerRef,contextRef:targetA.contextRef,tabRef:targetA.tabRef}));
});

test('context, tab, and companion invalidation clear only their selected bindings',()=>{
  const context=setup(),c=begin(context.registry,context.target);
  assert.equal(context.transport.attest(attestation(c,context.target)),true);
  const other={...context.target,contextRef:'context-b',tabRef:'tab-b',nativeTabId:43};
  const d=begin(context.registry,other);
  assert.equal(context.registry.invalidateTab(context.target.ownerRef,context.target.contextRef,context.target.tabRef),1);
  assert.equal(context.registry.getBinding({ownerRef:context.target.ownerRef,contextRef:context.target.contextRef,tabRef:context.target.tabRef}),null);
  assert.equal(context.registry.getBinding({ownerRef:other.ownerRef,contextRef:other.contextRef,tabRef:other.tabRef}),null);
  assert.equal(context.transport.attest(attestation(d,other)),true);
  assert.equal(context.registry.invalidateContext(other.ownerRef,other.contextRef),1);
  assert.equal(context.registry.getBinding({ownerRef:other.ownerRef,contextRef:other.contextRef,tabRef:other.tabRef}),null);

  const epoch=setup(),pending=begin(epoch.registry,epoch.target);
  assert.equal(epoch.registry.invalidateCompanionEpoch(7),1);
  assert.equal(epoch.transport.attest(attestation(pending,epoch.target)),false);
  assert.throws(()=>begin(epoch.registry,epoch.target),code('BACKEND_UNAVAILABLE'));
});

test('dispose detaches transport, clears bindings, and blocks later use',()=>{
  const state=setup(),challenge=begin(state.registry,state.target);
  assert.equal(state.transport.attest(attestation(challenge,state.target)),true);
  state.registry.dispose();state.registry.dispose();
  assert.equal(state.transport.detached,true);assert.deepEqual(state.registry.size,{pending:0,bindings:0});
  assert.throws(()=>begin(state.registry,state.target),code('REGISTRY_DISPOSED'));
  assert.equal(state.transport.attest(attestation(challenge,state.target)),false);
});

test('nonce generation requires unique 32-byte random values',()=>{
  const state=setup({randomBytes:size=>Buffer.alloc(size,1)}),first=begin(state.registry,state.target);
  assert.equal(first.nonce.length,43);
  state.registry.invalidateTab(state.target.ownerRef,state.target.contextRef,state.target.tabRef);
  assert.throws(()=>begin(state.registry,{...state.target,tabRef:'tab-b',nativeTabId:43}),code('BACKEND_FAILURE'));
  const malformed=createCompanionPairingRegistry({randomBytes:()=>Buffer.alloc(8)}),transport=transportFixture();
  malformed.attachTransport(transport);transport.epoch(1);
  assert.throws(()=>begin(malformed,{...state.target,hostEpoch:0}),code('BACKEND_FAILURE'));
});
