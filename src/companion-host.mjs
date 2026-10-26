import net from 'node:net';
import {COMPANION_EXTENSION_ID,MAX_COMPANION_REQUEST_BYTES} from './companion-protocol.mjs';
import {COMPANION_ENDPOINT} from './companion-endpoint.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const allowedOrigin=`chrome-extension://${COMPANION_EXTENSION_ID}/`;
const encode=value=>{const body=Buffer.from(JSON.stringify(value));if(body.length>MAX_COMPANION_REQUEST_BYTES)throw new Error('frame too large');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};

export function parseNativeHostArguments(args){
  if(!Array.isArray(args)||args.length<1||args.length>2||args[0]!==allowedOrigin||args.length===2&&!/^--parent-window=\d+$/.test(args[1]))
    throw new Error('Native host arguments are invalid');
  return {origin:args[0],parentWindow:args[1]?.slice('--parent-window='.length)??null};
}

export function startNativeHostForwarder({stdin=process.stdin,stdout=process.stdout,endpoint,origin,connect=net.createConnection}={}){
  if(origin!==allowedOrigin||typeof endpoint!=='string'||!endpoint)throw new Error('Native host origin or endpoint is invalid');
  let nativeInput=Buffer.alloc(0),localInput=Buffer.alloc(0),closed=false,connected=false,socketBlocked=false,stdoutBlocked=false;const queued=[];let queuedBytes=0;
  const socket=connect(endpoint);socket.pause?.();
  const stop=()=>{if(closed)return;closed=true;stdin.pause?.();socket.destroy();};
  const flushQueue=()=>{
    if(!connected||socketBlocked||closed)return;
    while(queued.length){const bytes=queued.shift();queuedBytes-=bytes.length;if(!socket.write(bytes)){socketBlocked=true;stdin.pause?.();return;}}
    stdin.resume?.();
  };
  const sendLocal=value=>{
    const bytes=encode(value);if(connected&&!socketBlocked&&!queued.length){if(!socket.write(bytes)){socketBlocked=true;stdin.pause?.();}return;}
    if(queuedBytes+bytes.length>MAX_COMPANION_REQUEST_BYTES){stop();return;}queued.push(bytes);queuedBytes+=bytes.length;
  };
  const sendNative=value=>{try{return stdout.write(encode(value));}catch{stop();return false;}};
  const parseInput=chunk=>{
    if(closed)return;nativeInput=nativeInput.length?Buffer.concat([nativeInput,chunk]):chunk;
    while(nativeInput.length>=4){const size=nativeInput.readUInt32LE(0);if(size<2||size>MAX_COMPANION_REQUEST_BYTES){stop();return;}if(nativeInput.length<size+4)return;
      const body=nativeInput.subarray(4,size+4);nativeInput=nativeInput.subarray(size+4);try{const message=JSON.parse(body.toString('utf8'));if(!message||typeof message!=='object'||Array.isArray(message))throw new Error('invalid native message');sendLocal(message);}catch{stop();return;}
    }
  };
  const parseLocal=()=>{
    if(closed||stdoutBlocked)return;
    while(localInput.length>=4){const size=localInput.readUInt32LE(0);if(size<2||size>MAX_COMPANION_REQUEST_BYTES){stop();return;}if(localInput.length<size+4)return;
      const body=localInput.subarray(4,size+4);localInput=localInput.subarray(size+4);let message;try{message=JSON.parse(body.toString('utf8'));}catch{stop();return;}
      if(!sendNative(message)){stdoutBlocked=true;socket.pause?.();stdout.once('drain',()=>{stdoutBlocked=false;parseLocal();socket.resume?.();});return;}
    }
  };
  socket.on('connect',()=>{if(closed)return;connected=true;flushQueue();socket.resume?.();});
  socket.on('drain',()=>{socketBlocked=false;flushQueue();});
  socket.on('data',chunk=>{if(closed)return;localInput=localInput.length?Buffer.concat([localInput,chunk]):chunk;parseLocal();});
  socket.on('error',stop);socket.on('close',stop);
  stdin.on('data',parseInput);stdin.on('end',stop);stdin.on('error',stop);stdin.resume?.();
  return {close:stop,get connected(){return connected&&!closed;}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const {origin}=parseNativeHostArguments(process.argv.slice(2));startNativeHostForwarder({endpoint:COMPANION_ENDPOINT,origin});}
  catch{process.exitCode=2;}
}
