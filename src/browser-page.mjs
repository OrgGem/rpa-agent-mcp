// This function is serialized into the UiPath ISOLATED execution world.
// Keep every helper inside it: the browser has no Node/module bindings.
export function pageOperation(element,input){
  let q,mutated=false;
  const die=(code,message=code)=>{throw Object.assign(new Error(message),{code});};
  try{
    q=JSON.parse(input);
    const uuid=()=>{
      if(globalThis.crypto.randomUUID)return crypto.randomUUID();
      const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      const h=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    };
    const slot=Symbol.for(q.namespace);
    let s=globalThis[slot];
    if(!s||s.document!==document){
      s={document,token:uuid(),nodes:new Map(),byNode:new WeakMap(),watches:new Map(),highlights:new Map(),expected:new Map(),renders:new Map(),viewport:0};
      Object.defineProperty(globalThis,slot,{value:s,writable:true,configurable:true});
    }
    const now=Date.now();
    s.renders??=new Map();
    const cancelRender=id=>{const r=s.renders.get(id);if(!r)return;cancelAnimationFrame(r.first);cancelAnimationFrame(r.second);clearTimeout(r.timer);s.renders.delete(id);};
    for(const [id,r] of s.renders)if(now>=r.expiresAt)cancelRender(id);
    for(const [token,r] of s.nodes)if(now-r.at>600000||!r.ref.deref())s.nodes.delete(token);
    for(const [id,w] of s.watches)if(now>=w.expiresAt){for(const [type,fn] of w.listeners)w.node.deref()?.removeEventListener(type,fn,true);w.listeners=[];w.expired=true;if(now-w.expiresAt>60000)s.watches.delete(id);}
    if(q.expectedDocument&&q.expectedDocument!==s.token)die('STALE_FRAME','Document changed');
    const getNode=(token,allowDetached=false)=>{
      const r=s.nodes.get(token);if(!r)die('STALE_ELEMENT');
      const node=r.ref.deref();r.at=Date.now();
      if(!node){if(allowDetached)return null;die('STALE_ELEMENT');}
      if(node.ownerDocument!==document||(!allowDetached&&!node.isConnected))die('STALE_ELEMENT');
      return node;
    };
    const target=q.targetToken?getNode(q.targetToken,q.allowDetached):element;
    if(q.targetToken&&element&&target!==element)die('STALE_ELEMENT','Native handle no longer identifies the same node');
    const root=q.rootToken?getNode(q.rootToken):document;
    const clip=(v,n)=>String(v??'').slice(0,n);
    const text=node=>String(typeof node.innerText==='string'?node.innerText:node.textContent??'');
    const visible=node=>{
      if(!node?.isConnected||!node.getClientRects?.().length)return false;
      const style=getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse';
    };
    const disabled=node=>Boolean(node?.disabled||node?.matches?.(':disabled')||node?.getAttribute?.('aria-disabled')==='true');
    const isPassword=node=>node?.tagName==='INPUT'&&node.type==='password';
    const value=node=>node?.isContentEditable?node.textContent:typeof node?.value==='string'?node.value:text(node);
    const label=node=>clip(node.getAttribute('aria-label')||(node.labels?Array.from(node.labels,x=>text(x)).join(' '):'')||node.getAttribute('title')||text(node),512).trim();
    const rect=node=>{
      const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left,right:r.right,bottom:r.bottom,coordinateSpace:'cssViewport',devicePixelRatio:devicePixelRatio||1};
    };
    const nativeId=node=>{
      try{
        if(typeof g_globalContext!=='undefined'&&typeof g_globalContext.GenerateCustomIdForElement==='function'){
          const v=String(g_globalContext.GenerateCustomIdForElement(node));
          if(/^[A-Za-z0-9._:-]{1,128}$/.test(v))return v;
        }
      }catch{}
      return null;
    };
    const bind=node=>{
      if(!node||node.nodeType!==1||node.ownerDocument!==document||!node.isConnected)die('STALE_ELEMENT');
      let token=s.byNode.get(node);
      if(!token||!s.nodes.has(token)){
        if(s.nodes.size>=8192)die('LIMIT_EXCEEDED','Document node registry is full');
        token=uuid();s.byNode.set(node,token);s.nodes.set(token,{ref:new WeakRef(node),at:Date.now()});
      }
      const r=s.nodes.get(token);r.at=Date.now();
      return {token,nativeLocalId:nativeId(node),tag:node.tagName.toLowerCase()};
    };
    const describe=(node,brief=false)=>{
      const r=bind(node),secret=isPassword(node),v=value(node);
      return {...r,label:label(node),text:clip(text(node),brief?256:16384),value:secret?null:clip(v,brief?512:16384),redacted:secret,
        truncated:text(node).length>(brief?256:16384)||String(v).length>(brief?512:16384),
        state:{connected:true,visible:visible(node),disabled:disabled(node),readOnly:Boolean(node.readOnly),
          checked:['checkbox','radio'].includes(node.type)?Boolean(node.checked):null,indeterminate:Boolean(node.indeterminate),focused:document.activeElement===node,
          selectedValues:node.tagName==='SELECT'?Array.from(node.selectedOptions,x=>clip(x.value,512)).slice(0,100):[]},rect:rect(node)};
    };
    const editable=node=>{
      if(!node||!visible(node)||disabled(node)||node.readOnly)die('TARGET_NOT_INTERACTABLE','Target is hidden, disabled or readonly');
    };
    const pointerTarget=node=>{
      if(!node||!visible(node)||disabled(node))die('TARGET_NOT_INTERACTABLE');const r=node.getBoundingClientRect();
      if(r.width<=0||r.height<=0)die('TARGET_NOT_INTERACTABLE');
      const x=Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)),y=Math.min(innerHeight-1,Math.max(0,r.top+r.height/2));
      const top=document.elementFromPoint(x,y);
      if(!top||!(node===top||node.contains(top)))die('TARGET_OCCLUDED','Target center is not reachable');
      return {x,y};
    };
    const inputEvent=node=>{node.dispatchEvent(new Event('input',{bubbles:true,composed:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
    const setValue=(node,wanted)=>{
      mutated=true;
      if(node.isContentEditable)node.textContent=wanted;
      else{
        const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
        if(!setter)die('UNSUPPORTED_CAPABILITY','No native DOM value setter');setter.call(node,wanted);
      }
      inputEvent(node);
    };
    const query=locator=>{
      let nodes,truncated=false,count;
      if(locator.kind==='css')nodes=Array.from(root.querySelectorAll(locator.value));
      else if(locator.kind==='xpath'){
        const found=document.evaluate(locator.value,root,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);nodes=[];
        for(let i=0;i<found.snapshotLength;i++){const n=found.snapshotItem(i);if(n?.nodeType===1&&n.ownerDocument===document&&(root===document||root.contains(n)))nodes.push(n);}
      }else if(locator.kind==='attributes'){
        nodes=Array.from(root.querySelectorAll(locator.tag??'*')).filter(n=>Object.entries(locator.attributes??{}).every(([k,v])=>n.getAttribute(k)===v));
      }else{
        const all=root.querySelectorAll(locator.tag??'body *');nodes=[];let scanned=0;
        for(const node of all){
          if(++scanned>5000){truncated=true;break;}
          if(['SCRIPT','STYLE','HEAD','META','TITLE','LINK','NOSCRIPT'].includes(node.tagName))continue;
          const content=text(node).trim(),wanted=locator.value;
          const matches=v=>locator.match==='contains'?v.includes(wanted):v===wanted;
          if(matches(content)&&!Array.from(node.children).some(c=>matches(text(c).trim())))nodes.push(node);
        }
      }
      count=truncated?null:nodes.length;
      return {nodes,count,truncated};
    };
    let data;
    switch(q.op){
      case 'document':data={url:location.href,title:document.title,ready:document.readyState==='complete',visibility:['visible','hidden'].includes(document.visibilityState)?document.visibilityState:'unknown',timeOrigin:performance.timeOrigin,
        nativeHandleSupport:typeof g_globalContext!=='undefined'&&typeof g_globalContext.GenerateCustomIdForElement==='function',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};break;
      case 'render':{
        if(q.action==='arm'){
          if(!Number.isInteger(q.ttlMs)||q.ttlMs<100||q.ttlMs>2000)die('INVALID_ARGUMENT','Render ticket TTL must be 100–2000ms');
          if(s.renders.size>=64)die('LIMIT_EXCEEDED','Document render ticket limit reached');
          const ticket=uuid(),r={owner:q.owner,ready:false,expiresAt:Date.now()+q.ttlMs,first:0,second:0,timer:0};
          s.renders.set(ticket,r);
          const alive=()=>{if(!s.renders.has(ticket))return false;if(Date.now()>=r.expiresAt){cancelRender(ticket);return false;}return true;};
          r.timer=setTimeout(()=>cancelRender(ticket),q.ttlMs);
          r.first=requestAnimationFrame(()=>{if(alive())r.second=requestAnimationFrame(()=>{if(alive())r.ready=true;});});
          data={ticket,ready:false};
        }else{
          const r=s.renders.get(q.ticket);
          if(r&&r.owner!==q.owner)die('REF_SCOPE_MISMATCH','Render ticket belongs to another context');
          if(q.action==='cancel'){cancelRender(q.ticket);data={ticket:q.ticket,cancelled:true};}
          else if(q.action==='poll'){
            if(!r)die('CAPTURE_NOT_READY','Render ticket expired or is unavailable');
            data={ticket:q.ticket,ready:r.ready};if(r.ready)cancelRender(q.ticket);
          }else die('INVALID_ARGUMENT','Unknown render ticket action');
        }break;
      }
      case 'bind':data={entry:describe(target)};break;
      case 'probe':{
        const node=q.targetToken?getNode(q.targetToken,true):target;
        data={connected:Boolean(node?.isConnected),entry:node?.isConnected?describe(node):null};break;
      }
      case 'find':{
        let found;try{found=query(q.locator);}catch(e){if(e.code)throw e;die('INVALID_ARGUMENT','Invalid DOM locator');}
        data={entries:found.nodes.slice(0,q.limit).map(n=>describe(n,true)),matchCount:found.count,observedMatchCount:found.nodes.length,
          truncated:found.truncated||found.nodes.length>q.limit};break;
      }
      case 'snapshot':{
        const base=root===document?document.body:root,nodes=[],indices=new Map();let truncated=false;
        if(base){const walker=document.createTreeWalker(base,NodeFilter.SHOW_ELEMENT);let n=base,scanned=0;
          do{
            if(++scanned>5000){truncated=true;break;}
            let depth=0,p=n;while(p&&p!==base){depth++;p=p.parentElement;}
            if(depth>q.maxDepth){truncated=true;continue;}
            if(!q.includeHidden&&!visible(n))continue;
            if(!n.matches('input,textarea,select,button,a,iframe,frame,[role],h1,h2,h3,h4,h5,h6,table,tr,td,th,label,summary,details,[contenteditable],p,li'))continue;
            if(nodes.length>=q.maxNodes){truncated=true;break;}
            p=n.parentElement;while(p&&!indices.has(p))p=p.parentElement;
            const parentIndex=p?indices.get(p):null;indices.set(n,nodes.length);
            nodes.push({...describe(n,true),parentIndex,depth});
          }while((n=walker.nextNode()));
        }
        data={entries:nodes,truncated};break;
      }
      case 'read':{
        const d=describe(target),out={entry:{token:d.token,nativeLocalId:d.nativeLocalId,tag:d.tag},unsupportedFields:[],redacted:d.redacted,truncated:d.truncated};
        for(const field of q.fields){
          if(['text','value','state','rect'].includes(field))out[field]=d[field];
          else if(field==='attributes')out.attributes=Object.fromEntries(q.attributeNames.map(name=>[name,isPassword(target)&&name.toLowerCase()==='value'?null:target.getAttribute(name)?.slice(0,4096)??null]));
          else out.unsupportedFields.push(field);
        }
        data=out;break;
      }
      case 'controlInfo':{
        const all=target?.tagName==='SELECT'?Array.from(target.options):[];
        data={tag:target?.tagName,type:target?.type??'',visible:visible(target),disabled:disabled(target),readOnly:Boolean(target?.readOnly),multiple:Boolean(target?.multiple),
          options:all.slice(0,1000).map(o=>({value:clip(o.value,512),label:clip(o.label,512),disabled:Boolean(o.disabled||o.parentElement?.disabled)})),
          selectedValues:all.filter(o=>o.selected).map(o=>clip(o.value,512)),selectedLabels:all.filter(o=>o.selected).map(o=>clip(o.label,512)),
          truncated:all.length>1000||all.some(o=>o.value.length>512||o.label.length>512)};break;
      }
      case 'prepareType':{
        editable(target);
        if(!target.isContentEditable&&!['INPUT','TEXTAREA'].includes(target.tagName))die('UNSUPPORTED_CAPABILITY','Not a text input');
        if(target.tagName==='INPUT'&&['file','checkbox','radio','button','submit','reset','range','color','date','datetime-local','month','time','week','hidden','image'].includes(target.type))die('UNSUPPORTED_CAPABILITY','Unsupported input type');
        if(s.expected.size>=64)die('LIMIT_EXCEEDED');
        const ticket=uuid();s.expected.set(ticket,{owner:q.owner,token:q.targetToken,value:q.mode==='append'?String(value(target))+q.text:q.text});setTimeout(()=>s.expected.delete(ticket),30000);
        data={ticket};break;
      }
      case 'verifyType':{
        const expected=s.expected.get(q.ticket);if(!expected||expected.owner!==q.owner||expected.token!==q.targetToken)die('STALE_ELEMENT','Verification ticket expired');s.expected.delete(q.ticket);
        data={valueMatch:value(target)===expected.value,value:isPassword(target)?null:clip(value(target),16384),redacted:isPassword(target),truncated:String(value(target)).length>16384};break;
      }
      case 'type':{
        editable(target);
        if(!target.isContentEditable&&!['INPUT','TEXTAREA'].includes(target.tagName))die('UNSUPPORTED_CAPABILITY','Target is not a text input');
        if(target.tagName==='INPUT'&&['file','checkbox','radio','button','submit','reset','range','color','date','datetime-local','month','time','week','hidden','image'].includes(target.type))die('UNSUPPORTED_CAPABILITY','Input type is not supported by type');
        const expected=q.mode==='append'?String(value(target))+q.text:q.text;
        mutated=true;target.focus();setValue(target,expected);
        data={valueMatch:value(target)===expected,value:isPassword(target)?null:clip(value(target),16384),redacted:isPassword(target),truncated:String(value(target)).length>16384};break;
      }
      case 'click':{
        const p=pointerTarget(target),button={left:0,middle:1,right:2}[q.button];
        mutated=true;
        for(let i=0;i<q.clickCount;i++){
          if(q.button==='left')target.click();
          else target.dispatchEvent(new MouseEvent(q.button==='right'?'contextmenu':'auxclick',{bubbles:true,cancelable:true,button,clientX:p.x,clientY:p.y,detail:i+1}));
        }
        if(q.clickCount===2)target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button,detail:2,clientX:p.x,clientY:p.y}));
        data={acknowledged:true};break;
      }
      case 'checked':{
        editable(target);if(target.tagName!=='INPUT'||!['checkbox','radio'].includes(target.type))die('UNSUPPORTED_CAPABILITY','Only native checkbox/radio supported');
        if(target.type==='radio'&&!q.checked)die('UNSUPPORTED_CAPABILITY','Radio uncheck is not supported');
        const changed=target.checked!==q.checked;if(changed){mutated=true;target.click();}data={checked:Boolean(target.checked),changed};break;
      }
      case 'select':{
        editable(target);if(target.tagName!=='SELECT')die('UNSUPPORTED_CAPABILITY','Only native HTML select supported');
        const wanted=q.values??q.labels,key=q.values?'value':'label',options=Array.from(target.options);
        if(!target.multiple&&wanted.length>1)die('INVALID_ARGUMENT','Single-select accepts at most one option');
        const matches=wanted.map(v=>{const m=options.filter(o=>(key==='value'?o.value:o.label)===v);
          if(m.length!==1)die(m.length?'AMBIGUOUS_TARGET':'NOT_FOUND','Option must match exactly once');
          if(m[0].disabled||m[0].parentElement?.disabled)die('TARGET_NOT_INTERACTABLE','Option is disabled');return m[0];});
        if(matches.some(o=>o.value.length>512||o.label.length>512))die('RESULT_TOO_LARGE','Selected option value/label exceeds 512 characters');
        const before=Array.from(target.selectedOptions,o=>o.value);
        mutated=true;
        for(const o of options)o.selected=matches.includes(o);if(!wanted.length)target.selectedIndex=-1;
        inputEvent(target);const selected=Array.from(target.selectedOptions);
        data={selectedValues:selected.map(o=>o.value),selectedLabels:selected.map(o=>o.label),changed:JSON.stringify(before)!==JSON.stringify(selected.map(o=>o.value)),valueMatch:selected.length===matches.length&&matches.every(o=>o.selected)};break;
      }
      case 'scroll':{
        const n=target??window;
        mutated=true;
        if(q.action==='intoView'){if(!target)die('INVALID_ARGUMENT');target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});}
        else if(q.action==='by')n.scrollBy({left:q.x??0,top:q.y??0,behavior:'instant'});
        else n.scrollTo({left:q.x??0,top:q.y??0,behavior:'instant'});
        s.viewport++;data={x:target?target.scrollLeft:scrollX,y:target?target.scrollTop:scrollY,viewportGeneration:s.viewport};break;
      }
      case 'focus':if(!target||!visible(target)||disabled(target))die('TARGET_NOT_INTERACTABLE');mutated=true;target.focus();data={focused:document.activeElement===target};break;
      case 'attribute':{
        if(!/^[A-Za-z_][A-Za-z0-9:_-]*$/.test(q.name)||/^on|^uipath|^data-rpa-|^(srcdoc|nonce|integrity)$/i.test(q.name))die('INVALID_ARGUMENT','Reserved attribute');
        mutated=true;target.setAttribute(q.name,q.value);data={name:q.name,valueMatch:target.getAttribute(q.name)===q.value};break;
      }
      case 'hover':{
        const p=pointerTarget(target),events=['pointerover','pointerenter','mouseover','mouseenter'];
        mutated=true;
        for(const type of events){const C=type.startsWith('pointer')?PointerEvent:MouseEvent;target.dispatchEvent(new C(type,{bubbles:!type.endsWith('enter'),clientX:p.x,clientY:p.y}));}
        data={events};break;
      }
      case 'drag':{
        const destination=getNode(q.destinationToken);pointerTarget(target);pointerTarget(destination);
        const transfer=new DataTransfer();let prevented=false;
        mutated=true;
        for(const [node,type] of [[target,'dragstart'],[destination,'dragenter'],[destination,'dragover'],[destination,'drop'],[target,'dragend']]){
          const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer});node.dispatchEvent(ev);if(type==='drop')prevented=ev.defaultPrevented;
        }
        data={eventsDispatched:true,defaultPrevented:prevented};break;
      }
      case 'selection':{
        if(!['INPUT','TEXTAREA'].includes(target.tagName)||typeof target.selectionStart!=='number')die('UNSUPPORTED_CAPABILITY','Only text input selection supported');
        if(q.action==='set'){if(q.end>target.value.length)die('INVALID_ARGUMENT','Selection exceeds text length');mutated=true;target.setSelectionRange(q.start,q.end);}
        data={action:q.action,start:target.selectionStart,end:target.selectionEnd,text:isPassword(target)?'[REDACTED]':clip(target.value.slice(target.selectionStart,target.selectionEnd),4096),truncated:target.selectionEnd-target.selectionStart>4096};break;
      }
      case 'highlight':{
        const key=q.targetToken,old=s.highlights.get(key);
        if(old&&old.owner!==q.owner)die('TARGET_BUSY','Another context owns the highlight');
        const stop=()=>{const h=s.highlights.get(key);if(!h)return;clearTimeout(h.timer);const n=h.ref.deref();if(n?.style.outline===h.applied)n.style.outline=h.previous;s.highlights.delete(key);};
        stop();
        if(q.action==='start'){
          const h={owner:q.owner,ref:new WeakRef(target),previous:target.style.outline,applied:`2px solid ${q.color??'#ff00ff'}`};target.style.outline=h.applied;h.applied=target.style.outline;s.highlights.set(key,h);h.timer=setTimeout(stop,q.ttlMs);
        }
        data={action:q.action,active:q.action==='start',ttlMs:q.action==='start'?q.ttlMs:0};break;
      }
      case 'frames':data={entries:Array.from((root===document?document:root).querySelectorAll('iframe,frame')).slice(0,64).map(n=>({...describe(n,true),name:clip(n.name,256)})),truncated:root.querySelectorAll('iframe,frame').length>64};break;
      case 'form':{
        const all=(target??root).querySelectorAll('input,textarea,select'),entries=[];let truncated=false;
        for(const n of all){if(entries.length>=q.maxFields){truncated=true;break;}const d=describe(n,true);entries.push({...d,name:clip(n.name||n.id,256),type:clip(n.type,64),checked:['checkbox','radio'].includes(n.type)?Boolean(n.checked):null,selectedValues:n.tagName==='SELECT'?Array.from(n.selectedOptions,o=>clip(o.value,512)).slice(0,100):[]});}
        data={entries,truncated};break;
      }
      case 'table':{
        let table=target??(root===document?null:root);
        if(!table){const all=root.querySelectorAll('table');if(all.length!==1)die(all.length?'AMBIGUOUS_TARGET':'NOT_FOUND','Choose one table');table=all[0];}
        let columns=q.columns?.map(c=>c.name),rows=[],truncated=false;
        const source=!q.rowSelector&&table.tagName==='TABLE'?table.rows:table.querySelectorAll(q.rowSelector??'tr');let start=0,bytes=0;
        if(!columns){const header=source[0]?.querySelectorAll('th');const count=header?.length||source[0]?.querySelectorAll('td').length||0;
          columns=Array.from({length:Math.min(count,50)},(_,i)=>clip(header?.[i]?.innerText||`column_${i+1}`,128));
          columns=columns.map((v,i)=>columns.indexOf(v)===i?v:clip(`${v}_${i+1}`,128));if(header?.length)start=1;}
        if(new Set(columns).size!==columns.length)die('INVALID_ARGUMENT','Duplicate column names');
        for(let index=start;index<source.length;index++){const row=source[index];if(rows.length>=q.maxRows){truncated=true;break;}
          const cells=row.cells??row.querySelectorAll('th,td'),record=Object.create(null);
          columns.forEach((name,i)=>{const c=q.columns?.[i],cell=c?row.querySelector(c.selector):cells[i];record[name]=cell?clip(c?.attribute?cell.getAttribute(c.attribute):text(cell),4096):null;});
          const rowBytes=new TextEncoder().encode(JSON.stringify(record)).length+1;
          if(bytes+rowBytes>100000){truncated=true;break;}bytes+=rowBytes;rows.push(record);
        }
        data={columns,rows,rowCount:rows.length,truncated};break;
      }
      case 'cell':{
        if(target?.tagName!=='TABLE')die('UNSUPPORTED_CAPABILITY','Only HTML table supported');const row=target.rows[q.row],cell=row?.cells[q.column];if(!cell)die('NOT_FOUND');data={entry:describe(cell,true)};break;
      }
      case 'tree':{
        if(!target?.matches('[role=tree],[role=treeitem]'))die('UNSUPPORTED_CAPABILITY','Only ARIA tree supported');let node=target;
        for(const part of q.path??[]){const matches=Array.from(node.querySelectorAll('[role=treeitem]')).filter(n=>label(n)===part);if(matches.length!==1)die(matches.length?'AMBIGUOUS_TARGET':'NOT_FOUND');node=matches[0];}
        if(q.action!=='read'){
          const wanted=q.action==='expand';if(node.getAttribute('aria-expanded')===null)die('UNSUPPORTED_CAPABILITY','Tree item has no expanded state');
          if((node.getAttribute('aria-expanded')==='true')!==wanted){pointerTarget(node);mutated=true;node.click();}
          data={action:q.action,expanded:node.getAttribute('aria-expanded')==='true'};
        }else{const all=node.matches('[role=treeitem]')?[node]:Array.from(node.querySelectorAll('[role=treeitem]'));data={action:'read',entries:all.slice(0,200).map(n=>({...bind(n),label:label(n),expanded:n.hasAttribute('aria-expanded')?n.getAttribute('aria-expanded')==='true':null,level:Math.max(0,Math.min(32,Number(n.getAttribute('aria-level'))||1))})),truncated:all.length>200};}
        break;
      }
      case 'calendar':{
        editable(target);if(target.tagName!=='INPUT'||target.type!=='date')die('UNSUPPORTED_CAPABILITY','Only native date input supported');
        const d=new Date(q.date+'T00:00:00Z');if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==q.date||(target.min&&q.date<target.min)||(target.max&&q.date>target.max))die('INVALID_ARGUMENT','Invalid or out-of-range date');
        setValue(target,q.date);data={date:target.value,valueMatch:target.value===q.date};break;
      }
      case 'cookies':{
        if(!['http:','https:'].includes(location.protocol))die('UNSUPPORTED_CAPABILITY');
        const list=()=>document.cookie?document.cookie.split(/;\s*/).map(v=>{const i=v.indexOf('=');return {name:v.slice(0,i),value:v.slice(i+1)};}):[];
        if(q.action==='list'){const all=list();data={action:'list',cookies:all.slice(0,200),truncated:all.length>200,origin:location.origin,httpOnlyAccessible:false};break;}
        if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(q.name)||/[\x00-\x20\x7f;",\\]/.test(q.value??''))die('INVALID_ARGUMENT','Cookie requires an ASCII token/value');
        const path=q.path??'/',here=location.pathname;
        if(/[;\r\n]/.test(path)||!(here===path||(here.startsWith(path)&&(path.endsWith('/')||here[path.length]==='/'))))die('INVALID_ARGUMENT','Cookie path must contain the current document at a path boundary');
        if((q.secure||q.sameSite==='None')&&location.protocol!=='https:')die('INVALID_ARGUMENT','Secure cookies require HTTPS');
        mutated=true;document.cookie=`${q.name}=${q.action==='delete'?'':q.value}; Path=${path}; SameSite=${q.sameSite??'Lax'}${q.secure?'; Secure':''}${q.action==='delete'?'; Max-Age=0':q.maxAge!==undefined?`; Max-Age=${q.maxAge}`:''}`;
        const matches=list().filter(c=>c.name===q.name);data={action:q.action,name:q.name,origin:location.origin,httpOnlyAccessible:false,...(q.action==='delete'?{deleted:matches.length===0}:{valueMatch:matches.length===1&&matches[0].value===q.value})};break;
      }
      case 'companionPairing':{
        if(typeof q.companionId!=='string'||!/^[a-p]{32}$/.test(q.companionId)||
          typeof q.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(q.nonce))die('INVALID_ARGUMENT','Pairing challenge is invalid');
        const runtime=globalThis.chrome?.runtime;
        if(!runtime||typeof runtime.sendMessage!=='function')die('COMPANION_PAIRING_UNAVAILABLE','Isolated extension messaging is unavailable');
        try{runtime.sendMessage(q.companionId,{nonce:q.nonce,documentToken:s.token},()=>{
          // The callback is deliberately ignored. It is not identity proof;
          // only the authenticated companion attestation can bind the target.
          void runtime.lastError;
        });}catch{die('COMPANION_PAIRING_UNAVAILABLE','Pairing message could not be sent');}
        // This only confirms that the local send API accepted the call. The
        // authenticated native attestation is the sole source of a binding.
        data={sent:true};break;
      }
      case 'events':{
        if(q.action==='subscribe'){
          if(s.watches.size>=64)die('LIMIT_EXCEEDED');
          const node=target??document,w={owner:q.owner,node:new WeakRef(node),events:[],sequence:0,dropped:0,expired:false,expiresAt:Date.now()+q.ttlMs,listeners:[]};
          const stop=()=>{for(const [type,fn] of w.listeners)node.removeEventListener(type,fn,true);w.listeners=[];w.expired=true;setTimeout(()=>s.watches.delete(q.watchId),60000);};
          for(const type of q.eventTypes){const fn=ev=>{if(Date.now()>=w.expiresAt){stop();return;}const n=ev.target,secret=isPassword(n),item={sequence:++w.sequence,type,at:Date.now(),tag:clip(n?.tagName,64),id:clip(n?.id,256),redacted:secret};if('key'in ev)item.key=secret||!/^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Enter|Escape|Tab|Backspace|Delete|Insert|Shift|Control|Alt|Meta|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|F([1-9]|1[0-9]|2[0-4]))$/.test(ev.key)?'[REDACTED]':clip(ev.key,32);if('value'in(n??{}))item.value=secret?null:clip(n.value,512);if(w.events.length>=128){w.events.shift();w.dropped++;}w.events.push(item);};node.addEventListener(type,fn,true);w.listeners.push([type,fn]);}
          w.timer=setTimeout(stop,q.ttlMs);w.at=Date.now();s.watches.set(q.watchId,w);data={action:'subscribe',cursor:0,ttlMs:q.ttlMs};
        }else{
          const w=s.watches.get(q.watchId);if(!w||w.owner!==q.owner)die('STALE_WATCH');
          if(q.action==='unsubscribe'){clearTimeout(w.timer);for(const [type,fn] of w.listeners)w.node.deref()?.removeEventListener(type,fn,true);s.watches.delete(q.watchId);data={action:'unsubscribe',cancelled:true};}
          else data={action:'poll',events:w.events.filter(e=>e.sequence>(q.cursor??0)),cursor:w.sequence,droppedCount:w.dropped,expired:w.expired};
        }break;
      }
      case 'release':{
        for(const [id,r] of s.renders)if(r.owner===q.owner)cancelRender(id);
        for(const [id,w] of s.watches)if(w.owner===q.owner){clearTimeout(w.timer);for(const [type,fn] of w.listeners)w.node.deref()?.removeEventListener(type,fn,true);s.watches.delete(id);}
        for(const [id,h] of s.highlights)if(h.owner===q.owner){clearTimeout(h.timer);const n=h.ref.deref();if(n?.style.outline===h.applied)n.style.outline=h.previous;s.highlights.delete(id);}
        data={released:true};break;
      }
      default:die('UNSUPPORTED_CAPABILITY','Unknown typed page operation');
    }
    const response={ok:true,documentToken:s.token,viewportGeneration:s.viewport,data};
    const encoded=JSON.stringify(response);if(new TextEncoder().encode(encoded).length>196608)die('RESULT_TOO_LARGE');return encoded;
  }catch(error){return JSON.stringify({ok:false,mutated,error:{code:/^[A-Z_]{1,64}$/.test(error.code??'')?error.code:'PAGE_OPERATION_FAILED',message:clipError(error.message)}});}
  function clipError(message){return String(message??'Page operation failed').slice(0,256);}
}

export const PAGE_FUNCTION=pageOperation.toString();

export function evaluateFunction(script){
  return `function(element,input,tabId){
    const a=JSON.parse(input),key='__rpa_job_'+a.job;
    const record={done:false};Object.defineProperty(globalThis,key,{value:record,configurable:true});
    const finish=(value,failed,error)=>{
      if(failed){record.error={code:'SCRIPT_ERROR',message:String(error?.message??error??'Script rejected').slice(0,256)};record.done=true;return;}
      try{
        let bytes=0,nodes=0;const seen=new Set(),encoder=new TextEncoder();
        const limit=()=>{throw Object.assign(Error('Script result exceeds JSON bounds'),{code:'RESULT_TOO_LARGE'});};
        const charge=n=>{bytes+=n;if(bytes>65536)limit();};
        const string=v=>{if(v.length>65536)limit();charge(encoder.encode(JSON.stringify(v)).length);return v;};
        const copy=(v,depth)=>{
          if(++nodes>5000||depth>16)limit();
          if(v===null){charge(4);return null;}
          if(typeof v==='string')return string(v);
          if(typeof v==='boolean'){charge(v?4:5);return v;}
          if(typeof v==='number'&&Number.isFinite(v)){charge(String(v).length);return v;}
          if(typeof v!=='object')throw Error('Result is not JSON serializable');
          if(seen.has(v))throw Error('Circular result');seen.add(v);let out;
          if(Array.isArray(v)){if(v.length>1000)limit();charge(2+v.length);out=Array.from({length:v.length},(_,i)=>copy(Object.hasOwn(v,i)?v[i]:null,depth+1));}
          else{if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('Only plain JSON objects are supported');out=Object.create(null);charge(2);let count=0;for(const key in v){if(!Object.hasOwn(v,key))continue;if(++count>100)limit();string(key);charge(2);out[key]=copy(v[key],depth+1);}}
          seen.delete(v);return out;
        };
        record.undefinedResult=value===undefined;record.value=value===undefined?null:copy(value,0);
      }catch(e){record.error={code:e?.code==='RESULT_TOO_LARGE'?'RESULT_TOO_LARGE':'SCRIPT_ERROR',message:String(e?.message??'Script serialization failed').slice(0,256)};}record.done=true;
    };
    try{const fn=(${script});if(typeof fn!=='function')throw Error('Expected a function expression');
      const value=fn(a.hasTarget?element:null,a.value,tabId);record.awaitedPromise=Boolean(value&&typeof value.then==='function');
      if(record.awaitedPromise)Promise.resolve(value).then(v=>finish(v,false),e=>finish(null,true,e));else finish(value,false);
    }catch(e){finish(null,true,e);}setTimeout(()=>{if(globalThis[key]===record)delete globalThis[key];},60000);
    return JSON.stringify({pending:!record.done,...(record.done?record:{})});
  }`;
}
export const EVALUATE_POLL_FUNCTION=`function(element,input){const a=JSON.parse(input),key='__rpa_job_'+a.job,r=globalThis[key];if(!r)return JSON.stringify({error:{code:'SCRIPT_JOB_LOST',message:'Script job was lost'}});if(r.done){delete globalThis[key];return JSON.stringify(r);}return JSON.stringify({pending:true});}`;
