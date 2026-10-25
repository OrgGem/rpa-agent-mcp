import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);

test('Rollback validation refuses corrupted bytes and non-allowlisted targets before mutation', {skip:process.platform!=='win32'},async t=>{
  try{await exec('pwsh',['-NoProfile','-Command','$PSVersionTable.PSVersion.Major'],{timeout:10000});}
  catch{t.skip('PowerShell 7 not available');return;}
  const folder=await mkdtemp(path.join(tmpdir(),'rpa-host-rollback-test-'));
  try{
    const roots={previous:path.join(folder,'old'),new:path.join(folder,'new')};
    for(const root of Object.values(roots)){await mkdir(root);await writeFile(path.join(root,'Setup.ps1'),'# Validation fixture only. Never executed.\n');}
    const snapshotFolder=path.join(roots.new,'work','host-transition-test');await mkdir(snapshotFolder,{recursive:true});
    const base={schemaVersion:1,hostName:'com.uipath.chromenativemsg_v2',previousRoot:roots.previous,newRoot:roots.new,
      registrations:['Registry32','Registry64'].map(view=>({view,existed:false,manifest:null})),
      files:Object.keys(roots).flatMap(role=>['native-host.json','native-host.cmd','registration-before.json'].map(name=>({role,name,existed:false,contentBase64:'',sha256:null})))};
    for(const [mutate,pattern] of [
      [s=>{s.files[0].existed=true;s.files[0].contentBase64=Buffer.from('changed').toString('base64');s.files[0].sha256='0'.repeat(64);},/checksum mismatch/],
      [s=>{s.files[0].name='..\\escape.txt';},/Unexpected rollback file/],
      [s=>{s.files.pop();},/Incomplete rollback file set/],
      [s=>{s.registrations[0].view='Unknown';},/Invalid original registration/]
    ]){
      const snapshot=structuredClone(base);mutate(snapshot);
      const file=path.join(snapshotFolder,'snapshot.json');await writeFile(file,JSON.stringify(snapshot));
      await assert.rejects(exec('pwsh',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/Restore-NativeHost.ps1'),'-SnapshotPath',file,'-ValidateOnly'],{timeout:10000}),error=>pattern.test(error.stderr));
    }
  }finally{
    assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert.match(path.basename(folder),/^rpa-host-rollback-test-/);
    await rm(folder,{recursive:true,force:true});
  }
});
