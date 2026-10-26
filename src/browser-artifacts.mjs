import path from 'node:path';
import {mkdir,readFile,writeFile,rename,unlink,lstat,realpath,copyFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {opaque,reject} from './browser-tools.mjs';

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
  const sweep=async()=>{for(const r of records.values())if(now()-r.createdAt>ttlMs)await remove(r);};
  const metadata=r=>({artifactRef:r.artifactRef,mimeType:r.mimeType,bytes:r.bytes,sha256:r.sha256,path:r.path,expiresAt:new Date(r.createdAt+ttlMs).toISOString(),width:r.width,height:r.height});
  const owned=async(clientRef,contextRef,id)=>{
    await sweep();const r=records.get(id);if(!r||r.clientRef!==clientRef||r.contextRef!==contextRef)reject('STALE_ARTIFACT','Artifact is expired or belongs to another context');
    const stat=await lstat(r.path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==r.bytes)reject('ARTIFACT_IO_ERROR','Artifact file was replaced');return r;
  };
  const api={
    async put(clientRef,contextRef,data,mimeType){
      await sweep();if(!Buffer.isBuffer(data)||!data.length||data.length>maxFileBytes)reject('RESULT_TOO_LARGE','Image artifact size limit exceeded');
      const all=[...records.values()],client=all.filter(r=>r.clientRef===clientRef);
      if(client.length>=32||client.reduce((n,r)=>n+r.bytes*(1+r.exports.length),0)+data.length>maxClientBytes||await diskUsage()+data.length>maxTotalBytes)reject('LIMIT_EXCEEDED','Artifact quota exceeded');
      if(!['image/png','image/jpeg'].includes(mimeType))reject('INVALID_ARGUMENT','Unsupported image format');
      const base=await ready(),id=opaque('img'),file=path.join(base,id+(mimeType==='image/png'?'.png':'.jpg')),temporary=file+'.partial';
      let width=null,height=null;
      if(mimeType==='image/png'){
        if(data.length<24||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')reject('BACKEND_FAILURE','Invalid PNG image');
        width=data.readUInt32BE(16);height=data.readUInt32BE(20);
        if(width>32768||height>32768)reject('RESULT_TOO_LARGE','Image dimensions exceed the limit');
      }else if(data[0]!==0xff||data[1]!==0xd8)reject('BACKEND_FAILURE','Invalid JPEG image');
      try{await writeFile(temporary,data,{flag:'wx'});await rename(temporary,file);}
      catch{try{await unlink(temporary);}catch{}reject('ARTIFACT_IO_ERROR','Could not store the image artifact');}
      const r={artifactRef:id,clientRef,contextRef,path:file,exports:[],mimeType,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),createdAt:now(),width,height};
      records.set(id,r);return metadata(r);
    },
    async inspect(client,context,id){return metadata(await owned(client,context,id));},
    async image(client,context,id){
      const r=await owned(client,context,id);if(r.bytes>384*1024)reject('RESULT_TOO_LARGE','Inline image exceeds 384 KiB; save the owned artifact instead');
      const data=await readFile(await safe(r.path));if(createHash('sha256').update(data).digest('hex')!==r.sha256)reject('ARTIFACT_IO_ERROR','Artifact content changed');
      return {mimeType:r.mimeType,data:data.toString('base64')};
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
  for(const name of ['put','save','release','sweep']){const method=api[name];api[name]=(...args)=>{const job=queue.then(()=>method(...args));queue=job.catch(()=>{});return job;};}
  return api;
}
