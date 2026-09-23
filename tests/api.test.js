import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
test('Сквозной API-сценарий: AI fallback → публикация → отклик → выбор → этап → перезапуск',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'alemquest-test-'));
 const port=31000+Math.floor(Math.random()*10000);
 const start=async()=>{const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'error').then(([e])=>{throw e}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Server startup timeout')),8000).unref())]);return child};
 let child=await start();
 const call=async(p,b)=>{const r=await fetch(`http://127.0.0.1:${port}/api/${p}`,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{});return {status:r.status,data:await r.json()}};
 try{
  const s=(await call('state')).data;
  const analysis=await call('analyze',{description:'Хочу улучшить закупки в нашей кофейне'});assert.equal(analysis.data.mode,'local');assert.ok(analysis.data.questions.length>=3);
  const task={title:'Проверка сквозного сценария',industry:'Ритейл',description:'Нужно улучшить закупки',published:true};
  assert.equal((await call('tasks',task)).status,400);
  let created=(await call('tasks',{...task,reviewed:true})).data;assert.equal(created.score,0);assert.equal(created.published,true);
  const response=await call('proposals',{taskId:created.id,teamId:s.teams[0].id,idea:'Сделаем прогноз',plan:'Анализ и прототип',deadline:'10 дней',link:'https://example.com/prototype'});assert.equal(response.status,201);const id=response.data.id;
  assert.equal((await call('proposals/'+id,{action:'milestone'})).status,400);
  assert.equal((await call('proposals/'+id,{status:'accepted'})).data.status,'accepted');
  assert.equal((await call('proposals/'+id,{action:'milestone'})).data.milestoneConfirmed,true);
  assert.equal((await call('proposals/'+id,{action:'milestone'})).data.milestoneConfirmed,true);
  for(const f of s.fields){task[f.key]='Подробное описание для команды'}task.confirmed=Object.fromEntries(s.fields.map(f=>[f.key,true]));
  const updated=await call('tasks',{...task,id:created.id,reviewed:true});assert.equal(updated.data.score,100);
  assert.equal((await call('proposals',{taskId:created.id,teamId:s.teams[0].id,idea:'Ещё идея',plan:'План работы',deadline:'Неделя',link:'javascript:alert(1)'})).status,400);
  const exit=once(child,'exit');child.kill();await exit;child=await start();
  const persisted=(await call('state')).data;assert.equal(persisted.tasks.find(t=>t.id===created.id).score,100);assert.equal(persisted.proposals.find(p=>p.id===id).milestoneConfirmed,true);
  assert.equal((await call('proposals/'+id,{status:'rejected'})).data.milestoneConfirmed,false);
 }finally{const exit=once(child,'exit');child.kill();await exit;assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('alemquest-test-'));rmSync(dir,{recursive:true,force:true})}
});
