import {spawn} from 'node:child_process';
import {mkdtempSync, existsSync, readFileSync, mkdirSync, copyFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import net from 'node:net';
const directory=mkdtempSync(path.join(os.tmpdir(),'signaldesk-mac-test-'));
const data=path.join(directory,'data');
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;await new Promise(r=>server.close(r));
const binary=path.resolve('release/Signaldesk.app/Contents/MacOS/Signaldesk');
const app=spawn(binary,[],{env:{...process.env,SIGNALDESK_DATA_DIR:data,SIGNALDESK_PORT:String(port),SIGNALDESK_SMOKE_DIR:directory},stdio:['ignore','pipe','pipe']});
const exited=new Promise(resolve=>app.once('exit',(code,signal)=>resolve({code,signal})));
let errors='';app.stderr.on('data',d=>{errors+=d.toString()});
const base=`http://127.0.0.1:${port}`;
try {
  let ready=false;
  for(let i=0;i<120;i++) {
    try {if((await fetch(base+'/api/health')).ok){ready=true;break}} catch {}
    await new Promise(r=>setTimeout(r,250));
  }
  assert.ok(ready,'Mac app starts its own server: '+errors);
  const health=await (await fetch(base+'/api/health')).json();
  assert.equal(Number(readFileSync(path.join(data,'process.lock'),'utf8')),health.pid);
  const status=await (await fetch(base+'/api/automation/status')).json();
  assert.equal(status.paused,true);
  const html=await (await fetch(base)).text();assert.ok(html.includes('<div id="root">'));
  const result=await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Window close failed to terminate the Mac app')),25000);timer.unref()})]);
  assert.equal(result.code,0);
  assert.equal(existsSync(path.join(data,'process.lock')),false,'Red window close releases the lock');
  await assert.rejects(fetch(base+'/api/health'),'Closing the app stops its server');
  assert.ok(existsSync(path.join(directory,'desktop.png')),'Native WebKit rendered the dashboard');
  mkdirSync('output/macos',{recursive:true});copyFileSync(path.join(directory,'desktop.png'),'output/macos/desktop.png');
  const reopened=spawn(binary,[],{env:{...process.env,SIGNALDESK_DATA_DIR:data,SIGNALDESK_PORT:String(port)},stdio:'ignore'});
  try {
    let restarted=false;
    for(let i=0;i<120;i++) {
      try {if((await fetch(base+'/api/health')).ok){restarted=true;break}} catch {}
      await new Promise(r=>setTimeout(r,250));
    }
    assert.ok(restarted,'Mac app can reopen the same workspace');
    const gone=new Promise(resolve=>reopened.once('exit',resolve));
    reopened.kill('SIGKILL');await gone;
    for(let i=0;i<80 && existsSync(path.join(data,'process.lock'));i++) await new Promise(r=>setTimeout(r,100));
    assert.equal(existsSync(path.join(data,'process.lock')),false,'A crashed app does not orphan its server');
    await assert.rejects(fetch(base+'/api/health'));
  } finally {if(reopened.exitCode===null && reopened.signalCode===null)reopened.kill('SIGKILL');}
  console.log(JSON.stringify({passed:true,checks:['bundled runtime launch','own server identity','paused startup','native dashboard snapshot','window close exits app','server stops','lock removed','reopen','server exits after app crash'],workspace:directory}));
} finally {if(app.exitCode===null && app.signalCode===null)app.kill('SIGTERM'); if(existsSync(path.join(data,'process.lock'))) {const pid=Number(readFileSync(path.join(data,'process.lock'),'utf8'));if(pid>1){try{process.kill(pid,'SIGTERM')}catch{}}}}
