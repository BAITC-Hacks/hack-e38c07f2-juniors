import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fields,rate,validateTask,localQuestions,validateQuestions,aiPrompt} from './lib/domain.js';
import {seed} from './lib/seed.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.DATA_DIR||path.join(root,'data');mkdirSync(dataDir,{recursive:true});
const dbPath=path.join(dataDir,'db.json');
let db=existsSync(dbPath)?JSON.parse(readFileSync(dbPath,'utf8')):seed();
function save(){writeFileSync(dbPath+'.tmp',JSON.stringify(db,null,2));renameSync(dbPath+'.tmp',dbPath)}save();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>100000)throw new Error('Запрос слишком большой')}try{return JSON.parse(s||'{}')}catch{throw new Error('Некорректный JSON')}}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');const p=url.pathname;
 if(p.startsWith('/api/')&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Недопустимый источник запроса'});
 if(req.method==='GET'&&p==='/api/state')return json(res,200,{...db,tasks:db.tasks.map(t=>({...t,...rate(t)})),fields,aiEnabled:!!process.env.OPENAI_API_KEY});
 if(req.method==='POST'&&p==='/api/analyze'){
  const input=await body(req);if(typeof input.description!=='string'||input.description.trim().length<10||input.description.length>6000)throw new Error('Опишите задачу: от 10 до 6000 символов');
  let questions=localQuestions(input),mode='local',notice='Локальный режим: вопросы по недостающим полям. AI API не подключён.';
  if(process.env.OPENAI_API_KEY){try{
   const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',response_format:{type:'json_object'},messages:[{role:'system',content:aiPrompt},{role:'user',content:JSON.stringify(input)}]}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error('API error');
   const result=await response.json();questions=validateQuestions(JSON.parse(result.choices[0].message.content));mode='ai';notice='AI проанализировал описание. Проверьте ответы перед подтверждением карточки.';
  }catch{notice='AI временно недоступен или вернул некорректный ответ. Использованы локальные вопросы.'}}
  return json(res,200,{questions,mode,notice});
 }
 if(req.method==='POST'&&p==='/api/tasks'){
  const input=await body(req),clean=validateTask(input);
  const existing=input.id?db.tasks.find(t=>t.id===input.id):null;if(input.id&&!existing)return json(res,404,{error:'Задача не найдена'});
  if(input.published===true&&input.reviewed!==true)throw new Error('Подтвердите карточку перед публикацией');
  const task={...existing,...clean,id:existing?.id||randomUUID(),company:existing?.company||'Ваш бизнес',published:input.published===true,createdAt:existing?.createdAt||new Date().toISOString()};
  if(existing)db.tasks[db.tasks.indexOf(existing)]=task;else db.tasks.push(task);save();return json(res,200,{...task,...rate(task)});
 }
 if(req.method==='POST'&&p==='/api/proposals'){
  const b=await body(req);if(!db.tasks.some(t=>t.id===b.taskId&&t.published)||!db.teams.some(t=>t.id===b.teamId))throw new Error('Задача или команда не найдена');
  for(const k of ['idea','plan','deadline','link'])if(typeof b[k]!=='string'||b[k].trim().length<3||b[k].length>6000)throw new Error('Заполните идею, план, срок и ссылку');
  let link;try{link=new URL(b.link)}catch{throw new Error('Введите корректную ссылку на прототип')}if(!['http:','https:'].includes(link.protocol))throw new Error('Ссылка должна начинаться с https:// или http://');
  const proposal={id:randomUUID(),taskId:b.taskId,teamId:b.teamId,idea:b.idea.trim(),plan:b.plan.trim(),deadline:b.deadline.trim(),link:link.href,status:'pending',milestoneConfirmed:false,createdAt:new Date().toISOString()};db.proposals.push(proposal);save();return json(res,201,proposal);
 }
 if(req.method==='POST'&&/^\/api\/proposals\/[^/]+$/.test(p)){
  const proposal=db.proposals.find(x=>x.id===p.split('/').pop());if(!proposal)return json(res,404,{error:'Отклик не найден'});const b=await body(req);
  if(b.action==='milestone'){if(proposal.status!=='accepted')throw new Error('Сначала выберите команду');proposal.milestoneConfirmed=true}
  else if(['accepted','rejected'].includes(b.status)){proposal.status=b.status;if(b.status==='rejected')proposal.milestoneConfirmed=false}
  else throw new Error('Неизвестное действие');save();return json(res,200,proposal);
 }
 if(p.startsWith('/api/'))return json(res,404,{error:'Маршрут не найден'});
 if(req.method!=='GET')return json(res,405,{error:'Метод не поддерживается'});
 const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};if(!assets[p])return json(res,404,{error:'Страница не найдена'});
 res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(readFileSync(path.join(root,'public',assets[p])));
 }catch(e){json(res,400,{error:e.message||'Ошибка запроса'})}
});
server.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log(`AlemQuest: http://localhost:${process.env.PORT||3000}`));
