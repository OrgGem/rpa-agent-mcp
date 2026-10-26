import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COMPANION_EXTENSION_ID,COMPANION_HOST_NAME} from '../src/companion-protocol.mjs';
import {PINNED_UIPATH_EXTENSION_ID} from '../src/companion-pairing.mjs';

const output=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Expected the companion build output path');
const extensionRoot=join(output,'extension'),hostPath=join(output,`${COMPANION_HOST_NAME}.json`),launcherPath=join(output,'companion-host.cmd');
const fail=message=>{throw new Error(message);};
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3||manifest.background?.service_worker!=='service-worker.mjs'||manifest.background?.type!=='module')fail('Companion extension manifest is not MV3 module-worker format');
if(JSON.stringify(manifest.permissions)!==JSON.stringify(['debugger','downloads','nativeMessaging','tabs']))fail('Companion permissions changed outside the approved set');
if(manifest.host_permissions||manifest.content_scripts||manifest.web_accessible_resources)fail('Companion must not add page access or external web resources');
if(JSON.stringify(manifest.externally_connectable?.ids)!==JSON.stringify([PINNED_UIPATH_EXTENSION_ID]))fail('Companion external sender is not pinned to UiPath');
const idDigest=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16);
const derivedId=[...idDigest].map(byte=>String.fromCharCode(97+(byte>>4),97+(byte&15))).join('');
if(derivedId!==COMPANION_EXTENSION_ID)fail('Stable extension key does not match the pinned extension ID');
for(const file of ['backend.mjs','storage.mjs','protocol.mjs','companion-protocol.mjs','service-worker.mjs','axe.min.js','AXE-LICENSE.txt','axe-core-version.txt'])
  await stat(join(extensionRoot,file));
if((await readFile(join(extensionRoot,'axe-core-version.txt'),'utf8'))!=='4.14.0')fail('Built axe-core version is not pinned to 4.14.0');
if((await stat(join(extensionRoot,'axe.min.js'))).size<1000)fail('Bundled axe-core asset is unexpectedly small');
for(const name of ['backend.mjs','protocol.mjs','service-worker.mjs']){
  const source=await readFile(join(extensionRoot,name),'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){
    const target=resolve(extensionRoot,dirname(name),match[1]);
    if(!inside(extensionRoot,target))fail(`${name} imports outside the unpacked extension root`);
    await stat(target);
  }
}
const native=JSON.parse(await readFile(hostPath,'utf8'));
if(native.name!==COMPANION_HOST_NAME||native.type!=='stdio'||native.description!== 'UiPath typed browser companion transport'||
  JSON.stringify(native.allowed_origins)!==JSON.stringify([`chrome-extension://${COMPANION_EXTENSION_ID}/`]))fail('Native host manifest identity or allowlist is invalid');
if(Object.keys(native).sort().join(',')!=='allowed_origins,description,name,path,type')fail('Native host manifest contains unsupported fields');
if(resolve(native.path)!==resolve(launcherPath))fail('Native host manifest does not point to its generated launcher');
const launcher=await readFile(launcherPath,'utf8');
if(!launcher.startsWith('@echo off\r\n')||!launcher.includes('DisableDelayedExpansion')||!launcher.includes('companion-host.mjs')||!launcher.includes('%*'))
  fail('Windows launcher does not safely forward native host arguments');
console.log(JSON.stringify({valid:true,extensionId:derivedId,extensionRoot,nativeHostManifest:hostPath,nativeHostLauncher:launcherPath,axeCoreVersion:'4.14.0'}));
