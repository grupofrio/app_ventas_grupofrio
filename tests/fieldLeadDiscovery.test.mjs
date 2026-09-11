import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code, {exports, require: name => {if (!(name in mocks)) throw Error(name); return mocks[name];}, setTimeout, clearTimeout});
  return exports;
}
test('online special search includes fresh lead; offline never queries server', async () => {
  let online = true, calls = 0;
  const logic = load('src/services/offrouteSearchLogic.ts');
  const service = load('src/services/offrouteSearch.ts', {
    './employeeDayBundle': {loadCurrentEmployeeDayBundle: async () => ({record:{bundle:{directory:[]}}})},
    './offrouteSearchLogic': logic,
    './fieldLeadSearch': {searchFieldLeads: async () => {calls++; return [{id:5461,name:'PROSPECTO 1'}];}},
    '../stores/useSyncStore': {useSyncStore:{getState:()=>({isOnline:online})}},
  });
  const results = await service.searchOffrouteEntities('PROSPECTO 1');
  assert.equal(results[0]?.id, 5461);
  assert.equal(results[0]?.entityType, 'lead');
  online=false;
  assert.equal((await service.searchOffrouteEntities('PROSPECTO 1')).length,0);
  assert.equal(calls,1);
});
test('creation only succeeds on an explicit positive lead acknowledgement', () => {
  const {requireCreatedFieldLead} = load('src/services/fieldLeadCreatePayload.ts');
  for(const data of [null, {}, {id:0}, {id:-1}, {id:'5461'}]) assert.throws(()=>requireCreatedFieldLead(data));
  assert.equal(requireCreatedFieldLead({id:5461}).id,5461);
});
test('postvisit sends server special visit identity instead of a virtual stop', () => {
  const {buildPostvisitPayload} = load('src/services/postvisitPayload.ts');
  const result = buildPostvisitPayload({stop:{id:-7,customer_name:'PROSPECTO 1',_entityType:'lead',_leadId:5461,_isOffroute:true,_offrouteVisitId:90},form:{contactName:'Test',phone:'',email:'',competitor:'',freezer:'no',interestLevel:'low',notes:''},stageId:1});
  assert.equal(result.offroute_visit_id,90);
  assert.equal(result.stop_id,undefined);
});
test('screen retries the persisted capture instead of creating a second lead', async () => {
  const source=readFileSync(new URL('../app/newcustomer.tsx',import.meta.url),'utf8');
  const tree=ts.createSourceFile('newcustomer.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler;
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='handleSave')handler=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);
  const {createFieldLeadIntakeFlow}=load('src/services/fieldLeadIntakeFlow.ts');
  let fail=true, n=0;const ids=[];
  const flow=createFieldLeadIntakeFlow({uuid:()=>`op-${++n}`,save:async()=>{},load:async()=>null,remove:async()=>{},enqueue:id=>{ids.push(id);return id;},persistQueue:async()=>{if(fail)throw Error('disk');},release:()=>{},process:()=>{}});
  const ctx={busyRef:{current:false},nativeRef:{current:{flow}},mounted:{current:true},form:{nombre:'PROSPECTO 1',giro:'abarrotes_miscelanea'},giroToCanal:()=>true,gps:null,draft:null,saved:false,editing:false,setEditing:()=>{},setForm:()=>{},setGps:()=>{},setSaving:()=>{},setDraft:value=>ctx.draft=value,Alert:{alert:()=>{}}};
  vm.runInNewContext(ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';globalThis.save=handleSave;',ctx);
  await ctx.save();assert.equal(ctx.draft.phase,'captured');
  fail=false;await ctx.save();assert.equal(ctx.draft.phase,'queued');assert.deepEqual(ids,['op-1','op-1']);
});
test('saving data refreshes persisted phone and GPS while preserving local visit identity', () => {
  const {applyLeadUpsertToStop} = load('src/services/leadVisit.ts');
  const stop={id:-7,_isOffroute:true,_offrouteVisitId:90,_entityType:'lead',customer_name:'PROSPECTO 1'};
  const result=applyLeadUpsertToStop(stop,{id:5461,phone:'7331234567',stop:{id:880,customer_phone:'7331234567',customer_latitude:18.3,customer_longitude:-99.5}});
  assert.equal(result.phone,'7331234567');
  assert.equal(result.customer_latitude,18.3);
  assert.equal(result.customer_longitude,-99.5);
  assert.equal(result.id,-7);
  assert.equal(result._offrouteVisitId,90);
});

test('refresh keeps one active special visit and preserves local navigation id', () => {
  const {mergeBackendStopsWithDrafts}=load('src/services/offrouteDrafts.ts');
  const draft={id:-7,customer_id:5461,_entityType:'lead',_leadId:5461,_isOffroute:true,_offrouteVisitId:90,state:'in_progress',_virtualCreatedAt:100};
  const server={...draft,id:880,phone:'7331234567'};
  const merged=mergeBackendStopsWithDrafts([server],[draft],101);
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,-7);
  assert.equal(merged[0].phone,'7331234567');
});
test('an unconfirmed held draft guards native stack removal until persisted', () => {
  const source=readFileSync(new URL('../app/newcustomer.tsx',import.meta.url),'utf8');
  const tree=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let hook;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='usePreventRemove')hook=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);
  let blocked;
  const ctx={saving:false,draft:{phase:'captured'},Alert:{alert:()=>{}},usePreventRemove:flag=>blocked=flag};
  const code=ts.transpileModule(hook,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,ctx);assert.equal(blocked,true);
  ctx.draft.phase='queued';vm.runInNewContext(code,ctx);assert.equal(blocked,false);
});
test('lead search failure preserves cached customers and explicitly warns', async () => {
  const logic=load('src/services/offrouteSearchLogic.ts');let warning='';
  const service=load('src/services/offrouteSearch.ts',{
    './employeeDayBundle':{loadCurrentEmployeeDayBundle:async()=>({record:{bundle:{directory:[{id:5,name:'PROSPECTO CLIENTE'}]}}})},
    './offrouteSearchLogic':logic,
    './fieldLeadSearch':{searchFieldLeads:async()=>{throw Error('network');}},
    '../stores/useSyncStore':{useSyncStore:{getState:()=>({isOnline:true})}},
  });
  const results=await service.searchOffrouteEntities('PROSPECTO',text=>warning=text);
  assert.equal(results[0].id,5);assert.match(warning,/No se pudieron consultar/);
});
