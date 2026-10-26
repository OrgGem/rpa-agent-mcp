import {createCompanionBackend} from './backend.mjs';

export async function initializeCompanionServiceWorker({chromeApi=globalThis.chrome,storage,now,randomBytes,axeSource}={}){
  if(!chromeApi?.runtime?.id)throw new TypeError('Chrome extension runtime is required');
  let bundledAxe=axeSource??null;
  if(bundledAxe===null&&typeof chromeApi.runtime.getURL==='function'){
    try{const response=await fetch(chromeApi.runtime.getURL('axe.min.js'));if(response.ok){const source=await response.text();if(source.length>=1000&&source.length<=2*1024*1024)bundledAxe=source;}}catch{}
  }
  const backend=createCompanionBackend({chromeApi,storage,now,randomBytes,axeSource:bundledAxe});
  await backend.start();
  chromeApi.runtime.onSuspend?.addListener?.(()=>{void backend.dispose();});
  return backend;
}

if(globalThis.chrome?.runtime?.id){
  void initializeCompanionServiceWorker().then(backend=>{globalThis.__uipathCompanionBackend=backend;}).catch(()=>{});
}
