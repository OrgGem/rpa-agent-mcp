import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const allowed=new Set(['MIT','MIT-0','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','BlueOak-1.0.0','CC0-1.0']);
const packages=Object.entries(lock.packages).filter(([p])=>p).map(([p,v])=>({path:p,version:v.version,license:v.license??null,developmentOnly:v.dev===true})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
for(const p of packages)if(!allowed.has(p.license))throw Error(`Dependency license needs review: ${p.path}`);
const result={schemaVersion:1,runtimeVersion:lock.version,source:'package-lock.json license metadata',packages,
  limitations:['Metadata inventory and allowlist check only, not a legal conclusion. Preserve upstream license notices when distributing dependencies.','UiPath extension/embedded driver is installed separately and is not covered by this project MIT license or bundled in the source release.']};
const target=path.join(root,'docs/dependency-licenses.json'),text=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write'))await writeFile(target,text);else if(await readFile(target,'utf8')!==text)throw Error('License inventory drift; run npm run licenses:build and review');
console.log(JSON.stringify({passed:true,packages:packages.length,productionPackages:packages.filter(p=>!p.developmentOnly).length,mode:process.argv.includes('--write')?'write':'check'}));
