import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
export async function startBrowserFixture(){
  const nonce=randomUUID(),bundle=(await build({entryPoints:[new URL('./fixtures/browser-runtime.jsx',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,write:false,format:'iife',minify:true,define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0].contents;
  let main,cross;const servers=[];
  const server=()=>http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');if(!u.pathname.startsWith('/'+nonce+'/')){res.writeHead(404).end();return;}
    res.setHeader('Cache-Control','no-store');
    if(u.pathname.endsWith('/bundle.js')){res.setHeader('Content-Type','application/javascript');res.end(bundle);return;}
    if(u.pathname.endsWith('/slow')){setTimeout(()=>{res.end('done');},200);return;}
    const frame=u.pathname.endsWith('/frame');
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Browser runtime fixture ${nonce}</title><style>body{font:16px sans-serif;padding:15px}input,button,select{margin:5px}iframe{width:420px;height:110px}#drop{border:1px solid;padding:15px;width:200px}table td,table th{border:1px solid;padding:5px}#popup{padding:10px}</style></head><body>${frame?'<input id="frame-input" value="frame-initial">':`<h1>MCP owned fixture</h1><form id="form"><input id="text" name="text"><input id="secret" type="password" value="fixture-only-secret"><input id="check" type="checkbox"><input id="date" type="date"><select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select></form><div id="react"></div><button id="button">Click counter</button><span id="counter">0</span><div id="drag" draggable="true">Drag</div><div id="drop">Drop</div><div id="popup"><button id="close">Close popup</button></div><table id="table"><tr><th>Name</th><th>Count</th></tr><tr><td>One</td><td>1</td></tr><tr><td>Hai</td><td>2</td></tr></table><div id="tree" role="tree"><div id="branch" role="treeitem" aria-expanded="false">Branch</div></div><iframe id="same" src="${main}/${nonce}/frame"></iframe><iframe id="cross" src="${cross}/${nonce}/frame"></iframe><script src="/${nonce}/bundle.js"></script>`}</body></html>`);
  });
  try{for(let i=0;i<2;i++){const s=server();servers.push(s);await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});if(i===0)main=`http://127.0.0.1:${s.address().port}`;else cross=`http://127.0.0.1:${s.address().port}`;}
    return {url:`${main}/${nonce}/main`,nonce,bundleSha256:createHash('sha256').update(bundle).digest('hex'),close:()=>Promise.all(servers.map(s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();})))};
  }catch(e){for(const s of servers)s.close();throw e;}
}
