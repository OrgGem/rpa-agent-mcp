import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
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

test('generated Unicode launcher preserves binary stdio, arguments, probe mode and exit code', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'rpa-host-Unicode-'));
  try{
    const checkout=path.join(folder,'Tiếng Việt ! %RPA_PATH_TEST%'),node=path.join(checkout,'Node Tiếng Việt.exe');
    await mkdir(path.join(checkout,'src'),{recursive:true});await copyFile(process.execPath,node);
    await writeFile(path.join(checkout,'src/bridge.mjs'),'process.stderr.write(JSON.stringify({args:process.argv.slice(2),probe:process.env.UIPATH_G0_PROBE??""}));process.exitCode=23;process.stdin.pipe(process.stdout);');
    const origin='chrome-extension://jfcmnbofjlffnejneillkgbniiidiigd/',bytes=Buffer.from(Array.from({length:1024},(_,i)=>i%256));
    for(const enabled of [true,false]){
      await exec('pwsh',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/Write-NativeHostFiles.ps1'),'-Root',checkout,'-NodePath',node,...(enabled?['-EnableG0Probe']:[])],{timeout:10000,windowsHide:true});
      const manifest=JSON.parse(await readFile(path.join(checkout,'native-host.json'),'utf8'));
      assert.equal(manifest.path,path.join(checkout,'native-host.cmd'));assert.deepEqual(manifest.allowed_origins,[origin]);
      const launcher=await readFile(manifest.path);assert.notEqual(launcher.subarray(0,3).toString('hex'),'efbbbf','CMD needs an ASCII preamble without a BOM');
      const child=spawn('cmd.exe',['/d','/s','/c',`""%RPA_TEST_LAUNCHER%" "${origin}" --parent-window=0"`],{
        windowsHide:true,windowsVerbatimArguments:true,stdio:['pipe','pipe','pipe'],env:{...process.env,RPA_TEST_LAUNCHER:manifest.path,RPA_PATH_TEST:'must-not-expand',UIPATH_G0_PROBE:'inherited'}
      });
      const stdout=[],stderr=[];child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));child.stdin.on('error',()=>{});
      const exit=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Launcher test timed out'));},10000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);resolve(code);});});
      child.stdin.end(bytes);assert.equal(await exit,23,Buffer.concat(stderr).toString());
      assert.deepEqual(Buffer.concat(stdout),bytes,'No text or encoding conversion may corrupt native framing');
      assert.deepEqual(JSON.parse(Buffer.concat(stderr).toString()),{args:['native',origin,'--parent-window=0'],probe:enabled?'1':''});
    }
  }finally{
    assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert.match(path.basename(folder),/^rpa-host-Unicode-/);
    await rm(folder,{recursive:true,force:true});
  }
});
