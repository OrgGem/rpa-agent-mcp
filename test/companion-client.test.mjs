import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {COMPANION_EXTENSION_ID,createCompanionClient,computeCompanionEndpoint} from '../src/companion-client.mjs';
import {COMPANION_PROTOCOL} from '../src/companion-protocol.mjs';
import {PINNED_UIPATH_EXTENSION_ID} from '../src/companion-pairing.mjs';

const encode=message=>{const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
function decoder(socket,onMessage){let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(buffer.length<size+4)return;const body=buffer.subarray(4,size+4);buffer=buffer.subarray(size+4);onMessage(JSON.parse(body.toString('utf8')));}});}
const eventually=async check=>{const started=Date.now();while(Date.now()-started<2000){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('condition did not become true');};

test('companion endpoint separates canonical root, OS user, and explicit instance',()=>{
  const root=process.cwd(),base={root,platform:'win32'};
  const a=computeCompanionEndpoint({...base,username:'user-a',instance:'blue'}),b=computeCompanionEndpoint({...base,username:'user-b',instance:'blue'}),c=computeCompanionEndpoint({...base,username:'user-a',instance:'green'});
  assert.notEqual(a,b);assert.notEqual(a,c);assert.match(a,/^\\\\\.\\pipe\\uipath-companion-v1-[a-f0-9]{24}$/);
});

test('local client binds validated extension pairing and keeps signal out of typed wire requests',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'companion-client-test-')),endpoint=computeCompanionEndpoint({root:process.cwd(),username:'test-user',instance:directory,platform:'win32'});
  const client=createCompanionClient({endpoint});let socket;
  t.after(async()=>{socket?.destroy();await client.dispose();await rm(directory,{recursive:true,force:true});});
  const status=await client.start();assert.equal(status.ready,true);assert.equal(status.available,false);
  socket=net.createConnection(endpoint);const received=[];decoder(socket,message=>received.push(message));
  const profileSessionRef='profile-session-test',companionEpoch=7;
  socket.write(encode({type:'hello',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,extensionId:COMPANION_EXTENSION_ID,
    extensionVersion:'1.0.0',browserVersion:'Chrome test',capabilities:{keys:true,dialogs:true,filePicker:true,downloads:true,axQuery:true,axAudit:true,axeCoreVersion:'4.14.0'}}));
  const epoch=await eventually(()=>received.find(x=>x.type==='epoch'));
  assert.equal(epoch.connectionEpoch,1);assert.notEqual(epoch.connectionEpoch,companionEpoch);
  const ready=client.readiness();assert.equal(ready.browser_capabilities[0].axeCoreVersion,'4.14.0');
  const target={ownerRef:'owner-test',contextRef:'context-test',tabRef:'tab-test',nativeTabId:41,windowId:6,documentToken:'document-token-test',generation:2,hostEpoch:19,permittedOrigin:'https://shop.example.test'};
  const challenge=await client.beginPairing(target);assert.equal(challenge.nonce.length,43);
  const rawAttestation={nonce:challenge.nonce,documentToken:'different-document-token',sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:'https://shop.example.test',tabId:41,windowId:6,frameId:0,documentId:'chrome-doc-test'}};
  socket.write(encode({type:'pair.attestation',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,attestation:rawAttestation}));
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(client.getBinding(target),null,'attestation must echo the challenge document token');
  socket.write(encode({type:'pair.attestation',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,
    attestation:{nonce:challenge.nonce,documentToken:target.documentToken,sender:{id:PINNED_UIPATH_EXTENSION_ID,origin:'https://shop.example.test',tabId:41,windowId:6,frameId:0,documentId:'chrome-doc-test'}}}));
  const binding=await client.waitForPairing(target,{deadline:Date.now()+2000});
  assert.deepEqual(client.getBinding(target),binding);
  assert.ok(binding.pairRef.startsWith('pair_'));assert.equal(binding.profileSessionRef,profileSessionRef);assert.equal(binding.companionEpoch,companionEpoch);assert.equal(binding.connectionEpoch,epoch.connectionEpoch);
  assert.equal(Object.hasOwn(binding,'nativeTabId'),false);assert.equal(Object.hasOwn(binding,'documentId'),false);

  const envelope={protocol:1,requestId:'request-client-test',connectionEpoch:binding.connectionEpoch,profileSessionRef,pairRef:binding.pairRef,
    operation:'debugger.acquire',leaseRef:null,tabRef:target.tabRef,deadline:Date.now()+5000,
    payload:{ownerRef:target.ownerRef,contextRef:target.contextRef,documentToken:target.documentToken,generation:target.generation,ttlMs:5000}};
  const controller=new AbortController(),pending=client.request(envelope,{signal:controller.signal});
  const sent=await eventually(()=>received.find(x=>x.type==='request'));
  assert.equal(sent.profileSessionRef,profileSessionRef);assert.deepEqual(Object.keys(sent.request).sort(),Object.keys(envelope).sort());assert.equal(Object.hasOwn(sent.request,'signal'),false);
  const leaseExpiry=new Date(Date.now()+4000).toISOString();
  socket.write(encode({type:'reply',profileSessionRef,companionEpoch,reply:{protocol:1,requestId:envelope.requestId,connectionEpoch:binding.connectionEpoch,ok:true,data:{leaseRef:'lease-test',expiresAt:leaseExpiry}}}));
  assert.deepEqual(await pending,{leaseRef:'lease-test',expiresAt:leaseExpiry});

  const abortController=new AbortController(),uncertain={...envelope,requestId:'request-abort-test',operation:'keys.dispatch',leaseRef:'lease-test',deadline:Date.now()+5000,
    payload:{ownerRef:target.ownerRef,keys:[{key:'ENTER'}]}};
  const abortRequest=client.request(uncertain,{signal:abortController.signal}),sentAbort=await eventually(()=>received.find(x=>x.type==='request'&&x.request.requestId===uncertain.requestId));
  assert.equal(sentAbort.request.payload.keys[0].key,'ENTER');assert.equal(Object.hasOwn(sentAbort.request,'signal'),false);abortController.abort();
  await assert.rejects(abortRequest,error=>error.code==='UNKNOWN_OUTCOME'&&error.dispatchState==='unknown');
  socket.write(encode({type:'reply',profileSessionRef,companionEpoch,reply:{protocol:1,requestId:uncertain.requestId,connectionEpoch:binding.connectionEpoch,ok:true,data:{late:true}}}));
  await assert.rejects(client.request(uncertain),error=>error.code==='UNKNOWN_OUTCOME'&&error.dispatchState==='unknown');
  assert.equal(received.filter(x=>x.type==='request'&&x.request.requestId===uncertain.requestId).length,1,'a late reply cannot make an uncertain request replayable');

  const timeoutEnvelope={...uncertain,requestId:'request-timeout-test',deadline:Date.now()+100,payload:{ownerRef:target.ownerRef,keys:[{key:'TAB'}]}};
  const timeoutRequest=client.request(timeoutEnvelope),sentTimeout=await eventually(()=>received.find(x=>x.type==='request'&&x.request.requestId===timeoutEnvelope.requestId));
  assert.equal(sentTimeout.request.payload.keys[0].key,'TAB');
  await assert.rejects(timeoutRequest,error=>error.code==='UNKNOWN_OUTCOME'&&error.dispatchState==='unknown');

  const expiredEnvelope={...uncertain,requestId:'request-expired-before-write',deadline:Date.now(),payload:{ownerRef:target.ownerRef,keys:[{key:'ESCAPE'}]}};
  const beforeExpired=received.filter(x=>x.type==='request').length;
  await assert.rejects(client.request(expiredEnvelope),error=>error.code==='TIMEOUT'&&error.dispatchState==='notSent');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(received.filter(x=>x.type==='request').length,beforeExpired,'an expired request is rejected before socket write');

  const cleanup=client.cleanupContext({ownerRef:target.ownerRef,contextRef:target.contextRef,deadline:Date.now()+5000});
  const release=await eventually(()=>received.find(x=>x.type==='request'&&x.request.operation==='debugger.release'));
  assert.equal(release.request.payload.reason,'release');
  socket.write(encode({type:'reply',profileSessionRef,companionEpoch,reply:{protocol:1,requestId:release.request.requestId,connectionEpoch:binding.connectionEpoch,ok:true,data:{released:true,cleanupState:'released'}}}));
  assert.deepEqual(await cleanup,{cleanupConfirmed:true,blockedTabRefs:[],cleanedPickerRefs:[]});
  assert.equal(client.getBinding(target),null);
});

test('companion request rejects unknown after socket disconnect and ignores late replies',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'companion-client-disconnect-')),endpoint=computeCompanionEndpoint({root:process.cwd(),username:'disconnect-user',instance:directory,platform:'win32'});
  const client=createCompanionClient({endpoint});let socket;
  t.after(async()=>{socket?.destroy();await client.dispose();await rm(directory,{recursive:true,force:true});});
  await client.start();socket=net.createConnection(endpoint);const received=[];decoder(socket,message=>received.push(message));
  const profileSessionRef='profile-disconnect-test',companionEpoch=3;
  socket.write(encode({type:'hello',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,extensionId:COMPANION_EXTENSION_ID,
    extensionVersion:'1.0.0',browserVersion:'Chrome test',capabilities:{keys:true,dialogs:true,filePicker:true,downloads:true,axQuery:true,axAudit:true,axeCoreVersion:'4.14.0'}}));
  const epoch=await eventually(()=>received.find(x=>x.type==='epoch'));
  const envelope={protocol:1,requestId:'request-disconnect-test',connectionEpoch:epoch.connectionEpoch,profileSessionRef,pairRef:null,
    operation:'download.get',leaseRef:null,tabRef:null,deadline:Date.now()+5000,payload:{ownerRef:'owner-disconnect',downloadRef:'download-disconnect'}};
  const pending=client.request(envelope);await eventually(()=>received.find(x=>x.type==='request'&&x.request.requestId===envelope.requestId));
  socket.destroy();await assert.rejects(pending,error=>error.code==='UNKNOWN_OUTCOME'&&error.dispatchState==='unknown');
  assert.equal(client.state.pendingRequests,0);
});
