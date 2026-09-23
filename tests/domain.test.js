import test from 'node:test';

import assert from 'node:assert/strict';

import {fields,rate,readiness,validateQuestions,localQuestions,validateTask} from '../lib/domain.js';
import {seed} from '../lib/seed.js';

const full=()=>({...Object.fromEntries(fields.map(f=>[f.key,'Подробное подтверждённое описание'])),confirmed:Object.fromEntries(fields.map(f=>[f.key,true]))});

test('Без подтверждения баллы не начисляются; все поля дают ровно 100',()=>{const t=full();assert.equal(rate(t).score,100);t.confirmed={};assert.equal(rate(t).score,0)});
test('Пустые и слишком короткие значения не дают баллы',()=>{const t=full();t.data='   ';t.success='да';assert.equal(rate(t).score,65)});
test('Границы уровней готовности',()=>{assert.deepEqual([0,39,40,69,70,89,90,100].map(readiness),['Черновик','Черновик','Рабочая','Рабочая','Готовая','Готовая','Приоритетная','Приоритетная'])});
test('В локальном режиме минимум 3 вопроса, даже для полной карточки',()=>{assert.ok(localQuestions({}).length>=3);assert.equal(localQuestions(full()).length,3)});
test('AI-ответ с выдуманными полями, дубликатами или неправильной структурой отклоняется',()=>{assert.throws(()=>validateQuestions({questions:[]}));assert.throws(()=>validateQuestions({questions:[{field:'secret',question:'Что вы хотите сделать?'},...localQuestions({}).slice(0,2)]}));const q=localQuestions({});q[1]=q[0];assert.throws(()=>validateQuestions({questions:q}));assert.equal(validateQuestions({questions:localQuestions({})}).length,5)});
test('Валидация карточки и минимальный набор демонстрационных данных',()=>{assert.throws(()=>validateTask({title:'a'}));const d=seed();for(const k of ['tasks','teams','proposals','drafts'])assert.equal(d[k].length,5);assert.ok(d.tasks.some(t=>rate(t).score<40));assert.ok(d.tasks.some(t=>rate(t).score===100))});
