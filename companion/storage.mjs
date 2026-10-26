export function createIndexedDbStorage(indexedDBApi=globalThis.indexedDB){
  if(!indexedDBApi?.open)throw new Error('IndexedDB is unavailable');
  let databasePromise;
  const database=()=>databasePromise??=new Promise((resolve,reject)=>{
    const request=indexedDBApi.open('uipath-companion-state-v1',1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('state'))db.createObjectStore('state',{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('IndexedDB open failed'));
  });
  const read=(mode,operation)=>database().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction('state',mode),store=tx.objectStore('state');let result;
    try{result=operation(store);}catch(error){reject(error);return;}
    tx.oncomplete=()=>resolve(result?.result?.value);tx.onerror=()=>reject(tx.error??new Error('IndexedDB transaction failed'));
    tx.onabort=()=>reject(tx.error??new Error('IndexedDB transaction aborted'));
  }));
  return {
    get:key=>read('readonly',store=>store.get(key)),
    set:(key,value)=>read('readwrite',store=>store.put({key,value})),
    remove:key=>read('readwrite',store=>store.delete(key)),
    async values(prefix=''){
      const db=await database();return new Promise((resolve,reject)=>{
        const tx=db.transaction('state','readonly'),request=tx.objectStore('state').getAll();
        request.onsuccess=()=>resolve(request.result.filter(x=>x.key.startsWith(prefix)).map(x=>x.value));
        request.onerror=()=>reject(request.error??new Error('IndexedDB read failed'));
      });
    },
    close(){databasePromise?.then(db=>db.close()).catch(()=>{});databasePromise=null;}
  };
}
