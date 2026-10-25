import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const reportKeys=['seq','generation','ack','documentReady','nativeValue','nodePresent','controlledDom','controlledModel','rejectingDom','rejectingModel','inputEvents','changeEvents','reactChanges','rejectChanges','frameworkVersion'];
const commandsAllowed=['remove','replace','rerender','reload-same','reload-cross','reload-parent','navigate-next'];
export async function startG04Fixture(){
  const nonce=randomUUID(),base=`/g04/${nonce}`;
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/g04-app.jsx',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
  const js=bundle.outputFiles[0].text,bundleSha256=createHash('sha256').update(js).digest('hex');
  const states=new Map(),seen=new Map(),queue=[],delivered=new Set();let mainOrigin,crossOrigin,commandId=0;
  function handler(serverRole){return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(code,type,body)=>{res.writeHead(code,{'Content-Type':type});res.end(body);};
    const origin=serverRole==='main'?mainOrigin:crossOrigin;
    if(!origin||req.headers.host!==new URL(origin).host)return reply(403,'text/plain','host');
    let url;try{url=new URL(req.url,origin);}catch{return reply(400,'text/plain','url');}
    if(req.method==='GET'&&url.pathname===base+'/app.js'&&!url.search)return reply(200,'text/javascript; charset=utf-8',js);
    const role=url.pathname===base+'/page'||url.pathname===base+'/next'?'main':url.pathname===base+'/frame-same'?'same':url.pathname===base+'/frame-cross'?'cross':null;
    if(req.method==='GET'&&role&&((serverRole==='main'&&role!=='cross')||(serverRole==='cross'&&role==='cross'))){
      if(url.search&&(!(role==='same'||role==='cross')||[...url.searchParams.keys()].length!==1||!uuid.test(url.searchParams.get('reload')??'')))return reply(400,'text/plain','query');
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; connect-src 'self'; frame-src ${mainOrigin} ${crossOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors ${mainOrigin}`);
      const config=JSON.stringify({nonce,role,base,sameUrl:mainOrigin+base+'/frame-same',crossUrl:crossOrigin+base+'/frame-cross'});
      return reply(200,'text/html; charset=utf-8',`<!doctype html><meta charset="utf-8"><title>G04 loading</title><div id="native-root"></div><div id="react-root"></div><div id="frame-root"></div><script id="g04-config" type="application/json">${config}</script><script src="${base}/app.js"></script>`);
    }
    if(req.method==='GET'&&req.url===base+'/commands'&&serverRole==='main'){
      if(req.headers['x-g04-nonce']!==nonce)return reply(403,'text/plain','nonce');
      const command=queue.shift()??null;if(command)delivered.add(command.id);
      return reply(200,'application/json',JSON.stringify(command));
    }
    const reportRole=req.url?.slice((base+'/report/').length);
    if(req.method!=='POST'||!req.url?.startsWith(base+'/report/')||!['main','same','cross'].includes(reportRole)
      ||(serverRole==='cross'&&reportRole!=='cross')||(serverRole==='main'&&reportRole==='cross'))return reply(404,'text/plain','route');
    if(req.headers.origin!==origin)return reply(403,'text/plain','origin');
    if(req.headers['content-type']!=='application/json')return reply(415,'text/plain','type');
    const chunks=[];let bytes=0;
    try{
      for await(const c of req){bytes+=c.length;if(bytes>4096)return reply(413,'text/plain','size');chunks.push(c);}
      const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==reportKeys.length||reportKeys.some(k=>!Object.hasOwn(v,k))
        ||typeof v.generation!=='string'||!uuid.test(v.generation)||typeof v.nodePresent!=='boolean'||typeof v.documentReady!=='boolean'
        ||typeof v.frameworkVersion!=='string'||v.frameworkVersion.length>32
        ||['seq','ack','inputEvents','changeEvents','reactChanges','rejectChanges'].some(k=>!Number.isSafeInteger(v[k])||v[k]<0)
        ||['nativeValue','controlledDom','controlledModel','rejectingDom','rejectingModel'].some(k=>v[k]!==null&&(typeof v[k]!=='string'||v[k].length>128))
        ||(reportRole!=='main'&&v.ack!==0)||(v.ack!==0&&!delivered.has(v.ack)))return reply(400,'text/plain','report');
      const old=states.get(reportRole),known=seen.get(reportRole)??new Set();
      if(old?.generation===v.generation&&(v.seq<=old.seq||v.ack<old.ack))return reply(409,'text/plain','sequence');
      if(old?.generation!==v.generation){
        if(known.has(v.generation)||known.size>=64||v.seq!==0)return reply(409,'text/plain','generation');
        known.add(v.generation);seen.set(reportRole,known);
      }
      states.set(reportRole,{...v});reply(204,'text/plain','');
    }catch{if(!res.headersSent)reply(400,'text/plain','report');}
  };}
  const main=createServer(handler('main')),cross=createServer(handler('cross'));
  for(const server of [main,cross]){server.requestTimeout=3000;server.headersTimeout=3000;}
  const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const stop=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  try{await listen(main);mainOrigin=`http://127.0.0.1:${main.address().port}`;await listen(cross);crossOrigin=`http://127.0.0.1:${cross.address().port}`;}
  catch(error){await Promise.all([stop(main),stop(cross)]);throw error;}
  return {nonce,base,url:mainOrigin+base+'/page',mainOrigin,crossOrigin,bundleSha256,
    snapshot:role=>{const x=states.get(role);return x?{...x}:null;},
    command(action){if(!commandsAllowed.includes(action)||queue.length>=16)throw Error('FIXTURE_COMMAND_INVALID');const id=++commandId;queue.push({id,action});return id;},
    async close(){await Promise.all([stop(main),stop(cross)]);}};
}
