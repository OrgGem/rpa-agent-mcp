import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startG0Fixture(){
  const nonce=randomUUID(),base=`/g0/${nonce}`,title=`G0 fixture ${nonce}`;
  let state=null,origin;
  const script=`const value=document.getElementById('g0-input');let seq=0,inputEvents=0,changeEvents=0,clicks=0;
const report=()=>fetch('${base}/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seq:seq++,value:value.value,inputEvents,changeEvents,clicks})}).catch(()=>{});
value.addEventListener('input',()=>{inputEvents++;report()});value.addEventListener('change',()=>{changeEvents++;report()});
document.getElementById('g0-button').addEventListener('click',()=>{clicks++;report()});report();`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><label>G0 input <input id="g0-input" value="initial"></label><input name="g0-duplicate" value="a"><input name="g0-duplicate" value="b"><button id="g0-button">Count</button><script src="${base}/fixture.js"></script></body></html>`;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const finish=(code,type,body)=>{res.writeHead(code,{'Content-Type':type});res.end(body);};
    if(req.headers.host!==new URL(origin).host)return finish(403,'text/plain','host');
    if(req.method==='GET'&&req.url===base+'/page'){
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return finish(200,'text/html; charset=utf-8',html);
    }
    if(req.method==='GET'&&req.url===base+'/fixture.js')return finish(200,'text/javascript; charset=utf-8',script);
    if(req.method!=='POST'||req.url!==base+'/report')return finish(404,'text/plain','not found');
    if(req.headers.origin!==origin)return finish(403,'text/plain','origin');
    if(req.headers['content-type']!=='application/json')return finish(415,'text/plain','content type');
    const chunks=[];let size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>1024){finish(413,'text/plain','size');req.resume();return;}chunks.push(chunk);}
      const v=JSON.parse(Buffer.concat(chunks).toString('utf8')),keys=['seq','value','inputEvents','changeEvents','clicks'];
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))
        ||typeof v.value!=='string'||v.value.length>128||keys.filter(k=>k!=='value').some(k=>!Number.isSafeInteger(v[k])||v[k]<0)
        ||(state&&v.seq<=state.seq))return finish(400,'text/plain','report');
      state={...v};finish(204,'text/plain','');
    }catch{if(!res.headersSent)finish(400,'text/plain','report');}
  });
  server.requestTimeout=3000;server.headersTimeout=3000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {nonce,url:origin+base+'/page',origin,reportUrl:origin+base+'/report',title,
    snapshot:()=>state?{...state}:null,
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
