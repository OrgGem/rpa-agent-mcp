import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import net from 'node:net';
import {COMPANION_EXTENSION_ID,computeCompanionEndpoint} from '../src/companion-client.mjs';
import {parseNativeHostArguments,startNativeHostForwarder} from '../src/companion-host.mjs';

const origin=`chrome-extension://${COMPANION_EXTENSION_ID}/`;
const encode=value=>{const body=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
function frameReader(stream,onFrame){let buffer=Buffer.alloc(0);stream.on('data',chunk=>{buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(buffer.length<size+4)return;const payload=buffer.subarray(4,size+4);buffer=buffer.subarray(size+4);onFrame(JSON.parse(payload.toString('utf8')));}});}

test('native host pins UiPath origin and tolerates the Windows parent-window argument',()=>{
  assert.deepEqual(parseNativeHostArguments([origin,'--parent-window=12345']),{origin,parentWindow:'12345'});
  assert.deepEqual(parseNativeHostArguments([origin]),{origin,parentWindow:null});
  assert.throws(()=>parseNativeHostArguments(['chrome-extension://other/']));
  assert.throws(()=>parseNativeHostArguments([origin,'--parent-window=bad']));
  assert.throws(()=>parseNativeHostArguments([origin,'--parent-window=1','extra']));
});

test('native host forwards bounded native frames to the canonical local endpoint',async t=>{
  const endpoint=computeCompanionEndpoint({root:process.cwd(),username:'host-test',instance:`${process.pid}-${Date.now()}`,platform:'win32'});
  const server=net.createServer(),stdin=new PassThrough(),stdout=new PassThrough(),out=[];let accepted;
  const acceptedPromise=new Promise(resolve=>{server.once('connection',socket=>{accepted=socket;resolve(socket);});});
  await new Promise((resolve,reject)=>server.listen(endpoint,error=>error?reject(error):resolve()));
  const forwarder=startNativeHostForwarder({stdin,stdout,endpoint,origin});
  const socket=await acceptedPromise,local=[];frameReader(socket,message=>local.push(message));frameReader(stdout,message=>out.push(message));
  t.after(async()=>{forwarder.close();socket.destroy();await new Promise(resolve=>server.close(resolve));});
  stdin.write(encode({type:'hello',protocol:1,profileSessionRef:'profile-a'}));
  for(let i=0;i<100&&!local.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(local,[{type:'hello',protocol:1,profileSessionRef:'profile-a'}]);
  socket.write(encode({type:'epoch',protocol:1,connectionEpoch:5}));
  for(let i=0;i<100&&!out.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(out,[{type:'epoch',protocol:1,connectionEpoch:5}]);
});
