import {BrowserError} from './browser-tools.mjs';

const read=(data,dispatchState='notSent')=>({data,evidence:{kind:'readback',backend:'isolated-dom',dispatchState,outcome:'observed',verified:true}});
const action=data=>({data,evidence:{kind:'dom-readback',backend:'isolated-dom',dispatchState:'acknowledged',outcome:'verified',verified:true}});
const partial=(error,data)=>new BrowserError(error.code??'BACKEND_FAILURE',error.message??'Composite operation failed',{
  dispatchState:error.dispatchState??'acknowledged',recovery:'observe-do-not-retry',details:{completed:data.completed??data.pages??0},data:{...data,partial:true}
});

export function createCompositeHandlers(r,handlers){
  const scoped=async(op,a)=>{
    const x=a.elementRef?await r.element(op,a.elementRef):await r.scope(op,a);
    if(x.tab.ref!==a.tabRef||(a.frameRef&&a.frameRef!==x.frame.ref))throw new BrowserError('REF_SCOPE_MISMATCH','Composite target is outside requested tab/frame');
    return x;
  };
  return {
    async browser_form_read(op,a){
      const x=await scoped(op,a),target=x.entry??x.root;
      const result=await r.page(op,x.tab,x.frame,'form',{targetToken:target?.token,maxFields:a.maxFields??100});
      const fields=result.data.entries.map(n=>{
        const e=r.bind(op,x.tab,x.frame,n);
        return {elementRef:e.ref,name:n.name,tag:n.tag,type:n.type,value:n.value,checked:n.checked,selectedValues:n.selectedValues,redacted:n.redacted};
      });
      await r.frame(op,x.tab,x.frame.ref);
      return read({fields,truncated:result.data.truncated||result.data.entries.some(n=>n.truncated)});
    },
    async browser_form_fill(op,a){
      const {tab,frame}=await r.scope(op,a);r.assertWrite(op,tab);const steps=[];
      for(const [index,field] of a.fields.entries()){
        let elementRef=field.elementRef;
        try{
          if(!elementRef)elementRef=(await r.find(op,{...a,locator:field.locator},{single:true})).elementRef;
          const target=await r.element(op,elementRef);if(target.frame.ref!==frame.ref)throw new BrowserError('REF_SCOPE_MISMATCH','Form field belongs to another frame');
          let result;
          if(Object.hasOwn(field,'value'))result=await handlers.browser_type(op,{elementRef,text:field.value,mode:'replace',method:'dom',verify:true});
          else if(Object.hasOwn(field,'checked'))result=await handlers.browser_set_checked(op,{elementRef,checked:field.checked,method:'dom'});
          else result=await handlers.browser_select_options(op,{elementRef,values:field.selectedValues,method:'dom'});
          steps.push({index,elementRef,ok:true,outcome:result.evidence.outcome});
        }catch(e){steps.push({index,...(elementRef?{elementRef}:{}),ok:false,errorCode:e.code??'BACKEND_FAILURE',outcome:'failed'});throw partial(e,{steps,completed:index,partial:true});}
      }
      return action({steps,completed:steps.length,partial:false});
    },
    async browser_extract_table(op,a){
      let currentTab=a.tabRef,currentFrame=a.frameRef,scopeRoot=a.rootRef,lastSignature=null,pages=0,truncated=false,columns=null,rows=[];
      const originalTab=r.tabs.get(a.tabRef);
      const maxPages=a.pagination?.maxPages??1,maxRows=a.maxRows??500;
      try{
        while(pages<maxPages&&rows.length<maxRows){
          let x,page;
          while(true){
            try{
              if(!x){
                let tableRef=a.elementRef;
                if(a.pagination){const found=await r.find(op,{contextRef:a.contextRef,tabRef:currentTab,frameRef:currentFrame,rootRef:scopeRoot,locator:a.pagination.rootLocator},{single:true});tableRef=found.elementRef;}
                x=tableRef?await r.element(op,tableRef):await r.scope(op,{...a,tabRef:currentTab,frameRef:currentFrame});
              }
              page=(await r.page(op,x.tab,x.frame,'table',{targetToken:(x.entry??x.root)?.token,columns:a.columns,rowSelector:a.rowSelector,maxRows:maxRows-rows.length})).data;
              const signature=JSON.stringify([page.columns,page.rows]);if(signature!==lastSignature){lastSignature=signature;break;}
            }catch(e){
              if(!a.pagination||pages===0||!['STALE_ELEMENT','STALE_TAB'].includes(e.code))throw e;
              const previous=r.tabs.get(currentTab)??x?.tab,refreshed=await r.adopt(op,originalTab.nativeId);
              if(refreshed.windowId!==originalTab.windowId)throw new BrowserError('STALE_TAB','Pagination target window changed');
              // Navigation may start after click's final observation, including
              // during the next find. Reacquire only from explicit locators.
              if(refreshed.docToken!==previous?.docToken){currentFrame=undefined;scopeRoot=undefined;}
              else if(!x)throw e;
              currentTab=refreshed.ref;
            }
            await r.sleep(op,100);
            x=null;
          }
          if(columns&&JSON.stringify(columns)!==JSON.stringify(page.columns))throw new BrowserError('TABLE_SCHEMA_CHANGED','Columns changed between pages');
          columns??=page.columns;
          for(const row of page.rows){if(Buffer.byteLength(JSON.stringify([...rows,row]),'utf8')>100000){truncated=true;break;}rows.push(row);}
          pages++;truncated||=page.truncated;
          if(!a.pagination||truncated||pages>=maxPages||rows.length>=maxRows)break;
          let next;
          try{next=await r.find(op,{contextRef:a.contextRef,tabRef:currentTab,frameRef:currentFrame,locator:a.pagination.nextLocator},{single:true});}
          catch(e){if(e.code==='NOT_FOUND')break;throw e;}
          const n=await r.element(op,next.elementRef);if(n.observation.entry.state.disabled)break;
          const clicked=await handlers.browser_click(op,{elementRef:next.elementRef,button:'left',clickCount:1,method:'dom'});
          if(clicked.data.documentChanged){if(!clicked.data.tabRef)throw new BrowserError('STALE_TAB','Pagination navigation needs rediscovery');currentTab=clicked.data.tabRef;currentFrame=undefined;scopeRoot=undefined;}
        }
        if(a.pagination&&(pages>=maxPages||rows.length>=maxRows))truncated=true;
        return read({columns:columns??[],rows,rowCount:rows.length,truncated,pages,partial:false},op.dispatchState);
      }catch(e){throw partial(e,{columns:columns??[],rows,rowCount:rows.length,truncated:true,pages,partial:true,errors:[e.code??'BACKEND_FAILURE']});}
    },
    async browser_table_cell(op,a){
      const {entry,tab,frame}=await r.element(op,a.elementRef);const data=(await r.page(op,tab,frame,'cell',{targetToken:entry.token,row:a.row,column:a.column})).data;
      return read({elementRef:r.bind(op,tab,frame,data.entry).ref,row:a.row,column:a.column});
    },
    async browser_tree(op,a){
      const {entry,tab,frame}=await r.element(op,a.elementRef);if(a.action!=='read')r.assertWrite(op,tab);
      const data=(await r.page(op,tab,frame,'tree',{targetToken:entry.token,action:a.action,path:a.path},a.action!=='read')).data;
      if(a.action==='read')return read({action:'read',nodes:data.entries.map(n=>({elementRef:r.bind(op,tab,frame,n).ref,label:n.label,expanded:n.expanded,level:n.level})),truncated:data.truncated});
      if(data.expanded!==(a.action==='expand'))throw new BrowserError('POSTCONDITION_FAILED','ARIA expanded state did not match',{dispatchState:'acknowledged',recovery:'observe-do-not-retry'});
      return action({action:a.action,expanded:data.expanded});
    },
    async browser_calendar_select(op,a){const {entry,tab,frame}=await r.element(op,a.elementRef);r.assertWrite(op,tab);const data=(await r.page(op,tab,frame,'calendar',{targetToken:entry.token,date:a.date},true)).data;const retained=await r.postElement(op,entry,tab,frame);data.valueMatch=retained.value===a.date;if(!data.valueMatch)throw new BrowserError('POSTCONDITION_FAILED','Date input did not retain the requested date',{dispatchState:'acknowledged'});data.date=retained.value;return action(data);},
    async browser_close_popup(op,a){
      const target=await r.find(op,{...a,locator:a.closeLocator},{single:true});const result=await handlers.browser_click(op,{elementRef:target.elementRef,method:'dom',button:'left',clickCount:1});
      return {...result,data:{elementRef:target.elementRef,acknowledged:true}};
    }
  };
}
