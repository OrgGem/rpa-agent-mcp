import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import net from 'node:net';
import {COMPANION_EXTENSION_ID} from '../src/companion-protocol.mjs';
import {computeCompanionEndpoint} from '../src/companion-endpoint.mjs';

if(process.platform!=='win32')throw new Error('Companion launcher integration check requires Windows');
const output=resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Expected the companion build output path');
const launcher=join(output,'companion-host.cmd'),launcherText=await readFile(launcher,'utf8');
if(!/^@echo off\r?\nchcp 65001>nul\r?\n/.test(launcherText))throw new Error('generated launcher must switch to UTF-8 before processing Unicode paths');
const instance=`companion-launcher-selftest-${process.pid}-${randomBytes(8).toString('hex')}`;
const endpoint=computeCompanionEndpoint({instance}),server=net.createServer();
const nativeEncode=value=>{const body=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
const readFrame=(stream,timeoutMs=5000)=>new Promise((resolveFrame,reject)=>{
  let buffer=Buffer.alloc(0);const timer=setTimeout(()=>reject(new Error('native host launcher self-test timed out')),timeoutMs);
  const onData=chunk=>{buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;if(buffer.length<4)return;const size=buffer.readUInt32LE(0);if(size>256*1024){cleanup();reject(new Error('native host launcher emitted an oversized frame'));return;}if(buffer.length<size+4)return;
    cleanup();try{resolveFrame(JSON.parse(buffer.subarray(4,size+4).toString('utf8')));}catch{reject(new Error('native host launcher emitted invalid JSON'));}};
  const cleanup=()=>{clearTimeout(timer);stream.removeListener('data',onData);};stream.on('data',onData);
});
let acceptedSocket,child;
try{
  await new Promise((resolveListen,rejectListen)=>{server.once('error',rejectListen);server.listen(endpoint,()=>{server.removeListener('error',rejectListen);resolveListen();});});
  const accepted=new Promise(resolveAccepted=>server.once('connection',socket=>{acceptedSocket=socket;resolveAccepted(socket);}));
  const origin=`chrome-extension://${COMPANION_EXTENSION_ID}/`,command=`""${launcher}" "${origin}" --parent-window=0"`;
  child=spawn(process.env.ComSpec??'cmd.exe',['/d','/s','/c',command],{windowsVerbatimArguments:true,stdio:['pipe','pipe','pipe'],env:{...process.env,UIPATH_BRIDGE_INSTANCE:instance}});
  let childStderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{childStderr=(childStderr+chunk).slice(-2048);});
  const earlyExit=new Promise((_,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{if(!acceptedSocket)reject(new Error(`generated launcher exited before connecting (${code??signal}): ${childStderr}`));});});
  let connectionTimer;const connectionTimeout=new Promise((_,reject)=>{connectionTimer=setTimeout(()=>reject(new Error(`generated .cmd launcher did not connect to its isolated broker: ${childStderr}`)),5000);});
  const socket=await Promise.race([accepted,earlyExit,connectionTimeout]);clearTimeout(connectionTimer);
  const brokerInput=readFrame(socket);child.stdin.write(nativeEncode({type:'launcher-self-test',origin}));
  const forwarded=await brokerInput;
  if(forwarded.type!=='launcher-self-test'||forwarded.origin!==origin)throw new Error('generated launcher did not forward the native frame');
  const nativeOutput=readFrame(child.stdout);socket.write(nativeEncode({type:'launcher-self-test-reply',parentWindow:'0'}));
  const response=await nativeOutput;
  if(response.type!=='launcher-self-test-reply'||response.parentWindow!=='0')throw new Error('generated launcher did not preserve the Windows parent-window argument path');
  child.stdin.end();await new Promise(resolveExit=>{const timer=setTimeout(()=>{child.kill();resolveExit();},3000);child.once('exit',()=>{clearTimeout(timer);resolveExit();});});
  console.log(JSON.stringify({valid:true,launcher,originArgument:true,parentWindowArgument:true,endpointIsolated:true,registered:false}));
} finally {
  acceptedSocket?.destroy();child?.stdin?.destroy();
  if(child&&!child.killed)child.kill();
  if(server.listening)await new Promise(resolveClose=>server.close(resolveClose));
}
