import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,userInfo} from 'node:os';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function computeCompanionEndpoint({root=ROOT,username=userInfo().username,instance=process.env.UIPATH_BRIDGE_INSTANCE??'',platform=process.platform,tempDirectory=tmpdir()}={}){
  let canonicalRoot;try{canonicalRoot=realpathSync.native(root);}catch{throw new TypeError('Companion endpoint root must resolve to a canonical installation directory');}
  const digest=createHash('sha256').update(JSON.stringify([canonicalRoot,username,instance])).digest('hex').slice(0,24);
  return platform==='win32'?`\\\\.\\pipe\\uipath-companion-v1-${digest}`:join(tempDirectory,`uipath-companion-v1-${digest}.sock`);
}
export const COMPANION_ENDPOINT=computeCompanionEndpoint();
