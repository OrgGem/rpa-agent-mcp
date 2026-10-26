import path from 'node:path';
import {mkdir,readFile,writeFile,rename,unlink,lstat,realpath,copyFile,readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {BrowserError,opaque,reject} from './browser-tools.mjs';

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_ANALYSIS_PIXELS=16_000_000;
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{
  let c=n;
  for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
});
const crc32=bytes=>{
  let crc=0xffffffff;
  for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
};
const pngError=()=>reject('BACKEND_FAILURE','Invalid PNG image artifact');
function pngHeader(data){
  if(!Buffer.isBuffer(data)||data.length<33||!data.subarray(0,8).equals(PNG_SIGNATURE))pngError();
  if(data.readUInt32BE(8)!==13||data.toString('ascii',12,16)!=='IHDR')pngError();
  const expected=data.readUInt32BE(29),actual=crc32(data.subarray(12,29));
  if(expected!==actual)pngError();
  const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
  if(!width||!height||width>32768||height>32768)reject('RESULT_TOO_LARGE','Image dimensions exceed the limit');
  return {width,height};
}
function parsePng(data){
  const {width,height}=pngHeader(data);let offset=8,seenIdat=false,seenIend=false,first=true;
  while(offset<data.length){
    if(offset+12>data.length)pngError();
    const length=data.readUInt32BE(offset);
    if(length>data.length-offset-12)pngError();
    const type=data.toString('ascii',offset+4,offset+8);
    const chunkEnd=offset+12+length,crcExpected=data.readUInt32BE(offset+8+length);
    if(crc32(data.subarray(offset+4,offset+8+length))!==crcExpected)pngError();
    if(first){if(type!=='IHDR'||length!==13)pngError();first=false;}
    else if(type==='IHDR')pngError();
    if(type==='IDAT')seenIdat=true;
    if(type==='IEND'){
      if(length!==0||chunkEnd!==data.length||!seenIdat)pngError();
      seenIend=true;break;
    }
    offset=chunkEnd;
  }
  if(first||!seenIdat||!seenIend)pngError();
  return {width,height};
}
function positiveSafeInteger(value){return Number.isSafeInteger(value)&&value>0;}
function normalizeProvenance(value,mimeType){
  if(value===undefined||value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||mimeType!=='image/png'||
    value.sourceTool!=='browser_screenshot'||typeof value.tabRef!=='string'||!value.tabRef.trim()||value.tabRef.length>256||
    !Number.isSafeInteger(value.documentGeneration)||value.documentGeneration<0||
    !Number.isSafeInteger(value.viewportGeneration)||value.viewportGeneration<0||
    Object.keys(value).some(key=>!['sourceTool','tabRef','documentGeneration','viewportGeneration'].includes(key)))
    reject('INVALID_ARGUMENT','Invalid screenshot artifact provenance');
  return {sourceTool:value.sourceTool,tabRef:value.tabRef,documentGeneration:value.documentGeneration,viewportGeneration:value.viewportGeneration};
}
function verifyAnalysisOptions(options,maxFileBytes){
  if(!options||typeof options!=='object'||Array.isArray(options))reject('INVALID_ARGUMENT','Analysis limits are required');
  const maxBytes=options.maxBytes??maxFileBytes,maxPixels=options.maxPixels??MAX_ANALYSIS_PIXELS;
  if(!positiveSafeInteger(maxBytes)||maxBytes>maxFileBytes||!positiveSafeInteger(maxPixels)||maxPixels>MAX_ANALYSIS_PIXELS)
    reject('INVALID_ARGUMENT','Analysis limits exceed the configured hard bounds');
  return {maxBytes,maxPixels};
}
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino;}

export function createArtifactStore(root,{now=Date.now,maxFileBytes=6*1024*1024,maxClientBytes=64*1024*1024,maxTotalBytes=128*1024*1024,ttlMs=3600000}={}){
  const records=new Map();let rootReady;
  const ready=()=>rootReady??=(async()=>{
    await mkdir(root,{recursive:true});const stat=await lstat(root);if(stat.isSymbolicLink())reject('ARTIFACT_IO_ERROR','Artifact root must not be a link');
    return realpath(root);
  })();
  const safe=async file=>{
    const absolute=path.resolve(file),base=await ready();
    if(!absolute.startsWith(base+path.sep))reject('ARTIFACT_IO_ERROR','Artifact path escaped its root');
    return absolute;
  };
  const remove=async r=>{records.delete(r.artifactRef);for(const f of [r.path,...r.exports]){try{await unlink(await safe(f));}catch(e){if(e.code!=='ENOENT')throw e;}}};
  const diskUsage=async()=>{
    const base=await ready();let total=0;
    for(const name of await readdir(base)){
      if(!/^(img_[0-9a-f-]{36}\.(png|jpg)(\.partial)?|[0-9a-f]{16}-[A-Za-z0-9_-]{1,80}\.(png|jpg|jpeg))$/.test(name))continue;
      const file=await safe(path.join(base,name));let stat;try{stat=await lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(stat.isSymbolicLink())continue;
      if(stat.isFile()&&now()-stat.mtimeMs>ttlMs){await unlink(file);continue;}
      if(stat.isFile())total+=stat.size;
    }return total;
  };
  const expired=r=>now()>=r.createdAt+ttlMs;
  const sweep=async()=>{for(const r of [...records.values()])if(expired(r))await remove(r);};
  const metadata=r=>({artifactRef:r.artifactRef,mimeType:r.mimeType,bytes:r.bytes,sha256:r.sha256,path:r.path,expiresAt:new Date(r.createdAt+ttlMs).toISOString(),width:r.width,height:r.height});
  const owned=async(clientRef,contextRef,id)=>{
    await sweep();const r=records.get(id);if(!r||r.clientRef!==clientRef||r.contextRef!==contextRef)reject('STALE_ARTIFACT','Artifact is expired or belongs to another context');
    let stat;try{stat=await lstat(r.path);}catch{reject('ARTIFACT_IO_ERROR','Artifact file is unavailable');}
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==r.bytes)reject('ARTIFACT_IO_ERROR','Artifact file was replaced');return r;
  };
  const readArtifact=async(r,maxBytes,maxPixels)=>{
    let handle;
    try{
      const file=await safe(r.path),before=await lstat(file);
      if(before.isSymbolicLink()||!before.isFile()||before.size!==r.bytes)reject('ARTIFACT_IO_ERROR','Artifact file was replaced');
      if(before.size>maxBytes)reject('RESULT_TOO_LARGE','Image artifact exceeds the analysis byte limit');
      handle=await open(file,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW??0)));
      const stat=await handle.stat();
      if(!stat.isFile()||!sameFile(before,stat)||stat.size!==r.bytes)reject('ARTIFACT_IO_ERROR','Artifact file was replaced');
      if(stat.size>maxBytes)reject('RESULT_TOO_LARGE','Image artifact exceeds the analysis byte limit');
      const header=Buffer.alloc(Math.min(33,stat.size));let got=0;
      while(got<header.length){const result=await handle.read(header,got,header.length-got,got);if(!result.bytesRead)pngError();got+=result.bytesRead;}
      const dimensions=pngHeader(header);
      if(dimensions.width*dimensions.height>maxPixels)reject('RESULT_TOO_LARGE','Image dimensions exceed the analysis pixel limit');
      const data=Buffer.alloc(stat.size);got=0;
      while(got<data.length){const result=await handle.read(data,got,data.length-got,got);if(!result.bytesRead)reject('ARTIFACT_IO_ERROR','Artifact file changed while it was being read');got+=result.bytesRead;}
      const extra=Buffer.alloc(1),tail=await handle.read(extra,0,1,data.length);
      if(tail.bytesRead)reject('ARTIFACT_IO_ERROR','Artifact file changed while it was being read');
      const after=await lstat(file),openedAfter=await handle.stat();
      if(after.isSymbolicLink()||!after.isFile()||!sameFile(stat,after)||!sameFile(stat,openedAfter)||after.size!==r.bytes||openedAfter.size!==r.bytes)
        reject('ARTIFACT_IO_ERROR','Artifact file changed while it was being read');
      if(createHash('sha256').update(data).digest('hex')!==r.sha256)reject('ARTIFACT_IO_ERROR','Artifact content changed');
      const verified=parsePng(data);
      if(verified.width!==r.width||verified.height!==r.height)reject('ARTIFACT_IO_ERROR','Artifact dimensions changed');
      if(verified.width*verified.height>maxPixels)reject('RESULT_TOO_LARGE','Image dimensions exceed the analysis pixel limit');
      return data;
    }catch(error){
      if(error instanceof BrowserError)throw error;
      reject('ARTIFACT_IO_ERROR','Artifact file could not be read');
    }finally{if(handle)await handle.close().catch(()=>{});}
  };
  const readForAnalysis=async(client,context,id,options={})=>{
    const {maxBytes,maxPixels}=verifyAnalysisOptions(options,maxFileBytes),r=await owned(client,context,id);
    if(r.mimeType!=='image/png'||r.provenance&&r.provenance.sourceTool!=='browser_screenshot')reject('UNSUPPORTED_CAPABILITY','Analysis reads require an owned screenshot PNG');
    if(r.bytes>maxBytes)reject('RESULT_TOO_LARGE','Image artifact exceeds the analysis byte limit');
    if(expired(r)){await remove(r);reject('STALE_ARTIFACT','Artifact has expired');}
    const data=await readArtifact(r,maxBytes,maxPixels);
    if(expired(r)){await remove(r);reject('STALE_ARTIFACT','Artifact has expired');}
    return {record:r,data};
  };
  const api={
    async put(clientRef,contextRef,data,mimeType,provenanceArg){
      await sweep();if(!Buffer.isBuffer(data)||!data.length||data.length>maxFileBytes)reject('RESULT_TOO_LARGE','Image artifact size limit exceeded');
      const provenance=normalizeProvenance(provenanceArg,mimeType);
      const all=[...records.values()],client=all.filter(r=>r.clientRef===clientRef);
      if(client.length>=32||client.reduce((n,r)=>n+r.bytes*(1+r.exports.length),0)+data.length>maxClientBytes||await diskUsage()+data.length>maxTotalBytes)reject('LIMIT_EXCEEDED','Artifact quota exceeded');
      if(!['image/png','image/jpeg'].includes(mimeType))reject('INVALID_ARGUMENT','Unsupported image format');
      const base=await ready(),id=opaque('img'),file=path.join(base,id+(mimeType==='image/png'?'.png':'.jpg')),temporary=file+'.partial';
      let width=null,height=null;
      if(mimeType==='image/png'){
        if(data.length<24||!data.subarray(0,8).equals(PNG_SIGNATURE))reject('BACKEND_FAILURE','Invalid PNG image');
        width=data.readUInt32BE(16);height=data.readUInt32BE(20);
        if(width>32768||height>32768)reject('RESULT_TOO_LARGE','Image dimensions exceed the limit');
      }else if(data[0]!==0xff||data[1]!==0xd8)reject('BACKEND_FAILURE','Invalid JPEG image');
      try{await writeFile(temporary,data,{flag:'wx'});await rename(temporary,file);}
      catch{try{await unlink(temporary);}catch{}reject('ARTIFACT_IO_ERROR','Could not store the image artifact');}
      const r={artifactRef:id,clientRef,contextRef,path:file,exports:[],mimeType,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),createdAt:now(),width,height,provenance};
      records.set(id,r);return metadata(r);
    },
    async inspect(client,context,id){return metadata(await owned(client,context,id));},
    async image(client,context,id){
      const r=await owned(client,context,id);if(r.bytes>384*1024)reject('RESULT_TOO_LARGE','Inline image exceeds 384 KiB; save the owned artifact instead');
      const data=await readFile(await safe(r.path));if(createHash('sha256').update(data).digest('hex')!==r.sha256)reject('ARTIFACT_IO_ERROR','Artifact content changed');
      return {mimeType:r.mimeType,data:data.toString('base64')};
    },
    async analysisRead(client,context,id,options={}){
      return (await readForAnalysis(client,context,id,options)).data;
    },
    async analysisMetadata(client,context,id){
      const {record}=await readForAnalysis(client,context,id);
      return {width:record.width,height:record.height,provenance:record.provenance?{...record.provenance}:null};
    },
    async save(client,context,id,name){
      if(!/^[A-Za-z0-9_-]{1,80}\.(png|jpg|jpeg)$/.test(name))reject('INVALID_ARGUMENT','Export requires a safe image basename');
      const r=await owned(client,context,id),prefix=createHash('sha256').update(client+context).digest('hex').slice(0,16),dest=path.join(await ready(),`${prefix}-${name}`);
      if(r.exports.length>=32)reject('LIMIT_EXCEEDED','Artifact export limit exceeded');
      if([...records.values()].filter(x=>x.clientRef===client).reduce((n,x)=>n+x.bytes*(1+x.exports.length),0)+r.bytes>maxClientBytes||await diskUsage()+r.bytes>maxTotalBytes)reject('LIMIT_EXCEEDED','Artifact export quota exceeded');
      try{await copyFile(await safe(r.path),await safe(dest),constants.COPYFILE_EXCL);}catch{reject('ARTIFACT_IO_ERROR','Image export exists or could not be written');}
      r.exports.push(dest);return {...metadata(r),path:dest};
    },
    async release(client,context){for(const r of [...records.values()])if(r.clientRef===client&&(!context||r.contextRef===context))await remove(r);},
    async sweep(){await sweep();},
    get size(){return records.size;}
  };
  let queue=Promise.resolve();
  for(const name of ['put','inspect','image','analysisRead','analysisMetadata','save','release','sweep']){const method=api[name];api[name]=(...args)=>{const job=queue.then(()=>method(...args));queue=job.catch(()=>{});return job;};}
  return api;
}
